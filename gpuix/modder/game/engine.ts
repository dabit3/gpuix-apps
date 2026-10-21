// Grovekeep: a tiny single-player arena game (MIT) used as the modding target.
// Pure TypeScript: simulation + a CPU pixel renderer. The GPUIX host (app.tsx) paints the framebuffer.
import sheet from './assets/sprites.json'
import { FB, H, W, hex, mix, spriteFrom, type Sprite } from './fb'
import type { EnemyDef, GameView, HookName, ModApi, WeaponDef } from './modapi'

export const ARENA = { x0: 18, y0: 26, x1: W - 18, y1: H - 14 }
const P = sheet.palette as Record<string, string>
const SP = sheet.sprites as Record<string, { rows: string[]; keys: Record<string, string> }>

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Enemy { id: number; def: EnemyDef; sprite: Sprite; x: number; y: number; vx: number; vy: number; hp: number; hopT: number; flash: number; squash: number }
interface Projectile { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; glow: number; trail: Array<[number, number]>; trailLen: number; damage: number; pierce: number; hit: Set<number> }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; glow: boolean }
export interface Input { left: boolean; right: boolean; up: boolean; down: boolean; attack: boolean }
export interface LogLine { t: number; src: string; msg: string; level: 'info' | 'warn' | 'error' }

export const BASE_WEAPON: WeaponDef = { id: 'twig-sword', name: 'Twig Sword', damage: 1, cooldown: 0.3, sprite: SP['twig-sword'] }
export const BASE_ENEMY: EnemyDef = { id: 'slime', name: 'Slime', hp: 2, speed: 1, size: 1, weight: 1, colors: { body: P.slime!, shade: P.slimeShade!, light: P.slimeLight! } }

function enemySprite(def: EnemyDef): Sprite {
  const s = SP.slime!
  const pal = { ...P, slime: def.colors.body, slimeShade: def.colors.shade, slimeLight: def.colors.light }
  const base = spriteFrom(s.rows, s.keys, pal)
  if (def.size < 1.5) return base
  // 2x: double every pixel
  return { keys: base.keys, rows: base.rows.flatMap((r) => { const w = [...r].map((c) => c + c).join(''); return [w, w] }) }
}

type Handler = { mod: string; fn: (p: any) => void }

export class Game implements GameView {
  time = 0
  kills = 0
  hits = 0
  frame = 0
  rand: () => number
  hero = { x: W / 2, y: H / 2 + 8, dx: 1, dy: 0, flip: false, hp: 5, inv: 0, swing: 0, cd: 0, walk: 0, weapon: 'twig-sword' }
  enemiesList: Enemy[] = []
  shots: Projectile[] = []
  parts: Particle[] = []
  weapons = new Map<string, WeaponDef>([[BASE_WEAPON.id, BASE_WEAPON]])
  enemyDefs = new Map<string, EnemyDef>([[BASE_ENEMY.id, BASE_ENEMY]])
  enemySprites = new Map<string, Sprite>()
  handlers = new Map<HookName, Handler[]>()
  hud: Record<string, string[]> = {}
  tune = { playerSpeed: 72, spawnInterval: 1.15, maxEnemies: 14 }
  logs: LogLine[] = []
  onLog?: (l: LogLine) => void
  private spawnT = 0.4
  private nextId = 1
  private bg: Uint32Array
  private heroSprite: Sprite
  private weaponSprites = new Map<string, Sprite>()
  shake = 0

  constructor(seed = Date.now() & 0xffff) {
    this.rand = rng(seed)
    this.heroSprite = spriteFrom(SP.hero!.rows, SP.hero!.keys, P)
    this.bg = paintBackground(seed)
  }

  // GameView
  get enemies() { return this.enemiesList.length }
  get projectiles() { return this.shots.length }
  get player() { return { x: this.hero.x, y: this.hero.y, hp: this.hero.hp, weapon: this.hero.weapon } }

  log(src: string, msg: string, level: LogLine['level'] = 'info') {
    const l = { t: this.time, src, msg, level }
    this.logs.push(l)
    if (this.logs.length > 400) this.logs.shift()
    this.onLog?.(l)
  }

  emit(hook: HookName, payload: unknown) {
    for (const h of this.handlers.get(hook) ?? []) {
      try { h.fn(payload) } catch (e) { this.log(h.mod, `${hook} handler threw: ${(e as Error).message}`, 'error') }
    }
  }

