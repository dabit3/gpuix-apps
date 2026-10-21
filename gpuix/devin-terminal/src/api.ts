// Minimal client for the Devin v3 API (https://docs.devin.ai/api-reference). Auth: a personal access token or service-user key.
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
}

export type ApiMessage = {
  event_id: string
  created_at: number
  message: string
  source: 'devin' | 'user'
  username?: string | null
}

type Page<T> = { items: T[]; end_cursor?: string | null; has_next_page?: boolean }

export type DevinConfig = { apiKey: string; orgId: string; baseUrl?: string; fetch?: typeof fetch }

export interface DevinApi {
  listSessions(first?: number, after?: string): Promise<{ items: ApiSession[]; hasMore: boolean; cursor?: string | null }>
  getSession(id: string): Promise<ApiSession>
  listMessages(id: string): Promise<ApiMessage[]>
  createSession(prompt: string, opts?: { mode?: string; repos?: string[]; tags?: string[] }): Promise<ApiSession>
  sendMessage(id: string, message: string): Promise<unknown>
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
    return (await res.json()) as T
  }

  async listSessions(first = 50, after?: string): Promise<{ items: ApiSession[]; hasMore: boolean; cursor?: string | null }> {
    const q = after ? `&after=${encodeURIComponent(after)}` : ''
    const page = await this.req<Page<ApiSession>>(`/sessions?first=${first}${q}`)
    return { items: page.items, hasMore: page.has_next_page ?? false, cursor: page.end_cursor }
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

  createSession(prompt: string, opts: { mode?: string; repos?: string[]; tags?: string[] } = {}): Promise<ApiSession> {
    return this.req<ApiSession>('/sessions', {
      method: 'POST',
      body: { prompt, devin_mode: opts.mode, repos: opts.repos?.length ? opts.repos : undefined, tags: opts.tags ?? ['devin-tui'] },
    })
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
export function loadConfig(env: Record<string, string | undefined> = process.env, file?: string): DevinConfig | null {
  let fromFile: Partial<DevinConfig> = {}
  const path = file ?? `${env.HOME ?? ''}/.config/devin-tui/config.json`
  try {
    fromFile = JSON.parse(require('fs').readFileSync(path, 'utf8')) as Partial<DevinConfig>
  } catch {}
  const apiKey = env.DEVIN_API_KEY ?? fromFile.apiKey
  const orgId = env.DEVIN_ORG_ID ?? fromFile.orgId
  if (!apiKey || !orgId) return null
  return { apiKey, orgId, baseUrl: env.DEVIN_API_BASE ?? fromFile.baseUrl }
}
