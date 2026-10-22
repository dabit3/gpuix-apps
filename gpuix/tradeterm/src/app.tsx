import { useGpuixRequired, type EventPayload, type PublicInstance } from '@gpuix/react'
import { readFileSync } from 'node:fs'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { runBacktest, STRATEGIES, sweepSma, walkForward, type BacktestResult, type Sweep } from './backtest'
import {
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
import { loadBars, loadTickers, streamKlines, type Exchange, type Loaded } from './data/feed'
import { findIndicator, INDICATORS, type Series } from './indicators'
import { Canvas } from './raster'
import { loadState, saveState, type Drawing, type DrawingKind, type State } from './store'
import { normalizeSymbol, parseTimeframe, TF_SECONDS, TIMEFRAMES, type Bar, type Timeframe } from './types'
import {
  Button,
  CAPITAL,
  ChangePill,
  FEE_BPS,
  fmtDur,
  HelpSheet,
  Icon,
  Inspector,
  Menu,
  MONO,
  MONO_FILES,
  NAMES,
  nameOf,
  Palette,
  pct,
  Raster,
  Segmented,
  Sep,
  SLIP_BPS,
  STRATEGY_SHORT,
  SweepSheet,
  type Cmd,
  type MenuEntry,
} from './ui'
import type { IconName } from './icons'

const NO_DRAWINGS: Drawing[] = []
const AXIS_W = 84
const TIME_H = 26
const DIVIDER = 6

const CHART_TYPES: { id: State['chart']; label: string }[] = [
  { id: 'candles', label: 'Candles' },
  { id: 'heikin', label: 'Heikin-Ashi' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
]
const TOOLS: { id: DrawingKind; label: string; key: string; icon: IconName }[] = [
  { id: 'trend', label: 'Trend line', key: 't', icon: 'trend' },
  { id: 'hline', label: 'Price level', key: 'h', icon: 'hline' },
  { id: 'rect', label: 'Box', key: 'g', icon: 'rect' },
  { id: 'fib', label: 'Fibonacci retracement', key: 'f', icon: 'fib' },
]
const IND_KEYS: Record<string, string> = { e: 'ema', s: 'sma', b: 'bb', v: 'vwap', u: 'st', d: 'donchian', r: 'rsi', m: 'macd', k: 'stoch', a: 'atr', o: 'obv' }
const KEY_OF_IND = Object.fromEntries(Object.entries(IND_KEYS).map(([k, v]) => [v, k]))
const IND_ORDER = ['ema', 'sma', 'bb', 'vwap', 'st', 'donchian', 'rsi', 'macd', 'stoch', 'atr', 'obv']
const IND_NAMES: Record<string, string> = {
  ema: 'EMA 21 · exponential moving average',
  sma: 'SMA 50 · simple moving average',
  bb: 'Bollinger Bands',
  vwap: 'VWAP · volume-weighted average price',
  st: 'SuperTrend',
  donchian: 'Donchian Channel',
  rsi: 'RSI · relative strength',
  macd: 'MACD',
  stoch: 'Stochastic',
  atr: 'ATR · average true range',
  obv: 'OBV · on-balance volume',
}
const TF_ADJ: Record<Timeframe, string> = { '1m': '1-minute', '5m': '5-minute', '15m': '15-minute', '1h': '1-hour', '4h': '4-hour', '1D': 'daily', '1W': 'weekly' }
const TF_LABEL: Record<Timeframe, string> = { '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour', '4h': '4 hours', '1D': '1 day', '1W': '1 week' }

export type AppProps = {
  symbol: string
  timeframe: Timeframe
  bars?: number
  offline?: boolean
  strategy?: string
  exchange?: Exchange
  /** Inject data (tests). Skips the network and the live stream. */
  preload?: Loaded
  onQuit?: () => void
}

type Hover = { pane: string; x: number; y: number } | null
type Box = { x: number; y: number; w: number; h: number }

/** Letters can arrive as key "space" with the real character in keyChar in terminal mode. */
function keyOf(e: EventPayload) {
  const ch = e.keyChar ?? ''
  const k = (e.key ?? '').toLowerCase()
  if (ch.length === 1 && ch !== ' ' && (k.length === 1 || k === 'space')) return ch
  return k
}

function clampView(v: View, n: number): View {
  const w = Math.max(8, Math.min(Math.max(n * 1.2, 20), v.end - v.start))
  let start = v.start
  if (start + w < Math.min(10, n)) start = Math.min(10, n) - w
  if (start > n - 6) start = n - 6
  return { start, end: start + w }
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
    if (props.exchange) s.exchange = props.exchange
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
  const [menu, setMenu] = useState<'chart' | 'ind' | null>(null)
  const [pal, setPal] = useState<{ q: string; i: number } | null>(null)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const [params, setParams] = useState<Record<string, Record<string, number>>>({})
  const [tickers, setTickers] = useState<Record<string, { last: number; change: number }>>({})
  const drag = useRef<{ kind: 'zoom' | 'pan' | 'draw' | 'split'; x: number; y: number; view: View; pane?: string; size?: number } | null>(null)
  const followRef = useRef(true)
  const triggers = useRef<Record<string, Box>>({})
  const [headerH, setHeaderH] = useState(56)
  const animate = !props.preload

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

  useEffect(() => {
    for (const f of MONO_FILES)
      try {
        renderer.registerFont?.(readFileSync(f))
      } catch {}
  }, [renderer])

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
    loadBars(sym, tf, props.bars ?? 3000, { offline: props.offline, exchange: st.exchange }).then((d) => {
      if (!alive) return
      setData(d)
      setLoading(false)
      setHlTrade(null)
      followRef.current = true
    })
    return () => {
      alive = false
    }
  }, [sym, tf, st.exchange])

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
    }, data.source)
  }, [data?.source, sym, tf])

  useEffect(() => {
    if (props.preload) return
    let alive = true
    const tick = () =>
      loadTickers(stRef.current.watchlist, stRef.current.exchange)
        .then((t) => alive && setTickers(t))
        .catch(() => {})
    tick()
    const id = setInterval(tick, 15000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [st.exchange, st.watchlist.join()])

  // View animation: zoom, reset and trade jumps ease out over ~280 ms instead of snapping.
  const viewRef = useRef(view)
  viewRef.current = view
  const anim = useRef<{ from: View; to: View; t0: number; dur: number } | null>(null)
  const animTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(
    () => () => {
      if (animTimer.current) clearInterval(animTimer.current)
    },
    [],
  )
  const setViewNow = (v: View | ((v: View) => View)) => {
    anim.current = null
    setView(v)
  }
  const animateView = (to: View, dur = 280) => {
    if (!animate) return setViewNow(to)
    anim.current = { from: viewRef.current, to, t0: performance.now(), dur }
    if (animTimer.current) return
    animTimer.current = setInterval(() => {
      const a = anim.current
      if (!a) {
        clearInterval(animTimer.current!)
        animTimer.current = null
        return
      }
      const k = Math.min(1, (performance.now() - a.t0) / a.dur)
      const e = 1 - Math.pow(1 - k, 3)
      setView({ start: a.from.start + (a.to.start - a.from.start) * e, end: a.from.end + (a.to.end - a.from.end) * e })
      if (k >= 1) anim.current = null
    }, 16)
  }
  const targetView = () => anim.current?.to ?? viewRef.current

  // Reset the view when a new series loads; follow the right edge as live bars arrive.
  const loadedKey = `${sym}:${tf}:${data?.source}:${data?.bars[0]?.t}`
  const prevN = useRef(0)
  const chartW = Math.max(100, colBox.w - AXIS_W)
  const homeView = () => {
    const visible = Math.min(n, Math.round(chartW / 7.5))
    return clampView({ start: n + 6 - visible, end: n + 6 }, n)
  }
  const resetView = (smooth = false) => {
    followRef.current = true
    if (smooth) animateView(homeView(), 340)
    else setViewNow(homeView())
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
      const shift = (v: View) => (v.end >= prevN.current - 1 ? { start: v.start + d, end: v.end + d } : v)
      if (anim.current) anim.current.to = shift(anim.current.to)
      setView(shift)
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

  const zoomAt = (factor: number, frac: number, smooth = false) => {
    const v = smooth ? targetView() : viewRef.current
    const w = v.end - v.start
    const nw = w * factor
    const anchor = v.start + w * frac
    followRef.current = false
    const next = clampView({ start: anchor - nw * frac, end: anchor + nw * (1 - frac) }, n)
    if (smooth) animateView(next, 200)
    else setViewNow(next)
  }
  const pan = (d: number, smooth = false) => {
    followRef.current = false
    if (smooth) {
      const v = targetView()
      animateView(clampView({ start: v.start + d, end: v.end + d }, n), 200)
    } else setViewNow((v) => clampView({ start: v.start + d, end: v.end + d }, n))
  }
  const zoomTo = (x0: number, x1: number) => {
    const a = iOf(mf, Math.min(x0, x1))
    const b = iOf(mf, Math.max(x0, x1))
    if (b - a < 6) return
    animateView(clampView({ start: a, end: b + 1 }, n), 320)
  }

  const toggleIndicator = (id: string) => update((s) => ({ ...s, indicators: s.indicators.includes(id) ? s.indicators.filter((x) => x !== id) : [...s.indicators, id] }))
  const setChart = (c: State['chart']) => update((s) => ({ ...s, chart: c }))
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
    animateView(clampView({ start: mid - span / 2, end: mid + span / 2 }, n), 380)
  }
  const cycleSymbol = (d: number) => {
    const wl = st.watchlist
    const i = wl.indexOf(sym)
    setSym(wl[(i + d + wl.length) % wl.length]!)
  }
  const pickTool = (t: DrawingKind) => setTool((cur) => (cur === t ? null : t))

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

  // Price tick flash.
  const last = bars[n - 1]
  const prevLast = useRef<{ key: string; c: number } | null>(null)
  useEffect(() => {
    if (!last) return
    const key = `${sym}:${tf}`
    const p = prevLast.current
    prevLast.current = { key, c: last.c }
    if (!p || p.key !== key || p.c === last.c) return
    setFlash(last.c > p.c ? 'up' : 'down')
    const t = setTimeout(() => setFlash(null), 450)
    return () => clearTimeout(t)
  }, [last?.c, sym, tf])

  // Command palette.
  const commands = useMemo<Cmd[]>(() => {
    const out: Cmd[] = []
    const syms = [...new Set([...st.watchlist, ...Object.keys(NAMES).map((b) => `${b}-USD`)])]
    for (const s of syms)
      out.push({ id: `sym-${s}`, title: s, sub: `${nameOf(s)}${st.watchlist.includes(s) ? ' · Watchlist' : ''}`, icon: 'candles', keywords: `${s} ${s.split('-')[0]} ${nameOf(s)} symbol`, run: () => setSym(s), rank: st.watchlist.includes(s) ? 1 : 0 })
    TIMEFRAMES.forEach((t, i) => out.push({ id: `tf-${t}`, title: TF_LABEL[t], sub: `Timeframe · ${t}`, icon: 'candles', hint: String(i + 1), keywords: `${t} ${TF_LABEL[t]} timeframe interval`, run: () => setTf(t) }))
    for (const id of IND_ORDER) {
      const on = st.indicators.includes(id)
      const def = findIndicator(id)!
      out.push({ id: `ind-${id}`, title: `${on ? 'Hide' : 'Show'} ${IND_NAMES[id]}`, sub: def.pane === 'own' ? 'Indicator pane' : 'Chart overlay', icon: 'wave', hint: KEY_OF_IND[id], keywords: `${def.label} ${IND_NAMES[id]} indicator ${on ? 'hide' : 'show'}`, run: () => toggleIndicator(id) })
    }
    for (const c of CHART_TYPES) out.push({ id: `chart-${c.id}`, title: c.label, sub: `Chart style${st.chart === c.id ? ' · current' : ''}`, icon: 'candles', hint: 'c', keywords: `${c.label} chart style`, run: () => setChart(c.id) })
    const hlFirst = st.exchange === 'hyperliquid'
    out.push({ id: 'exchange', title: hlFirst ? 'Use Binance data' : 'Use Hyperliquid data', sub: hlFirst ? 'Data source · Binance first, then Coinbase and Hyperliquid' : 'Data source · Hyperliquid perps first (HYPE, AAVE, …)', icon: 'wave', keywords: 'hyperliquid hl perp perps exchange data source feed binance', run: () => update((s) => ({ ...s, exchange: s.exchange === 'hyperliquid' ? 'auto' : 'hyperliquid' })) })
    out.push({ id: 'log', title: st.log ? 'Linear scale' : 'Log scale', sub: 'Price axis', icon: 'wave', hint: 'l', keywords: 'log linear scale axis', run: () => update((s) => ({ ...s, log: !s.log })) })
    for (const t of TOOLS) out.push({ id: `tool-${t.id}`, title: t.label, sub: 'Drawing tool', icon: t.icon, hint: t.key, keywords: `${t.label} ${t.id} draw drawing`, run: () => setTool(t.id) })
    for (const s of STRATEGIES) out.push({ id: `strat-${s.id}`, title: `Backtest ${s.label}`, sub: `Strategy · ${STRATEGY_SHORT[s.id] ?? s.label}`, icon: 'play', hint: 'n', keywords: `${s.label} ${s.id} strategy backtest`, run: () => (setStrategy(s.id), wide && setPanel(true)) })
    out.push({ id: 'sweep', title: 'Parameter sweep', sub: 'SMA cross · walk-forward check', icon: 'grid', hint: 'w', keywords: 'sweep parameter optimize walk forward heatmap', run: () => setSweepOpen(true) })
    out.push({ id: 'panel', title: showPanel ? 'Hide inspector' : 'Show inspector', sub: 'Watchlist and backtest', icon: 'sidebar', hint: 'p', keywords: 'inspector sidebar panel watchlist backtest', run: () => setPanel(!showPanel) })
    out.push({ id: 'reset', title: 'Reset view', sub: 'Jump to the latest bars', icon: 'candles', hint: '0', keywords: 'reset view latest home', run: () => resetView(true) })
    out.push({ id: 'del', title: 'Delete last drawing', sub: `${drawings.length} on ${sym}`, icon: 'rect', hint: 'x', keywords: 'delete undo drawing remove', run: deleteLast })
    out.push({ id: 'keys', title: 'Keyboard shortcuts', sub: 'Help', icon: 'key', hint: '?', keywords: 'help keys shortcuts keyboard', run: () => setHelp(true) })
    out.push({ id: 'quit', title: 'Quit tradeterm', sub: 'Restore the terminal', icon: 'enter', hint: 'q', keywords: 'quit exit close', run: () => props.onQuit?.() })
    return out
  }, [st, showPanel, drawings.length, sym])

  const palItems = useMemo<Cmd[]>(() => {
    if (!pal) return []
    const q = pal.q.trim().toLowerCase()
    if (!q) return commands.filter((c) => c.id.startsWith('sym-') && c.rank).concat(commands.filter((c) => ['sweep', 'keys'].includes(c.id)))
    const tokens = q.split(/\s+/)
    const tfTok = tokens.map((t) => parseTimeframe(t)).find(Boolean) ?? null
    const rest = tokens.filter((t) => !parseTimeframe(t))
    const score = (c: Cmd, toks: string[]) => {
      const kw = c.keywords.toLowerCase()
      if (!toks.every((t) => kw.includes(t))) return -1
      const words = kw.split(/[\s·-]+/)
      let sc = c.rank ?? 0
      for (const t of toks) if (words.some((w) => w.startsWith(t))) sc += 3
      if (c.title.toLowerCase().startsWith(toks[0] ?? '')) sc += 4
      if (c.id.startsWith('sym-') && words.includes(toks[0] ?? '')) sc += 6
      return sc
    }
    const out: Cmd[] = []
    if (tfTok && rest.length) {
      const symHit = commands.filter((c) => c.id.startsWith('sym-')).map((c) => ({ c, s: score(c, rest) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]
      const s = symHit ? symHit.c.title : /^[a-z0-9]{2,10}(-usd)?$/.test(rest.join('')) ? normalizeSymbol(rest.join('')) : null
      if (s) out.push({ id: `go-${s}-${tfTok}`, title: `${s} · ${tfTok}`, sub: `Open ${nameOf(s)} on the ${TF_ADJ[tfTok]} chart`, icon: 'candles', keywords: '', run: () => (setSym(s), setTf(tfTok)) })
    }
    const ranked = commands.map((c) => ({ c, s: score(c, tokens) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.c)
    out.push(...ranked)
    if (!out.length && /^[a-z0-9]{2,10}(-usd)?$/.test(q)) {
      const s = normalizeSymbol(q)
      out.push({ id: `go-${s}`, title: s, sub: 'Open from Binance public market data', icon: 'candles', keywords: '', run: () => setSym(s) })
    }
    return out.slice(0, 8)
  }, [pal?.q, commands])
  const runCmd = (c: Cmd) => {
    setPal(null)
    c.run()
  }

  const onKey = (e: EventPayload) => {
    if (e.modifiers?.cmd) return
    const k = keyOf(e)
    if (pal) {
      if (k === 'escape') setPal(null)
      else if (k === 'enter' || k === 'return') {
        const c = palItems[Math.min(pal.i, palItems.length - 1)]
        if (c) runCmd(c)
      } else if (k === 'down' || (e.modifiers?.ctrl && k === 'n')) setPal({ ...pal, i: Math.min(palItems.length - 1, pal.i + 1) })
      else if (k === 'up' || (e.modifiers?.ctrl && k === 'p')) setPal({ ...pal, i: Math.max(0, pal.i - 1) })
      else if (k === 'backspace') setPal({ q: pal.q.slice(0, -1), i: 0 })
      else if (e.modifiers?.ctrl && k === 'u') setPal({ q: '', i: 0 })
      else if (k === 'space') setPal({ q: `${pal.q} `, i: 0 })
      else if (k.length === 1 && !e.modifiers?.ctrl && pal.q.length < 40) setPal({ q: pal.q + k, i: 0 })
      return
    }
    if (e.modifiers?.ctrl) {
      if (k === 'q') props.onQuit?.()
      else if (k === 'k') setPal({ q: '', i: 0 })
      return
    }
    if (menu) {
      setMenu(null)
      if (k === 'escape') return
    }
    if (help) {
      setHelp(false)
      if (k === '?' || k === 'escape') return
    }
    if (k === '/') setPal({ q: '', i: 0 })
    else if (/^[1-7]$/.test(k)) setTf(TIMEFRAMES[Number(k) - 1]!)
    else if (IND_KEYS[k]) toggleIndicator(IND_KEYS[k]!)
    else if (k === 'c') setChart(CHART_TYPES[(CHART_TYPES.findIndex((c) => c.id === st.chart) + 1) % CHART_TYPES.length]!.id)
    else if (k === 'l') update((s) => ({ ...s, log: !s.log }))
    else if (TOOLS.some((t) => t.key === k)) pickTool(TOOLS.find((t) => t.key === k)!.id)
    else if (k === 'escape') {
      if (sweepOpen) setSweepOpen(false)
      else if (tool || pending) {
        setTool(null)
        setPending(null)
      } else if (hlTrade != null) setHlTrade(null)
      else resetView(true)
    } else if (k === 'backspace' || k === 'delete' || k === 'x') deleteLast()
    else if (k === 'n') setStrategy(STRATEGIES[(STRATEGIES.indexOf(strategy) + 1) % STRATEGIES.length]!.id)
    else if (k === 'w') setSweepOpen((o) => !o)
    else if (k === 'p') setPanel(!showPanel)
    else if (k === '[') cycleSymbol(-1)
    else if (k === ']') cycleSymbol(1)
    else if (k === '.' || k === '>') jumpToTrade(hlTrade == null ? (bt?.trades.length ?? 1) - 1 : Math.min((bt?.trades.length ?? 1) - 1, hlTrade + 1))
    else if (k === ',' || k === '<') jumpToTrade(hlTrade == null ? (bt?.trades.length ?? 1) - 1 : Math.max(0, hlTrade - 1))
    else if (k === 'left') pan(-(view.end - view.start) * 0.2, true)
    else if (k === 'right') pan((view.end - view.start) * 0.2, true)
    else if (k === 'up' || k === '+' || k === '=') zoomAt(0.7, 0.85, true)
    else if (k === 'down' || k === '-') zoomAt(1 / 0.7, 0.85, true)
    else if (k === '0') resetView(true)
    else if (k === '?') setHelp(true)
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
          resetView(true)
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
        anim.current = null
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
          setViewNow(clampView({ start: d.view.start - (p.x - d.x) * bpp, end: d.view.end - (p.x - d.x) * bpp }, n))
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
        const bpp = (view.end - view.start) / chartW
        pan(-delta * bpp * (e.precise ? 1 : 24))
      },
    }
  }

  const live = data?.source === 'binance' || data?.source === 'coinbase' || data?.source === 'hyperliquid'
  const srcText = data?.source === 'binance' ? 'Binance · live' : data?.source === 'coinbase' ? 'Coinbase · live' : data?.source === 'hyperliquid' ? 'Hyperliquid · live' : data?.source === 'cache' ? 'Cached · offline' : data ? 'Sample data' : 'Connecting…'

  const dayAgo = last ? bars[Math.max(0, Math.round(indexOfTime(bars, last.t - 86400)))] : undefined
  const dayChange = last && dayAgo ? last.c / dayAgo.c - 1 : NaN
  const visibleBars = Math.max(0, Math.round(view.end - view.start))

  // Drag-to-zoom measure readout.
  const measure = (() => {
    if (!sel || !n) return null
    const i0 = Math.max(0, Math.min(n - 1, Math.round(iOf(mf, Math.min(sel.a, sel.b)))))
    const i1 = Math.max(0, Math.min(n - 1, Math.round(iOf(mf, Math.max(sel.a, sel.b)))))
    const a = bars[i0]!
    const b = bars[i1]!
    return { change: b.c / a.c - 1, count: i1 - i0 + 1, dur: b.t - a.t + TF_SECONDS[tf] }
  })()

  const measureTrigger = (id: string) => (e: EventPayload) => {
    triggers.current[id] = { x: e.x ?? 0, y: e.y ?? 0, w: e.width ?? 0, h: e.height ?? 0 }
  }
  // The menu buttons lead the toolbar's first row, which sits right under the (possibly wrapped) title bar.
  const menuAt = (id: string, w: number) => {
    const b = triggers.current[id] ?? { x: 12, y: 0, w: 0, h: 28 }
    return { x: Math.max(8, Math.min(size.w - w - 8, b.x)), y: headerH + 1 + 4 + 28 + 6 }
  }
  const chartLabel = CHART_TYPES.find((c) => c.id === st.chart)!.label

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
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: T.bg, userSelect: 'none' }}
    >
      {/* Title bar: symbol, price, change, source, timeframe. */}
      <div
        onLayout={(e) => {
          const h = Math.round(e.height ?? 0)
          if (h && h !== headerH) setHeaderH(h)
        }}
        style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: 56, paddingTop: 8, paddingBottom: 8, paddingLeft: 18, paddingRight: 14, columnGap: 18, rowGap: 8, flexShrink: 0 }}>
        <SymbolButton sym={sym} tf={tf} onClick={() => setPal({ q: '', i: 0 })} />
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <text testId="last" style={{ color: flash === 'up' ? T.green : flash === 'down' ? T.red : T.fg, fontSize: 24, fontFamily: MONO, fontWeight: 600 }}>
            {last ? fmtPrice(last.c) : '—'}
          </text>
          <ChangePill v={dayChange} testId="change" size={12} />
          {!compact ? <text style={{ color: T.faint, fontSize: 11 }}>24h</text> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0, paddingLeft: live ? 0 : 8, paddingRight: live ? 0 : 8, height: 22, borderRadius: 6, backgroundColor: live ? 'transparent' : '#f0b72f1f' }}>
          {live ? <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: T.faint }} /> : null}
          <text testId="source" style={{ color: live ? T.faint : data ? T.yellow : T.faint, fontSize: 12 }}>
            {srcText}
          </text>
        </div>
        <div style={{ flexGrow: 1 }} />
        <Segmented mono items={TIMEFRAMES.map((t) => ({ id: t, label: t, testId: `tf-${t}` }))} value={tf} onChange={(t) => setTf(t)} />
      </div>

      {/* Toolbar */}
      <div testId="toolbar" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: 40, paddingTop: 4, paddingBottom: 4, paddingLeft: 12, paddingRight: 12, columnGap: 4, rowGap: 4, flexShrink: 0, borderTopWidth: 1, borderBottomWidth: 1, borderColor: T.border }}>
        <Button testId="menu-chart" icon="candles" label={compact && st.chart === 'heikin' ? 'HA' : chartLabel} chevron active={menu === 'chart'} onClick={() => setMenu(menu === 'chart' ? null : 'chart')} onLayout={measureTrigger('chart')} />
        <Button testId="menu-ind" icon="wave" label="Indicators" badge={String(enabled.length)} chevron active={menu === 'ind'} onClick={() => setMenu(menu === 'ind' ? null : 'ind')} onLayout={measureTrigger('ind')} />
        <Sep />
        {TOOLS.map((t) => (
          <Button key={t.id} testId={`tool-${t.id}`} icon={t.icon} active={tool === t.id} onClick={() => pickTool(t.id)} />
        ))}
        <div style={{ flexGrow: 1 }} />
        <SearchButton compact={compact} onClick={() => setPal({ q: '', i: 0 })} />
        <Button testId="sweep" icon="grid" label={compact ? undefined : 'Sweep'} active={sweepOpen} onClick={() => setSweepOpen((o) => !o)} />
        <Button testId="panel" icon="sidebar" active={showPanel} onClick={() => setPanel(!showPanel)} />
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0, position: 'relative' }}>
        <div
          testId="chart-col"
          style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, position: 'relative' }}
          onLayout={(e) => {
            const b = { x: e.x ?? 0, y: e.y ?? 0, w: Math.round(e.width ?? 0), h: Math.round(e.height ?? 0) }
            if (b.w && b.h && (b.w !== colBox.w || b.h !== colBox.h || b.x !== colBox.x || b.y !== colBox.y)) setColBox(b)
          }}
        >
          <PaneRow
            id="main"
            w={chartW}
            h={mainH}
            handlers={paneHandlers('main', { x: colBox.x, y: colBox.y }, true)}
            draw={(cv) => drawMain(cv, mainSpec, mf, priceTicks, xTicks)}
            drawKey={[mainSpec, chartW, mainH, priceTicks.join(), xTicks.length]}
            axis={
              <>
                {priceTicks.map((p) => {
                  const y = yOf(mf, p)
                  if (y < 8 || y > mainH - 8) return null
                  return <AxisLabel key={p} y={y} text={fmtPrice(p, mf.yMax)} />
                })}
                {drawings
                  .filter((d) => d.kind === 'hline')
                  .map((d) => (
                    <AxisTag key={d.id} y={yOf(mf, d.a.p)} text={fmtPrice(d.a.p)} color={T.yellow} />
                  ))}
                {last ? <AxisTag y={yOf(mf, last.c)} text={fmtPrice(last.c)} color={last.c >= last.o ? T.green : T.red} testId="last-tag" /> : null}
                {hover?.pane === 'main' ? <AxisTag y={hover.y} text={fmtPrice(pOf(mf, hover.y))} color={T.fg} /> : null}
              </>
            }
          >
            <div style={{ position: 'absolute', left: 14, top: 10, display: 'flex', flexDirection: 'column', gap: 5, pointerEvents: 'none' }}>
              {legendBar ? (
                <div testId="ohlc" style={{ display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  {(
                    [
                      ['O', legendBar.o],
                      ['H', legendBar.h],
                      ['L', legendBar.l],
                      ['C', legendBar.c],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
                      <text style={{ color: T.faint, fontSize: 12, fontFamily: MONO }}>{k}</text>
                      <text style={{ color: T.fg, fontSize: 12, fontFamily: MONO }}>{fmtPrice(v)}</text>
                    </div>
                  ))}
                  <text style={{ color: legendBar.c >= legendBar.o ? T.green : T.red, fontSize: 12, fontFamily: MONO }}>{pct(legendBar.c / legendBar.o - 1)}</text>
                  {!compact ? <text style={{ color: T.faint, fontSize: 12, fontFamily: MONO }}>{`Vol ${fmtCompact(legendBar.v)}`}</text> : null}
                  {hoverIdx != null && !compact ? <text style={{ color: T.faint, fontSize: 12, fontFamily: MONO }}>{fmtTime(legendBar.t)}</text> : null}
                </div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 3 }}>
                {overlays
                  .filter((s) => s.style !== 'band-lower')
                  .map((s) => (
                    <div key={s.name} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 2, borderRadius: 1, backgroundColor: s.color.slice(0, 7) }} />
                      <text style={{ color: T.dim, fontSize: 11 }}>{s.name}</text>
                      <text style={{ color: T.fg, fontSize: 11, fontFamily: MONO }}>{fmtPrice(s.values[legendIdx] ?? NaN, last?.c)}</text>
                    </div>
                  ))}
              </div>
            </div>
            {drawings
              .filter((d) => d.kind === 'fib')
              .flatMap((d) =>
                FIB_LEVELS.map((lv) => {
                  const p = d.b.p + (d.a.p - d.b.p) * lv
                  const y = yOf(mf, p)
                  const x = Math.min(xOf(mf, indexOfTime(bars, d.a.t)), xOf(mf, indexOfTime(bars, d.b.t)))
                  // Keep clear of the OHLC legend in the top-left corner.
                  if (y < 0 || y > mainH || (y < 64 && x < 560)) return null
                  const golden = lv === 0.5 || lv === 0.618
                  return (
                    <div key={`${d.id}-${lv}`} style={{ position: 'absolute', left: Math.max(4, x + 6), top: y - 17, display: 'flex', flexDirection: 'row', gap: 6, paddingLeft: 5, paddingRight: 5, height: 15, alignItems: 'center', borderRadius: 3, backgroundColor: '#0a0c10cc', pointerEvents: 'none' }}>
                      <text style={{ color: golden ? T.blue : T.dim, fontSize: 10, fontFamily: MONO }}>{lv.toFixed(3)}</text>
                      <text style={{ color: golden ? T.blue : T.faint, fontSize: 10, fontFamily: MONO }}>{fmtPrice(p)}</text>
                    </div>
                  )
                }),
              )}
            {sel ? (
              <div testId="zoom-sel" style={{ position: 'absolute', top: 0, left: Math.min(sel.a, sel.b), width: Math.abs(sel.b - sel.a), height: '100%', backgroundColor: '#71b7ff14', borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#71b7ff99', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {measure && Math.abs(sel.b - sel.a) > 60 ? (
                  <div testId="measure" style={{ marginTop: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingTop: 6, paddingBottom: 6, paddingLeft: 10, paddingRight: 10, borderRadius: 8, backgroundColor: T.raised, borderWidth: 1, borderColor: T.borderHi }}>
                    <text style={{ color: measure.change >= 0 ? T.green : T.red, fontSize: 15, fontFamily: MONO, fontWeight: 600 }}>{pct(measure.change)}</text>
                    <text style={{ color: T.dim, fontSize: 11, fontFamily: MONO }}>{`${measure.count} bars · ${fmtDur(measure.dur)}`}</text>
                  </div>
                ) : null}
              </div>
            ) : null}
            {tool ? (
              <div style={{ position: 'absolute', left: 0, bottom: 14, width: '100%', display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 32, paddingLeft: 12, paddingRight: 12, borderRadius: 16, backgroundColor: T.raised, borderWidth: 1, borderColor: T.borderHi }}>
                  <Icon name={TOOLS.find((t) => t.id === tool)!.icon} color={T.blue} />
                  <text style={{ color: T.fg, fontSize: 12.5, fontWeight: 600 }}>{TOOLS.find((t) => t.id === tool)!.label}</text>
                  <text testId="tool-hint" style={{ color: T.dim, fontSize: 12 }}>
                    {tool === 'hline' ? 'Click to place a level · Esc cancels' : 'Drag to draw · snaps to OHLC · Esc cancels'}
                  </text>
                </div>
              </div>
            ) : null}
            <Crosshair hover={hover} pane="main" f={mf} idx={hoverIdx} h={mainH} />
            {loading ? (
              <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: n ? '#0a0c10b3' : 'transparent', pointerEvents: 'none' }}>
                <text testId="loading" style={{ color: T.dim, fontSize: 14 }}>{`Loading ${sym} · ${tf}`}</text>
              </div>
            ) : null}
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
                  handlers={paneHandlers(def.id, box, false)}
                  draw={(cv) => drawOsc(cv, spec, f, xTicks)}
                  drawKey={[series, view, chartW, h, xTicks.length]}
                  axis={
                    <>
                      {(def.levels ?? niceTicks(f.yMin, f.yMax, 2)).map((v) => {
                        const y = yOf(f, v)
                        if (y < 6 || y > h - 6) return null
                        return <AxisLabel key={v} y={y} text={Math.abs(v) >= 1000 ? fmtCompact(v) : v.toFixed(Math.abs(v) < 10 && !def.range ? 2 : 0)} />
                      })}
                      {hover?.pane === def.id ? <AxisTag y={hover.y} text={fmtCompact(pOf(f, hover.y))} color={T.fg} /> : null}
                    </>
                  }
                >
                  <div style={{ position: 'absolute', left: 14, top: 6, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, pointerEvents: 'none' }}>
                    <text style={{ color: T.fg, fontSize: 11, fontWeight: 600 }}>{def.label}</text>
                    {series.map((s) => (
                      <div key={s.name} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        {s.style !== 'histogram' ? <div style={{ width: 8, height: 2, borderRadius: 1, backgroundColor: s.color.slice(0, 7) }} /> : null}
                        <text style={{ color: T.dim, fontSize: 11 }}>{s.name}</text>
                        <text style={{ color: T.fg, fontSize: 11, fontFamily: MONO }}>{fmtNum(s.values[legendIdx] ?? NaN)}</text>
                      </div>
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
              <text key={`${t.x}`} style={{ position: 'absolute', left: Math.max(0, t.x - 30), top: 5, width: 60, textAlign: 'center', color: t.major ? T.dim : T.faint, fontSize: 11, fontFamily: MONO }}>
                {t.label}
              </text>
            ))}
            {hoverIdx != null && bars[hoverIdx] ? (
              <div style={{ position: 'absolute', left: Math.max(0, Math.min(chartW - 140, xOf(mf, hoverIdx) - 70)), top: 3, width: 140, height: 20, borderRadius: 5, backgroundColor: T.fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <text style={{ color: T.bg, fontSize: 11, fontFamily: MONO, fontWeight: 600 }}>{fmtTime(bars[hoverIdx]!.t)}</text>
              </div>
            ) : null}
            <div style={{ position: 'absolute', left: chartW, top: 0, width: AXIS_W, height: TIME_H, display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderColor: T.border }}>
              <text testId="range" style={{ color: T.faint, fontSize: 10.5, fontFamily: MONO }}>{`${visibleBars.toLocaleString('en-US')} bars`}</text>
            </div>
          </div>
        </div>

        {showPanel ? (
          <InspectorSlot overlay={!wide}>
          <Inspector
            sym={sym}
            watchlist={st.watchlist}
            tickers={tickers}
            current={{ sym, last: last?.c ?? NaN, change: dayChange }}
            onPick={setSym}
            bt={bt}
            bars={closedBars}
            strategies={STRATEGIES}
            strategyId={strategy.id}
            params={sp}
            onStrategy={setStrategy}
            hlTrade={hlTrade}
            onTrade={jumpToTrade}
            animate={animate}
            revealKey={`${sym}:${tf}:${strategy.id}:${JSON.stringify(sp)}:${data?.source}`}
          />
          </InspectorSlot>
        ) : null}
      </div>

      {menu === 'chart' ? (
        <Menu
          {...menuAt('chart', 220)}
          width={220}
          onClose={() => setMenu(null)}
          entries={[
            ...CHART_TYPES.map<MenuEntry>((c) => ({ id: c.id, testId: `chart-${c.id}`, label: c.label, checked: st.chart === c.id, onSelect: () => (setChart(c.id), setMenu(null)) })),
            { divider: true },
            { id: 'log', testId: 'log', label: 'Log scale', hint: 'l', checked: st.log, onSelect: () => update((s) => ({ ...s, log: !s.log })) },
          ]}
        />
      ) : null}
      {menu === 'ind' ? (
        <Menu
          {...menuAt('ind', 300)}
          width={300}
          onClose={() => setMenu(null)}
          entries={[
            { section: 'Overlays' },
            ...IND_ORDER.filter((id) => findIndicator(id)!.pane === 'overlay').map<MenuEntry>((id) => ({ id, testId: `ind-${id}`, label: IND_NAMES[id]!, hint: KEY_OF_IND[id], checked: st.indicators.includes(id), onSelect: () => toggleIndicator(id) })),
            { section: 'Panes' },
            ...IND_ORDER.filter((id) => findIndicator(id)!.pane === 'own').map<MenuEntry>((id) => ({ id, testId: `ind-${id}`, label: IND_NAMES[id]!, hint: KEY_OF_IND[id], checked: st.indicators.includes(id), onSelect: () => toggleIndicator(id) })),
          ]}
        />
      ) : null}
      {sweepOpen ? (
        <SweepSheet
          data={sweep}
          onPick={(c) => {
            setParams((p) => ({ ...p, sma: { fast: c.fast, slow: c.slow } }))
            setStrategy('sma')
            if (wide) setPanel(true)
            setSweepOpen(false)
          }}
          onClose={() => setSweepOpen(false)}
        />
      ) : null}
      {help ? <HelpSheet onClose={() => setHelp(false)} /> : null}
      {pal ? <Palette query={pal.q} items={palItems} selected={Math.min(pal.i, Math.max(0, palItems.length - 1))} width={size.w} onPick={runCmd} onHover={(i) => pal.i !== i && setPal({ ...pal, i })} onClose={() => setPal(null)} /> : null}
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

/** Inline column in wide panes; a slide-over sheet in narrow splits so the chart keeps its width. */
function InspectorSlot({ overlay, children }: { overlay: boolean; children: React.ReactNode }) {
  if (!overlay) return <>{children}</>
  return (
    <div testId="inspector-sheet" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'row', boxShadow: [{ offsetX: -12, offsetY: 0, blurRadius: 32, spreadRadius: 0, color: '#000000b3' }] }}>
      {children}
    </div>
  )
}

