import { timeAgo, uiStatus, type ApiMessage, type ApiSession } from './api'
import type { AgentMode, Session, TranscriptEvent } from './data'

function group(unix: number, now: number): Session['group'] {
  const d = now - unix
  if (d < 86400) return 'Today'
  if (d < 172800) return 'Yesterday'
  if (d < 7 * 86400) return 'Previous 7 days'
  return 'Older'
}

function repoFromPrs(s: ApiSession): string {
  const m = s.pull_requests[0]?.pr_url.match(/github\.com\/([^/]+\/[^/]+)\/pull/)
  return m?.[1] ?? 'No repository'
}

export function sessionFromApi(s: ApiSession, now = Date.now() / 1000): Session {
  const mode = (['fusion', 'ultra', 'normal', 'lite', 'fast'].includes(s.devin_mode ?? '') ? s.devin_mode : 'normal') as AgentMode
  return {
    id: s.session_id.replace(/^devin-/, ''),
    title: s.title?.trim() || 'Untitled session',
    repo: repoFromPrs(s),
    branch: '',
    status: uiStatus(s),
    group: group(s.updated_at, now),
    updated: timeAgo(s.updated_at, now),
    acus: Math.round(s.acus_consumed * 10) / 10,
    mode,
    events: [],
    live: {
      url: s.url,
      statusDetail: s.status_detail ?? null,
      prs: s.pull_requests.map((p) => ({ url: p.pr_url, state: p.pr_state })),
      parentId: s.parent_session_id?.replace(/^devin-/, '') ?? null,
      childIds: s.child_session_ids ?? [],
      updatedAt: s.updated_at,
      loaded: false,
      tags: s.tags ?? [],
    },
  }
}

/** Turns the message log into transcript events; gaps of Devin work between messages become "Worked for …" rows. */
const REF = /<ref_(?:file|snippet)\s+file="([^"]+)"(?:\s+lines="([^"]+)")?\s*\/>/g
const ATTACHMENT_JSON = /ATTACHMENT:\s*(\{[^\n]*\})/g
const ATTACHMENT_URL = /ATTACHMENT:\s*"([^"]+)"/g
const link = (url: string) => `[${decodeURIComponent(url.split('/').pop() ?? url)}](${url})`

/** Turns the web app's inline markup (file refs, attachment payloads) into plain markdown. */
export function cleanMessage(md: string): string {
  return md
    .replace(REF, (_, file: string, lines?: string) => `\`${file.split('/').pop()}${lines ? `:${lines}` : ''}\``)
    .replace(ATTACHMENT_JSON, (m, json: string) => {
      try {
        return link((JSON.parse(json) as { url: string }).url)
      } catch {
        return m
      }
    })
    .replace(ATTACHMENT_URL, (_, url: string) => link(url))
}

/** "12:58 PM" in local time, like the web app's message headers. */
export function clock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "Nader Dabit" → "Nader", "nader@x.com" → "nader"; missing → "You". */
export function firstName(username?: string | null): string {
  const u = username?.trim()
  if (!u) return 'You'
  return u.includes('@') ? u.split('@')[0]! : u.split(/\s+/)[0]!
}

export function eventsFromMessages(messages: ApiMessage[], opts: { running?: boolean; now?: number } = {}): TranscriptEvent[] {
  const out: TranscriptEvent[] = []
  let prev: ApiMessage | null = null
  for (const m of messages) {
    if (prev && m.source === 'devin') {
      const gap = Math.round(m.created_at - prev.created_at)
      if (gap >= 2) out.push({ kind: 'work', id: `w-${m.event_id}`, seconds: gap, steps: [], open: false })
    }
    if (m.source === 'user') out.push({ kind: 'user', id: m.event_id, text: m.message, at: timeAgo(m.created_at), name: firstName(m.username), time: clock(m.created_at) })
    else out.push({ kind: 'devin', id: m.event_id, md: cleanMessage(m.message), time: clock(m.created_at) })
    prev = m
  }
  if (opts.running && prev) {
    const now = opts.now ?? Date.now() / 1000
    out.push({ kind: 'work', id: 'w-live', seconds: Math.max(0, Math.round(now - prev.created_at)), steps: [], open: false, active: true })
  }
  return out
}

export function statusLine(s: Session): string | null {
  const d = s.live?.statusDetail
  if (s.status === 'blocked') return d === 'waiting_for_approval' ? 'Action required: approve the next step' : 'Action required: reply to Devin'
  if (s.status === 'running') return 'Devin is working'
  if (s.status === 'sleeping') return 'Devin went to sleep'
  if (s.status === 'finished') return 'Devin finished'
  if (s.status === 'failed') return 'Session errored'
  return null
}
