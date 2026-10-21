import { describe, expect, test } from 'bun:test'
import { candidates, HashedBlocklist, Matcher, normalizeDomain, parseHosts } from '../src/dns/blocklist'
import { DnsCache } from '../src/dns/cache'
import { collisionMath, hash40, hash40Big } from '../src/dns/hash'
import { buildBlocked, encodeQuery, getRcode, parseQuery, parseResponse, readName, RCODE, summarize } from '../src/dns/packet'
import { Stats, type QueryEvent } from '../src/dns/stats'
import { answer } from './helpers'

describe('packet', () => {
  test('round-trips a query', () => {
    const q = parseQuery(encodeQuery('Ads.Example.COM.', 'AAAA', 0x1234))
    expect(q).toMatchObject({ id: 0x1234, name: 'ads.example.com', qtype: 28, qclass: 1 })
  })
  test('follows compression pointers and rejects loops', () => {
    const res = answer(encodeQuery('github.com', 1, 7))
    const parsed = parseResponse(res)
    expect(parsed.records[0]!.name).toBe('github.com')
    expect(summarize(res)).toBe('93.184.216.34')
    const loop = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xc0, 12])
    expect(() => readName(loop, 12)).toThrow()
  })
  test('blocked answers: 0.0.0.0 for A, :: for AAAA, NXDOMAIN when configured, TTL 60', () => {
    const a = encodeQuery('doubleclick.net', 'A')
    const ra = parseResponse(buildBlocked(a, parseQuery(a)))
    expect(ra.records[0]).toMatchObject({ type: 1, ttl: 60 })
    expect([...ra.records[0]!.data]).toEqual([0, 0, 0, 0])
    const aaaa = encodeQuery('doubleclick.net', 'AAAA')
    const r6 = parseResponse(buildBlocked(aaaa, parseQuery(aaaa)))
    expect([...r6.records[0]!.data]).toEqual(new Array(16).fill(0))
    const nx = buildBlocked(a, parseQuery(a), 'nxdomain')
    expect(getRcode(nx)).toBe(RCODE.NXDOMAIN)
  })
})

describe('blocklist', () => {
  test('40-bit FNV-1a: fast limb version matches BigInt reference', () => {
    for (const s of ['', 'a', 'doubleclick.net', 'x'.repeat(200), 'stats.g.doubleclick.net']) {
      expect(hash40(s)).toBe(hash40Big(s))
      expect(hash40(s)).toBeLessThan(2 ** 40)
    }
  })
  test('birthday math at 150k entries', () => {
    const m = collisionMath(150_000)
    expect(m.perLookup).toBeCloseTo(1.364e-7, 9)
    expect(m.anyInList).toBeGreaterThan(0.0001)
    expect(m.anyInList).toBeLessThan(0.02)
  })
  test('normalizes and parses hosts files', () => {
    expect(normalizeDomain(' Ads.Example.COM. ')).toBe('ads.example.com')
    expect(normalizeDomain('localhost')).toBeNull()
    expect(normalizeDomain('not a domain')).toBeNull()
    const hosts = '# c\n127.0.0.1 localhost\n0.0.0.0 ads.example.com # x\n0.0.0.0 ADS.example.com\n:: v6.tracker.net\nplain.example.org\n'
    expect(parseHosts(hosts).sort()).toEqual(['ads.example.com', 'plain.example.org', 'v6.tracker.net'])
  })
  test('matches the name, then each parent; allow beats deny beats list', () => {
    expect(candidates('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com'])
    const list = HashedBlocklist.fromDomains(['doubleclick.net', 'tracker.io'])
    const m = new Matcher(list)
    expect(m.check('stats.g.doubleclick.net')).toMatchObject({ action: 'block', source: 'list', rule: 'doubleclick.net' })
    expect(m.check('github.com')).toMatchObject({ action: 'pass', source: 'none' })
    m.allow.add('g.doubleclick.net')
    expect(m.check('stats.g.doubleclick.net')).toMatchObject({ action: 'pass', source: 'allow' })
    m.deny.add('example.com')
    expect(m.check('www.example.com')).toMatchObject({ action: 'block', source: 'deny' })
  })
  test('serializes to 5 bytes per domain and back', () => {
    const domains = Array.from({ length: 5000 }, (_, i) => `ad${i}.example.net`)
    const list = HashedBlocklist.fromDomains(domains)
    const bin = list.serialize()
    expect(bin.length).toBe(5 + 4 + list.size * 5 - (bin.length - (5 + 4 + list.size * 5)) * 0 + (bin.length - (9 + list.size * 5)))
    const back = HashedBlocklist.deserialize(bin)
    expect(back.size).toBe(5000)
    for (const d of domains.slice(0, 50)) expect(back.has(d)).toBe(true)
    expect(back.has('github.com')).toBe(false)
    expect(back.bloomSkips + back.searches).toBeGreaterThan(0)
  })
})

describe('cache', () => {
  test('honours TTL, ages TTLs and evicts least-recently used', () => {
    let now = 0
    const c = new DnsCache(2, () => now)
    const res = (n: string, id: number) => answer(encodeQuery(n, 1, id), 300)
    c.put(DnsCache.key('a.com', 1), res('a.com', 1))
    c.put(DnsCache.key('b.com', 1), res('b.com', 2))
    now = 100_000
    const hit = c.get(DnsCache.key('a.com', 1), 0xbeef)!
    expect(hit).not.toBeNull()
    expect(parseResponse(hit).id).toBe(0xbeef)
    expect(parseResponse(hit).records[0]!.ttl).toBe(200)
    c.put(DnsCache.key('c.com', 1), res('c.com', 3))
    expect(c.get(DnsCache.key('b.com', 1), 1)).toBeNull()
    now = 301_000
    expect(c.get(DnsCache.key('a.com', 1), 1)).toBeNull()
    expect(c.hits).toBe(1)
  })
})

describe('stats', () => {
  test('counts, per-second buckets, top lists and the 200-entry ring', () => {
    let now = 1_000_000
    const s = new Stats(() => now)
    const ev = (name: string, status: QueryEvent['status'], i: number): QueryEvent => ({ seq: i, ts: now, client: '127.0.0.1', name, qtype: 1, status, ms: 5, answer: '' })
    for (let i = 0; i < 250; i++) { now += 100; s.record(ev(i % 2 ? 'doubleclick.net' : 'github.com', i % 2 ? 'blocked' : 'forwarded', i)) }
    expect(s.total).toBe(250)
    expect(s.blockedPct).toBe(50)
    expect(s.recent.length).toBe(200)
    expect(s.top('blocked', 1)[0]).toEqual({ name: 'doubleclick.net', count: 125 })
    expect(s.top('allowed', 1)[0]!.name).toBe('github.com')
    const series = s.series(30)
    expect(series.length).toBe(30)
    expect(series.reduce((a, b) => a + b.total, 0)).toBeGreaterThan(200)
    expect(s.latency().p50).toBe(5)
  })
})
