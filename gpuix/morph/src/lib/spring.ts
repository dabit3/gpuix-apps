/** Damped spring, Remotion-style: frame-based, deterministic, and snapped to exactly 1 once settled. */
export interface SpringConfig { mass: number; damping: number; stiffness: number }

export const SNAPPY: SpringConfig = { mass: 0.7, damping: 20, stiffness: 170 }
export const CAMERA: SpringConfig = { mass: 1, damping: 26, stiffness: 170 }
export const QUICK: SpringConfig = { mass: 0.6, damping: 18, stiffness: 260 }
export const SLOW: SpringConfig = { mass: 1, damping: 22, stiffness: 90 }

const cache = new Map<string, Float64Array>()
const EPS = 0.0004
const MAX = 240

/** Pre-integrated curve: index = frame since start at `fps`. Ends at the first settled frame, after which we return 1. */
function curve(cfg: SpringConfig, fps: number): Float64Array {
  const key = `${cfg.mass}:${cfg.damping}:${cfg.stiffness}:${fps}`
  const hit = cache.get(key)
  if (hit) return hit
  const out: number[] = []
  let x = 0, v = 0
  const sub = 8, dt = 1 / fps / sub
  for (let f = 0; f < MAX; f++) {
    out.push(x)
    if (f > 2 && Math.abs(1 - x) < EPS && Math.abs(v) < EPS * fps) break
    for (let i = 0; i < sub; i++) {
      const a = (-cfg.stiffness * (x - 1) - cfg.damping * v) / cfg.mass
      v += a * dt
      x += v * dt
    }
  }
  const arr = Float64Array.from(out)
  cache.set(key, arr)
  return arr
}

/** 0 before `start`, then the spring toward 1; exactly 1 from the settle frame on. */
export function spring(frame: number, start: number, cfg: SpringConfig = SNAPPY, fps = 60): number {
  const t = frame - start
  if (t <= 0) return 0
  const c = curve(cfg, fps)
  if (t >= c.length) return 1
  const i = Math.floor(t), f = t - i
  const a = c[i]!, b = i + 1 < c.length ? c[i + 1]! : 1
  return a + (b - a) * f
}

export function settleFrames(cfg: SpringConfig = SNAPPY, fps = 60): number { return curve(cfg, fps).length }

export function peak(cfg: SpringConfig = SNAPPY, fps = 60): number { return Math.max(...curve(cfg, fps)) }

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (t: number) => { const x = clamp(t); return x * x * (3 - 2 * x) }
export const easeInOut = (t: number) => { const x = clamp(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
/** Linear 0→1 between frames a and b. */
export const ramp = (f: number, a: number, b: number) => clamp((f - a) / (b - a))
