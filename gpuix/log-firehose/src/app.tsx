/**
 * Firehose: a live log explorer that stays smooth with millions of lines.
 */
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useGpuixRequired, type EventPayload, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { RATES, type Controller } from './controller'
import { Histogram } from './histogram'
import { Inspector, SmallButton } from './inspector'
import { rangesIn } from './search'
import { LEVELS } from './store'
import { C, LEVEL_COLOR, LEVEL_TINT, MONO, fmt, fmtCompact, serviceColor } from './theme'
import { parseClock } from './parse'

export const ROW_H = 22
const WINDOW = 120
const LEAD = 30
/**
 * The virtual list never sees the whole view. It scrolls a page of at most
 * PAGE rows and the app moves the page near its edges. GPUIX 0.11 leaks memory
 * proportional to `itemCount` whenever `itemCount` or `windowStart` changes
 * (see README, GPUIX findings), so a 2M-row itemCount would leak ~26 MB/frame.
 */
export const PAGE = 20_000
const MARGIN = 600

/** Hooks the window-level callbacks (keys, selection) into the mounted App. */
export const windowHandlers: {
  onKeyDown?: (e: KeyEvent) => void
  onSelectionChange?: (e: EventPayload) => void
} = {}

export function copyToClipboard(text: string) {
  const p = Bun.spawn(['pbcopy'], { stdin: 'pipe' })
  p.stdin.write(text)
  p.stdin.end()
}

// ---------------------------------------------------------------------------
// Rows

const LEVEL_SHORT = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']

const Row = memo(function Row({
  ctl,
  line,
  gen,
  selected,
  active,
  re,
  onPick,
}: {
  ctl: Controller
  line: number
  gen: number
  selected: boolean
  active: boolean
  re: RegExp | null
  onPick: (line: number) => void
}) {
  void gen
  const s = ctl.store
  const raw = s.line(line)
  const lv = s.level[line]!
  const svc = s.svc[line]!
  const structured = raw.length > 31 && raw.charCodeAt(10) === 84
  const time = structured ? raw.slice(11, 23) : ''
  let rest = raw
  if (structured) {
    const sEnd = raw.indexOf(' ', 31)
    rest = sEnd < 0 ? '' : raw.slice(sEnd + 1)
  }
  if (rest.length > 400) rest = rest.slice(0, 400)
  const ranges = re ? rangesIn(re, rest) : null
  const svcName = s.services[svc] ?? '-'
  const svcRanges = re ? rangesIn(re, svcName) : null
  return (
    <div
      testId={`row-${line}`}
      onClick={() => onPick(line)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        height: ROW_H,
        paddingLeft: 14,
        paddingRight: 14,
        gap: 12,
        backgroundColor: selected ? C.rowSelected : active ? '#f59e0b1f' : LEVEL_TINT[lv],
        hover: { backgroundColor: selected ? C.rowSelected : '#ffffff0a' },
        cursor: 'default',
      }}
    >
      <div style={{ width: 88, flexShrink: 0 }}>
        <text style={{ fontFamily: MONO, fontSize: 12, color: C.textMuted, whiteSpace: 'nowrap' }}>{time}</text>
      </div>
      <div style={{ width: 44, flexShrink: 0 }}>
        <text style={{ fontFamily: MONO, fontSize: 11, color: LEVEL_COLOR[lv], fontWeight: 700, whiteSpace: 'nowrap' }}>{LEVEL_SHORT[lv]}</text>
      </div>
      <div style={{ width: 112, flexShrink: 0, overflow: 'hidden' }}>
        <text
          style={{ fontFamily: MONO, fontSize: 12, color: serviceColor(svc), whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
          highlight={svcRanges && svcRanges.length ? { ranges: svcRanges, color: C.match } : null}
        >
          {svcName}
        </text>
      </div>
      <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, overflow: 'hidden' }}>
        <text
          style={{ fontFamily: MONO, fontSize: 12, color: lv >= 4 ? '#ffd1cd' : C.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
          highlight={ranges && ranges.length ? { ranges, color: C.match, activeColor: C.matchActive, activeIndex: active ? 0 : ranges.length } : null}
        >
          {rest}
        </text>
      </div>
    </div>
  )
})

interface ListProps {
  ctl: Controller
  pageStart: number
  count: number
  start: number
  following: boolean
  selected: number
  active: number
  re: RegExp | null
  gen: number
  listRef: React.RefObject<PublicInstance | null>
  onPick: (line: number) => void
  onVisibleRange: (e: EventPayload) => void
}

/** Only `WINDOW` rows are mounted; `itemCount` tells native the full length. */
const LogList = memo(function LogList({ ctl, pageStart, count, start, following, selected, active, re, gen, listRef, onPick, onVisibleRange }: ListProps) {
  const end = Math.min(count, start + WINDOW)
  const rows = []
  for (let idx = start; idx < end; idx++) {
    const pos = pageStart + idx
    const line = ctl.view.lineAt(pos)
    rows.push(
      <Row key={pos % WINDOW} ctl={ctl} line={line} gen={gen} selected={line === selected} active={line === active} re={re} onPick={onPick} />,
    )
  }
  return (
    <virtual-list
      ref={listRef}
      itemCount={count}
      windowStart={start}
      estimatedItemHeight={ROW_H}
      alignment="bottom"
      followTail={following}
      overdraw={ROW_H * 8}
      onVisibleRange={onVisibleRange}
      style={{ flexGrow: 1, minHeight: 0, scrollbarColor: '#ffffff30', scrollbarWidth: 8 }}
    >
      {rows}
    </virtual-list>
  )
})

// ---------------------------------------------------------------------------
// Chrome

function Stat({ label, value, sub, testId, color }: { label: string; value: string; sub?: string; testId?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 112 }}>
      <text style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>{label}</text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <text testId={testId} style={{ fontSize: 20, fontWeight: 600, color: color ?? C.text, fontFamily: MONO }}>{value}</text>
        {sub && <text style={{ fontSize: 11, color: C.textMuted }}>{sub}</text>}
      </div>
    </div>
  )
}

