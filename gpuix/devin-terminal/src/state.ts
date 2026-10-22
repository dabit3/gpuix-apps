import type { AgentMode, RunAction, Session, Step, TranscriptEvent } from './data'

export type PanelTab = string

export type State = {
  sessions: Session[]
  selectedId: string | null
  search: string
  mode: AgentMode
  panelOpen: boolean
  panelTab: PanelTab
  repo: string
  hidden?: string[]
}

export type Action =
  | { type: 'select'; id: string | null }
  | { type: 'search'; value: string }
  | { type: 'mode'; mode: AgentMode }
  | { type: 'repo'; repo: string }
  | { type: 'panel'; open?: boolean; tab?: PanelTab }
  | { type: 'create'; session: Session }
  | { type: 'append'; sessionId: string; event: TranscriptEvent }
  | { type: 'toggle-work'; sessionId: string; workId: string }
  | { type: 'tick'; seconds: number }
  | { type: 'run'; sessionId: string; action: RunAction }
  | { type: 'load'; sessions: Session[] }
  | { type: 'merge'; sessions: Session[] }
  | { type: 'upsert'; session: Session }
  | { type: 'events'; id: string; events: TranscriptEvent[] }
  | { type: 'rekey'; from: string; session: Session }
  | { type: 'patch'; id: string; patch: Partial<Session> }
  | { type: 'remove'; id: string }

function mapEvents(s: Session, fn: (e: TranscriptEvent) => TranscriptEvent): Session {
  return { ...s, events: s.events.map(fn) }
}

function mapSteps(e: TranscriptEvent, workId: string, fn: (steps: Step[]) => Step[]): TranscriptEvent {
  if (e.kind !== 'work' || e.id !== workId) return e
  return { ...e, steps: fn(e.steps) }
}

function applyRun(s: Session, a: RunAction): Session {
  switch (a.type) {
    case 'status':
      return { ...s, status: a.status, updated: 'now' }
    case 'event':
      return { ...s, events: [...s.events, a.event], updated: 'now' }
    case 'stream':
      return mapEvents(s, (e) => (e.kind === 'devin' && e.id === a.id ? { ...e, md: a.md, streaming: !a.done } : e))
    case 'plan-done':
      return mapEvents(s, (e) =>
        e.kind === 'plan' && e.id === a.id
          ? { ...e, items: e.items.map((item, i) => (i === a.index ? { ...item, done: true } : item)) }
          : e,
      )
    case 'step':
      return mapEvents(s, (e) => mapSteps(e, a.workId, (steps) => [...steps, a.step]))
    case 'shell-output':
      return mapEvents(s, (e) =>
        mapSteps(e, a.workId, (steps) =>
          steps.map((step) =>
            step.kind === 'shell' && step.id === a.stepId
              ? { ...step, output: a.output, exit: a.exit, running: a.exit === undefined }
              : step,
          ),
        ),
      )
    case 'work-done':
      return mapEvents(s, (e) => (e.kind === 'work' && e.id === a.workId ? { ...e, active: false, open: false } : e))
    case 'check':
      return mapEvents(s, (e) =>
        e.kind === 'pr' && e.id === a.prId
          ? { ...e, checks: e.checks.map((c, i) => (i === a.index ? { ...c, state: a.state, detail: a.detail } : c)) }
          : e,
      )
  }
}

/** Live sessions sorted by last activity, like the web app (the API lists by creation time). Local/demo sessions keep their order. */
export function byRecent(sessions: Session[]): Session[] {
  const pending = sessions.filter((s) => !s.live || s.id.startsWith('pending-'))
  const live = sessions.filter((s) => s.live && !s.id.startsWith('pending-')).sort((a, b) => b.live!.updatedAt - a.live!.updatedAt)
  return [...pending, ...live]
}

/** Merges a fresh API snapshot into what we already have, keeping the loaded transcript and optimistic title/repo. */
export function mergeLive(existing: Session | undefined, incoming: Session): Session {
  if (!existing) return incoming
  return {
    ...incoming,
    title: incoming.title === 'Untitled session' ? existing.title : incoming.title,
    repo: incoming.repo === 'No repository' ? existing.repo : incoming.repo,
    events: existing.events,
    live: incoming.live && { ...incoming.live, loaded: existing.live?.loaded ?? false },
  }
}

