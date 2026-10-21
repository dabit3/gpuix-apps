import { motion, useGpuixRequired, useWindowSize, isTerminal } from '@gpuix/react'
import type { EventPayload, ImgInstance } from '@gpuix/react'
import { readFileSync } from 'node:fs'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  formatTime,
  frameLocation,
  layoutLeftHeavy,
  layoutTimeOrder,
  matchedTime,
  matchesQuery,
  sandwich,
  topFunctions,
  type Cell,
  type Layout,
  type Profile,
} from './profile.ts'
import { CHAR_W, FONT, T, frameColor } from './theme.ts'

export type View = 'flame' | 'icicle' | 'sandwich'
export type Order = 'heavy' | 'time'
export type Viewport = { x0: number; x1: number }

export type ProfileSource = {
  current(): Profile
  /** Calls back with each reloaded profile. Returns an unsubscribe. */
  subscribe(cb: (p: Profile) => void): () => void
}

const ROW = 20
const ZOOM_S = 0.32

function Txt({ children, color = T.fg, size = 12, weight, testId }: { children: ReactNode; color?: string; size?: number; weight?: number; testId?: string }) {
  return (
    <text testId={testId} style={{ color, fontSize: size, fontWeight: weight, fontFamily: FONT }}>
      {children}
    </text>
  )
}

function fit(label: string, px: number): string {
  const n = Math.floor((px - 10) / CHAR_W)
  if (n < 3) return ''
  return label.length <= n ? label : label.slice(0, n - 1) + '…'
}

function pct(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0%'
}

function hitTest(layout: Layout, vp: Viewport, w: number, h: number, up: boolean, lx: number, ly: number): Cell | null {
  if (lx < 0 || ly < 0 || lx > w || ly > h) return null
  const depth = up ? Math.floor((h - ly) / ROW) : Math.floor(ly / ROW)
  const row = layout.rows[depth]
  if (!row) return null
  const t = vp.x0 + (lx / w) * (vp.x1 - vp.x0)
  let lo = 0
  let hi = row.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = row[mid]!
    if (t < c.start) hi = mid - 1
    else if (t >= c.end) lo = mid + 1
    else return c
  }
  return null
}

type GraphProps = {
  testId: string
  profile: Profile
  layout: Layout
  layoutKey: string
  viewport: Viewport
  duration: number
  up: boolean
  query: string
  selected: number | null
  onHover(cell: Cell | null, x: number, y: number): void
  onPick(cell: Cell): void
  onWheel?(e: EventPayload, lx: number, w: number): void
}

