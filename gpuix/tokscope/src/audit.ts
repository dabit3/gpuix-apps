import { repeatedCalls, sessionCost, topToolResults, totals, totalInput } from './analyze'
import { priceFor, type PriceSheet } from './prices'
import { SEGMENTS, SEGMENT_LABEL, type Session } from './types'

export type Fix = {
  id: string
  flag: string
  title: string
  area: string
  ship: 'ship' | 'flag'
  why: string
  change: string
  savings: number
  evidence: string[]
}

export const TRUNCATE_ABOVE = 2500
export const TRUNCATE_WINDOW = 1200
export const STALE_AFTER = 6
export const STUB = 60

const fmt$ = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`)
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`)
export { fmt$, fmtK }

/** Rank the prompt's Phase 2 opportunities by estimated $ impact on these transcripts. */
export function findFixes(sessions: Session[], sheet: PriceSheet): Fix[] {
  const fixes: Fix[] = []
  const t = totals(sessions)

  // Tool results: head/tail truncation with the full text on disk.
  let trunc = 0
  const truncEv: string[] = []
  const bigResults = sessions.flatMap((s) => s.items).filter((it) => it.seg === 'toolResults' && it.tokens > TRUNCATE_ABOVE).sort((a, b) => b.carriedCost - a.carriedCost)
  for (const it of bigResults) {
        const save = it.carriedCost * (1 - TRUNCATE_WINDOW / it.tokens)
        trunc += save
        truncEv.push(`${it.label} — ${fmtK(it.tokens)} tok × ${it.carried} turns (${fmt$(it.carriedCost)})`)
      }
  fixes.push({
    id: 'truncate',
    flag: 'TOOL_RESULT_WINDOW',
    title: `Truncate tool results over ${fmtK(TRUNCATE_ABOVE)} tokens`,
    area: 'Tool results',
    ship: 'ship',
    why: 'Large file reads and command output are resent on every later turn.',
    change: `Keep a ${fmtK(TRUNCATE_WINDOW)}-token head/tail window, write the full output to disk and return its path plus line ranges.`,
    savings: trunc,
    evidence: truncEv.slice(0, 6),
  })

  // History: elide stale tool results once they've been used.
  let stale = 0
  for (const s of sessions)
    for (const it of s.items)
      if (it.seg === 'toolResults' && it.carried > STALE_AFTER && it.tokens > STUB * 2) {
        const keep = Math.min(it.tokens, TRUNCATE_ABOVE) // after truncation
        stale += (it.carriedCost * (it.carried - STALE_AFTER)) / it.carried * (1 - STUB / it.tokens) * (keep / it.tokens)
      }
  fixes.push({
    id: 'elide',
    flag: 'ELIDE_STALE_RESULTS',
    title: `Elide tool results ${STALE_AFTER}+ turns old`,
    area: 'History',
    ship: 'flag',
    why: 'Old outputs that the model already acted on keep riding along in history.',
    change: `Replace results older than ${STALE_AFTER} turns with a ${STUB}-token stub ("output of X, re-run to view"). Behaviour-affecting: eval before shipping.`,
    savings: stale,
    evidence: [],
  })

  // Repeated identical calls.
  const reps = repeatedCalls(sessions)
  let dup = 0
  const repKeys = new Set(reps.map((r) => r.key))
  for (const s of sessions) {
    const seen = new Set<string>()
    for (const c of s.toolCalls) {
      if (!repKeys.has(c.key)) continue
      if (seen.has(c.key)) dup += s.items.find((i) => i.uuid === c.uuid)?.carriedCost ?? 0
      seen.add(c.key)
    }
  }
  fixes.push({
    id: 'dedupe',
    flag: 'DEDUPE_TOOL_CALLS',
    title: 'Answer repeated identical tool calls from history',
    area: 'Retries & loops',
    ship: 'flag',
    why: 'The same read or listing is executed again while the earlier result is still in context.',
    change: 'When a read-only call matches an earlier one and its inputs are unchanged, return "unchanged since turn N" instead of the full output.',
    savings: dup,
    evidence: reps.slice(0, 5).map((r) => `${r.label} ×${r.count} (${r.session})`),
  })

  // Cache layout: prefix changes and TTL expiry.
  let prefix = 0
  let ttl = 0
  const prefixEv: string[] = []
  const ttlEv: string[] = []
  for (const s of sessions)
    for (const r of s.requests) {
      if (!r.cacheBreak) continue
      const p = priceFor(sheet, r.model)
      const lost = (r.cacheBreak.lostTokens * (p.cacheWrite - p.cacheRead)) / 1e6
      if (r.cacheBreak.reason.startsWith('idle')) {
        ttl += lost
        ttlEv.push(`${s.title}, turn ${r.index + 1}: ${r.cacheBreak.reason}`)
      } else {
        prefix += lost
        prefixEv.push(`${s.title}, turn ${r.index + 1}: ${r.cacheBreak.reason}`)
      }
    }
  fixes.push({
    id: 'prefix',
    flag: 'STABLE_PREFIX',
    title: 'Make the system + tools prefix byte-identical',
    area: 'Cache layout',
    ship: 'ship',
    why: 'Timestamps or reordered tools in the prefix invalidate the cache on every turn.',
    change: 'Move volatile values (date, cwd state) into the latest user turn; sort tools deterministically; keep the breakpoint after the stable prefix.',
    savings: prefix,
    evidence: prefixEv.slice(0, 5),
  })
  fixes.push({
    id: 'ttl',
    flag: 'CACHE_TTL_1H',
    title: 'Use the 1-hour cache for sessions with idle gaps',
    area: 'Cache layout',
    ship: 'flag',
    why: 'Gaps longer than the 5-minute TTL force a full cache rewrite.',
    change: 'Request the 1h TTL (2× write price) when the harness expects the user to come back; measure write premium vs. saved rewrites.',
    savings: ttl * 0.6,
    evidence: ttlEv.slice(0, 5),
  })

  // Tool definitions: lazy-load rarely used tools.
  const used = new Set(sessions.flatMap((s) => s.toolCalls.map((c) => c.name)))
  const toolCost = t.segCost.tools
  const unusedShare = Math.max(0, 1 - (used.size + 2) / 15)
  fixes.push({
    id: 'lazy',
    flag: 'LAZY_TOOLS',
    title: 'Lazy-load rarely used tools behind a tool-search tool',
    area: 'Tool definitions',
    ship: 'flag',
    why: `Only ${used.size} tools were called across these sessions, but every schema is sent on every turn.`,
    change: 'Keep core tools resident; expose the rest through a search_tools tool that injects the schema on demand.',
    savings: toolCost * unusedShare,
    evidence: [`tools called: ${[...used].sort().join(', ') || 'none'}`],
  })

  // Sub-agents on the expensive model.
  const route = priceFor(sheet, sheet.route.match)
  let sub = 0
  const subEv: string[] = []
  for (const s of sessions) {
    const side = s.requests.filter((r) => r.sidechain)
    if (!side.length) continue
    const c = side.reduce((a, r) => a + r.cost, 0)
    const p = priceFor(sheet, side[0]!.model)
    if (p === route) continue
    sub += c * (1 - route.input / p.input)
    subEv.push(`${s.title}: ${side.length} requests on ${side[0]!.model} (${fmt$(c)})`)
  }
  fixes.push({
    id: 'route',
    flag: 'EXPLORE_ON_CHEAP_MODEL',
    title: `Route exploration sub-agents to ${sheet.route.label}`,
    area: 'Sub-agents',
    ship: 'flag',
    why: 'Read-only exploration runs on the most expensive model.',
    change: `Run search/explore sub-agents on ${sheet.route.label} and have them return compact findings (paths + line ranges), not raw file dumps.`,
    savings: sub,
    evidence: subEv,
  })

  return fixes.filter((f) => f.savings > 0.0005).sort((a, b) => b.savings - a.savings)
}

