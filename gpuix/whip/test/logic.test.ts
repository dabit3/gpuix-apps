import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STEP, Whip, sampleCurve } from '../src/physics'
import { WhipCanvas, hex, makeFlash } from '../src/raster'
import { MessagePicker, RateLimiter, sanitizeMessage, SPICY } from '../src/messages'
import { LineDecoder, encode, nudgeSequence, type LeashMessage } from '../src/protocol'
import { NudgeGate, agentName } from '../src/leash'
import { AgentLink, type LogEntry } from '../src/link'
import { parseArgs } from '../src/args'
import { replyTo, speedAfter } from '../src/clanker'
import { crackWav } from '../src/sound'

function segLengths(w: Whip) {
  const out: number[] = []
  for (let i = 1; i < w.x.length; i++) out.push(Math.hypot(w.x[i] - w.x[i - 1], w.y[i] - w.y[i - 1]))
  return out
}

describe('verlet whip', () => {
  test('has 40 segments, 420 px, and keeps its length after settling', () => {
    const w = new Whip(500, 100)
    expect(w.x.length).toBe(41)
    for (let i = 0; i < 240; i++) w.step(STEP)
    const total = segLengths(w).reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(420 * 0.97)
    expect(total).toBeLessThan(420 * 1.03)
    // gravity: the tip hangs below the handle
    expect(w.y[40]).toBeGreaterThan(w.y[0] + 300)
  })

  test('handle follows the mouse target', () => {
    const w = new Whip(100, 100)
    w.pointTo(300, 200)
    for (let i = 0; i < 60; i++) w.step(STEP)
    expect(Math.hypot(w.x[0] - 300, w.y[0] - 200)).toBeLessThan(2)
  })

  test('a slow drag never cracks, a hard flick cracks once per 400 ms', () => {
    const slow = new Whip(400, 100)
    let slowCracks = 0
    for (let i = 0; i < 240; i++) {
      slow.pointTo(400 + i, 100)
      if (slow.step(STEP)) slowCracks++
    }
    expect(slowCracks).toBe(0)

    const w = new Whip(200, 300)
    for (let i = 0; i < 120; i++) w.step(STEP)
    const cracks: number[] = []
    let t = 0
    // sweep the handle sideways and back fast, three times
    for (let rep = 0; rep < 3; rep++) {
      for (let i = 0; i < 14; i++) {
        w.pointTo(200 + i * 45, 300 - i * 12)
        const c = w.step(STEP)
        if (c) cracks.push(t)
        t += STEP
      }
      for (let i = 0; i < 14; i++) {
        w.pointTo(830 - i * 45, 132 + i * 12)
        const c = w.step(STEP)
        if (c) cracks.push(t)
        t += STEP
      }
      for (let i = 0; i < 30; i++) {
        if (w.step(STEP)) cracks.push(t)
        t += STEP
      }
    }
    expect(cracks.length).toBeGreaterThan(0)
    for (let i = 1; i < cracks.length; i++) expect(cracks[i] - cracks[i - 1]).toBeGreaterThanOrEqual(0.4 - 1e-6)
  })

  test('setLength rescales the rope', () => {
    const w = new Whip(300, 100)
    w.setLength(200)
    for (let i = 0; i < 240; i++) w.step(STEP)
    const total = segLengths(w).reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(190)
    expect(total).toBeLessThan(210)
  })

  test('catmull-rom passes through the control points', () => {
    const xs = [0, 10, 20, 30]
    const ys = [0, 5, 0, 5]
    const { points, count } = sampleCurve(xs, ys, 4)
    expect(count).toBeGreaterThan(8)
    expect(points[0]).toBeCloseTo(0)
    expect(points[(count - 1) * 2]).toBeCloseTo(30)
    expect(points[(count - 1) * 2 + 1]).toBeCloseTo(5)
  })
})

describe('raster', () => {
  test('draws a tapered opaque whip and clears it on the next frame', () => {
    const c = new WhipCanvas()
    c.resize(200, 100)
    const xs = [20, 60, 100, 140, 180]
    const ys = [50, 50, 50, 50, 50]
    const opts = { thick: 6, thin: 1, fill: hex('#f0f3f6'), outline: hex('#010409'), grip: hex('#9ea7b3'), shadow: hex('#000000', 0.3) }
    c.begin()
    c.whip(xs, ys, opts)
    c.end()
    expect(c.alphaAt(100, 50)).toBe(255)
    expect(c.alphaAt(100, 10)).toBe(0)
    // thicker near the handle than the tip
    expect(c.alphaAt(30, 55)).toBeGreaterThan(c.alphaAt(170, 55))
    c.begin()
    c.end()
    expect(c.alphaAt(100, 50)).toBe(0)
  })

  test('flash ring paints around the tip and fades out', () => {
    const c = new WhipCanvas()
    c.resize(120, 120)
    const f = makeFlash(60, 60, 0)
    c.begin()
    c.flash(f, 10, hex('#ffffff'))
    c.end()
    expect(c.alphaAt(60, 60)).toBeGreaterThan(100)
    c.begin()
    c.flash(f, f.life + 1, hex('#ffffff'))
    c.end()
    expect(c.alphaAt(60, 60)).toBe(0)
  })
})

