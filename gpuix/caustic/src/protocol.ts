import type { PickKind, Settings } from './scene'

export interface Ripple { x: number; z: number; r: number; s: number }

export type ToEngine =
  | { type: 'size'; w: number; h: number }
  | { type: 'pointer'; phase: 'down' | 'move' | 'up'; u: number; v: number }
  | { type: 'set'; settings: Partial<Settings> }
  | { type: 'orbit'; dyaw: number; dpitch: number }
  | { type: 'zoom'; f: number }
  | { type: 'drops'; ripples: Ripple[] }
  | { type: 'clear' }
  | { type: 'screenshot'; path: string }
  | { type: 'stop' }

export interface EngineStats {
  fps: number
  simMs: number
  causticsMs: number
  renderMs: number
  frameMs: number
  w: number
  h: number
  sim: number
  photons: number
  caustics: number
  workers: number
  steps: number
  peak: number
}

export type FromEngine =
  | { type: 'frame'; buf: SharedArrayBuffer; w: number; h: number; n: number }
  | { type: 'stats'; stats: EngineStats; settings: Settings; hover: PickKind; drag: PickKind | null }
  | { type: 'ripples'; ripples: Ripple[] }
  | { type: 'saved'; path: string }
  | { type: 'error'; message: string }