function SymbolButton({ sym, tf, onClick }: { sym: string; tf: string; onClick: () => void }) {
  const [hot, setHot] = useState(false)
  return (
    <div testId="symbol-btn" onClick={onClick} onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)} style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, marginLeft: -8, borderRadius: 8, backgroundColor: hot ? T.raised : 'transparent', cursor: 'pointer', flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <text testId="symbol" style={{ color: T.fg, fontSize: 17, fontWeight: 700 }}>
          {sym}
        </text>
        <Icon name="chevron" size={12} color={hot ? T.fg : T.faint} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
        <text style={{ color: T.faint, fontSize: 11.5 }}>{nameOf(sym)}</text>
        <text style={{ color: T.faint, fontSize: 11.5 }}>·</text>
        <text testId="tf" style={{ color: T.faint, fontSize: 11.5 }}>
          {tf}
        </text>
      </div>
    </div>
  )
}

function SearchButton({ compact, onClick }: { compact: boolean; onClick: () => void }) {
  const [hot, setHot] = useState(false)
  return (
    <div testId="search" onClick={onClick} onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 28, paddingLeft: 9, paddingRight: 6, marginRight: 4, borderRadius: 7, backgroundColor: hot ? T.raised : T.panel, borderWidth: 1, borderColor: T.border, cursor: 'pointer', flexShrink: 0, width: compact ? undefined : 190 }}>
      <Icon name="search" size={14} color={T.dim} />
      {!compact ? <text style={{ color: T.faint, fontSize: 12.5, flexGrow: 1 }}>Search</text> : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 4, backgroundColor: T.raised, borderWidth: 1, borderColor: T.border }}>
        <text style={{ color: T.dim, fontSize: 10, fontFamily: MONO }}>/</text>
      </div>
    </div>
  )
}