function setEvents(s: Session, incoming: TranscriptEvent[]): Session {
  if (incoming.length === 0 && s.events.length > 0) return s
  const known = new Set(s.events.map((e) => e.id))
  const wasLoaded = s.live?.loaded ?? false
  const events = incoming.map((e) => (wasLoaded && e.kind === 'devin' && !known.has(e.id) ? { ...e, fresh: true } : e))
  const pending = s.events.filter(
    (e) => e.kind === 'user' && e.id.startsWith('local-') && !incoming.some((x) => x.kind === 'user' && x.text === e.text),
  )
  return { ...s, events: [...events, ...pending], live: s.live && { ...s.live, loaded: true } }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'select':
      return { ...state, selectedId: action.id }
    case 'search':
      return { ...state, search: action.value }
    case 'mode':
      return { ...state, mode: action.mode }
    case 'repo':
      return { ...state, repo: action.repo }
    case 'panel':
      return { ...state, panelOpen: action.open ?? state.panelOpen, panelTab: action.tab ?? state.panelTab }
    case 'create':
      return { ...state, sessions: [action.session, ...state.sessions], selectedId: action.session.id, search: '' }
    case 'append':
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId ? { ...s, events: [...s.events, action.event], updated: 'now' } : s,
        ),
      }
    case 'toggle-work':
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.sessionId
            ? mapEvents(s, (e) => (e.kind === 'work' && e.id === action.workId ? { ...e, open: !e.open } : e))
            : s,
        ),
      }
    case 'tick': {
      let changed = false
      const sessions = state.sessions.map((s) => {
        if (!s.events.some((e) => e.kind === 'work' && e.active)) return s
        changed = true
        return mapEvents(s, (e) => (e.kind === 'work' && e.active ? { ...e, seconds: e.seconds + action.seconds } : e))
      })
      return changed ? { ...state, sessions } : state
    }
    case 'run':
      return {
        ...state,
        sessions: state.sessions.map((s) => (s.id === action.sessionId ? applyRun(s, action.action) : s)),
      }
    case 'load': {
      const byId = new Map(state.sessions.map((s) => [s.id, s]))
      const ids = new Set(action.sessions.map((s) => s.id))
      const pending = state.sessions.filter((s) => s.id.startsWith('pending-'))
      const kept = state.sessions.filter((s) => s.id === state.selectedId && !ids.has(s.id) && !s.id.startsWith('pending-'))
      const visible = action.sessions.filter((s) => !state.hidden?.includes(s.id))
      return { ...state, sessions: [...pending, ...byRecent(visible.map((s) => mergeLive(byId.get(s.id), s))), ...kept] }
    }
    case 'merge': {
      const visible = action.sessions.filter((s) => !state.hidden?.includes(s.id))
      const incoming = new Map(visible.map((s) => [s.id, s]))
      const known = new Set(state.sessions.map((s) => s.id))
      const merged = state.sessions.map((s) => (incoming.has(s.id) ? mergeLive(s, incoming.get(s.id)!) : s))
      const added = visible.filter((s) => !known.has(s.id))
      return { ...state, sessions: byRecent([...added, ...merged]) }
    }
    case 'upsert': {
      if (state.hidden?.includes(action.session.id)) return state
      const exists = state.sessions.some((s) => s.id === action.session.id)
      return {
        ...state,
        sessions: exists
          ? state.sessions.map((s) => (s.id === action.session.id ? mergeLive(s, action.session) : s))
          : [action.session, ...state.sessions],
      }
    }
    case 'events':
      return { ...state, sessions: state.sessions.map((s) => (s.id === action.id ? setEvents(s, action.events) : s)) }
    case 'rekey':
      return {
        ...state,
        selectedId: state.selectedId === action.from ? action.session.id : state.selectedId,
        sessions: state.sessions.map((s) => (s.id === action.from ? { ...mergeLive(s, action.session), id: action.session.id } : s)),
      }
    case 'remove':
      return { ...state, hidden: [...(state.hidden ?? []), action.id], sessions: state.sessions.filter((s) => s.id !== action.id), selectedId: state.selectedId === action.id ? null : state.selectedId }
    case 'patch':
      return { ...state, sessions: state.sessions.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)) }
  }
}

export function filterSessions(sessions: Session[], search: string): Session[] {
  const q = search.trim().toLowerCase()
  if (!q) return sessions
  return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.repo.toLowerCase().includes(q))
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}