  // Everything a mod registered is dropped on reload, then the loader runs the mods again.
  resetMods() {
    this.handlers.clear()
    this.hud = {}
    this.weapons = new Map([[BASE_WEAPON.id, BASE_WEAPON]])
    this.enemyDefs = new Map([[BASE_ENEMY.id, BASE_ENEMY]])
    this.weaponSprites.clear()
    this.enemySprites.clear()
    this.tune = { playerSpeed: 72, spawnInterval: 1.15, maxEnemies: 14 }
  }

  apiFor(modId: string): ModApi {
    const g = this
    return {
      id: modId,
      game: g,
      get tune() { return g.tune },
      set tune(v) { g.tune = v },
      log: (msg) => g.log(modId, msg),
      on: (hook, fn) => { const list = g.handlers.get(hook) ?? []; list.push({ mod: modId, fn }); g.handlers.set(hook, list) },
      registerWeapon: (def) => { g.weapons.set(def.id, def); g.weaponSprites.delete(def.id); g.log(modId, `registered weapon ${def.id}`) },
      registerEnemy: (def) => { g.enemyDefs.set(def.id, def); g.enemySprites.delete(def.id); g.log(modId, `registered enemy ${def.id}`) },
      give: (id) => g.give(id),
      spawn: (id, n = 1) => g.spawn(id, n),
      setHud: (lines) => { g.hud[modId] = lines },
    }
  }

  give(id: string) {
    if (!this.weapons.has(id)) { this.log('game', `give: unknown weapon ${id}`, 'warn'); return false }
    this.hero.weapon = id
    this.log('game', `equipped ${this.weapons.get(id)!.name}`)
    return true
  }

  cycleWeapon() {
    const ids = [...this.weapons.keys()]
    this.give(ids[(ids.indexOf(this.hero.weapon) + 1) % ids.length]!)
  }

  spawn(id: string, n = 1) {
    const def = this.enemyDefs.get(id)
    if (!def) { this.log('game', `spawn: unknown enemy ${id}`, 'warn'); return 0 }
    for (let i = 0; i < n; i++) this.spawnOne(def)
    return n
  }

  newestEnemy() { return [...this.enemyDefs.keys()].pop()! }

  private spriteForEnemy(def: EnemyDef) {
    let s = this.enemySprites.get(def.id)
    if (!s) { s = enemySprite(def); this.enemySprites.set(def.id, s) }
    return s
  }

  private spawnOne(def: EnemyDef) {
    const side = Math.floor(this.rand() * 4)
    const t = this.rand()
    const x = side < 2 ? ARENA.x0 + t * (ARENA.x1 - ARENA.x0) : side === 2 ? ARENA.x0 + 4 : ARENA.x1 - 4
    const y = side >= 2 ? ARENA.y0 + t * (ARENA.y1 - ARENA.y0) : side === 0 ? ARENA.y0 + 4 : ARENA.y1 - 4
    const e: Enemy = { id: this.nextId++, def, sprite: this.spriteForEnemy(def), x, y, vx: 0, vy: 0, hp: def.hp, hopT: this.rand() * 0.6, flash: 0, squash: 0 }
    this.enemiesList.push(e)
    this.emit('spawn', { id: def.id, x, y })
  }

  key(k: string) { this.emit('key', { key: k }) }

