import * as C from './constants'
import { BRICK_COLORS, BRICK_HP, BRICK_POINTS, LEVELS, kindOf, type BrickKind } from './levels'
import { createRng, type Rng } from './rng'

export type PowerKind = 'multi' | 'wide' | 'laser' | 'slow' | 'life'
export type Phase = 'serve' | 'play' | 'levelClear' | 'lifeLost' | 'gameOver'

export interface Brick {
  id: number
  x: number
  y: number
  kind: BrickKind
  color: string
  hp: number
  maxHp: number
  alive: boolean
  /** Sim time of the last hit, for the white flash. */
  hitAt: number
}
export interface Ball {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  stuck: boolean
  stuckOffset: number
  trail: { x: number; y: number }[]
}
export interface Capsule { id: number; x: number; y: number; kind: PowerKind }
export interface Bolt { id: number; x: number; y: number }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
export interface Popup { id: number; x: number; y: number; text: string; color: string; born: number }

export type SimEvent =
  | { type: 'brick'; combo: number }
  | { type: 'hit' }
  | { type: 'steel' }
  | { type: 'paddle' }
  | { type: 'wall' }
  | { type: 'power'; kind: PowerKind }
  | { type: 'laser' }
  | { type: 'launch' }
  | { type: 'lose' }
  | { type: 'levelClear' }
  | { type: 'gameOver' }

export interface Input {
  /** Paddle centre the mouse asks for, in field pixels, or null for keyboard. */
  targetX: number | null
  axis: -1 | 0 | 1
  /** Edge-triggered. The sim clears these after it reads them. */
  launch: boolean
  fire: boolean
}

export const PALETTE_POWER: Record<PowerKind, { label: string; color: string; name: string }> = {
  multi: { label: 'M', color: C.COLORS.teal, name: 'Multi-ball' },
  wide: { label: 'W', color: C.COLORS.sky, name: 'Wide paddle' },
  laser: { label: 'L', color: C.COLORS.amber, name: 'Laser' },
  slow: { label: 'S', color: C.COLORS.mint, name: 'Slow' },
  life: { label: '+', color: C.COLORS.pink, name: 'Extra life' },
}

const POWER_WEIGHTS: [PowerKind, number][] = [
  ['multi', 28],
  ['wide', 25],
  ['laser', 23],
  ['slow', 17],
  ['life', 7],
]

export class Game {
  rng: Rng
  seed: number
  time = 0
  steps = 0
  phase: Phase = 'serve'
  phaseTimer = 0
  levelIndex = 0
  loop = 0
  score = 0
  lives = C.START_LIVES
  combo = 0
  bestCombo = 0
  bricksBroken = 0
  paddleX = C.FIELD_W / 2
  paddleW = C.PADDLE_W
  paddleVx = 0
  bricks: Brick[] = []
  balls: Ball[] = []
  capsules: Capsule[] = []
  bolts: Bolt[] = []
  particles: Particle[] = []
  popups: Popup[] = []
  wideTimer = 0
  laserTimer = 0
  slowTimer = 0
  laserCooldown = 0
  trauma = 0
  /** Bumped whenever a brick changes, so the view can memoize the wall. */
  brickVersion = 0
  speedBoost = 0
  events: SimEvent[] = []
  input: Input = { targetX: null, axis: 0, launch: false, fire: false }
  private nextId = 1

  constructor(seed = 1, levelIndex = 0) {
    this.seed = seed
    this.rng = createRng(seed)
    this.loadLevel(levelIndex)
  }

  get level() {
    return LEVELS[this.levelIndex % LEVELS.length]!
  }
  get levelNumber() {
    return this.loop * LEVELS.length + this.levelIndex + 1
  }
  get remaining() {
    let n = 0
    for (const b of this.bricks) if (b.alive && b.kind !== 'steel') n++
    return n
  }
  get baseSpeed() {
    return C.BALL_BASE_SPEED + C.BALL_LEVEL_SPEEDUP * (this.levelNumber - 1)
  }
  get ballSpeed() {
    const s = Math.min(this.baseSpeed + this.speedBoost, this.baseSpeed * C.BALL_MAX_FACTOR)
    return this.slowTimer > 0 ? s * C.SLOW_FACTOR : s
  }

