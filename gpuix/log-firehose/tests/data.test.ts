import { describe, expect, it } from 'bun:test'
import { Controller } from '../src/controller'
import { LogGenerator } from '../src/generator'
import { compileSearch, rangesIn, SearchJob } from '../src/search'
import { LogStore } from '../src/store'
import { parseClock, parseIsoFast, parseLine, parseMeta } from '../src/parse'

const T0 = Date.UTC(2026, 9, 21, 14, 0, 0)

function filled(n: number) {
  const ctl = new Controller()
  ctl.gen.fill(ctl.store, n, T0, T0 + n / 10) // 10k lines/s of simulated time
  return ctl
}

describe('store', () => {
  it('round-trips lines across sealed chunks and the open chunk', () => {
    const s = new LogStore()
    const gen = new LogGenerator(7)
    const lines: string[] = []
    for (let i = 0; i < 40_000; i++) {
      const g = gen.line(T0 + i)
      lines.push(g.text)
      s.push(g.text, T0 + i, g.level, s.serviceId(String(g.service)))
    }
    expect(s.count).toBe(40_000)
    expect(s.chunks.length).toBe(2) // 2 × 16384 sealed, rest open
    for (const i of [0, 16_383, 16_384, 32_767, 32_768, 39_999]) expect(s.line(i)).toBe(lines[i]!)
    expect(s.lowerBoundTime(T0 + 20_000)).toBe(20_000)
  })
})

describe('parse', () => {
  it('parses the structured format', () => {
    const ctl = filled(10)
    const raw = ctl.store.line(3)
    const [ts, level, service] = parseMeta(raw, 0)
    expect(ts).toBe(ctl.store.ts[3]!)
    expect(level).toBe(ctl.store.level[3]!)
    expect(service).toBe(ctl.store.services[ctl.store.svc[3]!]!)
    const p = parseLine(raw)
    expect(p.requestId).toMatch(/^[0-9a-f]{8}$/)
    expect(JSON.parse(p.payload!)).toHaveProperty('trace_id')
    expect(parseIsoFast('2026-10-21T14:02:30.250Z')).toBe(Date.UTC(2026, 9, 21, 14, 2, 30, 250))
    expect(parseClock('14:02')).toBe((14 * 60 + 2) * 60_000)
    expect(parseClock('14:02:30.5')).toBe(((14 * 60 + 2) * 60 + 30) * 1000 + 500)
    expect(parseClock('25:00')).toBeNull()
  })
})

describe('search', () => {
  it('finds exactly the lines a naive scan finds, including streamed lines', () => {
    const ctl = filled(50_000)
    const re = compileSearch({ query: 'timeout|deadlock', regex: true, caseSensitive: false }) as RegExp
    const job = new SearchJob(ctl.store, re)
    while (!job.done) job.step(50)
    // stream more lines in, search catches up incrementally
    ctl.gen.fill(ctl.store, 5_000, T0 + 6000, T0 + 6500)
    job.step(50)
    const naive: number[] = []
    const test = new RegExp(re.source, 'i')
    for (let i = 0; i < ctl.store.count; i++) if (test.test(ctl.store.line(i))) naive.push(i)
    expect(naive.length).toBeGreaterThan(100)
    expect(Array.from(job.matches.data.subarray(0, job.matches.length))).toEqual(naive)
  })

  it('reports bad regexes and highlight ranges', () => {
    expect(compileSearch({ query: '(', regex: true, caseSensitive: false })).toBeTypeOf('string')
    const re = compileSearch({ query: 'a.b', regex: false, caseSensitive: false }) as RegExp
    expect(rangesIn(re, 'xA.Bx a.b axb')).toEqual([[1, 4], [6, 9]])
  })
})

describe('controller', () => {
  it('filters by level and service, and counts matches in view', () => {
    const ctl = filled(100_000)
    const errors = ctl.store.levelCounts[4]!
    ctl.toggleLevel(4, true)
    expect(ctl.view.count).toBe(errors)
    for (let k = 0; k < ctl.view.count; k += 97) expect(ctl.store.level[ctl.view.lineAt(k)]!).toBe(4)
    ctl.resetFilters()
    const payments = ctl.store.serviceIndex.get('payments')!
    ctl.toggleService(payments, true)
    expect(ctl.view.count).toBe(ctl.store.serviceCounts[payments]!)
    ctl.setSearch({ query: 'Charge', regex: false, caseSensitive: true })
    while (!ctl.job!.done) ctl.job!.step(50, (l) => ctl.view.onMatch(l))
    ctl.setOnlyMatches(true)
    expect(ctl.view.count).toBe(ctl.view.matchesInView)
    for (let k = 0; k < ctl.view.count; k += 13) {
      const line = ctl.view.lineAt(k)
      expect(ctl.store.svc[line]!).toBe(payments)
      expect(ctl.store.line(line)).toContain('Charge')
    }
    // next/prev wrap around and stay inside the filtered view
    const first = ctl.findMatch(-1, 1)
    expect(first).toBe(ctl.view.lineAt(0))
    expect(ctl.findMatch(first, -1)).toBe(ctl.view.lineAt(ctl.view.count - 1))
  })

  it('jumps to a clock time', () => {
    const ctl = filled(100_000) // 10 s from 14:00:00
    const line = ctl.lineAtClock(parseClock('14:00:05')!)
    expect(ctl.store.ts[line]!).toBeGreaterThanOrEqual(T0 + 5000)
    expect(ctl.store.ts[line - 1]!).toBeLessThan(T0 + 5000)
  })

  it('loads a large file in chunks with the same metadata', async () => {
    const src = filled(60_000)
    const path = `/tmp/firehose-test-${process.pid}.log`
    const text: string[] = []
    for (let i = 0; i < src.store.count; i++) text.push(src.store.line(i))
    await Bun.write(path, text.join('\n') + '\n')
    const ctl = new Controller()
    await ctl.loadFile(path)
    expect(ctl.store.count).toBe(60_000)
    expect(ctl.store.line(59_999)).toBe(src.store.line(59_999))
    expect(Array.from(ctl.store.levelCounts)).toEqual(Array.from(src.store.levelCounts))
    expect(ctl.hist.seconds).toBe(6)
  })
})
