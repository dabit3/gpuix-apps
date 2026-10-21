import { describe, expect, it } from 'bun:test'
import { formatTime, frameLocation, layoutLeftHeavy, layoutTimeOrder, matchedTime, parseCpuProfile, sandwich, topFunctions } from './profile.ts'

const cf = (functionName: string, lineNumber = 0) => ({ functionName, url: 'file:///app/src/main.ts', lineNumber, columnNumber: 0, scriptId: '1' })
// (root) → main → { parse → tokenize, render }; samples interleave so time order differs from left-heavy.
const raw = {
  nodes: [
    { id: 1, callFrame: { ...cf('(root)'), url: '' }, children: [2] },
    { id: 2, callFrame: cf('main', 9), children: [3, 5] },
    { id: 3, callFrame: cf('parse', 19), children: [4] },
    { id: 4, callFrame: cf('tokenize', 29), children: [] },
    { id: 5, callFrame: cf('render', 39), children: [] },
  ],
  samples: [5, 4, 4, 3, 5, 4],
  timeDeltas: [0, 1000, 1000, 1000, 1000, 1000],
  startTime: 0,
  endTime: 6000,
}

describe('parseCpuProfile', () => {
  const p = parseCpuProfile(raw, '/tmp/app.cpuprofile')
  const id = (name: string) => p.frames.findIndex((f) => f.name === name)

  it('weights samples by time deltas and keeps file:line', () => {
    expect(p.sampleCount).toBe(6)
    expect(p.total).toBeGreaterThan(4000)
    expect(frameLocation(p.frames[id('parse')]!)).toContain('main.ts:20')
  })

  it('ranks self time and counts total once per sample', () => {
    const stats = topFunctions(p)
    expect(p.frames[stats[0]!.frame]!.name).toBe('tokenize')
    const main = stats.find((s) => s.frame === id('main'))!
    expect(main.self).toBe(0)
    expect(main.total).toBe(p.total)
    const parse = stats.find((s) => s.frame === id('parse'))!
    expect(parse.total).toBeGreaterThan(parse.self)
  })

  it('left-heavy merges stacks, heaviest child first', () => {
    const l = layoutLeftHeavy(p)
    const depth2 = l.rows[2]!.map((c) => p.frames[c.frame]!.name)
    expect(depth2).toEqual(['parse', 'render'])
    expect(l.rows[2]![0]!.start).toBe(l.rows[1]![0]!.start)
  })

  it('time order keeps separate runs of the same function', () => {
    const t = layoutTimeOrder(p)
    const renders = t.rows[2]!.filter((c) => p.frames[c.frame]!.name === 'render')
    expect(renders.length).toBe(2)
    expect(t.cells.length).toBeGreaterThan(layoutLeftHeavy(p).cells.length)
  })

  it('sandwich shows callers above and callees below a frame', () => {
    const sw = sandwich(p, id('parse'))
    expect(sw.callers.cells.map((c) => p.frames[c.frame]!.name)).toContain('main')
    expect(sw.callees.cells.map((c) => p.frames[c.frame]!.name)).toContain('tokenize')
  })

  it('search matches names and paths case-insensitively', () => {
    expect(matchedTime(p, 'TOKEN')).toBeGreaterThan(0)
    expect(matchedTime(p, 'main.ts')).toBe(p.total)
    expect(matchedTime(p, 'nope')).toBe(0)
  })

  it('rejects files that are not cpu profiles', () => {
    expect(() => parseCpuProfile({ hello: 1 })).toThrow()
  })
})

describe('formatTime', () => {
  it('picks a readable unit', () => {
    expect(formatTime(250)).toContain('µs')
    expect(formatTime(43_000)).toBe('43 ms')
    expect(formatTime(1_150_000)).toBe('1.15 s')
  })
})
