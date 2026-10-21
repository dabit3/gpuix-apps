import { useGpuixRequired, type EventPayload, type ImgInstance, type PublicInstance } from '@gpuix/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { runBacktest, STRATEGIES, sweepSma, walkForward, type BacktestResult, type Sweep } from './backtest'
import {
  drawEquity,
  drawMain,
  drawOsc,
  FIB_LEVELS,
  fmtCompact,
  fmtPrice,
  fmtTime,
  indexOfTime,
  iOf,
  mainFrame,
  niceTicks,
  oscFrame,
  pOf,
  T,
  timeOfIndex,
  timeTicks,
  xOf,
  yOf,
  type Frame,
  type MainSpec,
  type OscSpec,
  type View,
} from './chart'
import { loadBars, loadTickers, streamKlines, type Loaded } from './data/feed'
import { findIndicator, INDICATORS, type Series } from './indicators'
import { Canvas } from './raster'
import { loadState, saveState, type Drawing, type DrawingKind, type State } from './store'
import { TIMEFRAMES, type Bar, type Timeframe } from './types'

const MONO = 'Menlo'
const NO_DRAWINGS: Drawing[] = []
const AXIS_W = 84
const TIME_H = 24
const DIVIDER = 6
const SIDEBAR_W = 340
const FEE_BPS = 10
const SLIP_BPS = 5
const CAPITAL = 10_000

