import { describe, expect, test } from 'bun:test'
import { add, allocate, format, money, multiply, parse, subtract } from './money'

describe('money', () => {
  test('creates integer minor units', () => {
    expect(money(1999)).toEqual({ amount: 1999, currency: 'USD' })
  })
  test('rejects fractional minor units', () => {
    expect(() => money(19.99)).toThrow('minor units')
  })
  test('adds amounts in the same currency', () => {
    expect(add(money(1000), money(250)).amount).toBe(1250)
  })
  test('subtracts amounts', () => {
    expect(subtract(money(1000), money(250)).amount).toBe(750)
  })
  test('refuses to mix currencies', () => {
    expect(() => add(money(100, 'USD'), money(100, 'EUR'))).toThrow('currency mismatch')
  })
  test('multiplies with banker-free rounding', () => {
    expect(multiply(money(999), 1.5).amount).toBe(1499)
  })
})

describe('allocate', () => {
  test('splits evenly', () => {
    expect(allocate(money(900), [1, 1, 1]).map((m) => m.amount)).toEqual([300, 300, 300])
  })
  test('hands the remainder to the first parts', () => {
    expect(allocate(money(1000), [1, 1, 1]).map((m) => m.amount)).toEqual([334, 333, 333])
  })
  test('respects ratios', () => {
    expect(allocate(money(1000), [70, 30]).map((m) => m.amount)).toEqual([700, 300])
  })
  test('never loses a cent', () => {
    const parts = allocate(money(10001), [3, 3, 4])
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(10001)
  })
})

describe('format', () => {
  test('formats dollars', () => {
    expect(format(money(123456))).toBe('$1,234.56')
  })
  test('formats yen without decimals', () => {
    expect(format(money(5000, 'JPY'))).toBe('¥5,000')
  })
  test('formats negatives', () => {
    expect(format(money(-250, 'EUR'))).toBe('-€2.50')
  })
  test('parses user input', () => {
    expect(parse('$1,299.95')).toEqual(money(129995))
  })
  test('rejects garbage', () => {
    expect(() => parse('abc')).toThrow('cannot parse')
  })
})
