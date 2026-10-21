import { lowerBound } from './series'
import type { RGB } from './theme'

export type ChartMode = 'line' | 'area' | 'bar'
export type DrawSeries = { xs: ArrayLike<number>; ys: ArrayLike<number>; rgb: RGB }
export type ChartSpec = {
  x0: number
  x1: number
  y0: number
  y1: number
  mode: ChartMode
  series: DrawSeries[]
  yTicks: number[]
  xTicks: number[]
  bg: RGB
  grid: RGB
  gridHi: RGB
}

/**
 * Software chart rasterizer into an opaque BGRA buffer, uploaded with `setImagePixels(…, { format: 'bgra' })`.
 * Lines are anti-aliased with a per-series coverage buffer (max-blended, so joints don't double up),
 * areas get a vertical alpha gradient, and dense data is decimated to a per-column min/max envelope.
 */
export class Raster {
  w = 0
  h = 0
  buf = new Uint8Array(0)
  private u32 = new Uint32Array(0)
  private cov = new Float32Array(0)
  private top = new Float32Array(0)
  private pts = new Float64Array(0)

  resize(w: number, h: number) {
    w = Math.max(1, Math.floor(w))
    h = Math.max(1, Math.floor(h))
    if (w === this.w && h === this.h) return
    this.w = w
    this.h = h
    this.buf = new Uint8Array(w * h * 4)
    this.u32 = new Uint32Array(this.buf.buffer)
    this.cov = new Float32Array(w * h)
    this.top = new Float32Array(w)
  }

  draw(spec: ChartSpec) {
    const { w, h } = this
    const [br, bg, bb] = spec.bg
    this.u32.fill((0xff << 24) | (br << 16) | (bg << 8) | bb)
    const sy = (v: number) => (1 - (v - spec.y0) / (spec.y1 - spec.y0)) * h
    const sx = (v: number) => ((v - spec.x0) / (spec.x1 - spec.x0)) * w

    for (const t of spec.xTicks) this.vline(Math.round(sx(t)), spec.grid, 0.7)
    for (const t of spec.yTicks) this.hline(Math.min(h - 1, Math.round(sy(t))), t === 0 ? spec.gridHi : spec.grid, 1)

    const visible = spec.series
    visible.forEach((s, si) => {
      const n = this.project(s, spec, sx, sy)
      if (n === 0) return
      if (spec.mode === 'bar') this.bars(s, spec, sx, sy, si, visible.length)
      else {
        if (spec.mode === 'area') this.area(n, s.rgb, spec.y0 <= 0 && spec.y1 >= 0 ? sy(0) : h)
        this.stroke(n, s.rgb, spec.mode === 'area' ? 1.0 : 1.1)
      }
    })
  }

  /** Writes pixel-space points for the visible slice into `pts`; returns the point count. */
  private project(s: DrawSeries, spec: ChartSpec, sx: (v: number) => number, sy: (v: number) => number) {
    const lo = Math.max(0, lowerBound(s.xs, spec.x0) - 1)
    const hi = Math.min(s.xs.length, lowerBound(s.xs, spec.x1) + 1)
    const count = hi - lo
    if (count <= 0) return 0
    const w = this.w
    if (this.pts.length < Math.min(count, 4 * w + 8) * 2) this.pts = new Float64Array(Math.max(count, 4 * w + 8) * 2 + 16)
    const pts = this.pts
    let n = 0
    if (count <= 2 * w) {
      for (let i = lo; i < hi; i++) {
        pts[n * 2] = sx(s.xs[i]!)
        pts[n * 2 + 1] = sy(s.ys[i]!)
        n++
      }
      return n
    }
    // Dense: one min/max pair per pixel column, ordered so the polyline zig-zags through the envelope.
    let col = -1
    let mn = 0
    let mx = 0
    let first = 0
    const flush = () => {
      if (col < 0) return
      const a = first <= (mn + mx) / 2 ? mn : mx
      const b = a === mn ? mx : mn
      pts[n * 2] = col + 0.5
      pts[n * 2 + 1] = sy(a)
      n++
      if (b !== a) {
        pts[n * 2] = col + 0.5
        pts[n * 2 + 1] = sy(b)
        n++
      }
    }
    for (let i = lo; i < hi; i++) {
      const c = Math.floor(sx(s.xs[i]!))
      const y = s.ys[i]!
      if (c !== col) {
        flush()
        col = c
        mn = mx = first = y
      } else {
        if (y < mn) mn = y
        if (y > mx) mx = y
      }
    }
    flush()
    return n
  }

  private blend(i: number, c: RGB, a: number) {
    const b = this.buf
    const o = i * 4
    b[o] = b[o]! + (c[2] - b[o]!) * a
    b[o + 1] = b[o + 1]! + (c[1] - b[o + 1]!) * a
    b[o + 2] = b[o + 2]! + (c[0] - b[o + 2]!) * a
  }

  private hline(y: number, c: RGB, a: number) {
    if (y < 0 || y >= this.h) return
    for (let x = 0; x < this.w; x++) this.blend(y * this.w + x, c, a)
  }

  private vline(x: number, c: RGB, a: number) {
    if (x < 0 || x >= this.w) return
    for (let y = 0; y < this.h; y++) this.blend(y * this.w + x, c, a)
  }

