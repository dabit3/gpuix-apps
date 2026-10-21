import { describe, expect, it } from 'bun:test'
import { GAIT_GROUPS, adjacentLegs, len3, solveTwoBone, springAngle, sub3 } from '../src/math'
import { Spider, FEMUR, TIBIA } from '../src/spider'
import { Sim } from '../src/sim'
import { mockSerp, parseHtml, words } from '../src/page'
import { parseArgs } from '../src/cli'

describe('two-bone IK', () => {
  it('keeps segment lengths and reaches reachable targets', () => {
    const hip = { x: 0, y: 0, z: 14 }
    const target = { x: 40, y: 10, z: 2 }
    const { knee, end, reached } = solveTwoBone(hip, target, FEMUR, TIBIA, { x: 0, y: 0, z: 1 })
    expect(reached).toBe(true)
    expect(len3(sub3(knee, hip))).toBeCloseTo(FEMUR, 4)
    expect(len3(sub3(end, knee))).toBeCloseTo(TIBIA, 4)
    expect(len3(sub3(end, target))).toBeLessThan(1e-3)
    expect(knee.z).toBeGreaterThan(hip.z) // knee bends up
  })
  it('clamps unreachable targets to full extension', () => {
    const r = solveTwoBone({ x: 0, y: 0, z: 0 }, { x: 500, y: 0, z: 0 }, 30, 34, { x: 0, y: 0, z: 1 })
    expect(r.reached).toBe(false)
    expect(len3(r.end)).toBeCloseTo(64, 1)
  })
})

describe('gait', () => {
  it('tetrapod groups never contain adjacent legs', () => {
    for (const g of GAIT_GROUPS) for (const a of g) for (const b of g) if (a !== b) expect(adjacentLegs(a, b)).toBe(false)
    expect(new Set([...GAIT_GROUPS[0]!, ...GAIT_GROUPS[1]!]).size).toBe(8)
  })
  it('walks with only one group lifted at a time and planted feet never slide', () => {
    const s = new Spider(1, 100, 100, { heading: 0 })
    s.state = 'wander'
    const planted = new Map<number, { x: number; y: number }>()
    let maxSlide = 0
    let steps = 0
    for (let i = 0; i < 600; i++) {
      s.steer(1 / 120, 1000, 100, 90)
      s.integrate(1 / 120)
      s.updateLegs(1 / 120)
      const lifted = s.legs.filter((l) => l.stepping).map((l) => l.index)
      for (const a of lifted) for (const b of lifted) if (a !== b) expect(adjacentLegs(a, b)).toBe(false)
      for (const l of s.legs) {
        if (l.stepping) { planted.delete(l.index); continue }
        const p = planted.get(l.index)
        if (p) maxSlide = Math.max(maxSlide, Math.hypot(p.x - l.foot.x, p.y - l.foot.y))
        else { planted.set(l.index, { x: l.foot.x, y: l.foot.y }); steps++ }
      }
    }
    expect(s.x).toBeGreaterThan(400)
    expect(steps).toBeGreaterThan(30)
    expect(maxSlide).toBe(0)
  })
  it('critically damped heading spring settles without overshoot', () => {
    let a = 0, v = 0, peak = 0
    for (let i = 0; i < 240; i++) {
      ;[a, v] = springAngle(a, v, 1, 9, 1 / 120)
      peak = Math.max(peak, a)
    }
    expect(a).toBeCloseTo(1, 3)
    expect(peak).toBeLessThanOrEqual(1 + 1e-6)
  })
})

