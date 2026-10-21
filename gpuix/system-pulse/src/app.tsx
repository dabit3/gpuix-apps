import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  motion,
  useGpuix,
  useWindowSize,
  type EventPayload,
  type ImgInstance,
} from '@gpuix/react'
import { History, niceCeil, paintChart, type RGB } from './chart.ts'
import { bytes, duration, pct, rate } from './format.ts'
import type { DataSource, ProcessDetail, ProcessInfo, Snapshot } from './sampler.ts'

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  text: '#F5F7FA',
  secondary: '#FFFFFFB8',
  muted: '#FFFFFF80',
  faint: '#FFFFFF4D',
  card: '#FFFFFF0F',
  cardBorder: '#FFFFFF1A',
  hover: '#FFFFFF0F',
  selected: '#0A84FF40',
  track: '#FFFFFF14',
}
const BLUE: RGB = [10, 132, 255]
const CYAN: RGB = [100, 210, 255]
const GREEN: RGB = [48, 209, 88]
const ORANGE: RGB = [255, 159, 10]
const YELLOW: RGB = [255, 214, 10]
const RED: RGB = [255, 69, 58]
const hex = ([r, g, b]: RGB, a = 1) =>
  `#${[r, g, b, Math.round(a * 255)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`

const FONT = '.SystemUIFont'
const CORE_H = 118
const FOCUS_RING = { outlineWidth: 2, outlineColor: '#0A84FFCC', outlineOffset: 1 }
const WINDOW_MS = 60_000
/** Charts trail real time by one slow sample so the right edge never extrapolates. */
const CHART_DELAY_MS = 1_100

// ── Frame loop shared by all charts ───────────────────────────────────────
type Painter = (now: number) => number
const painters = new Set<Painter>()
export const paintStats = { lastMs: 0, avgMs: 0 }
let loop: ReturnType<typeof setInterval> | null = null
function startPaintLoop(fps: number) {
  if (loop) return
  loop = setInterval(() => {
    const now = Date.now()
    let ms = 0
    for (const p of painters) ms += p(now)
    paintStats.lastMs = ms
    paintStats.avgMs = paintStats.avgMs * 0.95 + ms * 0.05
  }, 1000 / fps)
}
function stopPaintLoop() {
  if (loop) clearInterval(loop)
  loop = null
}

// ── Small primitives ──────────────────────────────────────────────────────
function T({
  children,
  size = 13,
  color = C.text,
  weight = 400,
  testId,
  mono,
}: {
  children: React.ReactNode
  size?: number
  color?: string
  weight?: number
  testId?: string
  mono?: boolean
}) {
  return (
    <text
      testId={testId}
      style={{ color, fontSize: size, fontWeight: weight, fontFamily: mono ? 'Menlo' : FONT }}
    >
      {children}
    </text>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <T size={11} weight={600} color={C.muted}>{children}</T>
}

function Card({ children, grow = 1, testId, minWidth }: { children: React.ReactNode; grow?: number; testId?: string; minWidth?: number }) {
  return (
    <div
      testId={testId}
      style={{
        display: 'flex',
        flexGrow: grow,
        flexBasis: 0,
        minWidth: minWidth ?? 0,
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        borderRadius: 14,
        backgroundColor: C.card,
        borderWidth: 1,
        borderColor: C.cardBorder,
      }}
    >
      {children}
    </div>
  )
}

function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <div style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
}

function Pill({
  children,
  onClick,
  testId,
  tone = 'plain',
}: {
  children: React.ReactNode
  onClick?: () => void
  testId?: string
  tone?: 'plain' | 'accent' | 'danger' | 'active'
}) {
  const bg = { plain: '#FFFFFF1A', accent: hex(BLUE), danger: hex(RED, 0.9), active: hex(ORANGE, 0.22) }[tone]
  const hover = { plain: '#FFFFFF29', accent: hex(BLUE, 0.85), danger: hex(RED, 0.75), active: hex(ORANGE, 0.3) }[tone]
  const border = tone === 'active' ? hex(ORANGE, 0.55) : '#FFFFFF14'
  return (
    <div
      testId={testId}
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e: EventPayload) => {
        if (onClick && (e.key === 'enter' || e.key === 'space')) onClick()
      }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        height: 28,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 8,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        cursor: onClick ? 'pointer' : undefined,
        hover: { backgroundColor: hover },
        focusVisible: FOCUS_RING,
      }}
    >
      {children}
    </div>
  )
}