const CHART_TYPES: { id: State['chart']; label: string }[] = [
  { id: 'candles', label: 'Candles' },
  { id: 'heikin', label: 'Heikin-Ashi' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
]
const TOOLS: { id: DrawingKind; label: string; key: string }[] = [
  { id: 'trend', label: 'Trend', key: 't' },
  { id: 'hline', label: 'Level', key: 'h' },
  { id: 'rect', label: 'Box', key: 'g' },
  { id: 'fib', label: 'Fib', key: 'f' },
]
const IND_KEYS: Record<string, string> = { e: 'ema', s: 'sma', b: 'bb', v: 'vwap', u: 'st', d: 'donchian', r: 'rsi', m: 'macd', k: 'stoch', a: 'atr', o: 'obv' }
const IND_ORDER = ['ema', 'sma', 'bb', 'vwap', 'st', 'donchian', 'rsi', 'macd', 'stoch', 'atr', 'obv']

export type AppProps = {
  symbol: string
  timeframe: Timeframe
  bars?: number
  offline?: boolean
  strategy?: string
  /** Inject data (tests). Skips the network and the live stream. */
  preload?: Loaded
  onQuit?: () => void
}

type Hover = { pane: string; x: number; y: number } | null

/** Letters can arrive as key "space" with the real character in keyChar in terminal mode. */
function keyOf(e: EventPayload) {
  const ch = e.keyChar ?? ''
  const k = (e.key ?? '').toLowerCase()
  if (ch.length === 1 && ch !== ' ' && (k.length === 1 || k === 'space')) return ch
  return k
}

const pct = (v: number, d = 2) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`

function clampView(v: View, n: number): View {
  let w = Math.min(Math.max(12, v.end - v.start), Math.max(40, n * 1.15 + 20))
  let end = v.end
  end = Math.min(end, n + w * 0.6)
  end = Math.max(end, Math.min(n, w * 0.4))
  w = Math.max(12, w)
  return { start: end - w, end }
}

export function App(props: AppProps) {
  const renderer = useGpuixRequired()
  const rootRef = useRef<PublicInstance>(null)
  const [sym, setSym] = useState(props.symbol)
  const [tf, setTf] = useState<Timeframe>(props.timeframe)
  const [data, setData] = useState<Loaded | null>(props.preload ?? null)
  const [loading, setLoading] = useState(!props.preload)
  const [st, setSt] = useState<State>(() => {
    const s = loadState()
    if (props.strategy && STRATEGIES.some((x) => x.id === props.strategy)) s.strategy = props.strategy
    return s
  })
  const [view, setView] = useState<View>({ start: 0, end: 100 })
  const [size, setSize] = useState({ w: 1400, h: 860 })
  const [colBox, setColBox] = useState({ x: 0, y: 0, w: 1000, h: 700 })
  const [hover, setHover] = useState<Hover>(null)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [tool, setTool] = useState<DrawingKind | null>(null)
  const [pending, setPending] = useState<Drawing | null>(null)
  const [hlTrade, setHlTrade] = useState<number | null>(null)
  const [sweepOpen, setSweepOpen] = useState(false)
  const [panel, setPanel] = useState<boolean | null>(null)
  const [help, setHelp] = useState(false)
  const [params, setParams] = useState<Record<string, Record<string, number>>>({})
  const [tickers, setTickers] = useState<Record<string, { last: number; change: number }>>({})
  const drawMs = useRef(0)
  const drag = useRef<{ kind: 'zoom' | 'pan' | 'draw' | 'split'; x: number; y: number; view: View; pane?: string; size?: number } | null>(null)
  const followRef = useRef(true)

  const bars: Bar[] = data?.bars ?? []
  const n = bars.length
  const stRef = useRef(st)
  stRef.current = st
  const update = (fn: (s: State) => State) =>
    setSt((s) => {
      const next = fn(s)
      saveState(next)
      return next
    })

  const focusRoot = () => rootRef.current && renderer.focusElement?.(rootRef.current.id)
  useEffect(() => {
    const f = setTimeout(focusRoot, 0)
    const t = setInterval(() => {
      if (renderer.getFocusedElementId?.() == null) focusRoot()
    }, 300)
    return () => {
      clearTimeout(f)
      clearInterval(t)
    }
  }, [renderer])

  // Load history for the symbol/timeframe, then stream the forming candle.
  useEffect(() => {
    if (props.preload && sym === props.symbol && tf === props.timeframe) return
    let alive = true
    setLoading(true)
    loadBars(sym, tf, props.bars ?? 3000, { offline: props.offline }).then((d) => {
      if (!alive) return
      setData(d)
      setLoading(false)
      setHlTrade(null)
      followRef.current = true
    })
    return () => {
      alive = false
    }
  }, [sym, tf])

  useEffect(() => {
    if (props.preload || !data || data.source === 'sample') return
    return streamKlines(sym, tf, (b) => {
      setData((d) => {
        if (!d || !d.bars.length) return d
        const last = d.bars[d.bars.length - 1]!
        if (b.t < last.t) return d
        const next = b.t === last.t ? [...d.bars.slice(0, -1), b] : [...d.bars, b]
        return { ...d, bars: next }
      })
    })
  }, [data?.source, sym, tf])

  useEffect(() => {
    if (props.preload) return
    let alive = true
    const tick = () =>
      loadTickers(stRef.current.watchlist)
        .then((t) => alive && setTickers(t))
        .catch(() => {})
    tick()
    const id = setInterval(tick, 15000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  // Reset the view when a new series loads; follow the right edge as live bars arrive.
  const loadedKey = `${sym}:${tf}:${data?.source}:${data?.bars[0]?.t}`
  const prevN = useRef(0)
  const chartW = Math.max(100, colBox.w - AXIS_W)
  const resetView = () => {
    const visible = Math.min(n, Math.round(chartW / 7.5))
    setView(clampView({ start: n + 6 - visible, end: n + 6 }, n))
    followRef.current = true
  }
  useLayoutEffect(() => {
    if (!n) return
    resetView()
    prevN.current = n
  }, [loadedKey])
  // Follow-the-latest views keep their bar width when the pane is resized (e.g. a Ghostty split).
  useLayoutEffect(() => {
    if (n && followRef.current) resetView()
  }, [chartW])
  useLayoutEffect(() => {
    if (n > prevN.current && prevN.current > 0) {
      const d = n - prevN.current
      setView((v) => (v.end >= prevN.current - 1 ? { start: v.start + d, end: v.end + d } : v))
    }
    prevN.current = n
  }, [n])

  // Indicators.
  const enabled = st.indicators.filter((id) => findIndicator(id))
  const overlayDefs = enabled.map((id) => findIndicator(id)!).filter((d) => d.pane === 'overlay')
  const ownDefs = enabled.map((id) => findIndicator(id)!).filter((d) => d.pane === 'own')
  const overlays = useMemo<Series[]>(() => overlayDefs.flatMap((d) => d.fn(bars, d.params)), [bars, overlayDefs.map((d) => d.id).join()])
  const own = useMemo(() => ownDefs.map((d) => ({ def: d, series: d.fn(bars, d.params) })), [bars, ownDefs.map((d) => d.id).join()])

  // Backtest.
  const strategy = STRATEGIES.find((s) => s.id === st.strategy) ?? STRATEGIES[0]!
  const sp = params[strategy.id] ?? strategy.params
  const closedBars = useMemo(() => (n > 1 && data?.source !== 'sample' && !props.preload ? bars.slice(0, -1) : bars), [bars])
  const btKey = `${loadedKey}:${closedBars.length}:${strategy.id}:${JSON.stringify(sp)}`
  const bt = useMemo<BacktestResult | null>(() => (closedBars.length > 60 ? runBacktest(closedBars, strategy, sp, { feeBps: FEE_BPS, slippageBps: SLIP_BPS, capital: CAPITAL }) : null), [btKey])
  const sweep = useMemo<{ sw: Sweep; wf: ReturnType<typeof walkForward> } | null>(
    () => (sweepOpen && closedBars.length > 300 ? { sw: sweepSma(closedBars, { feeBps: FEE_BPS, slippageBps: SLIP_BPS }), wf: walkForward(closedBars, 4, { feeBps: FEE_BPS, slippageBps: SLIP_BPS }) } : null),
    [sweepOpen, loadedKey, closedBars.length > 300],
  )

  // Layout.
  const wide = size.w >= 1000
  const showPanel = panel ?? wide
  const compact = size.w < 760
  const chartH = Math.max(120, colBox.h - TIME_H)
  const oscHeights = own.map(({ def }) => st.paneSizes[def.id] ?? Math.round(Math.min(130, Math.max(70, chartH * 0.17))))
  let oscTotal = oscHeights.reduce((a, b) => a + b + DIVIDER, 0)
  if (chartH - oscTotal < chartH * 0.42) {
    const k = (chartH * 0.58) / Math.max(1, oscTotal)
    for (let i = 0; i < oscHeights.length; i++) oscHeights[i] = Math.max(40, Math.floor(oscHeights[i]! * k) - 1)
    oscTotal = oscHeights.reduce((a, b) => a + b + DIVIDER, 0)
  }
  const mainH = Math.max(80, chartH - oscTotal)

  const drawings = st.drawings[sym] ?? NO_DRAWINGS
  const mainSpec = useMemo<MainSpec>(
    () => ({ bars, view, log: st.log, chart: st.chart, overlays, drawings, pending, backtest: bt, highlightTrade: hlTrade }),
    [bars, view, st.log, st.chart, overlays, drawings, pending, bt, hlTrade],
  )
  const mf = mainFrame(mainSpec, chartW, mainH)
  const priceTicks = niceTicks(mf.yMin, mf.yMax, Math.max(3, Math.round(mainH / 64)))
  const xTicks = timeTicks(bars, mf, compact ? 80 : 110)

  const hoverIdx = hover && n ? Math.max(0, Math.min(n - 1, Math.round(iOf(mf, hover.x)))) : null
  const legendIdx = hoverIdx ?? n - 1
  const legendBar = bars[legendIdx]

  const zoomAt = (factor: number, frac: number) =>
    setView((v) => {
      const w = v.end - v.start
      const nw = w * factor
      const anchor = v.start + w * frac
      followRef.current = false
      return clampView({ start: anchor - nw * frac, end: anchor + nw * (1 - frac) }, n)
    })
  const pan = (d: number) => setView((v) => clampView({ start: v.start + d, end: v.end + d }, n))
  const zoomTo = (x0: number, x1: number) => {
    const a = iOf(mf, Math.min(x0, x1))
    const b = iOf(mf, Math.max(x0, x1))
    if (b - a < 6) return
    setView(clampView({ start: a, end: b + 1 }, n))
  }

  const toggleIndicator = (id: string) => update((s) => ({ ...s, indicators: s.indicators.includes(id) ? s.indicators.filter((x) => x !== id) : [...s.indicators, id] }))
  const setStrategy = (id: string) => {
    setHlTrade(null)
    update((s) => ({ ...s, strategy: id }))
  }
  const deleteLast = () => update((s) => ({ ...s, drawings: { ...s.drawings, [sym]: (s.drawings[sym] ?? []).slice(0, -1) } }))
  const commitDrawing = (d: Drawing) => update((s) => ({ ...s, drawings: { ...s.drawings, [sym]: [...(s.drawings[sym] ?? []), d] } }))
  const jumpToTrade = (k: number) => {
    if (!bt) return
    const tr = bt.trades[k]
    if (!tr) return
    setHlTrade(k)
    const span = Math.max(40, (tr.exitIndex - tr.entryIndex) * 3)
    const mid = (tr.entryIndex + tr.exitIndex) / 2
    followRef.current = false
    setView(clampView({ start: mid - span / 2, end: mid + span / 2 }, n))
  }
  const cycleSymbol = (d: number) => {
    const wl = st.watchlist
    const i = wl.indexOf(sym)
    setSym(wl[(i + d + wl.length) % wl.length]!)
  }

  /** Snap to the nearest OHLC value of the bar under the cursor when within 8 px. */
  const pointAt = (x: number, y: number) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(iOf(mf, x))))
    let p = pOf(mf, y)
    const b = bars[i]
    if (b) {
      let best = 8
      for (const v of [b.o, b.h, b.l, b.c]) {
        const d = Math.abs(yOf(mf, v) - y)
        if (d < best) {
          best = d
          p = v
        }
      }
    }
    return { t: timeOfIndex(bars, Math.round(iOf(mf, x))), p }
  }

  const onKey = (e: EventPayload) => {
    if (e.modifiers?.cmd) return
    const k = keyOf(e)
    if (e.modifiers?.ctrl) {
      if (k === 'q') props.onQuit?.()
      return
    }
    if (help && k !== '?') setHelp(false)
    if (/^[1-7]$/.test(k)) setTf(TIMEFRAMES[Number(k) - 1]!)
    else if (IND_KEYS[k]) toggleIndicator(IND_KEYS[k]!)
    else if (k === 'c') update((s) => ({ ...s, chart: CHART_TYPES[(CHART_TYPES.findIndex((c) => c.id === s.chart) + 1) % CHART_TYPES.length]!.id }))
    else if (k === 'l') update((s) => ({ ...s, log: !s.log }))
    else if (TOOLS.some((t) => t.key === k)) {
      const t = TOOLS.find((t) => t.key === k)!.id
      setTool((cur) => (cur === t ? null : t))
    } else if (k === 'escape') {
      if (tool || pending) {
        setTool(null)
        setPending(null)
      } else if (sweepOpen) setSweepOpen(false)
      else if (hlTrade != null) setHlTrade(null)
      else resetView()
    } else if (k === 'backspace' || k === 'delete' || k === 'x') deleteLast()
    else if (k === 'n') setStrategy(STRATEGIES[(STRATEGIES.indexOf(strategy) + 1) % STRATEGIES.length]!.id)
    else if (k === 'w') setSweepOpen((o) => !o)
    else if (k === 'p') setPanel(!showPanel)
    else if (k === '[') cycleSymbol(-1)
    else if (k === ']') cycleSymbol(1)
    else if (k === '.' || k === '>') jumpToTrade(hlTrade == null ? (bt?.trades.length ?? 1) - 1 : Math.min((bt?.trades.length ?? 1) - 1, hlTrade + 1))
    else if (k === ',' || k === '<') jumpToTrade(hlTrade == null ? (bt?.trades.length ?? 1) - 1 : Math.max(0, hlTrade - 1))
    else if (k === 'left') pan(-(view.end - view.start) * 0.15)
    else if (k === 'right') pan((view.end - view.start) * 0.15)
    else if (k === 'up' || k === '+' || k === '=') zoomAt(0.75, 0.85)
    else if (k === 'down' || k === '-') zoomAt(1 / 0.75, 0.85)
    else if (k === '0') resetView()
    else if (k === '?') setHelp((h) => !h)
    else if (k === 'q') props.onQuit?.()
  }

  // Shared chart mouse handling for every pane (x is shared, y belongs to the pane).
  const paneHandlers = (pane: string, box: { x: number; y: number }, isMain: boolean) => {
    const local = (e: EventPayload) => ({ x: (e.x ?? 0) - box.x, y: (e.y ?? 0) - box.y })
    return {
      onMouseDown: (e: EventPayload) => {
        focusRoot()
        const p = local(e)
        if ((e.clickCount ?? 1) >= 2 && !tool) {
          drag.current = null
          resetView()
          return
        }
        if (isMain && tool && e.button !== 2) {
          const a = pointAt(p.x, p.y)
          if (tool === 'hline') {
            commitDrawing({ id: `${Date.now()}`, kind: 'hline', a, b: a })
            setTool(null)
            return
          }
          drag.current = { kind: 'draw', x: p.x, y: p.y, view }
          setPending({ id: `${Date.now()}`, kind: tool, a, b: a })
          return
        }
        const panMode = e.modifiers?.shift || e.modifiers?.alt || e.button === 2
        drag.current = { kind: panMode ? 'pan' : 'zoom', x: p.x, y: p.y, view }
      },
      onMouseMove: (e: EventPayload) => {
        const p = local(e)
        setHover({ pane, x: p.x, y: p.y })
        const d = drag.current
        if (!d) return
        if (d.kind === 'draw') setPending((pd) => (pd ? { ...pd, b: pointAt(p.x, p.y) } : pd))
        else if (d.kind === 'pan') {
          const bpp = (d.view.end - d.view.start) / chartW
          followRef.current = false
          setView(clampView({ start: d.view.start - (p.x - d.x) * bpp, end: d.view.end - (p.x - d.x) * bpp }, n))
        } else if (d.kind === 'zoom' && Math.abs(p.x - d.x) > 3) setSel({ a: d.x, b: Math.max(0, Math.min(chartW, p.x)) })
      },
      onMouseUp: (e: EventPayload) => {
        const d = drag.current
        drag.current = null
        if (!d) return
        const p = local(e)
        if (d.kind === 'draw') {
          setPending((pd) => {
            if (pd) {
              const b = pointAt(p.x, p.y)
              if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 6) commitDrawing({ ...pd, b })
            }
            return null
          })
          setTool(null)
        } else if (d.kind === 'zoom') {
          setSel(null)
          if (Math.abs(p.x - d.x) > 6) {
            followRef.current = false
            zoomTo(d.x, Math.max(0, Math.min(chartW, p.x)))
          }
        }
      },
      onMouseLeave: () => setHover((h) => (h?.pane === pane ? null : h)),
      onScroll: (e: EventPayload) => {
        const dx = e.deltaX ?? 0
        const dy = e.deltaY ?? 0
        const p = local(e)
        if (e.modifiers?.ctrl || e.modifiers?.alt || e.modifiers?.cmd) {
          zoomAt(Math.exp(dy * (e.precise ? 0.004 : 0.04)), Math.max(0, Math.min(1, p.x / chartW)))
          return
        }
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy
        if (!delta) return
        followRef.current = false
        const bpp = (view.end - view.start) / chartW
        pan(-delta * bpp * (e.precise ? 1 : 24))
      },
    }
  }

  const srcBadge =
    data?.source === 'binance'
      ? { text: 'LIVE  Binance', color: T.green }
      : data?.source === 'coinbase'
        ? { text: 'Coinbase', color: T.green }
        : data?.source === 'cache'
          ? { text: 'CACHED', color: T.yellow }
          : data
            ? { text: 'SAMPLE DATA', color: T.yellow }
            : { text: 'loading', color: T.faint }

  const last = bars[n - 1]
  const dayAgo = last ? bars[Math.max(0, Math.round(indexOfTime(bars, last.t - 86400)))] : undefined
  const dayChange = last && dayAgo ? last.c / dayAgo.c - 1 : 0

  return (
    <div
      ref={rootRef}
      testId="root"
      tabIndex={0}
      autoFocus
      onKeyDown={onKey}
      onLayout={(e) => {
        const w = Math.round(e.width ?? 0)
        const h = Math.round(e.height ?? 0)
        if (w && h && (w !== size.w || h !== size.h)) setSize({ w, h })
      }}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: T.bg }}
    >
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 44, paddingLeft: 16, paddingRight: 12, gap: 14, flexShrink: 0, borderBottomWidth: 1, borderColor: T.border }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 10, flexShrink: 0 }}>
          <text testId="symbol" style={{ color: T.fg, fontSize: 17, fontWeight: 'bold' }}>
            {sym}
          </text>
          <text testId="tf" style={{ color: T.dim, fontSize: 13, fontFamily: MONO }}>
            {tf}
          </text>
          <text testId="last" style={{ color: dayChange >= 0 ? T.green : T.red, fontSize: 17, fontFamily: MONO, fontWeight: 'bold' }}>
            {last ? fmtPrice(last.c) : '—'}
          </text>
          {!compact ? <text style={{ color: dayChange >= 0 ? T.green : T.red, fontSize: 13, fontFamily: MONO }}>{`${pct(dayChange)} 24h`}</text> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 8, height: 22, borderRadius: 11, backgroundColor: T.raised, flexShrink: 0 }}>
          <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: srcBadge.color }} />
          <text testId="source" style={{ color: srcBadge.color, fontSize: 11, fontWeight: 'bold' }}>
            {srcBadge.text}
          </text>
        </div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'row', gap: 2, padding: 2, borderRadius: 7, backgroundColor: T.panel, borderWidth: 1, borderColor: T.border, flexShrink: 0 }}>
          {TIMEFRAMES.map((t) => (
            <Pill key={t} testId={`tf-${t}`} label={t} active={t === tf} onClick={() => setTf(t)} mono />
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 36, paddingLeft: 12, paddingRight: 12, gap: 10, flexShrink: 0, borderBottomWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
        <Group>
          {CHART_TYPES.filter((c) => !compact || c.id !== 'area').map((c) => (
            <Pill key={c.id} testId={`chart-${c.id}`} label={compact && c.id === 'heikin' ? 'HA' : c.label} active={st.chart === c.id} onClick={() => update((s) => ({ ...s, chart: c.id }))} />
          ))}
          <Pill testId="log" label="Log" active={st.log} onClick={() => update((s) => ({ ...s, log: !s.log }))} />
        </Group>
        <Group>
          {IND_ORDER.map((id) => findIndicator(id))
            .filter((d) => d && (!compact || ['ema', 'bb', 'rsi', 'macd'].includes(d.id)))
            .map((d) => (
              <Pill key={d!.id} testId={`ind-${d!.id}`} label={d!.label} active={st.indicators.includes(d!.id)} onClick={() => toggleIndicator(d!.id)} />
            ))}
        </Group>
        <Group>
          {TOOLS.map((t) => (
            <Pill key={t.id} testId={`tool-${t.id}`} label={t.label} active={tool === t.id} accent={T.blue} onClick={() => setTool((c) => (c === t.id ? null : t.id))} />
          ))}
        </Group>
        <div style={{ flexGrow: 1 }} />
        {!compact ? <Pill testId="sweep" label="Sweep" active={sweepOpen} onClick={() => setSweepOpen((o) => !o)} /> : null}
        <Pill testId="panel" label="Backtest" active={showPanel} onClick={() => setPanel(!showPanel)} />
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <div
          testId="chart-col"
          style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, position: 'relative' }}
          onLayout={(e) => {
            const b = { x: e.x ?? 0, y: e.y ?? 0, w: Math.round(e.width ?? 0), h: Math.round(e.height ?? 0) }
            if (b.w && b.h && (b.w !== colBox.w || b.h !== colBox.h || b.x !== colBox.x || b.y !== colBox.y)) setColBox(b)
          }}
        >
          {/* Main pane */}
          <PaneRow
            id="main"
            w={chartW}
            h={mainH}
            box={{ x: colBox.x, y: colBox.y }}
            handlers={paneHandlers('main', { x: colBox.x, y: colBox.y }, true)}
            cursor={tool ? 'crosshair' : 'crosshair'}
            draw={(cv) => {
              const t0 = performance.now()
              drawMain(cv, mainSpec, mf, priceTicks, xTicks)
              drawMs.current = drawMs.current * 0.8 + (performance.now() - t0) * 0.2
            }}
            drawKey={[mainSpec, chartW, mainH, priceTicks.join(), xTicks.length]}
            axis={
              <>
                {priceTicks.map((p) => {
                  const y = yOf(mf, p)
                  if (y < 8 || y > mainH - 8) return null
                  return <AxisLabel key={p} y={y} text={fmtPrice(p, mf.yMax)} />
                })}
                {last ? <AxisTag y={yOf(mf, last.c)} text={fmtPrice(last.c)} color={last.c >= last.o ? T.green : T.red} testId="last-tag" /> : null}
                {drawings
                  .filter((d) => d.kind === 'hline')
                  .map((d) => (
                    <AxisTag key={d.id} y={yOf(mf, d.a.p)} text={fmtPrice(d.a.p)} color={T.yellow} />
                  ))}
                {hover?.pane === 'main' ? <AxisTag y={hover.y} text={fmtPrice(pOf(mf, hover.y))} color={T.borderHi} fg={T.fg} /> : null}
              </>
            }
          >
            {/* Legend */}
            <div style={{ position: 'absolute', left: 10, top: 6, display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
              {legendBar ? (
                <div testId="ohlc" style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  {(
                    [
                      ['O', legendBar.o],
                      ['H', legendBar.h],
                      ['L', legendBar.l],
                      ['C', legendBar.c],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
                      <text style={{ color: T.faint, fontSize: 12, fontFamily: MONO }}>{k}</text>
                      <text style={{ color: legendBar.c >= legendBar.o ? T.green : T.red, fontSize: 12, fontFamily: MONO }}>{fmtPrice(v)}</text>
                    </div>
                  ))}
                  <text style={{ color: legendBar.c >= legendBar.o ? T.green : T.red, fontSize: 12, fontFamily: MONO }}>{pct(legendBar.c / legendBar.o - 1)}</text>
                  {!compact ? <text style={{ color: T.faint, fontSize: 12, fontFamily: MONO }}>{`Vol ${fmtCompact(legendBar.v)}`}</text> : null}
                </div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
                {overlays
                  .filter((s) => s.style !== 'band-lower')
                  .map((s) => (
                    <div key={s.name} style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
                      <text style={{ color: s.color.slice(0, 7), fontSize: 11, fontFamily: MONO }}>{s.name}</text>
                      <text style={{ color: T.dim, fontSize: 11, fontFamily: MONO }}>{fmtPrice(s.values[legendIdx] ?? NaN, last?.c)}</text>
                    </div>
                  ))}
              </div>
            </div>
            {/* Fib labels */}
            {drawings
              .filter((d) => d.kind === 'fib')
              .flatMap((d) =>
                FIB_LEVELS.map((lv) => {
                  const p = d.b.p + (d.a.p - d.b.p) * lv
                  const y = yOf(mf, p)
                  const x = Math.min(xOf(mf, indexOfTime(bars, d.a.t)), xOf(mf, indexOfTime(bars, d.b.t)))
                  if (y < 0 || y > mainH) return null
                  return (
                    <text key={`${d.id}-${lv}`} style={{ position: 'absolute', left: Math.max(4, x + 4), top: y - 15, color: T.dim, fontSize: 10, fontFamily: MONO, pointerEvents: 'none' }}>
                      {`${lv.toFixed(3)}  ${fmtPrice(p)}`}
                    </text>
                  )
                }),
              )}
            {sel ? (
              <div testId="zoom-sel" style={{ position: 'absolute', top: 0, left: Math.min(sel.a, sel.b), width: Math.abs(sel.b - sel.a), height: '100%', backgroundColor: '#71b7ff1a', borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#71b7ffaa', pointerEvents: 'none' }} />
            ) : null}
            {tool ? (
              <div style={{ position: 'absolute', right: 10, top: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#71b7ff22', pointerEvents: 'none' }}>
                <text testId="tool-hint" style={{ color: T.blue, fontSize: 11 }}>{tool === 'hline' ? 'Click to place a level · Esc cancels' : 'Drag to draw · snaps to OHLC · Esc cancels'}</text>
              </div>
            ) : null}
            <Crosshair hover={hover} pane="main" f={mf} idx={hoverIdx} h={mainH} />
            {loading ? <Center text={`Loading ${sym} ${tf}…`} /> : null}
          </PaneRow>

          {own.map(({ def, series }, k) => {
            const h = oscHeights[k]!
            const top = mainH + oscHeights.slice(0, k).reduce((a, b) => a + b + DIVIDER, 0) + DIVIDER
            const spec: OscSpec = { series, view, n, range: def.range, levels: def.levels }
            const f = oscFrame(spec, chartW, h)
            const box = { x: colBox.x, y: colBox.y + top }
            return (
              <div key={def.id} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                <Divider
                  testId={`split-${def.id}`}
                  onDown={(e) => {
                    drag.current = { kind: 'split', x: e.x ?? 0, y: e.y ?? 0, view, pane: def.id, size: h }
                  }}
                  onMove={(e) => {
                    const d = drag.current
                    if (d?.kind !== 'split' || d.pane !== def.id) return
                    const next = Math.round(Math.max(44, Math.min(chartH * 0.5, d.size! - ((e.y ?? 0) - d.y))))
                    setSt((s) => ({ ...s, paneSizes: { ...s.paneSizes, [def.id]: next } }))
                  }}
                  onUp={() => {
                    drag.current = null
                    saveState(stRef.current)
                  }}
                />
                <PaneRow
                  id={def.id}
                  w={chartW}
                  h={h}
                  box={box}
                  handlers={paneHandlers(def.id, box, false)}
                  cursor="crosshair"
                  draw={(cv) => drawOsc(cv, spec, f, xTicks)}
                  drawKey={[series, view, chartW, h, xTicks.length]}
                  axis={
                    <>
                      {(def.levels ?? niceTicks(f.yMin, f.yMax, 2)).map((v) => {
                        const y = yOf(f, v)
                        if (y < 6 || y > h - 6) return null
                        return <AxisLabel key={v} y={y} text={Math.abs(v) >= 1000 ? fmtCompact(v) : v.toFixed(Math.abs(v) < 10 && !def.range ? 2 : 0)} />
                      })}
                      {hover?.pane === def.id ? <AxisTag y={hover.y} text={fmtCompact(pOf(f, hover.y))} color={T.borderHi} fg={T.fg} /> : null}
                    </>
                  }
                >
                  <div style={{ position: 'absolute', left: 10, top: 5, display: 'flex', flexDirection: 'row', gap: 10, pointerEvents: 'none' }}>
                    <text style={{ color: T.dim, fontSize: 11, fontWeight: 'bold' }}>{def.label}</text>
                    {series.map((s) => (
                      <text key={s.name} style={{ color: s.style === 'histogram' ? T.dim : s.color, fontSize: 11, fontFamily: MONO }}>
                        {`${s.name} ${fmtNum(s.values[legendIdx] ?? NaN)}`}
                      </text>
                    ))}
                  </div>
                  <Crosshair hover={hover} pane={def.id} f={f} idx={hoverIdx} h={h} />
                </PaneRow>
              </div>
            )
          })}

          {/* Time axis */}
          <div style={{ position: 'relative', height: TIME_H, flexShrink: 0, borderTopWidth: 1, borderColor: T.border }}>
            {xTicks.map((t) => (
              <text key={`${t.x}`} style={{ position: 'absolute', left: Math.max(0, t.x - 30), top: 4, width: 60, textAlign: 'center', color: t.major ? T.dim : T.faint, fontSize: 11, fontFamily: MONO }}>
                {t.label}
              </text>
            ))}
            {hoverIdx != null && bars[hoverIdx] ? (
              <div style={{ position: 'absolute', left: Math.max(0, Math.min(chartW - 136, xOf(mf, hoverIdx) - 68)), top: 2, width: 136, height: 19, borderRadius: 4, backgroundColor: T.borderHi, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <text style={{ color: T.fg, fontSize: 11, fontFamily: MONO }}>{fmtTime(bars[hoverIdx]!.t)}</text>
              </div>
            ) : null}
          </div>

          {sweepOpen ? <SweepView data={sweep} onPick={(c) => {
            setParams((p) => ({ ...p, sma: { fast: c.fast, slow: c.slow } }))
            setStrategy('sma')
            setSweepOpen(false)
          }} onClose={() => setSweepOpen(false)} /> : null}
          {help ? <Help /> : null}
        </div>

        {showPanel ? (
          <Sidebar
            sym={sym}
            watchlist={st.watchlist}
            tickers={tickers}
            current={{ sym, last: last?.c ?? NaN, change: dayChange }}
            onPick={setSym}
            bt={bt}
            bars={closedBars}
            strategyId={strategy.id}
            params={sp}
            onStrategy={setStrategy}
            hlTrade={hlTrade}
            onTrade={jumpToTrade}
            narrow={!wide}
          />
        ) : null}
      </div>

      {/* Status line */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 24, paddingLeft: 14, paddingRight: 14, gap: 16, flexShrink: 0, borderTopWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
        <text testId="status" style={{ color: T.faint, fontSize: 11, fontFamily: MONO }}>
          {`${n.toLocaleString('en-US')} bars · ${Math.max(0, Math.round(view.end - view.start))} visible · draw ${drawMs.current.toFixed(1)} ms${data?.note && data.source !== 'binance' ? ` · ${data.note.slice(0, 80)}` : ''}`}
        </text>
        <div style={{ flexGrow: 1 }} />
        {!compact ? <text style={{ color: T.faint, fontSize: 11 }}>drag zoom · scroll pan · ⌃scroll zoom · t/h/g/f draw · w sweep · , . trades · ? keys</text> : <text style={{ color: T.faint, fontSize: 11 }}>? keys</text>}
      </div>
    </div>
  )
}

function fmtNum(v: number) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  return a >= 1e4 ? fmtCompact(v) : v.toFixed(a >= 100 ? 1 : 2)
}

// ---------------------------------------------------------------------------------------------

type Handlers = {
  onMouseDown: (e: EventPayload) => void
  onMouseMove: (e: EventPayload) => void
  onMouseUp: (e: EventPayload) => void
  onMouseLeave: () => void
  onScroll: (e: EventPayload) => void
}

function PaneRow(props: { id: string; w: number; h: number; box: { x: number; y: number }; handlers: Handlers; cursor: string; draw: (cv: Canvas) => void; drawKey: unknown[]; axis: React.ReactNode; children?: React.ReactNode }) {
  const { w, h } = props
  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: h, flexShrink: 0 }}>
      <div testId={`pane-${props.id}`} style={{ position: 'relative', width: w, height: h, overflow: 'hidden', cursor: 'crosshair' }} {...props.handlers}>
        <Raster w={w} h={h} draw={props.draw} drawKey={props.drawKey} testId={`img-${props.id}`} />
        {props.children}
      </div>
      <div style={{ position: 'relative', width: AXIS_W, height: h, borderLeftWidth: 1, borderColor: T.border, overflow: 'hidden' }}>{props.axis}</div>
    </div>
  )
}

function Raster({ w, h, draw, drawKey, testId }: { w: number; h: number; draw: (cv: Canvas) => void; drawKey: unknown[]; testId: string }) {
  const img = useRef<ImgInstance>(null)
  const cv = useRef(new Canvas())
  useLayoutEffect(() => {
    cv.current.resize(w, h)
    draw(cv.current)
    img.current?.setImagePixels(cv.current.w, cv.current.h, cv.current.buf, { format: 'bgra' })
  }, drawKey)
  return <img ref={img} testId={testId} objectFit="fill" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }} />
}

function Crosshair({ hover, pane, f, idx, h }: { hover: Hover; pane: string; f: Frame; idx: number | null; h: number }) {
  if (!hover || idx == null) return null
  const x = Math.round(xOf(f, idx))
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: 0, width: 1, height: h, backgroundColor: '#9ea7b366', pointerEvents: 'none' }} />
      {hover.pane === pane ? <div testId={`cross-${pane}`} style={{ position: 'absolute', left: 0, top: Math.round(hover.y), width: f.w, height: 1, backgroundColor: '#9ea7b366', pointerEvents: 'none' }} /> : null}
    </>
  )
}

function AxisLabel({ y, text }: { y: number; text: string }) {
  return <text style={{ position: 'absolute', left: 8, top: y - 8, color: T.faint, fontSize: 11, fontFamily: MONO }}>{text}</text>
}

function AxisTag({ y, text, color, fg = T.bg, testId }: { y: number; text: string; color: string; fg?: string; testId?: string }) {
  return (
    <div testId={testId} style={{ position: 'absolute', left: 1, top: y - 10, width: AXIS_W - 2, height: 20, backgroundColor: color, display: 'flex', alignItems: 'center', paddingLeft: 7 }}>
      <text style={{ color: fg, fontSize: 11, fontFamily: MONO, fontWeight: 'bold' }}>{text}</text>
    </div>
  )
}

function Divider({ testId, onDown, onMove, onUp }: { testId: string; onDown: (e: EventPayload) => void; onMove: (e: EventPayload) => void; onUp: (e: EventPayload) => void }) {
  const [hot, setHot] = useState(false)
  return (
    <div
      testId={testId}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      style={{ height: DIVIDER, flexShrink: 0, cursor: 'row-resize', display: 'flex', alignItems: 'center', backgroundColor: T.bg }}
    >
      <div style={{ height: hot ? 2 : 1, width: '100%', backgroundColor: hot ? T.blue : T.border }} />
    </div>
  )
}

function Pill({ label, active, onClick, testId, mono, accent = T.fg }: { label: string; active: boolean; onClick: () => void; testId?: string; mono?: boolean; accent?: string }) {
  const [hot, setHot] = useState(false)
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{ display: 'flex', alignItems: 'center', height: 24, paddingLeft: 9, paddingRight: 9, borderRadius: 5, backgroundColor: active ? T.raised : hot ? '#161b2280' : 'transparent', borderWidth: 1, borderColor: active ? T.borderHi : 'transparent', cursor: 'pointer', flexShrink: 0 }}
    >
      <text style={{ color: active ? accent : hot ? T.fg : T.dim, fontSize: 12, fontFamily: mono ? MONO : undefined, fontWeight: active ? 'bold' : 'normal' }}>{label}</text>
    </div>
  )
}

function Group({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1, paddingRight: 10, borderRightWidth: 1, borderColor: T.border, flexShrink: 0 }}>{children}</div>
}

function Center({ text }: { text: string }) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <text testId="loading" style={{ color: T.dim, fontSize: 14 }}>
        {text}
      </text>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

function Sidebar(props: {
  sym: string
  watchlist: string[]
  tickers: Record<string, { last: number; change: number }>
  current: { sym: string; last: number; change: number }
  onPick: (s: string) => void
  bt: BacktestResult | null
  bars: Bar[]
  strategyId: string
  params: Record<string, number>
  onStrategy: (id: string) => void
  hlTrade: number | null
  onTrade: (k: number) => void
  narrow: boolean
}) {
  const m = props.bt?.metrics
  const trades = props.bt?.trades ?? []
  const w = SIDEBAR_W
  const eqW = w - 28
  const hl = props.hlTrade != null ? trades[props.hlTrade] : null
  return (
    <div testId="sidebar" style={{ display: 'flex', flexDirection: 'column', width: w, flexShrink: 0, borderLeftWidth: 1, borderColor: T.border, backgroundColor: T.panel }}>
      {/* Watchlist */}
      <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1, borderColor: T.border, flexShrink: 0 }}>
        <SectionTitle text="Watchlist" />
        {props.watchlist.map((s) => {
          const t = s === props.current.sym && Number.isFinite(props.current.last) ? { last: props.current.last, change: props.tickers[s]?.change ?? props.current.change } : props.tickers[s]
          const active = s === props.sym
          return (
            <Row key={s} testId={`wl-${s}`} active={active} onClick={() => props.onPick(s)}>
              <text style={{ color: active ? T.fg : T.dim, fontSize: 13, fontWeight: active ? 'bold' : 'normal', width: 96 }}>{s}</text>
              <div style={{ flexGrow: 1 }} />
              <text style={{ color: T.fg, fontSize: 12, fontFamily: MONO }}>{t ? fmtPrice(t.last) : '—'}</text>
              <text style={{ color: t && t.change < 0 ? T.red : T.green, fontSize: 12, fontFamily: MONO, width: 70, textAlign: 'right' }}>{t ? pct(t.change) : ''}</text>
            </Row>
          )
        })}
      </div>

      {/* Backtest */}
      <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 10, gap: 8, flexShrink: 0 }}>
        <SectionTitle text="Strategy backtest" />
        <div style={{ display: 'flex', flexDirection: 'row', gap: 2, marginLeft: 12, marginRight: 12, padding: 2, borderRadius: 7, backgroundColor: T.bg, borderWidth: 1, borderColor: T.border }}>
          {STRATEGIES.map((s) => (
            <div
              key={s.id}
              testId={`strat-${s.id}`}
              onClick={() => props.onStrategy(s.id)}
              style={{ flexGrow: 1, flexBasis: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 24, borderRadius: 5, backgroundColor: s.id === props.strategyId ? T.raised : 'transparent', cursor: 'pointer' }}
            >
              <text style={{ color: s.id === props.strategyId ? T.fg : T.dim, fontSize: 12, fontWeight: s.id === props.strategyId ? 'bold' : 'normal' }}>{s.label}</text>
            </div>
          ))}
        </div>
        <text testId="bt-params" style={{ color: T.faint, fontSize: 11, fontFamily: MONO, marginLeft: 14 }}>
          {`${Object.entries(props.params)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')} · fee ${FEE_BPS}bp · slip ${SLIP_BPS}bp`}
        </text>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', marginLeft: 12, marginRight: 12, rowGap: 8 }}>
          <Metric label="Return" value={m ? pct(m.totalReturn, 1) : '—'} color={m && m.totalReturn < 0 ? T.red : T.green} testId="m-return" />
          <Metric label="Sharpe" value={m ? m.sharpe.toFixed(2) : '—'} testId="m-sharpe" />
          <Metric label="Max DD" value={m ? pct(m.maxDrawdown, 1) : '—'} color={T.red} testId="m-dd" />
          <Metric label="CAGR" value={m ? pct(m.cagr, 1) : '—'} />
          <Metric label="Sortino" value={m ? m.sortino.toFixed(2) : '—'} />
          <Metric label="Win rate" value={m ? `${(m.winRate * 100).toFixed(0)}%` : '—'} />
          <Metric label="Profit factor" value={m ? (Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞') : '—'} />
          <Metric label="Exposure" value={m ? `${(m.exposure * 100).toFixed(0)}%` : '—'} />
          <Metric label="Trades" value={m ? String(m.trades) : '—'} testId="m-trades" />
        </div>
        <div style={{ position: 'relative', marginLeft: 14, width: eqW, height: 104, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: T.border }}>
          {props.bt ? (
            <Raster
              w={eqW}
              h={104}
              testId="equity"
              draw={(cv) => drawEquity(cv, props.bars, props.bt!, CAPITAL, hl ? { a: hl.entryIndex, b: hl.exitIndex } : null)}
              drawKey={[props.bt, eqW, hl]}
            />
          ) : null}
          <text style={{ position: 'absolute', left: 8, top: 5, color: T.faint, fontSize: 10, pointerEvents: 'none' }}>equity vs buy & hold · drawdown</text>
        </div>
      </div>

      {/* Trades */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingLeft: 14, paddingRight: 14, height: 22, flexShrink: 0 }}>
        <text style={{ color: T.dim, fontSize: 11, fontWeight: 'bold' }}>{`TRADES  ${trades.length}`}</text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ color: T.faint, fontSize: 10 }}>, . to step</text>
      </div>
      <div testId="trades" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'scroll', paddingBottom: 6 }}>
        {trades
          .map((t, k) => ({ t, k }))
          .reverse()
          .slice(0, 200)
          .map(({ t, k }) => (
            <Row key={k} testId={`trade-${k}`} active={props.hlTrade === k} onClick={() => props.onTrade(k)} h={24}>
              <text style={{ color: T.faint, fontSize: 11, fontFamily: MONO, width: 34 }}>{`#${k + 1}`}</text>
              <text style={{ color: T.dim, fontSize: 11, fontFamily: MONO }}>{`${fmtTime(t.entryTime, false)} → ${fmtTime(t.exitTime, false)}`}</text>
              <div style={{ flexGrow: 1 }} />
              <text style={{ color: t.pnl >= 0 ? T.green : T.red, fontSize: 11, fontFamily: MONO }}>{pct(t.pnlPct)}</text>
            </Row>
          ))}
      </div>
    </div>
  )
}

