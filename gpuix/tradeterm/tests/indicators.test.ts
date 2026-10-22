import { describe, expect, it } from 'bun:test'
import ref from './fixtures/talib.json'
import { atr, bollinger, closes, donchian, ema, findIndicator, heikinAshi, INDICATORS, macd, obv, registerIndicator, rsi, sma, stochastic, wma } from '../src/indicators'
import type { Bar } from '../src/types'

// Reference values come from TA-Lib (tests/fixtures/gen_talib.py) on a 120-bar fixture.
const bars = ref.bars as Bar[]
const C = closes(bars)

function match(ours: ArrayLike<number>, theirs: (number | null)[], digits = 8, from = 0) {
  let compared = 0
  for (let i = from; i < theirs.length; i++) {
    const t = theirs[i]
    if (t == null) continue
    expect(Number.isNaN(ours[i]!)).toBe(false)
    expect(ours[i]!).toBeCloseTo(t, digits)
    compared++
  }
  expect(compared).toBeGreaterThan(50)
}

describe('indicators vs TA-Lib', () => {
  it('SMA / EMA / WMA', () => {
    match(sma(C, 10), ref.sma10)
    match(ema(C, 10), ref.ema10)
    match(wma(C, 10), ref.wma10)
  })
  it('warm-up is NaN, never a fake value', () => {
    expect(Number.isNaN(sma(C, 10)[8]!)).toBe(true)
    expect(Number.isNaN(rsi(C, 14)[13]!)).toBe(true)
    expect(Number.isNaN(rsi(C, 14)[14]!)).toBe(false)
  })
  it('RSI (Wilder)', () => match(rsi(C, 14), ref.rsi14))
  it('Bollinger Bands (20, 2σ, population stdev)', () => {
    const b = bollinger(C, 20, 2)
    match(b.upper, ref.bb20.upper)
    match(b.mid, ref.bb20.mid)
    match(b.lower, ref.bb20.lower)
  })
  it('MACD (12, 26, 9)', () => {
    const m = macd(C, 12, 26, 9)
    match(m.line, ref.macd.line)
    match(m.signal, ref.macd.signal)
    match(m.hist, ref.macd.hist)
  })
  it('ATR (Wilder)', () => match(atr(bars, 14), ref.atr14))
  it('Stochastic (14, 3)', () => {
    const s = stochastic(bars, 14, 3)
    match(s.k, ref.stoch.k)
    match(s.d, ref.stoch.d)
  })
  it('OBV (same up to TA-Lib starting at the first volume)', () => {
    const o = obv(bars)
    const r = ref.obv as number[]
    match(Array.from(o, (x) => x + r[0]!), r, 6)
  })
  it('Donchian channel = rolling max high / min low', () => {
    const d = donchian(bars, 20)
    match(d.upper, ref.donchian20.upper)
    match(d.lower, ref.donchian20.lower)
  })
})

describe('Heikin-Ashi and the plugin API', () => {
  it('Heikin-Ashi follows its recursive definition', () => {
    const ha = heikinAshi(bars)
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i]!
      expect(ha[i]!.c).toBeCloseTo((b.o + b.h + b.l + b.c) / 4, 10)
      expect(ha[i]!.o).toBeCloseTo((ha[i - 1]!.o + ha[i - 1]!.c) / 2, 10)
      expect(ha[i]!.h).toBeCloseTo(Math.max(b.h, ha[i]!.o, ha[i]!.c), 10)
    }
  })
  it('every built-in indicator returns full-length series', () => {
    for (const def of INDICATORS) for (const s of def.fn(bars, def.params)) expect(s.values.length).toBe(bars.length)
  })
  it('registerIndicator adds a custom (bars, params) => series[] indicator', () => {
    registerIndicator({ id: 'mid', label: 'Mid', pane: 'overlay', params: {}, fn: (b) => [{ name: 'mid', values: b.map((x) => (x.h + x.l) / 2), color: '#fff' }] })
    const s = findIndicator('mid')!.fn(bars, {})
    expect(s[0]!.values[5]).toBe((bars[5]!.h + bars[5]!.l) / 2)
  })
})
