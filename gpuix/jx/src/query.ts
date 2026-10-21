import { type Json, isContainer, kindOf } from './json'

/** A small jq: paths, `.[]`, slices, pipes, select(), map(), {…} construction and a few builtins. */
type Fn = (input: Json) => Json[]

const MAX = 200_000

export function runQuery(src: string, input: Json): Json[] {
  const p = new Parser(src.trim() || '.')
  const fn = p.pipeline()
  p.ws()
  if (p.i < p.s.length) throw new Error(`unexpected "${p.s.slice(p.i, p.i + 12)}"`)
  return fn(input)
}

const BUILTINS: Record<string, (v: Json) => Json[]> = {
  length: (v) => [Array.isArray(v) || typeof v === 'string' ? v.length : isContainer(v) ? Object.keys(v).length : v === null ? 0 : Math.abs(Number(v))],
  keys: (v) => [isContainer(v) ? (Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v).sort()) : []],
  type: (v) => [kindOf(v)],
  first: (v) => (Array.isArray(v) && v.length ? [v[0]] : []),
  last: (v) => (Array.isArray(v) && v.length ? [v[v.length - 1]] : []),
  sort: (v) => [Array.isArray(v) ? [...v].sort(cmp) : v],
  unique: (v) => [Array.isArray(v) ? [...new Map(v.map((x) => [JSON.stringify(x), x])).values()].sort(cmp) : v],
  reverse: (v) => [Array.isArray(v) ? [...v].reverse() : v],
  add: (v) => [Array.isArray(v) ? v.reduce<Json>((a, b) => (a === null ? b : typeof a === 'number' ? a + Number(b) : typeof a === 'string' ? a + String(b) : Array.isArray(a) && Array.isArray(b) ? [...a, ...b] : a), null) : v],
  not: (v) => [v === null || v === false],
  values: (v) => (v === null ? [] : [v]),
}

function cmp(a: Json, b: Json): number {
  const ka = kindOf(a), kb = kindOf(b)
  if (ka !== kb) return ka < kb ? -1 : 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(JSON.stringify(a)) < String(JSON.stringify(b)) ? -1 : JSON.stringify(a) === JSON.stringify(b) ? 0 : 1
}

const truthy = (v: Json) => v !== null && v !== false
const eq = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b)

class Parser {
  i = 0
  constructor(public s: string) {}
  ws() { while (/\s/.test(this.s[this.i] ?? '')) this.i++ }
  peek(t: string) { this.ws(); return this.s.startsWith(t, this.i) }
  eat(t: string) { if (this.peek(t)) { this.i += t.length; return true } return false }
  expect(t: string) { if (!this.eat(t)) throw new Error(`expected "${t}"`) }

  pipeline(): Fn {
    let fn = this.comma()
    while (this.eat('|')) {
      const a = fn, b = this.comma()
      fn = (v) => flatMapCap(a(v), b)
    }
    return fn
  }

  comma(): Fn {
    const parts = [this.orExpr()]
    while (this.peek(',') ) { this.i++; parts.push(this.orExpr()) }
    return parts.length === 1 ? parts[0] : (v) => parts.flatMap((p) => p(v))
  }

  orExpr(): Fn {
    let fn = this.andExpr()
    while (this.eatWord('or')) { const a = fn, b = this.andExpr(); fn = (v) => [truthy(a(v)[0] ?? null) || truthy(b(v)[0] ?? null)] }
    return fn
  }

  andExpr(): Fn {
    let fn = this.compare()
    while (this.eatWord('and')) { const a = fn, b = this.compare(); fn = (v) => [truthy(a(v)[0] ?? null) && truthy(b(v)[0] ?? null)] }
    return fn
  }

  eatWord(w: string) {
    this.ws()
    if (this.s.startsWith(w, this.i) && !/[\w]/.test(this.s[this.i + w.length] ?? '')) { this.i += w.length; return true }
    return false
  }