/** One flamegraph pane: GPU-painted cells whose left/width tween natively on zoom. */
function Graph(p: GraphProps) {
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 })
  const prev = useRef<{ vp: Viewport; key: string }>({ vp: p.viewport, key: p.layoutKey })
  const { x0, x1 } = p.viewport
  const span = Math.max(1, x1 - x0)
  const prevVp = prev.current.key === p.layoutKey ? prev.current.vp : p.viewport
  const pspan = Math.max(1, prevVp.x1 - prevVp.x0)
  useEffect(() => {
    prev.current = { vp: p.viewport, key: p.layoutKey }
  })
  const W = box.w
  const H = box.h
  const maxDepth = Math.floor(H / ROW)
  const cells: ReactNode[] = []
  if (W > 0) {
    for (const c of p.layout.cells) {
      if (c.depth >= maxDepth) continue
      const left = ((c.start - x0) / span) * W
      const width = ((c.end - c.start) / span) * W
      const pleft = ((c.start - prevVp.x0) / pspan) * W
      const pwidth = ((c.end - c.start) / pspan) * W
      const visNow = width >= 0.75 && left < W && left + width > 0
      const visPrev = pwidth >= 0.75 && pleft < W && pleft + pwidth > 0
      if (!visNow && !(visPrev && p.duration > 0)) continue
      const f = p.profile.frames[c.frame]!
      const col = frameColor(f)
      const dim = p.query !== '' && !matchesQuery(f, p.query)
      const top = p.up ? H - (c.depth + 1) * ROW : c.depth * ROW
      const label = fit(f.name, Math.min(width, W))
      const sel = p.selected === c.id
      cells.push(
        <motion.div
          key={`${p.layoutKey}:${c.id}`}
          initial={{ left: pleft, width: Math.max(0, pwidth - 1) }}
          animate={{ left, width: Math.max(0, width - 1) }}
          transition={{ duration: p.duration, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            top,
            height: ROW - 1,
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            paddingLeft: 5,
            borderRadius: 2,
            backgroundColor: col.bg,
            opacity: dim ? 0.22 : 1,
            borderWidth: sel ? 1 : 0,
            borderColor: T.fg,
            pointerEvents: 'none',
          }}
        >
          {label ? (
            <text style={{ color: col.fg, fontSize: 11.5, fontFamily: FONT, whiteSpace: 'nowrap' }}>{label}</text>
          ) : null}
        </motion.div>,
      )
    }
  }
  const local = (e: EventPayload) => [(e.x ?? 0) - box.x, (e.y ?? 0) - box.y] as const
  return (
    <div
      testId={p.testId}
      onLayout={(e: EventPayload) => setBox({ x: e.x ?? 0, y: e.y ?? 0, w: e.width ?? 0, h: e.height ?? 0 })}
      onMouseMove={(e: EventPayload) => {
        const [lx, ly] = local(e)
        p.onHover(hitTest(p.layout, p.viewport, W, H, p.up, lx, ly), e.x ?? 0, e.y ?? 0)
      }}
      onMouseLeave={() => p.onHover(null, 0, 0)}
      onClick={(e: EventPayload) => {
        const [lx, ly] = local(e)
        const c = hitTest(p.layout, p.viewport, W, H, p.up, lx, ly)
        if (c) p.onPick(c)
      }}
      onScroll={p.onWheel ? (e: EventPayload) => p.onWheel!(e, local(e)[0], W) : undefined}
      style={{ position: 'relative', flexGrow: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden', cursor: 'pointer' }}
    >
      {cells}
    </div>
  )
}

/** Whole-profile overview painted from raw RGBA through setImagePixels. */
function Minimap({ profile, layout, viewport, onSeek }: { profile: Profile; layout: Layout; viewport: Viewport; onSeek(t: number, drag: boolean): void }) {
  const img = useRef<ImgInstance>(null)
  const [box, setBox] = useState({ x: 0, w: 0 })
  const H = 36
  useLayoutEffect(() => {
    const w = Math.max(1, Math.round(box.w))
    const rows = Math.max(1, layout.depth)
    const rowH = Math.max(1, Math.floor(H / rows))
    const px = new Uint8Array(w * H * 4)
    for (let i = 0; i < w * H; i++) {
      px[i * 4] = 0x11
      px[i * 4 + 1] = 0x14
      px[i * 4 + 2] = 0x1a
      px[i * 4 + 3] = 255
    }
    for (const c of layout.cells) {
      const a = Math.floor((c.start / layout.total) * w)
      const b = Math.max(a + 1, Math.ceil((c.end / layout.total) * w))
      const hex = frameColor(profile.frames[c.frame]!).bg
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const bl = parseInt(hex.slice(5, 7), 16)
      const y0 = H - (c.depth + 1) * rowH
      for (let y = Math.max(0, y0); y < y0 + rowH - (rowH > 2 ? 1 : 0) && y < H; y++) {
        for (let x = a; x < b && x < w; x++) {
          const o = (y * w + x) * 4
          px[o] = r
          px[o + 1] = g
          px[o + 2] = bl
        }
      }
    }
    img.current?.setImagePixels(w, H, px)
  }, [layout, profile, box.w])
  const left = (viewport.x0 / layout.total) * box.w
  const width = Math.max(2, ((viewport.x1 - viewport.x0) / layout.total) * box.w)
  const seek = (e: EventPayload, drag: boolean) => onSeek((((e.x ?? 0) - box.x) / Math.max(1, box.w)) * layout.total, drag)
  const down = useRef(false)
  return (
    <div
      testId="minimap"
      onLayout={(e: EventPayload) => setBox({ x: e.x ?? 0, w: e.width ?? 0 })}
      onMouseDown={(e: EventPayload) => {
        down.current = true
        seek(e, false)
      }}
      onMouseMove={(e: EventPayload) => {
        if (down.current && e.pressedButton !== undefined && e.pressedButton !== null) seek(e, true)
      }}
      onMouseUp={() => (down.current = false)}
      style={{ position: 'relative', height: H, flexShrink: 0, borderRadius: 4, overflow: 'hidden', cursor: 'pointer' }}
    >
      <img ref={img} objectFit="fill" style={{ width: Math.max(1, box.w), height: H }} />
      <div
        style={{
          position: 'absolute',
          left,
          top: 0,
          width,
          height: H,
          borderWidth: 1,
          borderColor: T.blue,
          borderRadius: 3,
          backgroundColor: '#71b7ff1f',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function Segment<V extends string>({ value, options, onChange, testId }: { value: V; options: [V, string][]; onChange(v: V): void; testId: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', borderWidth: 1, borderColor: T.line, borderRadius: 6, padding: 2, gap: 2 }}>
      {options.map(([v, label]) => (
        <div
          key={v}
          testId={`${testId}-${v}`}
          onClick={() => onChange(v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 22,
            paddingLeft: 9,
            paddingRight: 9,
            borderRadius: 4,
            backgroundColor: v === value ? '#71b7ff2e' : undefined,
            cursor: 'pointer',
            hover: { backgroundColor: v === value ? '#71b7ff2e' : T.hover },
          }}
        >
          <Txt size={12} color={v === value ? T.blue : T.muted} weight={v === value ? 600 : 400}>
            {label}
          </Txt>
        </div>
      ))}
    </div>
  )
}

const sourceCache = new Map<string, string[] | null>()
function sourceLines(file: string): string[] | null {
  if (!sourceCache.has(file)) {
    try {
      sourceCache.set(file, readFileSync(file, 'utf8').split('\n'))
    } catch {
      sourceCache.set(file, null)
    }
  }
  return sourceCache.get(file)!
}

function SourcePanel({ profile, frame, stat }: { profile: Profile; frame: number; stat?: { self: number; total: number } }) {
  const f = profile.frames[frame]!
  const lines = f.file ? sourceLines(f.file) : null
  const LH = 18
  const start = Math.max(1, f.line - 3)
  const slice = lines ? lines.slice(start - 1, start - 1 + 40) : []
  return (
    <div testId="source" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minHeight: 0, borderTopWidth: 1, borderColor: T.line }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 30, paddingLeft: 12, paddingRight: 12, flexShrink: 0 }}>
        <Txt weight={700} testId="source-name">{f.name}</Txt>
        <Txt color={T.faint}>{frameLocation(f)}</Txt>
        <div style={{ flexGrow: 1 }} />
        {stat ? <Txt color={T.yellow}>{`self ${formatTime(stat.self)}`}</Txt> : null}
      </div>
      {lines && f.line ? (
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0, overflow: 'hidden', paddingTop: 4 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 4 + (f.line - start) * LH, height: LH, backgroundColor: '#f0b72f24', borderLeftWidth: 2, borderColor: T.yellow }} />
          <div style={{ display: 'flex', flexDirection: 'column', width: 44, flexShrink: 0, alignItems: 'flex-end', paddingRight: 10 }}>
            {slice.map((_, i) => (
              <div key={i} style={{ display: 'flex', height: LH, alignItems: 'center' }}>
                <text style={{ color: start + i === f.line ? T.yellow : T.faint, fontSize: 11.5, fontFamily: FONT }}>{String(start + i)}</text>
              </div>
            ))}
          </div>
          <code code={slice.join('\n')} path={f.file} style={{ flexGrow: 1, minWidth: 0, fontSize: 12, lineHeight: LH, fontFamily: FONT }} />
        </div>
      ) : (
        <div style={{ display: 'flex', padding: 12 }}>
          <Txt color={T.faint}>{f.kind === 'user' ? 'Source file not found' : `No source: ${f.kind} frame`}</Txt>
        </div>
      )}
    </div>
  )
}

