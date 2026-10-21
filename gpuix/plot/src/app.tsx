import { existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired } from '@gpuix/react'
import type { EventPayload, ImgInstance, PublicInstance } from '@gpuix/react'
import type { Plotter, View } from './plotter'
import { composeExport } from './export'
import { encodePng } from './png'
import { Raster, type ChartMode } from './raster'
import { formatClock, formatValue, nearestIndex, niceTicks, stats, timeTicks } from './series'
import { MONO, T, rgb } from './theme'

const GUTTER = 62
const AXIS_H = 22
const BG = rgb(T.bg)
const GRID = rgb(T.grid)
const GRID_HI = rgb(T.gridHi)

export type Perf = { fps: number; drawMs: number; frames: number; lastFrame: number }

type Frame = { v: View; y0: number; y1: number; step: number; yTicks: number[]; xTicks: number[]; w: number; h: number }

export type PlotAppProps = { plotter: Plotter; saveDir?: string; onQuit?: () => void; fps?: number }

export function PlotApp({ plotter, saveDir = process.cwd(), onQuit, fps = 60 }: PlotAppProps) {
  const renderer = useGpuixRequired()
  const [, force] = useState(0)
  const [size, setSize] = useState({ w: 1200, h: 800 })
  const [toast, setToast] = useState<string | null>(null)
  const rootRef = useRef<PublicInstance>(null)
  const raster = useMemo(() => new Raster(), [])
  const perf = useRef<Perf>({ fps: 0, drawMs: 0, frames: 0, lastFrame: 0 })
  const viewRef = useRef<View>(plotter.view())
  const frameRef = useRef<Frame | null>(null)

  // Clicks on non-focusable elements would leave keyboard focus nowhere; shortcuts live on the root.
  const focusRoot = () => rootRef.current && renderer.focusElement?.(rootRef.current.id)
  useEffect(() => plotter.subscribe(() => force((n) => n + 1)), [plotter])
  useEffect(() => {
    const t = setInterval(() => {
      // Clicking a non-focusable control clears focus; shortcuts need it back on the root.
      if (renderer.getFocusedElementId?.() == null) focusRoot()
      force((n) => n + 1)
    }, 250)
    const f = setTimeout(focusRoot, 0)
    return () => {
      clearInterval(t)
      clearTimeout(f)
    }
  }, [renderer])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const exportPng = () => {
    const d = new Date()
    const p2 = (n: number) => String(n).padStart(2, '0')
    const name = `plot-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`
    const path = join(saveDir, name)
    const f = frameRef.current
    if (f && raster.w > 1) {
      const vis = plotter.visibleSeries()
      const unit = vis.length && vis.every((x) => x.unit === vis[0]!.unit) ? vis[0]!.unit : undefined
      const sy = (y: number) => (1 - (y - f.y0) / (f.y1 - f.y0)) * f.h
      const sx = (x: number) => ((x - f.v.x0) / (f.v.x1 - f.v.x0)) * f.w
      const out = composeExport(raster, {
        title: plotter.label,
        subtitle: plotter.xKind === 'clock' ? `${formatClock(f.v.x0, f.v.x1 - f.v.x0)} - ${formatClock(f.v.x1, f.v.x1 - f.v.x0)}` : `rows ${Math.round(f.v.x0)} - ${Math.round(f.v.x1)}`,
        series: vis.map((x) => {
          const st = stats(x, f.v.x0, f.v.x1)
          const fv = (n: number) => formatValue(n, x.unit)
          return { name: x.name, color: x.color, summary: st ? `min ${fv(st.min)}   avg ${fv(st.avg)}   p95 ${fv(st.p95)}   max ${fv(st.max)}` : '' }
        }),
        yLabels: f.yTicks.map((t) => ({ py: sy(t), label: formatValue(t, unit, f.step) })).filter((l) => l.py >= 7 && l.py <= f.h - 4),
        xLabels: f.xTicks.map((t) => ({ px: sx(t), label: plotter.xKind === 'clock' ? formatClock(t, f.v.x1 - f.v.x0) : formatValue(t) })).filter((l) => l.px >= 28 && l.px <= f.w - 28),
      })
      writeFileSync(path, encodePng(out.buf, out.w, out.h))
    } else {
      // Nothing charted yet: the live renderer can still screenshot in a native window.
      try {
        ;(renderer as unknown as { captureScreenshot?: (p: string) => void }).captureScreenshot?.(path)
      } catch {}
      if (!existsSync(path)) return setToast('Nothing to export yet')
    }
    plotter.saved = path
    setToast(`Saved ${basename(path)}`)
  }

  const onKey = (e: EventPayload) => {
    const k = (e.key ?? '').toLowerCase()
    const ch = e.keyChar ?? ''
    if (e.modifiers?.cmd || e.modifiers?.ctrl) return
    if (k === 'space' || k === 'p') plotter.togglePause()
    else if (k === 'm') plotter.cycleMode()
    else if (k === 'l') plotter.setMode('line')
    else if (k === 'a') plotter.setMode('area')
    else if (k === 'b') plotter.setMode('bar')
    else if (k === 'e' || k === 's') exportPng()
    else if (k === 'left' || k === 'h') plotter.pan(-0.2)
    else if (k === 'right') plotter.pan(0.2)
    else if (k === 'up' || ch === '+' || ch === '=') plotter.zoomBy(0.7, plotter.follow ? 1 : 0.5)
    else if (k === 'down' || ch === '-') plotter.zoomBy(1 / 0.7, plotter.follow ? 1 : 0.5)
    else if (k === '0' || k === 'escape' || k === 'r') plotter.reset()
    else if (/^[1-9]$/.test(k)) plotter.toggleSeries(Number(k) - 1)
    else if (k === 'q') onQuit?.()
  }

  const wide = size.w >= 940
  const short = size.h < 430
  const v = viewRef.current
  const rows = plotter.statsFor(v)

  return (
    <div
      ref={rootRef}
      testId="root"
      tabIndex={0}
      onKeyDown={onKey}
      onLayout={(e) => {
        const w = Math.round(e.width ?? 0)
        const h = Math.round(e.height ?? 0)
        if (w && h && (w !== size.w || h !== size.h)) setSize({ w, h })
      }}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: T.bg, paddingLeft: 18, paddingRight: 18, paddingTop: short ? 8 : 12, paddingBottom: short ? 8 : 10, gap: short ? 6 : 10 }}
    >
      <Header plotter={plotter} compact={size.w < 720} onExport={exportPng} />
      <Legend plotter={plotter} rows={rows} max={size.w < 720 ? 4 : 8} />
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0, gap: 16 }}>
        <Chart plotter={plotter} raster={raster} perf={perf.current} viewRef={viewRef} frameRef={frameRef} fps={fps} onPress={focusRoot} />
        {wide ? <StatsPanel plotter={plotter} rows={rows} /> : null}
      </div>
      {!wide ? <StatsCompact rows={rows} max={short ? 2 : 3} /> : null}
      {!short ? <Footer plotter={plotter} perf={perf.current} wide={wide} width={size.w} /> : null}
      {toast ? (
        <div testId="toast" style={{ position: 'absolute', top: short ? 46 : 54, left: Math.max(18, size.w / 2 - 150), width: 300, height: 34, borderRadius: 8, backgroundColor: T.raised, borderWidth: 1, borderColor: T.borderHi, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.green }} />
          <text style={{ color: T.fg, fontSize: 13 }}>{toast}</text>
        </div>
      ) : null}
    </div>
  )
}

