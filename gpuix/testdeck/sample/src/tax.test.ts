import { describe, expect, test } from 'bun:test'
import { money } from './money'
import { salesTax, vatInclusive } from './tax'

describe('salesTax', () => {
  test('California charges 7.25%', () => {
    expect(salesTax(money(10000), 'CA').amount).toBe(725)
  })
  test('Oregon has no sales tax', () => {
    expect(salesTax(money(10000), 'OR').amount).toBe(0)
  })
  test('state codes are case-insensitive', () => {
    expect(salesTax(money(10000), 'tx').amount).toBe(625)
  })
  test('rounds to the nearest cent', () => {
    expect(salesTax(money(1999), 'WA').amount).toBe(130)
  })
  test('unknown states throw', () => {
    expect(() => salesTax(money(100), 'ZZ')).toThrow('no tax rate')
  })
})

describe('vatInclusive', () => {
  test('splits 20% VAT out of a gross price', () => {
    expect(vatInclusive(money(1200, 'GBP'), 0.2)).toEqual({ net: money(1000, 'GBP'), vat: money(200, 'GBP') })
  })
  test.skip('handles reduced EU rates per category', () => {})
})
