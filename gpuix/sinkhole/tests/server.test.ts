import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { runBench } from '../src/bench'
import { HashedBlocklist, Matcher } from '../src/dns/blocklist'
import { getRcode, parseResponse, RCODE, summarize } from '../src/dns/packet'
import { Sinkhole } from '../src/dns/server'
import { AD_DOMAINS } from '../src/corpus'
import { ask, fakeUpstream } from './helpers'

let up: Awaited<ReturnType<typeof fakeUpstream>>
let dead: Awaited<ReturnType<typeof fakeUpstream>>
let s: Sinkhole
beforeAll(async () => {
  up = await fakeUpstream()
  dead = await fakeUpstream({ silent: true })
  s = new Sinkhole({ port: 0, upstreams: [up.addr], matcher: new Matcher(HashedBlocklist.fromDomains(AD_DOMAINS)) })
  await s.start()
})
afterAll(() => { s.stop(); up.close(); dead.close() })

describe('sinkhole over real UDP', () => {
  test('sinks ads (and their subdomains), forwards the rest, then serves it from cache', async () => {
    expect(summarize(await ask(s.port, 'doubleclick.net'))).toBe('0.0.0.0')
    expect(summarize(await ask(s.port, 'stats.g.doubleclick.net', 'AAAA'))).toBe('::')
    const before = up.hits
    expect(summarize(await ask(s.port, 'github.com'))).toBe('93.184.216.34')
    expect(up.hits).toBe(before + 1)
    expect(summarize(await ask(s.port, 'github.com'))).toBe('93.184.216.34')
    expect(up.hits).toBe(before + 1)
    const statuses = s.stats.recent.map((e) => e.status).reverse()
    expect(statuses).toEqual(['blocked', 'blocked', 'forwarded', 'cached'])
  })
  test('allowlist, NXDOMAIN mode and pause', async () => {
    s.matcher.allow.add('doubleclick.net')
    expect(summarize(await ask(s.port, 'doubleclick.net'))).toBe('93.184.216.34')
    expect(s.stats.recent[0]!.status).toBe('allowed')
    s.matcher.allow.delete('doubleclick.net')
    s.blockMode = 'nxdomain'
    expect(getRcode(await ask(s.port, 'taboola.com'))).toBe(RCODE.NXDOMAIN)
    s.blockMode = 'null'
    s.pause(5)
    expect(s.blocking).toBe(false)
    expect(summarize(await ask(s.port, 'outbrain.com'))).toBe('93.184.216.34')
    s.pause(0)
    expect(summarize(await ask(s.port, 'outbrain.com'))).toBe('0.0.0.0')
  })
  test('falls back to the second upstream and answers SERVFAIL when both are silent', async () => {
    s.setUpstreams([dead.addr, up.addr])
    s.fallbackAfterMs = 150
    const res = await ask(s.port, 'fallback.example.org')
    expect(summarize(res)).toBe('93.184.216.34')
    expect(dead.hits).toBeGreaterThan(0)
    s.setUpstreams([dead.addr])
    s.timeoutMs = 400
    const fail = await ask(s.port, 'nowhere.example.org')
    expect(getRcode(fail)).toBe(RCODE.SERVFAIL)
    expect(s.stats.recent[0]!.status).toBe('failed')
    s.setUpstreams([up.addr])
    s.timeoutMs = 2000
  })
  test('1,000 mixed queries: every answer back, every ad sunk, ≥ 50 q/s paced and unpaced', async () => {
    const r = await runBench({ port: s.port, n: 1000, seed: 3 })
    expect(r.answered).toBe(1000)
    expect(r.blockedOk).toBe(r.adsExpected)
    expect(r.resolvedOk).toBe(r.normalExpected)
    expect(r.qps).toBeGreaterThan(50)
    const paced = await runBench({ port: s.port, n: 150, rate: 75, seed: 4 })
    expect(paced.answered).toBe(150)
    expect(s.dropped).toBe(0)
    expect(parseResponse(await ask(s.port, 'github.com')).rcode).toBe(0)
  }, 20_000)
})
