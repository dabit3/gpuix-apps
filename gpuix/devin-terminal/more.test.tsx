import { describe, expect, it } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { DevinApp } from './src/App'
import { DevinClient, type ApiSession, type DevinApi } from './src/api'
import { reducer, type State } from './src/state'
import { sessionFromApi } from './src/live'
import { buildDuration, filterAll, indexState, stateLabel } from './src/more'
import { parseLog } from './src/api'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const now = Date.now() / 1000
const api = (id: string, title: string, extra: Partial<ApiSession> = {}): ApiSession => ({ session_id: id, title, status: 'running', status_detail: 'working', url: `https://app.devin.ai/sessions/${id}`, created_at: now - 600, updated_at: now - 5, acus_consumed: 1, devin_mode: 'normal', tags: [], parent_session_id: null, pull_requests: [], ...extra })

describe('archived sessions', () => {
  it('asks the API for unarchived sessions only and drops any archived ones it still returns', async () => {
    const urls: string[] = []
    const fake = (async (url: string) => {
      urls.push(url)
      const archived = url.includes('is_archived=true')
      return new Response(JSON.stringify({ items: archived ? [api('old', 'Old', { is_archived: true })] : [api('a', 'Live'), api('b', 'Gone', { is_archived: true })], has_next_page: false }))
    }) as unknown as typeof fetch
    const c = new DevinClient({ apiKey: 'tok', orgId: 'org-1', fetch: fake })
    const res = await c.listSessions(100)
    expect(urls[0]).toBe('https://api.devin.ai/v3/organizations/org-1/sessions?first=100&is_archived=false')
    expect(res.items.map((s) => s.session_id)).toEqual(['a'])
    const arch = await c.listArchived()
    expect(urls[1]).toContain('/sessions?is_archived=true&first=100')
    expect(arch.map((s) => s.session_id)).toEqual(['old'])
  })

  it('prunes sessions archived elsewhere but keeps the one you have open, and unhide lets a restored one back', () => {
    const s = (id: string) => sessionFromApi(api(id, id))
    const base: State = { sessions: [s('a'), s('b'), s('c')], selectedId: 'c', search: '', mode: 'normal', panelOpen: true, panelTab: 'computer', repo: '', hidden: ['z'] }
    const pruned = reducer(base, { type: 'prune', ids: ['b', 'c'] })
    expect(pruned.sessions.map((x) => x.id)).toEqual(['a', 'c'])
    expect(reducer(base, { type: 'prune', ids: ['q'] })).toBe(base)
    expect(reducer(base, { type: 'unhide', id: 'z' }).hidden).toEqual([])
  })
})

describe('sessions table helpers', () => {
  it('labels and filters sessions like the web app table', () => {
    const pr = sessionFromApi(api('p', 'PR one', { status: 'suspended', status_detail: 'inactivity', pull_requests: [{ pr_url: 'https://github.com/o/r/pull/7', pr_state: 'open' }] }))
    const wait = sessionFromApi(api('w', 'Needs me', { status_detail: 'waiting_for_user' }))
    const run = sessionFromApi(api('r', 'Busy'))
    expect(stateLabel(pr).text).toBe('PR is ready')
    expect(stateLabel(wait).text).toBe('Waiting on you')
    expect(stateLabel(run).text).toBe('Working')
    const all = [pr, wait, run]
    expect(filterAll(all, 'active', '').map((s) => s.id)).toEqual(['w', 'r'])
    expect(filterAll(all, 'waiting', '').map((s) => s.id)).toEqual(['w'])
    expect(filterAll(all, 'prs', '').map((s) => s.id)).toEqual(['p'])
    expect(filterAll(all, 'all', 'busy').map((s) => s.id)).toEqual(['r'])
    expect(indexState({ repo_path: 'o/r', repo_name: 'r', indexing_status: { indexing_enabled: true, latest_completed_wiki_index_job: { id: 1 } } }).text).toBe('Indexed')
    expect(indexState({ repo_path: 'o/r', repo_name: 'r', indexing_status: { indexing_enabled: false } }).text).toBe('Not indexed')
  })
})