function Header({ plotter, compact, onExport }: { plotter: Plotter; compact: boolean; onExport: () => void }) {
  const live = plotter.isLive()
  const pill = plotter.paused ? { label: 'PAUSED', color: T.yellow } : live ? { label: 'LIVE', color: T.green } : { label: 'HISTORY', color: T.blue }
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 32, gap: 10, flexShrink: 0 }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: plotter.running ? T.green : T.faint }} />
      <text style={{ color: T.fg, fontSize: 15, fontWeight: 700 }}>plot</text>
      <div style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
        <text testId="label" style={{ color: T.dim, fontSize: 13, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {plotter.label}
          {plotter.status !== 'running' && plotter.status !== 'watching' ? `  · ${plotter.status}` : ''}
        </text>
      </div>
      <Segmented value={plotter.mode} compact={compact} onChange={(m) => plotter.setMode(m)} />
      <Button testId="pause" label={plotter.paused ? 'Resume' : 'Pause'} active={plotter.paused} onClick={() => plotter.togglePause()} />
      {compact ? null : <Button testId="export" label="Export PNG" onClick={onExport} />}
      <div
        testId="status"
        onClick={() => !live && plotter.reset()}
        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, paddingLeft: 9, paddingRight: 10, borderRadius: 12, borderWidth: 1, borderColor: pill.color + '55', backgroundColor: pill.color + '14', cursor: live ? 'default' : 'pointer' }}
      >
        <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pill.color }} />
        <text testId="status-text" style={{ color: pill.color, fontSize: 11, fontWeight: 700, fontFamily: MONO }}>
          {pill.label}
        </text>
      </div>
    </div>
  )
}

