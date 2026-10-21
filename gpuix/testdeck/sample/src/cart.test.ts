import { describe, expect, test } from 'bun:test'
import { Cart } from './cart'
import { beans, filter, grinder, mug } from './catalog'

describe('Cart', () => {
  test('starts empty', () => {
    expect(new Cart().isEmpty()).toBe(true)
  })
  test('adds a product', () => {
    expect(new Cart().add(mug).count).toBe(1)
  })
  test('merges repeated skus into one line', () => {
    const cart = new Cart().add(mug).add(mug, 2)
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0].quantity).toBe(3)
  })
  test('rejects zero quantity', () => {
    expect(() => new Cart().add(mug, 0)).toThrow('positive')
  })
  test('removes part of a line', () => {
    expect(new Cart().add(beans, 3).remove(beans.sku, 1).count).toBe(2)
  })
  test('removes a whole line', () => {
    expect(new Cart().add(beans, 3).remove(beans.sku).isEmpty()).toBe(true)
  })
  test('ignores unknown skus on remove', () => {
    expect(new Cart().add(mug).remove('NOPE').count).toBe(1)
  })
  test('computes subtotal', () => {
    const cart = new Cart().add(mug, 2).add(filter)
    expect(cart.subtotal().amount).toBe(4250)
  })
  test('computes shipping weight', () => {
    expect(new Cart().add(grinder).add(beans, 2).weightGrams).toBe(2620)
  })
  test('keeps insertion order of lines', () => {
    const skus = new Cart().add(grinder).add(mug).add(beans).lines.map((l) => l.product.sku)
    expect(skus).toEqual(['GRND-PRO', 'MUG-01', 'BEAN-250'])
  })
})
