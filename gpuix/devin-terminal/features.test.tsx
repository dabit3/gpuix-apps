import { describe, expect, it } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { DevinApp } from './src/App'
import { DevinClient, type ApiAutomation, type ApiNote, type ApiPlaybook, type ApiSession, type CreateSessionOpts, type DevinApi } from './src/api'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(check: () => boolean, what: string, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (check()) return
    await sleep(60)
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('Devin API client: settings endpoints', () => {
  it('sends automation, knowledge, playbook and session-action requests with the right shapes', async () => {
    const calls: { url: string; method: string; body?: any }[] = []
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const empty = init?.method === 'DELETE' && url.includes('/automations/')
      return new Response(empty ? '' : JSON.stringify({ items: [], has_next_page: false, templates: [] }), { status: 200 })
    }) as unknown as typeof fetch
    const c = new DevinClient({ apiKey: 'tok', orgId: 'org-1', fetch: fake })
    const base = 'https://api.devin.ai/v3/organizations/org-1'
    await c.createSession('Ship it', { mode: 'lite', playbookId: 'pb-1', sessionLinks: ['https://app.devin.ai/sessions/p1'] })
    expect(calls.at(-1)).toMatchObject({ url: `${base}/sessions`, method: 'POST', body: { prompt: 'Ship it', devin_mode: 'lite', playbook_id: 'pb-1', session_links: ['https://app.devin.ai/sessions/p1'] } })
    await c.archiveSession('abc')
    expect(calls.at(-1)).toMatchObject({ url: `${base}/sessions/abc/archive`, method: 'POST' })
    await c.terminateSession('abc')
    expect(calls.at(-1)).toMatchObject({ url: `${base}/sessions/abc`, method: 'DELETE' })
    await c.createAutomation({ name: 'Digest', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', prompt: 'Summarize' })
    const auto = calls.at(-1)!
    expect(auto).toMatchObject({ url: `${base}/automations`, method: 'POST' })
    expect(auto.body.triggers[0].conditions.any[0].all[0]).toEqual({ field: 'rrule', operator: 'recurrence', value: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' })
    expect(auto.body.actions).toEqual([{ type: 'start_session', prompt: 'Summarize' }])
    await c.setAutomationEnabled('a1', false)
    expect(calls.at(-1)).toMatchObject({ url: `${base}/automations/a1`, method: 'PATCH', body: { enabled: false } })
    expect(await c.deleteAutomation('a1')).toEqual({})
    const note = { note_id: 'n1', name: 'Style', body: 'Use tabs', trigger: 'When editing', pinned_repo: null } as ApiNote
    await c.setNoteEnabled(note, false)
    expect(calls.at(-1)).toMatchObject({ url: `${base}/knowledge/notes/n1`, method: 'PUT', body: { name: 'Style', body: 'Use tabs', trigger: 'When editing', is_enabled: false } })
    await c.listNotes('tabs')
    expect(calls.at(-1)!.url).toBe(`${base}/knowledge/notes?search=tabs&first=100`)
  })
})

describeNative('devin-terminal features', () => {
  it('drives automations, security, customize, notifications, session menu and API key settings against a fake API', async () => {
    const now = Date.now() / 1000
    const base = { created_at: now - 900, updated_at: now - 120, acus_consumed: 1, devin_mode: 'normal', tags: [], parent_session_id: null }
    const sessions: ApiSession[] = [
      { ...base, session_id: 'aaa', title: 'Fix flaky checkout test', status: 'running', status_detail: 'waiting_for_user', url: 'https://app.devin.ai/sessions/aaa', pull_requests: [{ pr_url: 'https://github.com/acme/web/pull/7', pr_state: 'open' }] },
      { ...base, session_id: 'bbb', title: 'Bump React to 19', status: 'exit', status_detail: 'finished', url: 'https://app.devin.ai/sessions/bbb', pull_requests: [{ pr_url: 'https://github.com/acme/web/pull/8', pr_state: 'merged' }] },
    ]
    const automations: ApiAutomation[] = [
      { automation_id: 'a1', name: 'Nightly triage', enabled: true, triggers: [{ event_type: 'schedule:recurring', conditions: { any: [{ all: [{ field: 'rrule', operator: 'recurrence', value: 'FREQ=DAILY;BYHOUR=13;BYMINUTE=0' }] }] } }], actions: [{ type: 'start_session', prompt: 'Triage new issues' }], created_at: now - 9000, updated_at: now - 900 },
    ]
    const playbooks: ApiPlaybook[] = [{ playbook_id: 'pb1', title: 'Release checklist', body: 'Tag, changelog, publish', macro: '!release', access_type: 'org', created_at: now, updated_at: now }]
    const notes: ApiNote[] = [{ note_id: 'n1', name: 'Use pnpm', body: 'Always pnpm', trigger: 'Installing deps', folder_path: '', is_enabled: true, pinned_repo: null, access_type: 'org', created_at: now, updated_at: now }]
    const log: string[] = []
    const created: { prompt: string; opts?: CreateSessionOpts }[] = []
    const client: DevinApi = {
      listSessions: async () => ({ items: sessions, hasMore: false }),
      getSession: async (id) => sessions.find((s) => s.session_id === id.replace(/^devin-/, ''))!,
      listMessages: async () => [],
      createSession: async (prompt, opts) => {
        created.push({ prompt, opts })
        return { ...base, session_id: 'ccc', title: 'Ship it', status: 'running', status_detail: 'working', url: 'https://app.devin.ai/sessions/ccc', pull_requests: [] }
      },
      sendMessage: async () => ({}),
      archiveSession: async (id) => (log.push(`archive:${id}`), {}),
      terminateSession: async (id) => (log.push(`terminate:${id}`), {}),
      listAutomations: async () => automations,
      listTemplates: async () => [],
      createAutomation: async (a) => {
        log.push(`create-automation:${a.name}:${a.rrule}:${a.prompt}`)
        const made = { ...automations[0]!, automation_id: 'a2', name: a.name, actions: [{ type: 'start_session', prompt: a.prompt }] }
        automations.push(made)
        return made
      },
      setAutomationEnabled: async (id, enabled) => (log.push(`automation-enabled:${id}:${enabled}`), { ...automations[0]!, enabled }),
      deleteAutomation: async (id) => (log.push(`delete-automation:${id}`), {}),
      listPlaybooks: async () => playbooks,
      listNotes: async () => notes,
      setNoteEnabled: async (n, enabled) => (log.push(`note-enabled:${n.note_id}:${enabled}`), { ...n, is_enabled: enabled }),
      listSecrets: async () => [{ secret_id: 's1', key: 'GITHUB_TOKEN', secret_type: 'key-value', note: 'CI bot' }],
    }
    const saved: { apiKey: string; orgId: string }[] = []
    const { render, renderer } = createTestRoot({ width: 1440, height: 900 })
    render(<DevinApp client={client} pollMs={200} orgId="org-test" keyHint="cog_…1234" keySource="env" verifyKey={async () => ({})} onSaveKey={async (k) => (saved.push(k), 'keychain')} />)
    const app = await connectTest(renderer)
    const text = () => renderer.getAllText().join(' ')
    await until(() => text().includes('Fix flaky checkout test'), 'sessions')

    // Automations: list, pause, create, delete.
    await app.getByTestId('nav-automations').click()
    await until(() => text().includes('Nightly triage') && text().includes('Daily at 13:00 UTC'), 'automation list')
    await app.getByTestId('automation-toggle-a1').click()
    await until(() => log.includes('automation-enabled:a1:false'), 'pause automation')
    await app.getByTestId('automation-new').click()
    await app.getByTestId('automation-name').fill('Weekly digest')
    await app.getByTestId('automation-prompt').fill('Summarize merged PRs')
    await app.getByTestId('automation-create').click()
    await until(() => log.some((l) => l.startsWith('create-automation:Weekly digest:FREQ=WEEKLY')), 'create automation')
    await until(() => text().includes('Weekly digest'), 'new automation listed')
    await app.getByTestId('automation-delete-a2').click()
    await app.getByTestId('automation-delete-a2').click()
    await until(() => log.includes('delete-automation:a2'), 'delete automation')

    // Security: PR stats from sessions + secret names only.
    await app.getByTestId('nav-security').click()
    await until(() => text().includes('GITHUB_TOKEN'), 'secrets')
    expect(await app.getByTestId('stat-total').textContent()).toBe('2')
    expect(await app.getByTestId('stat-merged').textContent()).toBe('1')

    // Customize: toggle a knowledge note, then use a playbook in a new session.
    await app.getByTestId('nav-customize').click()
    await until(() => text().includes('Release checklist'), 'playbooks')
    await app.getByTestId('customize-tab-knowledge').click()
    await until(() => text().includes('Use pnpm'), 'notes')
    await app.getByTestId('note-toggle-n1').click()
    await until(() => log.includes('note-enabled:n1:false'), 'note toggle')
    await app.getByTestId('customize-tab-playbooks').click()
    await until(() => text().includes('Release checklist'), 'playbooks again')
    await app.getByTestId('playbook-pb1').click()
    expect(await app.getByTestId('playbook-body-pb1').count()).toBe(1)
    await app.getByTestId('theme-toggle').click()
    await sleep(200)
    expect(await app.getByTestId('playbook-body-pb1').count()).toBe(1)
    await app.getByTestId('theme-toggle').click()
    await sleep(200)
    expect(await app.getByTestId('playbook-body-pb1').count()).toBe(1)
    await app.getByTestId('playbook-use-pb1').click()
    await until(() => text().includes('Playbook · Release checklist'), 'playbook chip')
    await app.getByTestId('composer').fill('Ship it')
    await app.getByTestId('send').click()
    await until(() => created.length === 1, 'session created')
    expect(created[0]!.opts?.playbookId).toBe('pb1')

    // Notifications from real session state; mark all read clears the bell.
    await app.getByTestId('bell').click()
    await until(() => text().includes('Bump React to 19'), 'notifications')
    await app.getByTestId('notifications-read').click()

    // Session menu: archive removes the session.
    await app.getByTestId('session-aaa').click()
    await until(() => text().includes('Fix flaky checkout test'), 'select session')
    await app.getByTestId('session-menu').click()
    await app.getByTestId('session-menu-archive').click()
    await until(() => log.includes('archive:aaa'), 'archive call')
    await until(() => !text().includes('Fix flaky checkout test'), 'session removed')

    // Settings → Devin API: env var notice, masked token entry, verify + save.
    await app.getByTestId('settings').click()
    await app.getByTestId('settings-nav-api').click()
    expect(await app.getByTestId('api-key-source').textContent()).toContain('Environment variable')
    expect(await app.getByTestId('api-key-hint').textContent()).toBe('cog_…1234')
    await app.getByTestId('api-org-input').fill('org-new')
    await app.getByTestId('api-key-input').fill('cog_test_token_123')
    expect(await app.getByTestId('api-key-input-mask').textContent()).toBe('•'.repeat(18))
    await app.getByTestId('api-key-save').click()
    await until(() => saved.length === 1, 'save key')
    expect(saved[0]).toEqual({ apiKey: 'cog_test_token_123', orgId: 'org-new' })
    await until(() => text().includes('Saved to the macOS Keychain'), 'saved notice')
  }, 60_000)
})
