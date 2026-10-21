import { describe, expect, test } from 'bun:test'
import { orderNumber, slugify } from './slug'

describe('slugify', () => {
  test('lowercases and hyphenates', () => {
    expect(slugify('Stoneware Mug')).toBe('stoneware-mug')
  })
  test('strips accents', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme')
  })
  test('spells out ampersands', () => {
    expect(slugify('Beans & Brew')).toBe('beans-and-brew')
  })
  test('collapses punctuation', () => {
    expect(slugify('Paper Filters ×100!!')).toBe('paper-filters-100')
  })
  test('trims leading and trailing separators', () => {
    expect(slugify('  --Grinder--  ')).toBe('grinder')
  })
})

describe('orderNumber', () => {
  test('pads the sequence', () => {
    expect(orderNumber(42)).toBe('AC-2610-00042')
  })
  test('uses the order month', () => {
    expect(orderNumber(1, new Date('2027-01-03T00:00:00Z'))).toBe('AC-2701-00001')
  })
})