  private stroke(n: number, c: RGB, hw: number) {
    const { w, h, cov, pts } = this
    let bx0 = w
    let by0 = h
    let bx1 = -1
    let by1 = -1
    const r = hw + 1
    const seg = (ax: number, ay: number, bx: number, by: number) => {
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r))
      const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r))
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r))
      const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r))
      if (x0 > x1 || y0 > y1) return
      if (x0 < bx0) bx0 = x0
      if (y0 < by0) by0 = y0
      if (x1 > bx1) bx1 = x1
      if (y1 > by1) by1 = y1
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy || 1e-9
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5 - ay
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 - ax
          let t = (px * dx + py * dy) / len2
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const ex = px - t * dx
          const ey = py - t * dy
          const d = Math.sqrt(ex * ex + ey * ey)
          const a = hw + 0.5 - d
          if (a > 0) {
            const i = y * w + x
            const v = a > 1 ? 1 : a
            if (v > cov[i]!) cov[i] = v
          }
        }
      }
    }
    if (n === 1) seg(pts[0]!, pts[1]!, pts[0]!, pts[1]!)
    for (let k = 1; k < n; k++) seg(pts[(k - 1) * 2]!, pts[(k - 1) * 2 + 1]!, pts[k * 2]!, pts[k * 2 + 1]!)
    // Sparse data gets a dot on every sample.
    const spacing = n > 1 ? (pts[(n - 1) * 2]! - pts[0]!) / (n - 1) : 0
    if (spacing > 16) {
      const dr = hw + 1.6
      for (let k = 0; k < n; k++) {
        const cx = pts[k * 2]!
        const cy = pts[k * 2 + 1]!
        for (let y = Math.max(0, Math.floor(cy - dr - 1)); y <= Math.min(h - 1, Math.ceil(cy + dr + 1)); y++)
          for (let x = Math.max(0, Math.floor(cx - dr - 1)); x <= Math.min(w - 1, Math.ceil(cx + dr + 1)); x++) {
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            const a = Math.min(1, dr + 0.5 - d)
            const i = y * w + x
            if (a > cov[i]!) cov[i] = a
          }
      }
    }
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const i = y * w + x
        const a = cov[i]!
        if (a > 0) {
          this.blend(i, c, a)
          cov[i] = 0
        }
      }
  }

  private area(n: number, c: RGB, base: number) {
    const { w, h, top, pts } = this
    top.fill(Infinity)
    for (let k = 0; k < n; k++) {
      const ax = pts[k * 2]!
      const ay = pts[k * 2 + 1]!
      const bx = k + 1 < n ? pts[(k + 1) * 2]! : ax
      const by = k + 1 < n ? pts[(k + 1) * 2 + 1]! : ay
      const c0 = Math.max(0, Math.ceil(Math.min(ax, bx) - 0.5))
      const c1 = Math.min(w - 1, Math.floor(Math.max(ax, bx) - 0.5))
      for (let col = c0; col <= c1; col++) {
        const t = bx === ax ? 0 : (col + 0.5 - ax) / (bx - ax)
        const y = bx === ax ? Math.min(ay, by) : ay + (by - ay) * t
        if (y < top[col]!) top[col] = y
      }
    }
    const b = Math.max(0, Math.min(h, base))
    // One gradient for the whole chart (not per column), so peaks and valleys shade consistently.
    let peak = b
    for (let col = 0; col < w; col++) if (top[col]! < peak) peak = top[col]!
    peak = Math.max(0, peak)
    const span = Math.max(1, b - peak)
    for (let col = 0; col < w; col++) {
      const t = top[col]!
      if (!Number.isFinite(t)) continue
      const yTop = Math.max(0, Math.min(t, b))
      const yStart = Math.floor(yTop)
      for (let y = yStart; y < Math.ceil(b); y++) {
        const f = (y + 0.5 - peak) / span
        let a = 0.05 + 0.27 * (1 - f)
        if (y === yStart) a *= 1 - (yTop - yStart)
        this.blend(y * w + col, c, a)
      }
    }
  }

  private bars(s: DrawSeries, spec: ChartSpec, sx: (v: number) => number, sy: (v: number) => number, si: number, ns: number) {
    const { w, h } = this
    const lo = Math.max(0, lowerBound(s.xs, spec.x0) - 1)
    const hi = Math.min(s.xs.length, lowerBound(s.xs, spec.x1) + 1)
    if (hi <= lo) return
    const span = hi - lo > 1 ? (s.xs[hi - 1]! - s.xs[lo]!) / (hi - lo - 1) : (spec.x1 - spec.x0) / 20
    const slot = (span / (spec.x1 - spec.x0)) * w
    const base = Math.max(0, Math.min(h, spec.y0 <= 0 && spec.y1 >= 0 ? sy(0) : h))
    const drawBar = (cx: number, v: number, bw: number) => {
      const x0 = Math.round(cx + (si - ns / 2) * bw)
      const x1 = Math.max(x0 + 1, Math.round(cx + (si + 1 - ns / 2) * bw - (bw > 3 ? 1 : 0)))
      const y = sy(v)
      const ya = Math.max(0, Math.min(y, base))
      const yb = Math.min(h, Math.max(y, base))
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++)
        for (let yy = Math.floor(ya); yy < Math.ceil(yb); yy++) {
          const edge = Math.abs(yy + 0.5 - y) < 1.5
          this.blend(yy * w + x, s.rgb, edge ? 1 : 0.7)
        }
    }
    if (slot >= 3) {
      const bw = (slot * 0.74) / ns
      for (let i = lo; i < hi; i++) drawBar(sx(s.xs[i]!), s.ys[i]!, bw)
      return
    }
    // Dense: average into 3 px buckets.
    const bucket = 3
    let col = -1
    let sum = 0
    let cnt = 0
    for (let i = lo; i <= hi; i++) {
      const c = i < hi ? Math.floor(sx(s.xs[i]!) / bucket) : -2
      if (c !== col) {
        if (cnt) drawBar(col * bucket + bucket / 2, sum / cnt, (bucket - 1) / ns)
        col = c
        sum = 0
        cnt = 0
      }
      if (i < hi) {
        sum += s.ys[i]!
        cnt++
      }
    }
  }
}