  compare(): Fn {
    const left = this.term()
    for (const op of ['==', '!=', '>=', '<=', '>', '<'] as const) {
      if (this.eat(op)) {
        const right = this.term()
        return (v) => {
          const a = left(v)[0] ?? null, b = right(v)[0] ?? null
          switch (op) {
            case '==': return [eq(a, b)]
            case '!=': return [!eq(a, b)]
            case '>': return [cmp(a, b) > 0]
            case '<': return [cmp(a, b) < 0]
            case '>=': return [cmp(a, b) >= 0]
            case '<=': return [cmp(a, b) <= 0]
          }
        }
      }
    }
    return left
  }

  term(): Fn {
    this.ws()
    const c = this.s[this.i]
    if (c === '"') { const lit = this.string(); return () => [lit] }
    if (c === '(') { this.i++; const fn = this.pipeline(); this.expect(')'); return this.postfix(fn) }
    if (c === '{') return this.postfix(this.object())
    if (c === '[') { this.i++; if (this.eat(']')) return () => [[]]; const fn = this.pipeline(); this.expect(']'); return (v) => [fn(v)] }
    if (c === '.' ) return this.path()
    const num = /^-?\d+(\.\d+)?/.exec(this.s.slice(this.i))
    if (num) { this.i += num[0].length; const n = Number(num[0]); return () => [n] }
    const word = /^[A-Za-z_]\w*/.exec(this.s.slice(this.i))
    if (!word) throw new Error(c ? `unexpected "${c}"` : 'unexpected end of filter')
    this.i += word[0].length
    const w = word[0]
    if (w === 'true' || w === 'false') return () => [w === 'true']
    if (w === 'null') return () => [null]
    if (w === 'empty') return () => []
    if (w === 'select') { this.expect('('); const f = this.pipeline(); this.expect(')'); return (v) => (f(v).some(truthy) ? [v] : []) }
    if (w === 'map') { this.expect('('); const f = this.pipeline(); this.expect(')'); return (v) => [Array.isArray(v) ? flatMapCap(v, f) : isContainer(v) ? flatMapCap(Object.values(v), f) : []] }
    if (w === 'has') { this.expect('('); const f = this.pipeline(); this.expect(')'); return (v) => [isContainer(v) && String(f(v)[0]) in v] }
    if (w === 'contains' || w === 'startswith' || w === 'endswith' || w === 'test') {
      this.expect('('); const f = this.pipeline(); this.expect(')')
      return (v) => {
        const arg = String(f(v)[0] ?? ''), s = typeof v === 'string' ? v : JSON.stringify(v)
        if (w === 'contains') return [s.includes(arg)]
        if (w === 'startswith') return [s.startsWith(arg)]
        if (w === 'endswith') return [s.endsWith(arg)]
        return [new RegExp(arg, 'i').test(s)]
      }
    }
    if (w === 'group_by' || w === 'sort_by' || w === 'unique_by' || w === 'min_by' || w === 'max_by') {
      this.expect('('); const f = this.pipeline(); this.expect(')')
      return (v) => {
        if (!Array.isArray(v)) return [v]
        const keyed = v.map((x) => ({ x, k: f(x)[0] ?? null })).sort((a, b) => cmp(a.k, b.k))
        if (w === 'sort_by') return [keyed.map((e) => e.x)]
        if (w === 'min_by') return keyed.length ? [keyed[0].x] : [null]
        if (w === 'max_by') return keyed.length ? [keyed[keyed.length - 1].x] : [null]
        const groups: Json[][] = []
        for (const e of keyed) {
          const g = groups.at(-1)
          if (g && eq(f(g[0])[0] ?? null, e.k)) g.push(e.x)
          else groups.push([e.x])
        }
        return [w === 'group_by' ? groups : groups.map((g) => g[0])]
      }
    }
    const b = BUILTINS[w]
    if (!b) throw new Error(`unknown function "${w}"`)
    return this.postfix(b)
  }

