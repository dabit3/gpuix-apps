/** @jsxImportSource #zoom */
// Pages from the v3 API that the first rounds didn't cover: the full sessions table (with archived), usage metrics, repositories, scan findings, and per-session tags and insights.
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from './icons'
import { C } from './theme'
import { timeAgo, type ApiBlueprint, type ApiBuild, type ApiPrReview, type LogLine, type ApiFinding, type ApiInsights, type ApiPrMetrics, type ApiRepo, type ApiSession, type ApiSessionMetrics, type DevinApi } from './api'
import type { Session } from './data'
import { Badge, Btn, CLEAR, col, Empty, EmptyState, Field, IconTile, MONO, Notice, openUrl, Pills, row, SANS, SectionTitle, Segmented, StatusDot, T, WEB, type Tone } from './ui'
import { Page, Stat, Table, TableRow, useApiList, useSticky } from './views'

export type SessionsFilter = 'all' | 'active' | 'waiting' | 'prs' | 'archived'

/** Short state label like the web app's sessions table ("PR is ready", "Waiting on you"). */
export function stateLabel(s: Session): { text: string; color: string; tone: Tone } {
  const prs = s.live?.prs ?? []
  if (s.status === 'blocked') return { text: s.live?.statusDetail === 'waiting_for_approval' ? 'Approve next step' : 'Waiting on you', color: C.orange, tone: 'orange' }
  if (s.status === 'running') return { text: 'Working', color: C.accent, tone: 'blue' }
  if (prs.some((p) => (p.state ?? 'open') === 'open')) return { text: 'PR is ready', color: C.add, tone: 'green' }
  if (prs.some((p) => p.state === 'merged')) return { text: 'Merged', color: C.purple, tone: 'purple' }
  if (s.status === 'failed') return { text: 'Errored', color: C.del, tone: 'red' }
  if (s.status === 'finished') return { text: 'Finished', color: C.tertiary, tone: 'neutral' }
  return { text: 'Sleeping', color: C.tertiary, tone: 'neutral' }
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

function HeadCell({ children, width, grow }: { children?: string; width?: number; grow?: boolean }) {
  return <T size={12} weight={500} color={C.ghost} style={{ width, flexGrow: grow ? 1 : 0, flexShrink: grow ? 1 : 0, minWidth: 0 }}>{children ?? ''}</T>
}

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
  const shown = rows.slice(0, limit)
  return (
    <Page testId="view-sessions" narrow={narrow} title="Sessions" subtitle="Every session in your organization, newest activity first." actions={<Btn ghost icon="external" label="Open on web" onClick={() => openUrl(`${WEB}/sessions`)} />}>
      <div style={col({ gap: 10 })}>
        <Field testId="sessions-search" value={q} onChange={(v) => (setQ(v), setLimit(PAGE))} placeholder="Search by title or repository" />
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
      </div>
      {toast && <Notice text={toast} tone="ok" />}
      {filter === 'archived' && archived.items?.length === ARCHIVED_MAX && <T size={12} color={C.ghost}>{`Showing the ${ARCHIVED_MAX} most recently archived. Older ones are on app.devin.ai.`}</T>}
      {archived.error && <Notice text={archived.error} tone="error" />}
      <div testId="sessions-table" style={{ ...col(), borderRadius: 10, borderWidth: shown.length ? 1 : 0, borderColor: C.border, overflow: 'hidden' }}>
        {shown.length > 0 && (
          <div style={{ ...row({ gap: 12 }), height: 34, paddingLeft: 14, paddingRight: 14, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.cardHead }}>
            <HeadCell grow>Session</HeadCell>
            <HeadCell width={128}>State</HeadCell>
            {!narrow && <HeadCell width={168}>Repository</HeadCell>}
            <HeadCell width={84}>PR</HeadCell>
            <HeadCell width={filter === 'archived' ? 190 : 96}>Updated</HeadCell>
          </div>
        )}
        {shown.map((s, i) => {
          const st = stateLabel(s)
          const pr = s.live?.prs[0]
          const repo = s.repo && s.repo !== 'No repository' ? s.repo : ''
          return (
            <div
              key={s.id}
              testId={`srow-${s.id}`}
              onClick={() => filter !== 'archived' && onOpen(s.id)}
              style={{ ...row({ gap: 12 }), height: 44, paddingLeft: 14, paddingRight: 14, borderBottomWidth: i === shown.length - 1 ? 0 : 1, borderColor: C.border, cursor: filter === 'archived' ? 'default' : 'pointer', hover: { backgroundColor: C.hover } }}
            >
              <div style={{ ...row({ gap: 10 }), flexGrow: 1, flexShrink: 1, minWidth: 0, pointerEvents: 'none' }}>
                <StatusDot status={s.status} size={7} color={s.status === 'finished' || s.status === 'sleeping' ? C.borderStrong : undefined} />
                <text style={{ fontFamily: SANS, fontSize: 13.5, color: C.text, fontWeight: 500, flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{s.title}</text>
              </div>
              <div style={{ ...row(), width: 128, flexShrink: 0, pointerEvents: 'none' }}>
                <Badge label={st.text} tone={st.tone} />
              </div>
              {!narrow && <text style={{ fontFamily: SANS, fontSize: 12.5, color: repo ? C.tertiary : C.ghost, width: 168, flexShrink: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{repo || '—'}</text>}
              <div style={{ ...row({ gap: 4 }), width: 84, flexShrink: 0, pointerEvents: 'none' }}>
                {pr ? (
                  <>
                    <Icon name={pr.state === 'merged' ? 'merge' : 'pr'} size={12} color={pr.state === 'merged' ? C.purple : C.add} />
                    <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.secondary }}>{`#${pr.url.split('/').pop()}${(s.live?.prs.length ?? 0) > 1 ? ` +${s.live!.prs.length - 1}` : ''}`}</text>
                  </>
                ) : (
                  <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.ghost }}>—</text>
                )}
              </div>
              <div style={{ ...row({ gap: 8 }), width: filter === 'archived' ? 190 : 96, flexShrink: 0 }}>
                <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.ghost, flexGrow: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, pointerEvents: 'none' }}>{s.updated}</text>
                {filter === 'archived' && <Btn small icon="retry" label="Unarchive" testId={`unarchive-${s.id}`} onClick={() => unarchive(s)} />}
              </div>
            </div>
          )
        })}
        {filter === 'archived' && archived.items === null && !archived.error && <Empty text="Loading archived sessions…" />}
        {rows.length === 0 && (filter !== 'archived' || archived.items) && <EmptyState icon={filter === 'archived' ? 'archive' : 'list'} title={q ? 'No sessions match' : 'Nothing here'} body={q ? 'Try a different search or filter.' : 'Sessions that fit this filter show up here.'} />}
      </div>
      {rows.length > limit && (
        <div style={row({ justifyContent: 'center' })}>
          <Btn label={`Show more · ${rows.length - limit} left`} testId="sessions-more" onClick={() => setLimit((n) => n + PAGE)} />
        </div>
      )}
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
    <div testId={testId} style={col({ gap: 10 })}>
      {items.map((i) => (
        <div key={i.label} style={row({ gap: 12 })}>
          <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.secondary, width: 96, flexShrink: 0 }}>{i.label}</text>
          <div style={{ flexGrow: 1, height: 8, borderRadius: 4, backgroundColor: C.hover }}>
            <div style={{ width: `${Math.max(i.value ? 2 : 0, (i.value / max) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: C.accent }} />
          </div>
          <text style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 500, color: C.text, width: 44, flexShrink: 0, textAlign: 'right' }}>{String(i.value)}</text>
        </div>
      ))}
    </div>
  )
}

function Columns({ items, testId }: { items: { label: string; value: number }[]; testId: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div testId={testId} style={col({ gap: 6 })}>
      <div style={{ ...row({ gap: 6, alignItems: 'flex-end' }), height: 140 }}>
        {items.map((i) => (
          <div key={i.label} style={{ ...col({ alignItems: 'center', justifyContent: 'flex-end', gap: 4 }), flexGrow: 1, flexBasis: 0, height: '100%' }}>
            <text style={{ fontFamily: SANS, fontSize: 10.5, color: C.ghost }}>{String(i.value)}</text>
            <div style={{ width: '100%', height: Math.max(2, Math.round((i.value / max) * 112)), borderRadius: 4, backgroundColor: C.accent, opacity: 0.85 }} />
          </div>
        ))}
      </div>
      <div style={row({ gap: 6 })}>
        {items.map((i, n) => (
          <text key={i.label} style={{ fontFamily: SANS, fontSize: 10.5, color: C.ghost, flexGrow: 1, flexBasis: 0, textAlign: 'center' }}>{n % 2 === 0 || n === items.length - 1 ? i.label : ''}</text>
        ))}
      </div>
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
  const mergeRate = data?.p.prs_created_count ? Math.round(((data.p.prs_merged_count ?? 0) / data.p.prs_created_count) * 100) : 0
  return (
    <Page testId="view-usage" narrow={narrow} title="Usage" subtitle="Sessions and pull requests across your organization." actions={<Btn ghost icon="external" label="Billing on web" onClick={() => openUrl(`${WEB}/settings/usage`)} />}>
      <div style={row()}>
        <Segmented testId="usage-range" value={range} onChange={setRange} items={RANGES} />
      </div>
      {error && <Notice text={error} tone="error" />}
      {!api && <EmptyState icon="zap" title="No API key" body="Connect a Devin API key to see usage." />}
      {api && !data && !error && <Empty text="Loading…" />}
      {data && (
        <>
          <div style={col({ gap: 10 })}>
            <SectionTitle title="Sessions" />
            <div style={row({ gap: 10, flexWrap: 'wrap' })}>
              <Stat testId="usage-sessions" label="Created" value={data.s.sessions_created_count ?? 0} />
              <Stat testId="usage-merged-sessions" label="With merged PRs" value={data.s.sessions_with_merged_prs_count ?? 0} />
              <Stat testId="usage-playbooks" label="Started from a playbook" value={data.s.sessions_created_with_playbook_count ?? 0} />
            </div>
          </div>
          <div style={col({ gap: 10 })}>
            <SectionTitle title="Pull requests" hint={`${mergeRate}% merge rate · ${data.p.prs_taken_over_count ?? 0} taken over by a human`} />
            <div style={row({ gap: 10, flexWrap: 'wrap' })}>
              <Stat testId="usage-prs-created" label="Created" value={data.p.prs_created_count ?? 0} />
              <Stat testId="usage-prs-merged" label="Merged" value={data.p.prs_merged_count ?? 0} />
              <Stat testId="usage-prs-open" label="Still open" value={data.p.prs_opened_count ?? 0} />
              <Stat testId="usage-prs-closed" label="Closed" value={data.p.prs_closed_count ?? 0} />
            </div>
          </div>
          <div style={{ ...col({ gap: 14 }), padding: 16, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
            <SectionTitle title="Where sessions start" />
            {origins.length ? <Bars testId="usage-origins" items={origins} /> : <Empty text="No sessions in this range" />}
          </div>
          {data.total > 0 && (
            <div style={{ ...col({ gap: 14 }), padding: 16, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
              <SectionTitle title="ACUs per day" actions={<T size={13} weight={600}>{`${Math.round(data.total * 10) / 10} total`}</T>} />
              <Columns testId="usage-acus" items={data.acus.slice(-14).map((d) => ({ label: new Date(d.date * 1000).toISOString().slice(5, 10), value: Math.round(d.acus * 10) / 10 }))} />
            </div>
          )}
        </>
      )}
    </Page>
  )
}

export function indexState(r: ApiRepo): { text: string; color: string; tone: Tone } {
  const st = r.indexing_status
  if (!st || !st.indexing_enabled) return { text: 'Not indexed', color: C.ghost, tone: 'neutral' }
  if (st.latest_completed_wiki_index_job || st.latest_completed_search_index_job) return { text: 'Indexed', color: C.add, tone: 'green' }
  return { text: 'Indexing', color: C.orange, tone: 'orange' }
}

export function ReposView({ api, onStart, narrow }: { api: DevinApi | null; onStart: (repo: string) => void; narrow?: boolean }) {
  const [q, setQ] = useSticky('repos-q', '')
  const [query, setQuery] = useState(q)
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300)
    return () => clearTimeout(t)
  }, [q])
  const repos = useApiList<ApiRepo>(api?.listRepositories ? () => api.listRepositories!(query) : undefined, [api, query])
  const list = repos.items ?? []
  return (
    <Page testId="view-repos" narrow={narrow} title="Repositories" subtitle="Repositories Devin can work in, with their DeepWiki and search indexing." actions={<Btn ghost icon="external" label="Manage on web" onClick={() => openUrl(`${WEB}/settings/repositories`)} />}>
      <Field testId="repos-search" value={q} onChange={setQ} placeholder="Filter by name" />
      {repos.error && <Notice text={repos.error} tone="error" />}
      <div testId="repo-list" style={col()}>
        {list.length > 0 && (
          <Table>
            {list.map((r, i) => {
              const ix = indexState(r)
              return (
                <TableRow key={r.repo_path} testId={`repo-${r.repo_path}`} last={i === list.length - 1}>
                  <IconTile icon="folder" size={30} />
                  <div style={{ ...col({ gap: 1, flexGrow: 1, minWidth: 0 }), paddingTop: 8, paddingBottom: 8 }}>
                    <T size={13.5} weight={500} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.repo_path}</T>
                    <T size={12} color={C.ghost} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.repo_description || 'No description'}</T>
                  </div>
                  {!narrow && r.repo_language && <T size={12.5} color={C.tertiary} style={{ flexShrink: 0 }}>{r.repo_language}</T>}
                  <div style={{ width: 92, flexShrink: 0, ...row({ justifyContent: 'flex-end' }) }}>
                    <Badge label={ix.text} tone={ix.tone} />
                  </div>
                  <Btn small icon="plus" label="New session" testId={`repo-start-${r.repo_path}`} onClick={() => onStart(r.repo_path)} />
                </TableRow>
              )
            })}
          </Table>
        )}
        {repos.items === null && !repos.error && api && <Empty text="Loading repositories…" />}
        {repos.items?.length === 0 && <EmptyState icon="folder" title={api ? (query ? 'No repositories match' : 'No repositories connected') : 'No API key'} body={api ? 'Connect repositories on app.devin.ai to work in them here.' : 'Connect a Devin API key to list repositories.'} />}
      </div>
    </Page>
  )
}

const sevTone = (sev: string): Tone => (sev === 'critical' || sev === 'high' ? 'red' : sev === 'medium' ? 'orange' : 'neutral')

export function FindingsList({ api }: { api: DevinApi | null }) {
  const findings = useApiList<ApiFinding>(api?.listFindings?.bind(api), [api])
  if (!api?.listFindings) return null
  const list = (findings.items ?? []).slice(0, 25)
  return (
    <div style={col({ gap: 10 })}>
      <SectionTitle title="Scan findings" count={findings.items?.length} hint="Click a finding to open its fix PR or session." />
      {findings.error && <Notice text={findings.error} tone="error" />}
      <div testId="finding-list" style={col()}>
        {list.length > 0 && (
          <Table>
            {list.map((f, i) => (
              <TableRow key={f.finding_id} testId={`finding-${f.finding_id}`} last={i === list.length - 1} onClick={() => openUrl(f.pr_url ?? (f.session_id ? `${WEB}/sessions/${f.session_id.replace(/^devin-/, '')}` : `${WEB}/security`))}>
                <div style={{ ...row(), width: 76, flexShrink: 0, pointerEvents: 'none' }}>
                  <Badge label={(f.severity ?? '—').replace(/^./, (m) => m.toUpperCase())} tone={sevTone((f.severity ?? '').toLowerCase())} />
                </div>
                <text style={{ fontFamily: SANS, fontSize: 13.5, color: C.text, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{f.title}</text>
                <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.ghost, flexShrink: 0, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{[f.repo_name, f.status].filter(Boolean).join(' · ')}</text>
              </TableRow>
            ))}
          </Table>
        )}
        {findings.items === null && !findings.error && <Empty text="Loading findings…" />}
        {findings.items?.length === 0 && <EmptyState compact icon="shield" title="No findings" body="Code scans haven't flagged anything." />}
      </div>
    </div>
  )
}

const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function PanelLabel({ children }: { children: string }) {
  return <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12, fontWeight: 500 }}>{children}</text>
}

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
    <div style={col({ gap: 10, paddingTop: 18 })}>
      <PanelLabel>Tags</PanelLabel>
      <div testId="tag-list" style={row({ gap: 6, flexWrap: 'wrap' })}>
        {tags.map((t) => (
          <div key={t} testId={`tag-${t}`} style={{ ...row({ gap: 4 }), height: 24, paddingLeft: 9, paddingRight: 4, borderRadius: 12, backgroundColor: C.chip }}>
            <text style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, color: C.chipText }}>{t}</text>
            <div testId={`tag-remove-${t}`} onClick={() => save(tags.filter((x) => x !== t))} style={{ ...row({ justifyContent: 'center' }), width: 16, height: 16, borderRadius: 8, cursor: 'pointer', hover: { backgroundColor: C.selected } }}>
              <Icon name="x" size={11} color={C.tertiary} />
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
          <Btn label="Add" testId="tag-add" disabled={!draft.trim()} onClick={add} />
        </div>
      )}
      {msg && <Notice text={msg.text} tone={msg.tone} />}
      {ins && (
        <div testId="insights" style={{ ...col({ gap: 10 }), marginTop: 8, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
          <div style={row({ gap: 8 })}>
            <Icon name="sparkle" size={14} color={C.accent} />
            <T weight={600} size={13}>Insights</T>
            <div style={{ flexGrow: 1 }} />
            {!a && <Btn small label={generating || ins.analysis_status === 'started' ? 'Analyzing…' : 'Analyze'} testId="insights-generate" disabled={generating} onClick={generate} />}
          </div>
          <T testId="insights-meta" size={12.5} color={C.tertiary}>
            {[ins.category && label(ins.category), ins.session_size && `Size ${ins.session_size.toUpperCase()}`, `${ins.num_user_messages ?? 0} from you · ${ins.num_devin_messages ?? 0} from Devin`, ins.origin && `via ${ins.origin}`].filter(Boolean).join(' · ')}
          </T>
          {a?.classification?.tools_and_frameworks?.length ? (
            <div style={row({ gap: 5, flexWrap: 'wrap' })}>
              {a.classification.tools_and_frameworks.slice(0, 6).map((x) => <Badge key={x} label={x} />)}
            </div>
          ) : null}
          {(a?.issues ?? []).slice(0, 4).map((i) => (
            <div key={i.id} style={row({ gap: 8, alignItems: 'flex-start' })}>
              <div style={{ paddingTop: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i.impact === 'high' ? C.del : C.orange }} />
              </div>
              <T size={12.5} style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{i.title}</T>
            </div>
          ))}
          {(a?.action_items ?? []).slice(0, 3).map((x) => (
            <div key={x.issue_id + x.action_item} style={row({ gap: 8, alignItems: 'flex-start' })}>
              <div style={{ paddingTop: 3 }}>
                <Icon name="arrowRight" size={12} color={C.ghost} />
              </div>
              <T size={12.5} color={C.secondary} style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{x.action_item}</T>
            </div>
          ))}
          {a?.suggested_prompt?.suggested_prompt && (
            <div style={{ ...col({ gap: 4 }), padding: 10, borderRadius: 8, backgroundColor: C.hover }}>
              <T size={12} color={C.ghost} weight={500}>Suggested prompt</T>
              <T size={12.5} color={C.secondary}>{a.suggested_prompt.suggested_prompt.slice(0, 400)}</T>
            </div>
          )}
          {!a && ins.analysis_status !== 'started' && !generating && <T size={12} color={C.ghost}>No analysis yet. Analyze asks Devin to review how this session went.</T>}
        </div>
      )}
    </div>
  )
}

export function buildDuration(b: ApiBuild): string {
  if (!b.started_at) return '—'
  const s = Math.max(0, (b.completed_at ?? Date.now() / 1000) - b.started_at)
  return s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

const buildTone = (s: ApiBuild['status']): Tone => (s === 'succeeded' ? 'green' : s === 'failed' ? 'red' : s === 'running' ? 'blue' : s === 'pending' ? 'orange' : 'neutral')

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
  const list = builds.items ?? []
  return (
    <Page testId="view-environment" narrow={narrow} title="Environment" subtitle="The machine image every Devin session boots from: snapshot builds and the blueprints behind them." actions={<><Btn icon="retry" label="Rebuild" testId="env-rebuild" onClick={rebuild} /><Btn ghost icon="external" label="Edit on web" onClick={() => openUrl(`${WEB}/settings/environment`)} /></>}>
      {msg && <Notice text={msg.text} tone={msg.tone} />}
      <div style={col({ gap: 10 })}>
        <SectionTitle title="Builds" count={builds.items?.length} hint="Click a build to read its log." />
        {builds.error && <Notice text={builds.error} tone="error" />}
        <div testId="build-list" style={col()}>
          {list.length > 0 && (
            <Table>
              {list.map((b, i) => (
                <div key={b.build_id} style={{ ...col(), borderBottomWidth: i === list.length - 1 ? 0 : 1, borderColor: C.border }}>
                  <div testId={`build-${b.build_id}`} onClick={() => setOpen(open === b.build_id ? null : b.build_id)} style={{ ...row({ gap: 12 }), height: 44, paddingLeft: 12, paddingRight: 14, cursor: 'pointer', backgroundColor: open === b.build_id ? C.hover : CLEAR, hover: { backgroundColor: C.hover } }}>
                    <Icon name={open === b.build_id ? 'chevronDown' : 'chevronRight'} size={13} color={C.ghost} />
                    <div style={{ ...row(), width: 92, flexShrink: 0, pointerEvents: 'none' }}>
                      <Badge label={b.status[0]!.toUpperCase() + b.status.slice(1)} tone={buildTone(b.status)} />
                    </div>
                    <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.tertiary, width: 60, pointerEvents: 'none' }}>{b.trigger === 'manual' ? 'Manual' : 'Auto'}</text>
                    <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.tertiary, width: 64, pointerEvents: 'none' }}>{buildDuration(b)}</text>
                    {!narrow && <text style={{ fontFamily: MONO, fontSize: 11.5, color: C.ghost, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{b.build_id}</text>}
                    {narrow && <div style={{ flexGrow: 1 }} />}
                    {b.pinned && <Badge label="Pinned" tone="blue" />}
                    <text style={{ fontFamily: SANS, fontSize: 12.5, color: C.ghost, width: 96, textAlign: 'right', pointerEvents: 'none' }}>{timeAgo(b.created_at)}</text>
                  </div>
                  {open === b.build_id && (
                    <div testId="build-log" style={{ ...col({ gap: 2 }), marginLeft: 12, marginRight: 12, marginBottom: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.canvas }}>
                      <div style={row({ gap: 10, paddingBottom: 8 })}>
                        <T size={12.5} color={C.tertiary} testId="build-log-count">{log?.lines ? `${log.lines.length} log lines · last ${Math.min(80, shown.length)} shown` : 'Loading log…'}</T>
                        <div style={{ flexGrow: 1 }} />
                        <Segmented small testId="log-filter" value={onlyErrors ? 'errors' : 'all'} onChange={(v) => setOnlyErrors(v === 'errors')} items={[{ value: 'all', label: 'All' }, { value: 'errors', label: 'Errors' }]} />
                      </div>
                      {log?.error && <Notice text={log.error} tone="error" />}
                      {shown.slice(-80).map((l, n) => (
                        <text key={n} style={{ fontFamily: MONO, fontSize: 11.5, lineHeight: 17, color: l.stream === 'stderr' || /error|fail/i.test(l.msg) ? C.del : l.msg.startsWith('===') ? C.text : C.secondary }}>{`${l.ts.slice(11, 19)}  ${l.msg.slice(0, 240)}`}</text>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Table>
          )}
          {builds.items === null && !builds.error && api && <Empty text="Loading builds…" />}
          {builds.items?.length === 0 && <EmptyState compact icon="laptop" title={api ? 'No builds yet' : 'No API key'} body={api ? 'Rebuild to snapshot the environment.' : 'Connect a Devin API key to see builds.'} />}
        </div>
      </div>
      <div style={col({ gap: 10 })}>
        <SectionTitle title="Blueprints" count={blueprints.items?.length} />
        <div testId="blueprint-list" style={row({ gap: 6, flexWrap: 'wrap' })}>
          {(blueprints.items ?? []).map((b) => (
            <div key={b.blueprint_id} style={{ ...row({ gap: 7 }), height: 30, paddingLeft: 10, paddingRight: 12, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
              <Icon name={b.type === 'org' ? 'shapes' : 'folder'} size={13} color={C.tertiary} />
              <T size={12.5}>{b.type === 'org' ? 'Organization' : (b.repo_name ?? b.blueprint_id)}</T>
            </div>
          ))}
          {blueprints.items?.length === 0 && <T size={12.5} color={C.ghost}>No blueprints</T>}
        </div>
      </div>
    </Page>
  )
}

function reviewLabel(status: ApiPrReview['status']): { text: string; color: string } {
  switch (status) {
    case 'completed':
      return { text: 'Reviewed', color: C.add }
    case 'running':
      return { text: 'Reviewing…', color: C.blue }
    case 'pending':
      return { text: 'Queued', color: C.orange }
    case 'errored':
      return { text: 'Review errored', color: C.del }
    case 'cancelled':
      return { text: 'Cancelled', color: C.ghost }
    case 'skipped':
      return { text: 'Skipped', color: C.ghost }
  }
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
  const st = r ? reviewLabel(r.status) : null
  return (
    <div testId="pr-review" style={{ ...col({ gap: 8 }), padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
      <div style={row({ gap: 8 })}>
        <Icon name="shield" size={14} color={C.tertiary} />
        <T size={13} weight={600}>Devin Review</T>
        <div style={{ flexGrow: 1 }} />
        {canRun && client.runPrReview && r !== undefined && r?.status !== 'running' && r?.status !== 'pending' && <Btn small icon="retry" label={r ? 'Re-run' : 'Run review'} testId="pr-review-run" onClick={run} />}
      </div>
      <div style={row({ gap: 8 })}>
        {st && <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: st.color }} />}
        <text testId="pr-review-status" style={{ fontFamily: SANS, color: st ? C.text : C.tertiary, fontSize: 12.5 }}>
          {r === undefined ? 'Checking…' : st ? `${st.text} · ${r!.commit_sha.slice(0, 7)} · ${timeAgo(Date.parse(r!.created_at) / 1000)}` : 'Not reviewed yet'}
        </text>
      </div>
      {err && <Notice text={err} tone="error" />}
    </div>
  )
}

export { timeAgo }
