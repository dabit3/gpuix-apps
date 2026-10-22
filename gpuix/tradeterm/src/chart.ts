import type { BacktestResult } from './backtest'
import type { Series } from './indicators'
import { Canvas, rgba } from './raster'
import type { Drawing } from './store'
import type { Bar } from './types'

export const T = {
  bg: '#0a0c10',
  fg: '#f0f3f6',
  panel: '#0e1117',
  raised: '#161b22',
  border: '#272c35',
  borderHi: '#3d4450',
  dim: '#9ea7b3',
  faint: '#6e7681',
  grid: '#151a21',
  blue: '#71b7ff',
  green: '#26cd4d',
  red: '#ff6a69',
  redSoft: '#ff9492',
  yellow: '#f0b72f',
  cyan: '#39c5cf',
  orange: '#ffb757',
}

export type View = { start: number; end: number }

export type Frame = {
  w: number
  h: number
  start: number
  end: number
  yMin: number
  yMax: number
  log: boolean
  top: number
  bottom: number
}

export const xOf = (f: Frame, i: number) => ((i + 0.5 - f.start) / (f.end - f.start)) * f.w
export const iOf = (f: Frame, x: number) => f.start + (x / f.w) * (f.end - f.start) - 0.5
const tf = (f: Frame, p: number) => (f.log ? Math.log(Math.max(1e-12, p)) : p)
export const yOf = (f: Frame, p: number) => f.top + (1 - (tf(f, p) - tf(f, f.yMin)) / (tf(f, f.yMax) - tf(f, f.yMin))) * (f.bottom - f.top)
export function pOf(f: Frame, y: number) {
  const a = tf(f, f.yMin)
  const b = tf(f, f.yMax)
  const v = a + (1 - (y - f.top) / (f.bottom - f.top)) * (b - a)
  return f.log ? Math.exp(v) : v
}

/** Fractional bar index of a timestamp (extrapolates past either end). */
export function indexOfTime(bars: Bar[], t: number): number {
  const n = bars.length
  if (!n) return 0
  const step = n > 1 ? bars[1]!.t - bars[0]!.t : 60
  if (t <= bars[0]!.t) return (t - bars[0]!.t) / step
  if (t >= bars[n - 1]!.t) return n - 1 + (t - bars[n - 1]!.t) / step
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (bars[m]!.t <= t) lo = m
    else hi = m
  }
  return lo + (t - bars[lo]!.t) / Math.max(1, bars[hi]!.t - bars[lo]!.t)
}

export function timeOfIndex(bars: Bar[], i: number): number {
  const n = bars.length
  if (!n) return 0
  const step = n > 1 ? bars[n - 1]!.t - bars[n - 2]!.t : 60
  const k = Math.floor(i)
  if (k >= 0 && k < n - 1) return bars[k]!.t + (i - k) * (bars[k + 1]!.t - bars[k]!.t)
  return k < 0 ? bars[0]!.t + i * step : bars[n - 1]!.t + (i - (n - 1)) * step
}

export function niceStep(raw: number) {
  const e = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / e
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e
}

export function niceTicks(min: number, max: number, target: number): number[] {
  if (!(max > min)) return [min]
  const step = niceStep((max - min) / Math.max(1, target))
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(12))
  return out
}

const TIME_STEPS = [60, 300, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400, 172800, 604800, 2592000, 7776000, 31536000]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function timeTicks(bars: Bar[], f: Frame, minPx = 96): { x: number; label: string; major: boolean }[] {
  if (bars.length < 2) return []
  const t0 = timeOfIndex(bars, f.start)
  const t1 = timeOfIndex(bars, f.end)
  const secPerPx = (t1 - t0) / f.w
  const step = TIME_STEPS.find((s) => s / secPerPx >= minPx) ?? 31536000
  const out: { x: number; label: string; major: boolean }[] = []
  const lastLabel = { x: -1e9 }
  const push = (t: number) => {
    const x = xOf(f, indexOfTime(bars, t)) - xOf(f, 0) + xOf(f, 0)
    if (x < 0 || x > f.w || x - lastLabel.x < minPx * 0.6) return
    lastLabel.x = x
    const d = new Date(t * 1000)
    const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0
    const month1 = midnight && d.getUTCDate() === 1
    let label: string
    if (step >= 31536000) label = String(d.getUTCFullYear())
    else if (month1 && d.getUTCMonth() === 0) label = String(d.getUTCFullYear())
    else if (month1 && step >= 86400) label = MONTHS[d.getUTCMonth()]!
    else if (midnight) label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
    else label = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
    out.push({ x, label, major: midnight })
  }
  if (step >= 2592000) {
    const months = Math.round(step / 2592000)
    const d = new Date(t0 * 1000)
    let y = d.getUTCFullYear()
    let m = d.getUTCMonth()
    for (let k = 0; k < 400; k++) {
      const t = Date.UTC(y, m, 1) / 1000
      if (t > t1) break
      if (t >= t0 && (m % months === 0 || months === 12)) {
        if (months !== 12 || m === 0) push(t)
      }
      m++
      if (m === 12) {
        m = 0
        y++
      }
    }
  } else {
    const offset = step === 604800 ? 4 * 86400 : 0
    for (let t = Math.ceil((t0 - offset) / step) * step + offset; t <= t1; t += step) push(t)
  }
  return out
}