function Segmented({ value, compact, onChange }: { value: ChartMode; compact: boolean; onChange: (m: ChartMode) => void }) {
  const modes: ChartMode[] = ['line', 'area', 'bar']
  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: 26, padding: 2, gap: 2, borderRadius: 7, backgroundColor: T.panel, borderWidth: 1, borderColor: T.border }}>
      {modes.map((m) => (
        <div
          key={m}
          testId={`mode-${m}`}
          onClick={() => onChange(m)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingLeft: compact ? 8 : 11, paddingRight: compact ? 8 : 11, borderRadius: 5, backgroundColor: value === m ? T.raised : T.panel, cursor: 'pointer', hover: { backgroundColor: T.raised } }}
        >
          <text style={{ color: value === m ? T.fg : T.dim, fontSize: 12, fontWeight: value === m ? 600 : 400 }}>{m[0]!.toUpperCase() + m.slice(1)}</text>
        </div>
      ))}
    </div>
  )
}

function Button({ testId, label, active, onClick }: { testId: string; label: string; active?: boolean; onClick: () => void }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 26, paddingLeft: 11, paddingRight: 11, borderRadius: 7, borderWidth: 1, borderColor: active ? T.yellow + '88' : T.border, backgroundColor: active ? T.yellow + '1a' : T.panel, cursor: 'pointer', hover: { backgroundColor: T.raised } }}
    >
      <text style={{ color: active ? T.yellow : T.fg, fontSize: 12, fontWeight: 500 }}>{label}</text>
    </div>
  )
}

type Row = ReturnType<Plotter['statsFor']>[number]

function Legend({ plotter, rows, max }: { plotter: Plotter; rows: Row[]; max: number }) {
  if (!rows.length) return null
  const shown = rows.slice(0, max)
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, flexShrink: 0, overflow: 'hidden' }}>
      {shown.map((r, i) => (
        <div
          key={r.name}
          testId={`series-${i}`}
          onClick={() => plotter.toggleSeries(i)}
          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, height: 24, paddingLeft: 8, paddingRight: 10, borderRadius: 6, borderWidth: 1, borderColor: r.visible ? T.border : T.panel, backgroundColor: r.visible ? T.panel : T.bg, cursor: 'pointer', hover: { borderColor: T.borderHi } }}
        >
          <div style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: r.visible ? r.color : T.faint }} />
          <text style={{ color: r.visible ? T.fg : T.faint, fontSize: 12, whiteSpace: 'nowrap' }}>{r.name}</text>
          <text testId={`series-${i}-last`} style={{ color: r.visible ? r.color : T.faint, fontSize: 12, fontFamily: MONO, whiteSpace: 'nowrap' }}>
            {r.last === null ? '–' : formatValue(r.last, r.unit)}
          </text>
        </div>
      ))}
      {rows.length > max ? <text style={{ color: T.faint, fontSize: 12 }}>{`+${rows.length - max} more · 1–9 toggles`}</text> : null}
    </div>
  )
}

