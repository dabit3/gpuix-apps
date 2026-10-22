import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'bun:test'
import { DevinClient, loadConfig, uiStatus } from './src/api'
import { cleanMessage, eventsFromMessages, sessionFromApi } from './src/live'
import { resolveTheme } from './src/theme'

describe('Devin API client', () => {
  it('calls the v3 org endpoints with the bearer token and follows message pages', async () => {
    const calls: { url: string; method: string; auth: string | null; body?: string }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', auth: new Headers(init.headers).get('Authorization'), body: init.body as string | undefined })
      if (url.includes('/messages?first=100&after=c1')) return Response.json({ items: [{ event_id: 'b', created_at: 2, message: 'two', source: 'devin' }], has_next_page: false })
      if (url.includes('/messages')) return Response.json({ items: [{ event_id: 'a', created_at: 1, message: 'one', source: 'user' }], has_next_page: true, end_cursor: 'c1' })
      if (url.endsWith('/sessions?first=5')) return Response.json({ items: [], has_next_page: true })
      if (init.method === 'POST') return Response.json({ session_id: 'devin-x', status: 'new' })
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    const client = new DevinClient({ apiKey: 'tok', orgId: 'org-1', fetch: fake })

    expect(await client.listSessions(5)).toEqual({ items: [], hasMore: true })
    expect((await client.listMessages('devin-x')).map((m) => m.message)).toEqual(['one', 'two'])
    await client.createSession('hi', { mode: 'fast', repos: ['acme/web'] })
    await client.sendMessage('devin-x', 'more')
    await expect(client.getSession('missing')).rejects.toThrow('Devin API 404')

    expect(calls[0]).toMatchObject({ url: 'https://api.devin.ai/v3/organizations/org-1/sessions?first=5', auth: 'Bearer tok' })
    expect(JSON.parse(calls[3]!.body!)).toEqual({ prompt: 'hi', devin_mode: 'fast', repos: ['acme/web'], tags: ['devin-tui'] })
    expect(calls[4]).toMatchObject({ url: 'https://api.devin.ai/v3/organizations/org-1/sessions/devin-x/messages', method: 'POST' })
  })

  it('maps statuses, messages and config', () => {
    expect(uiStatus({ status: 'running', status_detail: 'waiting_for_user' })).toBe('blocked')
    expect(uiStatus({ status: 'running', status_detail: 'working' })).toBe('running')
    expect(uiStatus({ status: 'suspended', status_detail: 'inactivity' })).toBe('sleeping')
    expect(uiStatus({ status: 'error' })).toBe('failed')
    expect(cleanMessage('see <ref_snippet file="/a/b/c.ts" lines="3-9" /> now')).toBe('see `c.ts:3-9` now')
    expect(cleanMessage('Done.\nATTACHMENT:{"url":"https://x.dev/a/demo.mp4","fileSize":5}')).toBe('Done.\n[demo.mp4](https://x.dev/a/demo.mp4)')
    expect(cleanMessage('ATTACHMENT:"https://x.dev/a/shot%201.png"')).toBe('[shot 1.png](https://x.dev/a/shot%201.png)')

    const events = eventsFromMessages(
      [
        { event_id: 'u', created_at: 100, message: 'go', source: 'user' },
        { event_id: 'd', created_at: 145, message: 'done', source: 'devin' },
      ],
      { running: true, now: 160 },
    )
    expect(events.map((e) => e.kind)).toEqual(['user', 'work', 'devin', 'work'])
    expect(events[1]).toMatchObject({ seconds: 45 })
    expect(events[3]).toMatchObject({ active: true, seconds: 15 })

    const s = sessionFromApi({ session_id: 'devin-1', title: null, status: 'running', status_detail: 'working', created_at: 0, updated_at: 0, url: 'u', acus_consumed: 1.26, pull_requests: [{ pr_url: 'https://github.com/acme/web/pull/3', pr_state: 'open' }], tags: [], parent_session_id: 'devin-0' })
    expect(s).toMatchObject({ id: '1', title: 'Untitled session', repo: 'acme/web', acus: 1.3, live: { parentId: '0' } })

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-tui-'))
    const file = path.join(dir, 'config.json')
    fs.writeFileSync(file, JSON.stringify({ apiKey: 'file-key', orgId: 'org-file' }))
    expect(loadConfig({}, file)).toMatchObject({ apiKey: 'file-key', orgId: 'org-file' })
    expect(loadConfig({ DEVIN_API_KEY: 'env-key' }, file)).toMatchObject({ apiKey: 'env-key', orgId: 'org-file' })
    expect(loadConfig({}, path.join(dir, 'missing.json'))).toBeNull()

    expect(resolveTheme(undefined, 'theme = GitHub Light High Contrast\n')).toBe('light')
    expect(resolveTheme(undefined, 'theme = GitHub Dark High Contrast\n')).toBe('dark')
    expect(resolveTheme('light', 'theme = GitHub Dark High Contrast')).toBe('light')
  })
})
