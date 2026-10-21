import { describe, expect, it } from 'bun:test'
import { binanceSymbol, dedupe, parseBinanceKlines, resample, sampleBars } from '../src/data/feed'
import { normalizeSymbol, parseTimeframe } from '../src/types'

describe('symbols and timeframes', () => {
  it('normalizes symbols', () => {
    expect(normalizeSymbol('btc-usd')).toBe('BTC-USD')
    expect(normalizeSymbol('eth/usd')).toBe('ETH-USD')
    expect(normalizeSymbol('SOLUSDT')).toBe('SOL-USD')
    expect(binanceSymbol('BTC-USD')).toBe('BTCUSDT')
  })
  it('parses timeframes', () => {
    expect(parseTimeframe('1h')).toBe('1h')
    expect(parseTimeframe('1d')).toBe('1D')
    expect(parseTimeframe('4H')).toBe('4h')
    expect(parseTimeframe('BTC')).toBeNull()
  })
})

describe('bars', () => {
  it('parses Binance kline rows', () => {
    const rows = [[1_700_000_000_000, '1', '3', '0.5', '2', '10', 1_700_003_599_999, '0', 0, '0', '0', '0']]
    expect(parseBinanceKlines(rows)).toEqual([{ t: 1_700_000_000, o: 1, h: 3, l: 0.5, c: 2, v: 10 }])
  })
  it('dedupes and sorts by time', () => {
    const b = (t: number, c: number) => ({ t, o: c, h: c, l: c, c, v: 1 })
    expect(dedupe([b(3, 1), b(1, 1), b(3, 2)]).map((x) => [x.t, x.c])).toEqual([[1, 1], [3, 2]])
  })
  it('resamples 1h into 4h with OHLCV aggregation', () => {
    const base = 1_700_006_400 // aligned to 4h
    const h = [1, 2, 3, 4, 5].map((c, i) => ({ t: base + i * 3600, o: c, h: c + 1, l: c - 1, c: c + 0.5, v: 2 }))
    const r = resample(h, '4h')
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ t: base, o: 1, h: 5, l: 0, c: 4.5, v: 8 })
    expect(r[1]!.o).toBe(5)
  })
  it('sample data is deterministic and valid OHLC', () => {
    const a = sampleBars('BTC-USD', '1h', 500)
    expect(sampleBars('BTC-USD', '1h', 500)).toEqual(a)
    expect(a).toHaveLength(500)
    for (const b of a) {
      expect(b.h).toBeGreaterThanOrEqual(Math.max(b.o, b.c))
      expect(b.l).toBeLessThanOrEqual(Math.min(b.o, b.c))
    }
  })
})
