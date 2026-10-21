export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number }

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1D', '1W'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

export const TF_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
  '1W': 604800,
}

export function parseTimeframe(s: string): Timeframe | null {
  const m = s.trim()
  const hit = TIMEFRAMES.find((t) => t.toLowerCase() === m.toLowerCase())
  if (hit) return hit
  const alias: Record<string, Timeframe> = { '60m': '1h', '240m': '4h', d: '1D', '1d': '1D', w: '1W', '1w': '1W', '24h': '1D' }
  return alias[m.toLowerCase()] ?? null
}

/** BTC-USD, btc/usd, BTCUSDT → BTC-USD */
export function normalizeSymbol(s: string): string {
  const u = s.trim().toUpperCase().replace('/', '-').replace('_', '-')
  if (u.includes('-')) return u
  for (const q of ['USDT', 'USDC', 'USD', 'EUR', 'BTC']) if (u.endsWith(q) && u.length > q.length) return `${u.slice(0, -q.length)}-${q === 'USDT' ? 'USD' : q}`
  return `${u}-USD`
}