  update(dt: number, input: Input) {
    this.time += dt
    this.frame++
    const h = this.hero
    // hero
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
    let my = (input.down ? 1 : 0) - (input.up ? 1 : 0)
    if (mx || my) {
      const l = Math.hypot(mx, my); mx /= l; my /= l
      h.dx = mx; h.dy = my
      if (mx) h.flip = mx < 0
      h.walk += dt
    }
    h.x = clamp(h.x + mx * this.tune.playerSpeed * dt, ARENA.x0 + 6, ARENA.x1 - 6)
    h.y = clamp(h.y + my * this.tune.playerSpeed * dt, ARENA.y0 + 6, ARENA.y1 - 2)
    h.inv = Math.max(0, h.inv - dt)
    h.cd = Math.max(0, h.cd - dt)
    h.swing = Math.max(0, h.swing - dt)
    if (input.attack && h.cd <= 0) this.swing()

    // spawns
    this.spawnT -= dt
    if (this.spawnT <= 0) {
      this.spawnT = this.tune.spawnInterval
      if (this.enemiesList.length < this.tune.maxEnemies) {
        const defs = [...this.enemyDefs.values()]
        let total = defs.reduce((a, d) => a + d.weight, 0) * this.rand()
        let pick = defs[0]!
        for (const d of defs) { total -= d.weight; if (total <= 0) { pick = d; break } }
        this.spawnOne(pick)
      }
    }

    // enemies: hop toward the hero
    for (const e of this.enemiesList) {
      e.hopT -= dt
      e.flash = Math.max(0, e.flash - dt * 5)
      if (e.hopT <= 0) {
        e.hopT = 0.55 + this.rand() * 0.35
        const a = Math.atan2(h.y - e.y, h.x - e.x) + (this.rand() - 0.5) * 0.6
        const s = 58 * e.def.speed
        e.vx += Math.cos(a) * s; e.vy += Math.sin(a) * s
        e.squash = 1
      }
      e.squash = Math.max(0, e.squash - dt * 3.2)
      e.x = clamp(e.x + e.vx * dt, ARENA.x0, ARENA.x1)
      e.y = clamp(e.y + e.vy * dt, ARENA.y0, ARENA.y1)
      const f = Math.pow(0.02, dt)
      e.vx *= f; e.vy *= f
      const r = 8 * e.def.size
      if (h.inv <= 0 && Math.hypot(e.x - h.x, e.y - h.y) < r) {
        h.hp--; h.inv = 1.1; this.shake = 0.25
        const a = Math.atan2(h.y - e.y, h.x - e.x)
        h.x = clamp(h.x + Math.cos(a) * 10, ARENA.x0 + 6, ARENA.x1 - 6)
        h.y = clamp(h.y + Math.sin(a) * 10, ARENA.y0 + 6, ARENA.y1 - 2)
        if (h.hp <= 0) { h.hp = 5; this.emit('faint', {}); this.log('game', 'hero fainted, back on your feet') }
      }
    }

    // projectiles
    for (const p of this.shots) {
      p.trail.push([p.x, p.y]); if (p.trail.length > p.trailLen) p.trail.shift()
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt
      for (const e of this.enemiesList) {
        if (p.pierce < 0 || p.hit.has(e.id) || e.hp <= 0) continue
        if (Math.hypot(e.x - p.x, e.y - p.y) < 7 * e.def.size) {
          p.hit.add(e.id); p.pierce--
          this.damage(e, p.damage, p.vx, p.vy, p.color)
        }
      }
      if (p.pierce < 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) p.life = Math.min(p.life, 0)
      if (p.life <= 0) for (let i = 0; i < 5; i++) this.particle(p.x, p.y, p.color, 40, true)
    }
    this.shots = this.shots.filter((p) => p.life > 0)

    for (const q of this.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.92; q.vy *= 0.92; q.life -= dt }
    this.parts = this.parts.filter((q) => q.life > 0)
    this.shake = Math.max(0, this.shake - dt)
    this.emit('tick', { dt, time: this.time })
  }

