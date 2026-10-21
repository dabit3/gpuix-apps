import { BEATS, FRAMES_PER_BEAT, REST, type Pt } from './beats'
import { QUICK, clamp, easeInOut, spring } from './spring'

interface Seg { f0: number; f1: number; from: Pt; to: Pt; arc: number }
interface Press { down: number; up: number }

export interface CursorTrack { segs: Seg[]; presses: Press[] }

export function compileCursor(): CursorTrack {
  const segs: Seg[] = []
  const presses: Press[] = []
  let pos: Pt = REST
  let open: number | null = null
  for (const b of BEATS) {
    const bf = b.beat * FRAMES_PER_BEAT
    for (const a of b.cursor) {
      if (a.kind === 'move' || a.kind === 'drag') {
        segs.push({ f0: bf + a.at, f1: bf + a.at + a.dur, from: pos, to: a.to, arc: a.kind === 'move' ? 0.12 : 0 })
        pos = a.to
      } else if (a.kind === 'click') presses.push({ down: bf - 5, up: bf })
      else if (a.kind === 'press') open = bf - 4
      else if (a.kind === 'release') { presses.push({ down: open ?? bf - 4, up: bf + (a.at ?? 0) }); open = null }
    }
  }
  return { segs, presses }
}

const TRACK = compileCursor()

export function cursorAt(frame: number, track: CursorTrack = TRACK): { x: number; y: number; press: number } {
  let p: Pt = REST
  let x = p[0], y = p[1]
  for (const s of track.segs) {
    if (frame >= s.f1) { p = s.to; x = p[0]; y = p[1]; continue }
    if (frame > s.f0) {
      const t = easeInOut((frame - s.f0) / (s.f1 - s.f0))
      const dx = s.to[0] - s.from[0], dy = s.to[1] - s.from[1]
      const bow = Math.sin(Math.PI * t) * s.arc
      x = s.from[0] + dx * t - dy * bow
      y = s.from[1] + dy * t + dx * bow
    }
    break
  }
  return { x, y, press: pressAt(frame, track) }
}

/** 0..1: eases down over 4 frames, holds, springs back on release. */
export function pressAt(frame: number, track: CursorTrack = TRACK): number {
  let v = 0
  for (const p of track.presses) {
    if (frame < p.down) continue
    const down = clamp((frame - p.down) / 4)
    const amt = frame < p.up ? down : clamp((Math.min(p.up - p.down, 4) / 4) * (1 - spring(frame, p.up, QUICK)), 0, 1)
    v = Math.max(v, amt)
  }
  return v
}

export function isPressed(frame: number, track: CursorTrack = TRACK): boolean {
  return track.presses.some((p) => frame >= p.down && frame < p.up)
}
export const pressWindows = () => TRACK.presses