function StatsPanel({ plotter, rows }: { plotter: Plotter; rows: Row[] }) {
  const vis = rows.filter((r) => r.visible).slice(0, 4)
  const v = plotter.view()
  const span = v.x1 - v.x0
  const spanLabel = plotter.xKind === 'clock' ? (span >= 120 ? `${(span / 60).toFixed(1)} min` : `${span.toFixed(span < 10 ? 1 : 0)} s`) : `${Math.round(span)} rows`
  return (
    <div testId="stats" style={{ display: 'flex', flexDirection: 'column', width: 268, flexShrink: 0, gap: 10, paddingBottom: AXIS_H }}>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 18 }}>
        <text style={{ color: T.dim, fontSize: 11, fontWeight: 600 }}>VISIBLE RANGE</text>
        <text testId="span" style={{ color: T.dim, fontSize: 11, fontFamily: MONO }}>{spanLabel}</text>
      </div>
      {vis.length === 0 ? <text style={{ color: T.faint, fontSize: 12 }}>No series yet</text> : null}
      {vis.map((r) => (
        <div key={r.name} testId={`stat-${r.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10, backgroundColor: T.panel, borderWidth: 1, borderColor: T.border }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: r.color }} />
            <text style={{ color: T.fg, fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{r.name}</text>
            <text style={{ color: r.color, fontSize: 15, fontWeight: 600, fontFamily: MONO }}>{r.last === null ? '–' : formatValue(r.last, r.unit)}</text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
            {(['min', 'avg', 'p95', 'max'] as const).map((k) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <text style={{ color: T.faint, fontSize: 10, fontWeight: 600 }}>{k.toUpperCase()}</text>
                <text testId={`stat-${r.name}-${k}`} style={{ color: T.fg, fontSize: 12, fontFamily: MONO }}>
                  {r.stats ? formatValue(r.stats[k], r.unit) : '–'}
                </text>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function StatsCompact({ rows, max }: { rows: Row[]; max: number }) {
  const vis = rows.filter((r) => r.visible).slice(0, max)
  if (!vis.length) return null
  const cell = (s: string, color: string, key: string, testId?: string) => (
    <text key={key} testId={testId} style={{ color, fontSize: 12, fontFamily: MONO, width: 74, textAlign: 'right', whiteSpace: 'nowrap' }}>{s}</text>
  )
  return (
    <div testId="stats" style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, paddingLeft: GUTTER }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 16 }}>
        <div style={{ flexGrow: 1 }} />
        {['MIN', 'AVG', 'P95', 'MAX'].map((k) => cell(k, T.faint, k))}
      </div>
      {vis.map((r) => (
        <div key={r.name} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 18 }}>
          <div style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: r.color, marginRight: 8 }} />
          <text style={{ color: T.fg, fontSize: 12, flexGrow: 1, whiteSpace: 'nowrap' }}>{r.name}</text>
          {(['min', 'avg', 'p95', 'max'] as const).map((k) => cell(r.stats ? formatValue(r.stats[k], r.unit) : '–', T.fg, k, `stat-${r.name}-${k}`))}
        </div>
      ))}
    </div>
  )
}

function Footer({ plotter, perf, wide, width }: { plotter: Plotter; perf: Perf; wide: boolean; width: number }) {
  const n = plotter.store.series.reduce((a, s) => a + s.xs.length, 0)
  // GPUI text doesn't ellipsize inside a shrinking flex child, so cut the raw line to the room left (Menlo 11 ≈ 6.7 px/char).
  const room = Math.max(0, Math.floor((width - 36 - (wide ? 600 : 200)) / 6.7))
  const raw = plotter.lastLine.length > room ? `${plotter.lastLine.slice(0, Math.max(0, room - 1))}…` : plotter.lastLine
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 18, gap: 14, flexShrink: 0 }}>
      <div style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
        <text testId="last-line" style={{ color: T.faint, fontSize: 11, fontFamily: MONO, whiteSpace: 'nowrap' }}>{room > 8 ? raw : ''}</text>
      </div>
      {wide ? <text style={{ color: T.faint, fontSize: 11, whiteSpace: 'nowrap' }}>space pause · drag zoom · scroll pan · m mode · e export · dbl-click reset</text> : null}
      <text testId="counts" style={{ color: T.dim, fontSize: 11, fontFamily: MONO, whiteSpace: 'nowrap' }}>
        {`${n.toLocaleString('en-US')} pts · ${Math.round(perf.fps)} fps · ${perf.drawMs.toFixed(1)} ms`}
      </text>
    </div>
  )
}

function Chart({ plotter, raster, perf, viewRef, frameRef, fps, onPress }: { plotter: Plotter; raster: Raster; perf: Perf; viewRef: { current: View }; frameRef: { current: Frame | null }; fps: number; onPress: () => void }) {
  const img = useRef<ImgInstance>(null)
  const box = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const [frame, setFrame] = useState<Frame | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const drag = useRef<number | null>(null)
  const yAnim = useRef<{ y0: number; y1: number } | null>(null)
  const lastKey = useRef('')
  const counter = useRef({ t: 0, n: 0 })

  useEffect(() => {
    const draw = () => {
      const { w, h } = box.current
      if (w < 4 || h < 4) return
      const now = Date.now() / 1000
      const v = plotter.view(now)
      viewRef.current = v
      const target = plotter.yRange(v, Math.max(2, Math.min(7, Math.floor(h / 60))))
      if (!target) {
        if (lastKey.current !== 'empty') {
          lastKey.current = 'empty'
          frameRef.current = null
          setFrame(null)
        }
        return
      }
      const cur = yAnim.current
      if (!cur || lastKey.current === 'empty') yAnim.current = { y0: target.y0, y1: target.y1 }
      else {
        const k = 0.22
        const span = target.y1 - target.y0
        cur.y0 += (target.y0 - cur.y0) * k
        cur.y1 += (target.y1 - cur.y1) * k
        if (Math.abs(cur.y0 - target.y0) < span * 0.002) cur.y0 = target.y0
        if (Math.abs(cur.y1 - target.y1) < span * 0.002) cur.y1 = target.y1
      }
      const { y0, y1 } = yAnim.current!
      const vis = plotter.visibleSeries()
      const key = `${v.x0}|${v.x1}|${y0}|${y1}|${plotter.store.version}|${plotter.mode}|${w}|${h}|${vis.map((s) => s.name).join(',')}`
      if (key === lastKey.current) return
      // Not mounted yet (first data frame): publish the frame now and upload on the next tick.
      lastKey.current = img.current ? key : ''
      const t0 = performance.now()
      const yTicks = niceTicks(y0, y1, Math.max(2, Math.min(7, Math.floor(h / 60))))
      const xCount = Math.max(2, Math.floor(w / 130))
      const xTicks = plotter.xKind === 'clock' ? timeTicks(v.x0, v.x1, xCount) : niceTicks(v.x0, v.x1, xCount).filter((t) => Number.isInteger(t) || v.x1 - v.x0 < 10)
      raster.resize(w, h)
      raster.draw({ x0: v.x0, x1: v.x1, y0, y1, mode: plotter.mode, series: vis.map((s) => ({ xs: s.xs, ys: s.ys, rgb: rgb(s.color) })), yTicks, xTicks, bg: BG, grid: GRID, gridHi: GRID_HI })
      img.current?.setImagePixels(raster.w, raster.h, raster.buf, { format: 'bgra' })
      const ms = performance.now() - t0
      perf.drawMs = perf.drawMs ? perf.drawMs * 0.9 + ms * 0.1 : ms
      perf.frames++
      const c = counter.current
      c.n++
      if (now - c.t >= 1) {
        perf.fps = c.n / (now - c.t || 1)
        c.t = now
        c.n = 0
      }
      perf.lastFrame = now
      frameRef.current = { v, y0, y1, step: target.step, yTicks, xTicks, w, h }
      setFrame(frameRef.current)
    }
    const t = setInterval(draw, 1000 / fps)
    return () => clearInterval(t)
  }, [plotter, raster, perf, viewRef, frameRef, fps])

  const local = (e: EventPayload) => ({ x: (e.x ?? 0) - box.current.x, y: (e.y ?? 0) - box.current.y })
  const xAt = (px: number) => {
    const v = viewRef.current
    return v.x0 + (px / Math.max(1, box.current.w)) * (v.x1 - v.x0)
  }

  const vis = plotter.visibleSeries()
  const unit = vis.length && vis.every((s) => s.unit === vis[0]!.unit) ? vis[0]!.unit : undefined
  const f = frame
  const sx = (x: number) => (f ? ((x - f.v.x0) / (f.v.x1 - f.v.x0)) * f.w : 0)
  const sy = (y: number) => (f ? (1 - (y - f.y0) / (f.y1 - f.y0)) * f.h : 0)

  let cross: { px: number; label: string; points: { name: string; color: string; py: number; value: string }[] } | null = null
  if (f && hover && vis.length && !sel) {
    const xv = xAt(hover.x)
    const ref = vis[0]!
    const snap = ref.xs[nearestIndex(ref.xs, xv)]!
    const points = vis.map((s) => {
      const i = nearestIndex(s.xs, snap)
      return { name: s.name, color: s.color, py: sy(s.ys[i]!), value: formatValue(s.ys[i]!, s.unit) }
    })
    const label = plotter.xKind === 'clock' ? formatClock(snap, Math.min(60, f.v.x1 - f.v.x0)) : `row ${Math.round(snap)}`
    cross = { px: sx(snap), label, points }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <div style={{ width: GUTTER, position: 'relative', flexShrink: 0 }}>
          {f
            ? f.yTicks.map((t) => {
                const py = sy(t)
                if (py < 7 || py > f.h - 4) return null
                return (
                  <text key={t} style={{ position: 'absolute', top: py - 8, left: 0, width: GUTTER - 10, textAlign: 'right', color: T.faint, fontSize: 11, fontFamily: MONO, whiteSpace: 'nowrap' }}>
                    {formatValue(t, unit, f.step)}
                  </text>
                )
              })
            : null}
        </div>
        <div
          testId="chart"
          style={{ position: 'relative', flexGrow: 1, minWidth: 0, overflow: 'hidden', borderRadius: 4, cursor: 'crosshair' }}
          onLayout={(e) => {
            box.current = { x: e.x ?? 0, y: e.y ?? 0, w: Math.round(e.width ?? 0), h: Math.round(e.height ?? 0) }
          }}
          onMouseDown={(e) => {
            onPress()
            const p = local(e)
            if ((e.clickCount ?? 1) >= 2) {
              drag.current = null
              setSel(null)
              plotter.reset()
              return
            }
            drag.current = p.x
          }}
          onMouseMove={(e) => {
            const p = local(e)
            setHover(p)
            if (drag.current !== null && Math.abs(p.x - drag.current) > 2) setSel({ a: drag.current, b: Math.max(0, Math.min(box.current.w, p.x)) })
          }}
          onMouseUp={(e) => {
            const a = drag.current
            drag.current = null
            if (a === null) return
            const b = Math.max(0, Math.min(box.current.w, local(e).x))
            setSel(null)
            if (Math.abs(b - a) > 6) plotter.zoomTo(xAt(a), xAt(b))
          }}
          onMouseLeave={() => setHover(null)}
          onScroll={(e) => {
            const dx = e.deltaX ?? 0
            const dy = e.deltaY ?? 0
            const w = Math.max(1, box.current.w)
            if (e.modifiers?.ctrl || e.modifiers?.cmd || e.modifiers?.alt) {
              plotter.zoomBy(Math.exp(-dy * (e.precise ? 0.004 : 0.012)), local(e).x / w)
              return
            }
            const d = Math.abs(dx) > Math.abs(dy) ? dx : dy
            if (d) plotter.pan(-d * (e.precise ? 1 / w : 0.004))
          }}
        >
          {/* Mounted with the first data frame: an <img> with no pixels yet paints a grey placeholder. */}
          {f ? <img ref={img} testId="chart-img" objectFit="fill" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} /> : null}
          {!f ? (
            <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <text testId="empty" style={{ color: T.faint, fontSize: 13 }}>{`Waiting for numbers from ${plotter.label || 'the source'}…`}</text>
            </div>
          ) : null}
          {sel ? (
            <div testId="selection" style={{ position: 'absolute', top: 0, left: Math.min(sel.a, sel.b), width: Math.abs(sel.b - sel.a), height: '100%', backgroundColor: '#71b7ff1c', borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#71b7ff99', pointerEvents: 'none' }} />
          ) : null}
          {cross && f ? <Crosshair cross={cross} hover={hover!} w={f.w} h={f.h} /> : null}
        </div>
      </div>
      <div style={{ height: AXIS_H, marginLeft: GUTTER, position: 'relative', flexShrink: 0 }}>
        {f
          ? f.xTicks.map((t) => {
              const px = sx(t)
              if (px < 28 || px > f.w - 28) return null
              return (
                <text key={t} style={{ position: 'absolute', top: 5, left: px - 45, width: 90, textAlign: 'center', color: T.faint, fontSize: 11, fontFamily: MONO, whiteSpace: 'nowrap' }}>
                  {plotter.xKind === 'clock' ? formatClock(t, f.v.x1 - f.v.x0) : formatValue(t)}
                </text>
              )
            })
          : null}
      </div>
    </div>
  )
}

function Crosshair({ cross, hover, w, h }: { cross: { px: number; label: string; points: { name: string; color: string; py: number; value: string }[] }; hover: { x: number; y: number }; w: number; h: number }) {
  const TW = 196
  const th = 30 + cross.points.length * 20
  const left = cross.px + 16 + TW > w ? cross.px - 16 - TW : cross.px + 16
  const top = Math.max(6, Math.min(h - th - 6, hover.y - th / 2))
  return (
    <>
      <div style={{ position: 'absolute', left: Math.round(cross.px), top: 0, width: 1, height: '100%', backgroundColor: '#f0f3f640', pointerEvents: 'none' }} />
      {cross.points.map((p) =>
        p.py >= -4 && p.py <= h + 4 ? (
          <div key={p.name} style={{ position: 'absolute', left: cross.px - 5, top: p.py - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: T.bg, borderWidth: 2, borderColor: p.color, pointerEvents: 'none' }} />
        ) : null,
      )}
      <div testId="readout" style={{ position: 'absolute', left, top, width: TW, display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10, borderRadius: 8, backgroundColor: '#161b22f2', borderWidth: 1, borderColor: T.borderHi, pointerEvents: 'none' }}>
        <text testId="readout-x" style={{ color: T.dim, fontSize: 11, fontFamily: MONO }}>{cross.label}</text>
        {cross.points.map((p) => (
          <div key={p.name} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, height: 16 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: p.color }} />
            <text style={{ color: T.dim, fontSize: 12, flexGrow: 1, whiteSpace: 'nowrap' }}>{p.name}</text>
            <text testId={`readout-${p.name}`} style={{ color: T.fg, fontSize: 12, fontWeight: 600, fontFamily: MONO, whiteSpace: 'nowrap' }}>{p.value}</text>
          </div>
        ))}
      </div>
    </>
  )
}