  private particle(x: number, y: number, color: number, speed: number, glow = false) {
    const a = this.rand() * Math.PI * 2, s = speed * (0.3 + this.rand())
    this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + this.rand() * 0.4, max: 0.7, color, glow })
  }

  private damage(e: Enemy, dmg: number, kx: number, ky: number, color: number) {
    e.hp -= dmg; e.flash = 1; this.hits++
    const l = Math.hypot(kx, ky) || 1
    e.vx += (kx / l) * 90; e.vy += (ky / l) * 90
    this.emit('hit', { id: e.def.id, damage: dmg, hp: e.hp })
    for (let i = 0; i < 3; i++) this.particle(e.x, e.y, color, 50, true)
    if (e.hp <= 0) {
      this.kills++
      const body = e.sprite.keys.b ?? 0xff56c25a
      for (let i = 0; i < 14; i++) this.particle(e.x, e.y, body, 70)
      this.shake = Math.max(this.shake, 0.08)
      this.emit('kill', { id: e.def.id, kills: this.kills })
    }
    this.enemiesList = this.enemiesList.filter((x) => x.hp > 0)
  }

  swing() {
    const h = this.hero
    const w = this.weapons.get(h.weapon) ?? BASE_WEAPON
    h.cd = w.cooldown; h.swing = 0.16
    for (const e of [...this.enemiesList]) {
      const dx = e.x - h.x, dy = e.y - (h.y - 2)
      const d = Math.hypot(dx, dy)
      if (d < 20 + 4 * e.def.size && (dx * h.dx + dy * h.dy) / (d || 1) > -0.25) this.damage(e, w.damage, dx, dy, hex(w.arc ?? '#f0f3f6'))
    }
    const pr = w.projectile
    if (pr) {
      const base = Math.atan2(h.dy, h.dx)
      for (let i = 0; i < pr.count; i++) {
        const a = base + ((i - (pr.count - 1) / 2) * pr.spread * Math.PI) / 180
        this.shots.push({ x: h.x + Math.cos(a) * 8, y: h.y - 3 + Math.sin(a) * 8, vx: Math.cos(a) * pr.speed, vy: Math.sin(a) * pr.speed, life: pr.life, max: pr.life, color: hex(pr.color), glow: pr.glow, trail: [], trailLen: pr.trail, damage: pr.damage, pierce: pr.pierce, hit: new Set() })
      }
    }
    this.emit('swing', { weapon: w.id, dx: h.dx, dy: h.dy })
  }

  // Autopilot: chase the nearest enemy and swing. Used by headless tests and `--autopilot`.
  autopilot(): Input {
    const h = this.hero
    let best: Enemy | null = null, bd = 1e9
    for (const e of this.enemiesList) { const d = Math.hypot(e.x - h.x, e.y - h.y); if (d < bd) { bd = d; best = e } }
    const w = this.weapons.get(h.weapon)
    const reach = w?.projectile ? 70 : 16
    const inp: Input = { left: false, right: false, up: false, down: false, attack: false }
    if (!best) { const cx = W / 2 - h.x, cy = H / 2 - h.y; inp.left = cx < -6; inp.right = cx > 6; inp.up = cy < -6; inp.down = cy > 6; return inp }
    const dx = best.x - h.x, dy = best.y - h.y
    if (bd > reach) { inp.left = dx < -3; inp.right = dx > 3; inp.up = dy < -3; inp.down = dy > 3 }
    else { const l = bd || 1; h.dx = dx / l; h.dy = dy / l; h.flip = dx < 0; inp.attack = true }
    return inp
  }

  render(fb: FB) {
    fb.px.set(this.bg)
    const h = this.hero
    // shadows first, then y-sorted sprites
    type Draw = { y: number; fn: () => void }
    const draws: Draw[] = []
    for (const e of this.enemiesList) {
      const sz = e.def.size
      fb.shadow(e.x | 0, (e.y + 5 * sz) | 0, 5 * sz, 2 * sz)
      draws.push({ y: e.y, fn: () => fb.sprite(e.sprite, Math.round(e.x - 6 * sz), Math.round(e.y - 6 * sz), { flash: e.flash, squash: e.squash * (sz > 1.5 ? 1.5 : 1) }) })
    }
    fb.shadow(h.x | 0, (h.y + 5) | 0, 5, 2)
    draws.push({ y: h.y, fn: () => this.drawHero(fb) })
    draws.sort((a, b) => a.y - b.y)
    for (const d of draws) d.fn()

    // projectiles: trail + additive glow
    for (const p of this.shots) {
      const n = p.trail.length
      for (let i = 0; i < n; i++) {
        const [tx, ty] = p.trail[i]!
        const k = (i + 1) / (n + 1)
        fb.glow(tx, ty, Math.max(1.5, p.glow * 0.55 * k), p.color, 0.35 * k)
      }
      fb.glow(p.x, p.y, p.glow, p.color, 0.9)
      fb.rect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2, mix(p.color, 0xffffffff, 0.75))
    }
    for (const q of this.parts) {
      const a = Math.min(1, q.life / 0.3)
      if (q.glow) fb.glow(q.x, q.y, 2.5, q.color, 0.6 * a)
      else fb.blend(q.x, q.y, q.color, a)
    }
    if (h.inv > 0) {
      // damage vignette
      const a = (h.inv / 1.1) * 0.35
      for (let y = 0; y < H; y += 1) { fb.rect(0, y, 3, 1, 0xff4040ff, a); fb.rect(W - 3, y, 3, 1, 0xff4040ff, a) }
    }
  }

  private weaponSprite(id: string): Sprite | null {
    let s = this.weaponSprites.get(id)
    if (s) return s
    const w = this.weapons.get(id)
    if (!w?.sprite) return null
    s = spriteFrom(w.sprite.rows, w.sprite.keys, P)
    this.weaponSprites.set(id, s)
    return s
  }

  private drawHero(fb: FB) {
    const h = this.hero
    if (h.inv > 0 && Math.floor(h.inv * 14) % 2 === 0) return
    const bob = Math.sin(h.walk * 16) > 0 ? 1 : 0
    const hx = Math.round(h.x - 6), hy = Math.round(h.y - 7 - bob)
    const ws = this.weaponSprite(h.weapon)
    const w = this.weapons.get(h.weapon) ?? BASE_WEAPON
    // weapon in hand (behind when facing left)
    if (ws && h.swing <= 0) fb.sprite(ws, h.flip ? hx - 7 : hx + 7, hy - 1, { flip: h.flip })
    fb.sprite(this.heroSprite, hx, hy, { flip: h.flip })
    if (h.swing > 0) {
      // swing arc: a crescent sweeping across the facing direction
      const t = 1 - h.swing / 0.16
      const base = Math.atan2(h.dy, h.dx)
      const arc = hex(w.arc ?? '#f0f3f6')
      for (let a = -1.3; a <= -1.3 + 2.6 * t; a += 0.05) {
        for (let r = 9; r <= 17; r++) {
          const fade = 1 - Math.abs(r - 14) / 6
          fb.blend(h.x + Math.cos(base + a) * r, h.y - 3 + Math.sin(base + a) * r, arc, fade * (0.4 + 0.6 * (a / 2.6 + 0.5)))
        }
      }
      if (ws) fb.sprite(ws, Math.round(h.x + Math.cos(base + (-1.3 + 2.6 * t)) * 10) - 6, Math.round(h.y - 3 + Math.sin(base + (-1.3 + 2.6 * t)) * 10) - 6, { flip: h.flip })
    }
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function paintBackground(seed: number): Uint32Array {
  const fb = new FB()
  const r = rng(seed ^ 0x9e37)
  const g = hex(P.grass!), gl = hex(P.grassLight!), gd = hex(P.grassDark!)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) + Math.cos(y * 0.13 + x * 0.03)
    fb.set(x, y, n > 1.1 ? gl : n < -1.2 ? gd : g)
  }
  // grass tufts and flowers
  for (let i = 0; i < 520; i++) {
    const x = r() * W, y = r() * H
    fb.set(x, y, gl); fb.set(x + 1, y - 1, gl); fb.set(x - 1, y - 1, gd)
  }
  const petals = [hex(P.petal!), hex(P.petal2!), 0xfff6f3f0]
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = r() * H, c = petals[i % 3]!
    fb.set(x, y, c); fb.set(x + 1, y, c); fb.set(x, y + 1, c); fb.set(x + 1, y + 1, mix(c, 0xff2f6b3a, 0.4))
  }
  // a worn path across the clearing
  const path = hex(P.path!), pd = hex(P.pathDark!)
  for (let x = 0; x < W; x++) {
    const cy = H * 0.62 + Math.sin(x * 0.03) * 10
    for (let k = -5; k <= 5; k++) {
      const edge = Math.abs(k) >= 4
      if (edge && r() < 0.5) continue
      fb.set(x, cy + k, edge ? pd : r() < 0.12 ? pd : path)
    }
  }
  // tree canopy border
  const leaf = hex(P.leaf!), ll = hex(P.leafLight!), bark = hex(P.bark!)
  const tree = (cx: number, cy: number, rad: number) => {
    fb.rect(cx - 2, cy + rad - 3, 4, 7, bark)
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      const d = Math.hypot(x, y * 1.15)
      if (d > rad + Math.sin(x * 1.7 + y) * 1.2) continue
      fb.set(cx + x, cy + y, x + y < -rad * 0.4 && d < rad - 2 ? ll : leaf)
    }
  }
  for (let x = -6; x < W + 10; x += 15) { tree(x + (r() * 6 | 0), 6 + (r() * 6 | 0), 11); tree(x + 7 + (r() * 6 | 0), H - 2 + (r() * 4 | 0), 10) }
  for (let y = 20; y < H - 10; y += 16) { tree(2 + (r() * 4 | 0), y, 10); tree(W - 3 - (r() * 4 | 0), y + 6, 10) }
  // soft vignette
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2)
    const v = Math.max(0, dx * dx + dy * dy - 0.55) * 0.35
    if (v > 0) fb.blend(x, y, 0xff100c0a, Math.min(0.5, v))
  }
  return fb.px.slice()
}
