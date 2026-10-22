// Minimal client for the Devin v3 API (https://docs.devin.ai/api-reference). Auth: a personal access token or service-user key.
import { defaultStore, readSaved, type KeySource, type Store } from './keystore'
export type ApiStatus = 'new' | 'claimed' | 'running' | 'exit' | 'error' | 'suspended' | 'resuming'

export type ApiSession = {
  session_id: string
  title: string | null
  status: ApiStatus
  status_detail?: string | null
  created_at: number
  updated_at: number
  url: string
  acus_consumed: number
  devin_mode?: string | null
  pull_requests: { pr_url: string; pr_state: string | null }[]
  parent_session_id?: string | null
  child_session_ids?: string[] | null
  tags: string[]
  is_archived?: boolean
}

export type ApiMessage = {
  event_id: string
  created_at: number
  message: string
  source: 'devin' | 'user'
  username?: string | null
}

export type ApiNote = { note_id: string; name: string; body: string; trigger: string; folder_path: string; is_enabled: boolean; pinned_repo: string | null; access_type: string; created_at: number; updated_at: number }
export type ApiPlaybook = { playbook_id: string; title: string; body: string; macro: string | null; access_type: string; created_by?: string; created_at: number; updated_at: number }
export type ApiSecret = { secret_id: string; key: string; note?: string | null; secret_type?: string | null; created_at?: number }
export type ApiTrigger = { trigger_id?: string; event_type: string; conditions?: { any?: { all?: { field: string; operator: string; value: string }[] }[] } }
export type ApiAutomation = {
  automation_id: string
  name: string
  enabled: boolean
  triggers: ApiTrigger[]
  actions: { type: string; prompt?: string }[]
  template_id?: string | null
  created_at: number
  updated_at: number
  next_run_at?: number | string | null
  last_invocation?: { created_at?: number; status?: string; session_id?: string } | null
}
export type ApiAttachment = { attachment_id: string; name: string; url: string; content_type?: string | null; source: 'devin' | 'user' }
export type ApiTemplate = { template_id: string; name: string; description: string; category: string; required_integrations: string[]; triggers: ApiTrigger[] }
export type ApiInsights = ApiSession & {
  analysis?: {
    issues?: { id: string; title: string; impact?: string; label?: string; issue?: string }[]
    action_items?: { issue_id: string; action_item: string; type?: string }[]
    classification?: { category?: string; tools_and_frameworks?: string[]; programming_languages?: string[] }
    suggested_prompt?: { suggested_prompt?: string; original_prompt?: string }
  } | null
  analysis_status?: 'started' | 'completed' | 'failed' | null
  num_devin_messages?: number
  num_user_messages?: number
  session_size?: string | null
  category?: string | null
  origin?: string | null
}
export type ApiConsumption = { total_acus: number; consumption_by_date: { date: number; acus: number }[] }
export type ApiSessionMetrics = { sessions_created_count?: number; sessions_with_merged_prs_count?: number; sessions_created_with_playbook_count?: number; avg_acus_per_session?: number; sessions_created_by_origin?: Record<string, number> }
export type ApiPrMetrics = { prs_created_count?: number; prs_opened_count?: number; prs_merged_count?: number; prs_closed_count?: number; prs_taken_over_count?: number }
export type ApiRepo = {
  repo_path: string
  repo_name: string
  repo_description?: string | null
  repo_language?: string | null
  last_updated_at?: number | null
  indexing_status?: { indexing_enabled: boolean; latest_completed_search_index_job?: unknown; latest_completed_wiki_index_job?: unknown } | null
}
export type ApiFinding = { finding_id: string; title: string; severity?: string | null; status?: string | null; repo_name?: string | null; pr_url?: string | null; session_id?: string | null }
export type ApiBuild = { build_id: string; status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'; trigger: 'manual' | 'auto'; pinned?: boolean; started_at?: number | null; completed_at?: number | null; created_at: number }
export type ApiBlueprint = { blueprint_id: string; type: 'org' | 'repo' | string; repo_name: string | null; updated_at: number }
export type ApiPrReview = { status: 'pending' | 'running' | 'completed' | 'errored' | 'cancelled' | 'skipped'; repo_path: string; pr_number: number; commit_sha: string; created_at: string }
export type LogLine = { ts: string; stream: string; msg: string }

/** Build logs are JSONL ({ts, stream, msg}); bad lines are skipped. */
export function parseLog(text: string): LogLine[] {
  const out: LogLine[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line)
      if (typeof j.msg === 'string' && j.msg.trim()) out.push({ ts: String(j.ts ?? ''), stream: String(j.stream ?? ''), msg: j.msg })
    } catch {}
  }
  return out
}
export type CreateSessionOpts = { mode?: string; repos?: string[]; tags?: string[]; playbookId?: string; title?: string; sessionLinks?: string[] }

