import { describe, expect, it } from 'bun:test'
import { complete, tokenize, wordAt } from '../src/sql'

const schema = [
  { name: 'orders', kind: 'table' as const, columns: [{ name: 'id', type: 'INTEGER' }, { name: 'total', type: 'REAL' }] },
  { name: 'order_items', kind: 'table' as const, columns: [{ name: 'order_id', type: 'INTEGER' }] },
  { name: 'customers', kind: 'table' as const, columns: [{ name: 'country', type: 'TEXT' }] },
]

describe('sql', () => {
  it('tokenizes keywords, functions, strings, numbers and comments losslessly', () => {
    const src = "SELECT COUNT(*) AS n FROM orders WHERE status = 'it''s' AND total > 9.5 -- hi"
    const toks = tokenize(src)
    expect(toks.map((t) => t.text).join('')).toBe(src)
    const kind = (text: string) => toks.find((t) => t.text === text)?.kind
    expect(kind('SELECT')).toBe('kw')
    expect(kind('COUNT')).toBe('fn')
    expect(kind("'it''s'")).toBe('str')
    expect(kind('9.5')).toBe('num')
    expect(kind('-- hi')).toBe('cmt')
    expect(kind('orders')).toBe('id')
  })
  it('finds the identifier under the caret, including table.col', () => {
    expect(wordAt('SELECT * FROM ord', 17)).toEqual({ word: 'ord', start: 14 })
    expect(wordAt('SELECT o.to', 11).word).toBe('o.to')
  })
  it('completes tables first, then columns, then keywords', () => {
    const c = complete('ord', schema)
    expect(c[0]).toMatchObject({ label: 'orders', kind: 'table' })
    expect(c.map((x) => x.label)).toContain('order_items')
    expect(c.map((x) => x.label)).toContain('order_id')
    expect(complete('tot', schema)[0]).toMatchObject({ label: 'total', kind: 'column' })
    expect(complete('orders.t', schema)[0]).toMatchObject({ label: 'orders.total' })
  })
})
