import { kicks, PIECES, SHAPES, type Cell, type PieceType } from './pieces'
import { rng } from './rng'

export const COLS = 10
export const ROWS = 22 // two hidden rows above the 20 visible ones
export const HIDDEN = 2
export const STEP_HZ = 120
export const DT = 1 / STEP_HZ
export const LOCK_DELAY = 0.5
export const LOCK_RESETS = 15
export const CLEAR_TIME = 0.32
export const LINES_PER_LEVEL = 10

export interface Active { type: PieceType; rot: number; x: number; y: number }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; type: PieceType; size: number }
export interface Popup { text: string; sub?: string; points: number; age: number; kind: 'clear' | 'level' | 'tspin' }
export interface Tuning { das: number; arr: number; softDropRate: number }
export type Phase = 'play' | 'clearing' | 'over'

export interface Input {
  left: boolean
  right: boolean
  soft: boolean
  /** Edge-triggered actions, consumed by the next step. */
  rotateCW: boolean
  rotateCCW: boolean
  hardDrop: boolean
  hold: boolean
}

export const DEFAULT_TUNING: Tuning = { das: 0.133, arr: 0.033, softDropRate: 40 }

/** Guideline gravity: seconds per row at a level. */
export function gravityInterval(level: number) {
  return Math.pow(0.8 - (level - 1) * 0.007, level - 1)
}

const LINE_POINTS = [0, 100, 300, 500, 800]
const TSPIN_POINTS = [400, 800, 1200, 1600]
const MINI_POINTS = [100, 200, 400]
const LINE_NAMES = ['', 'Single', 'Double', 'Triple', 'Quad']

export class Game {
  board: (PieceType | null)[][] = Array.from({ length: ROWS }, () => Array<PieceType | null>(COLS).fill(null))
  active: Active | null = null
  hold: PieceType | null = null
  holdUsed = false
  queue: PieceType[] = []
  input: Input = { left: false, right: false, soft: false, rotateCW: false, rotateCCW: false, hardDrop: false, hold: false }
  tuning: Tuning
  phase: Phase = 'play'
  score = 0
  lines = 0
  level: number
  startLevel: number
  combo = -1
  b2b = false
  maxCombo = 0
  pieces = 0
  quads = 0
  tspins = 0
  steps = 0
  time = 0
  particles: Particle[] = []
  popups: Popup[] = []
  trauma = 0
  clearingRows: number[] = []
  clearTimer = 0
  /** Lock flash: cells of the piece that just locked, for a brief glow. */
  lockFlash: { cells: Cell[]; age: number } | null = null
  readonly random: () => number

  private gravityAcc = 0
  private softAcc = 0
  private lockTimer = 0
  private lockResets = 0
  private lowestY = 0
  private lastWasRotate = false
  private lastKickIndex = 0
  private dasDir = 0
  private dasTimer = 0
  private arrTimer = 0
  private prevLeft = false
  private prevRight = false

  constructor(seed = 1, startLevel = 1, tuning: Partial<Tuning> = {}) {
    this.random = rng(seed)
    this.startLevel = this.level = Math.max(1, Math.min(20, Math.floor(startLevel)))
    this.tuning = { ...DEFAULT_TUNING, ...tuning }
    this.refill()
    this.spawn()
  }

  // ---------- queries ----------
  cells(p: Active = this.active!): Cell[] {
    return SHAPES[p.type][p.rot]!.map(([cx, cy]) => [p.x + cx, p.y + cy] as const)
  }

  fits(p: Active): boolean {
    for (const [x, y] of this.cells(p)) {
      if (x < 0 || x >= COLS || y >= ROWS) return false
      if (y >= 0 && this.board[y]![x]) return false
    }
    return true
  }

  dropDistance(p: Active = this.active!): number {
    let d = 0
    while (this.fits({ ...p, y: p.y + d + 1 })) d++
    return d
  }

  ghost(): Active | null {
    return this.active ? { ...this.active, y: this.active.y + this.dropDistance() } : null
  }

  get gravity() { return gravityInterval(this.level) }
  get stackHeight() {
    for (let y = 0; y < ROWS; y++) if (this.board[y]!.some(Boolean)) return ROWS - y
    return 0
  }

