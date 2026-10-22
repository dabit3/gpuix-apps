import { describe, expect, it } from 'bun:test'
import { findStrategy, runBacktest, sweepSma, walkForward } from '../src/backtest'
import { sampleBars } from '../src/data/feed'
import type { Bar } from '../src/types'

// 12-bar fixture. SMA(2) crosses above SMA(3) on bar 5's close (101 > 99.67 after 98 <= 98),
// and back below on bar 9's close (105.5 < 106.33 after 107.5 >= 107).
// Fills happen at the NEXT bar's open: buy at open[6] = 103, sell at open[10] = 104.
const O = [100, 101, 99, 98, 97, 99, 103, 106, 108, 107, 104, 101]
const Cl = [101, 99, 98, 97, 99, 103, 106, 108, 107, 104, 101, 100]
const fixture: Bar[] = O.map((o, i) => ({ t: 1_700_000_000 + i * 3600, o, h: Math.max(o, Cl[i]!) + 0.5, l: Math.min(o, Cl[i]!) - 0.5, c: Cl[i]!, v: 1 }))

describe('SMA crossover backtest vs hand-checked spreadsheet', () => {
  const sma = findStrategy('sma')!
  const r = runBacktest(fixture, sma, { fast: 2, slow: 3 }, { capital: 10_000, feeBps: 10, slippageBps: 5 })

  // Spreadsheet columns:
  //   entry px  = 103 × (1 + 0.0005)                 = 103.0515
  //   qty       = 10000 / (103.0515 × 1.001)         = 96.94191729387725
  //   exit px   = 104 × (1 − 0.0005)                 = 103.948
  //   proceeds  = qty × 103.948 × (1 − 0.001)        = 10066.841500445089
  //   fees      = qty×103.0515×0.001 + qty×103.948×0.001 = 20.066928408873945
  it('fills on the next open with slippage and fees', () => {
    expect(r.trades).toHaveLength(1)
    const t = r.trades[0]!
    expect(t.entryIndex).toBe(6)
    expect(t.exitIndex).toBe(10)
    expect(t.entryPrice).toBeCloseTo(103.0515, 9)
    expect(t.exitPrice).toBeCloseTo(103.948, 9)
    expect(t.qty).toBeCloseTo(96.94191729387725, 9)
    expect(t.fees).toBeCloseTo(20.066928408873945, 9)
    expect(t.pnl).toBeCloseTo(66.841500445089, 6)
  })

  it('marks equity to the close every bar', () => {
    const expected = [10000, 10000, 10000, 10000, 10000, 10000, 10275.843233150988, 10469.727067738744, 10372.785150444866, 10081.959398563235, 10066.841500445089, 10066.841500445089]
    expected.forEach((v, i) => expect(r.equity[i]!).toBeCloseTo(v, 6))
  })

  it('computes metrics', () => {
    const m = r.metrics
    expect(m.totalReturn).toBeCloseTo(0.006684150044508952, 9)
    expect(m.finalEquity).toBeCloseTo(10066.841500445089, 6)
    expect(m.maxDrawdown).toBeCloseTo(10066.841500445089 / 10469.727067738744 - 1, 9)
    expect(m.maxDrawdownBars).toBe(4)
    expect(m.winRate).toBe(1)
    expect(m.profitFactor).toBe(Infinity)
    expect(m.exposure).toBeCloseTo(4 / 12, 9)
    expect(m.fees).toBeCloseTo(20.066928408873945, 9)
  })

  it('has no lookahead: changing the future never changes past equity', () => {
    const changed = fixture.map((b, i) => (i >= 8 ? { ...b, o: b.o * 2, h: b.h * 2, l: b.l * 2, c: b.c * 2 } : b))
    const r2 = runBacktest(changed, sma, { fast: 2, slow: 3 })
    for (let i = 0; i < 8; i++) expect(r2.equity[i]).toBe(r.equity[i]!)
  })

  it("'close' fill mode fills on the signal bar's close", () => {
    const rc = runBacktest(fixture, sma, { fast: 2, slow: 3 }, { fill: 'close' })
    expect(rc.trades[0]!.entryIndex).toBe(5)
    expect(rc.trades[0]!.entryPrice).toBeCloseTo(103 * 1.0005, 9)
  })
})

describe('strategies, sweep and walk-forward on sample data', () => {
  const bars = sampleBars('BTC-USD', '1h', 2000)
  for (const id of ['sma', 'rsi', 'donchian']) {
    it(`${id} trades and keeps equity finite`, () => {
      const s = findStrategy(id)!
      const r = runBacktest(bars, s)
      expect(r.trades.length).toBeGreaterThan(2)
      expect(r.equity.every(Number.isFinite)).toBe(true)
      for (const t of r.trades) expect(t.exitIndex).toBeGreaterThan(t.entryIndex)
      expect(r.metrics.maxDrawdown).toBeLessThanOrEqual(0)
    })
  }

  it('sweeps fast × slow and skips fast >= slow', () => {
    const sw = sweepSma(bars)
    expect(sw.cells).toHaveLength(36)
    expect(sw.cells.filter((c) => c.fast >= c.slow).every((c) => Number.isNaN(c.sharpe))).toBe(true)
    expect(sw.best).not.toBeNull()
    expect(sw.best!.fast).toBeLessThan(sw.best!.slow)
  })

  it('walk-forward reports out-of-sample folds', () => {
    const wf = walkForward(bars, 3)
    expect(wf).toHaveLength(3)
    for (const f of wf) expect(f.test[0]).toBe(f.train[1])
  })
})
