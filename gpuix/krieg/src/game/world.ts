// Game simulation: player movement + collision, doors, two enemy types with idle → patrol → chase → attack
// AI (line of sight + BFS flow field), hitscan rifle, splash-damage launcher, pickups, key door and exit.
import { EMPTY, MH, MW, generateLevel, lineOfSight, roomAt, solidAt, type EnemyKind, type Level, type PickupKind } from '../gen/level'
import { mulberry, type Rng } from '../gen/rng'

export type AiState = 'idle' | 'patrol' | 'chase' | 'attack' | 'dead'
export interface Enemy { id: number; kind: EnemyKind; x: number; y: number; hp: number; maxHp: number; state: AiState; t: number; cool: number; flash: number; dissolve: number; anim: number; tx: number; ty: number; room: number; lastSeen: number }
export interface Pickup { kind: PickupKind; x: number; y: number; taken: boolean }
export interface Proj { kind: 'bolt' | 'rocket' | 'ebolt'; x: number; y: number; z: number; vx: number; vy: number; life: number }
export interface Fx { kind: 'boom' | 'spark'; x: number; y: number; z: number; t: number }
export interface Input { fwd: number; strafe: number; turn: number; look: number; fire: boolean; jump: boolean; crouch: boolean }
export type GameEvent = 'shoot' | 'launch' | 'hit' | 'die' | 'pickup' | 'key' | 'door' | 'hurt' | 'boom' | 'step' | 'eshoot' | 'win' | 'lose' | 'empty' | 'swap' | 'locked'

export const WEAPONS = [
  { name: 'PULSE RIFLE', cooldown: 0.13, damage: 22 },
  { name: 'ROCKET LAUNCHER', cooldown: 0.75, damage: 110 },
] as const

const STATS: Record<EnemyKind, { hp: number; speed: number; radius: number; z0: number; z1: number }> = {
  spider: { hp: 45, speed: 2.3, radius: 0.32, z0: 0, z1: 0.42 },
  sentry: { hp: 70, speed: 1.3, radius: 0.36, z0: 0.42, z1: 0.92 },
}
export const enemyStats = (k: EnemyKind) => STATS[k]