function Segmented<T extends number>({ options, value, onChange, label, testIdPrefix }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: (v: T) => string; testIdPrefix: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', padding: 2, gap: 2, borderRadius: 7, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, userSelect: 'none' }}>
      {options.map((o) => (
        <div
          key={o}
          testId={`${testIdPrefix}-${o}`}
          onClick={() => onChange(o)}
          style={{ height: 22, paddingLeft: 9, paddingRight: 9, borderRadius: 5, display: 'flex', alignItems: 'center', cursor: 'pointer', backgroundColor: o === value ? '#ffffff1c' : 'transparent', hover: { backgroundColor: o === value ? '#ffffff1c' : '#ffffff0c' } }}
        >
          <text style={{ fontSize: 12, color: o === value ? C.text : C.textDim, fontWeight: o === value ? 600 : 400 }}>{label(o)}</text>
        </div>
      ))}
    </div>
  )
}

function SidebarRow({ label, count, color, on, onClick, testId }: { label: string; count: number; color: string; on: boolean; onClick: (e: EventPayload) => void; testId: string }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 6, cursor: 'pointer', hover: { backgroundColor: '#ffffff0a' }, opacity: on ? 1 : 0.42 }}
    >
      <div style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: on ? color : 'transparent', borderWidth: 1.5, borderColor: color }} />
      <text style={{ fontSize: 12.5, color: C.text, flexGrow: 1 }}>{label}</text>
      <text style={{ fontSize: 11, color: C.textMuted, fontFamily: MONO }}>{fmtCompact(count)}</text>
    </div>
  )
}

function Toggle({ label, on, onClick, testId, title }: { label: string; on: boolean; onClick: () => void; testId: string; title?: string }) {
  return (
    <div
      testId={testId}
      aria-label={title}
      onClick={onClick}
      style={{ height: 24, minWidth: 26, paddingLeft: 6, paddingRight: 6, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: on ? C.accentSoft : 'transparent', borderWidth: 1, borderColor: on ? '#3d8bfd66' : 'transparent', hover: { backgroundColor: on ? '#3d8bfd40' : '#ffffff0f' }, userSelect: 'none' }}
    >
      <text style={{ fontSize: 12, fontFamily: MONO, color: on ? '#cfe1ff' : C.textDim, fontWeight: 600 }}>{label}</text>
    </div>
  )
}

// ---------------------------------------------------------------------------
// App

