/**
 * A tiny RGBA area-chart rasterizer. Charts are painted in JS into a straight-
 * alpha RGBA buffer and pushed to an `<img>` with `setImagePixels`, so the
 * frosted window shows through everywhere the chart is empty.
 */

export type RGB = readonly [number, number, number]

export interface Series {
  /** One value per column, already scaled to 0..1. NaN = no data. */
  values: Float32Array<ArrayBufferLike>
  color: RGB
  fill?: boolean
  /** Peak fill alpha at the line (0..1). */
  fillAlpha?: number
  lineWidth?: number
}

export class History {
  readonly t: number[] = []
  readonly v: number[][] = []
  constructor(readonly keepMs = 180_000) {}

  push(t: number, values: number[]) {
    this.t.push(t)
    this.v.push(values)
    const cutoff = t - this.keepMs
    while (this.t.length > 2 && this.t[1]! < cutoff) {
      this.t.shift()
      this.v.shift()
    }
  }

  get length() {
    return this.t.length
  }

  last(): number[] | undefined {
    return this.v[this.v.length - 1]
  }

  /** Linear interpolation of series `k` at time `time`. */
  at(time: number, k: number): number {
    const t = this.t
    const n = t.length
    if (n === 0 || time < t[0]!) return NaN
    if (time >= t[n - 1]!) return this.v[n - 1]![k] ?? NaN
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (t[mid]! <= time) lo = mid
      else hi = mid
    }
    const a = t[lo]!
    const b = t[hi]!
    const f = b === a ? 0 : (time - a) / (b - a)
    const va = this.v[lo]![k] ?? 0
    const vb = this.v[hi]![k] ?? 0
    return va + (vb - va) * f
  }

  /** Resample series `k` into `columns` values covering [end - windowMs, end]. */
  resample(k: number, columns: number, end: number, windowMs: number, out: Float32Array<ArrayBufferLike> = new Float32Array(columns)) {
    const step = windowMs / Math.max(1, columns - 1)
    for (let x = 0; x < columns; x++) out[x] = this.at(end - windowMs + x * step, k)
    return out
  }

  max(k: number, from: number): number {
    let m = 0
    for (let i = 0; i < this.t.length; i++) if (this.t[i]! >= from) m = Math.max(m, this.v[i]![k] ?? 0)
    return m
  }
}

/** Paint series into `buf` (RGBA, w*h*4). The buffer is cleared to transparent first. */
export function paintChart(buf: Uint8Array, w: number, h: number, series: Series[], gridRows = 3, gridAlpha = 0.07) {
  buf.fill(0)
  const px = new Uint32Array(buf.buffer, buf.byteOffset, w * h)

  // Faint dashed horizontal grid.
  if (gridRows > 0) {
    const a = Math.round(gridAlpha * 255)
    const c = ((a << 24) | (255 << 16) | (255 << 8) | 255) >>> 0
    for (let g = 1; g <= gridRows; g++) {
      const y = Math.round((h * g) / (gridRows + 1))
      for (let x = 0; x < w; x++) if ((x >> 2) % 2 === 0) px[y * w + x] = c
    }
  }

  for (const s of series) {
    const [r, gg, b] = s.color
    const fillAlpha = s.fillAlpha ?? 0.34
    const lw = (s.lineWidth ?? 1.6) / 2
    const vals = s.values
    for (let x = 0; x < w; x++) {
      const v = vals[x]!
      if (Number.isNaN(v)) continue
      const y = (1 - Math.max(0, Math.min(1, v))) * (h - 2) + 1
      // Area fill: vertical gradient from fillAlpha at the line to ~0 at the bottom.
      if (s.fill !== false) {
        const top = Math.max(0, Math.floor(y))
        const span = h - y
        for (let yy = top; yy < h; yy++) {
          const cov = yy === top ? 1 - (y - top) : 1
          const f = 1 - (yy - y) / (span + 1)
          const fa = fillAlpha * f * f * cov
          blend(buf, (yy * w + x) * 4, r, gg, b, fa)
        }
      }
      // Anti-aliased line: cover the vertical extent between neighbours.
      const prev = x > 0 && !Number.isNaN(vals[x - 1]!) ? (1 - Math.max(0, Math.min(1, vals[x - 1]!))) * (h - 2) + 1 : y
      const next = x < w - 1 && !Number.isNaN(vals[x + 1]!) ? (1 - Math.max(0, Math.min(1, vals[x + 1]!))) * (h - 2) + 1 : y
      const y0 = Math.min(y, (y + prev) / 2, (y + next) / 2) - lw
      const y1 = Math.max(y, (y + prev) / 2, (y + next) / 2) + lw
      const from = Math.max(0, Math.floor(y0))
      const to = Math.min(h - 1, Math.ceil(y1))
      for (let yy = from; yy <= to; yy++) {
        const cov = Math.max(0, Math.min(yy + 1, y1) - Math.max(yy, y0))
        if (cov > 0) blend(buf, (yy * w + x) * 4, r, gg, b, Math.min(1, cov))
      }
    }
  }
}

/** Source-over blend in straight alpha. */
function blend(buf: Uint8Array, i: number, r: number, g: number, b: number, a: number) {
  if (a <= 0) return
  const da = buf[i + 3]! / 255
  const oa = a + da * (1 - a)
  if (oa <= 0) return
  const k = da * (1 - a)
  buf[i] = (r * a + buf[i]! * k) / oa
  buf[i + 1] = (g * a + buf[i + 1]! * k) / oa
  buf[i + 2] = (b * a + buf[i + 2]! * k) / oa
  buf[i + 3] = oa * 255
}

/** A "nice" axis ceiling: 1, 2, 5 x 10^n above `v`. */
export function niceCeil(v: number, min = 1): number {
  const x = Math.max(v, min)
  const p = 10 ** Math.floor(Math.log10(x))
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p
  return 10 * p
}
