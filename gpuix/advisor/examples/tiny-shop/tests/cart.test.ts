import { expect, test } from 'bun:test'
import { applyDiscount, subtotal, total } from '../src/cart'

const cart = { lines: [{ sku: 'mug', priceCents: 1200, qty: 2 }, { sku: 'tee', priceCents: 2500, qty: 1 }], discountPercent: 0 }

test('subtotal sums price times quantity', () => {
  expect(subtotal(cart)).toBe(4900)
})

test('a 10% code takes 10% off', () => {
  expect(total(applyDiscount(cart, 10))).toBe(4410)
})
