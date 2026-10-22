import { f32 } from './shared'
/**
 * Height-field water on an N×N grid covering the pool opening x,z ∈ [-1, 1].
 * Same update as Evan Wallace's WebGL Water, on the CPU: each cell's velocity pulls toward the
 * average of its four neighbours, then damps, then integrates into height.
 */
export class Water {
  readonly n: number
  readonly cell: number
  h: Float32Array
  v: Float32Array
  /** Height gradients dh/dx, dh/dz in world units, refreshed by `updateNormals`. */
  gx: Float32Array
  gz: Float32Array
  damping: number
  /** Wave speed multiplier (more sim steps per second, so the scheme stays stable). */
  speed = 1
  private swellT: Float32Array[] = []

  constructor(n: number) {
    this.n = n
    this.cell = 2 / n
    this.h = f32(n * n)
    this.v = f32(n * n)
    this.gx = f32(n * n)
    this.gz = f32(n * n)
    this.damping = Math.pow(0.995, 256 / n)
  }

  /** Wave life 0..1 → per-step velocity damping, normalised for grid size (0.71 ≈ the old 0.995 at 256²). */
  setLife(life: number) { this.damping = Math.pow(0.985 + 0.0138 * Math.max(0, Math.min(1, life)), 256 / this.n) }

  /**
   * Wind swell: a fixed set of short directional waves added to the gradients only (the sim heights stay untouched),
   * so the floor always shows the fine caustic web even when nobody touches the water. cos(a+b) is split into
   * per-column and per-row tables, so the cost is n² multiply-adds per wave.
   */
  swell(time: number, amp: number) {
    if (amp <= 0) return
    const { n, gx, gz } = this
    if (!this.swellT.length) for (let k = 0; k < 4; k++) this.swellT.push(new Float32Array(n))
    const [ca, sa, cb, sb] = this.swellT as [Float32Array, Float32Array, Float32Array, Float32Array]
    for (const w of SWELL) {
      const kx = Math.cos(w.dir) * w.k, kz = Math.sin(w.dir) * w.k
      const om = Math.sqrt(9.8 * w.k) * 0.32
      const A = (amp * w.slope) / w.k
      for (let i = 0; i < n; i++) {
        const x = -1 + ((i + 0.5) * 2) / n
        const a = kx * x - om * time + w.phase
        ca[i] = Math.cos(a); sa[i] = Math.sin(a)
        const b = kz * x
        cb[i] = Math.cos(b); sb[i] = Math.sin(b)
      }
      const ax = A * kx, az = A * kz
      for (let j = 0; j < n; j++) {
        const cbj = cb[j]!, sbj = sb[j]!, row = j * n
        for (let i = 0; i < n; i++) {
          const c = ca[i]! * cbj - sa[i]! * sbj
          gx[row + i]! += ax * c
          gz[row + i]! += az * c
        }
      }
    }
  }

  /** Steps per second that keep wave speed the same in world units at any grid size. */
  get stepsPerSecond() { return 120 * (this.n / 256) * this.speed }

  clear() { this.h.fill(0); this.v.fill(0); this.gx.fill(0); this.gz.fill(0) }

  /** Raised-cosine bump of `strength` (world units) and `radius` (world units) at (x, z). */
  drop(x: number, z: number, radius: number, strength: number) {
    const { n, h } = this
    const cx = ((x + 1) / 2) * n - 0.5, cz = ((z + 1) / 2) * n - 0.5
    const rc = (radius / 2) * n
    const x0 = Math.max(0, Math.floor(cx - rc)), x1 = Math.min(n - 1, Math.ceil(cx + rc))
    const z0 = Math.max(0, Math.floor(cz - rc)), z1 = Math.min(n - 1, Math.ceil(cz + rc))
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i - cx, j - cz) / rc
        if (d >= 1) continue
        h[j * n + i] += strength * (0.5 + 0.5 * Math.cos(Math.PI * d))
      }
    }
  }

  step() {
    const { n, h, v } = this
    const damp = this.damping
    for (let j = 0; j < n; j++) {
      const up = j > 0 ? -n : 0, dn = j < n - 1 ? n : 0
      const row = j * n
      for (let i = 0; i < n; i++) {
        const k = row + i
        const l = i > 0 ? k - 1 : k, r = i < n - 1 ? k + 1 : k
        const avg = (h[l]! + h[r]! + h[k + up]! + h[k + dn]!) * 0.25
        v[k] = (v[k]! + (avg - h[k]!) * 2) * damp
      }
    }
    for (let k = 0; k < n * n; k++) h[k]! += v[k]!
  }

  updateNormals() {
    const { n, h, gx, gz } = this
    const inv = 1 / (2 * this.cell)
    for (let j = 0; j < n; j++) {
      const up = j > 0 ? -n : 0, dn = j < n - 1 ? n : 0
      for (let i = 0; i < n; i++) {
        const k = j * n + i
        const l = i > 0 ? k - 1 : k, r = i < n - 1 ? k + 1 : k
        gx[k] = (h[r]! - h[l]!) * inv
        gz[k] = (h[k + dn]! - h[k + up]!) * inv
      }
    }
  }

  /** Sum of heights; the update conserves it up to damping, which only touches velocity. */
  volume() { let s = 0; for (let k = 0; k < this.h.length; k++) s += this.h[k]!; return s }

  /** Copy another grid's heights in, resampling (used when switching LITE/FULL). */
  resampleFrom(o: Water) {
    const { n } = this
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const si = Math.min(o.n - 1, Math.floor(((i + 0.5) / n) * o.n)), sj = Math.min(o.n - 1, Math.floor(((j + 0.5) / n) * o.n))
      this.h[j * n + i] = o.h[sj * o.n + si]!
      this.v[j * n + i] = o.v[sj * o.n + si]!
    }
    this.updateNormals()
  }
}

/** Bilinear sample of a grid field at world (x, z) in [-1, 1]. */
export function sampleGrid(f: Float32Array, n: number, x: number, z: number) {
  let fx = ((x + 1) / 2) * n - 0.5, fz = ((z + 1) / 2) * n - 0.5
  if (fx < 0) fx = 0; else if (fx > n - 1.001) fx = n - 1.001
  if (fz < 0) fz = 0; else if (fz > n - 1.001) fz = n - 1.001
  const i = fx | 0, j = fz | 0
  const tx = fx - i, tz = fz - j
  const k = j * n + i
  const a = f[k]! + (f[k + 1]! - f[k]!) * tx
  const b = f[k + n]! + (f[k + n + 1]! - f[k + n]!) * tx
  return a + (b - a) * tz
}

/** Wavenumbers (rad per world unit), directions and slopes of the wind swell; the pool is 2 units wide. */
const SWELL = [
  { k: 13.0, dir: 0.3, slope: 0.05, phase: 0 },
  { k: 17.5, dir: 1.9, slope: 0.042, phase: 1.3 },
  { k: 22.0, dir: -0.8, slope: 0.036, phase: 2.1 },
  { k: 29.0, dir: 2.7, slope: 0.03, phase: 4.0 },
  { k: 36.0, dir: 0.95, slope: 0.024, phase: 5.2 },
  { k: 45.0, dir: -2.2, slope: 0.018, phase: 0.7 },
]
