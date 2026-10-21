import type { Bar } from './types'

/** NaN where the indicator is still warming up. */
export type Line = Float64Array

const nanArr = (n: number) => new Float64Array(n).fill(NaN)

export function closes(bars: Bar[]): Float64Array {
  const out = new Float64Array(bars.length)
  for (let i = 0; i < bars.length; i++) out[i] = bars[i]!.c
  return out
}

export function sma(src: ArrayLike<number>, n: number): Line {
  const out = nanArr(src.length)
  let sum = 0
  let count = 0
  for (let i = 0; i < src.length; i++) {
    const v = src[i]!
    if (Number.isNaN(v)) {
      sum = 0
      count = 0
      continue
    }
    sum += v
    count++
    if (count > n) {
      sum -= src[i - n]!
      count = n
    }
    if (count === n) out[i] = sum / n
  }
  return out
}

/** EMA seeded with the SMA of the first n values (TA-Lib convention). */
export function ema(src: ArrayLike<number>, n: number): Line {
  return smoothed(src, n, 2 / (n + 1))
}

/** Wilder's moving average (RMA), alpha = 1/n, SMA seed. */
export function rma(src: ArrayLike<number>, n: number): Line {
  return smoothed(src, n, 1 / n)
}

function smoothed(src: ArrayLike<number>, n: number, k: number): Line {
  const out = nanArr(src.length)
  let start = 0
  while (start < src.length && Number.isNaN(src[start]!)) start++
  if (start + n > src.length) return out
  let seed = 0
  for (let i = start; i < start + n; i++) seed += src[i]!
  let prev = seed / n
  out[start + n - 1] = prev
  for (let i = start + n; i < src.length; i++) {
    prev = src[i]! * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function wma(src: ArrayLike<number>, n: number): Line {
  const out = nanArr(src.length)
  const denom = (n * (n + 1)) / 2
  for (let i = n - 1; i < src.length; i++) {
    let s = 0
    for (let j = 0; j < n; j++) s += src[i - j]! * (n - j)
    out[i] = s / denom
  }
  return out
}

export function stdev(src: ArrayLike<number>, n: number): Line {
  const out = nanArr(src.length)
  for (let i = n - 1; i < src.length; i++) {
    let m = 0
    for (let j = 0; j < n; j++) m += src[i - j]!
    m /= n
    let v = 0
    for (let j = 0; j < n; j++) v += (src[i - j]! - m) ** 2
    out[i] = Math.sqrt(v / n)
  }
  return out
}

export function bollinger(src: ArrayLike<number>, n = 20, k = 2) {
  const mid = sma(src, n)
  const sd = stdev(src, n)
  const upper = nanArr(src.length)
  const lower = nanArr(src.length)
  for (let i = 0; i < src.length; i++) {
    upper[i] = mid[i]! + k * sd[i]!
    lower[i] = mid[i]! - k * sd[i]!
  }
  return { mid, upper, lower }
}

/** Wilder RSI. */
export function rsi(src: ArrayLike<number>, n = 14): Line {
  const out = nanArr(src.length)
  if (src.length <= n) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= n; i++) {
    const d = src[i]! - src[i - 1]!
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= n
  loss /= n
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  for (let i = n + 1; i < src.length; i++) {
    const d = src[i]! - src[i - 1]!
    gain = (gain * (n - 1) + (d > 0 ? d : 0)) / n
    loss = (loss * (n - 1) + (d < 0 ? -d : 0)) / n
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  }
  return out
}

/** MACD with TA-Lib's seeding: the fast EMA starts on the same bar as the slow one. */
export function macd(src: ArrayLike<number>, fast = 12, slow = 26, signal = 9) {
  const lead = Float64Array.from(src)
  lead.fill(NaN, 0, Math.max(0, Math.min(lead.length, slow - fast)))
  const f = ema(lead, fast)
  const s = ema(src, slow)
  const line = nanArr(src.length)
  for (let i = 0; i < src.length; i++) line[i] = f[i]! - s[i]!
  const sig = ema(line, signal)
  const hist = nanArr(src.length)
  for (let i = 0; i < src.length; i++) hist[i] = line[i]! - sig[i]!
  return { line, signal: sig, hist }
}

export function trueRange(bars: Bar[]): Line {
  const out = new Float64Array(bars.length)
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const pc = i > 0 ? bars[i - 1]!.c : b.c
    out[i] = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc))
  }
  return out
}

