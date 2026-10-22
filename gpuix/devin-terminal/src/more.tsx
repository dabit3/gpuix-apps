/** @jsxImportSource #zoom */
// Pages from the v3 API that the first rounds didn't cover: the full sessions table (with archived), usage metrics, repositories, scan findings, and per-session tags and insights.
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from './icons'
import { C } from './theme'
import { timeAgo, type ApiBlueprint, type ApiBuild, type ApiPrReview, type LogLine, type ApiFinding, type ApiInsights, type ApiPrMetrics, type ApiRepo, type ApiSession, type ApiSessionMetrics, type DevinApi } from './api'
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
            <div style={{ width: `${Math.max(i.value ? 2 : 0, (i.value / max) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: C.tertiary }} />
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

const SEV: Record<string, string> = { critical: '#f85149', high: '#f85149' }

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
          <div style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
            <Field testId="tag-input" value={draft} onChange={setDraft} placeholder="Add a tag" />
          </div>
          <Btn small label="Add" testId="tag-add" disabled={!draft.trim()} onClick={add} />
        </div>
      )}
      {msg && <Notice text={msg.text} tone={msg.tone} />}
      {ins && (
        <Card testId="insights" style={{ gap: 8, marginTop: 6 }}>
          <div style={row({ gap: 8 })}>
            <Icon name="sparkle" size={13} color={C.tertiary} />
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

export function buildDuration(b: ApiBuild): string {
  if (!b.started_at) return '—'
  const s = Math.max(0, (b.completed_at ?? Date.now() / 1000) - b.started_at)
  return s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

/** Environment snapshot builds and blueprints (Settings → Environment in the web app), with in-app build logs. */
export function EnvironmentView({ api, narrow }: { api: DevinApi | null; narrow?: boolean }) {
  const builds = useApiList<ApiBuild>(api?.listBuilds?.bind(api), [api])
  const blueprints = useApiList<ApiBlueprint>(api?.listBlueprints?.bind(api), [api])
  const [open, setOpen] = useSticky<string | null>('env-open', null)
  const [log, setLog] = useState<{ id: string; lines: LogLine[] | null; error?: string } | null>(null)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [msg, setMsg] = useState<{ text: string; tone?: 'error' | 'ok' } | null>(null)
  useEffect(() => {
    if (!open || !api?.buildLog || log?.id === open) return
    setLog({ id: open, lines: null })
    api
      .buildLog(open)
      .then((lines) => setLog({ id: open, lines }))
      .catch((e: Error) => setLog({ id: open, lines: [], error: e.message }))
  }, [open, api])
  const rebuild = () => {
    if (!api?.triggerBuild) return
    api
      .triggerBuild()
      .then((b) => (builds.setItems((l) => [b, ...(l ?? [])]), setMsg({ text: 'Build started', tone: 'ok' })))
      .catch((e: Error) => setMsg({ text: e.message, tone: 'error' }))
  }
  const shown = (log?.lines ?? []).filter((l) => !onlyErrors || l.stream === 'stderr' || /error|fail/i.test(l.msg))
  return (
    <Page testId="view-environment" narrow={narrow} title="Environment" subtitle="The machine image every Devin session boots from: snapshot builds and the blueprints behind them." actions={<div style={row({ gap: 8 })}><Btn icon="retry" label="Rebuild" testId="env-rebuild" onClick={rebuild} /><Btn icon="share" label="Edit on web" onClick={() => openUrl(`${WEB}/settings/environment`)} /></div>}>
      {msg && <Notice text={msg.text} tone={msg.tone} />}
      <T weight={600}>Builds</T>
      {builds.error && <Notice text={builds.error} tone="error" />}
      <div testId="build-list" style={col({ gap: 0 })}>
        {(builds.items ?? []).map((b) => (
          <div key={b.build_id} style={col({ gap: 0 })}>
            <div testId={`build-${b.build_id}`} onClick={() => setOpen(open === b.build_id ? null : b.build_id)} style={{ ...row({ gap: 10 }), height: 38, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: 'pointer', backgroundColor: open === b.build_id ? C.hover : 'rgba(0,0,0,0)', hover: { backgroundColor: C.hover } }}>
              <Icon name={open === b.build_id ? 'chevronDown' : 'chevronRight'} size={12} color={C.ghost} />
              <text style={{ fontFamily: SANS, fontSize: 13, color: b.status === 'failed' ? C.del : b.status === 'running' || b.status === 'pending' ? C.orange : C.text, width: 84, pointerEvents: 'none' }}>{b.status[0]!.toUpperCase() + b.status.slice(1)}</text>
              <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.tertiary, width: 64, pointerEvents: 'none' }}>{b.trigger === 'manual' ? 'Manual' : 'Auto'}</text>
              <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.tertiary, width: 70, pointerEvents: 'none' }}>{buildDuration(b)}</text>
              {!narrow && <text style={{ fontFamily: 'Menlo', fontSize: 11.5, color: C.ghost, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{b.build_id}</text>}
              {narrow && <div style={{ flexGrow: 1 }} />}
              {b.pinned && <text style={{ fontFamily: SANS, fontSize: 11.5, color: C.accent, pointerEvents: 'none' }}>Pinned</text>}
              <text style={{ fontFamily: SANS, fontSize: 12, color: C.ghost, width: 92, pointerEvents: 'none' }}>{timeAgo(b.created_at)}</text>
            </div>
            {open === b.build_id && (
              <div testId="build-log" style={{ ...col({ gap: 2 }), marginLeft: 10, marginRight: 10, marginTop: 4, marginBottom: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
                <div style={row({ gap: 10, paddingBottom: 6 })}>
                  <T size={12.5} color={C.tertiary} testId="build-log-count">{log?.lines ? `${log.lines.length} log lines · last ${Math.min(80, shown.length)} shown` : 'Loading log…'}</T>
                  <div style={{ flexGrow: 1 }} />
                  <Pills testId="log-filter" value={onlyErrors ? 'errors' : 'all'} onChange={(v) => setOnlyErrors(v === 'errors')} items={[{ value: 'all', label: 'All' }, { value: 'errors', label: 'Errors' }]} />
                </div>
                {log?.error && <Notice text={log.error} tone="error" />}
                {shown.slice(-80).map((l, i) => (
                  <text key={i} style={{ fontFamily: 'Menlo', fontSize: 11.5, lineHeight: 16, color: l.stream === 'stderr' || /error|fail/i.test(l.msg) ? C.del : l.msg.startsWith('===') ? C.text : C.secondary }}>{`${l.ts.slice(11, 19)}  ${l.msg.slice(0, 240)}`}</text>
                ))}
              </div>
            )}
          </div>
        ))}
        {builds.items === null && !builds.error && api && <Empty text="Loading builds…" />}
        {builds.items?.length === 0 && <Empty text={api ? 'No builds yet' : 'Connect a Devin API key to see builds'} />}
      </div>
      <Divider />
      <T weight={600}>{`Blueprints${blueprints.items ? ` · ${blueprints.items.length}` : ''}`}</T>
      <div testId="blueprint-list" style={row({ gap: 6, flexWrap: 'wrap' })}>
        {(blueprints.items ?? []).map((b) => (
          <div key={b.blueprint_id} style={{ ...row({ gap: 6 }), height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 14, borderWidth: 1, borderColor: C.border }}>
            <Icon name={b.type === 'org' ? 'shapes' : 'folder'} size={12} color={C.tertiary} />
            <T size={12.5}>{b.type === 'org' ? 'Organization' : (b.repo_name ?? b.blueprint_id)}</T>
          </div>
        ))}
      </div>
    </Page>
  )
}

const REVIEW_LABEL: Record<ApiPrReview['status'], { text: string; color: string }> = {
  completed: { text: 'Reviewed', color: '#26cd4d' },
  running: { text: 'Reviewing…', color: '#71b7ff' },
  pending: { text: 'Queued', color: '#f0b72f' },
  errored: { text: 'Review errored', color: '#ff9492' },
  cancelled: { text: 'Cancelled', color: '#7a828e' },
  skipped: { text: 'Skipped', color: '#7a828e' },
}

/** Devin Review status for one PR, with a button to (re)run it. */
export function PrReview({ url, client, canRun = true }: { url: string; client: DevinApi | null; canRun?: boolean }) {
  const [r, setR] = useState<ApiPrReview | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!client?.prReview) return
    let alive = true
    const load = () => client.prReview!(url).then((v) => alive && (setR(v), setErr(null))).catch((e: Error) => alive && setErr(e.message))
    load()
    const t = setInterval(() => (r?.status === 'running' || r?.status === 'pending') && load(), 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [client, url, r?.status])
  if (!client?.prReview) return null
  const run = () =>
    client.runPrReview?.(url)
      .then((v) => setR(v))
      .catch((e: Error) => setErr(e.message))
  const st = r ? REVIEW_LABEL[r.status] : null
  return (
    <div testId="pr-review" style={col({ gap: 6, paddingTop: 10 })}>
      <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5 }}>Devin Review</text>
      <div style={row({ gap: 8 })}>
        {st && <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: st.color }} />}
        <text testId="pr-review-status" style={{ fontFamily: SANS, color: st ? C.text : C.tertiary, fontSize: 13 }}>
          {r === undefined ? 'Checking…' : st ? `${st.text} · ${r!.commit_sha.slice(0, 7)} · ${timeAgo(Date.parse(r!.created_at) / 1000)}` : 'Not reviewed yet'}
        </text>
        <div style={{ flexGrow: 1 }} />
        {canRun && client.runPrReview && r !== undefined && r?.status !== 'running' && r?.status !== 'pending' && <Btn small icon="retry" label={r ? 'Re-run' : 'Run review'} testId="pr-review-run" onClick={run} />}
      </div>
      {err && <Notice text={err} tone="error" />}
    </div>
  )
}

export { timeAgo }
