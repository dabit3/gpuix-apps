import { type Json, type Seg, isContainer, leafText, summary } from './json'

export type DiffStatus = 'same' | 'changed' | 'added' | 'removed' | 'open'
export type DiffRow = { depth: number; key: Seg | null; left: string | null; right: string | null; status: DiffStatus; path: Seg[] }
export type DiffStats = { added: number; removed: number; changed: number }

export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true
  if (!isContainer(a) || !isContainer(b) || Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!(k in b) || !deepEqual((a as Record<string, Json>)[k], (b as Record<string, Json>)[k])) return false
  return true
}

const show = (v: Json) => (isContainer(v) ? (Array.isArray(v) ? `[…] ${summary(v)}` : `{…} ${summary(v)}`) : leafText(v, 80))

/** Aligned side-by-side rows: unchanged subtrees collapse to one row, changed containers open. */
export function diffJson(a: Json, b: Json): { rows: DiffRow[]; stats: DiffStats } {
  const rows: DiffRow[] = []
  const stats: DiffStats = { added: 0, removed: 0, changed: 0 }
  const walk = (x: Json | undefined, y: Json | undefined, key: Seg | null, depth: number, path: Seg[]) => {
    if (y === undefined) { stats.removed++; rows.push({ depth, key, left: show(x!), right: null, status: 'removed', path }); return }
    if (x === undefined) { stats.added++; rows.push({ depth, key, left: null, right: show(y), status: 'added', path }); return }
    if (deepEqual(x, y)) { rows.push({ depth, key, left: show(x), right: show(y), status: 'same', path }); return }
    if (isContainer(x) && isContainer(y) && Array.isArray(x) === Array.isArray(y)) {
      const open = Array.isArray(x) ? '[' : '{'
      rows.push({ depth, key, left: `${open} ${summary(x)}`, right: `${open} ${summary(y)}`, status: 'open', path })
      if (Array.isArray(x) && Array.isArray(y)) {
        for (let i = 0; i < Math.max(x.length, y.length); i++) walk(x[i], y[i], i, depth + 1, [...path, i])
      } else {
        const xo = x as Record<string, Json>, yo = y as Record<string, Json>
        const keys = [...Object.keys(xo), ...Object.keys(yo).filter((k) => !(k in xo))]
        for (const k of keys) walk(xo[k], yo[k], k, depth + 1, [...path, k])
      }
      return
    }
    stats.changed++
    rows.push({ depth, key, left: show(x), right: show(y), status: 'changed', path })
  }
  walk(a, b, null, 0, [])
  return { rows, stats }
}
