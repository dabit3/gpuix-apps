import { closes, donchian, rsi, sma } from './indicators'
import type { Bar } from './types'

export type Side = 'buy' | 'sell'
export type OrderType = 'market' | 'limit' | 'stop'
export type Order = { side: Side; type: OrderType; price?: number; pct?: number }

export type Trade = {
  entryIndex: number
  exitIndex: number
  entryTime: number
  exitTime: number
  entryPrice: number
  exitPrice: number
  qty: number
  pnl: number
  pnlPct: number
  fees: number
}

export type Ctx = {
  /** Index of the bar that just closed. Strategies only ever see bars[0..i]. */
  i: number
  bar: Bar
  bars: Bar[]
  position: number
  equity: number
  cash: number
  buy(o?: Partial<Omit<Order, 'side'>>): void
  sell(o?: Partial<Omit<Order, 'side'>>): void
  close(): void
}

export type Strategy = {
  id: string
  label: string
  params: Record<string, number>
  /** Called once with the full history so indicators can be precomputed; values at index i only use bars ≤ i. */
  init?(bars: Bar[], params: Record<string, number>): void
  onBar(ctx: Ctx, params: Record<string, number>): void
}

export type Sizing = { mode: 'percent'; pct: number } | { mode: 'fixed'; qty: number } | { mode: 'volTarget'; annualVol: number; lookback: number }

export type BacktestOptions = {
  capital?: number
  feeBps?: number
  slippageBps?: number
  sizing?: Sizing
  /** 'nextOpen' (default): signals on close, fills at the next bar's open. 'close': fill at the signal bar's close. */
  fill?: 'nextOpen' | 'close'
  barsPerYear?: number
}

export type Metrics = {
  totalReturn: number
  cagr: number
  sharpe: number
  sortino: number
  maxDrawdown: number
  maxDrawdownBars: number
  winRate: number
  profitFactor: number
  exposure: number
  trades: number
  finalEquity: number
  fees: number
}

export type BacktestResult = { equity: Float64Array; drawdown: Float64Array; trades: Trade[]; metrics: Metrics; inPosition: Uint8Array }

export function runBacktest(bars: Bar[], strategy: Strategy, params: Record<string, number> = strategy.params, opts: BacktestOptions = {}): BacktestResult {
  const capital = opts.capital ?? 10_000
  const fee = (opts.feeBps ?? 10) / 10_000
  const slip = (opts.slippageBps ?? 5) / 10_000
  const sizing = opts.sizing ?? { mode: 'percent', pct: 1 }
  const fillMode = opts.fill ?? 'nextOpen'
  const n = bars.length
  const equity = new Float64Array(n)
  const inPosition = new Uint8Array(n)
  const trades: Trade[] = []
  let cash = capital
  let qty = 0
  let entry: { index: number; price: number; fees: number; cost: number } | null = null
  let pending: Order | null = null
  let totalFees = 0
  strategy.init?.(bars, params)

  const fillAt = (o: Order, i: number, ref: number) => {
    const b = bars[i]!
    let px = ref
    if (o.type === 'limit' && o.price != null) {
      if (o.side === 'buy' ? b.l > o.price : b.h < o.price) return false
      px = o.side === 'buy' ? Math.min(ref, o.price) : Math.max(ref, o.price)
    } else if (o.type === 'stop' && o.price != null) {
      if (o.side === 'buy' ? b.h < o.price : b.l > o.price) return false
      px = o.side === 'buy' ? Math.max(ref, o.price) : Math.min(ref, o.price)
    }
    px *= o.side === 'buy' ? 1 + slip : 1 - slip
    if (o.side === 'buy' && qty === 0) {
      const eq = cash
      let q: number
      if (sizing.mode === 'fixed') q = sizing.qty
      else if (sizing.mode === 'volTarget') {
        const vol = realizedVol(bars, i, sizing.lookback, opts.barsPerYear ?? barsPerYearOf(bars))
        q = ((eq * Math.min(1, vol > 0 ? sizing.annualVol / vol : 1)) / px) / (1 + fee)
      } else q = ((eq * (o.pct ?? sizing.pct)) / px) / (1 + fee)
      q = Math.min(q, cash / (px * (1 + fee)))
      if (!(q > 0)) return true
      const f = q * px * fee
      cash -= q * px + f
      totalFees += f
      qty = q
      entry = { index: i, price: px, fees: f, cost: q * px + f }
    } else if (o.side === 'sell' && qty > 0 && entry) {
      const f = qty * px * fee
      const proceeds = qty * px - f
      cash += proceeds
      totalFees += f
      trades.push({
        entryIndex: entry.index,
        exitIndex: i,
        entryTime: bars[entry.index]!.t,
        exitTime: b.t,
        entryPrice: entry.price,
        exitPrice: px,
        qty,
        pnl: proceeds - entry.cost,
        pnlPct: proceeds / entry.cost - 1,
        fees: entry.fees + f,
      })
      qty = 0
      entry = null
    }
    return true
  }

  for (let i = 0; i < n; i++) {
    const b = bars[i]!
    if (pending && fillMode === 'nextOpen') {
      const done = fillAt(pending, i, b.o)
      if (done || pending.type === 'market') pending = null
    }
    equity[i] = cash + qty * b.c
    const queue: Order[] = []
    const ctx: Ctx = {
      i,
      bar: b,
      bars,
      position: qty,
      equity: equity[i]!,
      cash,
      buy: (o) => queue.push({ side: 'buy', type: o?.type ?? 'market', price: o?.price, pct: o?.pct }),
      sell: (o) => queue.push({ side: 'sell', type: o?.type ?? 'market', price: o?.price }),
      close: () => queue.push({ side: 'sell', type: 'market' }),
    }
    if (i < n - 1) strategy.onBar(ctx, params)
    const o = queue.at(-1)
    if (o) {
      if (fillMode === 'close') {
        fillAt({ ...o, type: 'market' }, i, b.c)
        equity[i] = cash + qty * b.c
      } else pending = o
    }
    inPosition[i] = qty > 0 ? 1 : 0
  }
  // Close any open position at the last close so metrics count it.
  if (qty > 0 && n > 0) {
    fillAt({ side: 'sell', type: 'market' }, n - 1, bars[n - 1]!.c)
    equity[n - 1] = cash
  }

  const drawdown = new Float64Array(n)
  let peak = -Infinity
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, equity[i]!)
    drawdown[i] = peak > 0 ? equity[i]! / peak - 1 : 0
  }
  return { equity, drawdown, trades, inPosition, metrics: computeMetrics(bars, equity, trades, inPosition, capital, totalFees, opts.barsPerYear) }
}

