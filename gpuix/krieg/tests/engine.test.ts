import { describe, expect, test } from 'bun:test'
import { boot } from '../src/boot'
import { Renderer } from '../src/engine/raycast'
import { scene } from '../src/game/scene'
import { World, type Input } from '../src/game/world'
import { keyName } from '../src/app'
import { song, SFX } from '../src/audio/synth'
import { BUDGET, measure } from '../src/size'

const idle: Input = { fwd: 0, strafe: 0, turn: 0, look: 0, fire: false, jump: false, crouch: false }

describe('raycaster', () => {
  test('renders a lit, non-empty BGRA frame and follows resizes', () => {
    const b = boot(1337, 64), r = new Renderer()
    r.resize(160, 90)
    const s = scene(b.world, b.sprites, 0)
    r.render(b.world.level, b.mats, s.cam, s.sprites, s.dyn, s.vm, null)
    expect(r.buf.length).toBe(160 * 90 * 4)
    const lum = new Set<number>()
    for (let i = 0; i < r.u32.length; i += 7) lum.add(r.u32[i]! & 0xffffff)
    expect(lum.size).toBeGreaterThan(50)
    expect(r.zbuf.every((z) => z > 0 && z < 60)).toBe(true)
    r.resize(80, 120)
    expect(r.buf.length).toBe(80 * 120 * 4)
  })
})

function facing(w: World, kind: 'spider' | 'sentry') {
  const e = w.enemies.find((e) => e.kind === kind)!
  // Put the enemy two cells in front of the player in open space.
  e.x = w.p.x + Math.cos(w.p.angle) * 1.5; e.y = w.p.y + Math.sin(w.p.angle) * 1.5
  return e
}

describe('gameplay', () => {
  test('rifle hitscan damages, flashes and kills an enemy in front', () => {
    const w = new World(1337)
    w.god = true
    const e = facing(w, 'spider')
    for (let i = 0; i < 120 && e.state !== 'dead'; i++) w.step(1 / 60, { ...idle, fire: true })
    expect(e.state).toBe('dead')
    expect(w.kills).toBe(1)
    expect(w.p.ammo).toBeLessThan(80)
  })
  test('rifle shot leaves a barrel-to-impact tracer, impact particles and a hit marker', () => {
    const w = new World(1337)
    w.god = true
    const e = facing(w, 'spider')
    w.step(1 / 60, { ...idle, fire: true })
    expect(w.tracers.length).toBe(1)
    const tr = w.tracers[0]!
    expect(Math.hypot(tr.x0 - w.p.x, tr.y0 - w.p.y)).toBeLessThan(0.5)
    expect(Math.hypot(tr.x1 - e.x, tr.y1 - e.y)).toBeLessThan(0.6)
    expect(w.fx.filter((f) => f.kind === 'p').length).toBeGreaterThan(4)
    expect(w.p.hitT).toBeGreaterThan(0.9)
    const s = scene(w, boot(1337, 32).sprites, 0)
    expect(s.tr.length).toBeGreaterThan(0)
    for (let i = 0; i < 60; i++) w.step(1 / 60, idle)
    expect(w.tracers.length).toBe(0)
    expect(w.fx.length).toBe(0)
  })
  test('rocket explodes with splash damage', () => {
    const w = new World(1337)
    w.god = true; w.swap(1)
    const e = facing(w, 'sentry')
    e.x = w.p.x + Math.cos(w.p.angle) * 2.2; e.y = w.p.y + Math.sin(w.p.angle) * 2.2
    for (let i = 0; i < 60; i++) w.step(1 / 60, { ...idle, fire: i > 20 && i < 24 })
    expect(w.p.rockets).toBe(5)
    expect(e.hp).toBeLessThan(e.maxHp)
  })
  test('enemy that sees the player switches to chase/attack and hurts it', () => {
    const w = new World(1337)
    const e = facing(w, 'spider')
    e.x = w.p.x + Math.cos(w.p.angle) * 2.2; e.y = w.p.y + Math.sin(w.p.angle) * 2.2
    for (let i = 0; i < 240; i++) w.step(1 / 60, idle)
    expect(['chase', 'attack']).toContain(e.state)
    expect(w.p.hp).toBeLessThan(100)
  })
  test('walls block movement', () => {
    const w = new World(1337)
    for (let i = 0; i < 600; i++) w.step(1 / 60, { ...idle, fwd: 1 })
    expect(w.rayWall(w.p.x, w.p.y, Math.cos(w.p.angle), Math.sin(w.p.angle))).toBeLessThan(0.5)
  })
  test('picking up the key and reaching the exit wins', () => {
    const w = new World(1337)
    const key = w.pickups.find((k) => k.kind === 'key')!
    w.p.x = key.x; w.p.y = key.y
    w.step(1 / 60, idle)
    expect(w.p.hasKey).toBe(true)
    w.p.x = w.level.exit.x; w.p.y = w.level.exit.y
    w.step(1 / 60, idle)
    expect(w.state).toBe('won')
  })
})

describe('terminal keys', () => {
  test('letters arriving as "space" with keyChar, enter with a newline keyChar', () => {
    expect(keyName({ key: 'space', keyChar: 'w' })).toBe('w')
    expect(keyName({ key: 'enter', keyChar: '\n' })).toBe('enter')
    expect(keyName({ key: 'space', keyChar: ' ' })).toBe('space')
    expect(keyName({ key: 'W' })).toBe('w')
  })
})

describe('synth + size budget', () => {
  test('sfx and song render audible samples', () => {
    for (const f of Object.values(SFX)) expect(f().some((v) => Math.abs(v) > 0.05)).toBe(true)
    const s = song(1)
    expect(s.length / 22050).toBeGreaterThan(55)
    expect(s.length / 22050).toBeLessThan(95)
  })
  test('minified bundle stays under 64 KB', async () => {
    const r = await measure()
    expect(r.bytes).toBeLessThan(BUDGET)
  }, 30000)
})