function SectionTitle({ text }: { text: string }) {
  return <text style={{ color: T.dim, fontSize: 11, fontWeight: 'bold', marginLeft: 14, marginBottom: 4 }}>{text.toUpperCase()}</text>
}

function Row({ children, active, onClick, testId, h = 28 }: { children: React.ReactNode; active: boolean; onClick: () => void; testId?: string; h?: number }) {
  const [hot, setHot] = useState(false)
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: h, paddingLeft: 14, paddingRight: 14, flexShrink: 0, backgroundColor: active ? '#71b7ff1f' : hot ? T.raised : 'transparent', cursor: 'pointer' }}
    >
      {active ? <div style={{ position: 'absolute', left: 0, top: 4, width: 2, height: h - 8, backgroundColor: T.blue }} /> : null}
      {children}
    </div>
  )
}

function Metric({ label, value, color = T.fg, testId }: { label: string; value: string; color?: string; testId?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: (SIDEBAR_W - 24) / 3, paddingLeft: 2, gap: 1 }}>
      <text style={{ color: T.faint, fontSize: 10 }}>{label}</text>
      <text testId={testId} style={{ color, fontSize: 14, fontFamily: MONO, fontWeight: 'bold' }}>
        {value}
      </text>
    </div>
  )
}

function heat(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return T.raised
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)))
  const mix = (a: number[], b: number[], k: number) => a.map((x, i) => Math.round(x + (b[i]! - x) * k))
  const red = [120, 40, 44]
  const mid = [28, 33, 41]
  const green = [22, 120, 52]
  const c = t < 0.5 ? mix(red, mid, t * 2) : mix(mid, green, (t - 0.5) * 2)
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