export class World {
  level: Level
  rng: Rng
  p = { x: 0, y: 0, angle: 0, pitch: 0, z: 0.5, vz: 0, hp: 100, ammo: 80, rockets: 6, weapon: 0, hasKey: false, cool: 0, kick: 0, flash: 0, hurt: 0, bob: 0, stepAcc: 0 }
  enemies: Enemy[]
  pickups: Pickup[]
  projs: Proj[] = []
  fx: Fx[] = []
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
      return { id, kind: e.kind, x: e.x, y: e.y, hp: st.hp, maxHp: st.hp, state: 'idle' as AiState, t: this.rng() * 2, cool: 1, flash: 0, dissolve: 0, anim: this.rng() * 4, tx: e.x, ty: e.y, room: e.room, lastSeen: -99 }
    })
    this.pickups = this.level.pickups.map((p) => ({ kind: p.kind, x: p.x, y: p.y, taken: false }))
    this.computeFlow()
  }

  get alive() { return this.enemies.filter((e) => e.state !== 'dead').length }

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
    const mx = (cs * mf - sn * ms) * sp, my = (sn * mf + cs * ms) * sp
    this.move(p, mx, my, 0.32, true)
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
      if (k.kind === 'ammo') { p.ammo += 40; this.say('+40 CELLS') }
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
    const n = w ?? 1 - this.p.weapon
    if (n !== this.p.weapon) { this.p.weapon = n; this.p.cool = 0.25; this.events.push('swap') }
  }

  private fire() {
    const p = this.p
    const w = WEAPONS[p.weapon]!
    if (p.weapon === 0 ? p.ammo <= 0 : p.rockets <= 0) { p.cool = 0.3; this.events.push('empty'); this.say(p.weapon === 0 ? 'NO CELLS' : 'NO ROCKETS'); return }
    p.cool = w.cooldown; p.kick = 1; p.flash = 1
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle)
    if (p.weapon === 1) {
      p.rockets--
      this.projs.push({ kind: 'rocket', x: p.x + dx * 0.3, y: p.y + dy * 0.3, z: p.z - 0.08, vx: dx * 9, vy: dy * 9, life: 3 })
      this.events.push('launch')
      return
    }
    p.ammo--
    this.events.push('shoot')
    // Hitscan: nearest living enemy within its radius of the ray, in front of the wall hit and vertically aligned.
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
      const zz = aimZ + p.pitch * along * 0
      // Slight cone widening with distance: terminal mouse-drag aim is coarser than pointer lock.
      if (perp < st.radius + 0.06 + along * 0.025 && zz > st.z0 - 0.35 && zz < st.z1 + 0.35) { best = e; bd = along }
    }
    if (best) this.damage(best, w.damage)
    this.fx.push({ kind: 'spark', x: p.x + dx * (bd - 0.1), y: p.y + dy * (bd - 0.1), z: best ? (STATS[best.kind].z0 + STATS[best.kind].z1) / 2 : p.z, t: 0 })
  }

  rayWall(x: number, y: number, dx: number, dy: number) {
    for (let t = 0.05; t < 40; t += 0.05) if (solidAt(this.level, x + dx * t, y + dy * t)) return t
    return 40
  }

  damage(e: Enemy, n: number) {
    if (e.state === 'dead') return
    e.hp -= n; e.flash = 1
    e.lastSeen = this.time
    if (e.state === 'idle' || e.state === 'patrol') e.state = 'chase'
    if (e.hp <= 0) { e.state = 'dead'; e.dissolve = 0.001; this.kills++; this.events.push('die') }
    else this.events.push('hit')
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
      if (e.state === 'dead') { if (e.dissolve > 0 && e.dissolve < 1) e.dissolve = Math.min(1, e.dissolve + dt * 0.9); continue }
      const st = STATS[e.kind]
      const d = Math.hypot(p.x - e.x, p.y - e.y)
      const sees = this.state === 'play' && d < 13 && lineOfSight(this.level, e.x, e.y, p.x, p.y)
      if (sees) e.lastSeen = this.time
      e.t -= dt; e.cool -= dt
      if (e.state === 'idle') { if (e.t <= 0) { e.state = 'patrol'; this.pickPatrol(e) } }
      else if (e.state === 'patrol' && Math.hypot(e.tx - e.x, e.ty - e.y) < 0.3) { e.state = 'idle'; e.t = 0.8 + this.rng() * 1.5 }
      if ((e.state === 'idle' || e.state === 'patrol') && sees && d < (e.kind === 'sentry' ? 11 : 8)) e.state = 'chase'
      if (e.state === 'chase' || e.state === 'attack') {
        if (this.time - e.lastSeen > 6 || this.state !== 'play') { e.state = 'patrol'; this.pickPatrol(e) }
        else {
          const range = e.kind === 'spider' ? 0.85 : 6.5
          e.state = sees && d < range ? 'attack' : 'chase'
        }
      }
      let vx = 0, vy = 0
      if (e.state === 'patrol') { const dx = e.tx - e.x, dy = e.ty - e.y, l = Math.hypot(dx, dy) || 1; vx = dx / l * 0.5; vy = dy / l * 0.5 }
      else if (e.state === 'chase' || (e.state === 'attack' && e.kind === 'sentry' && d > 4.5)) {
        let tx = p.x, ty = p.y
        if (!sees) { const n = this.downhill(e.x, e.y); if (n) [tx, ty] = n }
        const dx = tx - e.x, dy = ty - e.y, l = Math.hypot(dx, dy) || 1
        vx = dx / l; vy = dy / l
      } else if (e.state === 'attack' && e.kind === 'sentry' && d < 3.5) { vx = -(p.x - e.x) / d * 0.6; vy = -(p.y - e.y) / d * 0.6 }
      // Separation keeps the pack from stacking into one sprite.
      for (const o of this.enemies) {
        if (o === e || o.state === 'dead') continue
        const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy)
        if (od < 0.6 && od > 1e-4) { vx += (ox / od) * 0.6; vy += (oy / od) * 0.6 }
      }
      if (vx || vy) { this.move(e, vx * st.speed * dt, vy * st.speed * dt, st.radius * 0.7, false); e.anim += dt * st.speed * 4 }
      if (e.state === 'attack' && e.cool <= 0) {
        if (e.kind === 'spider') { e.cool = 0.9; this.hurt(5) }
        else {
          e.cool = 1.9
          const l = d || 1
          this.projs.push({ kind: 'ebolt', x: e.x, y: e.y, z: 0.67, vx: ((p.x - e.x) / l) * 4.5, vy: ((p.y - e.y) / l) * 4.5, life: 3 })
          this.events.push('eshoot')
        }
      }
    }
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
        if (Math.hypot(nx - p.x, ny - p.y) < 0.35) { this.hurt(9); q.life = 0; this.fx.push({ kind: 'spark', x: nx, y: ny, z: q.z, t: 0 }); continue }
      } else for (const e of this.enemies) if (e.state !== 'dead' && Math.hypot(e.x - nx, e.y - ny) < STATS[e.kind].radius + 0.1) hit = true
      if (hit || q.life <= 0) {
        q.life = 0
        if (q.kind === 'rocket') this.explode(q.x, q.y)
        else this.fx.push({ kind: 'spark', x: q.x, y: q.y, z: q.z, t: 0 })
        continue
      }
      q.x = nx; q.y = ny
    }
    this.projs = this.projs.filter((q) => q.life > 0)
  }

  private explode(x: number, y: number) {
    this.fx.push({ kind: 'boom', x, y, z: 0.45, t: 0 })
    this.events.push('boom')
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - x, e.y - y)
      if (d < 2.4 && lineOfSight(this.level, x, y, e.x, e.y)) this.damage(e, WEAPONS[1].damage * (1 - d / 2.4 * 0.7))
    }
    const pd = Math.hypot(this.p.x - x, this.p.y - y)
    if (pd < 1.6) this.hurt(Math.round(25 * (1 - pd / 1.6)))
  }

  private updateFx(dt: number) {
    for (const f of this.fx) f.t += dt
    this.fx = this.fx.filter((f) => f.t < (f.kind === 'boom' ? 0.5 : 0.15))
  }
}