// ── Live chart: RGBA pixels → <img>.setImagePixels ───────────────────────
interface ChartSeries {
  key: number
  color: RGB
  label: string
}

function LiveChart({
  history,
  series,
  height,
  scale,
  format,
  testId,
  stacked,
}: {
  history: History
  series: ChartSeries[]
  height: number
  /** Returns the y-axis max for the visible window. */
  scale: (from: number) => number
  format: (v: number) => string
  testId: string
  stacked?: boolean
}) {
  const img = useRef<ImgInstance | null>(null)
  const [box, setBox] = useState({ x: 0, y: 0, w: 0 })
  const [hoverX, setHoverX] = useState<number | null>(null)
  const state = useRef({ max: 0, lastEnd: 0, lastLen: 0, buf: new Uint8Array(0), cols: [] as Float32Array[] })

  useLayoutEffect(() => {
    const w = Math.round(box.w)
    if (w <= 0) return
    const s = state.current
    s.buf = new Uint8Array(w * height * 4)
    s.cols = series.map(() => new Float32Array(w))
    s.lastEnd = 0
    const paint: Painter = (now) => {
      const t0 = performance.now()
      // Snap the window to whole columns: the picture only changes when it has
      // scrolled a full pixel, so most 60 Hz ticks cost nothing.
      const step = WINDOW_MS / Math.max(1, w - 1)
      const end = Math.floor((now - CHART_DELAY_MS) / step) * step
      const target = scale(end - WINDOW_MS)
      const settling = s.max !== 0 && Math.abs(target - s.max) > target * 0.002
      if (end === s.lastEnd && !settling && history.length === s.lastLen) return 0
      s.lastEnd = end
      s.lastLen = history.length
      s.max = s.max === 0 || !settling ? target : s.max + (target - s.max) * 0.12
      const max = s.max || 1
      series.forEach((sr, i) => history.resample(sr.key, w, end, WINDOW_MS, s.cols[i]))
      if (stacked) {
        // Draw cumulative series so the second one sits on top of the first.
        for (let i = 1; i < s.cols.length; i++) {
          const a = s.cols[i]!
          const b = s.cols[i - 1]!
          for (let x = 0; x < w; x++) a[x] = a[x]! + b[x]!
        }
      }
      const order = stacked ? [...series.keys()].reverse() : [...series.keys()]
      paintChart(
        s.buf,
        w,
        height,
        order.map((i) => {
          const col = s.cols[i]!
          for (let x = 0; x < w; x++) col[x] = col[x]! / max
          return { values: col, color: series[i]!.color, fillAlpha: stacked ? 0.55 : 0.3 }
        }),
      )
      img.current?.setImagePixels(w, height, s.buf)
      return performance.now() - t0
    }
    painters.add(paint)
    paint(Date.now())
    return () => {
      painters.delete(paint)
    }
  }, [box.w, height, history])

  // Tooltip values at the hovered column (re-evaluated on every React render, i.e. each sample).
  let tooltip: React.ReactNode = null
  if (hoverX !== null && box.w > 0) {
    const end = Date.now() - CHART_DELAY_MS
    const t = end - WINDOW_MS + (hoverX / box.w) * WINDOW_MS
    const ago = Math.max(0, Math.round((end - t) / 1000))
    const flip = hoverX > box.w - 170
    tooltip = (
      <>
        <div style={{ position: 'absolute', left: hoverX, top: 0, width: 1, height, backgroundColor: '#FFFFFF66', pointerEvents: 'none' }} />
        <div
          testId={`${testId}-tooltip`}
          style={{
            display: 'flex',
            position: 'absolute',
            left: flip ? hoverX - 162 : hoverX + 10,
            top: 6,
            width: 152,
            flexDirection: 'column',
            gap: 4,
            padding: 8,
            borderRadius: 8,
            backgroundColor: '#1C1C1EF0',
            borderWidth: 1,
            borderColor: '#FFFFFF1F',
            // Positioned boxes block hover behind them; without this the tooltip
            // under the pointer fires onMouseLeave on the chart and hides itself.
            pointerEvents: 'none',
          }}
        >
          <T size={11} color={C.muted}>{ago === 0 ? 'now' : `${ago}s ago`}</T>
          {series.map((sr) => (
            <div key={sr.key} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Dot color={hex(sr.color)} size={7} />
              <T size={12} color={C.secondary}>{sr.label}</T>
              <div style={{ flexGrow: 1 }} />
              <T size={12} weight={600}>{format(history.at(t, sr.key))}</T>
            </div>
          ))}
        </div>
      </>
    )
  }

  return (
    <div
      testId={testId}
      onLayout={(e: EventPayload) => {
        const w = Math.round(e.width ?? 0)
        if (w !== box.w || e.x !== box.x) setBox({ x: e.x ?? 0, y: e.y ?? 0, w })
      }}
      onMouseMove={(e: EventPayload) => setHoverX(Math.max(0, Math.min(box.w - 1, (e.x ?? 0) - box.x)))}
      onMouseLeave={() => setHoverX(null)}
      style={{ display: 'flex', height, flexDirection: 'column', position: 'relative' }}
    >
      {box.w > 0 && <img ref={img} style={{ width: Math.round(box.w), height }} />}
      {tooltip}
    </div>
  )
}