function SweepView({ data, onPick, onClose }: { data: { sw: Sweep; wf: ReturnType<typeof walkForward> } | null; onPick: (c: { fast: number; slow: number }) => void; onClose: () => void }) {
  const cell = 52
  return (
    <div testId="sweep-view" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0c10d9' }} onClick={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, borderRadius: 12, backgroundColor: T.panel, borderWidth: 1, borderColor: T.borderHi }} onClick={() => {}}>
        <text style={{ color: T.fg, fontSize: 15, fontWeight: 'bold' }}>SMA cross parameter sweep · Sharpe</text>
        {!data ? (
          <text style={{ color: T.dim, fontSize: 12 }}>Need at least 300 bars.</text>
        ) : (
          (() => {
            const vals = data.sw.cells.map((c) => c.sharpe).filter(Number.isFinite)
            const lo = Math.min(...vals)
            const hi = Math.max(...vals)
            const oos = data.wf.filter((f) => f.best)
            const oosAvg = oos.length ? oos.reduce((a, f) => a + f.oosSharpe, 0) / oos.length : 0
            return (
              <>
                <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 20 }}>
                    {data.sw.slows.map((s) => (
                      <div key={s} style={{ height: cell - 14, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', width: 54 }}>
                        <text style={{ color: T.faint, fontSize: 11, fontFamily: MONO }}>{`slow ${s}`}</text>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', flexDirection: 'row', gap: 2, height: 18 }}>
                      {data.sw.fasts.map((f) => (
                        <text key={f} style={{ color: T.faint, fontSize: 11, fontFamily: MONO, width: cell, textAlign: 'center' }}>{`fast ${f}`}</text>
                      ))}
                    </div>
                    {data.sw.slows.map((s) => (
                      <div key={s} style={{ display: 'flex', flexDirection: 'row', gap: 2 }}>
                        {data.sw.fasts.map((f) => {
                          const c = data.sw.cells.find((x) => x.fast === f && x.slow === s)!
                          const best = data.sw.best === c
                          return (
                            <div
                              key={f}
                              testId={`cell-${f}-${s}`}
                              onClick={() => Number.isFinite(c.sharpe) && onPick(c)}
                              style={{ width: cell, height: cell - 14, borderRadius: 4, backgroundColor: heat(c.sharpe, lo, hi), display: 'flex', alignItems: 'center', justifyContent: 'center', borderWidth: best ? 2 : 0, borderColor: T.yellow, cursor: 'pointer' }}
                            >
                              <text style={{ color: Number.isFinite(c.sharpe) ? T.fg : T.faint, fontSize: 12, fontFamily: MONO }}>{Number.isFinite(c.sharpe) ? c.sharpe.toFixed(2) : '·'}</text>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                <text testId="overfit" style={{ color: T.yellow, fontSize: 12, width: 380 }}>
                  {`In-sample best ${data.sw.best ? `${data.sw.best.fast}/${data.sw.best.slow} Sharpe ${data.sw.best.sharpe.toFixed(2)}` : '—'}. Walk-forward out-of-sample Sharpe averages ${oosAvg.toFixed(2)} over ${oos.length} folds: the best cell is the most overfit one.`}
                </text>
                <text style={{ color: T.faint, fontSize: 11 }}>Click a cell to backtest it · Esc closes</text>
              </>
            )
          })()
        )}
      </div>
    </div>
  )
}

function Help() {
  const rows: [string, string][] = [
    ['1–7', 'timeframe 1m 5m 15m 1h 4h 1D 1W'],
    ['drag · scroll', 'zoom to range · pan'],
    ['⌃/⌥ scroll · ⇧ drag', 'zoom at cursor · pan'],
    ['↑ ↓ ← →  0', 'zoom · pan · reset (or double-click)'],
    ['c  l', 'chart type · log scale'],
    ['e s b v u d', 'EMA SMA Bollinger VWAP SuperTrend Donchian'],
    ['r m k a o', 'RSI MACD Stoch ATR OBV panes'],
    ['t h g f  x', 'trend · level · box · fib · delete last'],
    ['n  w  , .', 'next strategy · sweep · step trades'],
    ['[ ]  p', 'watchlist symbol · backtest panel'],
    ['q  ⌃C', 'quit'],
  ]
  return (
    <div testId="help" style={{ position: 'absolute', right: 16, top: 16, display: 'flex', flexDirection: 'column', gap: 6, padding: 16, borderRadius: 10, backgroundColor: T.panel, borderWidth: 1, borderColor: T.borderHi, pointerEvents: 'none' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 14 }}>
          <text style={{ color: T.blue, fontSize: 12, fontFamily: MONO, width: 150 }}>{k}</text>
          <text style={{ color: T.dim, fontSize: 12 }}>{v}</text>
        </div>
      ))}
    </div>
  )
}

export { INDICATORS }