export function barsPerYearOf(bars: Bar[]): number {
  if (bars.length < 2) return 365
  const step = (bars.at(-1)!.t - bars[0]!.t) / (bars.length - 1)
  return (365 * 86400) / Math.max(1, step)
}

function realizedVol(bars: Bar[], i: number, lookback: number, bpy: number) {
  const from = Math.max(1, i - lookback)
  const r: number[] = []
  for (let k = from; k < i; k++) r.push(Math.log(bars[k]!.c / bars[k - 1]!.c))
  if (r.length < 2) return 0
  const m = r.reduce((a, b) => a + b, 0) / r.length
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)
  return Math.sqrt(v * bpy)
}

export function computeMetrics(bars: Bar[], equity: Float64Array, trades: Trade[], inPos: Uint8Array, capital: number, fees: number, bpyOpt?: number): Metrics {
  const n = equity.length
  const bpy = bpyOpt ?? barsPerYearOf(bars)
  const final = n ? equity[n - 1]! : capital
  const totalReturn = final / capital - 1
  const years = n > 1 ? (bars[n - 1]!.t - bars[0]!.t) / (365 * 86400) : 0
  const cagr = years > 0 && final > 0 ? (final / capital) ** (1 / years) - 1 : 0
  const rets: number[] = []
  for (let i = 1; i < n; i++) rets.push(equity[i]! / equity[i - 1]! - 1)
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0
  const downside = rets.length ? Math.sqrt(rets.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / rets.length) : 0
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(bpy) : 0
  const sortino = downside > 0 ? (mean / downside) * Math.sqrt(bpy) : 0
  let peak = -Infinity
  let peakAt = 0
  let maxDd = 0
  let maxDdBars = 0
  for (let i = 0; i < n; i++) {
    if (equity[i]! >= peak) {
      peak = equity[i]!
      peakAt = i
    }
    const dd = equity[i]! / peak - 1
    if (dd < maxDd) maxDd = dd
    if (i - peakAt > maxDdBars) maxDdBars = i - peakAt
  }
  const wins = trades.filter((t) => t.pnl > 0)
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0)
  const grossLoss = -trades.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0)
  let held = 0
  for (let i = 0; i < n; i++) held += inPos[i]!
  return {
    totalReturn,
    cagr,
    sharpe,
    sortino,
    maxDrawdown: maxDd,
    maxDrawdownBars: maxDdBars,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    exposure: n ? held / n : 0,
    trades: trades.length,
    finalEquity: final,
    fees,
  }
}

// ---------------------------------------------------------------------------------------------
// Example strategies

const crossUp = (a: ArrayLike<number>, b: ArrayLike<number>, i: number) => i > 0 && a[i - 1]! <= b[i - 1]! && a[i]! > b[i]!
const crossDown = (a: ArrayLike<number>, b: ArrayLike<number>, i: number) => i > 0 && a[i - 1]! >= b[i - 1]! && a[i]! < b[i]!

