// Turns world state into renderer inputs: billboards, dynamic lights, viewmodel and screen tint.
import type { Cam, DynLight, SpriteDraw, Viewmodel } from '../engine/raycast'
import type { SpriteSet } from '../gen/sprites'
import { enemyStats, type World } from './world'

export function scene(w: World, s: SpriteSet, t: number) {
  const p = w.p
  const cam: Cam = { x: p.x, y: p.y, angle: p.angle, z: p.z + Math.sin(p.bob) * 0.012, pitch: p.pitch }
  const sprites: SpriteDraw[] = []
  const dyn: DynLight[] = []
  for (const e of w.enemies) {
    if (e.state === 'dead' && e.dissolve >= 1) continue
    const st = enemyStats(e.kind)
    if (e.kind === 'spider') {
      const img = e.state === 'attack' && e.cool > 0.5 ? s.spider[4]! : s.spider[Math.floor(e.anim) % 4]!
      sprites.push({ x: e.x, y: e.y, z0: 0, z1: st.z1, w: 0.75, img, flash: e.flash, dissolve: e.dissolve })
    } else {
      const bob = Math.sin(t * 2.2 + e.id) * 0.04
      const charging = e.state === 'attack' && e.cool < 0.5
      sprites.push({ x: e.x, y: e.y, z0: st.z0 + bob, z1: st.z1 + bob, w: 0.5, img: s.sentry[charging ? 1 : 0]!, flash: e.flash, dissolve: e.dissolve })
      if (e.state !== 'dead') dyn.push({ x: e.x, y: e.y, r: charging ? 0.9 : 0.2, g: charging ? 0.25 : 0.45, b: charging ? 0.2 : 0.7, radius: 1.8 })
    }
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
    sprites.push({ x: q.x, y: q.y, z0: q.z - 0.06, z1: q.z + 0.06, w: 0.12, img: r ? s.rocket : s.bolt, flash: 0, dissolve: 0 })
    dyn.push(r ? { x: q.x, y: q.y, r: 1, g: 0.55, b: 0.2, radius: 2.5 } : q.kind === 'ebolt' ? { x: q.x, y: q.y, r: 1, g: 0.3, b: 0.25, radius: 1.8 } : { x: q.x, y: q.y, r: 0.3, g: 0.8, b: 1, radius: 1.5 })
  }
  for (const f of w.fx) {
    if (f.kind === 'boom') {
      const k = f.t / 0.5, sz = 0.6 + k * 1.2
      sprites.push({ x: f.x, y: f.y, z0: f.z - sz / 2, z1: f.z + sz / 2, w: sz, img: s.explosion[Math.min(3, Math.floor(k * 4))]!, flash: 0, dissolve: 0 })
      dyn.push({ x: f.x, y: f.y, r: 1.6 * (1 - k), g: 0.9 * (1 - k), b: 0.3 * (1 - k), radius: 5 })
    } else sprites.push({ x: f.x, y: f.y, z0: f.z - 0.05, z1: f.z + 0.05, w: 0.1, img: s.bolt, flash: 0, dissolve: 0 })
  }
  if (p.flash > 0) {
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle)
    dyn.push({ x: p.x + dx * 0.4, y: p.y + dy * 0.4, r: 1.2 * p.flash, g: 0.9 * p.flash, b: 0.5 * p.flash, radius: 4 })
    sprites.push({ x: p.x + dx * 0.5, y: p.y + dy * 0.5, z0: p.z - 0.17, z1: p.z - 0.03, w: 0.14 * p.flash, img: s.flash, flash: 0, dissolve: 0 })
  }
  const vm: Viewmodel = {
    img: p.weapon === 0 ? s.rifle : s.launcher,
    ox: 0.16 + Math.sin(p.bob * 0.5) * 0.02, oy: Math.abs(Math.cos(p.bob * 0.5)) * 0.02 + p.kick * 0.035 + Math.max(0, p.cool - (p.weapon ? 0.5 : 0.1)) * 0.2 + (p.z - 0.5) * 0.2,
    scale: 0.5, flash: p.flash,
  }
  let tint: [number, number, number, number] | null = null
  if (w.state === 'dead') tint = [120, 10, 10, 0.45]
  else if (p.hurt > 0) tint = [255, 40, 40, p.hurt * 0.3]
  return { cam, sprites, dyn, vm, tint }
}
