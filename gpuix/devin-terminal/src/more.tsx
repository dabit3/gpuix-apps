// Pages from the v3 API that the first rounds didn't cover: the full sessions table (with archived), usage metrics, repositories, scan findings, and per-session tags and insights.
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from './icons'
import { C } from './theme'
import { timeAgo, type ApiFinding, type ApiInsights, type ApiPrMetrics, type ApiRepo, type ApiSession, type ApiSessionMetrics, type DevinApi } from './api'
import { STATUS_COLOR, type Session } from './data'
import { Btn, Card, Divider, Empty, Field, Notice, openUrl, Page, Pills, row, col, SANS, Stat, T, useApiList, useSticky, WEB } from './views'

export type SessionsFilter = 'all' | 'active' | 'waiting' | 'prs' | 'archived'

/** Short state label like the web app's sessions table ("PR is ready", "Waiting on you"). */
export function stateLabel(s: Session): { text: string; color: string } {
  const prs = s.live?.prs ?? []
  if (s.status === 'blocked') return { text: s.live?.statusDetail === 'waiting_for_approval' ? 'Approve next step' : 'Waiting on you', color: C.orange }
  if (s.status === 'running') return { text: 'Working', color: C.accent }
  if (prs.some((p) => (p.state ?? 'open') === 'open')) return { text: 'PR is ready', color: C.add }
  if (prs.some((p) => p.state === 'merged')) return { text: 'Merged', color: C.add }
  if (s.status === 'failed') return { text: 'Errored', color: C.del }
  if (s.status === 'finished') return { text: 'Finished', color: C.tertiary }
  return { text: 'Sleeping', color: C.tertiary }
}

export function filterAll(sessions: Session[], filter: SessionsFilter, q: string): Session[] {
  const query = q.trim().toLowerCase()
  return sessions.filter((s) => {
    if (query && !s.title.toLowerCase().includes(query) && !s.repo.toLowerCase().includes(query)) return false
    if (filter === 'active') return s.status === 'running' || s.status === 'blocked'
    if (filter === 'waiting') return s.status === 'blocked'
    if (filter === 'prs') return (s.live?.prs.length ?? 0) > 0
    return true
  })
}

const PAGE = 120
const ARCHIVED_MAX = 300