// ── Process table ─────────────────────────────────────────────────────────
type SortKey = 'name' | 'pid' | 'user' | 'cpu' | 'rss'
const COLUMNS: { key: SortKey; label: string; width?: number; align?: 'right' }[] = [
  { key: 'name', label: 'Process' },
  { key: 'pid', label: 'PID', width: 64, align: 'right' },
  { key: 'user', label: 'User', width: 96 },
  { key: 'cpu', label: '% CPU', width: 70, align: 'right' },
  { key: 'rss', label: 'Memory', width: 84, align: 'right' },
]

export function sortProcesses(list: ProcessInfo[], key: SortKey, desc: boolean): ProcessInfo[] {
  const dir = desc ? -1 : 1
  return [...list].sort((a, b) => {
    const va = a[key]
    const vb = b[key]
    const c = typeof va === 'string' ? va.localeCompare(vb as string, undefined, { sensitivity: 'base' }) : va - (vb as number)
    return c !== 0 ? c * dir : a.pid - b.pid
  })
}

function HeaderCell({
  col,
  sort,
  desc,
  onSort,
}: {
  col: (typeof COLUMNS)[number]
  sort: SortKey
  desc: boolean
  onSort: (k: SortKey) => void
}) {
  const active = sort === col.key
  return (
    <div
      testId={`sort-${col.key}`}
      onClick={() => onSort(col.key)}
      tabIndex={0}
      onKeyDown={(e: EventPayload) => {
        if (e.key === 'enter' || e.key === 'space') onSort(col.key)
      }}
      style={{
        display: 'flex',
        width: col.width,
        flexGrow: col.width ? 0 : 1,
        flexShrink: col.width ? 0 : 1,
        flexDirection: 'row',
        justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start',
        alignItems: 'center',
        gap: 4,
        height: 26,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 6,
        cursor: 'pointer',
        hover: { backgroundColor: C.hover },
        focusVisible: FOCUS_RING,
      }}
    >
      <T size={11} weight={600} color={active ? C.text : C.muted}>{col.label}</T>
      {active && <T size={9} color={hex(BLUE)}>{desc ? '▼' : '▲'}</T>}
    </div>
  )
}