  // ---------- piece flow ----------
  private refill() {
    while (this.queue.length < 7) {
      const bag = PIECES.slice()
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1))
        ;[bag[i], bag[j]] = [bag[j]!, bag[i]!]
      }
      this.queue.push(...bag)
    }
  }

  private spawn(type?: PieceType) {
    const t = type ?? this.queue.shift()!
    this.refill()
    const p: Active = { type: t, rot: 0, x: t === 'O' ? 4 : 3, y: 0 }
    if (!this.fits(p)) { this.active = p; this.gameOver(); return }
    // Guideline: a new piece drops one row immediately when it can.
    if (this.fits({ ...p, y: 1 })) p.y = 1
    this.active = p
    this.gravityAcc = 0
    this.lockTimer = 0
    this.lockResets = 0
    this.lowestY = p.y
    this.lastWasRotate = false
  }

  private gameOver() {
    this.phase = 'over'
    this.trauma = 1
  }

  /** A successful move or rotation while grounded restarts the lock timer, a bounded number of times. */
  private touched() {
    const p = this.active!
    if (p.y > this.lowestY) { this.lowestY = p.y; this.lockResets = 0 }
    if (this.dropDistance() === 0 && this.lockResets < LOCK_RESETS) { this.lockTimer = 0; this.lockResets++ }
  }

  move(dx: number): boolean {
    const p = this.active
    if (!p || this.phase !== 'play') return false
    const next = { ...p, x: p.x + dx }
    if (!this.fits(next)) return false
    this.active = next
    this.lastWasRotate = false
    this.touched()
    return true
  }

  rotate(dir: 1 | -1): boolean {
    const p = this.active
    if (!p || this.phase !== 'play') return false
    const to = (p.rot + dir + 4) % 4
    const tests = kicks(p.type, p.rot, to)
    for (let i = 0; i < tests.length; i++) {
      const [kx, ky] = tests[i]!
      const next = { ...p, rot: to, x: p.x + kx, y: p.y + ky }
      if (this.fits(next)) {
        this.active = next
        this.lastWasRotate = true
        this.lastKickIndex = i
        this.touched()
        return true
      }
    }
    return false
  }

  softDropStep(): boolean {
    const p = this.active
    if (!p || !this.fits({ ...p, y: p.y + 1 })) return false
    this.active = { ...p, y: p.y + 1 }
    this.score += 1
    this.lastWasRotate = false
    this.touched()
    return true
  }

  hardDrop() {
    const p = this.active
    if (!p || this.phase !== 'play') return
    const d = this.dropDistance()
    if (d > 0) this.lastWasRotate = false
    this.active = { ...p, y: p.y + d }
    this.score += d * 2
    this.trauma = Math.min(1, this.trauma + 0.18)
    this.lock()
  }

  holdPiece(): boolean {
    if (!this.active || this.holdUsed || this.phase !== 'play') return false
    const cur = this.active.type
    const swap = this.hold
    this.hold = cur
    this.holdUsed = true
    this.spawn(swap ?? undefined)
    return true
  }

  // ---------- locking and clearing ----------
  private tSpinKind(): 'none' | 'mini' | 'full' {
    const p = this.active!
    if (p.type !== 'T' || !this.lastWasRotate) return 'none'
    const filled = (x: number, y: number) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && !!this.board[y]![x])
    const corners = [[0, 0], [2, 0], [2, 2], [0, 2]].map(([cx, cy]) => filled(p.x + cx!, p.y + cy!))
    if (corners.filter(Boolean).length < 3) return 'none'
    // Front corners are the two on the side the T points to.
    const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot]!
    const frontFilled = front.filter((i) => corners[i]).length
    return frontFilled === 2 || this.lastKickIndex === 4 ? 'full' : 'mini'
  }

  private lock() {
    const p = this.active!
    const cells = this.cells(p)
    const spin = this.tSpinKind()
    for (const [x, y] of cells) if (y >= 0) this.board[y]![x] = p.type
    this.pieces++
    this.lockFlash = { cells, age: 0 }
    this.active = null
    if (cells.every(([, y]) => y < HIDDEN)) { this.gameOver(); return }

    const full: number[] = []
    for (let y = 0; y < ROWS; y++) if (this.board[y]!.every(Boolean)) full.push(y)
    this.award(full.length, spin)
    if (full.length) {
      this.clearingRows = full
      this.clearTimer = 0
      this.phase = 'clearing'
      this.burst(full)
    } else {
      this.spawnNext()
    }
  }

  private spawnNext() {
    this.holdUsed = false
    this.spawn()
  }

  private award(n: number, spin: 'none' | 'mini' | 'full') {
    const lvl = this.level
    let base = 0
    let name = ''
    if (spin === 'full') { base = TSPIN_POINTS[n]!; name = n ? `T-Spin ${LINE_NAMES[n]}` : 'T-Spin' }
    else if (spin === 'mini') { base = MINI_POINTS[Math.min(n, 2)]!; name = n ? `Mini T-Spin ${LINE_NAMES[n]}` : 'Mini T-Spin' }
    else { base = LINE_POINTS[n]!; name = LINE_NAMES[n]! }
    if (spin !== 'none') this.tspins++

    if (n === 0) {
      this.combo = -1
      if (base) { this.score += base * lvl; this.popups.push({ text: name, points: base * lvl, age: 0, kind: 'tspin' }) }
      return
    }
    const difficult = n === 4 || spin !== 'none'
    const b2bBonus = difficult && this.b2b
    let points = base * lvl
    if (b2bBonus) points = Math.floor(points * 1.5)
    this.combo++
    this.maxCombo = Math.max(this.maxCombo, this.combo)
    const comboPts = this.combo > 0 ? 50 * this.combo * lvl : 0
    points += comboPts
    this.b2b = difficult ? true : false
    if (n === 4) this.quads++
    this.score += points
    const sub = [b2bBonus ? 'Back-to-back' : '', this.combo > 0 ? `${this.combo} combo` : ''].filter(Boolean).join(' · ')
    this.popups.push({ text: name, sub: sub || undefined, points, age: 0, kind: spin !== 'none' ? 'tspin' : 'clear' })
    this.trauma = Math.min(1, this.trauma + 0.2 + n * 0.14)

    const before = this.level
    this.lines += n
    this.level = Math.max(this.startLevel, Math.floor(this.lines / LINES_PER_LEVEL) + 1)
    if (this.level > before) this.popups.push({ text: `Level ${this.level}`, points: 0, age: 0, kind: 'level' })
  }

  private burst(rows: number[]) {
    for (const y of rows) {
      for (let x = 0; x < COLS; x++) {
        const type = this.board[y]![x]!
        for (let k = 0; k < 3; k++) {
          const a = this.random() * Math.PI * 2
          const s = 3 + this.random() * 9
          this.particles.push({
            x: x + 0.5, y: y - HIDDEN + 0.5,
            vx: Math.cos(a) * s + (x - 4.5) * 0.8, vy: Math.sin(a) * s - 6,
            life: 0, max: 0.55 + this.random() * 0.5, type, size: 0.18 + this.random() * 0.22,
          })
        }
      }
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400)
  }

  private collapse() {
    const keep = this.board.filter((_, y) => !this.clearingRows.includes(y))
    const fresh = Array.from({ length: this.clearingRows.length }, () => Array<PieceType | null>(COLS).fill(null))
    this.board = [...fresh, ...keep]
    this.clearingRows = []
    this.phase = 'play'
    this.spawnNext()
  }

  // ---------- fixed step ----------
  private handleInput() {
    const inp = this.input
    if (inp.hold) { inp.hold = false; this.holdPiece() }
    if (inp.rotateCW) { inp.rotateCW = false; this.rotate(1) }
    if (inp.rotateCCW) { inp.rotateCCW = false; this.rotate(-1) }

    // DAS/ARR: the first press moves once, holding past DAS repeats every ARR. The newest direction wins.
    if (inp.left && !this.prevLeft) this.startShift(-1)
    if (inp.right && !this.prevRight) this.startShift(1)
    if (!inp.left && this.dasDir === -1) this.dasDir = inp.right ? this.restart(1) : 0
    if (!inp.right && this.dasDir === 1) this.dasDir = inp.left ? this.restart(-1) : 0
    this.prevLeft = inp.left
    this.prevRight = inp.right
    if (this.dasDir) {
      this.dasTimer += DT
      if (this.dasTimer >= this.tuning.das) {
        if (this.tuning.arr <= 0) { while (this.move(this.dasDir)); }
        else {
          this.arrTimer += DT
          while (this.arrTimer >= this.tuning.arr) { this.arrTimer -= this.tuning.arr; this.move(this.dasDir) }
        }
      }
    }

    if (inp.hardDrop) { inp.hardDrop = false; this.hardDrop(); return }
  }

  private startShift(dir: number) {
    this.dasDir = dir
    this.dasTimer = 0
    this.arrTimer = 0
    this.move(dir)
  }

  private restart(dir: number) {
    this.dasTimer = 0
    this.arrTimer = 0
    return dir
  }

  step() {
    this.steps++
    this.time += DT
    this.trauma = Math.max(0, this.trauma - DT * 1.6)
    for (const pt of this.particles) { pt.life += DT; pt.vy += 26 * DT; pt.x += pt.vx * DT; pt.y += pt.vy * DT }
    this.particles = this.particles.filter((pt) => pt.life < pt.max)
    for (const pop of this.popups) pop.age += DT
    this.popups = this.popups.filter((pop) => pop.age < 1.4)
    if (this.lockFlash) { this.lockFlash.age += DT; if (this.lockFlash.age > 0.25) this.lockFlash = null }

    if (this.phase === 'over') return
    if (this.phase === 'clearing') {
      this.clearTimer += DT
      if (this.clearTimer >= CLEAR_TIME) this.collapse()
      return
    }

    this.handleInput()
    if (this.phase !== 'play' || !this.active) return

    if (this.input.soft) {
      const softInterval = Math.min(this.gravity, 1 / this.tuning.softDropRate)
      this.softAcc += DT
      while (this.softAcc >= softInterval) { this.softAcc -= softInterval; if (!this.softDropStep()) break }
      this.gravityAcc = 0
    } else {
      this.softAcc = 0
      this.gravityAcc += DT
      while (this.gravityAcc >= this.gravity) {
        this.gravityAcc -= this.gravity
        const p: Active = this.active!
        if (!this.fits({ ...p, y: p.y + 1 })) { this.gravityAcc = 0; break }
        this.active = { ...p, y: p.y + 1 }
        this.lastWasRotate = false
        if (this.active.y > this.lowestY) { this.lowestY = this.active.y; this.lockResets = 0 }
      }
    }

    if (this.dropDistance() === 0) {
      this.lockTimer += DT
      if (this.lockTimer >= LOCK_DELAY || this.lockResets >= LOCK_RESETS) this.lock()
    } else {
      this.lockTimer = 0
    }
  }

  run(steps: number) { for (let i = 0; i < steps; i++) this.step() }
}