describe('environment and Devin Review', () => {
  it('parses JSONL build logs, skipping junk, and formats build durations', () => {
    const lines = parseLog('{"ts":"2026-10-21T18:23:56Z","stream":"system","msg":"=== start ==="}\nnot json\n\n{"ts":"2026-10-21T18:24:00Z","stream":"stderr","msg":"boom"}\n')
    expect(lines).toEqual([
      { ts: '2026-10-21T18:23:56Z', stream: 'system', msg: '=== start ===' },
      { ts: '2026-10-21T18:24:00Z', stream: 'stderr', msg: 'boom' },
    ])
    expect(buildDuration({ build_id: 'b', status: 'succeeded', trigger: 'auto', created_at: 0, started_at: 100, completed_at: 350 })).toBe('4m 10s')
    expect(buildDuration({ build_id: 'b', status: 'pending', trigger: 'auto', created_at: 0 })).toBe('—')
  })

  it('fetches the log through its presigned URL and treats a PR with no review as null', async () => {
    const urls: string[] = []
    const fake = (async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.includes('/logs')) return Response.json({ url: 'https://s3.example/log.jsonl', expires_at: 1 })
      if (url.startsWith('https://s3.example')) return new Response('{"ts":"t","stream":"system","msg":"hi"}')
      if (url.includes('/pr-reviews?pr_url=') && url.includes('pull%2F1')) return new Response('missing', { status: 404 })
      if (url.includes('/pr-reviews')) return Response.json({ status: 'running', repo_path: 'github.com/o/r', pr_number: 2, commit_sha: 'abcdef1234', created_at: '2026-10-21T00:00:00Z' })
      return new Response('nope', { status: 500 })
    }) as unknown as typeof fetch
    const c = new DevinClient({ apiKey: 'tok', orgId: 'org-1', fetch: fake })
    expect(await c.buildLog('sbj-1')).toEqual([{ ts: 't', stream: 'system', msg: 'hi' }])
    expect(urls[0]).toBe('GET https://api.devin.ai/v3/organizations/org-1/snapshot-setup/builds/sbj-1/logs')
    expect(await c.prReview('https://github.com/o/r/pull/1')).toBeNull()
    expect((await c.runPrReview('https://github.com/o/r/pull/2')).status).toBe('running')
    expect(urls.at(-1)).toBe('POST https://api.devin.ai/v3/organizations/org-1/pr-reviews')
  })
})

describeNative('parity pages', () => {
  it('hides a session archived after launch, restores an archived one, and edits tags and shows insights', async () => {
    let archived = [api('old', 'Archived long ago', { status: 'suspended', status_detail: 'inactivity', is_archived: true })]
    let live = [api('aaa', 'Build the checkout page', { tags: ['web', 'urgent'] }), api('zzz', 'Soon archived')]
    const tagCalls: string[][] = []
    const unarchived: string[] = []
    const client: DevinApi = {
      listSessions: async () => ({ items: live, hasMore: false }),
      getSession: async (id) => live.find((s) => s.session_id === id) ?? live[0]!,
      listMessages: async () => [],
      createSession: async () => live[0]!,
      sendMessage: async () => ({}),
      listArchived: async () => archived,
      unarchiveSession: async (id) => {
        unarchived.push(id)
        const s = archived.find((x) => x.session_id === id)!
        archived = archived.filter((x) => x.session_id !== id)
        live = [...live, { ...s, is_archived: false }]
        return { ...s, is_archived: false }
      },
      setTags: async (_id, tags) => (tagCalls.push(tags), tags),
      getInsights: async (id) => ({ ...live.find((s) => s.session_id === id)!, category: 'feature_development', num_user_messages: 3, num_devin_messages: 9, analysis: null, analysis_status: null }),
    }
    const { render, renderer } = createTestRoot({ width: 1440, height: 900 })
    render(<DevinApp client={client} pollMs={150} />)
    const app = await connectTest(renderer)
    const has = async (id: string) => (await app.getByTestId(id).count()) === 1
    const textOf = (id: string) => app.getByTestId(id).textContent().catch(() => null)
    const until = async (check: () => Promise<boolean>, what: string, ms = 8000) => {
      const start = Date.now()
      while (!(await check())) {
        if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
        await sleep(80)
      }
    }
    await until(() => has('session-zzz'), 'zzz in sidebar')
    expect(await has('session-old')).toBe(false)
    // Archived on the web while the app runs.
    archived = [...archived, { ...live[1]!, is_archived: true }]
    live = [live[0]!]
    await until(async () => !(await has('session-zzz')), 'zzz pruned', 9000)

    await app.getByTestId('nav-more').click()
    await until(() => has('nav-more-sessions'), 'More menu')
    await app.getByTestId('nav-more-sessions').click()
    await until(() => has('view-sessions'), 'sessions page')
    await app.getByTestId('sessions-filter-archived').click()
    await until(() => has('srow-old'), 'archived row')
    await app.getByTestId('unarchive-old').click()
    await until(async () => unarchived.includes('old') && !(await has('srow-old')), 'unarchived')
    await until(() => has('session-old'), 'restored to sidebar')

    await app.getByTestId('sessions-filter-all').click()
    await until(() => has('srow-aaa'), 'aaa row')
    await app.getByTestId('srow-aaa').click()
    await until(() => has('tab-details'), 'session panel')
    await app.getByTestId('tab-details').click()
    await until(() => has('tag-urgent'), 'tags')
    await app.getByTestId('tag-remove-urgent').click()
    await until(async () => tagCalls.length === 1, 'setTags')
    expect(tagCalls[0]).toEqual(['web'])
    await until(async () => !(await has('tag-urgent')), 'tag removed')
    await until(async () => ((await textOf('insights-meta')) ?? '').includes('Feature development'), 'insights')
    expect(await textOf('insights-meta')).toContain('3 from you · 9 from Devin')
  }, 40000)
})