const ProcessRow = memo(function ProcessRow({
  p,
  selected,
  isStress,
  maxCpu,
  onSelect,
}: {
  p: ProcessInfo
  selected: boolean
  isStress: boolean
  maxCpu: number
  onSelect: (pid: number) => void
}) {
  const cpuColor = p.cpu > 50 ? hex(ORANGE) : C.text
  return (
    <div
      testId={`process-row-${p.pid}`}
      onClick={() => onSelect(p.pid)}
      style={{
        display: 'flex',
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        height: 28,
        borderRadius: 7,
        backgroundColor: selected ? C.selected : undefined,
        cursor: 'pointer',
      hover: { backgroundColor: selected ? C.selected : C.hover } }}
    >
      <div style={{ display: 'flex', flexGrow: 1, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, overflow: 'hidden' }}>
        <div style={{ display: 'flex', width: 4, height: 14, borderRadius: 2, backgroundColor: C.track, flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div style={{ height: Math.max(1, Math.min(14, (p.cpu / Math.max(100, maxCpu)) * 14)), borderRadius: 2, backgroundColor: p.cpu > 50 ? hex(ORANGE) : hex(BLUE) }} />
        </div>
        <T size={13}>{p.name}</T>
        {isStress && (
          <div style={{ display: 'flex', paddingLeft: 6, paddingRight: 6, height: 17, borderRadius: 5, backgroundColor: hex(ORANGE, 0.2), justifyContent: 'center' }}>
            <T size={10} weight={600} color={hex(ORANGE)}>STRESS</T>
          </div>
        )}
      </div>
      <Cell width={64} right><T size={12} color={C.secondary} mono>{p.pid}</T></Cell>
      <Cell width={96}><T size={12} color={C.secondary}>{p.user}</T></Cell>
      <Cell width={70} right><T size={12} weight={p.cpu > 50 ? 600 : 400} color={cpuColor} mono>{p.cpu.toFixed(1)}</T></Cell>
      <Cell width={84} right><T size={12} color={C.secondary} mono>{bytes(p.rss)}</T></Cell>
    </div>
  )
}, (a, b) =>
  a.selected === b.selected &&
  a.isStress === b.isStress &&
  a.p.pid === b.p.pid &&
  a.p.name === b.p.name &&
  a.p.user === b.p.user &&
  a.p.cpu.toFixed(1) === b.p.cpu.toFixed(1) &&
  bytes(a.p.rss) === bytes(b.p.rss) &&
  Math.round((a.p.cpu / Math.max(100, a.maxCpu)) * 14) === Math.round((b.p.cpu / Math.max(100, b.maxCpu)) * 14))

function Cell({ width, right, children }: { width: number; right?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', width, flexShrink: 0, flexDirection: 'row', justifyContent: right ? 'flex-end' : 'flex-start', paddingLeft: 6, paddingRight: 6, overflow: 'hidden' }}>
      {children}
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────
function DetailPanel({
  proc,
  detail,
  cpuTrail,
  isStress,
  onClose,
  onQuit,
}: {
  proc: ProcessInfo | null
  detail: ProcessDetail | null
  cpuTrail: number[]
  isStress: boolean
  onClose: () => void
  onQuit: () => void
}) {
  if (!proc) return null
  const peak = Math.max(100, ...cpuTrail)
  const cmd = detail?.command ?? proc.name
  return (
    <div testId="detail-panel" style={{ display: 'flex', width: 300, height: '100%', flexDirection: 'column', gap: 10, padding: 14, flexShrink: 0, overflow: 'scroll' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', flexGrow: 1, flexShrink: 1, minWidth: 0, flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
          <T size={16} weight={600} testId="detail-name">{proc.name}</T>
          <T size={11} color={isStress ? hex(ORANGE) : C.muted}>{isStress ? 'Stress worker started by System Pulse' : cmd.length > 44 ? `${cmd.slice(0, 43)}…` : cmd}</T>
        </div>
        <div
          testId="detail-close"
          onClick={onClose}
          style={{ display: 'flex', width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF14', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', hover: { backgroundColor: '#FFFFFF29' } }}
        >
          <T size={11} color={C.secondary}>✕</T>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
        <Stat label="CPU" value={pct(proc.cpu, 1)} testId="detail-cpu" />
        <Stat label="Memory" value={bytes(proc.rss)} />
      </div>

      <div style={{ display: 'flex', height: 34, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {Array.from({ length: 50 }, (_, i) => cpuTrail[cpuTrail.length - 50 + i]).map((v, i) => (
          <div
            key={i}
            style={{
              flexGrow: 1,
              height: v === undefined ? 1 : Math.max(1, (v / peak) * 34),
              borderRadius: 1,
              backgroundColor: v === undefined ? C.track : v > 50 ? hex(ORANGE, 0.9) : hex(BLUE, 0.9),
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', gap: 14 }}>
        <div style={{ display: 'flex', flexGrow: 1, flexBasis: 0, flexDirection: 'column', gap: 5 }}>
          <KV k="PID" v={String(proc.pid)} />
          <KV k="Parent" v={String(detail?.ppid ?? proc.ppid)} />
        </div>
        <div style={{ display: 'flex', flexGrow: 1, flexBasis: 0, flexDirection: 'column', gap: 5 }}>
          <KV k="User" v={proc.user} />
          <KV k="Uptime" v={detail?.elapsed ?? '…'} />
        </div>
      </div>

      {isStress ? (
        <Pill testId="quit-button" tone="danger" onClick={onQuit}>
          <div style={{ display: 'flex', flexGrow: 1, justifyContent: 'center' }}>
            <T size={13} weight={600} color="#FFFFFF">Quit Process…</T>
          </div>
        </Pill>
      ) : (
        <div testId="quit-disabled" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', width: '100%', height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: '#FFFFFF08', alignItems: 'center', justifyContent: 'center' }}>
            <T size={13} weight={600} color={C.faint}>Quit Process…</T>
          </div>
          <T size={11} color={C.muted}>Only stress workers started by System Pulse can be quit</T>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div style={{ display: 'flex', flexGrow: 1, flexBasis: 0, flexDirection: 'column', gap: 2, paddingTop: 7, paddingBottom: 7, paddingLeft: 10, paddingRight: 10, borderRadius: 10, backgroundColor: '#FFFFFF0D' }}>
      <Label>{label.toUpperCase()}</Label>
      <T size={16} weight={600} testId={testId}>{value}</T>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
      <T size={12} color={C.muted}>{k}</T>
      <div style={{ flexGrow: 1 }} />
      <T size={12} color={C.secondary}>{v}</T>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────
export interface AppProps {
  source: DataSource
  /** Chart paint rate. Tests pass 0 to paint only on demand. */
  fps?: number
}

interface Overhead {
  cpu: number
  rss: number
  frameP90: number | null
}

export function SystemPulseApp({ source, fps = 60 }: AppProps) {
  const gpuix = useGpuix()
  const win = useWindowSize()
  const [snap, setSnap] = useState<Snapshot | null>(source.latest())
  const [sort, setSort] = useState<SortKey>('cpu')
  const [desc, setDesc] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<ProcessDetail | null>(null)
  const [confirm, setConfirm] = useState<ProcessInfo | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [stress, setStress] = useState<number[]>([])
  const [overhead, setOverhead] = useState<Overhead>({ cpu: 0, rss: 0, frameP90: null })

  const hist = useMemo(
    () => ({ cpu: new History(), mem: new History(), net: new History(), disk: new History(), procCpu: new Map<number, number[]>() }),
    [],
  )

  useEffect(() => {
    let lastSlow = -1
    const off = source.subscribe((s) => {
      hist.cpu.push(s.t, [s.cpu.user, s.cpu.system])
      if (s.slowTick !== lastSlow) {
        lastSlow = s.slowTick
        if (s.memory) hist.mem.push(s.t, [s.memory.app + s.memory.wired + s.memory.compressed, s.memory.cached])
        hist.net.push(s.t, [s.netIn, s.netOut])
        hist.disk.push(s.t, [s.diskRead, s.diskWrite])
        const alive = new Set<number>()
        for (const p of s.processes) {
          alive.add(p.pid)
          const trail = hist.procCpu.get(p.pid) ?? []
          trail.push(p.cpu)
          if (trail.length > 60) trail.shift()
          hist.procCpu.set(p.pid, trail)
        }
        for (const pid of hist.procCpu.keys()) if (!alive.has(pid)) hist.procCpu.delete(pid)
      }
      setStress(source.stressPids())
      setSnap(s)
    })
    return off
  }, [source])

  useEffect(() => {
    if (fps > 0) startPaintLoop(fps)
    return () => stopPaintLoop()
  }, [fps])

  // GPUIX self-overhead: process CPU time (all threads incl. the GPUI/Metal side) + RSS + frame stats.
  useEffect(() => {
    let prev = process.cpuUsage()
    let prevT = performance.now()
    const id = setInterval(() => {
      const cur = process.cpuUsage()
      const now = performance.now()
      const cpu = ((cur.user - prev.user + cur.system - prev.system) / 1000 / (now - prevT)) * 100
      prev = cur
      prevT = now
      let frameP90: number | null = null
      try {
        const stats = (gpuix as unknown as { getDebugFrameOverlayStats?: () => { p90Ms?: number } } | null)?.getDebugFrameOverlayStats?.()
        if (stats && typeof stats.p90Ms === 'number' && stats.p90Ms > 0) frameP90 = stats.p90Ms
      } catch {}
      setOverhead({ cpu, rss: process.memoryUsage().rss, frameP90 })
    }, 1000)
    return () => clearInterval(id)
  }, [gpuix])

  useEffect(() => {
    setDetail(null)
    if (selected === null) return
    let live = true
    source.detail(selected).then((d) => live && setDetail(d))
    return () => {
      live = false
    }
  }, [selected, source])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  const procs = snap?.processes ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? procs.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).startsWith(q) || p.user.toLowerCase().includes(q)) : procs
    return sortProcesses(list, sort, desc)
  }, [procs, query, sort, desc])
  const shown = filtered.slice(0, 80)
  const selectedProc = selected === null ? null : procs.find((p) => p.pid === selected) ?? null
  const stressSet = new Set(stress)
  const maxCpu = Math.max(100, ...procs.map((p) => p.cpu))

  const onSelect = useMemo(() => (pid: number) => setSelected((cur) => (cur === pid ? null : pid)), [])

  const onSort = (k: SortKey) => {
    if (k === sort) setDesc(!desc)
    else {
      setSort(k)
      setDesc(k === 'cpu' || k === 'rss')
    }
  }

  const toggleStress = () => {
    if (stress.length > 0) {
      source.stopStress()
      setStress([])
      setToast('Stress test stopped')
    } else {
      const n = Math.max(2, Math.floor(source.info.cores / 2))
      setStress(source.startStress(n))
      setToast(`Started ${n} stress workers (yes > /dev/null)`)
    }
  }

  const quit = async (p: ProcessInfo) => {
    if (!source.stressPids().includes(p.pid)) return setConfirm(null)
    const res = await source.kill(p.pid)
    setConfirm(null)
    if (res.ok) {
      setToast(`Quit ${p.name} (${p.pid})`)
      if (selected === p.pid) setSelected(null)
      setStress(source.stressPids())
    } else setToast(`Couldn't quit ${p.name}: ${res.error ?? 'unknown error'}`)
  }

  const s = snap
  const cpuTotal = s ? s.cpu.total : 0
  const mem = s?.memory ?? null
  const info = source.info
  const pressureColor = !mem ? C.muted : mem.pressure > 75 ? hex(RED) : mem.pressure > 50 ? hex(YELLOW) : hex(GREEN)

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', flexDirection: 'column', paddingTop: 12, paddingLeft: 18, paddingRight: 18, paddingBottom: 10, gap: 12, backgroundColor: '#15171BB0' }}>
      {/* Title bar row (traffic lights live at the left) */}
      <div style={{ display: 'flex', height: 32, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 70 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <T size={15} weight={700}>System Pulse</T>
          <T size={11} color={C.muted} testId="system-info">{`${info.chip} · ${info.cores} cores · ${bytes(info.memory, 0)} · ${info.osVersion}`}</T>
        </div>
        <div style={{ flexGrow: 1 }} />
        {toast && (
          <div testId="toast" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 10, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF1A' }}>
            <T size={12} color={C.secondary}>{toast}</T>
          </div>
        )}
        <Pill>
          <T size={12} color={C.muted}>Up</T>
          <T size={12} weight={600} testId="uptime">{s ? duration(s.uptime) : '—'}</T>
        </Pill>
        <Pill testId="stress-button" tone={stress.length ? 'active' : 'plain'} onClick={toggleStress}>
          <Dot color={stress.length ? hex(ORANGE) : C.faint} />
          <T size={12} weight={600} testId="stress-label">{stress.length ? `Stop stress · ${stress.length} workers` : 'Stress test'}</T>
        </Pill>
      </div>

      {/* Row 1: CPU + cores */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
        <Card grow={1.75}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 22 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Label>CPU</Label>
              <T size={30} weight={600} testId="cpu-total">{pct(cpuTotal)}</T>
            </div>
            <div style={{ flexGrow: 1 }} />
            <Legend color={hex(BLUE)} label="User" value={pct(s?.cpu.user ?? 0)} />
            <Legend color={hex(ORANGE)} label="System" value={pct(s?.cpu.system ?? 0)} />
            <Legend color={C.faint} label="Load" value={s ? s.load.map((l) => l.toFixed(2)).join(' · ') : '—'} testId="load" />
          </div>
          <LiveChart
            testId="chart-cpu"
            history={hist.cpu}
            stacked
            series={[
              { key: 0, color: BLUE, label: 'User' },
              { key: 1, color: ORANGE, label: 'System' },
            ]}
            height={132}
            scale={() => 100}
            format={(v) => pct(v, 1)}
          />
        </Card>
        <Card testId="cores-card">
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
            <Label>{`${s?.cores.length ?? info.cores} CORES`}</Label>
            <div style={{ flexGrow: 1 }} />
            <T size={11} color={C.muted}>{info.model}</T>
          </div>
          <div style={{ display: 'flex', flexGrow: 1, flexDirection: 'row', gap: 6, alignItems: 'stretch' }}>
            {(s?.cores ?? []).map((c, i) => (
              <div key={i} style={{ display: 'flex', flexGrow: 1, flexBasis: 0, flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                <T size={10} color={c.total > 60 ? hex(ORANGE) : C.muted} mono testId={`core-${i}`}>{Math.round(c.total)}</T>
                <div style={{ display: 'flex', height: CORE_H, width: '100%', borderRadius: 5, backgroundColor: C.track, flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
                  <motion.div
                    animate={{ height: (Math.min(100, c.system) / 100) * CORE_H }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    style={{ width: '100%', backgroundColor: hex(ORANGE, 0.9) }}
                  />
                  <motion.div
                    animate={{ height: (Math.min(100, c.user) / 100) * CORE_H }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    style={{ width: '100%', backgroundColor: hex(BLUE) }}
                  />
                </div>
                <T size={10} color={C.faint}>{String(i + 1)}</T>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Row 2: memory, network, disk, energy */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
        <Card testId="memory-card">
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Label>MEMORY</Label>
              <T size={20} weight={600} testId="memory-used">{mem ? bytes(mem.used) : '—'}</T>
            </div>
            <div style={{ flexGrow: 1 }} />
            <T size={11} color={C.muted}>{`of ${bytes(info.memory, 0)}`}</T>
          </div>
          <LiveChart
            testId="chart-memory"
            history={hist.mem}
            stacked
            series={[
              { key: 0, color: GREEN, label: 'Used' },
              { key: 1, color: [142, 142, 147], label: 'Cached' },
            ]}
            height={54}
            scale={() => info.memory}
            format={(v) => bytes(v)}
          />
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Dot color={pressureColor} size={7} />
            <T size={11} color={C.secondary} testId="memory-pressure">{mem ? `Pressure ${pct(mem.pressure)}` : 'Pressure —'}</T>
            <div style={{ flexGrow: 1 }} />
            <T size={11} color={C.muted}>{mem ? `Swap ${bytes(mem.swapUsed)}` : ''}</T>
          </div>
        </Card>
        <Card testId="network-card">
          <DualHeader label="NETWORK" a={{ label: '↓', value: rate(s?.netIn ?? 0), color: CYAN }} b={{ label: '↑', value: rate(s?.netOut ?? 0), color: GREEN }} />
          <LiveChart
            testId="chart-network"
            history={hist.net}
            series={[
              { key: 0, color: CYAN, label: 'In' },
              { key: 1, color: GREEN, label: 'Out' },
            ]}
            height={78}
            scale={(from) => niceCeil(Math.max(hist.net.max(0, from), hist.net.max(1, from)) * 1.15, 16 * 1024)}
            format={rate}
          />
        </Card>
        <Card testId="disk-card">
          <DualHeader label="DISK" a={{ label: 'R', value: rate(s?.diskRead ?? 0), color: BLUE }} b={{ label: 'W', value: rate(s?.diskWrite ?? 0), color: RED }} />
          <LiveChart
            testId="chart-disk"
            history={hist.disk}
            series={[
              { key: 0, color: BLUE, label: 'Read' },
              { key: 1, color: RED, label: 'Write' },
            ]}
            height={78}
            scale={(from) => niceCeil(Math.max(hist.disk.max(0, from), hist.disk.max(1, from)) * 1.15, 64 * 1024)}
            format={rate}
          />
        </Card>
        <Card testId="energy-card" grow={0.8}>
          <Label>ENERGY & THERMAL</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <KV k="Power" v={s?.power ? s.power.source : '—'} />
            <KV k="Battery" v={s?.power?.battery != null ? `${s.power.battery}%${s.power.charging ? ' · charging' : ''}` : 'No battery'} />
            <KV k="Thermal" v={s?.power ? s.power.thermal : '—'} />
            <KV k="Processes" v={String(procs.length)} />
          </div>
        </Card>
      </div>

      {/* Row 3: processes + detail panel */}
      <div style={{ display: 'flex', flexGrow: 1, minHeight: 0, flexDirection: 'row', borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexGrow: 1, flexShrink: 1, minWidth: 0, flexDirection: 'column', paddingTop: 12, paddingLeft: 10, paddingRight: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4, paddingRight: 4, paddingBottom: 8 }}>
            <Label>PROCESSES</Label>
            <T size={11} color={C.faint} testId="process-count">{query ? `${filtered.length} of ${procs.length}` : `${procs.length}`}</T>
            <div style={{ flexGrow: 1 }} />
            <div style={{ display: 'flex', width: 240, height: 28, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 10, borderRadius: 8, backgroundColor: '#0000002E', borderWidth: 1, borderColor: '#FFFFFF14' }}>
              <T size={12} color={C.muted}>⌕</T>
              <input
                testId="search"
                value={query}
                placeholder="Search processes"
                onChange={(e: EventPayload) => setQuery(e.value ?? '')}
                style={{ flexGrow: 1, fontSize: 12, color: C.text, fontFamily: FONT }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', paddingBottom: 2, borderBottomWidth: 1, borderColor: '#FFFFFF12' }}>
            {COLUMNS.map((col) => (
              <HeaderCell key={col.key} col={col} sort={sort} desc={desc} onSort={onSort} />
            ))}
          </div>
          <virtual-list estimatedItemHeight={28} style={{ flexGrow: 1, minHeight: 0, paddingTop: 4 }}>
            {shown.map((p) => (
              <ProcessRow
                key={p.pid}
                p={p}
                selected={p.pid === selected}
                isStress={stressSet.has(p.pid)}
                maxCpu={maxCpu}
                onSelect={onSelect}
              />
            ))}
          </virtual-list>
          {shown.length === 0 && (
            <div style={{ display: 'flex', padding: 24, alignItems: 'center' }}>
              <T size={13} color={C.muted} testId="empty-state">{procs.length ? `No processes match “${query}”` : 'Sampling…'}</T>
            </div>
          )}
        </div>
        <motion.div
          initial={false}
          animate={{ width: selectedProc ? 300 : 0, opacity: selectedProc ? 1 : 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          style={{ flexShrink: 0, overflow: 'hidden', backgroundColor: '#FFFFFF0A', borderLeftWidth: 1, borderColor: '#FFFFFF14' }}
        >
          <DetailPanel
            proc={selectedProc}
            detail={detail}
            cpuTrail={selectedProc ? hist.procCpu.get(selectedProc.pid) ?? [] : []}
            isStress={!!selectedProc && stressSet.has(selectedProc.pid)}
            onClose={() => setSelected(null)}
            onQuit={() => selectedProc && setConfirm(selectedProc)}
          />
        </motion.div>
      </div>

      {/* Footer: GPUIX's own overhead */}
      <div style={{ display: 'flex', height: 18, flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 4, paddingRight: 4 }}>
        <T size={11} color={C.faint}>GPUIX 0.11 · Metal · sampling every 500 ms</T>
        <div style={{ flexGrow: 1 }} />
        <T size={11} color={C.muted} testId="footer-overhead">
          {`System Pulse  CPU ${pct(overhead.cpu, 1)}  ·  RSS ${bytes(overhead.rss)}  ·  chart paint ${paintStats.avgMs.toFixed(1)} ms${overhead.frameP90 != null ? `  ·  frame p90 ${overhead.frameP90.toFixed(1)} ms` : ''}`}
        </T>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogPortal>
          <DialogBackdrop style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000066' }} />
          <DialogPopup
            testId="quit-dialog"
            style={{
              display: 'flex',
              position: 'absolute',
              left: Math.round((win.width - 340) / 2),
              top: Math.round(win.height * 0.32),
              width: 340,
              flexDirection: 'column',
              gap: 10,
              padding: 20,
              borderRadius: 14,
              backgroundColor: '#2C2C2EF5',
              borderWidth: 1,
              borderColor: '#FFFFFF24',
            }}
          >
            <DialogTitle>
              <T size={15} weight={700}>{confirm ? `Quit “${confirm.name}”?` : ''}</T>
            </DialogTitle>
            <DialogDescription>
              <T size={12} color={C.secondary}>
                {confirm ? `System Pulse will send SIGTERM to PID ${confirm.pid}${stressSet.has(confirm.pid) ? ', a stress worker it started.' : '. Unsaved work in that process may be lost.'}` : ''}
              </T>
            </DialogDescription>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 8, justifyContent: 'flex-end', paddingTop: 6 }}>
              <DialogClose testId="cancel-quit" style={{ display: 'flex', height: 28, paddingLeft: 14, paddingRight: 14, borderRadius: 8, backgroundColor: '#FFFFFF1F', justifyContent: 'center', cursor: 'pointer' }}>
                <T size={13} weight={500}>Cancel</T>
              </DialogClose>
              <Pill testId="confirm-quit" tone="danger" onClick={() => confirm && quit(confirm)}>
                <T size={13} weight={600} color="#FFFFFF">Quit</T>
              </Pill>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </div>
  )
}

function Legend({ color, label, value, testId }: { color: string; label: string; value: string; testId?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Dot color={color} size={7} />
        <T size={11} color={C.muted}>{label}</T>
      </div>
      <T size={13} weight={600} testId={testId}>{value}</T>
    </div>
  )
}

function DualHeader({ label, a, b }: { label: string; a: { label: string; value: string; color: RGB }; b: { label: string; value: string; color: RGB } }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Label>{label}</Label>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
        {[a, b].map((x) => (
          <div key={x.label} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <T size={12} weight={700} color={hex(x.color)}>{x.label}</T>
            <T size={15} weight={600}>{x.value}</T>
          </div>
        ))}
      </div>
    </div>
  )
}