/** Wilder ATR, seeded with the mean TR of bars 1..n (TA-Lib skips the first bar). */
export function atr(bars: Bar[], n = 14): Line {
  const tr = trueRange(bars)
  tr[0] = NaN
  return rma(tr, n)
}

export function donchian(bars: Bar[], n = 20) {
  const upper = nanArr(bars.length)
  const lower = nanArr(bars.length)
  const mid = nanArr(bars.length)
  for (let i = n - 1; i < bars.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - n + 1; j <= i; j++) {
      if (bars[j]!.h > hi) hi = bars[j]!.h
      if (bars[j]!.l < lo) lo = bars[j]!.l
    }
    upper[i] = hi
    lower[i] = lo
    mid[i] = (hi + lo) / 2
  }
  return { upper, lower, mid }
}

/** Session VWAP that resets at each UTC day boundary. */
export function vwap(bars: Bar[]): Line {
  const out = nanArr(bars.length)
  let pv = 0
  let vol = 0
  let day = -1
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const d = Math.floor(b.t / 86400)
    if (d !== day) {
      day = d
      pv = 0
      vol = 0
    }
    const tp = (b.h + b.l + b.c) / 3
    pv += tp * b.v
    vol += b.v
    out[i] = vol > 0 ? pv / vol : tp
  }
  return out
}

export function stochastic(bars: Bar[], k = 14, d = 3) {
  const kl = nanArr(bars.length)
  for (let i = k - 1; i < bars.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - k + 1; j <= i; j++) {
      hi = Math.max(hi, bars[j]!.h)
      lo = Math.min(lo, bars[j]!.l)
    }
    kl[i] = hi === lo ? 50 : ((bars[i]!.c - lo) / (hi - lo)) * 100
  }
  return { k: kl, d: sma(kl, d) }
}

export function obv(bars: Bar[]): Line {
  const out = new Float64Array(bars.length)
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i]!.c - bars[i - 1]!.c
    out[i] = out[i - 1]! + (d > 0 ? bars[i]!.v : d < 0 ? -bars[i]!.v : 0)
  }
  return out
}

export function keltner(bars: Bar[], n = 20, mult = 2, atrN = 10) {
  const mid = ema(closes(bars), n)
  const a = atr(bars, atrN)
  const upper = nanArr(bars.length)
  const lower = nanArr(bars.length)
  for (let i = 0; i < bars.length; i++) {
    upper[i] = mid[i]! + mult * a[i]!
    lower[i] = mid[i]! - mult * a[i]!
  }
  return { mid, upper, lower }
}

export function supertrend(bars: Bar[], n = 10, mult = 3) {
  const a = atr(bars, n)
  const line = nanArr(bars.length)
  const dir = new Int8Array(bars.length)
  let upper = NaN
  let lower = NaN
  let trend = 1
  for (let i = 0; i < bars.length; i++) {
    if (Number.isNaN(a[i]!)) continue
    const b = bars[i]!
    const hl2 = (b.h + b.l) / 2
    const bu = hl2 + mult * a[i]!
    const bl = hl2 - mult * a[i]!
    const pc = bars[i - 1]?.c ?? b.c
    upper = Number.isNaN(upper) || bu < upper || pc > upper ? bu : upper
    lower = Number.isNaN(lower) || bl > lower || pc < lower ? bl : lower
    if (trend === 1 && b.c < lower) trend = -1
    else if (trend === -1 && b.c > upper) trend = 1
    line[i] = trend === 1 ? lower : upper
    dir[i] = trend
  }
  return { line, dir }
}

export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = []
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const c = (b.o + b.h + b.l + b.c) / 4
    const o = i === 0 ? (b.o + b.c) / 2 : (out[i - 1]!.o + out[i - 1]!.c) / 2
    out.push({ t: b.t, o, c, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), v: b.v })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Registry + plugin API: an indicator is `(bars, params) => series[]`.

export type SeriesStyle = 'line' | 'histogram' | 'band-upper' | 'band-lower' | 'dots'
export type Series = { name: string; values: ArrayLike<number>; color: string; style?: SeriesStyle; width?: number }
export type IndicatorFn = (bars: Bar[], params: Record<string, number>) => Series[]
export type IndicatorDef = {
  id: string
  label: string
  pane: 'overlay' | 'own'
  params: Record<string, number>
  fn: IndicatorFn
  /** Fixed y range for oscillators (RSI 0..100) */
  range?: [number, number]
  levels?: number[]
}

