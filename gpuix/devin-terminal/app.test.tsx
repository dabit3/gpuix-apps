import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { DevinApp } from './src/App'
import { C } from './src/theme'
import type { ApiMessage, ApiSession, DevinApi } from './src/api'

const SHOTS = path.join(import.meta.dir, 'test-screenshots')
fs.mkdirSync(SHOTS, { recursive: true })
const describeNative = hasNativeTestRenderer ? describe : describe.skip
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForText(app: Awaited<ReturnType<typeof connectTest>>, testId: string, expected: string, timeoutMs = 15_000) {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < timeoutMs) {
    last = (await app.getByTestId(testId).textContent().catch(() => null)) ?? ''
    if (last.includes(expected)) return last
    await sleep(100)
  }
  throw new Error(`${testId} never contained "${expected}" (last: "${last}")`)
}

describeNative('devin-terminal', () => {
  it('switches sessions, changes agent mode, and streams a new session to a finished PR', async () => {
    const { render, renderer } = createTestRoot({ width: 1440, height: 900 })
    render(<DevinApp speed={4} />)
    const app = await connectTest(renderer)

    expect(await app.getByTestId('session-title').textContent()).toBe('Move API rate limiting to Redis')
    expect(await app.getByTestId('session-count').textContent()).toBe('13 sessions · 1 running')
    expect(await app.getByTestId('tab-shell').count()).toBe(1)

    await app.getByTestId('session-s-index').click()
    expect(await app.getByTestId('session-title').textContent()).toBe('Slow billing dashboard query')
    expect(await app.getByTestId('session-status').textContent()).toBe('Awaiting input')

    await app.getByTestId('new-session').click()
    expect(await app.getByTestId('home-title').textContent()).toBe('Devin')

    await app.getByTestId('mode-picker').click()
    await app.getByTestId('mode-ultra').click()
    expect(await app.getByTestId('mode-picker-label').textContent()).toBe('Ultra')

    await app.getByTestId('composer').fill('Add dark mode to the settings page')
    await app.getByTestId('send').click()

    expect(await app.getByTestId('session-title').textContent()).toBe('Add dark mode to the settings page')
    expect(await app.getByTestId('session-mode').textContent()).toBe('Ultra')
    await waitForText(app, 'session-count', '14 sessions · 2 running')
    expect(await app.getByTestId('session-status').textContent()).toBe('Working')
    await app.screenshot({ path: path.join(SHOTS, 'running.png') })

    await waitForText(app, 'session-status', 'Finished', 20_000)
    await waitForText(app, 'checks-1301', 'All checks passed (3/3)')
    expect(await app.getByTestId('session-count').textContent()).toBe('14 sessions · 1 running')
    await app.screenshot({ path: path.join(SHOTS, 'finished.png') })

    await app.getByTestId('session-s-index').click()
    renderer.simulateKeystrokes('down')
    await waitForText(app, 'session-title', 'Add haptics to the onboarding flow')
    renderer.simulateKeystrokes('up')
    renderer.simulateKeystrokes('up')
    await waitForText(app, 'session-title', 'Fix flaky checkout e2e test')

    renderer.simulateKeystrokes('cmd-k')
    await sleep(100)
    renderer.simulateKeystrokes('t e r r a f o r m')
    await sleep(200)
    expect(renderer.getAllText().join(' ')).toContain('Upgrade Terraform AWS provider to v6')
    expect(renderer.getAllText().join(' ')).not.toContain('Move API rate limiting to Redis')
    renderer.simulateKeystrokes('escape')
    await sleep(150)
    expect(renderer.getAllText().join(' ')).toContain('Move API rate limiting to Redis')

    await app.getByTestId('search').fill('okta')
    expect(renderer.getAllText().join(' ')).toContain('Add SSO login with Okta')
    expect(renderer.getAllText().join(' ')).not.toContain('Upgrade Terraform AWS provider to v6')
  }, 60_000)
  it('reflows into a narrow split and starts the CLI prompt as a new session', async () => {
    const { render, renderer } = createTestRoot({ width: 700, height: 900 })
    render(<DevinApp speed={4} initialMode="ultra" initialPrompt="Add dark mode to the settings page" />)
    const app = await connectTest(renderer)

    await waitForText(app, 'session-title', 'Add dark mode to the settings page')
    expect(await app.getByTestId('session-mode').textContent()).toBe('Ultra')
    await waitForText(app, 'session-count', '2 running')
    expect(await app.getByTestId('tab-shell').count()).toBe(0)
    expect(await app.getByTestId('search').count()).toBe(1)

    await app.getByTestId('session-s-index').click()
    expect(await app.getByTestId('session-title').textContent()).toBe('Slow billing dashboard query')
  })

  it('live mode: lists real-shaped sessions, polls messages, sends, creates, and toggles light mode', async () => {
    const now = Date.now() / 1000
    const base = { created_at: now - 600, updated_at: now - 60, acus_consumed: 3.2, devin_mode: 'normal', tags: [] }
    const sessions: ApiSession[] = [
      { ...base, session_id: 'aaa', title: 'Fix login redirect loop', status: 'running', status_detail: 'working', url: 'https://app.devin.ai/sessions/aaa', pull_requests: [{ pr_url: 'https://github.com/acme/web/pull/12', pr_state: 'open' }], parent_session_id: null },
      { ...base, session_id: 'bbb', title: 'Write the regression test', status: 'running', status_detail: 'waiting_for_user', url: 'https://app.devin.ai/sessions/bbb', pull_requests: [], parent_session_id: 'aaa' },
    ]
    const messages: Record<string, ApiMessage[]> = {
      aaa: [
        { event_id: 'e1', created_at: now - 500, message: 'Fix the login redirect loop', source: 'user' },
        { event_id: 'e2', created_at: now - 470, message: 'On it. The loop comes from <ref_file file="/repo/src/auth.ts" />.', source: 'devin' },
      ],
    }
    const created: { prompt: string; mode?: string }[] = []
    const sent: { id: string; message: string }[] = []
    const client: DevinApi = {
      listSessions: async () => ({ items: sessions, hasMore: false }),
      getSession: async (id) => sessions.find((s) => s.session_id === id.replace(/^devin-/, ''))!,
      listMessages: async (id) => messages[id.replace(/^devin-/, '')] ?? [],
      createSession: async (prompt, opts) => {
        created.push({ prompt, mode: opts?.mode })
        const s: ApiSession = { ...base, session_id: 'devin-ccc', title: null, status: 'running', status_detail: 'working', url: 'https://app.devin.ai/sessions/ccc', pull_requests: [], parent_session_id: null }
        sessions.unshift({ ...s, session_id: 'ccc' })
        messages.ccc = [{ event_id: 'c1', created_at: Date.now() / 1000, message: prompt, source: 'user' }]
        return s
      },
      sendMessage: async (id, message) => {
        sent.push({ id, message })
        messages[id]!.push({ event_id: `u-${sent.length}`, created_at: Date.now() / 1000, message, source: 'user' })
        return {}
      },
    }
    const { render, renderer } = createTestRoot({ width: 1440, height: 900 })
    render(<DevinApp client={client} pollMs={150} />)
    const app = await connectTest(renderer)

    expect(await app.getByTestId('home-title').textContent()).toBe('Devin')
    await waitForText(app, 'session-count', '2 sessions · 1 running')
    // Children start collapsed under their parent; the chevron reveals the waiting child.
    expect(renderer.getAllText().join(' ')).not.toContain('Write the regression test')
    await app.getByTestId('expand-aaa').click()
    expect(renderer.getAllText().join(' ')).toContain('Waiting for you')
    await app.getByTestId('expand-aaa').click()
    expect(renderer.getAllText().join(' ')).not.toContain('Write the regression test')

    await app.getByTestId('session-aaa').click()
    await waitForText(app, 'session-title', 'Fix login redirect loop')
    await waitForText(app, 'status-line', 'Devin is working')
    const text = () => renderer.getAllText().join(' ')
    const until2 = async (count: () => Promise<number>, what: string) => {
      const start = Date.now()
      while ((await count()) === 0) {
        if (Date.now() - start > 8000) throw new Error(`timed out waiting for ${what}`)
        await sleep(100)
      }
    }
    const until = async (cond: () => boolean, what: string) => {
      const start = Date.now()
      while (!cond()) {
        if (Date.now() - start > 8000) throw new Error(`timed out waiting for ${what}; text: ${text().slice(-600)}`)
        await sleep(100)
      }
    }
    // <markdown> text isn't exposed to automation in 0.11.0, so assert the message element appears.
    await until2(() => app.getByTestId('msg-e2').count(), 'first devin message')
    expect(text()).toContain('Worked for 30s')

    messages.aaa!.push({ event_id: 'e3', created_at: now - 10, message: 'Pushed the fix and opened PR #12.', source: 'devin' })
    await until2(() => app.getByTestId('msg-e3').count(), 'polled devin message')

    await app.getByTestId('composer').fill('Also add a regression test')
    await app.getByTestId('send').click()
    await until(() => sent.length === 1, 'sendMessage')
    expect(sent[0]).toEqual({ id: 'aaa', message: 'Also add a regression test' })

    await app.getByTestId('new-session').click()
    await app.getByTestId('mode-picker').click()
    await app.getByTestId('mode-fast').click()
    await app.getByTestId('composer').fill('Summarize the README in three bullets')
    await app.getByTestId('send').click()
    await until(() => created.length === 1, 'createSession')
    expect(created[0]).toEqual({ prompt: 'Summarize the README in three bullets', mode: 'fast' })
    await waitForText(app, 'session-title', 'Summarize the README in three bullets')
    await waitForText(app, 'session-count', '3 sessions')
    await app.getByTestId('toggle-panel').count()
    expect(await app.getByTestId('tab-details').count()).toBe(1)

    expect(C.name).toBe('dark')
    await app.getByTestId('theme-toggle').click()
    await until(() => C.name === 'light', 'light theme')
    expect(await app.getByTestId('session-title').textContent()).toBe('Summarize the README in three bullets')
    await app.screenshot({ path: path.join(SHOTS, 'live-light.png') })
    await app.getByTestId('theme-toggle').click()
    await until(() => C.name === 'dark', 'dark theme')
  }, 60_000)
})