describe('crawler behaviour', () => {
  const surface = (sim: Sim) => {
    sim.view = { scrollY: 0, w: 1000, h: 700 }
    sim.setSurface([{ x: 100, y: 200, w: 500, h: 20 }], [{ id: '0|1', x: 100, y: 120, w: 260, h: 24, href: 'https://en.wikipedia.org/wiki/Spider', text: '' }], { w: 1000, h: 1400 })
  }
  it('drops on silk, lands and indexes a link', () => {
    const sim = new Sim(3)
    surface(sim)
    const s = sim.dropSpider(300, { landY: 300 })
    expect(s.state).toBe('drop')
    for (let i = 0; i < 60 * 30 && sim.indexed.size === 0; i++) sim.step(1 / 60)
    expect(s.state).not.toBe('drop')
    expect(sim.indexed.has('0|1')).toBe(true)
  })
  it('hunts and eats flies, then hatches a spiderling every third fly', () => {
    const sim = new Sim(5)
    surface(sim)
    sim.links = []
    const s = sim.dropSpider(500, { landY: 400 })
    for (let i = 0; i < 240; i++) sim.step(1 / 60)
    for (const [x, y] of [[300, 300], [700, 500], [450, 600]] as const) sim.addFly(x, y)
    for (let i = 0; i < 60 * 25 && sim.stats.eaten < 3; i++) sim.step(1 / 60)
    expect(sim.stats.eaten).toBe(3)
    expect(s.fat).toBeGreaterThan(1)
    expect(sim.spiders.length).toBe(2)
  })
  it('plays dead for about two seconds when poked', () => {
    const sim = new Sim(9)
    surface(sim)
    const s = sim.dropSpider(500, { landY: 400 })
    for (let i = 0; i < 240; i++) sim.step(1 / 60)
    expect(sim.poke(s.x, s.y)).toBe(s)
    expect(s.state).toBe('dead')
    for (let i = 0; i < 60; i++) sim.step(1 / 60)
    expect(s.curl).toBeGreaterThan(0.9)
    for (let i = 0; i < 120; i++) sim.step(1 / 60)
    expect(s.state).not.toBe('dead')
    expect(s.curl).toBeLessThan(0.9)
  })
  it('flees a nearby cursor, and follows it in curious mode', () => {
    const sim = new Sim(11)
    surface(sim)
    sim.links = []
    const s = sim.dropSpider(500, { landY: 400 })
    for (let i = 0; i < 240; i++) sim.step(1 / 60)
    sim.cursor = { x: s.x + 30, y: s.y }
    sim.step(1 / 60)
    expect(s.state).toBe('flee')
    for (let i = 0; i < 30; i++) sim.step(1 / 60)
    expect(Math.hypot(s.x - sim.cursor.x, s.y - sim.cursor.y)).toBeGreaterThan(50)
    sim.follow = true
    sim.cursor = { x: 800, y: 600 }
    for (let i = 0; i < 60 * 8; i++) sim.step(1 / 60)
    expect(Math.hypot(s.x - 800, s.y - 600)).toBeLessThan(90)
  })
  it('builds a web over ~2 s', () => {
    const sim = new Sim(13)
    surface(sim)
    sim.links = []
    const s = sim.dropSpider(500, { landY: 400 })
    for (let i = 0; i < 240; i++) sim.step(1 / 60)
    const w = sim.buildWeb(s)!
    for (let i = 0; i < 60 * 12 && s.state !== 'web'; i++) sim.step(1 / 60)
    expect(s.state).toBe('web')
    expect(w.t0).toBeGreaterThan(0)
  })
})

describe('page model', () => {
  it('parses headings, paragraphs and absolute links from HTML', () => {
    const p = parseHtml('<html><title>Ex &amp; co</title><body><script>x()</script><h1>Hello</h1><p>Read <a href="/docs">the <b>docs</b></a> now.</p><p>x</p></body></html>', 'https://example.com/a/')
    expect(p.title).toBe('Ex & co')
    expect(p.blocks[0]).toEqual({ kind: 'h1', segs: [{ text: 'Hello' }] })
    const para = p.blocks[1]!
    expect(para.kind).toBe('p')
    if (para.kind !== 'p') throw new Error('expected paragraph')
    expect(para.segs).toEqual([{ text: 'Read ' }, { text: 'the docs', href: 'https://example.com/docs' }, { text: ' now.' }])
    expect(words(para.segs).map((w) => w.href ?? '-')).toEqual(['-', 'https://example.com/docs', 'https://example.com/docs', '-'])
    expect(p.blocks.length).toBe(2) // single-word paragraph dropped
  })
  it('reads only <main> when present and caps the word budget', () => {
    const body = Array.from({ length: 50 }, (_, i) => `<p>word ${i} lorem ipsum dolor sit amet</p>`).join('')
    const p = parseHtml(`<nav><p>skip this menu</p></nav><p>outside main text</p><main>${body}</main>`, 'https://x.dev/', 80, 40)
    expect(JSON.stringify(p.blocks)).not.toContain('outside')
    expect(JSON.stringify(p.blocks)).not.toContain('skip')
    expect(p.blocks.length).toBe(6)
  })
  it('mock results page has links on real domains', () => {
    const p = mockSerp()
    expect(p.blocks.length).toBeGreaterThanOrEqual(10)
    for (const b of p.blocks) if (b.kind === 'result') expect(b.href).toMatch(/^https:\/\//)
  })
})

describe('cli', () => {
  it('parses run options and subcommands', () => {
    expect(parseArgs(['https://example.com', '-n', '3', '--still'])).toEqual({ kind: 'run', options: { url: 'https://example.com', spiders: 3, still: true, chaos: false, window: false } })
    expect(parseArgs(['feed'])).toEqual({ kind: 'command', command: { cmd: 'feed', n: 5 } })
    expect(parseArgs(['spawn', '2'])).toEqual({ kind: 'command', command: { cmd: 'spawn', n: 2 } })
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' })
    expect(parseArgs(['feed', 'lots']).kind).toBe('error')
    expect(parseArgs(['--nope']).kind).toBe('error')
  })
})
