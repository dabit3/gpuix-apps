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

describe('Hyperliquid', () => {
  const { hyperliquidCoin, parseHyperliquidCandles, parseHyperliquidCtxs, loadBars, loadTickers } = require('../src/data/feed') as typeof import('../src/data/feed')
  const hlRow = (t: number, c: number) => ({ t: t * 1000, T: t * 1000 + 3599999, s: 'HYPE', i: '1h', o: String(c - 1), h: String(c + 1), l: String(c - 2), c: String(c), v: '1000', n: 5 })

  it('maps symbols to perp coins and parses candleSnapshot rows', () => {
    expect(hyperliquidCoin('HYPE-USD')).toBe('HYPE')
    expect(hyperliquidCoin('AAVE-USD')).toBe('AAVE')
    expect(parseHyperliquidCandles([hlRow(3600, 40)])).toEqual([{ t: 3600, o: 39, h: 41, l: 38, c: 40, v: 1000 }])
  })

  it('reads mid price and day change from metaAndAssetCtxs', () => {
    const payload = [{ universe: [{ name: 'BTC' }, { name: 'HYPE' }, { name: 'AAVE' }] }, [{ markPx: '1', prevDayPx: '1' }, { midPx: '44', markPx: '43.9', prevDayPx: '40' }, { midPx: null, markPx: '150', prevDayPx: '160' }]]
    const t = parseHyperliquidCtxs(payload, ['HYPE-USD', 'AAVE-USD', 'NOPE-USD'])
    expect(t['HYPE-USD']!.last).toBe(44)
    expect(t['HYPE-USD']!.change).toBeCloseTo(0.1, 10)
    expect(t['AAVE-USD']!.last).toBe(150)
    expect(t['AAVE-USD']!.change).toBeCloseTo(-0.0625, 10)
    expect(t['NOPE-USD']).toBeUndefined()
  })

  describe('routing (mocked network)', () => {
    const realFetch = globalThis.fetch
    const calls: string[] = []
    const hlBars = Array.from({ length: 50 }, (_, i) => hlRow(1_800_000_000 + i * 3600, 40 + i))
    const mock = (binanceOk: boolean) => {
      calls.length = 0
      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        const u = String(url)
        calls.push(u.includes('hyperliquid') ? `hl:${JSON.parse(String(init?.body)).type}` : u.includes('binance') ? 'binance' : 'other')
        if (u.includes('hyperliquid')) {
          const body = JSON.parse(String(init?.body))
          if (body.type === 'candleSnapshot') return Response.json(hlBars)
          return Response.json([{ universe: [{ name: 'HYPE' }] }, [{ midPx: '45', markPx: '45', prevDayPx: '50' }]])
        }
        if (u.includes('binance') && binanceOk && u.includes('ticker')) return Response.json([{ symbol: 'BTCUSDT', lastPrice: '80000', priceChangePercent: '1.5' }])
        return new Response('nope', { status: 400 })
      }) as typeof fetch
    }
    const env = process.env.TRADETERM_OFFLINE
    const restore = () => {
      globalThis.fetch = realFetch
      process.env.TRADETERM_OFFLINE = env
    }

    it('exchange "hyperliquid" asks Hyperliquid first and labels the source', async () => {
      mock(true)
      delete process.env.TRADETERM_OFFLINE
      try {
        const d = await loadBars('HYPE-USD', '1h', 50, { exchange: 'hyperliquid' })
        expect(d.source).toBe('hyperliquid')
        expect(d.bars.length).toBe(50)
        expect(calls[0]).toBe('hl:candleSnapshot')
      } finally {
        restore()
      }
    })

    it('auto falls through to Hyperliquid when Binance and Coinbase fail', async () => {
      mock(false)
      delete process.env.TRADETERM_OFFLINE
      try {
        const d = await loadBars('HYPE-USD', '1h', 50)
        expect(calls[0]).toBe('binance')
        expect(d.source).toBe('hyperliquid')
      } finally {
        restore()
      }
    })

    it('tickers: Binance answers what it can, Hyperliquid fills the rest', async () => {
      mock(true)
      try {
        const t = await loadTickers(['BTC-USD', 'HYPE-USD'])
        expect(t['BTC-USD']).toEqual({ last: 80000, change: 0.015 })
        expect(t['HYPE-USD']!.last).toBe(45)
        expect(t['HYPE-USD']!.change).toBeCloseTo(-0.1, 10)
      } finally {
        restore()
      }
    })
  })
})
