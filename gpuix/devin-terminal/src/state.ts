import type { AgentMode, RunAction, Session, Step, TranscriptEvent } from './data'

export type PanelTab = 'shell' | 'editor' | 'browser' | 'planner'

export type State = {
  sessions: Session[]
  selectedId: string | null
  search: string
  mode: AgentMode
  panelOpen: boolean
  panelTab: PanelTab
  repo: string
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
