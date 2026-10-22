// Turns world state into renderer inputs: billboards, dynamic lights, viewmodel and screen tint.
import type { Cam, DynLight, Seg, SpriteDraw, Viewmodel } from '../engine/raycast'
import type { SpriteSet } from '../gen/sprites'
import { TRACER_LEN, TRACER_SPEED, enemyStats, type World } from './world'

export function scene(w: World, s: SpriteSet, t: number) {
  const p = w.p
  const sh = p.shake * p.shake
  const cam: Cam = { x: p.x, y: p.y, angle: p.angle + (Math.sin(t * 97) + Math.sin(t * 61)) * sh * 0.012, z: p.z + Math.sin(p.bob) * 0.012 + Math.sin(t * 71) * sh * 0.02, pitch: p.pitch + p.kick * [0.045, 0.015, 0.05][p.weapon]! + Math.sin(t * 83) * sh * 0.015 }
  const tr: Seg[] = []
  const sprites: SpriteDraw[] = []
  const dyn: DynLight[] = []
  for (const e of w.enemies) {
    if (e.kind === 'barrel') {
      if (e.state !== 'dead') { sprites.push({ x: e.x, y: e.y, z0: 0, z1: 0.6, w: 0.45, img: s.barrel, flash: e.flash, dissolve: 0 }); dyn.push({ x: e.x, y: e.y, r: 0.15, g: 0.45, b: 0.1, radius: 1.3 }) }
      continue
    }
    // Frames: 0-3 walk, 4 wind-up, 5 fire, 6 pain, 7-11 fall (corpse stays), 12-15 gib.
    const sz = enemyStats(e.kind).size
    const f = e.state === 'dead' ? (e.gib ? 12 + Math.min(3, Math.floor(e.dissolve * 4)) : 7 + Math.min(4, Math.floor(e.dissolve * 5)))
      : e.pain > 0 ? 6 : e.atk > 0 ? (e.atk > 0.15 ? 4 : 5) : Math.floor(e.anim) % 4
    sprites.push({ x: e.x, y: e.y, z0: -sz / 16, z1: sz * 15 / 16, w: sz, img: s.mon[e.kind][f]!, flash: e.state === 'dead' ? 0 : e.flash, dissolve: 0 })
    if (e.kind !== 'brute' && (f === 5 || (f === 4 && e.kind === 'imp'))) dyn.push({ x: e.x, y: e.y, r: 1, g: e.kind === 'imp' ? 0.45 : 0.75, b: 0.2, radius: f === 5 ? 2.6 : 1.6 })
  }
  for (const k of w.pickups) {
    if (k.taken) continue
    const bob = Math.sin(t * 3 + k.x) * 0.03
    const big = k.kind === 'key'
    sprites.push({ x: k.x, y: k.y, z0: 0.05 + bob, z1: (big ? 0.38 : 0.3) + bob, w: big ? 0.33 : 0.28, img: s.pickups[k.kind], flash: 0, dissolve: 0 })
    if (big) dyn.push({ x: k.x, y: k.y, r: 0.9, g: 0.65, b: 0.15, radius: 2.2 + Math.sin(t * 4) * 0.3 })
  }
  sprites.push({ x: w.level.exit.x, y: w.level.exit.y, z0: 0, z1: 0.08, w: 1.2, img: s.exitPad, flash: 0, dissolve: 0 })
  for (const q of w.projs) {
    const r = q.kind === 'rocket'
    const fb = q.kind === 'ebolt', qs = fb ? 0.11 : 0.06
    sprites.push({ x: q.x, y: q.y, z0: q.z - qs, z1: q.z + qs, w: qs * 2, img: r ? s.rocket : fb ? s.fireball : s.bolt, flash: 0, dissolve: 0 })
    dyn.push(r ? { x: q.x, y: q.y, r: 1, g: 0.55, b: 0.2, radius: 2.5 } : fb ? { x: q.x, y: q.y, r: 1.1, g: 0.5, b: 0.15, radius: 2.4 } : { x: q.x, y: q.y, r: 0.3, g: 0.8, b: 1, radius: 1.5 })
  }
  for (const f of w.fx) {
    if (f.kind === 'boom') {
      const k = f.t / 0.5, sz = 0.6 + k * 1.2
      sprites.push({ x: f.x, y: f.y, z0: f.z - sz / 2, z1: f.z + sz / 2, w: sz, img: s.explosion[Math.min(3, Math.floor(k * 4))]!, flash: 0, dissolve: 0 })
      dyn.push({ x: f.x, y: f.y, r: 1.6 * (1 - k), g: 0.9 * (1 - k), b: 0.3 * (1 - k), radius: 5 })
    } else {
      const c = f.c!, k = 1 - f.t / f.life!, sz = c === 3 ? 0.1 + f.t * 0.35 : c === 4 ? 0.09 : (c === 1 ? 0.055 : 0.05) * (0.5 + k * 0.5)
      sprites.push({ x: f.x, y: f.y, z0: f.z - sz / 2, z1: f.z + sz / 2, w: sz, img: s.dots[c]!, flash: 0, dissolve: c === 3 ? 1 - k * 0.8 : 0 })
    }
  }
  for (const r of w.tracers) {
    const head = Math.min(r.len, r.t * TRACER_SPEED), tail = Math.max(0, r.t * TRACER_SPEED - TRACER_LEN)
    if (tail >= head) continue
    const a = tail / r.len, b = head / r.len
    tr.push({ ax: r.x0 + (r.x1 - r.x0) * a, ay: r.y0 + (r.y1 - r.y0) * a, az: r.z0 + (r.z1 - r.z0) * a, bx: r.x0 + (r.x1 - r.x0) * b, by: r.y0 + (r.y1 - r.y0) * b, bz: r.z0 + (r.z1 - r.z0) * b })
    if (head >= r.len) dyn.push({ x: r.x1, y: r.y1, r: 0.5, g: 0.35, b: 0.18, radius: 0.9 })
  }
  if (p.flash > 0) {
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle)
    dyn.push({ x: p.x + dx * 0.4, y: p.y + dy * 0.4, r: 0.6 * p.flash, g: 0.42 * p.flash, b: 0.22 * p.flash, radius: p.weapon ? 2.2 : 3 })
  }
  const vm: Viewmodel = {
    img: p.weapon === 0 ? s.shotgun[p.cool > 0.15 && p.cool < 0.55 ? 1 : 0]! : p.weapon === 1 ? s.rifle : s.launcher,
    ox: 0.16 + Math.sin(p.bob * 0.5) * 0.02 + p.sway * 0.05, oy: Math.abs(Math.cos(p.bob * 0.5)) * 0.02 + p.kick * 0.035 + Math.max(0, p.cool - [0.8, 0.1, 0.5][p.weapon]!) * 0.2 + (p.z - 0.5) * 0.2,
    scale: 0.5, flash: p.flash, muzzle: s.muzzle[Math.floor(t * 30) % 3], tip: p.weapon === 2 ? [0.533, 0.16] : p.weapon ? [0.533, 0.03] : [0.542, 0.05],
  }
  let tint: [number, number, number, number] | null = null
  if (w.state === 'dead') tint = [120, 10, 10, 0.45]
  else if (p.hurt > 0) tint = [255, 40, 40, p.hurt * 0.3]
  return { cam, sprites, dyn, vm, tint, tr }
}
