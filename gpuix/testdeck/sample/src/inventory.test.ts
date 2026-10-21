import { describe, expect, test } from 'bun:test'
import { FakeWarehouse, reserveAll } from './inventory'

describe('FakeWarehouse', () => {
  test('reports available stock', async () => {
    expect(await new FakeWarehouse({ 'MUG-01': 12 }).available('MUG-01')).toBe(12)
  })
  test('reserving decrements stock', async () => {
    const w = new FakeWarehouse({ 'MUG-01': 12 })
    await w.reserve('MUG-01', 5)
    expect(await w.available('MUG-01')).toBe(7)
  })
  test('releasing a hold restores stock', async () => {
    const w = new FakeWarehouse({ 'BEAN-250': 4 })
    const t = await w.reserve('BEAN-250', 4)
    await w.release(t)
    expect(await w.available('BEAN-250')).toBe(4)
  })
  test('refuses to oversell', async () => {
    const w = new FakeWarehouse({ 'GRND-PRO': 1 })
    await expect(w.reserve('GRND-PRO', 2)).rejects.toThrow('only 1 GRND-PRO left')
  })
})

describe('reserveAll', () => {
  test('reserves every line', async () => {
    const w = new FakeWarehouse({ 'MUG-01': 5, 'BEAN-250': 5 }, 40)
    expect(await reserveAll(w, [{ sku: 'MUG-01', qty: 2 }, { sku: 'BEAN-250', qty: 3 }])).toHaveLength(2)
  })
  test('rolls back earlier holds when a line fails', async () => {
    const w = new FakeWarehouse({ 'MUG-01': 5, 'GRND-PRO': 0 }, 60)
    await expect(reserveAll(w, [{ sku: 'MUG-01', qty: 2 }, { sku: 'GRND-PRO', qty: 1 }])).rejects.toThrow()
    expect(await w.available('MUG-01')).toBe(5)
  })
  test('handles a slow warehouse', async () => {
    const w = new FakeWarehouse({ 'FILT-100': 100 }, 120)
    expect(await reserveAll(w, [{ sku: 'FILT-100', qty: 10 }])).toEqual(['hold_1'])
  })
})
