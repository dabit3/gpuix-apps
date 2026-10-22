import { describe, expect, it } from 'bun:test'
import { copyFileSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { DevinApp, setUrlOpener } from './src/App'
import { DevinClient, type ApiAttachment, type ApiSession, type DevinApi } from './src/api'
import { previewPath, shotsFrom, type Shot } from './src/computer'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const PNG = path.join(import.meta.dir, 'media', 'screenshot.png')
const att = (id: string, name: string, content_type: string, source: 'devin' | 'user' = 'devin'): ApiAttachment => ({ attachment_id: id, name, content_type, source, url: `https://app.devin.ai/attachments/${id}/${name}` })

describe("Devin's computer: attachments", () => {
  it('lists attachments and resolves the presigned download URL without following it', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/attachments')) return new Response(JSON.stringify([att('a1', 'shot.png', 'image/png')]), { status: 200 })
      if (url.includes('/attachments/a1/')) return new Response(null, { status: 307, headers: { location: 'https://s3.example/a1?sig=1' } })
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    const c = new DevinClient({ apiKey: 'tok', orgId: 'org-1', fetch: fake })
    const list = await c.listAttachments('abc')
    expect(calls[0]!.url).toBe('https://api.devin.ai/v3/organizations/org-1/sessions/abc/attachments')
    expect(list.map((a) => a.name)).toEqual(['shot.png'])
    expect(await c.attachmentUrl(list[0]!)).toBe('https://s3.example/a1?sig=1')
    expect(calls[1]!.url).toBe('https://api.devin.ai/v3/organizations/org-1/attachments/a1/shot.png')
    expect(calls[1]!.init?.redirect).toBe('manual')
    expect((calls[1]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    await expect(c.attachmentUrl(att('zz', 'gone.png', 'image/png'))).rejects.toThrow('404')
  })

  it("keeps only Devin's screenshots and recordings, in order", () => {
    const shots = shotsFrom([att('a', 'a.png', 'image/png'), att('j', 'log.json', 'application/json'), att('u', 'mine.png', 'image/png', 'user'), att('v', 'run.mp4', 'video/mp4'), att('n', 'b.jpg', '')])
    expect(shots.map((s) => `${s.attachment_id}:${s.kind}`)).toEqual(['a:image', 'v:video', 'n:image'])
  })

  it('downloads images, makes video posters, and caches both on disk', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'devin-tui-prev-'))
    let resolved = 0
    const deps = {
      dir,
      resolve: async (a: ApiAttachment) => (resolved++, `https://s3.example/${a.attachment_id}`),
      fetch: (async () => new Response(readFileSync(PNG))) as unknown as typeof fetch,
      poster: async (_url: string, out: string) => (copyFileSync(PNG, out), true),
    }
    const [img, vid] = shotsFrom([att('i1', 'screen.png', 'image/png'), att('v1', 'run.mp4', 'video/mp4')]) as [Shot, Shot]
    const p1 = await previewPath(img, deps)
    const p2 = await previewPath(vid, deps)
    expect(p1).toBe(path.join(dir, 'i1-screen.png'))
    expect(p2).toBe(path.join(dir, 'v1-poster.jpg'))
    expect(readFileSync(p1!).length).toBe(readFileSync(PNG).length)
    expect(await previewPath(img, deps)).toBe(p1)
    expect(resolved).toBe(2)
    expect(await previewPath(shotsFrom([att('x', 'y.mp4', 'video/mp4')])[0]!, { ...deps, dir: path.join(dir, 'x'), poster: async () => false })).toBeNull()
  })
})

describeNative("Devin's computer panel", () => {
  it('shows the latest screenshot, steps back through recordings, follows new posts and survives the theme toggle', async () => {
    const now = Date.now() / 1000
    const session: ApiSession = { session_id: 'aaa', title: 'Build the checkout page', status: 'running', status_detail: 'working', url: 'https://app.devin.ai/sessions/aaa', created_at: now - 600, updated_at: now - 5, acus_consumed: 2, devin_mode: 'normal', tags: [], parent_session_id: null, pull_requests: [] }
    const attachments = [att('a1', 'before.png', 'image/png'), att('j1', 'trace.json', 'application/json'), att('v1', 'flow.mp4', 'video/mp4'), att('a2', 'after.png', 'image/png')]
    const opened: string[] = []
    const client: DevinApi = {
      listSessions: async () => ({ items: [session], hasMore: false }),
      getSession: async () => session,
      listMessages: async () => [],
      createSession: async () => session,
      sendMessage: async () => ({}),
      listAttachments: async () => [...attachments],
      attachmentUrl: async (a) => `https://s3.example/${a.attachment_id}`,
    }
    const dir = mkdtempSync(path.join(tmpdir(), 'devin-tui-ui-'))
    const previews = {
      dir,
      fetch: (async () => new Response(readFileSync(PNG))) as unknown as typeof fetch,
      poster: async (_url: string, out: string) => (copyFileSync(PNG, out), true),
    }
    setUrlOpener((u) => opened.push(u))
    const { render, renderer } = createTestRoot({ width: 1440, height: 900 })
    render(<DevinApp client={client} pollMs={150} previews={previews} />)
    const app = await connectTest(renderer)
    const textOf = (id: string) => app.getByTestId(id).textContent().catch(() => null)
    const until = async (check: () => Promise<boolean>, what: string) => {
      const start = Date.now()
      while (!(await check())) {
        if (Date.now() - start > 8000) throw new Error(`timed out waiting for ${what}`)
        await sleep(80)
      }
    }
    const count = async (want: string) => until(async () => (await textOf('computer-count')) === want, `count ${want}`)

    await until(async () => (await app.getByTestId('session-aaa').count()) === 1, 'session row')
    await app.getByTestId('session-aaa').click()
    await count('3 / 3')
    expect(await textOf('computer-name')).toBe('after.png')
    await until(async () => (await app.getByTestId('computer-image').count()) === 1, 'screenshot image')
    expect(await app.getByTestId('computer-following').count()).toBe(1)

    await app.getByTestId('computer-prev').click()
    await count('2 / 3')
    expect(await textOf('computer-name')).toBe('flow.mp4')
    expect(await app.getByTestId('computer-video-badge').count()).toBe(1)
    await until(async () => (await app.getByTestId('computer-image').count()) === 1, 'video poster')
    expect(await app.getByTestId('computer-latest').count()).toBe(1)

    await app.getByTestId('computer-item-0').click()
    await count('1 / 3')
    await app.getByTestId('theme-toggle').click()
    await sleep(250)
    await count('1 / 3')
    await app.getByTestId('theme-toggle').click()
    await sleep(250)

    attachments.push(att('a3', 'final.png', 'image/png'))
    await count('1 / 4')
    await app.getByTestId('computer-latest').click()
    await count('4 / 4')
    attachments.push(att('a4', 'deployed.png', 'image/png'))
    await count('5 / 5')
    expect(await textOf('computer-name')).toBe('deployed.png')

    await app.getByTestId('computer-open').click()
    expect(opened.at(-1)).toBe('https://app.devin.ai/attachments/a4/deployed.png')

    await app.getByTestId('tab-details').click()
    await until(async () => (await app.getByTestId('detail-status').count()) === 1, 'session details')
    await app.getByTestId('tab-computer').click()
    await count('5 / 5')
  }, 60_000)
})