export type AppProps = { source: ProfileSource; initialView?: View; initialOrder?: Order; initialQuery?: string }

export function FlameApp({ source, initialView = 'flame', initialOrder = 'heavy', initialQuery = '' }: AppProps) {
  const renderer = useGpuixRequired()
  const size = useWindowSize()
  const [profile, setProfile] = useState(() => source.current())
  const [view, setView] = useState<View>(initialView)
  const [order, setOrder] = useState<Order>(initialOrder)
  const [query, setQuery] = useState(initialQuery)
  const [vp, setVp] = useState<Viewport>({ x0: 0, x1: profile.total })
  const [duration, setDuration] = useState(0)
  const [history, setHistory] = useState<Viewport[]>([])
  const [zoomed, setZoomed] = useState<Cell | null>(null)
  const [selFrame, setSelFrame] = useState<number | null>(null)
  const [hover, setHover] = useState<{ cell: Cell; x: number; y: number; pane: string } | null>(null)
  const [sortBy, setSortBy] = useState<'self' | 'total'>('self')
  const [toast, setToast] = useState<{ text: string; good: boolean } | null>(null)
  const [reloads, setReloads] = useState(0)
  const rootRef = useRef<{ id: number }>(null)
  const searchRef = useRef<{ id: number }>(null)

  const layout = useMemo(() => (order === 'heavy' ? layoutLeftHeavy(profile) : layoutTimeOrder(profile)), [profile, order])
  const layoutKey = `${order}:${reloads}`
  const stats = useMemo(() => topFunctions(profile), [profile])
  const statOf = useMemo(() => new Map(stats.map((s) => [s.frame, s])), [stats])
  const sorted = useMemo(() => [...stats].sort((a, b) => (sortBy === 'self' ? b.self - a.self : b.total - a.total)).slice(0, 400), [stats, sortBy])
  const sandwichFrame = selFrame != null && profile.frames[selFrame] ? selFrame : (stats[0]?.frame ?? 0)
  const sw = useMemo(() => (view === 'sandwich' ? sandwich(profile, sandwichFrame) : null), [view, profile, sandwichFrame])
  const matched = useMemo(() => matchedTime(profile, query), [profile, query])

  const profileRef = useRef(profile)
  profileRef.current = profile
  useEffect(
    () =>
      source.subscribe((next) => {
        // Frame indices are per-profile; carry the selection over by identity.
        setSelFrame((sel) => {
          if (sel == null) return null
          const key = profileRef.current.frames[sel]?.key
          const i = key ? next.frames.findIndex((f) => f.key === key) : -1
          return i > 0 ? i : null
        })
        setProfile((prev) => {
          const delta = (next.total - prev.total) / Math.max(1, prev.total)
          setToast({
            text: `Reloaded · ${formatTime(prev.total)} → ${formatTime(next.total)} (${delta <= 0 ? '−' : '+'}${Math.abs(delta * 100).toFixed(0)}%)`,
            good: delta <= 0,
          })
          return next
        })
        setReloads((n) => n + 1)
        setVp({ x0: 0, x1: next.total })
        setHistory([])
        setZoomed(null)
        setDuration(0)
      }),
    [source],
  )
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  const focusRoot = () => {
    if (rootRef.current) renderer.focusElement?.(rootRef.current.id)
  }
  useEffect(() => {
    const t = setTimeout(focusRoot, 50)
    return () => clearTimeout(t)
  }, [])

  const zoomTo = (cell: Cell | null) => {
    const target = cell && cell.depth > 0 ? { x0: cell.start, x1: cell.end } : { x0: 0, x1: layout.total }
    setHistory((h) => [...h, vp])
    setDuration(ZOOM_S)
    setVp(target)
    setZoomed(cell && cell.depth > 0 ? cell : null)
  }
  const zoomOut = () => {
    const last = history[history.length - 1]
    setDuration(ZOOM_S)
    setVp(last ?? { x0: 0, x1: layout.total })
    setHistory((h) => h.slice(0, -1))
    if (!last || (last.x0 === 0 && last.x1 === layout.total)) setZoomed(null)
  }
  const reset = () => {
    setDuration(ZOOM_S)
    setVp({ x0: 0, x1: layout.total })
    setHistory([])
    setZoomed(null)
  }
  const changeOrder = (o: Order) => {
    setOrder(o)
    setDuration(0)
    setVp({ x0: 0, x1: profile.total })
    setHistory([])
    setZoomed(null)
  }
  const pick = (cell: Cell) => {
    setSelFrame(cell.depth > 0 ? cell.frame : null)
    zoomTo(cell)
    focusRoot()
  }
  const wheel = (e: EventPayload, lx: number, w: number) => {
    const dy = e.deltaY ?? 0
    const dx = e.deltaX ?? 0
    const s = vp.x1 - vp.x0
    if (Math.abs(dx) > Math.abs(dy)) {
      const shift = (-dx / Math.max(1, w)) * s
      const x0 = Math.min(Math.max(0, vp.x0 + shift), layout.total - s)
      setDuration(0)
      setVp({ x0, x1: x0 + s })
      return
    }
    const factor = Math.exp(-dy * 0.004)
    const t = vp.x0 + (lx / Math.max(1, w)) * s
    const ns = Math.min(layout.total, Math.max(layout.total / 5000, s * factor))
    let x0 = t - (lx / Math.max(1, w)) * ns
    x0 = Math.min(Math.max(0, x0), layout.total - ns)
    setDuration(0)
    setVp({ x0, x1: x0 + ns })
    setZoomed(null)
  }
  const seek = (t: number, drag: boolean) => {
    const s = vp.x1 - vp.x0
    const x0 = Math.min(Math.max(0, t - s / 2), layout.total - s)
    setDuration(drag ? 0 : 0.2)
    setVp({ x0, x1: x0 + s })
  }

  const onKey = (e: EventPayload) => {
    const inSearch = searchRef.current != null && renderer.getFocusedElementId?.() === searchRef.current.id
    const key = e.key ?? ''
    if (inSearch) {
      if (key === 'escape') {
        setQuery('')
        focusRoot()
      } else if (key === 'enter') focusRoot()
      return
    }
    if (e.modifiers?.cmd || e.modifiers?.ctrl) return
    if (key === '/' || e.keyChar === '/') {
      if (searchRef.current) renderer.focusElement?.(searchRef.current.id)
    } else if (key === 'escape' || key === 'backspace') {
      if (query && key === 'escape') setQuery('')
      else zoomOut()
    } else if (key === 'r' || key === '0') reset()
    else if (key === 'f') setView('flame')
    else if (key === 'i') setView('icicle')
    else if (key === 's') setView('sandwich')
    else if (key === 't') changeOrder(order === 'heavy' ? 'time' : 'heavy')
  }

  const wide = size.width >= 1000
  const roomy = size.width >= 820
  const term = isTerminal()
  const hovered = hover ? profile.frames[hover.cell.frame]! : null
  const hstat = hovered && hover ? statOf.get(hover.cell.frame) : undefined
  const crumbs: Cell[] = []
  for (let c: Cell | undefined = zoomed ?? undefined; c; c = c.parent >= 0 ? layout.cells[c.parent] : undefined) crumbs.unshift(c)
  if (crumbs.length === 0) crumbs.push(layout.cells[0]!)

  const hoverFor = (pane: string) => (cell: Cell | null, x: number, y: number) => setHover(cell ? { cell, x, y, pane } : null)

  return (
    <div
      ref={rootRef as never}
      testId="root"
      tabIndex={0}
      onKeyDown={onKey}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: T.bg, fontFamily: FONT }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingLeft: term ? 14 : 84, paddingRight: 14, flexShrink: 0, borderBottomWidth: 1, borderColor: T.line }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 18, alignItems: 'center' }}>
          <div style={{ width: 6, height: 4, borderRadius: 1, backgroundColor: T.yellow }} />
          <div style={{ width: 12, height: 4, borderRadius: 1, backgroundColor: '#ffb14a' }} />
          <div style={{ width: 18, height: 4, borderRadius: 1, backgroundColor: T.red }} />
        </div>
        <Txt size={14} weight={700}>flame</Txt>
        <Txt size={12} color={T.muted} testId="file-name">{profile.path.split('/').pop()}</Txt>
        {roomy ? (
          <Txt size={12} color={T.faint} testId="meta">{`${formatTime(profile.total)} · ${profile.sampleCount.toLocaleString('en-US')} samples · ${formatTime(profile.intervalUs)}`}</Txt>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <Segment testId="view" value={view} onChange={(v) => (setView(v), focusRoot())} options={[['flame', 'Flame'], ['icicle', 'Icicle'], ['sandwich', 'Sandwich']]} />
        {roomy ? <Segment testId="order" value={order} onChange={(o) => (changeOrder(o), focusRoot())} options={[['heavy', 'Left heavy'], ['time', 'Time order']]} /> : null}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, width: roomy ? 230 : 150, height: 28, paddingLeft: 9, paddingRight: 9, borderRadius: 6, borderWidth: 1, borderColor: query ? T.blue : T.line, backgroundColor: T.panel }}>
          <Txt color={T.faint}>/</Txt>
          <input
            ref={searchRef as never}
            testId="search"
            value={query}
            placeholder="Search frames"
            onChange={(e: EventPayload) => setQuery(e.value ?? '')}
            onSubmit={() => focusRoot()}
            style={{ flexGrow: 1, fontSize: 12, color: T.fg, fontFamily: FONT }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, paddingLeft: 12, paddingRight: 12, paddingTop: 10, gap: 8 }}>
          {view !== 'sandwich' ? (
            <>
              <Minimap profile={profile} layout={layout} viewport={vp} onSeek={seek} />
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 20, flexShrink: 0, overflow: 'hidden' }}>
                {crumbs.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {i > 0 ? <Txt color={T.faint}>›</Txt> : null}
                    <div testId={`crumb-${i}`} onClick={() => (i === 0 ? reset() : zoomTo(c))} style={{ display: 'flex', cursor: 'pointer', hover: { opacity: 0.7 } }}>
                      <Txt color={i === crumbs.length - 1 ? T.fg : T.muted}>{i === 0 ? 'all' : profile.frames[c.frame]!.name}</Txt>
                    </div>
                  </div>
                ))}
                <div style={{ flexGrow: 1 }} />
                {query ? <Txt color={T.blue} testId="match-summary">{`${pct(matched, profile.total)} match “${query}” · ${formatTime(matched)}`}</Txt> : <Txt color={T.faint} testId="zoom-span">{`${formatTime(vp.x1 - vp.x0)} visible`}</Txt>}
              </div>
              <Graph
                testId="graph"
                profile={profile}
                layout={layout}
                layoutKey={layoutKey}
                viewport={vp}
                duration={duration}
                up={view === 'flame'}
                query={query}
                selected={zoomed?.id ?? null}
                onHover={hoverFor('graph')}
                onPick={pick}
                onWheel={wheel}
              />
            </>
          ) : sw ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 20, flexShrink: 0 }}>
                <Txt color={T.muted}>callers of</Txt>
                <Txt weight={700} testId="sandwich-name">{profile.frames[sandwichFrame]!.name}</Txt>
                <Txt color={T.faint}>{`total ${formatTime(statOf.get(sandwichFrame)?.total ?? 0)} · self ${formatTime(statOf.get(sandwichFrame)?.self ?? 0)}`}</Txt>
              </div>
              <Graph testId="callers" profile={profile} layout={sw.callers} layoutKey={`up:${sandwichFrame}:${reloads}`} viewport={{ x0: 0, x1: sw.callers.total }} duration={0} up query={query} selected={null} onHover={hoverFor('callers')} onPick={(c) => (setSelFrame(c.frame), focusRoot())} />
              <div style={{ height: 1, flexShrink: 0, backgroundColor: T.line }} />
              <Txt color={T.muted}>callees</Txt>
              <Graph testId="callees" profile={profile} layout={sw.callees} layoutKey={`down:${sandwichFrame}:${reloads}`} viewport={{ x0: 0, x1: sw.callees.total }} duration={0} up={false} query={query} selected={null} onHover={hoverFor('callees')} onPick={(c) => (setSelFrame(c.frame), focusRoot())} />
            </>
          ) : null}
        </div>

        {wide ? (
          <div testId="sidebar" style={{ display: 'flex', flexDirection: 'column', width: Math.min(420, Math.round(size.width * 0.32)), flexShrink: 0, borderLeftWidth: 1, borderColor: T.line }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 30, paddingLeft: 12, paddingRight: 12, gap: 8, flexShrink: 0 }}>
              <Txt weight={700}>Top functions</Txt>
              <div style={{ flexGrow: 1 }} />
              {(['self', 'total'] as const).map((k) => (
                <div key={k} testId={`sort-${k}`} onClick={() => setSortBy(k)} style={{ display: 'flex', cursor: 'pointer', paddingLeft: 4, paddingRight: 4 }}>
                  <Txt color={sortBy === k ? T.blue : T.faint} weight={sortBy === k ? 600 : 400}>{k === 'self' ? 'Self' : 'Total'}</Txt>
                </div>
              ))}
            </div>
            <virtual-list testId="functions" estimatedItemHeight={26} style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
              {sorted.map((s) => {
                const f = profile.frames[s.frame]!
                const v = sortBy === 'self' ? s.self : s.total
                const on = view === 'sandwich' ? sandwichFrame === s.frame : selFrame === s.frame
                return (
                  <div
                    key={f.key}
                    testId={`fn-${f.name}`}
                    onClick={() => {
                      setSelFrame(s.frame)
                      setView('sandwich')
                      focusRoot()
                    }}
                    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 26, paddingLeft: 12, paddingRight: 12, backgroundColor: on ? T.selected : undefined, cursor: 'pointer', hover: { backgroundColor: on ? T.selected : T.hover } }}
                  >
                    <div style={{ display: 'flex', width: 64, flexShrink: 0, justifyContent: 'flex-end' }}>
                      <Txt color={T.fg}>{formatTime(v)}</Txt>
                    </div>
                    <div style={{ display: 'flex', width: 46, height: 4, flexShrink: 0, borderRadius: 2, backgroundColor: T.line }}>
                      <div style={{ width: Math.max(1, (v / profile.total) * 46), height: 4, borderRadius: 2, backgroundColor: frameColor(f).bg }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexGrow: 1, minWidth: 0, overflow: 'hidden' }}>
                      <text style={{ color: T.fg, fontSize: 12, fontFamily: FONT, whiteSpace: 'nowrap' }}>{f.name}</text>
                      <text style={{ color: T.faint, fontSize: 11.5, fontFamily: FONT, whiteSpace: 'nowrap' }}>{frameLocation(f)}</text>
                    </div>
                  </div>
                )
              })}
            </virtual-list>
            {(view === 'sandwich' ? sandwichFrame : selFrame) != null ? (
              <SourcePanel profile={profile} frame={(view === 'sandwich' ? sandwichFrame : selFrame)!} stat={statOf.get((view === 'sandwich' ? sandwichFrame : selFrame)!)} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, height: 26, paddingLeft: 14, paddingRight: 14, flexShrink: 0, borderTopWidth: 1, borderColor: T.line }}>
        {hovered && hover ? (
          <>
            <Txt weight={600} testId="status-name">{hovered.name}</Txt>
            <Txt color={T.faint}>{frameLocation(hovered)}</Txt>
            <Txt color={T.muted}>{`total ${formatTime(hover.cell.end - hover.cell.start)}`}</Txt>
          </>
        ) : (
          <Txt color={T.faint}>{wide ? 'click zoom · scroll zoom · esc back · / search · f i s view · t order · ⌃C quit' : 'click zoom · esc back · / search · ⌃C quit'}</Txt>
        )}
        <div style={{ flexGrow: 1 }} />
        <Txt color={T.faint}>{term ? 'kitty graphics · ' + (process.env.SSH_CONNECTION ? 'ssh' : 'shm') : 'metal'}</Txt>
      </div>

      {hovered && hover ? (
        <div
          testId="tooltip"
          style={{
            position: 'absolute',
            left: Math.max(8, Math.min(hover.x + 16, size.width - 296)),
            top: hover.y > size.height * 0.5 ? Math.max(8, hover.y - 140) : hover.y + 20,
            width: 280,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: '#3d444d',
            backgroundColor: '#161b22f2',
            pointerEvents: 'none',
          }}
        >
          <Txt weight={700} testId="tooltip-name">{hovered.name}</Txt>
          <Txt color={T.faint}>{frameLocation(hovered)}</Txt>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 12, paddingTop: 4 }}>
            <Txt color={T.muted}>total</Txt>
            <Txt testId="tooltip-total">{`${formatTime(hover.cell.end - hover.cell.start)}  ${pct(hover.cell.end - hover.cell.start, profile.total)}`}</Txt>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
            <Txt color={T.muted}>self </Txt>
            <Txt testId="tooltip-self">{`${formatTime(hover.cell.self)}  ${pct(hover.cell.self, profile.total)}`}</Txt>
          </div>
          {hstat ? <Txt color={T.faint}>{`all calls: self ${formatTime(hstat.self)} · total ${formatTime(hstat.total)}`}</Txt> : null}
        </div>
      ) : null}

      {toast ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{ position: 'absolute', right: 16, bottom: 40, display: 'flex', alignItems: 'center', height: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 8, borderWidth: 1, borderColor: toast.good ? '#26cd4d80' : '#ff949280', backgroundColor: '#0d1117f2', pointerEvents: 'none' }}
        >
          <Txt color={toast.good ? T.green : T.red} testId="toast-text">{toast.text}</Txt>
        </motion.div>
      ) : null}
    </div>
  )
}