  loadLevel(index: number) {
    this.levelIndex = index % LEVELS.length
    this.bricks = []
    this.brickVersion++
    const rows = this.level.rows
    rows.forEach((row, r) => {
      for (let c = 0; c < C.COLS; c++) {
        const ch = row[c] ?? '.'
        if (ch === '.') continue
        const kind = kindOf(ch)
        this.bricks.push({
          id: this.nextId++,
          x: C.BRICK_LEFT + c * (C.BRICK_W + C.BRICK_GAP),
          y: C.BRICK_TOP + r * (C.BRICK_H + C.BRICK_GAP),
          kind,
          color: BRICK_COLORS[ch] ?? C.COLORS.teal,
          hp: BRICK_HP[kind],
          maxHp: BRICK_HP[kind],
          alive: true,
          hitAt: -1,
        })
      }
    })
    this.capsules = []
    this.bolts = []
    this.wideTimer = this.laserTimer = this.slowTimer = 0
    this.speedBoost = 0
    this.serve()
  }

  serve() {
    this.phase = 'serve'
    this.combo = 0
    this.balls = [this.makeBall(this.paddleX, C.PADDLE_Y - C.BALL_R, 0, 0, true)]
  }

  private makeBall(x: number, y: number, vx: number, vy: number, stuck = false): Ball {
    return { id: this.nextId++, x, y, vx, vy, stuck, stuckOffset: 0.18, trail: [] }
  }

  launch() {
    for (const ball of this.balls) {
      if (!ball.stuck) continue
      const angle = ball.stuckOffset * C.MAX_BOUNCE_ANGLE
      ball.vx = Math.sin(angle) * this.ballSpeed
      ball.vy = -Math.cos(angle) * this.ballSpeed
      ball.stuck = false
    }
    if (this.phase === 'serve') this.phase = 'play'
    this.events.push({ type: 'launch' })
  }

  step() {
    const dt = C.DT
    this.steps++
    this.time += dt
    const input = this.input

    // Paddle: keyboard moves at a fixed speed, the mouse is followed with a speed cap.
    const half = this.paddleW / 2
    const prevX = this.paddleX
    if (input.axis !== 0) {
      this.paddleX += input.axis * C.PADDLE_KEY_SPEED * dt
      input.targetX = null
    } else if (input.targetX !== null) {
      const d = input.targetX - this.paddleX
      const maxMove = C.PADDLE_MAX_SPEED * dt
      this.paddleX += Math.max(-maxMove, Math.min(maxMove, d))
    }
    const targetW = this.wideTimer > 0 ? C.PADDLE_WIDE_W : C.PADDLE_W
    this.paddleW += (targetW - this.paddleW) * Math.min(1, dt * 12)
    this.paddleX = Math.max(this.paddleW / 2 + 4, Math.min(C.FIELD_W - this.paddleW / 2 - 4, this.paddleX))
    this.paddleVx = (this.paddleX - prevX) / dt
    void half

    if (this.phase === 'levelClear' || this.phase === 'lifeLost') {
      this.phaseTimer -= dt
      this.updateParticles(dt)
      if (this.phaseTimer <= 0) {
        if (this.phase === 'levelClear') {
          if (this.levelIndex + 1 >= LEVELS.length) this.loop++
          this.loadLevel(this.levelIndex + 1)
        } else if (this.lives <= 0) {
          this.phase = 'gameOver'
          this.events.push({ type: 'gameOver' })
        } else {
          this.serve()
        }
      }
      input.launch = input.fire = false
      return
    }
    if (this.phase === 'gameOver') {
      this.updateParticles(dt)
      return
    }

    if (input.launch && this.balls.some((b) => b.stuck)) this.launch()
    input.launch = false

    // Timers
    this.wideTimer = Math.max(0, this.wideTimer - dt)
    this.slowTimer = Math.max(0, this.slowTimer - dt)
    this.laserTimer = Math.max(0, this.laserTimer - dt)
    this.laserCooldown = Math.max(0, this.laserCooldown - dt)
    this.trauma = Math.max(0, this.trauma - dt * 1.7)

    if (input.fire && this.laserTimer > 0 && this.laserCooldown <= 0 && this.phase === 'play') {
      const y = C.PADDLE_Y - 6
      this.bolts.push({ id: this.nextId++, x: this.paddleX - this.paddleW / 2 + 10, y })
      this.bolts.push({ id: this.nextId++, x: this.paddleX + this.paddleW / 2 - 10, y })
      this.laserCooldown = C.LASER_COOLDOWN
      this.events.push({ type: 'laser' })
    }
    input.fire = false

    this.updateBalls(dt)
    this.updateBolts(dt)
    this.updateCapsules(dt)
    this.updateParticles(dt)
    for (let i = this.popups.length - 1; i >= 0; i--) {
      if (this.time - this.popups[i]!.born > 0.9) this.popups.splice(i, 1)
    }

    if (this.phase === 'play' && this.remaining === 0) {
      const bonus = 1000 * this.levelNumber + 250 * this.lives
      this.score += bonus
      this.popups.push({ id: this.nextId++, x: C.FIELD_W / 2, y: 360, text: `LEVEL CLEAR  +${bonus}`, color: C.COLORS.mint, born: this.time })
      this.phase = 'levelClear'
      this.phaseTimer = 2.4
      this.balls = []
      this.capsules = []
      this.bolts = []
      this.events.push({ type: 'levelClear' })
    }
  }