export function SessionsView({ sessions, api, fromApi, onOpen, onUnarchived, initialFilter, narrow }: { sessions: Session[]; api: DevinApi | null; fromApi: (s: ApiSession) => Session; onOpen: (id: string) => void; onUnarchived: (s: Session) => void; initialFilter?: SessionsFilter; narrow?: boolean }) {
  const [filter, setFilter] = useSticky<SessionsFilter>('sessions-filter', initialFilter ?? 'all')
  const [q, setQ] = useSticky('sessions-q', '')
  const [limit, setLimit] = useState(PAGE)
  const [toast, setToast] = useState<string | null>(null)
  const archived = useApiList<Session>(filter === 'archived' && api?.listArchived ? async () => (await api.listArchived!(ARCHIVED_MAX)).map(fromApi) : undefined, [api, filter === 'archived'])
  const source = filter === 'archived' ? (archived.items ?? []) : sessions
  const rows = useMemo(() => filterAll(source, filter === 'archived' ? 'all' : filter, q), [source, filter, q])
  const count = (f: SessionsFilter) => filterAll(sessions, f, '').length
  const unarchive = (s: Session) => {
    if (!api?.unarchiveSession) return
    api
      .unarchiveSession(s.id)
      .then((back) => {
        archived.setItems((list) => (list ?? []).filter((x) => x.id !== s.id))
        onUnarchived(fromApi(back))
        setToast(`Restored “${s.title}”`)
      })
      .catch((e: Error) => setToast(e.message))
  }
  return (
    <Page testId="view-sessions" narrow={narrow} title="Sessions" subtitle="Every session in your organization, newest activity first." actions={<Btn icon="share" label="Open on web" onClick={() => openUrl(`${WEB}/sessions`)} />}>
      <div style={row({ gap: 10, flexWrap: 'wrap' })}>
        <div style={{ flexGrow: 1, minWidth: 220 }}>
          <Field testId="sessions-search" value={q} onChange={(v) => (setQ(v), setLimit(PAGE))} placeholder="Search sessions…" />
        </div>
      </div>
      <Pills
        testId="sessions-filter"
        value={filter}
        onChange={(v) => (setFilter(v), setLimit(PAGE))}
        items={[
          { value: 'all', label: 'All', count: sessions.length },
          { value: 'active', label: 'Active', count: count('active') },
          { value: 'waiting', label: 'Waiting on you', count: count('waiting') },
          { value: 'prs', label: 'With PRs', count: count('prs') },
          { value: 'archived', label: 'Archived', count: filter === 'archived' && archived.items ? archived.items.length : undefined },
        ]}
      />
      {toast && <Notice text={toast} tone="ok" />}
      {filter === 'archived' && archived.items?.length === ARCHIVED_MAX && <T size={12} color={C.ghost}>{`Showing the ${ARCHIVED_MAX} most recently archived. Older ones are on app.devin.ai.`}</T>}
      {archived.error && <Notice text={archived.error} tone="error" />}
      <div testId="sessions-table" style={col({ gap: 0 })}>
        {rows.slice(0, limit).map((s) => {
          const st = stateLabel(s)
          const pr = s.live?.prs[0]
          return (
            <div key={s.id} testId={`srow-${s.id}`} onClick={() => filter !== 'archived' && onOpen(s.id)} style={{ ...row({ gap: 10 }), height: 40, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: filter === 'archived' ? 'default' : 'pointer', hover: { backgroundColor: C.hover } }}>
              <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: STATUS_COLOR[s.status], flexShrink: 0, pointerEvents: 'none' }} />
              <text style={{ fontFamily: SANS, fontSize: 13.5, color: C.text, fontWeight: 500, flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{s.title}</text>
              <text style={{ fontFamily: SANS, fontSize: 12.5, color: st.color, flexShrink: 0, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{st.text}</text>
              <div style={{ flexGrow: 1, pointerEvents: 'none' }} />
              {!narrow && s.repo && <text style={{ fontFamily: SANS, fontSize: 12, color: C.ghost, flexShrink: 0, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{s.repo}</text>}
              {pr && (
                <div style={{ ...row({ gap: 4 }), height: 22, paddingLeft: 7, paddingRight: 7, borderRadius: 11, borderWidth: 1, borderColor: C.border, flexShrink: 0, pointerEvents: 'none' }}>
                  <Icon name={pr.state === 'merged' ? 'merge' : 'pr'} size={11} color={C.add} />
                  <text style={{ fontFamily: SANS, fontSize: 11.5, color: C.add }}>{`#${pr.url.split('/').pop()}${(s.live?.prs.length ?? 0) > 1 ? ` +${s.live!.prs.length - 1}` : ''}`}</text>
                </div>
              )}
              <text style={{ fontFamily: SANS, fontSize: 12, color: C.ghost, width: 92, flexShrink: 0, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{s.updated}</text>
              {filter === 'archived' && <Btn small icon="retry" label="Unarchive" testId={`unarchive-${s.id}`} onClick={() => unarchive(s)} />}
            </div>
          )
        })}
        {filter === 'archived' && archived.items === null && !archived.error && <Empty text="Loading archived sessions…" />}
        {rows.length === 0 && (filter !== 'archived' || archived.items) && <Empty text={q ? 'No sessions match' : 'Nothing here'} />}
      </div>
      {rows.length > limit && <Btn label={`Show more · ${rows.length - limit} left`} testId="sessions-more" onClick={() => setLimit((n) => n + PAGE)} />}
    </Page>
  )
}

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const

function Bars({ items, testId }: { items: { label: string; value: number }[]; testId: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div testId={testId} style={col({ gap: 6 })}>
      {items.map((i) => (
        <div key={i.label} style={row({ gap: 10 })}>
          <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.tertiary, width: 92, flexShrink: 0 }}>{i.label}</text>
          <div style={{ flexGrow: 1, height: 8, borderRadius: 4, backgroundColor: C.hover }}>
            <div style={{ width: `${Math.max(i.value ? 2 : 0, (i.value / max) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: C.accent }} />
          </div>
          <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.text, width: 44, flexShrink: 0 }}>{String(i.value)}</text>
        </div>
      ))}
    </div>
  )
}

export function UsageView({ api, narrow, now = () => Date.now() }: { api: DevinApi | null; narrow?: boolean; now?: () => number }) {
  const [range, setRange] = useSticky<'7' | '30' | '90'>('usage-range', '30')
  const [data, setData] = useState<{ s: ApiSessionMetrics; p: ApiPrMetrics; acus: { date: number; acus: number }[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!api?.sessionMetrics || !api.prMetrics) return
    let alive = true
    const before = Math.floor(now() / 1000)
    const after = before - Number(range) * 86400
    setData(null)
    Promise.all([api.sessionMetrics(after, before), api.prMetrics(after, before), api.consumption ? api.consumption(after, before) : Promise.resolve(null)])
      .then(([s, p, c]) => alive && (setData({ s, p, acus: c?.consumption_by_date ?? [], total: c?.total_acus ?? 0 }), setError(null)))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [api, range])
  const origins = Object.entries(data?.s.sessions_created_by_origin ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: k === 'webapp' ? 'Web app' : k === 'api' ? 'API' : k[0]!.toUpperCase() + k.slice(1).replace('_', ' '), value: v }))
  return (
    <Page testId="view-usage" narrow={narrow} title="Usage" subtitle="Sessions and pull requests across your organization." actions={<Btn icon="share" label="Billing on web" onClick={() => openUrl(`${WEB}/settings/usage`)} />}>
      <Pills testId="usage-range" value={range} onChange={setRange} items={RANGES.map((r) => ({ ...r }))} />
      {error && <Notice text={error} tone="error" />}
      {!api && <Empty text="Connect a Devin API key to see usage" />}
      {api && !data && !error && <Empty text="Loading…" />}
      {data && (
        <>
          <div style={row({ gap: 10, flexWrap: 'wrap' })}>
            <Stat testId="usage-sessions" label="Sessions created" value={data.s.sessions_created_count ?? 0} />
            <Stat testId="usage-merged-sessions" label="Sessions with merged PRs" value={data.s.sessions_with_merged_prs_count ?? 0} />
            <Stat testId="usage-playbooks" label="Started from a playbook" value={data.s.sessions_created_with_playbook_count ?? 0} />
          </div>
          <div style={row({ gap: 10, flexWrap: 'wrap' })}>
            <Stat testId="usage-prs-created" label="PRs created" value={data.p.prs_created_count ?? 0} />
            <Stat testId="usage-prs-merged" label="Merged" value={data.p.prs_merged_count ?? 0} />
            <Stat testId="usage-prs-open" label="Still open" value={data.p.prs_opened_count ?? 0} />
            <Stat testId="usage-prs-closed" label="Closed" value={data.p.prs_closed_count ?? 0} />
          </div>
          <T size={12.5} color={C.tertiary}>{`Merge rate ${data.p.prs_created_count ? Math.round(((data.p.prs_merged_count ?? 0) / data.p.prs_created_count) * 100) : 0}% · ${data.p.prs_taken_over_count ?? 0} PRs taken over by a human`}</T>
          <Divider />
          <T weight={600}>Where sessions start</T>
          {origins.length ? <Bars testId="usage-origins" items={origins} /> : <Empty text="No sessions in this range" />}
          {data.total > 0 && (
            <>
              <Divider />
              <T weight={600}>{`ACUs · ${Math.round(data.total * 10) / 10}`}</T>
              <Bars testId="usage-acus" items={data.acus.slice(-14).map((d) => ({ label: new Date(d.date * 1000).toISOString().slice(5, 10), value: Math.round(d.acus * 10) / 10 }))} />
            </>
          )}
        </>
      )}
    </Page>
  )
}

export function indexState(r: ApiRepo): { text: string; color: string } {
  const st = r.indexing_status
  if (!st || !st.indexing_enabled) return { text: 'Not indexed', color: C.ghost }
  if (st.latest_completed_wiki_index_job || st.latest_completed_search_index_job) return { text: 'Indexed', color: C.add }
  return { text: 'Indexing', color: C.orange }
}

export function ReposView({ api, onStart, narrow }: { api: DevinApi | null; onStart: (repo: string) => void; narrow?: boolean }) {
  const [q, setQ] = useSticky('repos-q', '')
  const [query, setQuery] = useState(q)
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300)
    return () => clearTimeout(t)
  }, [q])
  const repos = useApiList<ApiRepo>(api?.listRepositories ? () => api.listRepositories!(query) : undefined, [api, query])
  return (
    <Page testId="view-repos" narrow={narrow} title="Repositories" subtitle="Repositories Devin can work in, with their DeepWiki and search indexing." actions={<Btn icon="share" label="Manage on web" onClick={() => openUrl(`${WEB}/settings/repositories`)} />}>
      <Field testId="repos-search" value={q} onChange={setQ} placeholder="Filter by name…" />
      {repos.error && <Notice text={repos.error} tone="error" />}
      <div testId="repo-list" style={col({ gap: 0 })}>
        {(repos.items ?? []).map((r) => {
          const ix = indexState(r)
          return (
            <div key={r.repo_path} testId={`repo-${r.repo_path}`} style={{ ...row({ gap: 10 }), minHeight: 46, paddingLeft: 10, paddingRight: 10, borderRadius: 8, hover: { backgroundColor: C.hover } }}>
              <Icon name="folder" size={14} color={C.tertiary} />
              <div style={col({ gap: 1, flexGrow: 1, minWidth: 0 })}>
                <T size={13.5} weight={500} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.repo_path}</T>
                {r.repo_description && <T size={12} color={C.ghost} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.repo_description}</T>}
              </div>
              {!narrow && r.repo_language && <T size={12} color={C.tertiary} style={{ flexShrink: 0 }}>{r.repo_language}</T>}
              <T size={12} color={ix.color} style={{ flexShrink: 0, width: 78 }}>{ix.text}</T>
              <Btn small icon="plus" label="New session" testId={`repo-start-${r.repo_path}`} onClick={() => onStart(r.repo_path)} />
            </div>
          )
        })}
        {repos.items === null && !repos.error && api && <Empty text="Loading repositories…" />}
        {repos.items?.length === 0 && <Empty text={api ? (query ? 'No repositories match' : 'No repositories connected') : 'Connect a Devin API key to list repositories'} />}
      </div>
    </Page>
  )
}

const SEV: Record<string, string> = { critical: '#ff6a69', high: '#ff9492', medium: '#f0b72f', low: '#71b7ff' }

export function FindingsList({ api }: { api: DevinApi | null }) {
  const findings = useApiList<ApiFinding>(api?.listFindings?.bind(api), [api])
  if (!api?.listFindings) return null
  return (
    <div style={col({ gap: 8 })}>
      <T weight={600}>{`Scan findings${findings.items ? ` · ${findings.items.length}` : ''}`}</T>
      {findings.error && <Notice text={findings.error} tone="error" />}
      <div testId="finding-list" style={col({ gap: 6 })}>
        {(findings.items ?? []).slice(0, 25).map((f) => (
          <div key={f.finding_id} testId={`finding-${f.finding_id}`} onClick={() => openUrl(f.pr_url ?? (f.session_id ? `${WEB}/sessions/${f.session_id.replace(/^devin-/, '')}` : `${WEB}/security`))} style={{ ...row({ gap: 10 }), minHeight: 36, paddingLeft: 12, paddingRight: 12, borderRadius: 8, backgroundColor: C.hover, cursor: 'pointer' }}>
            <text style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: SEV[(f.severity ?? '').toLowerCase()] ?? C.tertiary, width: 58, flexShrink: 0, pointerEvents: 'none' }}>{(f.severity ?? '—').toUpperCase()}</text>
            <text style={{ fontFamily: SANS, fontSize: 13, color: C.text, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{f.title}</text>
            <text style={{ fontFamily: SANS, fontSize: 12, color: C.ghost, flexShrink: 0, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{[f.repo_name, f.status].filter(Boolean).join(' · ')}</text>
          </div>
        ))}
        {findings.items === null && !findings.error && <Empty text="Loading findings…" />}
        {findings.items?.length === 0 && <Empty text="No findings" />}
      </div>
    </div>
  )
}

const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Tags you can edit, plus Devin's own analysis of the session (GET/POST …/insights). */
export function SessionExtras({ session, client }: { session: Session; client: DevinApi | null }) {
  const [tags, setTags] = useState<string[]>(session.live?.tags ?? [])
  const [draft, setDraft] = useState('')
  const [ins, setIns] = useState<ApiInsights | null>(null)
  const [msg, setMsg] = useState<{ text: string; tone?: 'error' | 'ok' } | null>(null)
  const [generating, setGenerating] = useState(false)
  useEffect(() => setTags(session.live?.tags ?? []), [session.id, (session.live?.tags ?? []).join(',')])
  useEffect(() => {
    if (!client?.getInsights) return
    let alive = true
    client.getInsights(session.id).then((r) => alive && setIns(r)).catch(() => {})
    return () => {
      alive = false
    }
  }, [client, session.id])
  useEffect(() => {
    if (!generating || !client?.getInsights) return
    const t = setInterval(() => {
      client.getInsights!(session.id).then((r) => {
        setIns(r)
        if (r.analysis_status !== 'started') setGenerating(false)
      })
    }, 4000)
    return () => clearInterval(t)
  }, [generating, client, session.id])
  const save = (next: string[]) => {
    if (!client?.setTags) return
    const prev = tags
    setTags(next)
    client
      .setTags(session.id, next)
      .then((r) => (setTags(r), setMsg({ text: 'Tags saved', tone: 'ok' })))
      .catch((e: Error) => (setTags(prev), setMsg({ text: e.message, tone: 'error' })))
  }
  const add = () => {
    const t = draft.trim()
    if (!t || tags.includes(t)) return setDraft('')
    setDraft('')
    save([...tags, t])
  }
  const generate = () => {
    if (!client?.generateInsights) return
    setGenerating(true)
    client.generateInsights(session.id).catch((e: Error) => (setGenerating(false), setMsg({ text: e.message, tone: 'error' })))
  }
  const a = ins?.analysis
  return (
    <div style={col({ gap: 10, paddingTop: 14 })}>
      <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5 }}>Tags</text>
      <div testId="tag-list" style={row({ gap: 6, flexWrap: 'wrap' })}>
        {tags.map((t) => (
          <div key={t} testId={`tag-${t}`} style={{ ...row({ gap: 5 }), height: 24, paddingLeft: 9, paddingRight: 5, borderRadius: 12, backgroundColor: C.chip }}>
            <text style={{ fontFamily: SANS, fontSize: 12, color: C.chipText }}>{t}</text>
            <div testId={`tag-remove-${t}`} onClick={() => save(tags.filter((x) => x !== t))} style={{ ...row({ justifyContent: 'center' }), width: 16, height: 16, borderRadius: 8, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
              <text style={{ fontFamily: SANS, fontSize: 12, color: C.tertiary, pointerEvents: 'none' }}>×</text>
            </div>
          </div>
        ))}
        {tags.length === 0 && <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.ghost }}>No tags</text>}
      </div>
      {client?.setTags && (
        <div style={row({ gap: 6 })}>
          <div style={{ flexGrow: 1 }}>
            <Field testId="tag-input" value={draft} onChange={setDraft} placeholder="Add a tag" />
          </div>
          <Btn small label="Add" testId="tag-add" disabled={!draft.trim()} onClick={add} />
        </div>
      )}
      {msg && <Notice text={msg.text} tone={msg.tone} />}
      {ins && (
        <Card testId="insights" style={{ gap: 8, marginTop: 6 }}>
          <div style={row({ gap: 8 })}>
            <Icon name="sparkle" size={13} color={C.accent} />
            <T weight={600} size={13}>Insights</T>
            <div style={{ flexGrow: 1 }} />
            {!a && <Btn small label={generating || ins.analysis_status === 'started' ? 'Analyzing…' : 'Analyze'} testId="insights-generate" disabled={generating} onClick={generate} />}
          </div>
          <T testId="insights-meta" size={12.5} color={C.tertiary}>
            {[ins.category && label(ins.category), ins.session_size && `Size ${ins.session_size.toUpperCase()}`, `${ins.num_user_messages ?? 0} from you · ${ins.num_devin_messages ?? 0} from Devin`, ins.origin && `via ${ins.origin}`].filter(Boolean).join(' · ')}
          </T>
          {a?.classification?.tools_and_frameworks?.length ? <T size={12.5} color={C.secondary}>{a.classification.tools_and_frameworks.slice(0, 6).join(', ')}</T> : null}
          {(a?.issues ?? []).slice(0, 4).map((i) => (
            <div key={i.id} style={row({ gap: 8, alignItems: 'flex-start' })}>
              <text style={{ fontFamily: SANS, fontSize: 12, color: i.impact === 'high' ? C.del : C.orange, width: 14 }}>●</text>
              <T size={12.5} style={{ flexShrink: 1 }}>{i.title}</T>
            </div>
          ))}
          {(a?.action_items ?? []).slice(0, 3).map((x) => (
            <T key={x.issue_id + x.action_item} size={12.5} color={C.secondary}>{`→ ${x.action_item}`}</T>
          ))}
          {a?.suggested_prompt?.suggested_prompt && (
            <>
              <T size={12} color={C.ghost}>Suggested prompt</T>
              <T size={12.5} color={C.secondary}>{a.suggested_prompt.suggested_prompt.slice(0, 400)}</T>
            </>
          )}
          {!a && ins.analysis_status !== 'started' && !generating && <T size={12} color={C.ghost}>No analysis yet. Analyze asks Devin to review how this session went.</T>}
        </Card>
      )}
    </div>
  )
}

export { timeAgo }
