import { describe, expect, test } from 'bun:test'
import { eta, FREE_SHIPPING_OVER, quote } from './shipping'

describe('quote', () => {
  test('charges the domestic base rate under 1 kg', () => {
    expect(quote(420, 'domestic').amount).toBe(595)
  })
  test('adds a per-kg surcharge', () => {
    expect(quote(2620, 'domestic').amount).toBe(895)
  })
  test('ships free over the threshold', () => {
    expect(quote(2620, 'domestic', 'standard', FREE_SHIPPING_OVER).amount).toBe(0)
  })
  test('express costs 1.6×', () => {
    expect(quote(420, 'domestic', 'express').amount).toBe(952)
  })
  test('europe is priced per kg', () => {
    expect(quote(3100, 'europe').amount).toBe(3245)
  })
  test('empty parcels are free', () => {
    expect(quote(0, 'asia').amount).toBe(0)
  })
  test('overnight caps at 10 kg', () => {
    expect(() => quote(12_000, 'domestic', 'overnight')).toThrow('10 kg')
  })
})

describe('eta', () => {
  test('domestic standard is 3–5 days', () => {
    expect(eta('domestic', 'standard')).toEqual([3, 5])
  })
  test('express halves the window', () => {
    expect(eta('europe', 'express')).toEqual([4, 6])
  })
  test('overnight is next day', () => {
    expect(eta('asia', 'overnight')).toEqual([1, 1])
  })
})
