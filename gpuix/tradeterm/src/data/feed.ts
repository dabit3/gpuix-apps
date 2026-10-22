import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TF_SECONDS, type Bar, type Timeframe } from '../types'

export type Source = 'binance' | 'coinbase' | 'hyperliquid' | 'cache' | 'sample'
/** 'auto' tries Binance, then Coinbase, then Hyperliquid; 'hyperliquid' goes to Hyperliquid first. */
export type Exchange = 'auto' | 'hyperliquid' | 'binance'
export type Loaded = { bars: Bar[]; source: Source; note?: string }

/** Read on every call so tests (and TRADETERM_HOME set after import) never touch ~/.tradeterm. */
export const home = () => process.env.TRADETERM_HOME ?? join(homedir(), '.tradeterm')

const BINANCE = process.env.TRADETERM_BINANCE ?? 'https://data-api.binance.vision'
const BINANCE_WS = process.env.TRADETERM_BINANCE_WS ?? 'wss://data-stream.binance.vision'
const COINBASE = 'https://api.exchange.coinbase.com'
const HYPERLIQUID = process.env.TRADETERM_HYPERLIQUID ?? 'https://api.hyperliquid.xyz'
const HYPERLIQUID_WS = process.env.TRADETERM_HYPERLIQUID_WS ?? 'wss://api.hyperliquid.xyz/ws'
const HL_TF: Record<Timeframe, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1D': '1d', '1W': '1w' }
const BINANCE_TF: Record<Timeframe, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1D': '1d', '1W': '1w' }
const COINBASE_TF: Partial<Record<Timeframe, number>> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1D': 86400 }

/** BTC-USD → BTCUSDT (Binance quotes USD pairs in USDT). */
export function binanceSymbol(sym: string) {
  const [base, quote = 'USD'] = sym.split('-')
  return `${base}${quote === 'USD' ? 'USDT' : quote}`
}