export function FirehoseApp({ ctl }: { ctl: Controller }) {
  const renderer = useGpuixRequired()
  const version = useSyncExternalStore(ctl.subscribe, () => ctl.version)
  const listRef = useRef<PublicInstance | null>(null)
  const searchRef = useRef<PublicInstance | null>(null)
  const [following, setFollowing] = useState(true)
  const [frozen, setFrozen] = useState({ start: 0, len: 0 })
  const [start, setStart] = useState(0)
  const pageRef = useRef({ start: 0, len: 0 })
  const [selected, setSelected] = useState(-1)
  const [active, setActive] = useState(-1)
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [jump, setJump] = useState('')
  const [jumpError, setJumpError] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [selectionLen, setSelectionLen] = useState(0)
  const [perf, setPerf] = useState({ cur: 0, p90: 0, rss: 0 })
  const range = useRef<[number, number]>([0, 0])
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 0])
  const wheelUp = useRef(false)
  const followingRef = useRef(true)
  followingRef.current = following

  const view = ctl.view
  const count = view.count
  // The page of view rows the list scrolls: pinned to the tail while following.
  let page = following ? { start: Math.max(0, count - PAGE), len: Math.min(count, PAGE) } : frozen
  if (!following && page.start + page.len > count) page = { start: Math.max(0, count - Math.min(count, PAGE)), len: Math.min(count, PAGE) }
  pageRef.current = page
  const windowStart = following ? Math.max(0, page.len - WINDOW) : Math.max(0, Math.min(start, page.len - 1))

  // Debounced search: the scan itself is incremental inside the controller.
  useEffect(() => {
    const t = setTimeout(() => {
      ctl.setSearch({ query, regex, caseSensitive })
      setActive(-1)
      ctl.flushNow()
    }, query ? 90 : 0)
    return () => clearTimeout(t)
  }, [query, regex, caseSensitive])

  // Frame time + memory readout, 2x a second.
  useEffect(() => {
    const id = setInterval(() => {
      const s = renderer.getDebugFrameOverlayStats?.()
      setPerf({ cur: s?.currentMs ?? 0, p90: s?.p90Ms ?? 0, rss: process.memoryUsage().rss })
      // Programmatic scrolls do not always emit onVisibleRange; read the anchor directly.
      const id = listRef.current?.id
      const top = id != null ? renderer.getListScrollTop?.(id) : null
      if (top && !followingRef.current) {
        const si = pageRef.current.start + Math.floor(top[0]!)
        const ei = Math.min(ctl.view.count, si + Math.ceil((top[2]! + (top[1] ?? 0)) / ROW_H))
        if (si !== range.current[0] || ei !== range.current[1]) {
          range.current = [si, ei]
          setVisibleRange([si, ei])
        }
      }
      if (process.env.FIREHOSE_PERF === '1') {
        console.log(JSON.stringify({ t: Math.round(performance.now()), lines: ctl.store.count, rate: Math.round(ctl.ingestRate), view: ctl.view.count, frameMs: +(s?.currentMs ?? 0).toFixed(2), p90Ms: +(s?.p90Ms ?? 0).toFixed(2), p99Ms: +(s?.p99Ms ?? 0).toFixed(2), rssMB: Math.round(process.memoryUsage().rss / 1e6) }))
      }
    }, 500)
    return () => clearInterval(id)
  }, [renderer])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const listId = () => listRef.current?.id

  /** Scroll so `line` (or the next visible line) sits mid-viewport. */
  /** Move the page so view position `pos` is inside it, then scroll there. */
  const showPos = useCallback((pos: number, offsetInItem: number | 'center') => {
    const total = ctl.view.count
    if (pos >= total || pos < 0) return
    const cur = pageRef.current
    let next = cur
    if (pos < cur.start + MARGIN / 2 || pos >= cur.start + cur.len - MARGIN / 2 || cur.start + cur.len > total) {
      const len = Math.min(total, PAGE)
      const start = Math.max(0, Math.min(total - len, pos - (len >> 1)))
      next = { start, len }
    }
    pageRef.current = next
    setFrozen(next)
    setFollowing(false)
    setStart(Math.max(0, pos - next.start - LEAD))
    const id = listId()
    if (id == null) return
    let off = typeof offsetInItem === 'number' ? offsetInItem : 0
    if (offsetInItem === 'center') {
      const vh = renderer.getListScrollTop?.(id)?.[2] ?? 600
      off = -Math.max(0, vh / 2 - ROW_H)
    }
    renderer.scrollToItem?.(id, pos - next.start, off)
  }, [renderer])

  /** Scroll so `line` (or the next visible line) sits mid-viewport. */
  const reveal = useCallback((line: number) => showPos(ctl.view.posOf(line), 'center'), [showPos])

  const followTail = useCallback(() => {
    setFollowing(true)
    const id = listId()
    if (id != null) renderer.scrollToItem?.(id, Math.max(0, Math.min(ctl.view.count, PAGE) - 1))
  }, [renderer])

  /** Run a view-changing action while keeping the reader's place. */
  const keepPlace = (fn: () => void) => {
    const anchor = following ? -1 : selected >= 0 ? selected : ctl.view.count ? ctl.view.lineAt(Math.min(range.current[0], ctl.view.count - 1)) : -1
    fn()
    ctl.flushNow()
    if (anchor >= 0) reveal(anchor)
    else if (following) followTail()
  }

  const onPick = useCallback((line: number) => {
    setSelected((cur) => (cur === line ? -1 : line))
  }, [])

  const onVisibleRange = useCallback((e: EventPayload) => {
    const pg = pageRef.current
    const si = Math.floor(e.startIndex ?? 0)
    const ei = Math.floor(e.endIndex ?? 0)
    range.current = [pg.start + si, pg.start + ei]
    setVisibleRange([pg.start + si, pg.start + ei])
    setStart((cur) => (si < cur + 6 || ei > cur + WINDOW - 6 ? Math.max(0, si - LEAD) : cur))
    // Reader is near an edge of the page and there is more beyond it: re-page around them.
    if (!followingRef.current) {
      const total = ctl.view.count
      const nearTop = si < MARGIN && pg.start > 0
      const nearEnd = ei > pg.len - MARGIN && pg.start + pg.len < total
      if (nearTop || nearEnd) {
        const top = renderer.getListScrollTop?.(listRef.current?.id ?? -1)
        showPos(pg.start + (top?.[0] ?? si), top?.[1] != null ? -top[1] : 0)
      }
    }
  }, [renderer, showPos])

  // Wheel up while tailing pauses follow; reaching the end while scrolling down resumes it.
  const onWheel = (e: EventPayload) => {
    const dy = e.deltaY ?? 0
    if (dy > 0) {
      wheelUp.current = true
      if (following) {
        const pg = pageRef.current
        setFrozen(pg)
        setStart(Math.max(0, pg.len - WINDOW))
        setFollowing(false)
      }
    } else if (dy < 0) {
      wheelUp.current = false
      if (!following && range.current[1] >= ctl.view.count - 1) setFollowing(true)
    }
  }

  const go = (dir: 1 | -1) => {
    const from = active >= 0 ? active : selected >= 0 ? selected : following ? (dir > 0 ? -1 : ctl.store.count) : ctl.view.lineAt(Math.min(range.current[0], Math.max(0, ctl.view.count - 1))) - (dir > 0 ? 1 : 0)
    const line = ctl.findMatch(from, dir)
    if (line < 0) return
    setActive(line)
    reveal(line)
  }

  const jumpTo = (text: string) => {
    const ms = parseClock(text)
    if (ms == null) return setJumpError(true)
    setJumpError(false)
    const line = ctl.lineAtClock(ms)
    if (line < 0) return
    setSelected(line)
    reveal(line)
  }

  const copy = (text: string) => {
    copyToClipboard(text)
    setToast(`Copied ${fmt(text.length)} characters`)
  }

  const loadFile = async () => {
    const paths = await renderer.promptForPaths?.({ files: true, prompt: 'Open log' })
    if (!paths || !paths[0]) return
    setSelected(-1)
    setActive(-1)
    setFollowing(true)
    await ctl.loadFile(paths[0])
  }

  windowHandlers.onKeyDown = (e: KeyEvent) => {
    const k = e.key
    const m = e.modifiers
    const searchFocused = searchRef.current != null && renderer.getFocusedElementId?.() === searchRef.current.id
    if (m?.cmd && k === 'f') {
      if (searchRef.current) renderer.focusElement?.(searchRef.current.id)
    } else if (m?.cmd && k === 'g') {
      go(m.shift ? -1 : 1)
    } else if (m?.cmd && k === 'c' && !renderer.getSelectedText?.() && selected >= 0) {
      copy(ctl.store.line(selected))
    } else if (k === 'escape') {
      if (renderer.getSelectedText?.()) renderer.clearSelection?.()
      else if (searchFocused) renderer.blur?.()
      else setSelected(-1)
    } else if (!searchFocused && (k === 'down' || k === 'up') && selected >= 0) {
      const pos = ctl.view.posOf(selected) + (k === 'down' ? 1 : -1)
      if (pos >= 0 && pos < ctl.view.count) {
        const line = ctl.view.lineAt(pos)
        setSelected(line)
        reveal(line)
      }
    } else if (!searchFocused && k === 'end') {
      followTail()
    }
  }
  windowHandlers.onSelectionChange = (e: EventPayload) => setSelectionLen(e.value?.length ?? 0)

  const store = ctl.store
  const job = ctl.job
  const matches = view.matchesInView
  const rank = active >= 0 ? ctl.matchRank(active) : -1
  const services = ctl.serviceOrder()
  const newBelow = following ? 0 : Math.max(0, count - range.current[1])
  const visTimes: [number, number] | null =
    count > 0 && visibleRange[1] > visibleRange[0]
      ? [Math.floor(store.ts[view.lineAt(Math.min(visibleRange[0], count - 1))]! / 1000), Math.floor(store.ts[view.lineAt(Math.min(visibleRange[1] - 1, count - 1))]! / 1000)]
      : null
  const live = ctl.source.kind === 'live'
  const sourceLabel = ctl.source.kind === 'file' ? `${ctl.source.name} · ${(ctl.source.bytes / 1e6).toFixed(0)} MB` : 'Live generator · 10 services'

  return (
    <div
      onFileDrop={(e: EventPayload) => {
        const p = e.paths?.[0]
        if (p) void ctl.loadFile(p)
      }}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: C.bg }}
    >
      {/* Title bar */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 52, paddingLeft: 88, paddingRight: 16, gap: 12, backgroundColor: C.panel, borderBottomWidth: 1, borderColor: C.border, userSelect: 'none' }}>
        <text style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Firehose</text>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 22, paddingLeft: 8, paddingRight: 9, borderRadius: 11, backgroundColor: C.raised }}>
          <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: live ? (ctl.running ? C.green : C.textMuted) : C.accent }} />
          <text testId="source" style={{ fontSize: 12, color: C.textDim }}>{ctl.loading ? `Loading ${ctl.loading.name} · ${Math.round(ctl.loading.progress * 100)}%` : sourceLabel}</text>
        </div>
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 12, color: C.textMuted }}>Rate</text>
        <Segmented testIdPrefix="rate" options={RATES} value={ctl.rate as (typeof RATES)[number]} onChange={(r) => { ctl.setRate(r); ctl.flushNow() }} label={(r) => `${r >= 1000 ? `${r / 1000}k` : r}/s`} />
        <div
          testId="play"
          onClick={() => { ctl.setRunning(!(ctl.running && live)); if (!live) { setSelected(-1); setFollowing(true) } ctl.flushNow() }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 92, height: 28, borderRadius: 7, cursor: 'pointer', backgroundColor: ctl.running && live ? C.raised : C.accent, borderWidth: 1, borderColor: ctl.running && live ? C.borderStrong : C.accent, hover: { backgroundColor: ctl.running && live ? C.raisedHover : '#5299ff' } }}
        >
          <text style={{ fontSize: 12.5, fontWeight: 600, color: '#ffffff' }}>{ctl.running && live ? 'Pause' : live ? 'Resume' : 'Go live'}</text>
        </div>
        <SmallButton testId="load-file" label="Load file…" onClick={() => void loadFile()} />
      </div>

      {/* Counters */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 28, paddingLeft: 20, paddingRight: 20, paddingTop: 12, paddingBottom: 8, backgroundColor: C.panel, userSelect: 'none' }}>
        <Stat testId="stat-total" label="TOTAL LINES" value={fmt(store.count)} />
        <Stat testId="stat-rate" label="INGEST" value={fmtCompact(live ? ctl.ingestRate : 0)} sub="lines/s" color={ctl.running && live ? C.green : C.text} />
        <Stat testId="stat-view" label="IN VIEW" value={fmt(count)} sub={count === store.count ? 'all' : `${((count / Math.max(1, store.count)) * 100).toFixed(1)}%`} />
        <Stat testId="stat-matches" label="MATCHES" value={job ? fmt(matches) : '—'} sub={job ? (job.done ? 'lines' : `scanning ${Math.floor(job.progress * 100)}%`) : undefined} />
        <Stat testId="stat-frame" label="FRAME" value={perf.cur ? perf.cur.toFixed(1) : '—'} sub={perf.p90 ? `ms · p90 ${perf.p90.toFixed(1)}` : 'ms'} />
        <Stat label="MEMORY" value={fmt(perf.rss / 1e6)} sub="MB" />
        <div style={{ flexGrow: 1 }} />
        <SmallButton testId="overlay" label="Frame overlay" active={renderer.getDebugFrameOverlay?.() !== 'hidden'} onClick={() => { renderer.cycleDebugFrameOverlay?.(); ctl.flushNow() }} />
      </div>

      <Histogram ctl={ctl} tick={Math.floor(version / 12)} visible={visTimes} onJumpSecond={(sec) => { const line = ctl.lineAtSecond(sec); if (line >= 0) { setSelected(line); reveal(line) } }} />

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: 10, paddingTop: 14, backgroundColor: C.sidebar, borderRightWidth: 1, borderColor: C.border, userSelect: 'none', overflowY: 'scroll' }}>
          <text style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, paddingLeft: 10, paddingBottom: 4 }}>LEVELS</text>
          {LEVELS.map((name, i) => (
            <SidebarRow key={name} testId={`level-${name}`} label={name[0] + name.slice(1).toLowerCase()} count={store.levelCounts[i]!} color={LEVEL_COLOR[i]!} on={((view.levelMask >> i) & 1) === 1} onClick={(e) => keepPlace(() => ctl.toggleLevel(i, !!e.modifiers?.alt))} />
          ))}
          <text style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, paddingLeft: 10, paddingTop: 14, paddingBottom: 4 }}>SERVICES</text>
          {services.map((id) => (
            <SidebarRow key={id} testId={`service-${store.services[id]}`} label={store.services[id]!} count={store.serviceCounts[id] ?? 0} color={serviceColor(id)} on={view.serviceOff[id] === 0} onClick={(e) => keepPlace(() => ctl.toggleService(id, !!e.modifiers?.alt))} />
          ))}
          <div style={{ height: 10 }} />
          <SmallButton testId="reset-filters" label="Reset filters" onClick={() => keepPlace(() => ctl.resetFilters())} />
          <text style={{ fontSize: 11, color: C.textMuted, paddingLeft: 4, paddingTop: 8, lineHeight: 15 }}>⌥-click to solo</text>
        </div>

        {/* Main */}
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingLeft: 12, paddingRight: 12, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.bg }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, flexGrow: 1, minWidth: 0, paddingLeft: 10, paddingRight: 4, borderRadius: 8, backgroundColor: C.raised, borderWidth: 1, borderColor: ctl.searchError ? '#f0564f88' : C.border }}>
              <text style={{ fontSize: 13, color: C.textMuted }}>⌕</text>
              <input
                ref={searchRef}
                testId="search"
                value={query}
                placeholder={regex ? 'Regex search  (⌘F)' : 'Search logs  (⌘F)'}
                onChange={(e: EventPayload) => setQuery(e.value ?? '')}
                onSubmit={() => go(1)}
                theme={{ caret: C.accent }}
                style={{ flexGrow: 1, minWidth: 0, fontSize: 13, fontFamily: MONO, color: C.text, paddingLeft: 4 }}
              />
              <text testId="match-count" style={{ fontSize: 12, color: ctl.searchError ? '#f0564f' : C.textDim, fontFamily: MONO }}>
                {ctl.searchError ? ctl.searchError.slice(0, 40) : job ? `${rank >= 0 ? `${fmt(rank + 1)} of ` : ''}${fmt(matches)}${job.done ? '' : '…'}` : ''}
              </text>
              <Toggle testId="toggle-case" label="Aa" title="Match case" on={caseSensitive} onClick={() => setCaseSensitive(!caseSensitive)} />
              <Toggle testId="toggle-regex" label=".*" title="Regular expression" on={regex} onClick={() => setRegex(!regex)} />
              <Toggle testId="prev-match" label="↑" on={false} onClick={() => go(-1)} />
              <Toggle testId="next-match" label="↓" on={false} onClick={() => go(1)} />
            </div>
            <Toggle testId="only-matches" label="Only matches" on={view.onlyMatches} onClick={() => keepPlace(() => ctl.setOnlyMatches(!view.onlyMatches))} />
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, width: 170, paddingLeft: 10, paddingRight: 8, borderRadius: 8, backgroundColor: C.raised, borderWidth: 1, borderColor: jumpError ? '#f0564f88' : C.border }}>
              <text style={{ fontSize: 12, color: C.textMuted }}>Jump to</text>
              <input testId="jump" value={jump} placeholder="14:02:30" onChange={(e: EventPayload) => { setJump(e.value ?? ''); setJumpError(false) }} onSubmit={(e: EventPayload) => jumpTo(e.value ?? jump)} theme={{ caret: C.accent }} style={{ flexGrow: 1, minWidth: 0, fontSize: 13, fontFamily: MONO, color: C.text }} />
            </div>
          </div>

          <div testId="log-list" onScroll={onWheel} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, position: 'relative' }}>
            <LogList ctl={ctl} pageStart={page.start} count={page.len} start={windowStart} following={following} selected={selected} active={active} re={ctl.regex} gen={ctl.viewGeneration * 0 + (ctl.source.kind === 'file' ? 1 : 0)} listRef={listRef} onPick={onPick} onVisibleRange={onVisibleRange} />
            {count === 0 && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <text style={{ fontSize: 13, color: C.textMuted }}>{store.count === 0 ? 'Press Resume to start the stream, or load a file' : 'No lines match the current filters'}</text>
              </div>
            )}
            {newBelow > 0 && (
              <div testId="jump-latest" onClick={followTail} style={{ position: 'absolute', bottom: 14, right: 22, display: 'flex', alignItems: 'center', height: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 15, backgroundColor: C.accent, cursor: 'pointer', boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 16, spreadRadius: 0, color: '#00000080' }, hover: { backgroundColor: '#5299ff' } }}>
                <text style={{ fontSize: 12, fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap' }}>{`${fmt(newBelow)} newer lines ↓`}</text>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, height: 28, paddingLeft: 14, paddingRight: 14, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.panel, userSelect: 'none' }}>
            <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: following ? C.green : C.textMuted }} />
            <text testId="follow-state" style={{ fontSize: 11.5, color: C.textDim }}>
              {following ? 'Following tail' : `Rows ${fmt(visibleRange[0] + 1)}–${fmt(Math.min(count, visibleRange[1]))} of ${fmt(count)}`}
            </text>
            {!following && (
              <div testId="follow" onClick={followTail} style={{ cursor: 'pointer' }}>
                <text style={{ fontSize: 11.5, color: C.accent }}>Follow (End)</text>
              </div>
            )}
            <div style={{ flexGrow: 1 }} />
            {selectionLen > 0 && <text style={{ fontSize: 11.5, color: C.textDim }}>{fmt(selectionLen)} chars selected · ⌘C to copy</text>}
            {toast && <text testId="toast" style={{ fontSize: 11.5, color: C.green }}>{toast}</text>}
            <div style={{ flexShrink: 0 }}>
              <text style={{ fontSize: 11.5, color: C.textMuted, fontFamily: MONO, whiteSpace: 'nowrap' }}>{`${fmt(ctl.store.textBytes / 1e6)} MB text · ${ctl.store.chunks.length} chunks`}</text>
            </div>
          </div>
        </div>

        {selected >= 0 && selected < store.count && (
          <Inspector
            ctl={ctl}
            line={selected}
            onClose={() => setSelected(-1)}
            onCopy={copy}
            onFilterRequest={(req) => {
              setRegex(false)
              setQuery(`req=${req}`)
              ctl.setSearch({ query: `req=${req}`, regex: false, caseSensitive })
              keepPlace(() => ctl.setOnlyMatches(true))
            }}
          />
        )}
      </div>
    </div>
  )
}
