import { describe, expect, test } from 'bun:test'
import { runOps } from '../src/gen/texops'
import { buildMaterials, MATERIALS } from '../src/gen/materials'
import { EMPTY, MH, MW, generateLevel, lineOfSight, solidAt } from '../src/gen/level'

describe('texture op graph', () => {
  test('is deterministic and every material builds', () => {
    const a = buildMaterials(64), b = buildMaterials(64)
    expect(a).toHaveLength(MATERIALS.length)
    a.forEach((t, i) => expect(Buffer.from(t.px.buffer).equals(Buffer.from(b[i]!.px.buffer))).toBe(true))
  })
  test('noise tiles seamlessly', () => {
    const t = runOps([['noise', 4, 4, 7], ['ramp', 0x000000, 0xffffff]], 64)
    let edge = 0, inner = 0
    for (let y = 0; y < 64; y++) {
      const g = (x: number) => (t.px[y * 64 + x]! >> 8) & 255
      edge += Math.abs(g(63) - g(0)); inner += Math.abs(g(31) - g(32))
    }
    expect(edge).toBeLessThan(inner * 3 + 64 * 8)
  })
  test('tech panel has emissive texels, concrete has none', () => {
    const m = buildMaterials(64)
    expect(m[2]!.emis.some((v) => v > 0)).toBe(true)
    expect(m[3]!.emis.every((v) => v === 0)).toBe(true)
  })
})

// BFS over walkable cells; locked doors pass only with the key.
function reach(l: ReturnType<typeof generateLevel>, fromX: number, fromY: number, key: boolean) {
  const seen = new Uint8Array(MW * MH), q = [Math.floor(fromY) * MW + Math.floor(fromX)]
  seen[q[0]!] = 1
  while (q.length) {
    const i = q.shift()!, x = i % MW, y = (i / MW) | 0
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (y + oy!) * MW + x + ox!
      if (seen[n]) continue
      const d = l.doorAt[n]!
      if (d >= 0 ? l.doors[d]!.locked && !key : l.cells[n] !== EMPTY) continue
      seen[n] = 1; q.push(n)
    }
  }
  return (x: number, y: number) => seen[Math.floor(y) * MW + Math.floor(x)] === 1
}

describe('procedural level', () => {
  test('same seed, same world; different seed, different world', () => {
    const a = generateLevel(1337), b = generateLevel(1337), c = generateLevel(7)
    expect(Buffer.from(a.cells).equals(Buffer.from(b.cells))).toBe(true)
    expect(a.lightmap).toEqual(b.lightmap)
    expect(Buffer.from(a.cells).equals(Buffer.from(c.cells))).toBe(false)
  })
  for (const seed of [1, 7, 42, 1337, 2026, 99999]) test(`seed ${seed} is completable: key reachable, exit only behind the key door`, () => {
    const l = generateLevel(seed)
    const noKey = reach(l, l.start.x, l.start.y, false), withKey = reach(l, l.start.x, l.start.y, true)
    const key = l.pickups.find((p) => p.kind === 'key')!
    expect(noKey(key.x, key.y)).toBe(true)
    expect(noKey(l.exit.x, l.exit.y)).toBe(false)
    expect(withKey(l.exit.x, l.exit.y)).toBe(true)
    expect(l.lights.length).toBeLessThanOrEqual(16)
    expect(new Set(l.enemies.map((e) => e.kind))).toEqual(new Set(['trooper', 'imp', 'brute', 'barrel']))
    expect(solidAt(l, l.start.x, l.start.y)).toBe(false)
  })
  test('line of sight is blocked by walls', () => {
    const l = generateLevel(1337)
    expect(lineOfSight(l, l.start.x, l.start.y, l.start.x, l.start.y)).toBe(true)
    expect(lineOfSight(l, 0.5, 0.5, MW - 0.5, MH - 0.5)).toBe(false)
  })
})