type Page<T> = { items: T[]; end_cursor?: string | null; has_next_page?: boolean }

export type DevinConfig = { apiKey: string; orgId: string; baseUrl?: string; fetch?: typeof fetch; source?: KeySource }

export interface DevinApi {
  listSessions(first?: number, after?: string): Promise<{ items: ApiSession[]; hasMore: boolean; cursor?: string | null }>
  getSession(id: string): Promise<ApiSession>
  listMessages(id: string): Promise<ApiMessage[]>
  createSession(prompt: string, opts?: CreateSessionOpts): Promise<ApiSession>
  sendMessage(id: string, message: string): Promise<unknown>
  archiveSession?(id: string): Promise<unknown>
  terminateSession?(id: string): Promise<unknown>
  listNotes?(search?: string): Promise<ApiNote[]>
  createNote?(note: { name: string; body: string; trigger: string }): Promise<ApiNote>
  setNoteEnabled?(note: ApiNote, enabled: boolean): Promise<ApiNote>
  listPlaybooks?(): Promise<ApiPlaybook[]>
  createPlaybook?(pb: { title: string; body: string; macro?: string }): Promise<ApiPlaybook>
  listSecrets?(): Promise<ApiSecret[]>
  listAutomations?(): Promise<ApiAutomation[]>
  listTemplates?(): Promise<ApiTemplate[]>
  createAutomation?(a: { name: string; rrule: string; prompt: string }): Promise<ApiAutomation>
  setAutomationEnabled?(id: string, enabled: boolean): Promise<ApiAutomation>
  deleteAutomation?(id: string): Promise<unknown>
  listAttachments?(id: string): Promise<ApiAttachment[]>
  /** Short-lived direct download URL for an attachment (the API answers with a presigned redirect). */
  attachmentUrl?(a: ApiAttachment): Promise<string>
  listArchived?(max?: number): Promise<ApiSession[]>
  unarchiveSession?(id: string): Promise<ApiSession>
  setTags?(id: string, tags: string[]): Promise<string[]>
  getInsights?(id: string): Promise<ApiInsights>
  generateInsights?(id: string): Promise<unknown>
  consumption?(after: number, before: number): Promise<ApiConsumption>
  sessionMetrics?(after: number, before: number): Promise<ApiSessionMetrics>
  prMetrics?(after: number, before: number): Promise<ApiPrMetrics>
  listRepositories?(filter?: string): Promise<ApiRepo[]>
  listFindings?(): Promise<ApiFinding[]>
  listBuilds?(): Promise<ApiBuild[]>
  listBlueprints?(): Promise<ApiBlueprint[]>
  buildLog?(id: string): Promise<LogLine[]>
  triggerBuild?(): Promise<ApiBuild>
  prReview?(prUrl: string): Promise<ApiPrReview | null>
  runPrReview?(prUrl: string): Promise<ApiPrReview>
}

export class DevinClient implements DevinApi {
  private base: string
  private f: typeof fetch
  constructor(private cfg: DevinConfig) {
    this.base = `${cfg.baseUrl ?? 'https://api.devin.ai'}/v3/organizations/${cfg.orgId}`
    this.f = cfg.fetch ?? fetch
  }

