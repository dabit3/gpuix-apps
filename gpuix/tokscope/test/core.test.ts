import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { billEntries, repeatedCalls, totals, topToolResults } from '../src/analyze'
import { auditMarkdown, findFixes, projectedCost } from '../src/audit'
import { loadSessions, resetCache } from '../src/load'
import { parseTranscript } from '../src/parse'
import { DEFAULT_PRICES } from '../src/prices'

const SAMPLE = join(import.meta.dir, '..', 'sample')

function load() {
  resetCache()
  return loadSessions([SAMPLE], DEFAULT_PRICES).sessions
}

describe('billing', () => {
  it('bills the prompt positionally: reads first, then writes, then uncached', () => {
    const costs = billEntries(
      [
        { seg: 'system', tokens: 1000 },
        { seg: 'history', tokens: 1000 },
        { seg: 'toolResults', tokens: 1000 },
      ],
      { cacheRead: 1000, cacheWrite: 1000, input: 1000, output: 0 },
      { input: 3, cacheWrite: 3.75, cacheRead: 0.3 },
    )
    expect(costs[0]).toBeCloseTo(0.0003, 8)
    expect(costs[1]).toBeCloseTo(0.00375, 8)
    expect(costs[2]).toBeCloseTo(0.003, 8)
  })

  it('combines overlapping savings multiplicatively', () => {
    expect(projectedCost(10, [{ savings: 5 }, { savings: 5 }])).toBeCloseTo(2.5)
    expect(projectedCost(10, [])).toBe(10)
  })
})

describe('parser', () => {
  const lines = [
    { type: 'api-request-shape', shapeHash: 'a', shape: { system: [{ type: 'text', text: 'x'.repeat(3700) }], tools: [] } },
    { type: 'api-request', shapeHash: 'a' },
    { type: 'user', uuid: 'u1', parentUuid: null, sessionId: 's', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'read the file' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: 's', timestamp: '2026-01-01T00:00:01Z', message: { id: 'm1', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } }], usage: { input_tokens: 5, cache_creation_input_tokens: 1100, cache_read_input_tokens: 0, output_tokens: 20 } } },
    { type: 'user', uuid: 'u2', parentUuid: 'a1', sessionId: 's', timestamp: '2026-01-01T00:00:02Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'y'.repeat(7400) }] } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u2', sessionId: 's', timestamp: '2026-01-01T00:00:03Z', message: { id: 'm2', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 5, cache_creation_input_tokens: 2000, cache_read_input_tokens: 1100, output_tokens: 4 } } },
    { type: 'assistant', uuid: 'a2b', parentUuid: 'a2', sessionId: 's', timestamp: '2026-01-01T00:00:03Z', message: { id: 'm2', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'same response, second block' }], usage: { input_tokens: 5, cache_creation_input_tokens: 2000, cache_read_input_tokens: 1100, output_tokens: 4 } } },
    'not json',
    { type: 'summary', summary: 'Read a file', leafUuid: 'a2b' },
  ]
  const text = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')
  const [s] = parseTranscript(text, '/x/-Users-me-proj/s.jsonl')

  it('dedupes multi-block responses by message id and skips bad lines', () => {
    expect(s).toBeDefined()
    expect(s!.requests.length).toBe(2)
    expect(s!.title).toBe('Read a file')
  })

  it('maps tool results and links them to the call', () => {
    const tr = s!.items.find((i) => i.seg === 'toolResults')
    expect(tr?.tool).toBe('Read')
    expect(tr?.firstReq).toBe(1)
    expect(s!.toolCalls[0]!.key).toBe('Read:{"file_path":"/a.ts"}')
    expect(s!.requests[1]!.chain.some((i) => i.seg === 'toolResults')).toBe(true)
    expect(s!.requests[0]!.estSystem).toBe(1000)
  })
})

describe('bundled sample', () => {
  const sessions = load()
  const t = totals(sessions)

  it('loads every transcript including the sub-agent file', () => {
    expect(sessions.length).toBe(7)
    expect(sessions.filter((s) => s.id.includes('/')).length).toBe(1)
    expect(sessions.every((s) => s.title.length > 0 && s.title !== 'untitled session')).toBe(true)
  })

  it('segment tokens add up to billed tokens', () => {
    const seg = t.seg.system + t.seg.tools + t.seg.history + t.seg.context + t.seg.toolResults
    expect(seg).toBeCloseTo(t.usage.input + t.usage.cacheRead + t.usage.cacheWrite, 0)
    expect(t.seg.output).toBe(t.usage.output)
    const segCost = Object.values(t.segCost).reduce((a, b) => a + b, 0)
    expect(segCost).toBeCloseTo(t.cost, 6)
  })

  it('finds the planted problems', () => {
    const flaky = sessions.find((s) => s.title.includes('flaky'))!
    expect(flaky.requests.filter((r) => r.cacheBreak?.reason.includes('prefix changed')).length).toBeGreaterThan(5)
    const slow = sessions.find((s) => s.title.includes('slow'))!
    expect(slow.requests.some((r) => r.cacheBreak?.reason.startsWith('idle'))).toBe(true)
    expect(repeatedCalls(sessions).some((r) => r.label.includes('ls -R src') && r.count === 3)).toBe(true)
    expect(topToolResults(sessions, 1)[0]!.carried).toBeGreaterThan(3)
  })

  it('ranks fixes and writes a complete AUDIT.md', () => {
    const fixes = findFixes(sessions, DEFAULT_PRICES)
    expect(fixes.map((f) => f.id)).toContain('truncate')
    expect(fixes.map((f) => f.id)).toContain('prefix')
    for (let i = 1; i < fixes.length; i++) expect(fixes[i - 1]!.savings).toBeGreaterThanOrEqual(fixes[i]!.savings)
    const md = auditMarkdown(sessions, DEFAULT_PRICES, ['sample/'])
    for (const h of ['## Request assembly', '## Baseline', '### Cost by segment', '## Biggest offenders', '## Findings', '## Shipped vs. flagged', '## Next 3 ideas', '## Price sheet']) expect(md).toContain(h)
  })
})
