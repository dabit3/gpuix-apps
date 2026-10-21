import type { Field } from './parse'
import { SERIES_COLORS } from './theme'

export type Series = {
  name: string
  unit?: string
  color: string
  xs: number[]
  ys: number[]
  visible: boolean
  /** The user toggled it; auto-visibility leaves it alone from then on. */
  pinned: boolean
}

export type Stats = { n: number; min: number; max: number; avg: number; p95: number; last: number }

const AUTO_VISIBLE = 4
const SETTLE = 3
const MAX_POINTS = 250_000

/** Time-stamped samples for every series a source has produced. */
export class Store {
  series: Series[] = []
  private byName = new Map<string, Series>()
  rows = 0
  version = 0

  constructor(private columns: string[] = []) {}

  add(fields: Field[], x: number) {
    for (const f of fields) {
      if (!Number.isFinite(f.value)) continue
      if (this.columns.length && !this.columns.includes(f.name)) continue
      let s = this.byName.get(f.name)
      if (!s) {
        s = { name: f.name, unit: f.unit, color: '', xs: [], ys: [], visible: false, pinned: false }
        this.byName.set(f.name, s)
        this.series.push(s)
        if (this.columns.length) this.series.sort((a, b) => this.columns.indexOf(a.name) - this.columns.indexOf(b.name))
        this.series.forEach((t, i) => (t.color = SERIES_COLORS[i % SERIES_COLORS.length]!))
      }
      if (f.unit && !s.unit) s.unit = f.unit
      // Out-of-order x (a CSV rewritten in place) restarts the series.
      const last = s.xs[s.xs.length - 1]
      if (last !== undefined && x < last) {
        s.xs.length = 0
        s.ys.length = 0
      }
      s.xs.push(x)
      s.ys.push(f.value)
      if (s.xs.length > MAX_POINTS) {
        s.xs.splice(0, s.xs.length - MAX_POINTS)
        s.ys.splice(0, s.ys.length - MAX_POINTS)
      }
    }
    this.rows++
    this.autoVisibility()
    this.version++
  }

  get(name: string) {
    return this.byName.get(name)
  }

  /**
   * Show the interesting columns: skip constants (ping's ttl) and counters (icmp_seq),
   * and cap the default view at a few series. With `-c` every requested column shows.
   */
  private autoVisibility() {
    let shown = 0
    for (const s of this.series) {
      if (s.pinned) {
        if (s.visible) shown++
        continue
      }
      if (this.columns.length) {
        s.visible = true
        continue
      }
      const n = s.ys.length
      if (n < SETTLE) {
        s.visible = false
        continue
      }
      if (n > 64 && s.visible === false && shown >= AUTO_VISIBLE) continue
      const ys = s.ys.slice(-64)
      const constant = ys.every((v) => v === ys[0])
      const step = ys[1]! - ys[0]!
      const counter = step !== 0 && Number.isInteger(step) && ys.every((v, i) => i === 0 || v - ys[i - 1]! === step)
      s.visible = !constant && !counter && shown < AUTO_VISIBLE
      if (s.visible) shown++
    }
    // Everything filtered out (a single constant column): show it anyway rather than an empty chart.
    if (!shown) for (const s of this.series) if (!s.pinned && s.ys.length >= SETTLE) return void (s.visible = true)
  }

  toggle(index: number) {
    const s = this.series[index]
    if (!s) return
    s.visible = !s.visible
    s.pinned = true
    this.version++
  }

  firstX() {
    let x = Infinity
    for (const s of this.series) if (s.xs.length) x = Math.min(x, s.xs[0]!)
    return x
  }

  lastX() {
    let x = -Infinity
    for (const s of this.series) if (s.xs.length) x = Math.max(x, s.xs[s.xs.length - 1]!)
    return x
  }
}

/** First index with xs[i] >= x. */
export function lowerBound(xs: ArrayLike<number>, x: number) {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid]! < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function nearestIndex(xs: ArrayLike<number>, x: number) {
  const i = lowerBound(xs, x)
  if (i <= 0) return 0
  if (i >= xs.length) return xs.length - 1
  return x - xs[i - 1]! <= xs[i]! - x ? i - 1 : i
}

export function stats(s: Pick<Series, 'xs' | 'ys'>, x0 = -Infinity, x1 = Infinity): Stats | null {
  const lo = lowerBound(s.xs, x0)
  const hi = lowerBound(s.xs, x1 + 1e-9)
  const n = hi - lo
  if (n <= 0) return null
  const v = Float64Array.from(s.ys.slice(lo, hi)).sort()
  let sum = 0
  for (let i = 0; i < n; i++) sum += v[i]!
  return { n, min: v[0]!, max: v[n - 1]!, avg: sum / n, p95: v[Math.max(0, Math.ceil(0.95 * n) - 1)]!, last: s.ys[hi - 1]! }
}

export function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag
}

export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min]
  const step = niceStep(max - min, count)
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

const TIME_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400]

export function timeTicks(x0: number, x1: number, count: number): number[] {
  const raw = (x1 - x0) / Math.max(1, count)
  const step = TIME_STEPS.find((s) => s >= raw) ?? 86400 * Math.ceil(raw / 86400)
  const tz = new Date().getTimezoneOffset() * -60
  const out: number[] = []
  for (let v = Math.ceil((x0 + tz) / step) * step - tz; v <= x1; v += step) out.push(v)
  return out
}

export function formatClock(t: number, span: number) {
  const d = new Date(t * 1000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  if (span > 6 * 3600) return `${hh}:${mm}`
  if (span < 2) return `${mm}:${ss}.${String(d.getMilliseconds()).padStart(3, '0').slice(0, 1)}`
  return `${hh}:${mm}:${ss}`
}

export function formatValue(v: number, unit?: string, step?: number) {
  const a = Math.abs(v)
  let s: string
  if (unit === 'B') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0
    let x = v
    while (Math.abs(x) >= 1024 && i < units.length - 1) {
      x /= 1024
      i++
    }
    return `${x.toFixed(Math.abs(x) >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
  }
  if (a >= 1e9) s = `${(v / 1e9).toFixed(a >= 1e11 ? 0 : 1)}G`
  else if (a >= 1e6) s = `${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`
  else if (a >= 1e5) s = `${(v / 1e3).toFixed(0)}k`
  else {
    const ref = step !== undefined ? step : a
    const d = ref === 0 ? 0 : ref >= 100 ? 0 : ref >= 10 ? (step !== undefined ? 0 : 1) : ref >= 1 ? (step !== undefined && Number.isInteger(step) ? 0 : 1) : ref >= 0.1 ? 2 : 3
    s = v.toFixed(Math.min(d, 4))
  }
  if (!unit) return s
  return unit === '%' ? `${s}%` : `${s} ${unit}`
}
