import { type Json, type Kind, isContainer, kindOf } from './json'

export type SchemaNode = {
  count: number
  types: Partial<Record<Kind, number>>
  fields?: Map<string, SchemaNode>
  items?: SchemaNode
  examples: Set<string>
}

const blank = (): SchemaNode => ({ count: 0, types: {}, examples: new Set() })

/** Infer a merged schema; arrays are sampled evenly up to `sample` items per array. */
export function inferSchema(v: Json, sample = 3000, node: SchemaNode = blank()): SchemaNode {
  const k = kindOf(v)
  node.count++
  node.types[k] = (node.types[k] ?? 0) + 1
  if (Array.isArray(v)) {
    node.items ??= blank()
    const step = Math.max(1, Math.floor(v.length / sample))
    for (let i = 0; i < v.length; i += step) inferSchema(v[i], sample, node.items)
  } else if (isContainer(v)) {
    node.fields ??= new Map()
    for (const key in v) {
      let f = node.fields.get(key)
      if (!f) node.fields.set(key, (f = blank()))
      inferSchema(v[key], sample, f)
    }
  } else if (node.examples.size < 4 && v !== null) {
    const s = typeof v === 'string' ? (v.length > 24 ? v.slice(0, 23) + '…' : v) : String(v)
    node.examples.add(s)
  }
  return node
}

export type SchemaRow = { name: string; depth: number; type: string; pct: number; hint: string; kind: Kind; path: string }

export function typeLabel(n: SchemaNode): string {
  const ks = (Object.keys(n.types) as Kind[]).sort((a, b) => (n.types[b] ?? 0) - (n.types[a] ?? 0))
  const nullable = ks.includes('null') && ks.length > 1
  const label = ks.filter((t) => !(nullable && t === 'null')).map((t) => (t === 'array' && n.items ? `${typeLabel(n.items)}[]` : t)).join(' | ')
  return nullable ? label + '?' : label
}

export function dominant(n: SchemaNode): Kind {
  let best: Kind = 'null', c = -1
  for (const [k, v] of Object.entries(n.types) as [Kind, number][]) if (k !== 'null' && v > c) { best = k; c = v }
  return c < 0 ? 'null' : best
}

/** Rows for the schema panel: fields with presence %, nested objects (and object arrays) indented. */
export function schemaRows(root: SchemaNode, maxDepth = 4): SchemaRow[] {
  const rows: SchemaRow[] = []
  const visit = (n: SchemaNode, depth: number, prefix: string) => {
    let obj = n
    if (dominant(n) === 'array' && n.items) { obj = n.items; prefix += '[]' }
    if (!obj.fields || depth > maxDepth) return
    const parents = obj.types.object ?? obj.count
    for (const [name, f] of obj.fields) {
      const path = (prefix === '' ? '' : prefix) + (/^[A-Za-z_]\w*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`)
      rows.push({ name, depth, type: typeLabel(f), pct: Math.round((f.count / Math.max(parents, 1)) * 100), hint: [...f.examples].slice(0, 2).join(', '), kind: dominant(f), path: path.startsWith('.') ? path : '.' + path })
      visit(f, depth + 1, path)
    }
  }
  visit(root, 0, '')
  return rows
}
