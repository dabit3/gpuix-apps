import { Audio } from './audio'
import { addScore, cleanInitials, loadScores, qualifies, type ScoreEntry } from './scores'
import { autopilot } from './sim/autopilot'
import { DT, FIELD_W } from './sim/constants'
import { Game, type SimEvent } from './sim/sim'

export type Mode = 'title' | 'playing' | 'paused' | 'gameover'

export interface KeyLike { key?: string; isHeld?: boolean; modifiers?: { cmd?: boolean; control?: boolean } | null }

const MAX_STEPS_PER_FRAME = 12

/**
 * Owns the game, the fixed-step clock, input, sound and high scores.
 * The React tree only reads from it, so the sim runs the same in tests.
 */
export class Controller {
  mode: Mode = 'title'
  game: Game
  scores: ScoreEntry[]
  audio: Audio
  showPerf = false
  /** Attract-mode autopilot during play (A key / NEON_AUTOPILOT=1). */
  autopilot = false
  savedRank: number | null = null
  savedInitials = ''
  draft = ''
  canEnterScore = false
  seed: number
  frame = 0
  private acc = 0
  private held = { left: false, right: false }
  private lastSeed: number

  constructor(opts: { seed?: number; muted?: boolean; autopilot?: boolean; scores?: ScoreEntry[] } = {}) {
    this.seed = opts.seed ?? ((Date.now() & 0xffff) || 1)
    this.lastSeed = this.seed
    this.audio = new Audio(opts.muted ?? false)
    this.autopilot = opts.autopilot ?? false
    this.scores = opts.scores ?? loadScores()
    this.game = this.attractGame()
  }

  get highScore() {
    return Math.max(this.scores[0]?.score ?? 0, this.mode === 'title' ? 0 : this.game.score)
  }

  private attractGame() {
    const g = new Game(this.seed ^ 0x5eed, 1)
    g.lives = 99
    return g
  }

  /** Advance the sim by `seconds` of real time in fixed 1/120 s steps. */
  advance(seconds: number) {
    if (this.mode === 'paused') return 0
    this.acc = Math.min(this.acc + seconds, MAX_STEPS_PER_FRAME * DT)
    let steps = 0
    while (this.acc >= DT) {
      this.acc -= DT
      this.stepOnce()
      steps++
    }
    return steps
  }

  /** Exact number of fixed steps, for tests. */
  runSteps(n: number) {
    for (let i = 0; i < n && this.mode !== 'paused'; i++) this.stepOnce()
  }

  get alpha() {
    return this.acc / DT
  }

  private stepOnce() {
    const g = this.game
    if (this.mode === 'title' || this.autopilot) {
      autopilot(g)
    } else {
      g.input.axis = this.held.left === this.held.right ? 0 : this.held.left ? -1 : 1
    }
    g.step()
    const events = g.events
    if (events.length) {
      if (this.mode === 'playing') this.sound(events)
      g.events = []
    }
    if (this.mode === 'title' && g.phase === 'gameOver') this.game = this.attractGame()
    if (this.mode === 'playing' && g.phase === 'gameOver') this.toGameOver()
  }

  private sound(events: SimEvent[]) {
    const a = this.audio
    for (const e of events) {
      if (e.type === 'brick') a.brick(e.combo)
      else if (e.type === 'gameOver') a.play('gameOver')
      else a.play(e.type)
    }
  }

  start() {
    this.lastSeed = (this.lastSeed * 1103515245 + 12345) & 0x7fffffff || 1
    this.game = new Game(this.lastSeed, 0)
    this.mode = 'playing'
    this.savedRank = null
    this.canEnterScore = false
    this.acc = 0
    this.audio.play('select')
  }

  pause() {
    if (this.mode === 'playing') {
      this.mode = 'paused'
      this.held.left = this.held.right = false
      this.audio.play('select')
    }
  }
  resume() {
    if (this.mode === 'paused') {
      this.mode = 'playing'
      this.acc = 0
      this.audio.play('select')
    }
  }
  togglePause() {
    if (this.mode === 'paused') this.resume()
    else this.pause()
  }
  toTitle() {
    this.mode = 'title'
    this.game = this.attractGame()
    this.audio.play('select')
  }
  toggleSound() {
    this.audio.muted = !this.audio.muted
    if (!this.audio.muted) this.audio.play('select')
  }

  private toGameOver() {
    this.mode = 'gameover'
    this.canEnterScore = qualifies(this.scores, this.game.score)
    this.draft = ''
    this.savedRank = null
  }

  submitInitials(raw: string) {
    if (!this.canEnterScore) return false
    const initials = cleanInitials(raw) || 'YOU'
    const entry: ScoreEntry = { initials, score: this.game.score, level: this.game.levelNumber, date: new Date().toISOString().slice(0, 10) }
    this.scores = addScore(this.scores, entry)
    this.savedRank = this.scores.indexOf(entry) + 1
    this.savedInitials = initials
    this.canEnterScore = false
    this.audio.play('power')
    return true
  }

  // ---- input -------------------------------------------------------------

  /** Mouse x in field coordinates. */
  pointer(x: number) {
    if (this.mode !== 'playing') return
    this.game.input.targetX = Math.max(0, Math.min(FIELD_W, x))
  }

  primary() {
    if (this.mode === 'title') return this.start()
    if (this.mode !== 'playing') return
    const g = this.game
    if (g.balls.some((b) => b.stuck)) g.input.launch = true
    else g.input.fire = true
  }

  keyDown(e: KeyLike): boolean {
    const k = (e.key ?? '').toLowerCase()
    if (e.modifiers?.cmd || e.modifiers?.control) return false
    if (k === 'f' && !e.isHeld) { this.showPerf = !this.showPerf; return true }
    if (this.mode === 'gameover') {
      if (this.canEnterScore) return false
      if (k === 'enter' || k === 'space') { this.start(); return true }
      if (k === 'escape') { this.toTitle(); return true }
      return false
    }
    if (k === 'm' && !e.isHeld) { this.toggleSound(); return true }
    if (this.mode === 'title') {
      if (k === 'enter' || k === 'space') { this.start(); return true }
      return false
    }
    if (k === 'escape' || k === 'p') { if (!e.isHeld) this.togglePause(); return true }
    if (this.mode === 'paused') {
      if (k === 'r') { this.start(); return true }
      if (k === 'q') { this.toTitle(); return true }
      return false
    }
    if (k === 'left' || k === 'a') { this.held.left = true; return true }
    if (k === 'right' || k === 'd') { this.held.right = true; return true }
    if (k === 'space' || k === 'up' || k === 'w') { if (!e.isHeld) this.primary(); else this.game.input.fire = true; return true }
    if (k === 't' && !e.isHeld) { this.autopilot = !this.autopilot; return true }
    return false
  }

  keyUp(e: KeyLike) {
    const k = (e.key ?? '').toLowerCase()
    if (k === 'left' || k === 'a') this.held.left = false
    if (k === 'right' || k === 'd') this.held.right = false
  }
}