  string(): string {
    const m = /^"(?:[^"\\]|\\.)*"/.exec(this.s.slice(this.i))
    if (!m) throw new Error('unterminated string')
    this.i += m[0].length
    return JSON.parse(m[0])
  }

  object(): Fn {
    this.expect('{')
    const entries: [string | Fn, Fn][] = []
    while (!this.eat('}')) {
      this.ws()
      let key: string | Fn
      if (this.s[this.i] === '"') key = this.string()
      else if (this.s[this.i] === '(') { this.i++; key = this.pipeline(); this.expect(')') }
      else {
        const m = /^[A-Za-z_]\w*/.exec(this.s.slice(this.i))
        if (!m) throw new Error('expected object key')
        this.i += m[0].length
        key = m[0]
      }
      let val: Fn
      if (this.eat(':')) val = this.orExpr()
      else { const k = key as string; val = (v) => [isContainer(v) && !Array.isArray(v) ? (v[k] ?? null) : null] }
      entries.push([key, val])
      if (!this.eat(',')) { this.expect('}'); break }
    }
    return (v) => {
      const o: Record<string, Json> = {}
      for (const [k, f] of entries) o[typeof k === 'string' ? k : String(k(v)[0])] = f(v)[0] ?? null
      return [o]
    }
  }

  path(): Fn {
    this.expect('.')
    let fn: Fn = (v) => [v]
    const m = /^[A-Za-z_]\w*/.exec(this.s.slice(this.i))
    if (m) { this.i += m[0].length; fn = chain(fn, field(m[0])) }
    else if (this.s[this.i] === '"') fn = chain(fn, field(this.string()))
    return this.postfix(fn)
  }

  postfix(fn: Fn): Fn {
    for (;;) {
      if (this.s[this.i] === '.' && /[A-Za-z_"]/.test(this.s[this.i + 1] ?? '')) {
        this.i++
        const m = /^[A-Za-z_]\w*/.exec(this.s.slice(this.i))
        const name = m ? (this.i += m[0].length, m[0]) : this.string()
        fn = chain(fn, field(name))
      } else if (this.s[this.i] === '[' || (this.s[this.i] === '.' && this.s[this.i + 1] === '[')) {
        if (this.s[this.i] === '.') this.i++
        this.i++
        if (this.eat(']')) { fn = chain(fn, iterate); continue }
        this.ws()
        if (this.s[this.i] === '"') { const k = this.string(); this.expect(']'); fn = chain(fn, field(k)); continue }
        const sl = /^(-?\d*)\s*:\s*(-?\d*)/.exec(this.s.slice(this.i))
        if (sl) {
          this.i += sl[0].length; this.expect(']')
          const a = sl[1] === '' ? undefined : Number(sl[1]), b = sl[2] === '' ? undefined : Number(sl[2])
          fn = chain(fn, (v) => [Array.isArray(v) || typeof v === 'string' ? (v.slice(a, b) as Json) : null])
          continue
        }
        const n = /^-?\d+/.exec(this.s.slice(this.i))
        if (!n) throw new Error('expected index')
        this.i += n[0].length; this.expect(']')
        const idx = Number(n[0])
        fn = chain(fn, (v) => [Array.isArray(v) ? (v.at(idx) ?? null) : null])
      } else if (this.s[this.i] === '?') {
        this.i++
      } else return fn
    }
  }
}

const field = (k: string): Fn => (v) => {
  if (v === null) return [null]
  if (!isContainer(v) || Array.isArray(v)) throw new Error(`cannot index ${kindOf(v)} with "${k}"`)
  return [v[k] ?? null]
}

const iterate: Fn = (v) => {
  if (Array.isArray(v)) return v
  if (isContainer(v)) return Object.values(v)
  throw new Error(`cannot iterate over ${kindOf(v)}`)
}

const chain = (a: Fn, b: Fn): Fn => (v) => flatMapCap(a(v), b)

function flatMapCap(xs: Json[], f: Fn): Json[] {
  const out: Json[] = []
  for (const x of xs) {
    for (const y of f(x)) {
      out.push(y)
      if (out.length > MAX) throw new Error(`more than ${MAX.toLocaleString()} results`)
    }
  }
  return out
}
