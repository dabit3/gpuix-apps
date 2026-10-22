import { priceFor, type PriceSheet } from './prices'
import { INPUT_SEGMENTS, type InputSegment, type Request, type Segment, type Session, type Totals, type Usage } from './types'

export const zeroSeg = (): Record<Segment, number> => ({ system: 0, tools: 0, history: 0, context: 0, toolResults: 0, output: 0 })

export type Entry = { seg: InputSegment; tokens: number; ref?: string }

/**
 * Bill an ordered prompt. Prompt caching is prefix-based, so the first `cacheRead`
 * tokens are reads, the next `cacheWrite` tokens are writes, and the rest is uncached.
 * Returns the $ cost of each entry.
 */
export function billEntries(entries: Entry[], usage: Usage, p: { input: number; cacheWrite: number; cacheRead: number }): number[] {
  const out: number[] = new Array(entries.length).fill(0)
  let read = usage.cacheRead
  let write = usage.cacheWrite
  for (let i = 0; i < entries.length; i++) {
    let t = entries[i]!.tokens
    let c = 0
    const r = Math.min(t, read)
    read -= r
    t -= r
    c += r * p.cacheRead
    const w = Math.min(t, write)
    write -= w
    t -= w
    c += w * p.cacheWrite
    c += t * p.input
    out[i] = c / 1e6
  }
  return out
}

export function totalInput(u: Usage): number {
  return u.input + u.cacheWrite + u.cacheRead
}

/** Scale estimated segment sizes so they add up to the billed input of the request. */
export function requestEntries(r: Request, prefix: { system: number; tools: number }): Entry[] {
  const billed = totalInput(r.usage)
  const est: Entry[] = [
    { seg: 'system', tokens: r.estSystem >= 0 ? r.estSystem : prefix.system },
    { seg: 'tools', tokens: r.estSystem >= 0 && r.estTools >= 0 ? r.estTools : prefix.tools },
    ...r.chain.map((it) => ({ seg: it.seg, tokens: it.estTokens, ref: it.uuid })),
  ]
  const sum = est.reduce((a, e) => a + e.tokens, 0) || 1
  const f = billed / sum
  return est.map((e) => ({ ...e, tokens: e.tokens * f }))
}

/** For transcripts without request shapes, infer the stable prefix from the smallest unexplained input. */
export function inferPrefix(s: Session, systemShare = 0.25): { system: number; tools: number } {
  let best = Infinity
  let known = -1
  for (const r of s.requests) {
    if (r.estSystem >= 0 && r.estTools >= 0) return { system: r.estSystem, tools: r.estTools }
    if (r.estSystem >= 0) known = r.estSystem
    const msgs = r.chain.reduce((a, it) => a + it.estTokens, 0)
    best = Math.min(best, totalInput(r.usage) - msgs)
  }
  const p = Number.isFinite(best) ? Math.max(best, 1500) : 8000
  // System prompt known (e.g. Codex logs it), tool schemas not: tools get the unexplained rest.
  if (known >= 0) return { system: known, tools: Math.max(0, p - known) }
  return { system: p * systemShare, tools: p * (1 - systemShare) }
}