async function getJson(url: string, timeoutMs = 6000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'tradeterm/0.1' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

/** BTC-USD → BTC (Hyperliquid perps are named by base coin and settle in USD). */
export function hyperliquidCoin(sym: string) {
  return sym.split('-')[0]!
}

async function postJson(url: string, body: unknown, timeoutMs = 6000): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), headers: { 'content-type': 'application/json', 'user-agent': 'tradeterm/0.1' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

type HlCandle = { t: number; o: string; h: string; l: string; c: string; v: string }
export function parseHyperliquidCandles(rows: unknown): Bar[] {
  if (!Array.isArray(rows)) throw new Error('unexpected candleSnapshot payload')
  return (rows as HlCandle[]).map((r) => ({ t: Math.floor(Number(r.t) / 1000), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v }))
}

/** Hyperliquid's public info endpoint serves the most recent 5000 candles per coin and interval. */
async function fromHyperliquid(sym: string, tf: Timeframe, count: number): Promise<Bar[]> {
  const now = Date.now()
  // Clamp at the epoch: 3000 weekly bars would otherwise ask for a negative start time, which the API rejects.
  const startTime = Math.max(0, now - Math.min(count, 5000) * TF_SECONDS[tf] * 1000)
  const rows = await postJson(`${HYPERLIQUID}/info`, { type: 'candleSnapshot', req: { coin: hyperliquidCoin(sym), interval: HL_TF[tf], startTime, endTime: now } })
  return dedupe(parseHyperliquidCandles(rows))
}

export function parseBinanceKlines(rows: unknown): Bar[] {
  if (!Array.isArray(rows)) throw new Error('unexpected klines payload')
  return rows.map((r: unknown[]) => ({ t: Math.floor(Number(r[0]) / 1000), o: +String(r[1]), h: +String(r[2]), l: +String(r[3]), c: +String(r[4]), v: +String(r[5]) }))
}

async function fromBinance(sym: string, tf: Timeframe, count: number): Promise<Bar[]> {
  const step = TF_SECONDS[tf]
  const now = Math.floor(Date.now() / 1000)
  const start = now - step * count
  const pages = Math.ceil(count / 1000)
  const reqs: Promise<Bar[]>[] = []
  for (let p = 0; p < pages; p++) {
    const from = (start + p * 1000 * step) * 1000
    reqs.push(getJson(`${BINANCE}/api/v3/klines?symbol=${binanceSymbol(sym)}&interval=${BINANCE_TF[tf]}&startTime=${from}&limit=1000`).then(parseBinanceKlines))
  }
  return dedupe((await Promise.all(reqs)).flat())
}

async function fromCoinbase(sym: string, tf: Timeframe, count: number): Promise<Bar[]> {
  const g = COINBASE_TF[tf]
  if (!g) throw new Error(`coinbase has no ${tf} candles`)
  const pages = Math.min(20, Math.ceil(count / 300))
  const now = Math.floor(Date.now() / 1000)
  const reqs: Promise<Bar[]>[] = []
  for (let p = 0; p < pages; p++) {
    const end = now - p * 300 * g
    const start = end - 300 * g
    reqs.push(
      getJson(`${COINBASE}/products/${sym}/candles?granularity=${g}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`).then((rows) =>
        (rows as number[][]).map((r) => ({ t: r[0]!, l: r[1]!, h: r[2]!, o: r[3]!, c: r[4]!, v: r[5]! })),
      ),
    )
  }
  return dedupe((await Promise.all(reqs)).flat())
}

export function dedupe(bars: Bar[]): Bar[] {
  const m = new Map<number, Bar>()
  for (const b of bars) m.set(b.t, b)
  return [...m.values()].sort((a, b) => a.t - b.t)
}

function cachePath(sym: string, tf: Timeframe) {
  return join(home(), 'cache', `${sym}-${tf}.json`)
}

export async function loadBars(sym: string, tf: Timeframe, count = 3000, opts: { offline?: boolean; exchange?: Exchange } = {}): Promise<Loaded> {
  if (opts.offline || process.env.TRADETERM_OFFLINE === '1') return { bars: sampleBars(sym, tf, count), source: 'sample', note: 'offline sample data' }
  const errors: string[] = []
  const order: [Source, typeof fromBinance][] =
    opts.exchange === 'hyperliquid'
      ? [['hyperliquid', fromHyperliquid], ['binance', fromBinance], ['coinbase', fromCoinbase]]
      : [['binance', fromBinance], ['coinbase', fromCoinbase], ['hyperliquid', fromHyperliquid]]
  // A source with much less history than asked for (a coin Binance listed last month) is kept as a fallback
  // while the next source is tried; the longest series wins.
  let best: { bars: Bar[]; source: Source } | null = null
  for (const [source, fn] of order) {
    try {
      const bars = await fn(sym, tf, count)
      if (bars.length > 10) {
        if (!best || bars.length > best.bars.length) best = { bars, source }
        if (bars.length >= Math.min(count, 1000) * 0.9) break
        continue
      }
      errors.push(`${source}: empty`)
    } catch (e) {
      errors.push(`${source}: ${(e as Error).message}`)
    }
  }
  if (best) {
    try {
      mkdirSync(join(home(), 'cache'), { recursive: true })
      writeFileSync(cachePath(sym, tf), JSON.stringify(best.bars))
    } catch {}
    return best
  }
  try {
    const bars = JSON.parse(readFileSync(cachePath(sym, tf), 'utf8')) as Bar[]
    if (bars.length) return { bars, source: 'cache', note: errors.join(' · ') }
  } catch {}
  return { bars: sampleBars(sym, tf, count), source: 'sample', note: errors.join(' · ') }
}

type Tickers = Record<string, { last: number; change: number }>

async function binanceTickers(syms: string[]): Promise<Tickers> {
  const list = encodeURIComponent(JSON.stringify(syms.map(binanceSymbol)))
  const rows = (await getJson(`${BINANCE}/api/v3/ticker/24hr?symbols=${list}`, 5000)) as { symbol: string; lastPrice: string; priceChangePercent: string }[]
  const out: Tickers = {}
  for (const s of syms) {
    const r = rows.find((x) => x.symbol === binanceSymbol(s))
    if (r) out[s] = { last: +r.lastPrice, change: +r.priceChangePercent / 100 }
  }
  return out
}

/** Mid price and change vs the previous day's price for every Hyperliquid perp, in one request. */
export function parseHyperliquidCtxs(payload: unknown, syms: string[]): Tickers {
  const [meta, ctxs] = payload as [{ universe: { name: string }[] }, { midPx?: string | null; markPx: string; prevDayPx: string }[]]
  const out: Tickers = {}
  for (const s of syms) {
    const i = meta.universe.findIndex((u) => u.name === hyperliquidCoin(s))
    const c = ctxs[i]
    if (i < 0 || !c) continue
    const last = +(c.midPx ?? c.markPx)
    out[s] = { last, change: last / +c.prevDayPx - 1 }
  }
  return out
}

async function hyperliquidTickers(syms: string[]): Promise<Tickers> {
  return parseHyperliquidCtxs(await postJson(`${HYPERLIQUID}/info`, { type: 'metaAndAssetCtxs' }, 5000), syms)
}

/** Last price and 24h change for a watchlist. Binance answers all-or-nothing, so unknown pairs are retried one by one and the rest come from Hyperliquid. */
export async function loadTickers(syms: string[], exchange: Exchange = 'auto'): Promise<Tickers> {
  if (exchange === 'hyperliquid') {
    const hl = await hyperliquidTickers(syms).catch(() => ({}) as Tickers)
    const missing = syms.filter((s) => !hl[s])
    return missing.length ? { ...(await binanceTickers(missing).catch(() => ({}))), ...hl } : hl
  }
  let out: Tickers
  try {
    out = await binanceTickers(syms)
  } catch {
    const each = await Promise.all(syms.map((s) => binanceTickers([s]).catch(() => ({}) as Tickers)))
    out = Object.assign({}, ...each)
  }
  const missing = syms.filter((s) => !out[s])
  if (missing.length) Object.assign(out, await hyperliquidTickers(missing).catch(() => ({})))
  return out
}

/** Streams the forming candle. Returns a stop function. */
export function streamKlines(sym: string, tf: Timeframe, onBar: (b: Bar, closed: boolean) => void, source: Source = 'binance'): () => void {
  if (process.env.TRADETERM_OFFLINE === '1' || typeof WebSocket === 'undefined') return () => {}
  let ws: WebSocket | null = null
  let stopped = false
  let retry: ReturnType<typeof setTimeout> | undefined
  const hl = source === 'hyperliquid'
  const connect = () => {
    if (hl) {
      const sock = new WebSocket(HYPERLIQUID_WS)
      ws = sock
      sock.onopen = () => sock.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin: hyperliquidCoin(sym), interval: HL_TF[tf] } }))
      sock.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data))
          if (m.channel === 'candle' && m.data) onBar(parseHyperliquidCandles([m.data])[0]!, Date.now() > Number(m.data.T))
        } catch {}
      }
    } else {
      ws = new WebSocket(`${BINANCE_WS}/ws/${binanceSymbol(sym).toLowerCase()}@kline_${BINANCE_TF[tf]}`)
      ws.onmessage = (ev) => {
        try {
          const k = JSON.parse(String(ev.data)).k
          if (k) onBar({ t: Math.floor(k.t / 1000), o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }, !!k.x)
        } catch {}
      }
    }
    ws.onclose = () => {
      if (!stopped) retry = setTimeout(connect, 3000)
    }
    ws.onerror = () => ws?.close()
  }
  connect()
  return () => {
    stopped = true
    clearTimeout(retry)
    ws?.close()
  }
}

