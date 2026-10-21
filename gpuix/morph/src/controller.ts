import { FPS, FRAMES_PER_BEAT, LAST_FRAME, TOTAL_BEATS, TOTAL_FRAMES } from './lib/beats'
import type { PaletteName } from './lib/palette'

export type Aspect = 'square' | 'vertical'
export interface KeyLike { key?: string; keyChar?: string | null; isHeld?: boolean; modifiers?: { ctrl?: boolean; cmd?: boolean; shift?: boolean; alt?: boolean } }

export interface ExportState { status: 'idle' | 'running' | 'done' | 'error'; done: number; total: number; out: string; message: string }

/** Playback state for the live player: the scene itself is a pure function of `frame`. */
export class Controller {
  frame = 0
  playing = true
  loop = true
  palette: PaletteName
  aspect: Aspect = 'square'
  scrubbing = false
  hoverFrame: number | null = null
  exp: ExportState = { status: 'idle', done: 0, total: TOTAL_FRAMES, out: '', message: '' }
  onExport?: () => void
  onChange?: () => void

  constructor(opts: { palette?: PaletteName; frame?: number; paused?: boolean; aspect?: Aspect } = {}) {
    this.palette = opts.palette ?? 'dark'
    this.aspect = opts.aspect ?? 'square'
    this.frame = clampFrame(opts.frame ?? 0)
    this.playing = !opts.paused
  }

  /** Integer frame shown on screen. */
  get shown(): number { return Math.min(LAST_FRAME, Math.max(0, Math.floor(this.frame + 1e-6))) }
  get beat(): number { return Math.floor(this.shown / FRAMES_PER_BEAT) }

  /** Advance by wall-clock milliseconds (real time: 60 frames per second). */
  advance(ms: number) {
    if (!this.playing || this.scrubbing) return
    this.frame += (ms * FPS) / 1000
    if (this.frame >= TOTAL_FRAMES) {
      if (this.loop) this.frame %= TOTAL_FRAMES
      else { this.frame = LAST_FRAME; this.playing = false }
    }
  }

  toggle() { this.playing = !this.playing; if (this.playing && !this.loop && this.shown >= LAST_FRAME) this.frame = 0 }
  seek(f: number) { this.frame = clampFrame(Math.round(f)) }
  step(n: number) { this.playing = false; this.seek(wrap(this.shown + n)) }
  jumpBeat(dir: 1 | -1) {
    this.playing = false
    const b = this.beat
    const onBeat = this.shown % FRAMES_PER_BEAT === 0
    const next = dir > 0 ? b + 1 : onBeat ? b - 1 : b
    this.seek(((next % TOTAL_BEATS) + TOTAL_BEATS) % TOTAL_BEATS * FRAMES_PER_BEAT)
  }
  togglePalette() { this.palette = this.palette === 'dark' ? 'light' : 'dark' }
  toggleAspect() { this.aspect = this.aspect === 'square' ? 'vertical' : 'square' }

  /** Returns true when the key was handled. */
  keyDown(e: KeyLike): boolean {
    const k = keyName(e)
    const shift = !!e.modifiers?.shift
    switch (k) {
      case 'space': case 'k': this.toggle(); break
      case 'left': this.step(shift ? -10 : -1); break
      case 'right': this.step(shift ? 10 : 1); break
      case 'up': case ']': this.jumpBeat(1); break
      case 'down': case '[': this.jumpBeat(-1); break
      case 'home': case '0': this.playing = false; this.seek(0); break
      case 'end': this.playing = false; this.seek(LAST_FRAME); break
      case 't': this.togglePalette(); break
      case 'v': this.toggleAspect(); break
      case 'e': this.onExport?.(); break
      default: return false
    }
    this.onChange?.()
    return true
  }
}

/** In terminal mode letters can arrive as key "space" with the real character in keyChar. */
export function keyName(e: KeyLike): string {
  const ch = e.keyChar ?? ''
  if (ch.length === 1 && ch !== ' ' && /[a-z0-9\[\]]/i.test(ch)) return ch.toLowerCase()
  const k = (e.key ?? '').toLowerCase()
  if (k === ' ') return 'space'
  return k.replace(/^arrow/, '')
}

export const clampFrame = (f: number) => Math.min(LAST_FRAME, Math.max(0, f))
const wrap = (f: number) => ((f % TOTAL_FRAMES) + TOTAL_FRAMES) % TOTAL_FRAMES

export function timecode(frame: number): string {
  const s = Math.floor(frame / FPS), ff = frame % FPS
  return `00:${String(s).padStart(2, '0')}.${String(ff).padStart(2, '0')}`
}