function smaCross(): Strategy {
  let f: Float64Array = new Float64Array()
  let s: Float64Array = new Float64Array()
  return {
    id: 'sma',
    label: 'SMA cross',
    params: { fast: 20, slow: 50 },
    init(bars, p) {
      const c = closes(bars)
      f = sma(c, p.fast!)
      s = sma(c, p.slow!)
    },
    onBar(ctx) {
      if (ctx.position === 0 && crossUp(f, s, ctx.i)) ctx.buy()
      else if (ctx.position > 0 && crossDown(f, s, ctx.i)) ctx.close()
    },
  }
}

function rsiReversion(): Strategy {
  let r: Float64Array = new Float64Array()
  return {
    id: 'rsi',
    label: 'RSI reversion',
    params: { length: 14, lower: 30, exit: 55 },
    init(bars, p) {
      r = rsi(closes(bars), p.length!)
    },
    onBar(ctx, p) {
      const v = r[ctx.i]!
      if (ctx.position === 0 && v < p.lower!) ctx.buy()
      else if (ctx.position > 0 && v > p.exit!) ctx.close()
    },
  }
}

function donchianBreakout(): Strategy {
  let entry = { upper: new Float64Array(), lower: new Float64Array() }
  let exit = { upper: new Float64Array(), lower: new Float64Array() }
  return {
    id: 'donchian',
    label: 'Donchian breakout',
    params: { entry: 20, exit: 10 },
    init(bars, p) {
      entry = donchian(bars, p.entry!)
      exit = donchian(bars, p.exit!)
    },
    onBar(ctx) {
      const i = ctx.i
      if (i < 1) return
      // Compare with the channel up to the previous bar so the breakout bar isn't part of its own channel.
      if (ctx.position === 0 && ctx.bar.c > entry.upper[i - 1]!) ctx.buy()
      else if (ctx.position > 0 && ctx.bar.c < exit.lower[i - 1]!) ctx.close()
    },
  }
}

export const STRATEGIES: Strategy[] = [smaCross(), rsiReversion(), donchianBreakout()]
export const findStrategy = (id: string) => STRATEGIES.find((s) => s.id === id)

// ---------------------------------------------------------------------------------------------
// Parameter sweep (SMA fast × slow). In-sample only, which is exactly why the UI warns about overfitting.

export type SweepCell = { fast: number; slow: number; sharpe: number; ret: number; trades: number }
export type Sweep = { fasts: number[]; slows: number[]; cells: SweepCell[]; best: SweepCell | null }

export function sweepSma(bars: Bar[], opts: BacktestOptions = {}, fasts = [5, 10, 15, 20, 30, 40], slows = [30, 50, 75, 100, 150, 200]): Sweep {
  const s = smaCross()
  const cells: SweepCell[] = []
  for (const slow of slows)
    for (const fast of fasts) {
      if (fast >= slow) {
        cells.push({ fast, slow, sharpe: NaN, ret: NaN, trades: 0 })
        continue
      }
      const r = runBacktest(bars, s, { fast, slow }, opts)
      cells.push({ fast, slow, sharpe: r.metrics.sharpe, ret: r.metrics.totalReturn, trades: r.metrics.trades })
    }
  const valid = cells.filter((c) => Number.isFinite(c.sharpe) && c.trades > 0)
  const best = valid.length ? valid.reduce((a, b) => (b.sharpe > a.sharpe ? b : a)) : null
  return { fasts, slows, cells, best }
}

/** Walk-forward: optimise on each train window, report out-of-sample on the following test window. */
export function walkForward(bars: Bar[], folds = 4, opts: BacktestOptions = {}) {
  const size = Math.floor(bars.length / (folds + 1))
  const out: { train: [number, number]; test: [number, number]; best: SweepCell | null; oosReturn: number; oosSharpe: number }[] = []
  for (let k = 0; k < folds; k++) {
    const train = bars.slice(k * size, (k + 1) * size)
    const test = bars.slice((k + 1) * size, (k + 2) * size)
    const sw = sweepSma(train, opts)
    if (!sw.best) {
      out.push({ train: [k * size, (k + 1) * size], test: [(k + 1) * size, (k + 2) * size], best: null, oosReturn: 0, oosSharpe: 0 })
      continue
    }
    const r = runBacktest(test, smaCross(), { fast: sw.best.fast, slow: sw.best.slow }, opts)
    out.push({ train: [k * size, (k + 1) * size], test: [(k + 1) * size, (k + 2) * size], best: sw.best, oosReturn: r.metrics.totalReturn, oosSharpe: r.metrics.sharpe })
  }
  return out
}
