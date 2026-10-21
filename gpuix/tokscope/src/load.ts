import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { analyzeSession } from './analyze'
import { parseTranscript } from './parse'
import type { PriceSheet } from './prices'
import type { Session } from './types'

export function findTranscripts(paths: string[]): string[] {
  const out: string[] = []
  const walk = (p: string, depth: number) => {
    let st
    try {
      st = statSync(p)
    } catch {
      return
    }
    if (st.isFile()) {
      if (p.endsWith('.jsonl')) out.push(p)
      return
    }
    if (!st.isDirectory() || depth > 6) return
    for (const name of readdirSync(p)) {
      if (name.startsWith('.') || name === 'node_modules') continue
      walk(join(p, name), depth + 1)
    }
  }
  for (const p of paths) walk(resolve(p), 0)
  return [...new Set(out)].sort()
}

function projectName(file: string): string {
  const parts = file.split(sep)
  const i = parts.findIndex((s, k) => s.startsWith('-') && k < parts.length - 1)
  const raw = i >= 0 ? parts[i]! : parts[parts.length - 2] ?? 'project'
  const segs = raw.split('-').filter(Boolean)
  return segs.slice(Math.max(0, segs.length - (segs.at(-2) === 'code' || segs.at(-2) === 'work' ? 1 : 2))).join('-') || raw
}

type Cached = { size: number; mtime: number; sessions: Session[] }
const cache = new Map<string, Cached>()

/** Load + analyze all transcripts. Files whose size and mtime didn't change are reused. */
export function loadSessions(paths: string[], sheet: PriceSheet): { sessions: Session[]; files: number; changed: boolean } {
  const files = findTranscripts(paths)
  let changed = false
  const seen = new Set<string>()
  for (const f of files) {
    seen.add(f)
    let st
    try {
      st = statSync(f)
    } catch {
      continue
    }
    const c = cache.get(f)
    if (c && c.size === st.size && c.mtime === st.mtimeMs) continue
    changed = true
    const ss = parseTranscript(readFileSync(f, 'utf8'), f, st.mtimeMs)
    const sub = f.includes(`${sep}subagents${sep}`)
    for (const s of ss) {
      s.project = projectName(f)
      if (sub) s.id = `${s.id}/${basename(f, '.jsonl')}`
      analyzeSession(s, sheet)
    }
    cache.set(f, { size: st.size, mtime: st.mtimeMs, sessions: ss })
  }
  for (const k of [...cache.keys()]) if (!seen.has(k) && files.length) {
    cache.delete(k)
    changed = true
  }
  const sessions = files.flatMap((f) => cache.get(f)?.sessions ?? [])
  const byId = new Map(sessions.map((s) => [s.id, s]))
  for (const s of sessions) {
    const slash = s.id.indexOf('/')
    if (slash > 0) {
      const parent = byId.get(s.id.slice(0, slash))
      s.title = `sub-agent of “${parent?.title ?? 'session'}”`
      s.reportedCostUSD = undefined
    }
  }
  sessions.sort((a, b) => b.end - a.end || b.mtime - a.mtime)
  return { sessions, files: files.length, changed }
}

export function resetCache() {
  cache.clear()
}