  private async req<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await this.f(`${this.base}${path}`, {
      method: init?.method ?? 'GET',
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Devin API ${res.status} on ${path}: ${text.slice(0, 200)}`)
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : {}) as T
  }

  async listSessions(first = 50, after?: string): Promise<{ items: ApiSession[]; hasMore: boolean; cursor?: string | null }> {
    const q = after ? `&after=${encodeURIComponent(after)}` : ''
    const page = await this.req<Page<ApiSession>>(`/sessions?first=${first}&is_archived=false${q}`)
    return { items: page.items.filter((s) => !s.is_archived), hasMore: page.has_next_page ?? false, cursor: page.end_cursor }
  }

  getSession(id: string): Promise<ApiSession> {
    return this.req<ApiSession>(`/sessions/${id}`)
  }

  async listMessages(id: string): Promise<ApiMessage[]> {
    const out: ApiMessage[] = []
    let after: string | null | undefined
    for (let i = 0; i < 20; i++) {
      const q = after ? `?first=100&after=${encodeURIComponent(after)}` : '?first=100'
      const page = await this.req<Page<ApiMessage>>(`/sessions/${id}/messages${q}`)
      out.push(...page.items)
      if (!page.has_next_page || !page.end_cursor) break
      after = page.end_cursor
    }
    return out
  }

  createSession(prompt: string, opts: CreateSessionOpts = {}): Promise<ApiSession> {
    return this.req<ApiSession>('/sessions', {
      method: 'POST',
      body: {
        prompt,
        devin_mode: opts.mode,
        repos: opts.repos?.length ? opts.repos : undefined,
        tags: opts.tags ?? ['devin-tui'],
        playbook_id: opts.playbookId,
        title: opts.title,
        session_links: opts.sessionLinks?.length ? opts.sessionLinks : undefined,
      },
    })
  }

  archiveSession(id: string) {
    return this.req<ApiSession>(`/sessions/${id}/archive`, { method: 'POST', body: {} })
  }

  terminateSession(id: string) {
    return this.req<ApiSession>(`/sessions/${id}`, { method: 'DELETE' })
  }

  async listAttachments(id: string): Promise<ApiAttachment[]> {
    const r = await this.req<ApiAttachment[] | { items: ApiAttachment[] }>(`/sessions/${id}/attachments`)
    return Array.isArray(r) ? r : (r.items ?? [])
  }

  async attachmentUrl(a: ApiAttachment): Promise<string> {
    const path = `/attachments/${a.attachment_id}/${encodeURIComponent(a.name)}`
    const res = await this.f(`${this.base}${path}`, { headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, redirect: 'manual' })
    const loc = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && loc) return loc
    throw new Error(`Devin API ${res.status} on ${path}`)
  }

  private async all<T>(path: string, max = 5): Promise<T[]> {
    const out: T[] = []
    let after: string | null | undefined
    const sep = path.includes('?') ? '&' : '?'
    for (let i = 0; i < max; i++) {
      const page = await this.req<Page<T>>(`${path}${sep}first=100${after ? `&after=${encodeURIComponent(after)}` : ''}`)
      out.push(...page.items)
      if (!page.has_next_page || !page.end_cursor) break
      after = page.end_cursor
    }
    return out
  }

  listNotes(search?: string) {
    return this.all<ApiNote>(`/knowledge/notes${search ? `?search=${encodeURIComponent(search)}` : ''}`)
  }

  createNote(note: { name: string; body: string; trigger: string }) {
    return this.req<ApiNote>('/knowledge/notes', { method: 'POST', body: note })
  }

  setNoteEnabled(note: ApiNote, enabled: boolean) {
    const { name, body, trigger, pinned_repo } = note
    return this.req<ApiNote>(`/knowledge/notes/${note.note_id}`, { method: 'PUT', body: { name, body, trigger, pinned_repo, is_enabled: enabled } })
  }

  listPlaybooks() {
    return this.all<ApiPlaybook>('/playbooks')
  }

  createPlaybook(pb: { title: string; body: string; macro?: string }) {
    return this.req<ApiPlaybook>('/playbooks', { method: 'POST', body: { title: pb.title, body: pb.body, macro: pb.macro || undefined } })
  }

  listSecrets() {
    return this.all<ApiSecret>('/secrets')
  }

  listAutomations() {
    return this.all<ApiAutomation>('/automations')
  }

  async listTemplates() {
    return (await this.req<{ templates: ApiTemplate[] }>('/automations/templates')).templates
  }

  createAutomation(a: { name: string; rrule: string; prompt: string }) {
    return this.req<ApiAutomation>('/automations', {
      method: 'POST',
      body: {
        name: a.name,
        run_as: { type: 'organization' },
        triggers: [{ event_type: 'schedule:recurring', conditions: { any: [{ all: [{ field: 'rrule', operator: 'recurrence', value: a.rrule }] }] } }],
        actions: [{ type: 'start_session', prompt: a.prompt }],
      },
    })
  }

  setAutomationEnabled(id: string, enabled: boolean) {
    return this.req<ApiAutomation>(`/automations/${id}`, { method: 'PATCH', body: { enabled } })
  }

  deleteAutomation(id: string) {
    return this.req<unknown>(`/automations/${id}`, { method: 'DELETE' })
  }

  /** Archived sessions, newest first (the default list hides them). */
  async listArchived(max = 300) {
    const items = await this.all<ApiSession>('/sessions?is_archived=true', Math.ceil(max / 100))
    return items.slice(0, max)
  }

  unarchiveSession(id: string) {
    return this.req<ApiSession>(`/sessions/${id}/unarchive`, { method: 'POST', body: {} })
  }

  async setTags(id: string, tags: string[]) {
    return (await this.req<{ tags: string[] }>(`/sessions/${id}/tags`, { method: 'PUT', body: { tags } })).tags
  }

  getInsights(id: string) {
    return this.req<ApiInsights>(`/sessions/${id}/insights`)
  }

  generateInsights(id: string) {
    return this.req<unknown>(`/sessions/${id}/insights/generate`, { method: 'POST', body: {} })
  }

  consumption(after: number, before: number) {
    return this.req<ApiConsumption>(`/consumption/daily?time_after=${after}&time_before=${before}`)
  }

  sessionMetrics(after: number, before: number) {
    return this.req<ApiSessionMetrics>(`/metrics/sessions?time_after=${after}&time_before=${before}`)
  }

  prMetrics(after: number, before: number) {
    return this.req<ApiPrMetrics>(`/metrics/prs?time_after=${after}&time_before=${before}`)
  }

  listRepositories(filter?: string) {
    return this.all<ApiRepo>(`/repositories?load_indexing_status=true${filter ? `&filter_name=${encodeURIComponent(filter)}` : ''}`, 5)
  }

  listFindings() {
    return this.all<ApiFinding>('/code-scans/findings', 1)
  }

  async listBuilds() {
    return (await this.req<Page<ApiBuild>>('/snapshot-setup/builds?first=25')).items
  }

  async listBlueprints() {
    const r = await this.req<{ data?: ApiBlueprint[]; items?: ApiBlueprint[] }>('/snapshot-setup/blueprints?first=100')
    return r.data ?? r.items ?? []
  }

  /** The log endpoint answers with a short-lived S3 URL; fetch it and parse the JSONL. */
  async buildLog(id: string) {
    const { url } = await this.req<{ url: string }>(`/snapshot-setup/builds/${id}/logs`)
    const res = await this.f(url)
    if (!res.ok) throw new Error(`Build log ${res.status}`)
    return parseLog(await res.text())
  }

  triggerBuild() {
    return this.req<ApiBuild>('/snapshot-setup/builds', { method: 'POST', body: {} })
  }

  async prReview(prUrl: string) {
    try {
      return await this.req<ApiPrReview>(`/pr-reviews?pr_url=${encodeURIComponent(prUrl)}`)
    } catch (e) {
      if (String((e as Error).message).includes(' 404 ')) return null
      throw e
    }
  }

  runPrReview(prUrl: string) {
    return this.req<ApiPrReview>('/pr-reviews', { method: 'POST', body: { pr_url: prUrl } })
  }

  sendMessage(id: string, message: string): Promise<ApiSession> {
    return this.req<ApiSession>(`/sessions/${id}/messages`, { method: 'POST', body: { message } })
  }
}

/** UI status for an API session (sidebar dot + footer line). */
export function uiStatus(s: Pick<ApiSession, 'status' | 'status_detail'>): 'running' | 'blocked' | 'finished' | 'failed' | 'sleeping' {
  if (s.status === 'error') return 'failed'
  if (s.status === 'suspended' || s.status === 'exit') return s.status_detail === 'finished' ? 'finished' : 'sleeping'
  if (s.status_detail === 'waiting_for_user' || s.status_detail === 'waiting_for_approval') return 'blocked'
  if (s.status_detail === 'finished') return 'finished'
  return 'running'
}

export function timeAgo(unix: number, now = Date.now() / 1000): string {
  const d = Math.max(0, now - unix)
  if (d < 45) return 'now'
  if (d < 3600) return `${Math.round(d / 60)} minute${Math.round(d / 60) === 1 ? '' : 's'} ago`
  if (d < 86400) return `${Math.round(d / 3600)} hour${Math.round(d / 3600) === 1 ? '' : 's'} ago`
  if (d < 172800) return 'yesterday'
  return `${Math.round(d / 86400)} days ago`
}

/** Env vars win; otherwise `~/.config/devin-tui/config.json` ({ "apiKey": "...", "orgId": "org-..." }, chmod 600). */
export function loadConfig(env: Record<string, string | undefined> = process.env, file?: string, store?: Store): DevinConfig | null {
  const s = store ?? { ...defaultStore(env), ...(file ? { file } : {}) }
  const { cfg, source } = readSaved(s)
  const apiKey = env.DEVIN_API_KEY ?? cfg.apiKey
  const orgId = env.DEVIN_ORG_ID ?? cfg.orgId
  if (!apiKey || !orgId) return null
  return { apiKey, orgId, baseUrl: env.DEVIN_API_BASE ?? cfg.baseUrl, source: env.DEVIN_API_KEY ? 'env' : (source ?? 'file') }
}

/** Human summary of a schedule:recurring RRULE ("Daily at 13:00 UTC"), or the trigger's event type. */
export function describeTrigger(t: ApiTrigger): string {
  if (t.event_type !== 'schedule:recurring') return t.event_type.replace(':', ' · ').replace(/_/g, ' ')
  const rule = t.conditions?.any?.[0]?.all?.find((c) => c.field === 'rrule')?.value ?? ''
  const get = (k: string) => rule.match(new RegExp(`${k}=([^;\\n]+)`))?.[1]
  const freq = get('FREQ')
  const hours = get('BYHOUR')?.split(',') ?? []
  const min = (get('BYMINUTE') ?? '0').padStart(2, '0')
  const at = hours.length === 1 ? ` at ${hours[0]!.padStart(2, '0')}:${min} UTC` : hours.length > 1 ? `, ${hours.length}× a day` : ''
  const days = get('BYDAY')
  if (freq === 'DAILY') return `Daily${at}`
  if (freq === 'WEEKLY') return `${days === 'MO,TU,WE,TH,FR' ? 'Weekdays' : `Weekly${days ? ` (${days})` : ''}`}${at}`
  if (freq === 'HOURLY') return 'Hourly'
  if (freq === 'MONTHLY') return `Monthly${at}`
  return 'Scheduled'
}

export const SCHEDULE_PRESETS: { id: string; label: string; rrule: string }[] = [
  { id: 'weekdays', label: 'Weekdays at 9:00 UTC', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0' },
  { id: 'daily', label: 'Daily at 9:00 UTC', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' },
  { id: 'weekly', label: 'Mondays at 9:00 UTC', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' },
]
