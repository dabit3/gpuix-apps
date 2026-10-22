import type { ProbeSpec } from './probe'
import type { Hud, Settings } from './scene'

export type ToEngine =
  | { type: 'size'; w: number; h: number }
  | { type: 'pointer'; phase: 'down' | 'move' | 'up'; u: number; v: number }
  | { type: 'set'; settings: Partial<Settings> }
  | { type: 'orbit'; dyaw: number; dpitch: number }
  | { type: 'zoom'; f: number }
  | { type: 'camera'; pitch?: number; dist?: number; yaw?: number }
  /** Probes from other panes (specs), or one new local probe (no specs). */
  | { type: 'drop'; specs?: ProbeSpec[]; n?: number }
  | { type: 'dive' }
  | { type: 'eject' }
  | { type: 'screenshot'; path: string }
  | { type: 'stop' }

export interface EngineStats {
  fps: number
  traceMs: number
  tableMs: number
  postMs: number
  w: number
  h: number
  workers: number
  rays: number
}

export type FromEngine =
  | { type: 'frame'; buf: SharedArrayBuffer; w: number; h: number; n: number }
  | { type: 'stats'; stats: EngineStats; hud: Hud }
  /** Probes this pane created, to share with linked panes. */
  | { type: 'probes'; specs: ProbeSpec[] }
  | { type: 'dive'; phase: 'start' | 'horizon' | 'end' | 'eject' }
  | { type: 'saved'; path: string }
  | { type: 'error'; message: string }
