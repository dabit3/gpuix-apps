import { LineParser } from './parse'
import type { ChartMode } from './raster'
import { Store, niceStep, stats, type Stats } from './series'
import type { Source } from './sources'

export type PlotOptions = {
  label?: string
  csv?: boolean
  columns?: string[]
  /** Visible time window in seconds while following live data. Files default to "everything". */
  window?: number
  chart?: ChartMode
}

export type View = { x0: number; x1: number }

/** All chart state outside React, so the frame loop can read it 60 times a second without re-rendering. */
export class Plotter {
  store: Store
  parser: LineParser
  xKind: 'clock' | 'index' = 'clock'
  mode: ChartMode
  paused = false
  pausedAt = 0
  follow = true
  span: number
  end = 0
  readonly defaultSpan: number
  status = 'starting'
  running = false
  lastLine = ''
  lines = 0
  label: string
  saved: string | null = null
  private rowIndex = 0
  private listeners = new Set<() => void>()
  private source: Source | null = null
  private dataAt = 0

  constructor(private opts: PlotOptions = {}) {
    this.label = opts.label ?? ''
    this.parser = new LineParser(opts.csv ? 'csv' : 'auto')
    this.store = new Store(opts.columns)
    this.mode = opts.chart ?? 'line'
    this.defaultSpan = opts.window ?? (opts.csv ? Infinity : 60)
    this.span = this.defaultSpan
  }

  attach(source: Source) {
    this.source = source
    this.label = this.label || source.label
    source.start({
      line: (l) => this.ingest(l),
      status: (s, running) => {
        this.status = s
        this.running = running
        this.emit()
      },
      reset: () => this.clear(),
    })
  }

  stop() {
    this.source?.stop()
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  clear() {
    this.store = new Store(this.opts.columns)
    this.parser = new LineParser(this.opts.csv ? 'csv' : 'auto')
    this.rowIndex = 0
    this.reset()
  }

  ingest(line: string, now = Date.now() / 1000) {
    this.lines++
    const p = this.parser.push(line)
    if (p.kind !== 'data') {
      if (p.kind === 'text' && line.trim()) this.lastLine = line.trim()
      return
    }
    this.lastLine = line.trim()
    let x: number
    if (p.x !== undefined) {
      x = p.x
      this.xKind = 'clock'
    } else if (this.opts.csv) {
      x = this.rowIndex++
      this.xKind = 'index'
    } else x = now
    this.dataAt = now
    this.store.add(p.fields, x)
  }

  /** The right edge while following: wall-clock "now" for live data (smooth scrolling), else the newest sample. */
  liveEnd(now = Date.now() / 1000) {
    const last = this.store.lastX()
    if (!Number.isFinite(last)) return now
    if (this.xKind === 'clock' && now - last < 10 && now - this.dataAt < 10) return Math.max(last, now)
    return last
  }

  view(now = Date.now() / 1000): View {
    const first = this.store.firstX()
    const end = this.paused && this.follow ? this.pausedAt : this.follow ? this.liveEnd(now) : this.end
    if (!Number.isFinite(first)) return { x0: end - (Number.isFinite(this.span) ? this.span : 60), x1: end }
    let x0 = end - this.span
    if (this.follow && !(x0 > first)) x0 = first
    if (end - x0 < 1e-6) x0 = end - (this.xKind === 'index' ? 1 : 1)
    return { x0, x1: end }
  }

  isLive() {
    return this.follow && !this.paused
  }

  togglePause(now = Date.now() / 1000) {
    if (this.paused) {
      this.paused = false
      this.follow = true
    } else {
      this.pausedAt = this.view(now).x1
      this.paused = true
    }
    this.emit()
  }

  /** Shift the window by a fraction of its width (positive = forward in time). */
  pan(frac: number, now = Date.now() / 1000) {
    const v = this.view(now)
    const w = v.x1 - v.x0
    const live = this.paused ? this.pausedAt : this.liveEnd(now)
    const first = this.store.firstX()
    let end = v.x1 + frac * w
    if (Number.isFinite(first)) end = Math.max(end, first + w * 0.25)
    this.span = w
    if (end >= live && !this.paused) {
      this.follow = true
    } else {
      this.follow = false
      this.end = Math.min(end, live)
    }
    this.emit()
  }

  zoomTo(a: number, b: number) {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const min = this.xKind === 'index' ? 2 : 0.25
    const mid = (lo + hi) / 2
    const span = Math.max(min, hi - lo)
    this.follow = false
    this.end = Math.max(hi, mid + span / 2)
    this.span = span
    this.emit()
  }

  /** factor < 1 zooms in, anchored at `anchor` (0 = left edge, 1 = right edge). */
  zoomBy(factor: number, anchor = 0.5, now = Date.now() / 1000) {
    const v = this.view(now)
    const w = v.x1 - v.x0
    const at = v.x0 + anchor * w
    const nw = w * factor
    if (this.follow && anchor > 0.9) {
      this.span = Math.max(this.xKind === 'index' ? 2 : 0.25, nw)
      this.emit()
      return
    }
    this.zoomTo(at - anchor * nw, at + (1 - anchor) * nw)
  }

  reset() {
    this.follow = true
    this.paused = false
    this.span = this.defaultSpan
    this.emit()
  }

  setMode(mode: ChartMode) {
    this.mode = mode
    this.emit()
  }

  cycleMode() {
    this.setMode(this.mode === 'line' ? 'area' : this.mode === 'area' ? 'bar' : 'line')
  }

  toggleSeries(i: number) {
    this.store.toggle(i)
    this.emit()
  }

  visibleSeries() {
    return this.store.series.filter((s) => s.visible && s.xs.length)
  }

  /** Nice-rounded y extent over the visible slice; bars always include zero. */
  yRange(v: View, ticks = 5): { y0: number; y1: number; step: number } | null {
    let mn = Infinity
    let mx = -Infinity
    for (const s of this.visibleSeries()) {
      const st = stats(s, v.x0, v.x1)
      if (!st) continue
      mn = Math.min(mn, st.min)
      mx = Math.max(mx, st.max)
    }
    if (!Number.isFinite(mn)) return null
    if (this.mode === 'bar') {
      mn = Math.min(0, mn)
      mx = Math.max(0, mx)
    }
    if (mx === mn) {
      const d = Math.abs(mx) * 0.1 || 1
      mn -= d
      mx += d
    }
    const pad = (mx - mn) * 0.08
    if (!(this.mode === 'bar' && mn === 0)) mn -= pad
    mx += pad
    if (mn < 0 && mn + pad >= 0 && this.mode !== 'line') mn = 0
    const step = niceStep(mx - mn, ticks)
    return { y0: Math.floor(mn / step) * step, y1: Math.ceil(mx / step) * step, step }
  }

  statsFor(v: View): { name: string; color: string; unit?: string; visible: boolean; stats: Stats | null; last: number | null }[] {
    return this.store.series.map((s) => ({
      name: s.name,
      color: s.color,
      unit: s.unit,
      visible: s.visible,
      stats: s.visible ? stats(s, v.x0, v.x1) : null,
      last: s.ys.length ? s.ys[s.ys.length - 1]! : null,
    }))
  }
}
