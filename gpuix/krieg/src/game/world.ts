// Game simulation: player movement + collision, doors, two enemy types with idle → patrol → chase → attack
// AI (line of sight + BFS flow field), hitscan rifle, splash-damage launcher, pickups, key door and exit.
import { EMPTY, MH, MW, generateLevel, lineOfSight, roomAt, solidAt, type EnemyKind, type Level, type PickupKind } from '../gen/level'
import { mulberry, type Rng } from '../gen/rng'

export type AiState = 'idle' | 'patrol' | 'chase' | 'attack' | 'dead'
export interface Enemy { id: number; kind: EnemyKind; x: number; y: number; hp: number; maxHp: number; state: AiState; t: number; cool: number; flash: number; dissolve: number; anim: number; tx: number; ty: number; room: number; lastSeen: number; pain: number; atk: number; gib: boolean }
export interface Pickup { kind: PickupKind; x: number; y: number; taken: boolean }
export interface Proj { kind: 'bolt' | 'rocket' | 'ebolt'; x: number; y: number; z: number; vx: number; vy: number; life: number }
// 'p' = physics particle: c 0 spark, 1 blood, 2 ember, 3 smoke/dust, 4 gib chunk.
export interface Fx { kind: 'boom' | 'p'; x: number; y: number; z: number; t: number; vx?: number; vy?: number; vz?: number; c?: number; life?: number }
export interface Tracer { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number; len: number }
export interface Input { fwd: number; strafe: number; turn: number; look: number; fire: boolean; jump: boolean; crouch: boolean }
export type GameEvent = 'shoot' | 'launch' | 'hit' | 'die' | 'pickup' | 'key' | 'door' | 'hurt' | 'boom' | 'step' | 'eshoot' | 'win' | 'lose' | 'empty' | 'swap' | 'locked' | 'shotgun' | 'pain' | 'fire' | 'sight' | 'bite'

export const WEAPONS = [
  { name: 'SHOTGUN', cooldown: 0.8, damage: 13 },
  { name: 'CHAINGUN', cooldown: 0.11, damage: 16 },
  { name: 'ROCKET LAUNCHER', cooldown: 0.75, damage: 110 },
] as const

// size = sprite height in world units; pain = chance a hit staggers. Barrels are inert, explosive props.
const STATS: Record<EnemyKind, { hp: number; speed: number; radius: number; z0: number; z1: number; size: number; pain: number; range: number }> = {
  trooper: { hp: 40, speed: 1.7, radius: 0.3, z0: 0, z1: 0.8, size: 1, pain: 0.7, range: 9 },
  imp: { hp: 60, speed: 1.9, radius: 0.32, z0: 0, z1: 0.84, size: 1.04, pain: 0.5, range: 8 },
  brute: { hp: 150, speed: 3.3, radius: 0.42, z0: 0, z1: 0.82, size: 1.12, pain: 0.3, range: 1 },
  barrel: { hp: 20, speed: 0, radius: 0.26, z0: 0, z1: 0.6, size: 0.6, pain: 0, range: 0 },
}
export const enemyStats = (k: EnemyKind) => STATS[k]
export const TRACER_SPEED = 60, TRACER_LEN = 3

export class World {
  level: Level
  rng: Rng
  p = { x: 0, y: 0, angle: 0, pitch: 0, z: 0.5, vz: 0, hp: 100, ammo: 80, shells: 24, rockets: 6, weapon: 0, hasKey: false, cool: 0, kick: 0, flash: 0, hurt: 0, bob: 0, stepAcc: 0, vx: 0, vy: 0, shake: 0, hitT: 0, killT: 0, sway: 0 }
  enemies: Enemy[]
  pickups: Pickup[]
  projs: Proj[] = []
  fx: Fx[] = []
  tracers: Tracer[] = []
  kills = 0
  time = 0
  state: 'play' | 'won' | 'dead' = 'play'
  god = false
  events: GameEvent[] = []
  toast = { text: '', t: 0 }
  flow = new Int16Array(MW * MH)
  private flowT = 0