function PaneRow(props: { id: string; w: number; h: number; handlers: Handlers; draw: (cv: Canvas) => void; drawKey: unknown[]; axis: React.ReactNode; children?: React.ReactNode }) {
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

function Crosshair({ hover, pane, f, idx, h }: { hover: Hover; pane: string; f: Frame; idx: number | null; h: number }) {
  if (!hover || idx == null) return null
  const x = Math.round(xOf(f, idx))
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: 0, width: 1, height: h, backgroundColor: '#f0f3f640', pointerEvents: 'none' }} />
      {hover.pane === pane ? <div testId={`cross-${pane}`} style={{ position: 'absolute', left: 0, top: Math.round(hover.y), width: f.w, height: 1, backgroundColor: '#f0f3f640', pointerEvents: 'none' }} /> : null}
    </>
  )
}

function AxisLabel({ y, text }: { y: number; text: string }) {
  return <text style={{ position: 'absolute', left: 10, top: y - 8, color: T.faint, fontSize: 11, fontFamily: MONO }}>{text}</text>
}

function AxisTag({ y, text, color, testId }: { y: number; text: string; color: string; testId?: string }) {
  return (
    <div testId={testId} style={{ position: 'absolute', left: 4, top: y - 10, width: AXIS_W - 8, height: 20, borderRadius: 5, backgroundColor: color, display: 'flex', alignItems: 'center', paddingLeft: 6 }}>
      <text style={{ color: T.bg, fontSize: 11, fontFamily: MONO, fontWeight: 600 }}>{text}</text>
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

export { INDICATORS }