describe('messages and safety', () => {
  test('sanitize strips control/escape characters and caps length', () => {
    expect(sanitizeMessage('go\x1b[31m go\r\n\u0007go')).toBe('go [31m go go')
    expect(sanitizeMessage('a\u202Eb')).toBe('a b')
    expect(sanitizeMessage('x'.repeat(500)).length).toBe(120)
    expect(sanitizeMessage('   ')).toBe('')
  })

  test('picker never repeats back to back', () => {
    const p = new MessagePicker(() => 0)
    const a = p.pick(SPICY)
    const b = p.pick(SPICY)
    expect(a).not.toBe(b)
    expect(new MessagePicker().pick([])).toBe('Keep going')
  })

  test('rate limiter allows one per 2 s', () => {
    const r = new RateLimiter(2000)
    expect(r.take(0)).toBe(true)
    expect(r.take(1999)).toBe(false)
    expect(r.take(2000)).toBe(true)
  })

  test('nudge writes exactly Esc, the message, Enter', async () => {
    const writes: string[] = []
    let now = 0
    const gate = new NudgeGate({ write: (d) => writes.push(d) }, 2000, 1, 1, () => now)
    const r = await gate.nudge(1, 'faster\x1b[2J clanker')
    expect(writes).toEqual(['\x1b', 'faster [2J clanker', '\r'])
    expect(r).toEqual({ type: 'injected', id: 1, message: 'faster [2J clanker', events: ['esc', 'text', 'enter'] })
    now = 500
    expect((await gate.nudge(2, 'again')).type).toBe('rejected')
    expect(writes.length).toBe(3)
    now = 2600
    expect((await gate.nudge(3, '\x00\x01')).type).toBe('rejected')
    expect(writes.length).toBe(3)
    expect(nudgeSequence('hi')).toEqual({ esc: '\x1b', text: 'hi', enter: '\r' })
  })

  test('line decoder joins partial chunks', () => {
    const d = new LineDecoder<LeashMessage>()
    const line = encode({ type: 'activity', bytes: 42 })
    expect(d.push(line.slice(0, 5))).toEqual([])
    expect(d.push(line.slice(5) + 'garbage\n')).toEqual([{ type: 'activity', bytes: 42 }])
  })
})

describe('cli', () => {
  test('parses gui flags, leash commands and help', () => {
    expect(parseArgs([]).mode).toBe('gui')
    expect(parseArgs(['-a', '--spicy', '-l', '300'])).toMatchObject({ mode: 'gui', armed: true, polite: false, length: 300 })
    expect(parseArgs(['--', 'claude', '--resume'])).toMatchObject({ mode: 'leash', command: ['claude', '--resume'] })
    // bun strips the first `--`
    expect(parseArgs(['claude', '--resume'])).toMatchObject({ mode: 'leash', command: ['claude', '--resume'] })
    expect(parseArgs(['--target', '/dev/ttys003']).targets).toEqual(['/dev/ttys003'])
    expect(parseArgs(['--bogus']).mode).toBe('help')
    expect(parseArgs(['-h']).mode).toBe('help')
  })

  test('agent names', () => {
    expect(agentName(['claude'])).toBe('claude')
    expect(agentName(['bun', 'bin/clanker.ts'])).toBe('clanker')
    expect(agentName(['/usr/local/bin/codex', '--full-auto'])).toBe('codex')
  })
})

describe('clanker', () => {
  test('speeds up on urgent nudges', () => {
    expect(speedAfter(1, 'FASTER')).toBeCloseTo(1.6)
    expect(speedAfter(1, 'Keep going')).toBeCloseTo(1.25)
    expect(speedAfter(8, 'go go go')).toBe(9)
    expect(replyTo('Work FASTER', 2)).toContain('pace')
    expect(replyTo('Keep going', 1.25)).toContain('Continuing')
  })
})

describe('sound', () => {
  test('crack is a valid sub-30 ms mono wav', () => {
    const wav = crackWav(44100, 26)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    const dv = new DataView(wav.buffer, wav.byteOffset)
    const dataBytes = dv.getUint32(40, true)
    expect(dataBytes / 2 / 44100).toBeLessThan(0.03)
  })
})

describe('agent link over a unix socket', () => {
  test('discovers a leash, sends a nudge, and logs the three events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'whip-'))
    const sock = join(dir, '4242.sock')
    const writes: string[] = []
    const gate = new NudgeGate({ write: (d) => writes.push(d) }, 2000, 1, 1)
    const server = Bun.listen<{ dec: LineDecoder<any> }>({
      unix: sock,
      socket: {
        open(s) {
          s.data = { dec: new LineDecoder() }
          s.write(encode({ type: 'hello', pid: 4242, name: 'clanker', command: ['clanker'], tty: '/dev/ttys009', startedAt: 0 }))
        },
        async data(s, chunk) {
          for (const m of s.data.dec.push(chunk.toString())) s.write(encode(await gate.nudge(m.id, m.message)))
        },
      },
    })
    const link = new AgentLink(dir, ['/dev/ttys009'])
    const logs: LogEntry[] = []
    link.onLog = (e) => logs.push(e)
    link.start()
    try {
      for (let i = 0; i < 50 && link.list()[0]?.name !== 'clanker'; i++) await Bun.sleep(20)
      expect(link.list()).toHaveLength(1)
      expect(link.list()[0].name).toBe('clanker')
      expect(link.preferred()).toBe(sock)
      expect(link.nudge(sock, 'Keep going')).toBe(true)
      for (let i = 0; i < 50 && link.injected < 3; i++) await Bun.sleep(20)
      expect(writes).toEqual(['\x1b', 'Keep going', '\r'])
      expect(link.injected).toBe(3)
      expect(logs.map((l) => l.kind)).toEqual(['link', 'esc', 'text', 'enter'])
    } finally {
      link.stop()
      server.stop(true)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('file hook target appends the message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'whip-'))
    const file = join(dir, 'nudges.txt')
    const link = new AgentLink(join(dir, 'none'), [file])
    link.start()
    try {
      const key = link.list()[0].key
      expect(link.nudge(key, 'go go go')).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe('go go go\n')
    } finally {
      link.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