/** Overlapping savings combine multiplicatively: each fix applies to what is left. */
export function projectedCost(cost: number, fixes: Pick<Fix, 'savings'>[]): number {
  if (cost <= 0) return 0
  return fixes.reduce((c, f) => c * Math.max(0, 1 - f.savings / cost), cost)
}

export function auditMarkdown(sessions: Session[], sheet: PriceSheet, sources: string[], now = new Date()): string {
  const t = totals(sessions)
  const fixes = findFixes(sessions, sheet)
  const saved = t.cost - projectedCost(t.cost, fixes)
  const tasks = sessions.filter((s) => !s.id.includes('/'))
  const L: string[] = []
  L.push('# AUDIT.md — agent token-efficiency audit', '')
  L.push(`Generated by tokscope on ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC from ${sessions.length} transcripts (${t.requests} API requests) in ${sources.join(', ')}.`, '')
  L.push('> Savings below are **projections** from replaying the recorded transcripts with each change applied. They are not eval results: confirm each flag with 3× runs of your eval set before shipping, and ignore any saving smaller than run-to-run variance.', '')
  L.push('## Request assembly (as observed)', '', '```')
  L.push('system prompt ─┐', 'tool schemas ──┼─ stable prefix ── cache breakpoint', 'memory/CLAUDE.md, reminders ─┐', 'history (user, assistant, tool calls) ─┼─ conversation ── cache breakpoint (last message)', 'tool results ─┘', '                 └──▶ request ──▶ model ──▶ output (text, thinking, tool calls)')
  L.push('```', '')
  L.push('## Baseline', '')
  L.push(`| | |`, `|---|---|`)
  L.push(`| Total cost | ${fmt$(t.cost)} |`, `| Cost per task | ${fmt$(t.cost / Math.max(1, tasks.length))} (${tasks.length} tasks) |`, `| Requests per task | ${(t.requests / Math.max(1, tasks.length)).toFixed(1)} |`)
  L.push(`| Input tokens | ${fmtK(totalInput(t.usage))} (${fmtK(t.usage.cacheRead)} cache read, ${fmtK(t.usage.cacheWrite)} cache write, ${fmtK(t.usage.input)} uncached) |`)
  L.push(`| Cache hit rate | ${(t.cacheHit * 100).toFixed(1)}% |`, `| Cache breaks | ${t.cacheBreaks} |`, `| Output tokens | ${fmtK(t.usage.output)} |`, '')
  L.push('### Cost by segment', '', '| Segment | Tokens sent | Cost | Share |', '|---|---:|---:|---:|')
  for (const k of SEGMENTS) L.push(`| ${SEGMENT_LABEL[k]} | ${fmtK(t.seg[k])} | ${fmt$(t.segCost[k])} | ${((t.segCost[k] / (t.cost || 1)) * 100).toFixed(1)}% |`)
  L.push('', 'Segment sizes are estimated from transcript content (~3.7 chars/token) and scaled so each request matches its billed input; cache reads are attributed to the start of the prompt.', '')
  L.push('### Cost per task', '', '| Task | Project | Requests | Cost | Cache hit |', '|---|---|---:|---:|---:|')
  for (const s of sessions) {
    const inp = s.requests.reduce((a, r) => a + totalInput(r.usage), 0)
    const cr = s.requests.reduce((a, r) => a + r.usage.cacheRead, 0)
    L.push(`| ${s.title} | ${s.project} | ${s.requests.length} | ${fmt$(sessionCost(s))}${s.reportedCostUSD != null ? ` (harness: ${fmt$(s.reportedCostUSD)})` : ''} | ${((cr / (inp || 1)) * 100).toFixed(0)}% |`)
  }
  L.push('', '## Biggest offenders', '', '| Tool result | Size | Resent | Cost |', '|---|---:|---:|---:|')
  for (const o of topToolResults(sessions, 8)) L.push(`| ${o.label.replace(/\|/g, '\\|')} | ${fmtK(o.tokens)} | ${o.carried}× | ${fmt$(o.cost)} |`)
  L.push('', '## Findings, ranked by estimated impact', '')
  fixes.forEach((f, i) => {
    L.push(`### ${i + 1}. ${f.title} — ${fmt$(f.savings)} (${((f.savings / (t.cost || 1)) * 100).toFixed(1)}%)`, '')
    L.push(`- **Area:** ${f.area}`, `- **Why:** ${f.why}`, `- **Change:** ${f.change}`, `- **Rollout:** ${f.ship === 'ship' ? `safe mechanical change, ship behind \`${f.flag}\` default-on` : `behind \`${f.flag}\` (default off) until the eval shows no quality drop`}`)
    for (const e of f.evidence) L.push(`  - ${e}`)
    L.push('')
  })
  L.push(`Combined projected saving if every finding holds: **${fmt$(saved)}** of ${fmt$(t.cost)} (${((saved / (t.cost || 1)) * 100).toFixed(0)}%). Findings overlap, so savings are combined multiplicatively rather than summed.`, '')
  L.push('## Shipped vs. flagged', '')
  L.push(`- Ship now (mechanical, reversible): ${fixes.filter((f) => f.ship === 'ship').map((f) => `\`${f.flag}\``).join(', ') || 'none'}`)
  L.push(`- Behind flags pending eval: ${fixes.filter((f) => f.ship === 'flag').map((f) => `\`${f.flag}\``).join(', ') || 'none'}`, '')
  L.push('## Not done here', '', '- No eval set was run: tokscope reads transcripts, it does not re-run tasks, so quality deltas are unmeasured.', '- Output tokens are reported but not targeted: per the audit rules, fix verbosity through harness structure, never by telling the model to be brief.', '- Retrieval chunking/top-k: Claude Code transcripts carry injected memory and reminders, not a retriever, so they are counted as retrieved context.', '')
  L.push('## Next 3 ideas', '')
  const next = [
    ['Diff-based re-reads', 'return a diff when a file is read again after an edit, instead of the full file', t.segCost.toolResults * 0.08],
    ['Sparse line numbers', 'number every 10th line in Read output instead of every line', t.segCost.toolResults * 0.05],
    ['Compaction that keeps file pointers', 'keep paths + line ranges in compaction summaries to avoid post-compaction re-reads', t.segCost.history * 0.1],
  ] as const
  next.forEach(([a, b, c], i) => L.push(`${i + 1}. **${a}** — ${b}. Est. ${fmt$(c)}.`))
  L.push('', '## Price sheet', '', `${sheet.note}`, '', '| Model match | Input | Output | Cache write | Cache read |', '|---|---:|---:|---:|---:|')
  for (const p of sheet.models) L.push(`| ${p.match || '(default)'} | ${p.input} | ${p.output} | ${p.cacheWrite} | ${p.cacheRead} |`)
  L.push('')
  return L.join('\n')
}
