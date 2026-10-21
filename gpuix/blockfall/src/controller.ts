import { Pilot, plan, type Plan } from './sim/ai'
import { DT, Game, type Tuning } from './sim/game'
import { addScore, cleanInitials, loadScores, qualifies, scoresPath, type ScoreEntry } from './scores'

export type Mode = 'title' | 'playing' | 'paused' | 'gameover'
export interface KeyLike { key?: string; isHeld?: boolean; modifiers?: { ctrl?: boolean; cmd?: boolean; shift?: boolean; alt?: boolean } }
export interface ControllerOptions { seed?: number; level?: number; scoresFile?: string; tuning?: Partial<Tuning> }

const LEFT = new Set(['left', 'a', 'h'])
const RIGHT = new Set(['right', 'd', 'l'])
const SOFT = new Set(['down', 's', 'j'])

export class Controller {
  mode: Mode = 'title'
  game: Game
  readonly pilot = new Pilot(9)
  startLevel: number
  seed: number
  scores: ScoreEntry[]
  readonly scoresFile: string
  readonly tuning: Partial<Tuning>
  showPerf = false
  draft = ''
  canEnterScore = false
  savedRank = -1
  savedInitials = ''
  frame = 0
  overDelay = 0
  private acc = 0
  private hintKey = ''
  private hintPlan: Plan | null = null

  constructor(opts: ControllerOptions = {}) {
    this.seed = opts.seed ?? (Date.now() & 0xffff)
    this.startLevel = opts.level ?? 1
    this.tuning = opts.tuning ?? {}
    this.scoresFile = opts.scoresFile ?? scoresPath()
    this.scores = loadScores(this.scoresFile)
    this.game = this.attract()
  }

  get best() { return Math.max(this.scores[0]?.score ?? 0, this.mode === 'title' ? 0 : this.game.score) }

  private attract() { return new Game(this.seed + 1000, 1) }

  start() {
    this.seed++
    this.game = new Game(this.seed, this.startLevel, this.tuning)
    this.mode = 'playing'
    this.overDelay = 0
    this.savedRank = -1
    this.savedInitials = ''
    this.canEnterScore = false
  }

  toTitle() { this.mode = 'title'; this.game = this.attract() }
  pause() { if (this.mode === 'playing') { this.mode = 'paused'; this.releaseAll() } }
  resume() { if (this.mode === 'paused') this.mode = 'playing' }
  restart() { this.start() }

  private releaseAll() { const i = this.game.input; i.left = i.right = i.soft = false }

  private beginGameOver() {
    this.mode = 'gameover'
    this.canEnterScore = qualifies(this.scores, this.game.score)
    this.draft = ''
  }

  submitInitials(raw: string) {
    if (!this.canEnterScore) return
    const name = cleanInitials(raw) || 'YOU'
    const g = this.game
    const res = addScore(this.scores, { name, score: g.score, lines: g.lines, level: g.level, date: new Date().toISOString() }, this.scoresFile)
    this.scores = res.scores
    this.savedRank = res.rank
    this.savedInitials = name
    this.canEnterScore = false
  }

  /** Runs whole 120 Hz steps for the elapsed time; returns how many ran. */
  advance(dt: number) {
    if (this.mode === 'paused' || this.mode === 'gameover') { this.acc = 0; return 0 }
    this.acc += dt
    let n = 0
    while (this.acc >= DT) { this.acc -= DT; this.stepOnce(); n++ }
    return n
  }

  runSteps(n: number) { for (let i = 0; i < n; i++) this.stepOnce() }

  private stepOnce() {
    if (this.mode === 'title') {
      this.pilot.step(this.game)
      this.game.step()
      if (this.game.phase === 'over' || this.game.stackHeight > 15) this.game = new Game(this.game.steps + this.seed, 1)
      return
    }
    if (this.mode !== 'playing') return
    this.game.step()
    if (this.game.phase === 'over') {
      this.overDelay += DT
      if (this.overDelay > 1.1) this.beginGameOver()
    }
  }

  /** Where a strong player would put the current piece (used by the demo recorder's key driver). */
  hint(): Plan | null {
    const g = this.game, a = g.active
    if (this.mode !== 'playing' || !a || g.phase !== 'play') return null
    const k = `${g.pieces}:${a.type}:${g.holdUsed}`
    if (k !== this.hintKey) { this.hintKey = k; this.hintPlan = plan(g) }
    return this.hintPlan
  }

  keyDown(e: KeyLike): boolean {
    const k = (e.key ?? '').toLowerCase()
    if (k === 'f' && this.mode !== 'gameover') { this.showPerf = !this.showPerf; return true }
    if (this.mode === 'title') {
      if (k === 'enter' || k === 'space') { this.start(); return true }
      if (k === 'left' || k === 'down') { this.startLevel = Math.max(1, this.startLevel - 1); return true }
      if (k === 'right' || k === 'up') { this.startLevel = Math.min(15, this.startLevel + 1); return true }
      return false
    }
    if (this.mode === 'paused') {
      if (k === 'p' || k === 'escape' || k === 'enter' || k === 'space') { this.resume(); return true }
      if (k === 'r') { this.restart(); return true }
      if (k === 'q') { this.toTitle(); return true }
      return false
    }
    if (this.mode === 'gameover') {
      if (this.canEnterScore) return false
      if (k === 'enter' || k === 'space' || k === 'r') { this.start(); return true }
      if (k === 'escape' || k === 'q') { this.toTitle(); return true }
      return false
    }
    const inp = this.game.input
    if (e.isHeld) return LEFT.has(k) || RIGHT.has(k) || SOFT.has(k)
    if (LEFT.has(k)) { inp.left = true; return true }
    if (RIGHT.has(k)) { inp.right = true; return true }
    if (SOFT.has(k)) { inp.soft = true; return true }
    if (k === 'up' || k === 'x' || k === 'w' || k === 'k') { inp.rotateCW = true; return true }
    if (k === 'z' || k === 'y') { inp.rotateCCW = true; return true }
    if (k === 'space') { inp.hardDrop = true; return true }
    if (k === 'c' || k === 'shift') { inp.hold = true; return true }
    if (k === 'p' || k === 'escape') { this.pause(); return true }
    return false
  }

  keyUp(e: KeyLike) {
    const k = (e.key ?? '').toLowerCase()
    const inp = this.game.input
    if (LEFT.has(k)) inp.left = false
    if (RIGHT.has(k)) inp.right = false
    if (SOFT.has(k)) inp.soft = false
  }
}