export function fmtPrice(p: number, ref = p): string {
  if (!Number.isFinite(p)) return '—'
  const a = Math.abs(ref)
  const d = a >= 1000 ? 2 : a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 7
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function fmtCompact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toFixed(a >= 10 ? 0 : 2)
}

export function fmtTime(t: number, withTime = true) {
  const d = new Date(t * 1000)
  const date = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} '${String(d.getUTCFullYear()).slice(2)}`
  return withTime ? `${date}  ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` : date
}

const visRange = (n: number, f: { start: number; end: number }) => [Math.max(0, Math.floor(f.start)), Math.min(n - 1, Math.ceil(f.end))] as const

export type MainSpec = {
  bars: Bar[]
  view: View
  log: boolean
  chart: 'candles' | 'heikin' | 'line' | 'area'
  overlays: Series[]
  drawings: Drawing[]
  pending?: Drawing | null
  backtest?: BacktestResult | null
  highlightTrade?: number | null
}

export function mainFrame(spec: MainSpec, w: number, h: number): Frame {
  const { bars, view } = spec
  const [a, b] = visRange(bars.length, view)
  let lo = Infinity
  let hi = -Infinity
  for (let i = a; i <= b; i++) {
    const bar = bars[i]
    if (!bar) continue
    if (bar.l < lo) lo = bar.l
    if (bar.h > hi) hi = bar.h
  }
  for (const s of spec.overlays) {
    if (s.style !== 'band-upper' && s.style !== 'band-lower') continue
    for (let i = a; i <= b; i++) {
      const v = s.values[i]!
      if (Number.isNaN(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  if (hi - lo < hi * 1e-6) {
    hi += Math.abs(hi) * 0.01 + 1e-9
    lo -= Math.abs(lo) * 0.01 + 1e-9
  }
  const top = 14
  const bottom = Math.round(h * 0.82)
  if (spec.log && lo > 0) {
    const pad = (Math.log(hi) - Math.log(lo)) * 0.04
    return { w, h, start: view.start, end: view.end, yMin: Math.exp(Math.log(lo) - pad), yMax: Math.exp(Math.log(hi) + pad), log: true, top, bottom }
  }
  const pad = (hi - lo) * 0.04
  return { w, h, start: view.start, end: view.end, yMin: lo - pad, yMax: hi + pad, log: false, top, bottom }
}

export function drawMain(cv: Canvas, spec: MainSpec, f: Frame, priceTicks: number[], xTicks: { x: number }[]) {
  const bars = spec.bars
  cv.clear(rgba(T.bg))
  const grid = rgba(T.grid)
  for (const t of xTicks) cv.vline(t.x, grid)
  for (const p of priceTicks) cv.hline(yOf(f, p), grid)
  if (!bars.length) return
  const [a, b] = visRange(bars.length, f)
  // A view left over from a longer series (e.g. BTC → a newly listed coin) can sit past the last bar for one frame.
  if (b < a) return
  const pxPerBar = f.w / (f.end - f.start)
  const up = rgba(T.green)
  const dn = rgba(T.red)

  // Volume along the bottom of the pane.
  let vmax = 0
  for (let i = a; i <= b; i++) vmax = Math.max(vmax, bars[i]!.v)
  const vh = f.h * 0.16
  const upV = rgba(T.green, 0.18)
  const dnV = rgba(T.red, 0.18)
  forColumns(bars, a, b, f, pxPerBar, (x0, x1, o, h, l, c, v) => {
    const hh = vmax > 0 ? (v / vmax) * vh : 0
    cv.fillRect(x0, f.h - hh, Math.max(1, x1 - x0), hh, c >= o ? upV : dnV)
    void h
    void l
  })

  // Bollinger-style bands get a translucent fill first.
  const xs = new Float64Array(b - a + 1)
  for (let i = a; i <= b; i++) xs[i - a] = xOf(f, i)
  const ys = (vals: ArrayLike<number>) => {
    const out = new Float64Array(b - a + 1)
    for (let i = a; i <= b; i++) out[i - a] = Number.isNaN(vals[i]!) ? NaN : yOf(f, vals[i]!)
    return out
  }
  const upper = spec.overlays.find((s) => s.style === 'band-upper')
  const lower = spec.overlays.find((s) => s.style === 'band-lower')
  if (upper && lower) cv.fillBetween(xs, ys(upper.values), ys(lower.values), xs.length, rgba(upper.color, 0.07))

  // Price.
  const src = spec.chart === 'heikin' ? heikin(bars) : bars
  if (spec.chart === 'line' || spec.chart === 'area') {
    const cy = ys(src.map((x) => x.c))
    if (spec.chart === 'area') cv.area(xs, cy, xs.length, f.bottom, rgba(T.blue), 0.3, 0.0)
    cv.polyline(xs, cy, xs.length, rgba(T.blue), 1.6)
  } else {
    const body = Math.max(1, Math.floor(pxPerBar * 0.72) | 1)
    forColumns(src, a, b, f, pxPerBar, (x0, x1, o, h, l, c) => {
      const col = c >= o ? up : dn
      const cx = Math.floor((x0 + x1) / 2)
      const yh = yOf(f, h)
      const yl = yOf(f, l)
      const yo = yOf(f, o)
      const yc = yOf(f, c)
      if (pxPerBar < 2) {
        cv.vline(cx, col, yh, Math.max(yl, yh + 1))
        return
      }
      cv.vline(cx, col, yh, yl + 1)
      const top = Math.min(yo, yc)
      const hgt = Math.max(1, Math.abs(yc - yo))
      cv.fillRect(cx - (body >> 1), top, body, hgt, col)
    })
  }

  // Last price: a quiet dashed line across the pane.
  const lastBar = bars[bars.length - 1]!
  cv.hline(yOf(f, lastBar.c), rgba(lastBar.c >= lastBar.o ? T.green : T.red, 0.5), 3)

  for (const s of spec.overlays) {
    if (s.style === 'band-upper' || s.style === 'band-lower') cv.polyline(xs, ys(s.values), xs.length, rgba(s.color, 0.85), 1)
    else cv.polyline(xs, ys(s.values), xs.length, rgba(s.color), s.width ?? 1.4)
  }

  // Trades from the backtest.
  if (spec.backtest) {
    spec.backtest.trades.forEach((tr, k) => {
      if (tr.exitIndex < a - 1 || tr.entryIndex > b + 1) return
      const hl = spec.highlightTrade === k
      const xe = xOf(f, tr.entryIndex)
      const xx = xOf(f, tr.exitIndex)
      const col = rgba(tr.pnl >= 0 ? T.green : T.red, hl ? 1 : 0.55)
      if (hl) cv.fillRect(Math.min(xe, xx), f.top, Math.max(2, Math.abs(xx - xe)), f.bottom - f.top, rgba(tr.pnl >= 0 ? T.green : T.red, 0.08))
      cv.line(xe, yOf(f, tr.entryPrice), xx, yOf(f, tr.exitPrice), col, hl ? 1.6 : 1)
      const s = pxPerBar < 3 ? 4 : 6
      cv.triangle(xe, yOf(f, bars[tr.entryIndex]!.l) + 5, s, true, rgba(T.green))
      cv.triangle(xx, yOf(f, bars[tr.exitIndex]!.h) - 5, s, false, rgba(T.fg, 0.85))
    })
  }

  for (const d of [...spec.drawings, ...(spec.pending ? [spec.pending] : [])]) drawDrawing(cv, bars, f, d)
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

function drawDrawing(cv: Canvas, bars: Bar[], f: Frame, d: Drawing) {
  const x0 = xOf(f, indexOfTime(bars, d.a.t))
  const x1 = xOf(f, indexOfTime(bars, d.b.t))
  const y0 = yOf(f, d.a.p)
  const y1 = yOf(f, d.b.p)
  const c = rgba(T.blue)
  if (d.kind === 'trend') {
    cv.line(x0, y0, x1, y1, c, 1.6)
    for (const [x, y] of [
      [x0, y0],
      [x1, y1],
    ] as const)
      cv.fillRect(x - 2, y - 2, 5, 5, c)
  } else if (d.kind === 'hline') {
    cv.hline(y0, rgba(T.yellow), 0)
    cv.hline(y0 + 1, rgba(T.yellow, 0.25), 0)
  } else if (d.kind === 'rect') {
    cv.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), rgba(T.blue, 0.1))
    cv.hline(y0, c, 0, Math.min(x0, x1), Math.max(x0, x1))
    cv.hline(y1, c, 0, Math.min(x0, x1), Math.max(x0, x1))
    cv.vline(x0, c, y0, y1)
    cv.vline(x1, c, y0, y1)
  } else if (d.kind === 'fib') {
    const xa = Math.min(x0, x1)
    const xb = Math.max(f.w, Math.max(x0, x1))
    // One accent: the golden pocket (0.5–0.618) is tinted, the other levels are hairlines.
    const yAt = (lv: number) => yOf(f, d.b.p + (d.a.p - d.b.p) * lv)
    const g0 = yAt(0.5)
    const g1 = yAt(0.618)
    cv.fillRect(xa, Math.min(g0, g1), xb - xa, Math.abs(g1 - g0), rgba(T.blue, 0.09))
    FIB_LEVELS.forEach((lv) => {
      const golden = lv === 0.5 || lv === 0.618
      cv.hline(yAt(lv), golden ? rgba(T.blue, 0.9) : rgba(T.dim, lv === 0 || lv === 1 ? 0.7 : 0.38), 0, xa, xb)
    })
    cv.line(x0, y0, x1, y1, rgba(T.dim, 0.45), 1)
  }
}

/** Calls `fn` once per bar, or once per pixel column with min/max aggregation when bars are denser than pixels. */
function forColumns(bars: Bar[], a: number, b: number, f: Frame, pxPerBar: number, fn: (x0: number, x1: number, o: number, h: number, l: number, c: number, v: number) => void) {
  if (pxPerBar >= 1) {
    for (let i = a; i <= b; i++) {
      const bar = bars[i]!
      const x = xOf(f, i)
      fn(x - pxPerBar / 2, x + pxPerBar / 2, bar.o, bar.h, bar.l, bar.c, bar.v)
    }
    return
  }
  let col = -1
  let o = 0
  let h = 0
  let l = 0
  let c = 0
  let v = 0
  for (let i = a; i <= b; i++) {
    const bar = bars[i]!
    const x = Math.floor(xOf(f, i))
    if (x !== col) {
      if (col >= 0) fn(col, col + 1, o, h, l, c, v / Math.max(1, 1 / pxPerBar))
      col = x
      o = bar.o
      h = bar.h
      l = bar.l
      v = 0
    }
    h = Math.max(h, bar.h)
    l = Math.min(l, bar.l)
    c = bar.c
    v += bar.v
  }
  if (col >= 0) fn(col, col + 1, o, h, l, c, v / Math.max(1, 1 / pxPerBar))
}

let haCache: { src: Bar[]; out: Bar[] } | null = null
function heikin(bars: Bar[]): Bar[] {
  if (haCache?.src === bars) return haCache.out
  const out: Bar[] = []
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const c = (b.o + b.h + b.l + b.c) / 4
    const o = i === 0 ? (b.o + b.c) / 2 : (out[i - 1]!.o + out[i - 1]!.c) / 2
    out.push({ t: b.t, o, c, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), v: b.v })
  }
  haCache = { src: bars, out }
  return out
}

// ---------------------------------------------------------------------------------------------
// Oscillator panes

export type OscSpec = { series: Series[]; view: View; n: number; range?: [number, number]; levels?: number[] }

export function oscFrame(spec: OscSpec, w: number, h: number): Frame {
  let lo = Infinity
  let hi = -Infinity
  if (spec.range) [lo, hi] = spec.range
  else {
    const [a, b] = visRange(spec.n, spec.view)
    for (const s of spec.series)
      for (let i = a; i <= b; i++) {
        const v = s.values[i]!
        if (Number.isNaN(v)) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    if (!Number.isFinite(lo)) {
      lo = -1
      hi = 1
    }
    if (spec.levels?.includes(0)) {
      const m = Math.max(Math.abs(lo), Math.abs(hi))
      lo = -m
      hi = m
    }
    const pad = (hi - lo) * 0.08 || 1
    lo -= pad
    hi += pad
  }
  return { w, h, start: spec.view.start, end: spec.view.end, yMin: lo, yMax: hi, log: false, top: 6, bottom: h - 6 }
}

export function drawOsc(cv: Canvas, spec: OscSpec, f: Frame, xTicks: { x: number }[]) {
  cv.clear(rgba(T.bg))
  for (const t of xTicks) cv.vline(t.x, rgba(T.grid))
  for (const lv of spec.levels ?? []) cv.hline(yOf(f, lv), rgba(T.borderHi), 4)
  if (spec.range && spec.levels?.length === 2) cv.fillRect(0, yOf(f, spec.levels[1]!), f.w, yOf(f, spec.levels[0]!) - yOf(f, spec.levels[1]!), rgba(T.blue, 0.035))
  const [a, b] = visRange(spec.n, f)
  if (b < a) return
  const pxPerBar = f.w / (f.end - f.start)
  const xs = new Float64Array(b - a + 1)
  for (let i = a; i <= b; i++) xs[i - a] = xOf(f, i)
  for (const s of spec.series) {
    if (s.style === 'histogram') {
      const zero = yOf(f, 0)
      const bw = Math.max(1, Math.floor(pxPerBar * 0.7))
      for (let i = a; i <= b; i++) {
        const v = s.values[i]!
        if (Number.isNaN(v)) continue
        const prev = s.values[i - 1] ?? v
        const rising = v >= prev
        const col = v >= 0 ? rgba(T.green, rising ? 0.75 : 0.35) : rgba(T.red, rising ? 0.35 : 0.75)
        const y = yOf(f, v)
        cv.fillRect(xOf(f, i) - bw / 2, Math.min(y, zero), bw, Math.max(1, Math.abs(y - zero)), col)
      }
      continue
    }
    const ys = new Float64Array(b - a + 1)
    for (let i = a; i <= b; i++) ys[i - a] = Number.isNaN(s.values[i]!) ? NaN : yOf(f, s.values[i]!)
    cv.polyline(xs, ys, xs.length, rgba(s.color), s.width ?? 1.3)
  }
}

// ---------------------------------------------------------------------------------------------
// Equity curve + drawdown for the backtest panel.

export function drawEquity(cv: Canvas, bars: Bar[], r: BacktestResult, capital: number, highlight?: { a: number; b: number } | null, progress = 1) {
  cv.clear(rgba(T.panel))
  const n = r.equity.length
  if (n < 2) return
  const w = cv.w
  const h = cv.h
  const ddH = Math.round(h * 0.26)
  const eqH = h - ddH - 4
  let lo = Infinity
  let hi = -Infinity
  const hold = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    hold[i] = (capital * bars[i]!.c) / bars[0]!.c
    lo = Math.min(lo, r.equity[i]!, hold[i]!)
    hi = Math.max(hi, r.equity[i]!, hold[i]!)
  }
  const pad = (hi - lo) * 0.08
  lo -= pad
  hi += pad
  const step = Math.max(1, Math.floor(n / (w * 2)))
  const m = Math.ceil(n / step)
  const xs = new Float64Array(m)
  const ye = new Float64Array(m)
  const yh = new Float64Array(m)
  const yd = new Float64Array(m)
  let minDd = -0.0001
  for (let i = 0; i < n; i++) minDd = Math.min(minDd, r.drawdown[i]!)
  for (let k = 0, i = 0; i < n; i += step, k++) {
    xs[k] = (i / (n - 1)) * (w - 1)
    ye[k] = 2 + (1 - (r.equity[i]! - lo) / (hi - lo)) * (eqH - 4)
    yh[k] = 2 + (1 - (hold[i]! - lo) / (hi - lo)) * (eqH - 4)
    yd[k] = eqH + 4 + (r.drawdown[i]! / minDd) * (ddH - 2)
  }
  const base = 2 + (1 - (capital - lo) / (hi - lo)) * (eqH - 4)
  cv.hline(base, rgba(T.borderHi), 3)
  if (highlight) cv.fillRect((highlight.a / (n - 1)) * w, 0, Math.max(2, ((highlight.b - highlight.a) / (n - 1)) * w), h, rgba(T.blue, 0.12))
  const mm = Math.max(2, Math.min(m, Math.round(m * progress)))
  cv.polyline(xs, yh, m, rgba(T.dim, 0.4), 1)
  const final = r.equity[n - 1]! >= capital
  cv.area(xs, ye, mm, eqH, rgba(final ? T.green : T.red), 0.2, 0.0)
  cv.polyline(xs, ye, mm, rgba(final ? T.green : T.red), 1.6)
  cv.hline(eqH + 4, rgba(T.border))
  cv.area(xs, yd, mm, eqH + 4, rgba(T.red), 0.45, 0.12)
  if (mm < m) return
  // End-of-curve dot.
  const ex = xs[m - 1]!
  const ey = ye[m - 1]!
  for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
    const d = Math.hypot(xx, yy)
    if (d < 3.2) cv.px(Math.round(ex) + xx, Math.round(ey) + yy, rgba(final ? T.green : T.red), Math.min(1, 3.2 - d))
  }
}