export const C = {
  blue: '#71b7ff',
  green: '#26cd4d',
  red: '#ff9492',
  yellow: '#f0b72f',
  cyan: '#39c5cf',
  orange: '#ffb757',
  grey: '#9ea7b3',
  white: '#d9dee3',
}

export const INDICATORS: IndicatorDef[] = [
  { id: 'sma', label: 'SMA', pane: 'overlay', params: { length: 50 }, fn: (b, p) => [{ name: `SMA ${p.length}`, values: sma(closes(b), p.length!), color: C.yellow }] },
  { id: 'ema', label: 'EMA', pane: 'overlay', params: { length: 21 }, fn: (b, p) => [{ name: `EMA ${p.length}`, values: ema(closes(b), p.length!), color: C.cyan }] },
  {
    id: 'bb',
    label: 'BB',
    pane: 'overlay',
    params: { length: 20, mult: 2 },
    fn: (b, p) => {
      const bb = bollinger(closes(b), p.length!, p.mult!)
      return [
        { name: 'BB upper', values: bb.upper, color: C.blue, style: 'band-upper' },
        { name: 'BB lower', values: bb.lower, color: C.blue, style: 'band-lower' },
        { name: 'BB basis', values: bb.mid, color: '#71b7ff88', width: 0.8 },
      ]
    },
  },
  { id: 'vwap', label: 'VWAP', pane: 'overlay', params: {}, fn: (b) => [{ name: 'VWAP', values: vwap(b), color: C.orange }] },
  {
    id: 'st',
    label: 'SuperTrend',
    pane: 'overlay',
    params: { length: 10, mult: 3 },
    fn: (b, p) => {
      const st = supertrend(b, p.length!, p.mult!)
      const up = new Float64Array(b.length).fill(NaN)
      const dn = new Float64Array(b.length).fill(NaN)
      for (let i = 0; i < b.length; i++) (st.dir[i] === 1 ? up : dn)[i] = st.line[i]!
      return [
        { name: 'ST up', values: up, color: C.green },
        { name: 'ST down', values: dn, color: C.red },
      ]
    },
  },
  {
    id: 'donchian',
    label: 'Donchian',
    pane: 'overlay',
    params: { length: 20 },
    fn: (b, p) => {
      const d = donchian(b, p.length!)
      return [
        { name: 'DC upper', values: d.upper, color: '#39c5cfaa', width: 0.9 },
        { name: 'DC lower', values: d.lower, color: '#39c5cfaa', width: 0.9 },
      ]
    },
  },
  { id: 'rsi', label: 'RSI', pane: 'own', params: { length: 14 }, range: [0, 100], levels: [30, 70], fn: (b, p) => [{ name: `RSI ${p.length}`, values: rsi(closes(b), p.length!), color: C.yellow }] },
  {
    id: 'macd',
    label: 'MACD',
    pane: 'own',
    params: { fast: 12, slow: 26, signal: 9 },
    levels: [0],
    fn: (b, p) => {
      const m = macd(closes(b), p.fast!, p.slow!, p.signal!)
      return [
        { name: 'Hist', values: m.hist, color: C.green, style: 'histogram' },
        { name: 'MACD', values: m.line, color: C.blue },
        { name: 'Signal', values: m.signal, color: C.orange },
      ]
    },
  },
  {
    id: 'stoch',
    label: 'Stoch',
    pane: 'own',
    params: { k: 14, d: 3 },
    range: [0, 100],
    levels: [20, 80],
    fn: (b, p) => {
      const s = stochastic(b, p.k!, p.d!)
      return [
        { name: '%K', values: s.k, color: C.blue },
        { name: '%D', values: s.d, color: C.orange },
      ]
    },
  },
  { id: 'atr', label: 'ATR', pane: 'own', params: { length: 14 }, fn: (b, p) => [{ name: `ATR ${p.length}`, values: atr(b, p.length!), color: C.cyan }] },
  { id: 'obv', label: 'OBV', pane: 'own', params: {}, fn: (b) => [{ name: 'OBV', values: obv(b), color: C.grey }] },
]

export function registerIndicator(def: IndicatorDef) {
  const i = INDICATORS.findIndex((d) => d.id === def.id)
  if (i >= 0) INDICATORS[i] = def
  else INDICATORS.push(def)
}

export function findIndicator(id: string) {
  return INDICATORS.find((d) => d.id === id)
}