  constructor(seed = 1337) {
    this.level = generateLevel(seed)
    this.rng = mulberry(seed ^ 0x5eed)
    const s = this.level.start
    Object.assign(this.p, { x: s.x, y: s.y, angle: s.angle })
    this.enemies = this.level.enemies.map((e, id) => {
      const st = STATS[e.kind]
      return { id, kind: e.kind, x: e.x, y: e.y, hp: st.hp, maxHp: st.hp, state: 'idle' as AiState, t: this.rng() * 2, cool: 1, flash: 0, dissolve: 0, anim: this.rng() * 4, tx: e.x, ty: e.y, room: e.room, lastSeen: -99, pain: 0, atk: 0, gib: false }
    })
    this.pickups = this.level.pickups.map((p) => ({ kind: p.kind, x: p.x, y: p.y, taken: false }))
    this.computeFlow()
  }

  get alive() { return this.enemies.filter((e) => e.kind !== 'barrel' && e.state !== 'dead').length }
  get monsters() { return this.enemies.filter((e) => e.kind !== 'barrel').length }

  say(text: string) { this.toast = { text, t: 2.5 } }

  private walkable(cx: number, cy: number, forPlayer: boolean) {
    if (cx < 0 || cy < 0 || cx >= MW || cy >= MH) return false
    const i = cy * MW + cx
    const d = this.level.doorAt[i]!
    if (d >= 0) return !this.level.doors[d]!.locked || (forPlayer && this.p.hasKey) || this.level.doors[d]!.open > 0.85
    return this.level.cells[i] === EMPTY
  }