  private updateBalls(dt: number) {
    const speed = this.ballSpeed
    const paddleTop = C.PADDLE_Y
    const left = this.paddleX - this.paddleW / 2
    const right = this.paddleX + this.paddleW / 2
    const R = C.BALL_R
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i]!
      if (ball.stuck) {
        ball.x = this.paddleX + ball.stuckOffset * (this.paddleW / 2) * 0.6
        ball.y = paddleTop - R
        ball.trail.length = 0
        continue
      }
      // Keep speed at the current target (slow power-up, speed-ups).
      const len = Math.hypot(ball.vx, ball.vy) || 1
      ball.vx = (ball.vx / len) * speed
      ball.vy = (ball.vy / len) * speed

      ball.x += ball.vx * dt
      ball.y += ball.vy * dt

      if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); this.events.push({ type: 'wall' }) }
      if (ball.x > C.FIELD_W - R) { ball.x = C.FIELD_W - R; ball.vx = -Math.abs(ball.vx); this.events.push({ type: 'wall' }) }
      if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy); this.events.push({ type: 'wall' }) }

      // Paddle
      if (ball.vy > 0 && ball.y + R >= paddleTop && ball.y - R <= paddleTop + C.PADDLE_H && ball.x >= left - R && ball.x <= right + R) {
        const offset = Math.max(-1, Math.min(1, (ball.x - this.paddleX) / (this.paddleW / 2)))
        const angle = offset * C.MAX_BOUNCE_ANGLE
        ball.vx = Math.sin(angle) * speed
        ball.vy = -Math.cos(angle) * speed
        ball.y = paddleTop - R
        this.combo = 0
        this.events.push({ type: 'paddle' })
      }

      // Bricks: resolve at most one brick per step.
      for (const brick of this.bricks) {
        if (!brick.alive) continue
        const cx = Math.max(brick.x, Math.min(ball.x, brick.x + C.BRICK_W))
        const cy = Math.max(brick.y, Math.min(ball.y, brick.y + C.BRICK_H))
        const dx = ball.x - cx
        const dy = ball.y - cy
        const d2 = dx * dx + dy * dy
        if (d2 >= R * R) continue
        let nx: number
        let ny: number
        if (dx === 0 && dy === 0) {
          // Centre inside the brick: push out along the shallowest axis.
          const pl = ball.x - brick.x, pr = brick.x + C.BRICK_W - ball.x
          const pt = ball.y - brick.y, pb = brick.y + C.BRICK_H - ball.y
          const m = Math.min(pl, pr, pt, pb)
          nx = m === pl ? -1 : m === pr ? 1 : 0
          ny = m === pt ? -1 : m === pb ? 1 : 0
          if (nx !== 0) ny = 0
        } else {
          const d = Math.sqrt(d2)
          nx = dx / d
          ny = dy / d
        }
        const pen = R - Math.sqrt(d2)
        ball.x += nx * pen
        ball.y += ny * pen
        const dot = ball.vx * nx + ball.vy * ny
        if (dot < 0) {
          ball.vx -= 2 * dot * nx
          ball.vy -= 2 * dot * ny
        }
        this.damageBrick(brick, ball.x, ball.y)
        break
      }

      // Never let the ball settle into a near-horizontal path.
      const minVy = speed * 0.3
      if (Math.abs(ball.vy) < minVy) {
        ball.vy = (ball.vy < 0 ? -1 : 1) * minVy
        ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(speed * speed - minVy * minVy)
      }

      if (this.steps % 2 === 0) {
        ball.trail.unshift({ x: ball.x, y: ball.y })
        if (ball.trail.length > 6) ball.trail.length = 6
      }

      if (ball.y - R > C.FIELD_H) this.balls.splice(i, 1)
    }

    if (this.balls.length === 0 && this.phase === 'play') {
      this.lives--
      this.combo = 0
      this.capsules = []
      this.bolts = []
      this.wideTimer = this.laserTimer = this.slowTimer = 0
      this.trauma = Math.min(1, this.trauma + 0.6)
      this.phase = 'lifeLost'
      this.phaseTimer = this.lives > 0 ? 1.1 : 1.4
      this.events.push({ type: 'lose' })
    }
  }

  damageBrick(brick: Brick, hx: number, hy: number) {
    brick.hitAt = this.time
    this.brickVersion++
    if (brick.kind === 'steel') {
      this.trauma = Math.min(1, this.trauma + 0.08)
      this.spark(hx, hy, '#dbe6f3', 5)
      this.events.push({ type: 'steel' })
      return
    }
    brick.hp--
    this.speedBoost += C.BALL_HIT_SPEEDUP
    if (brick.hp > 0) {
      this.score += 10
      this.spark(hx, hy, brick.color, 7)
      this.events.push({ type: 'hit' })
      return
    }
    brick.alive = false
    this.bricksBroken++
    this.combo++
    this.bestCombo = Math.max(this.bestCombo, this.combo)
    const mult = Math.min(this.combo, 8)
    const pts = BRICK_POINTS[brick.kind] * mult
    this.score += pts
    const cx = brick.x + C.BRICK_W / 2
    const cy = brick.y + C.BRICK_H / 2
    this.burst(cx, cy, brick.color)
    this.trauma = Math.min(1, this.trauma + (this.combo >= 4 ? 0.3 : 0.18))
    if (mult >= 2) {
      this.popups.push({ id: this.nextId++, x: cx, y: cy, text: `+${pts}  x${mult}`, color: mult >= 5 ? C.COLORS.pink : C.COLORS.amber, born: this.time })
    }
    this.events.push({ type: 'brick', combo: this.combo })
    if (this.capsules.length < 3 && this.rng() < C.DROP_CHANCE) {
      this.capsules.push({ id: this.nextId++, x: cx, y: cy, kind: this.pickPower() })
    }
  }

  private pickPower(): PowerKind {
    const total = POWER_WEIGHTS.reduce((s, [, w]) => s + w, 0)
    let r = this.rng() * total
    for (const [kind, w] of POWER_WEIGHTS) {
      if ((r -= w) < 0) return kind
    }
    return 'multi'
  }

  applyPower(kind: PowerKind) {
    this.events.push({ type: 'power', kind })
    this.score += 100
    switch (kind) {
      case 'wide':
        this.wideTimer = C.WIDE_TIME
        break
      case 'laser':
        this.laserTimer = C.LASER_TIME
        break
      case 'slow':
        this.slowTimer = C.SLOW_TIME
        break
      case 'life':
        this.lives = Math.min(C.MAX_LIVES, this.lives + 1)
        break
      case 'multi': {
        if (this.balls.some((b) => b.stuck)) this.launch()
        const sources = this.balls.slice(0, 3)
        for (const b of sources) {
          for (const turn of [-0.42, 0.42]) {
            if (this.balls.length >= C.MAX_BALLS) break
            const cos = Math.cos(turn), sin = Math.sin(turn)
            let vx = b.vx * cos - b.vy * sin
            let vy = b.vx * sin + b.vy * cos
            if (vy > 0) vy = -vy
            if (vx === 0) vx = 1
            this.balls.push(this.makeBall(b.x, b.y, vx, vy))
          }
        }
        break
      }
    }
  }

  private updateBolts(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]!
      bolt.y -= C.LASER_SPEED * dt
      let hit = bolt.y < 0
      if (!hit) {
        for (const brick of this.bricks) {
          if (!brick.alive) continue
          if (bolt.x >= brick.x && bolt.x <= brick.x + C.BRICK_W && bolt.y <= brick.y + C.BRICK_H && bolt.y >= brick.y - 14) {
            this.damageBrick(brick, bolt.x, brick.y + C.BRICK_H)
            hit = true
            break
          }
        }
      }
      if (hit) this.bolts.splice(i, 1)
    }
  }

  private updateCapsules(dt: number) {
    const left = this.paddleX - this.paddleW / 2
    const right = this.paddleX + this.paddleW / 2
    for (let i = this.capsules.length - 1; i >= 0; i--) {
      const cap = this.capsules[i]!
      cap.y += C.CAPSULE_SPEED * dt
      const caught =
        cap.y + C.CAPSULE_H / 2 >= C.PADDLE_Y &&
        cap.y - C.CAPSULE_H / 2 <= C.PADDLE_Y + C.PADDLE_H &&
        cap.x + C.CAPSULE_W / 2 >= left &&
        cap.x - C.CAPSULE_W / 2 <= right
      if (caught) {
        this.capsules.splice(i, 1)
        this.applyPower(cap.kind)
        this.popups.push({ id: this.nextId++, x: cap.x, y: C.PADDLE_Y - 24, text: PALETTE_POWER[cap.kind].name.toUpperCase(), color: PALETTE_POWER[cap.kind].color, born: this.time })
      } else if (cap.y > C.FIELD_H + 20) {
        this.capsules.splice(i, 1)
      }
    }
  }

  private updateParticles(dt: number) {
    const ps = this.particles
    let w = 0
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!
      p.life -= dt
      if (p.life <= 0) continue
      p.vy += 620 * dt
      p.vx *= 1 - 1.4 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      ps[w++] = p
    }
    ps.length = w
  }

  private addParticle(p: Particle) {
    if (this.particles.length >= C.MAX_PARTICLES) this.particles.shift()
    this.particles.push(p)
  }

  private burst(x: number, y: number, color: string) {
    for (let i = 0; i < 16; i++) {
      const a = this.rng() * Math.PI * 2
      const s = 90 + this.rng() * 320
      const life = 0.45 + this.rng() * 0.5
      this.addParticle({
        x: x + (this.rng() - 0.5) * C.BRICK_W * 0.8,
        y: y + (this.rng() - 0.5) * C.BRICK_H * 0.6,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 120,
        life,
        max: life,
        color: i % 5 === 0 ? C.COLORS.white : color,
        size: 3 + Math.floor(this.rng() * 4),
      })
    }
  }

  private spark(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2
      const s = 120 + this.rng() * 220
      const life = 0.25 + this.rng() * 0.25
      this.addParticle({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: 2 + Math.floor(this.rng() * 2) })
    }
  }

  /** Screen shake offset, deterministic from sim time. */
  shake(): { x: number; y: number } {
    const amp = this.trauma * this.trauma * 11
    if (amp < 0.05) return { x: 0, y: 0 }
    const t = this.time * 60
    return { x: amp * Math.sin(t * 1.7) * Math.cos(t * 0.9), y: amp * Math.cos(t * 2.3) * Math.sin(t * 1.1) }
  }
}
