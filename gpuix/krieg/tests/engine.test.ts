import { describe, expect, test } from 'bun:test'
import { boot } from '../src/boot'
import { Renderer } from '../src/engine/raycast'
import { scene } from '../src/game/scene'
import { World, type Input } from '../src/game/world'
import type { EnemyKind } from '../src/gen/level'
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

function facing(w: World, kind: EnemyKind) {
  const e = w.enemies.find((e) => e.kind === kind)!
  // Put the enemy two cells in front of the player in open space.
  e.x = w.p.x + Math.cos(w.p.angle) * 1.5; e.y = w.p.y + Math.sin(w.p.angle) * 1.5
  return e
}

describe('gameplay', () => {
  test('chaingun hitscan damages, flashes and kills an enemy in front', () => {
    const w = new World(1337)
    w.god = true; w.swap(1)
    const e = facing(w, 'trooper')
    for (let i = 0; i < 120 && e.state !== 'dead'; i++) w.step(1 / 60, { ...idle, fire: true })
    expect(e.state).toBe('dead')
    expect(w.kills).toBe(1)
    expect(w.p.ammo).toBeLessThan(80)
  })
  test('chaingun shot leaves a barrel-to-impact tracer, impact particles and a hit marker', () => {
    const w = new World(1337)
    w.god = true; w.swap(1); w.p.cool = 0
    const e = facing(w, 'imp')
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
    w.god = true; w.swap(2)
    const e = facing(w, 'brute')
    e.x = w.p.x + Math.cos(w.p.angle) * 2.2; e.y = w.p.y + Math.sin(w.p.angle) * 2.2
    for (let i = 0; i < 60; i++) w.step(1 / 60, { ...idle, fire: i > 20 && i < 24 })
    expect(w.p.rockets).toBe(5)
    expect(e.hp).toBeLessThan(e.maxHp)
  })
  test('enemy that sees the player switches to chase/attack and hurts it', () => {
    const w = new World(1337)
    const e = facing(w, 'brute')
    e.x = w.p.x + Math.cos(w.p.angle) * 2.2; e.y = w.p.y + Math.sin(w.p.angle) * 2.2
    for (let i = 0; i < 240; i++) w.step(1 / 60, idle)
    expect(['chase', 'attack']).toContain(e.state)
    expect(w.p.hp).toBeLessThan(100)
  })
  test('shotgun fires a 7-pellet spread for one shell and staggers or kills', () => {
    const w = new World(1337)
    w.god = true
    const e = facing(w, 'trooper')
    w.step(1 / 60, { ...idle, fire: true })
    expect(w.p.shells).toBe(23)
    expect(w.tracers.length).toBe(7)
    expect(e.hp).toBeLessThan(e.maxHp)
    expect(e.pain > 0 || e.state === 'dead').toBe(true)
  })
  test('monsters fall into persistent corpses; overkill gibs', () => {
    const w = new World(1337)
    const a = w.enemies.find((e) => e.kind === 'imp')!, b = w.enemies.find((e) => e.kind === 'trooper')!
    w.damage(a, 70); w.damage(b, 200)
    expect(a.state).toBe('dead'); expect(a.gib).toBe(false); expect(b.gib).toBe(true)
    for (let i = 0; i < 120; i++) w.step(1 / 60, idle)
    expect(a.dissolve).toBe(1)
    const s = scene(w, boot(1337, 32).sprites, 0)
    expect(s.sprites.filter((d) => d.x === a.x && d.y === a.y).length).toBe(1)
  })
  test('monster sheets: 16 frames, upright pain frame, corpse and gib pile lie on the floor', () => {
    const { mon } = boot(1337, 32).sprites
    const lowY = (img: { w: number; h: number; px: Uint32Array }) => {
      let top = img.h
      for (let i = 0; i < img.px.length; i++) if (img.px[i]! >>> 24) top = Math.min(top, Math.floor(i / img.w))
      return top / img.h
    }
    for (const k of ['trooper', 'imp', 'brute'] as const) {
      expect(mon[k].length).toBe(16)
      expect(lowY(mon[k][6]!)).toBeLessThan(0.3)
      expect(lowY(mon[k][11]!)).toBeGreaterThan(0.5)
      expect(lowY(mon[k][15]!)).toBeGreaterThan(0.7)
    }
  })
  test('barrels explode, chain and hurt nearby monsters but do not count as kills', () => {
    const w = new World(1337)
    const [b1, b2] = w.enemies.filter((e) => e.kind === 'barrel')
    const m = w.enemies.find((e) => e.kind === 'brute')!
    const at = (o: { x: number; y: number }, d: number) => { o.x = w.p.x + Math.cos(w.p.angle) * d; o.y = w.p.y + Math.sin(w.p.angle) * d }
    at(b1!, 1.5); at(b2!, 2.3); at(m, 3)
    w.damage(b1!, 30)
    expect(b1!.state).toBe('dead'); expect(b2!.state).toBe('dead')
    expect(m.hp).toBeLessThan(m.maxHp)
    expect(w.fx.some((f) => f.kind === 'boom')).toBe(true)
    expect(w.monsters).toBe(w.enemies.filter((e) => e.kind !== 'barrel').length)
  })
  test('troopers telegraph then fire a visible hitscan tracer at the player', () => {
    const w = new World(1337)
    const e = facing(w, 'trooper')
    e.x = w.p.x + Math.cos(w.p.angle) * 3; e.y = w.p.y + Math.sin(w.p.angle) * 3
    let wound = false, traced = false
    for (let i = 0; i < 240; i++) { w.step(1 / 60, idle); if (e.atk > 0.15) wound = true; if (w.tracers.length) traced = true }
    expect(wound).toBe(true); expect(traced).toBe(true)
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
    expect(r.packed).toBeLessThan(BUDGET)
    expect(r.bytes).toBeGreaterThan(r.packed)
  }, 30000)
})