  private blocked(x: number, y: number, r: number, forPlayer: boolean) {
    for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]] as const) {
      const cx = Math.floor(x + ox), cy = Math.floor(y + oy)
      if (cx < 0 || cy < 0 || cx >= MW || cy >= MH) return true
      if (solidAt(this.level, x + ox, y + oy)) return true
      if (!forPlayer && !this.walkable(cx, cy, false)) return true
    }
    return false
  }

  private move(o: { x: number; y: number }, dx: number, dy: number, r: number, forPlayer: boolean) {
    if (!this.blocked(o.x + dx, o.y, r, forPlayer)) o.x += dx
    if (!this.blocked(o.x, o.y + dy, r, forPlayer)) o.y += dy
  }

  // BFS distance field from the player's cell; enemies descend it to path around walls.
  computeFlow() {
    const f = this.flow
    f.fill(-1)
    const sx = Math.floor(this.p.x), sy = Math.floor(this.p.y)
    const q = new Int32Array(MW * MH)
    let h = 0, t = 0
    f[sy * MW + sx] = 0; q[t++] = sy * MW + sx
    while (h < t) {
      const i = q[h++]!, x = i % MW, y = (i / MW) | 0
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + ox, ny = y + oy, ni = ny * MW + nx
        if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || f[ni]! >= 0 || !this.walkable(nx, ny, false)) continue
        f[ni] = f[i]! + 1; q[t++] = ni
      }
    }
  }

  step(dt: number, inp: Input) {
    dt = Math.min(dt, 0.05)
    this.events.length = 0
    if (this.toast.t > 0) this.toast.t -= dt
    const p = this.p
    p.flash = Math.max(0, p.flash - dt * 8); p.kick = Math.max(0, p.kick - dt * 5); p.hurt = Math.max(0, p.hurt - dt * 2)
    p.shake = Math.max(0, p.shake - dt * 3); p.hitT = Math.max(0, p.hitT - dt * 5); p.killT = Math.max(0, p.killT - dt * 2.5); p.sway *= Math.max(0, 1 - dt * 8)
    this.updateDoors(dt)
    this.updateFx(dt)
    if (this.state !== 'play') { this.updateEnemies(dt); return }
    this.time += dt
    // Look + move.
    p.angle += inp.turn * dt * 2.6
    p.pitch = Math.max(-0.35, Math.min(0.35, p.pitch + inp.look * dt * 0.8))
    const len = Math.hypot(inp.fwd, inp.strafe) || 1
    const crouch = inp.crouch && p.vz === 0 && p.z <= 0.5
    const sp = (crouch ? 1.7 : 3.6) * dt
    const cs = Math.cos(p.angle), sn = Math.sin(p.angle)
    const mf = inp.fwd / len, ms = inp.strafe / len
    // Velocity eases toward the input direction so starts and stops feel weighted instead of snapping.
    const k = Math.min(1, dt * 14)
    p.vx += ((cs * mf - sn * ms) * sp - p.vx) * k; p.vy += ((sn * mf + cs * ms) * sp - p.vy) * k
    this.move(p, p.vx, p.vy, 0.32, true)
    for (const e of this.enemies) if (e.state !== 'dead') {
      const ox = p.x - e.x, oy = p.y - e.y, d = Math.hypot(ox, oy), m = STATS[e.kind].radius + 0.28
      if (d < m && d > 1e-4) this.move(p, (ox / d) * (m - d), (oy / d) * (m - d), 0.32, true)
    }
    const moving = Math.abs(inp.fwd) + Math.abs(inp.strafe) > 0
    if (moving && p.vz === 0) {
      p.bob += dt * 9; p.stepAcc += sp
      if (p.stepAcc > 1.1) { p.stepAcc = 0; this.events.push('step') }
    }
    // Jump / crouch move the eye height.
    if (inp.jump && p.vz === 0 && p.z <= 0.5) p.vz = 1.5
    if (p.vz !== 0 || p.z > 0.5) {
      p.z += p.vz * dt; p.vz -= 5 * dt
      if (p.z <= 0.5) { p.z = 0.5; p.vz = 0 }
    } else p.z += ((crouch ? 0.3 : 0.5) - p.z) * Math.min(1, dt * 12)
    // Weapons.
    p.cool -= dt
    if (inp.fire && p.cool <= 0) this.fire()
    // Pickups.
    for (const k of this.pickups) {
      if (k.taken || Math.hypot(k.x - p.x, k.y - p.y) > 0.6) continue
      if (k.kind === 'health') { if (p.hp >= 100) continue; p.hp = Math.min(100, p.hp + 30); this.say('+30 HEALTH') }
      if (k.kind === 'ammo') { p.ammo += 40; this.say('+40 BULLETS') }
      if (k.kind === 'shells') { p.shells += 12; this.say('+12 SHELLS') }
      if (k.kind === 'rockets') { p.rockets += 4; this.say('+4 ROCKETS') }
      if (k.kind === 'key') { p.hasKey = true; this.say('ACCESS KEY ACQUIRED'); this.events.push('key') }
      k.taken = true; this.events.push('pickup')
    }
    this.flowT -= dt
    if (this.flowT <= 0) { this.flowT = 0.25; this.computeFlow() }
    this.updateEnemies(dt)
    this.updateProjs(dt)
    if (Math.hypot(this.level.exit.x - p.x, this.level.exit.y - p.y) < 0.8) { this.state = 'won'; this.events.push('win') }
    if (p.hp <= 0) { p.hp = 0; this.state = 'dead'; this.events.push('lose') }
  }

  swap(w?: number) {
    const n = w ?? (this.p.weapon + 1) % 3
    if (n !== this.p.weapon) { this.p.weapon = n; this.p.cool = 0.25; this.events.push('swap') }
  }

  private fire() {
    const p = this.p, wi = p.weapon, w = WEAPONS[wi]!
    if ((wi === 0 ? p.shells : wi === 1 ? p.ammo : p.rockets) <= 0) { p.cool = 0.3; this.events.push('empty'); this.say(['NO SHELLS', 'NO BULLETS', 'NO ROCKETS'][wi]!); return }
    p.cool = w.cooldown; p.kick = 1; p.flash = 1; p.shake = Math.max(p.shake, [0.45, 0.16, 0.5][wi]!)
    if (wi === 2) {
      const dx = Math.cos(p.angle), dy = Math.sin(p.angle)
      p.rockets--
      this.projs.push({ kind: 'rocket', x: p.x + dx * 0.3, y: p.y + dy * 0.3, z: p.z - 0.08, vx: dx * 9, vy: dy * 9, life: 3 })
      this.events.push('launch')
      return
    }
    if (wi === 0) { p.shells--; this.events.push('shotgun'); for (let i = 0; i < 7; i++) this.hitscan(p.angle + (this.rng() - 0.5) * 0.15, w.damage, 4) }
    else { p.ammo--; this.events.push('shoot'); this.hitscan(p.angle + (this.rng() - 0.5) * 0.02, w.damage, 8) }
  }

  // Hitscan: nearest living target within its radius of the ray, in front of the wall hit and vertically aligned.
  private hitscan(ang: number, dmg: number, sparks: number) {
    const p = this.p, dx = Math.cos(ang), dy = Math.sin(ang)
    const wall = this.rayWall(p.x, p.y, dx, dy)
    let best: Enemy | null = null, bd = wall
    const aimZ = p.z + p.pitch * -1.2
    for (const e of this.enemies) {
      if (e.state === 'dead') continue
      const st = STATS[e.kind]
      const ex = e.x - p.x, ey = e.y - p.y
      const along = ex * dx + ey * dy
      if (along <= 0 || along >= bd) continue
      const perp = Math.abs(ex * dy - ey * dx)
      // Slight cone widening with distance: terminal mouse-drag aim is coarser than pointer lock.
      if (perp < st.radius + 0.06 + along * 0.025 && aimZ > st.z0 - 0.35 && aimZ < st.z1 + 0.35) { best = e; bd = along }
    }
    const hx = p.x + dx * (bd - 0.06), hy = p.y + dy * (bd - 0.06)
    let hz = Math.max(0.03, Math.min(0.97, p.z + p.pitch * bd / 0.95))
    if (best) { const st = STATS[best.kind]; hz = Math.max(st.z0 + 0.12, Math.min(st.z1 - 0.1, hz)); this.burst(hx, hy, hz, sparks, best.kind === 'barrel' ? 0 : 1, 2.2); this.damage(best, dmg, dx, dy) }
    else { this.burst(hx, hy, hz, sparks, 0, 2.6); this.burst(hx, hy, hz, 2, 3, 0.5) }
    // Tracer starts at the barrel (forward and slightly right/below the eye) and races to the impact point.
    const ox = p.x + dx * 0.35 - dy * 0.07, oy = p.y + dy * 0.35 + dx * 0.07
    this.tracers.push({ x0: ox, y0: oy, z0: p.z - 0.02, x1: hx, y1: hy, z1: hz, t: 0.016, len: Math.hypot(hx - ox, hy - oy) })
  }

  rayWall(x: number, y: number, dx: number, dy: number) {
    for (let t = 0.05; t < 40; t += 0.05) if (solidAt(this.level, x + dx * t, y + dy * t)) return t
    return 40
  }

  burst(x: number, y: number, z: number, n: number, c: number, v: number) {
    for (let i = 0; i < n; i++) {
      const a = this.rng() * 6.283, s = v * (0.3 + this.rng())
      this.fx.push({ kind: 'p', x, y, z, t: 0, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: (this.rng() * 1.2 - 0.2) * v * (c === 3 ? 0.3 : 1), c, life: c === 3 ? 0.7 : c === 4 ? 1 + this.rng() * 0.5 : c === 1 ? 0.45 + this.rng() * 0.4 : 0.25 + this.rng() * 0.35 })
    }
  }

  damage(e: Enemy, n: number, kx = 0, ky = 0) {
    if (e.state === 'dead') return
    const st = STATS[e.kind]
    e.hp -= n; e.flash = 1
    if (e.kind === 'barrel') {
      if (e.hp <= 0) { e.state = 'dead'; this.explode(e.x, e.y) }
      return
    }
    this.p.hitT = 1
    if (kx || ky) this.move(e, kx * 0.12, ky * 0.12, st.radius * 0.7, false)
    e.lastSeen = this.time
    if (e.state === 'idle' || e.state === 'patrol') e.state = 'chase'
    const z = st.z1 * 0.6
    if (e.hp <= 0) {
      // Overkill (rockets, barrels, point-blank shotgun) gibs instead of the falling death.
      e.state = 'dead'; e.dissolve = 0.001; e.atk = 0; e.gib = e.hp <= -Math.min(40, e.maxHp * 0.6); this.kills++; this.p.killT = 1; this.events.push('die')
      this.burst(e.x, e.y, z, e.gib ? 26 : 14, 1, e.gib ? 3.5 : 2.4)
      if (e.gib) this.burst(e.x, e.y, z, 12, 4, 3.2)
    } else {
      this.events.push('hit')
      if (this.rng() < st.pain) { e.pain = 0.28; e.atk = 0; this.events.push('pain') }
    }
  }

  private hurt(n: number) {
    if (this.god || this.state !== 'play') return
    this.p.hp -= n; this.p.hurt = 1; this.events.push('hurt')
  }

  private updateDoors(dt: number) {
    const L = this.level
    for (const d of L.doors) {
      const cx = d.x + 0.5, cy = d.y + 0.5
      const pd = Math.hypot(this.p.x - cx, this.p.y - cy)
      let want = pd < 1.7 && (!d.locked || this.p.hasKey)
      if (pd < 1.4 && d.locked && !this.p.hasKey && this.toast.t <= 0 && this.state === 'play') { this.say('LOCKED: FIND THE ACCESS KEY'); this.events.push('locked') }
      if (!d.locked) for (const e of this.enemies) if (e.state === 'chase' && Math.hypot(e.x - cx, e.y - cy) < 1.5) want = true
      if (want) { if (d.open === 0) this.events.push('door'); d.open = Math.min(1, d.open + dt * 2.2); d.timer = 1.5 }
      else if ((d.timer -= dt) <= 0 && !(Math.floor(this.p.x) === d.x && Math.floor(this.p.y) === d.y)) d.open = Math.max(0, d.open - dt * 1.6)
    }
  }

  private updateEnemies(dt: number) {
    const p = this.p
    for (const e of this.enemies) {
      e.flash = Math.max(0, e.flash - dt * 6)
      if (e.kind === 'barrel') continue
      if (e.state === 'dead') { if (e.dissolve < 1) e.dissolve = Math.min(1, e.dissolve + dt * 1.8); continue }
      const st = STATS[e.kind]
      const d = Math.hypot(p.x - e.x, p.y - e.y)
      const sees = this.state === 'play' && d < 13 && lineOfSight(this.level, e.x, e.y, p.x, p.y)
      if (sees) e.lastSeen = this.time
      e.t -= dt; e.cool -= dt
      if (e.pain > 0) { e.pain -= dt; continue }
      if (e.state === 'idle') { if (e.t <= 0) { e.state = 'patrol'; this.pickPatrol(e) } }
      else if (e.state === 'patrol' && Math.hypot(e.tx - e.x, e.ty - e.y) < 0.3) { e.state = 'idle'; e.t = 0.8 + this.rng() * 1.5 }
      if ((e.state === 'idle' || e.state === 'patrol') && sees && d < (e.kind === 'brute' ? 8 : 11)) { e.state = 'chase'; if (d < 9) this.events.push('sight') }
      if (e.state === 'chase' || e.state === 'attack') {
        if (this.time - e.lastSeen > 6 || this.state !== 'play') { e.state = 'patrol'; this.pickPatrol(e) }
        else e.state = sees && d < st.range ? 'attack' : 'chase'
      }
      let vx = 0, vy = 0
      if (e.state === 'patrol') { const dx = e.tx - e.x, dy = e.ty - e.y, l = Math.hypot(dx, dy) || 1; vx = dx / l * 0.5; vy = dy / l * 0.5 }
      else if (e.atk <= 0 && (e.state === 'chase' || (e.state === 'attack' && e.kind === 'brute' && d > 0.8))) {
        let tx = p.x, ty = p.y
        if (!sees) { const n = this.downhill(e.x, e.y); if (n) [tx, ty] = n }
        const dx = tx - e.x, dy = ty - e.y, l = Math.hypot(dx, dy) || 1
        vx = dx / l; vy = dy / l
      }
      // Separation keeps the pack from stacking into one sprite.
      for (const o of this.enemies) {
        if (o === e || o.state === 'dead') continue
        const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy)
        if (od < 0.6 && od > 1e-4) { vx += (ox / od) * 0.6; vy += (oy / od) * 0.6 }
      }
      if (vx || vy) { this.move(e, vx * st.speed * dt, vy * st.speed * dt, st.radius * 0.7, false); e.anim += dt * st.speed * 3 }
      // Attacks wind up (frame 4) and land at atk 0.15 (frame 5), so every shot is telegraphed.
      if (e.atk > 0) { const a0 = e.atk; e.atk -= dt; if (a0 > 0.15 && e.atk <= 0.15) this.strike(e, d) }
      else if (e.state === 'attack' && e.cool <= 0) { e.atk = e.kind === 'brute' ? 0.4 : 0.55; e.cool = e.kind === 'brute' ? 1.1 : e.kind === 'trooper' ? 1.4 + this.rng() : 1.9 + this.rng() * 0.6 }
    }
  }

  private strike(e: Enemy, d: number) {
    const p = this.p
    if (e.kind === 'brute' || d < 0.95) { if (d < 1.3) { this.hurt(e.kind === 'brute' ? 15 : 8); this.events.push('bite') } return }
    if (!lineOfSight(this.level, e.x, e.y, p.x, p.y)) return
    const ux = (p.x - e.x) / d, uy = (p.y - e.y) / d
    if (e.kind === 'imp') { this.projs.push({ kind: 'ebolt', x: e.x + ux * 0.3, y: e.y + uy * 0.3, z: 0.6, vx: ux * 5, vy: uy * 5, life: 3 }); this.events.push('fire'); return }
    const hit = this.rng() < Math.max(0.3, 0.85 - d * 0.06), miss = hit ? 0 : (this.rng() - 0.5) * 1.4
    const x0 = e.x + ux * 0.3, y0 = e.y + uy * 0.3, end = Math.max(0.5, d - 0.5)
    const x1 = e.x + ux * end - uy * miss, y1 = e.y + uy * end + ux * miss
    this.tracers.push({ x0, y0, z0: 0.48, x1, y1, z1: p.z - 0.08, t: 0.016, len: Math.hypot(x1 - x0, y1 - y0) })
    if (hit) this.hurt(4 + Math.floor(this.rng() * 6))
    this.events.push('eshoot')
  }

  private downhill(x: number, y: number): [number, number] | null {
    const cx = Math.floor(x), cy = Math.floor(y)
    let best = this.flow[cy * MW + cx]!, bx = -1, by = -1
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + ox, ny = cy + oy
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue
      const v = this.flow[ny * MW + nx]!
      if (v >= 0 && (best < 0 || v < best)) { best = v; bx = nx; by = ny }
    }
    return bx < 0 ? null : [bx + 0.5, by + 0.5]
  }

  private pickPatrol(e: Enemy) {
    const r = this.level.rooms[e.room] ?? this.level.rooms[Math.max(0, roomAt(this.level, e.x, e.y))]!
    for (let k = 0; k < 12; k++) {
      const x = r.x0 + 1 + this.rng() * (r.x1 - r.x0 - 1), y = r.y0 + 1 + this.rng() * (r.y1 - r.y0 - 1)
      if (!solidAt(this.level, x, y)) { e.tx = x; e.ty = y; return }
    }
    e.tx = e.x; e.ty = e.y
  }

  private updateProjs(dt: number) {
    const p = this.p
    for (const q of this.projs) {
      q.life -= dt
      const nx = q.x + q.vx * dt, ny = q.y + q.vy * dt
      let hit = solidAt(this.level, nx, ny)
      if (q.kind === 'ebolt') {
        if (Math.hypot(nx - p.x, ny - p.y) < 0.35) { this.hurt(10); q.life = 0; this.burst(nx, ny, q.z, 8, 2, 1.8); continue }
      } else for (const e of this.enemies) if (e.state !== 'dead' && Math.hypot(e.x - nx, e.y - ny) < STATS[e.kind].radius + 0.1) hit = true
      if (hit || q.life <= 0) {
        q.life = 0
        if (q.kind === 'rocket') this.explode(q.x, q.y)
        else this.burst(q.x, q.y, q.z, 8, 2, 1.8)
        continue
      }
      q.x = nx; q.y = ny
    }
    this.projs = this.projs.filter((q) => q.life > 0)
  }

  private explode(x: number, y: number) {
    this.fx.push({ kind: 'boom', x, y, z: 0.45, t: 0 })
    this.burst(x, y, 0.45, 18, 0, 5); this.burst(x, y, 0.4, 8, 3, 1.2)
    this.p.shake = Math.max(this.p.shake, Math.max(0, 1.2 - Math.hypot(this.p.x - x, this.p.y - y) / 8))
    this.events.push('boom')
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - x, e.y - y)
      if (d < 2.4 && lineOfSight(this.level, x, y, e.x, e.y)) this.damage(e, WEAPONS[2].damage * (1 - d / 2.4 * 0.7))
    }
    const pd = Math.hypot(this.p.x - x, this.p.y - y)
    if (pd < 1.6) this.hurt(Math.round(25 * (1 - pd / 1.6)))
  }

  private updateFx(dt: number) {
    for (const f of this.fx) {
      f.t += dt
      if (f.kind !== 'p') continue
      const smoke = f.c === 3
      f.vz! -= (smoke ? -0.6 : 7) * dt
      const nx = f.x + f.vx! * dt, ny = f.y + f.vy! * dt
      if (solidAt(this.level, nx, f.y)) f.vx! *= -0.4; else f.x = nx
      if (solidAt(this.level, f.x, ny)) f.vy! *= -0.4; else f.y = ny
      f.z += f.vz! * dt
      if (f.z < 0.02) { f.z = 0.02; f.vz = -f.vz! * 0.35; f.vx! *= 0.6; f.vy! *= 0.6 }
      if (smoke) { f.vx! *= 1 - dt * 3; f.vy! *= 1 - dt * 3 }
    }
    this.fx = this.fx.filter((f) => f.t < (f.kind === 'boom' ? 0.5 : f.life!))
    for (const r of this.tracers) r.t += dt
    this.tracers = this.tracers.filter((r) => r.t * TRACER_SPEED < r.len + TRACER_LEN)
  }
}
