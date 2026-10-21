export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export interface JsonRow {
  path: string
  depth: number
  key: string | number | null
  kind: 'open' | 'close' | 'leaf'
  type: JsonType
  /** Primitive value as JSON text, or the child count for containers. */
  text: string
  count: number
  collapsed: boolean
  comma: boolean
  match: boolean
}

const typeOf = (v: unknown): JsonType =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : (typeof v as JsonType)

export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Flattens a JSON value into display rows. With a query, only rows that match
 * (key or primitive value) and their ancestors are kept, and those ancestors
 * are forced open.
 */
export function flattenJson(value: unknown, collapsed: ReadonlySet<string>, query = ''): { rows: JsonRow[]; matches: number } {
  const q = query.trim().toLowerCase()
  const rows: JsonRow[] = []
  let matches = 0
  const keyMatches = (key: string | number | null) => q !== '' && key !== null && String(key).toLowerCase().includes(q)

  const subtreeMatches = (v: unknown, key: string | number | null): boolean => {
    if (keyMatches(key)) return true
    const t = typeOf(v)
    if (t === 'object' || t === 'array') {
      const entries = Object.entries(v as object)
      return entries.some(([k, child]) => subtreeMatches(child, t === 'array' ? Number(k) : k))
    }
    return JSON.stringify(v).toLowerCase().includes(q)
  }

  const visit = (v: unknown, key: string | number | null, path: string, depth: number, comma: boolean) => {
    if (q && !subtreeMatches(v, key)) return
    const t = typeOf(v)
    if (t === 'object' || t === 'array') {
      const entries = Object.entries(v as object)
      const selfMatch = keyMatches(key)
      const childMatch = q !== '' && entries.some(([k, c]) => subtreeMatches(c, t === 'array' ? Number(k) : k))
      const isCollapsed = q ? !childMatch : collapsed.has(path)
      if (selfMatch) matches++
      rows.push({ path, depth, key, kind: 'open', type: t, text: '', count: entries.length, collapsed: isCollapsed || entries.length === 0, comma, match: selfMatch })
      if (isCollapsed || entries.length === 0) return
      entries.forEach(([k, child], i) => {
        const childKey = t === 'array' ? Number(k) : k
        visit(child, childKey, `${path}/${k}`, depth + 1, i < entries.length - 1)
      })
      rows.push({ path: `${path}#end`, depth, key: null, kind: 'close', type: t, text: '', count: entries.length, collapsed: false, comma, match: false })
      return
    }
    const text = JSON.stringify(v)
    const match = q !== '' && (keyMatches(key) || text.toLowerCase().includes(q))
    if (match) matches++
    rows.push({ path, depth, key, kind: 'leaf', type: t, text, count: 0, collapsed: false, comma, match })
  }

  visit(value, null, '$', 0, false)
  return { rows, matches }
}

/** Paths of every container below the root, for "collapse all". */
export function containerPaths(value: unknown, path = '$', out: string[] = []): string[] {
  const t = typeOf(value)
  if (t !== 'object' && t !== 'array') return out
  if (path !== '$') out.push(path)
  for (const [k, child] of Object.entries(value as object)) containerPaths(child, `${path}/${k}`, out)
  return out
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatMs(ms: number) {
  return ms < 10 ? `${ms.toFixed(1)} ms` : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}
