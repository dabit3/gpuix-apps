export interface WhipOptions {
  segments: number
  length: number
  iterations: number
  gravity: number
  damping: number
  crackSpeed: number
  crackExtension: number
  debounceMs: number
}

export const DEFAULT_WHIP: WhipOptions = {
  segments: 40,
  length: 420,
  iterations: 10,
  gravity: 900,
  damping: 0.99,
  crackSpeed: 3500,
  crackExtension: 0.86,
  debounceMs: 400,
}

export interface Crack {
  x: number
  y: number
  speed: number
  at: number
}

export const STEP = 1 / 120

export class Whip {
  readonly opts: WhipOptions
  readonly x: Float64Array
  readonly y: Float64Array
  readonly px: Float64Array
  readonly py: Float64Array
  handleX: number
  handleY: number
  targetX: number
  targetY: number
  tipSpeed = 0
  extension = 0
  private lastCrackAt = -Infinity
  private clock = 0

  constructor(x: number, y: number, opts: Partial<WhipOptions> = {}) {
    this.opts = { ...DEFAULT_WHIP, ...opts }
    const n = this.opts.segments + 1
    this.x = new Float64Array(n)
    this.y = new Float64Array(n)
    this.px = new Float64Array(n)
    this.py = new Float64Array(n)
    this.handleX = this.targetX = x
    this.handleY = this.targetY = y
    this.reset(x, y)
  }

  get segLen() {
    return this.opts.length / this.opts.segments
  }

  get timeMs() {
    return this.clock * 1000
  }

  reset(x: number, y: number) {
    const seg = this.segLen
    for (let i = 0; i < this.x.length; i++) {
      this.x[i] = this.px[i] = x
      this.y[i] = this.py[i] = y + i * seg
    }
    this.handleX = this.targetX = x
    this.handleY = this.targetY = y
  }

  setLength(length: number) {
    this.opts.length = Math.max(80, Math.min(900, length))
  }

  pointTo(x: number, y: number) {
    this.targetX = x
    this.targetY = y
  }

  /** Advance one fixed step. Returns a crack when the tip breaks the speed threshold. */
  step(dt = STEP): Crack | null {
    this.clock += dt
    const { gravity, damping, iterations } = this.opts
    const n = this.x.length
    const follow = 1 - Math.exp(-dt / 0.008)
    this.handleX += (this.targetX - this.handleX) * follow
    this.handleY += (this.targetY - this.handleY) * follow

    for (let i = 1; i < n; i++) {
      const vx = (this.x[i] - this.px[i]) * damping
      const vy = (this.y[i] - this.py[i]) * damping
      this.px[i] = this.x[i]
      this.py[i] = this.y[i]
      this.x[i] += vx
      this.y[i] += vy + gravity * dt * dt
    }
    this.px[0] = this.x[0]
    this.py[0] = this.y[0]
    this.x[0] = this.handleX
    this.y[0] = this.handleY

    const seg = this.segLen
    for (let k = 0; k < iterations; k++) {
      for (let i = 0; i < n - 1; i++) {
        const dx = this.x[i + 1] - this.x[i]
        const dy = this.y[i + 1] - this.y[i]
        const d = Math.hypot(dx, dy) || 1e-6
        const diff = (d - seg) / d
        if (i === 0) {
          this.x[1] -= dx * diff
          this.y[1] -= dy * diff
        } else {
          this.x[i] += dx * diff * 0.5
          this.y[i] += dy * diff * 0.5
          this.x[i + 1] -= dx * diff * 0.5
          this.y[i + 1] -= dy * diff * 0.5
        }
      }
      // Light bending stiffness: stop the rope folding onto itself.
      for (let i = 0; i < n - 2; i++) {
        const dx = this.x[i + 2] - this.x[i]
        const dy = this.y[i + 2] - this.y[i]
        const d = Math.hypot(dx, dy) || 1e-6
        const min = seg * 1.5
        if (d < min) {
          const diff = ((d - min) / d) * 0.25
          if (i === 0) {
            this.x[2] -= dx * diff
            this.y[2] -= dy * diff
          } else {
            this.x[i] += dx * diff * 0.5
            this.y[i] += dy * diff * 0.5
            this.x[i + 2] -= dx * diff * 0.5
            this.y[i + 2] -= dy * diff * 0.5
          }
        }
      }
    }

    // Follow-the-leader clamp: the rope can stretch a little, never like taffy.
    const max = seg * 1.03
    for (let i = 1; i < n; i++) {
      const dx = this.x[i] - this.x[i - 1]
      const dy = this.y[i] - this.y[i - 1]
      const d = Math.hypot(dx, dy)
      if (d > max) {
        this.x[i] = this.x[i - 1] + (dx / d) * max
        this.y[i] = this.y[i - 1] + (dy / d) * max
      }
    }

    const t = n - 1
    this.tipSpeed = Math.hypot(this.x[t] - this.px[t], this.y[t] - this.py[t]) / dt
    this.extension = Math.hypot(this.x[t] - this.x[0], this.y[t] - this.y[0]) / this.opts.length
    const now = this.clock * 1000
    if (
      this.tipSpeed > this.opts.crackSpeed &&
      this.extension > this.opts.crackExtension &&
      now - this.lastCrackAt >= this.opts.debounceMs
    ) {
      this.lastCrackAt = now
      return { x: this.x[t], y: this.y[t], speed: this.tipSpeed, at: now }
    }
    return null
  }

  /** Total motion of the last step, used to skip repaints when the whip is at rest. */
  motion() {
    let m = 0
    for (let i = 0; i < this.x.length; i++) m += Math.abs(this.x[i] - this.px[i]) + Math.abs(this.y[i] - this.py[i])
    return m
  }
}

/** Catmull-Rom samples through the rope points, `per` samples per segment. */
export function sampleCurve(xs: ArrayLike<number>, ys: ArrayLike<number>, per: number, out?: Float64Array) {
  const n = xs.length
  const count = (n - 1) * per + 1
  const res = out && out.length >= count * 2 ? out : new Float64Array(count * 2)
  let k = 0
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1)
    const i2 = i + 1
    const i3 = Math.min(n - 1, i + 2)
    for (let s = 0; s < per; s++) {
      const t = s / per
      const t2 = t * t
      const t3 = t2 * t
      const a = -0.5 * t3 + t2 - 0.5 * t
      const b = 1.5 * t3 - 2.5 * t2 + 1
      const c = -1.5 * t3 + 2 * t2 + 0.5 * t
      const d = 0.5 * t3 - 0.5 * t2
      res[k++] = a * xs[i0] + b * xs[i] + c * xs[i2] + d * xs[i3]
      res[k++] = a * ys[i0] + b * ys[i] + c * ys[i2] + d * ys[i3]
    }
  }
  res[k++] = xs[n - 1]
  res[k++] = ys[n - 1]
  return { points: res, count }
}
