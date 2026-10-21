import { describe, expect, test } from 'bun:test'
import { money } from './money'
import { applyDiscount, discountAmount, lookupCode, percentOff } from './pricing'

describe('lookupCode', () => {
  test('is case-insensitive', () => {
    expect(lookupCode('welcome10')?.code).toBe('WELCOME10')
  })
  test('trims whitespace', () => {
    expect(lookupCode('  FIVEOFF ')?.kind).toBe('fixed')
  })
  test('returns undefined for unknown codes', () => {
    expect(lookupCode('FREEBIE')).toBeUndefined()
  })
})

describe('percentOff', () => {
  test('takes 10% off', () => {
    expect(percentOff(money(5000), 10)).toEqual(money(500))
  })
  test('rounds half cents', () => {
    expect(percentOff(money(1999), 25).amount).toBe(500)
  })
})

describe('applyDiscount', () => {
  test('WELCOME10 takes 10% off any order', () => {
    expect(applyDiscount(money(4250), lookupCode('WELCOME10'))).toEqual(money(3825))
  })
  test('BREW25 needs a $100 subtotal', () => {
    expect(applyDiscount(money(9999), lookupCode('BREW25'))).toEqual(money(9999))
  })
  test('BREW25 takes 25% off big orders', () => {
    expect(applyDiscount(money(16200), lookupCode('BREW25'))).toEqual(money(12150))
  })
  test('FIVEOFF takes $5 off', () => {
    expect(applyDiscount(money(3000), lookupCode('FIVEOFF')).amount).toBe(2500)
  })
  test('a fixed discount never goes below zero', () => {
    expect(discountAmount(money(300), { kind: 'fixed', code: 'X', off: 500 }).amount).toBe(300)
  })
  test('MUGBOGO gives every second mug free', () => {
    const lines = { 'MUG-01': { price: 1800, qty: 3 } }
    expect(applyDiscount(money(5400), lookupCode('MUGBOGO'), lines)).toEqual(money(3600))
  })
  test('no code leaves the subtotal alone', () => {
    expect(applyDiscount(money(1234), undefined)).toEqual(money(1234))
  })
  test.todo('stacks a percent code with free shipping')
})
