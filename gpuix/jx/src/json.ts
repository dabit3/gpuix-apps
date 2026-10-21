import { readFileSync, statSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
export type Seg = string | number
export type Kind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export const kindOf = (v: unknown): Kind =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : (typeof v as Kind)

export const isContainer = (v: unknown): v is Json[] | { [k: string]: Json } => typeof v === 'object' && v !== null

export const pathKey = (p: Seg[]) => p.join('\u0000') + '\u0001' + p.length

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** jq-style path: `.[12].actor.login`, `.payload["ref-type"]`. */
export function jqPath(p: Seg[]): string {
  if (p.length === 0) return '.'
  let s = ''
  for (const seg of p) {
    if (typeof seg === 'number') s += `[${seg}]`
    else if (IDENT.test(seg)) s += `.${seg}`
    else s += `[${JSON.stringify(seg)}]`
  }
  return s.startsWith('[') ? '.' + s : s
}

export function getAt(root: Json, p: Seg[]): Json | undefined {
  let cur: Json | undefined = root
  for (const seg of p) {
    if (!isContainer(cur)) return undefined
    cur = (cur as Record<string, Json>)[seg as string]
  }
  return cur
}

export const sizeOf = (v: Json) => (Array.isArray(v) ? v.length : isContainer(v) ? Object.keys(v).length : 0)

export function summary(v: Json): string {
  if (Array.isArray(v)) return `${v.length.toLocaleString()} ${v.length === 1 ? 'item' : 'items'}`
  if (isContainer(v)) {
    const n = Object.keys(v).length
    return `${n.toLocaleString()} ${n === 1 ? 'key' : 'keys'}`
  }
  return ''
}

export function leafText(v: Json, max = 160): string {
  const s = typeof v === 'string' ? JSON.stringify(v) : String(v)
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export type Row = { path: Seg[]; key: Seg | null; value: Json; depth: number; kind: Kind; open: boolean }

/** Visible rows of the tree given the set of expanded paths (pathKey). */
export function flatten(root: Json, expanded: Set<string>): Row[] {
  const rows: Row[] = []
  const stack: { path: Seg[]; key: Seg | null; value: Json; depth: number }[] = [{ path: [], key: null, value: root, depth: 0 }]
  while (stack.length) {
    const n = stack.pop()!
    const kind = kindOf(n.value)
    const open = isContainer(n.value) && expanded.has(pathKey(n.path))
    rows.push({ ...n, kind, open })
    if (!open) continue
    if (Array.isArray(n.value)) {
      for (let i = n.value.length - 1; i >= 0; i--) stack.push({ path: [...n.path, i], key: i, value: n.value[i], depth: n.depth + 1 })
    } else {
      const keys = Object.keys(n.value as object)
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i]
        stack.push({ path: [...n.path, k], key: k, value: (n.value as Record<string, Json>)[k], depth: n.depth + 1 })
      }
    }
  }
  return rows
}

export function countNodes(root: Json): number {
  let n = 0
  const stack: Json[] = [root]
  while (stack.length) {
    const v = stack.pop()!
    n++
    if (Array.isArray(v)) for (const c of v) stack.push(c)
    else if (isContainer(v)) for (const k in v) stack.push(v[k])
  }
  return n
}

/** Paths whose key or leaf value contains `q` (case-insensitive), in document order. */
export function searchPaths(root: Json, q: string, limit = 5000): Seg[][] {
  const out: Seg[][] = []
  const needle = q.toLowerCase()
  if (!needle) return out
  const walk = (v: Json, path: Seg[]) => {
    if (out.length >= limit) return
    if (Array.isArray(v)) v.forEach((c, i) => walk(c, [...path, i]))
    else if (isContainer(v)) {
      for (const k in v) {
        if (out.length >= limit) return
        const child = v[k]
        if (k.toLowerCase().includes(needle) && !isContainer(child)) out.push([...path, k])
        else if (k.toLowerCase().includes(needle)) { out.push([...path, k]); walk(child, [...path, k]) }
        else walk(child, [...path, k])
      }
    } else if (String(v).toLowerCase().includes(needle)) {
      if (out.at(-1)?.length !== path.length || pathKey(out.at(-1)!) !== pathKey(path)) out.push(path)
    }
  }
  walk(root, [])
  return out
}

export type Source = { name: string; text: string; bytes: number; isUrl: boolean; path?: string }

export async function loadSource(arg: string): Promise<Source> {
  if (/^https?:\/\//.test(arg)) {
    const res = await fetch(arg, { headers: { 'user-agent': 'jx', accept: 'application/json' } })
    if (!res.ok) throw new Error(`${arg}: HTTP ${res.status}`)
    const text = await res.text()
    return { name: new URL(arg).host + new URL(arg).pathname, text, bytes: Buffer.byteLength(text), isUrl: true }
  }
  return readSource(arg)
}

export function readSource(path: string): Source {
  const raw = readFileSync(path)
  const text = path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
  return { name: path.split('/').pop()!, text, bytes: path.endsWith('.gz') ? Buffer.byteLength(text) : statSync(path).size, isUrl: false, path }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}