// ---------------------------------------------------------------------------------------------
// Offline sample data: a seeded random walk with volatility regimes and trends. Clearly labelled
// SAMPLE in the UI; it is not real market data.

const BASE_PRICE: Record<string, number> = { BTC: 64000, ETH: 3100, SOL: 150, HYPE: 40, AAVE: 160, DOGE: 0.14, XRP: 0.55, ADA: 0.45, AVAX: 28, LINK: 14 }

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sampleBars(sym: string, tf: Timeframe, count = 3000, endTime = Math.floor(Date.UTC(2026, 9, 1) / 1000)): Bar[] {
  const r = rng(hash(`${sym}:${tf}`))
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  const step = TF_SECONDS[tf]
  const scale = Math.sqrt(step / 3600)
  let price = BASE_PRICE[sym.split('-')[0]!] ?? 100
  let vol = 0.006 * scale
  let drift = 0
  const bars: Bar[] = []
  const t0 = Math.floor(endTime / step) * step - step * (count - 1)
  for (let i = 0; i < count; i++) {
    if (r() < 0.01) drift = (r() - 0.5) * 0.0016 * scale
    vol = Math.min(0.03 * scale, Math.max(0.002 * scale, vol * (1 + gauss() * 0.06)))
    const o = price
    const c = o * Math.exp(drift + vol * gauss())
    const wick = vol * o
    const h = Math.max(o, c) + Math.abs(gauss()) * wick * 0.6
    const l = Math.min(o, c) - Math.abs(gauss()) * wick * 0.6
    const v = (800 + 4000 * r()) * (vol / (0.006 * scale)) * scale
    bars.push({ t: t0 + i * step, o, h, l, c, v })
    price = c
  }
  return bars
}

/** Aggregates bars into a coarser timeframe aligned to UTC boundaries (weeks start Monday). */
export function resample(bars: Bar[], tf: Timeframe): Bar[] {
  const step = TF_SECONDS[tf]
  const offset = tf === '1W' ? 4 * 86400 : 0 // the Unix epoch was a Thursday
  const out: Bar[] = []
  for (const b of bars) {
    const t = Math.floor((b.t - offset) / step) * step + offset
    const last = out.at(-1)
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h)
      last.l = Math.min(last.l, b.l)
      last.c = b.c
      last.v += b.v
    } else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })
  }
  return out
}