export function analyzeSession(s: Session, sheet: PriceSheet): Session {
  const prefix = inferPrefix(s)
  const ttl = sheet.cacheTTLMinutes * 60_000
  for (const it of s.items) {
    it.carried = 0
    it.carriedCost = 0
    it.tokens = 0
  }
  const byUuid = new Map(s.items.map((it) => [it.uuid, it]))
  const lastByChain = new Map<string, Request>()
  for (const r of s.requests) {
    const p = priceFor(sheet, r.model)
    const entries = requestEntries(r, prefix)
    const costs = billEntries(entries, r.usage, p)
    r.seg = zeroSeg()
    r.segCost = zeroSeg()
    entries.forEach((e, i) => {
      r.seg[e.seg] += e.tokens
      r.segCost[e.seg] += costs[i]!
      if (e.ref) {
        const it = byUuid.get(e.ref)
        if (it) {
          if (it.firstReq === r.index) it.tokens = e.tokens
          it.carried++
          it.carriedCost += costs[i]!
        }
      }
    })
    r.seg.output = r.usage.output
    r.segCost.output = (r.usage.output * p.output) / 1e6
    r.cost = Object.values(r.segCost).reduce((a, b) => a + b, 0)

    const chainKey = r.sidechain ? 'side' : 'main'
    const prev = lastByChain.get(chainKey)
    r.cacheBreak = undefined
    r.prevId = prev?.id
    if (prev) {
      const expected = Math.min(totalInput(prev.usage), totalInput(r.usage))
      if (expected > 2000 && r.usage.cacheRead < expected * 0.5) {
        const lost = expected - r.usage.cacheRead
        const gap = r.ts - prev.ts
        const reason =
          prev.shapeHash && r.shapeHash && prev.shapeHash !== r.shapeHash
            ? 'system/tools prefix changed between turns'
            : gap > ttl
              ? `idle ${Math.round(gap / 60_000)} min, cache TTL expired`
              : 'prefix mutated mid-conversation'
        r.cacheBreak = { reason, lostTokens: lost }
      }
    }
    lastByChain.set(chainKey, r)
  }
  return s
}

export function totals(sessions: Session[]): Totals {
  const t: Totals = {
    requests: 0,
    usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
    seg: zeroSeg(),
    segCost: zeroSeg(),
    cost: 0,
    cacheHit: 0,
    cacheBreaks: 0,
  }
  for (const s of sessions)
    for (const r of s.requests) {
      t.requests++
      t.usage.input += r.usage.input
      t.usage.cacheWrite += r.usage.cacheWrite
      t.usage.cacheRead += r.usage.cacheRead
      t.usage.output += r.usage.output
      for (const k of Object.keys(t.seg) as Segment[]) {
        t.seg[k] += r.seg[k]
        t.segCost[k] += r.segCost[k]
      }
      t.cost += r.cost
      if (r.cacheBreak) t.cacheBreaks++
    }
  const inp = totalInput(t.usage)
  t.cacheHit = inp ? t.usage.cacheRead / inp : 0
  return t
}

export type Offender = { uuid: string; label: string; tool: string; tokens: number; carried: number; cost: number; preview: string; session: string }

export function topToolResults(sessions: Session[], n = 40): Offender[] {
  const all: Offender[] = []
  for (const s of sessions)
    for (const it of s.items)
      if (it.seg === 'toolResults')
        all.push({ uuid: it.uuid, label: it.label, tool: it.tool ?? 'tool', tokens: it.tokens, carried: it.carried, cost: it.carriedCost, preview: it.preview, session: s.title })
  return all.sort((a, b) => b.cost - a.cost).slice(0, n)
}

export type Repeat = { key: string; name: string; label: string; count: number; wastedTokens: number; session: string }

export function repeatedCalls(sessions: Session[]): Repeat[] {
  const out: Repeat[] = []
  for (const s of sessions) {
    const g = new Map<string, { n: number; tok: number; name: string; input: string }>()
    for (const c of s.toolCalls) {
      const e = g.get(c.key)
      if (e) {
        e.n++
        e.tok += c.resultTokens
      } else g.set(c.key, { n: 1, tok: 0, name: c.name, input: c.input })
    }
    for (const [key, e] of g)
      if (e.n > 1) out.push({ key, name: e.name, label: `${e.name} ${e.input.slice(0, 80)}`, count: e.n, wastedTokens: e.tok, session: s.title })
  }
  return out.sort((a, b) => b.wastedTokens - a.wastedTokens)
}

export function sessionCost(s: Session): number {
  return s.requests.reduce((a, r) => a + r.cost, 0)
}

export { INPUT_SEGMENTS }
