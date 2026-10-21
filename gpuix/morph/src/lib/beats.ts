/** The timing engine: 120 BPM at 60 fps, one beat = 30 frames, 28 beats = 14 s. Something happens on every beat. */
export const BPM = 120
export const FPS = 60
export const FRAMES_PER_BEAT = (FPS * 60) / BPM
export const TOTAL_BEATS = 28
export const TOTAL_FRAMES = TOTAL_BEATS * FRAMES_PER_BEAT
export const LAST_FRAME = TOTAL_FRAMES - 1

export type StateId =
  | 'button' | 'loader' | 'check' | 'island' | 'player' | 'scrubber'
  | 'volume' | 'toggle' | 'tabs' | 'chart' | 'palette'

export const STATE_LABEL: Record<StateId, string> = {
  button: 'Button', loader: 'Loader', check: 'Checkmark', island: 'Dynamic Island', player: 'Music player',
  scrubber: 'Progress scrubber', volume: 'Volume slider', toggle: 'Toggle', tabs: 'Tab bar', chart: 'Line chart',
  palette: 'Command palette',
}

/** Cursor coordinates are scene units relative to the shape's center, in the target state's layout. */
export type Pt = readonly [number, number]
export type CursorAction =
  | { kind: 'move'; to: Pt; at: number; dur: number }
  | { kind: 'click' }
  | { kind: 'press' }
  | { kind: 'drag'; to: Pt; at: number; dur: number }
  | { kind: 'release'; at?: number }
  | { kind: 'type'; text: string }
  | { kind: 'idle' }

export interface BeatEntry {
  beat: number
  /** The shape starts morphing into this state exactly on this beat. */
  state?: StateId
  cursor: CursorAction[]
  note: string
}

import { CHART_HOVER } from './layout'

export const REST: Pt = [250, 230]

// Positions used by the cursor; they match the layouts in src/states.
export const P = {
  button: [34, 6] as Pt,
  loaderAside: [74, 64] as Pt,
  island: [150, 6] as Pt,
  islandCenter: [-20, 2] as Pt,
  play: [46, 34] as Pt,
  progress: [56, 84] as Pt,
  aside: [160, 70] as Pt,
  toggle: [10, 4] as Pt,
  paletteAside: [210, 190] as Pt,
}

export const BEATS: BeatEntry[] = [
  { beat: 0, state: 'button', cursor: [{ kind: 'move', to: P.button, at: 2, dur: 22 }], note: 'cursor glides onto the button' },
  { beat: 1, state: 'loader', cursor: [{ kind: 'click' }, { kind: 'move', to: P.loaderAside, at: 4, dur: 22 }], note: 'click: button collapses into a loader' },
  { beat: 2, cursor: [{ kind: 'idle' }], note: 'arc sweeps open on the beat' },
  { beat: 3, state: 'check', cursor: [{ kind: 'idle' }], note: 'loader resolves into a checkmark, stroke draws on' },
  { beat: 4, cursor: [{ kind: 'move', to: P.island, at: 2, dur: 26 }], note: 'check settles, cursor heads up' },
  { beat: 5, state: 'island', cursor: [{ kind: 'click' }, { kind: 'move', to: P.islandCenter, at: 2, dur: 22 }], note: 'click: stretches into a Dynamic Island' },
  { beat: 6, cursor: [{ kind: 'idle' }], note: 'equalizer hits the beat' },
  { beat: 7, state: 'player', cursor: [{ kind: 'click' }, { kind: 'move', to: P.play, at: 4, dur: 22 }], note: 'click: island expands into a music player' },
  { beat: 8, cursor: [{ kind: 'click' }, { kind: 'move', to: P.progress, at: 10, dur: 30 }], note: 'click play: icon morphs to pause' },
  { beat: 9, cursor: [{ kind: 'idle' }], note: 'progress runs, art pulses' },
  { beat: 10, state: 'scrubber', cursor: [{ kind: 'click' }, { kind: 'move', to: [-68, 0], at: 4, dur: 20 }], note: 'click progress: player folds into a scrubber' },
  { beat: 11, cursor: [{ kind: 'press' }, { kind: 'drag', to: [106, 0], at: 0, dur: 28 }], note: 'grab the knob and drag' },
  { beat: 12, cursor: [{ kind: 'release' }, { kind: 'move', to: P.aside, at: 4, dur: 20 }], note: 'release, time label lands' },
  { beat: 13, state: 'volume', cursor: [{ kind: 'move', to: [-34, 0], at: 4, dur: 22 }], note: 'becomes a volume slider' },
  { beat: 14, cursor: [{ kind: 'press' }, { kind: 'drag', to: [172, 0], at: 0, dur: 28 }], note: 'drag volume up to max' },
  { beat: 15, cursor: [{ kind: 'drag', to: [236, 0], at: 0, dur: 16 }, { kind: 'release', at: 20 }], note: 'drag past max: rubber band, snap back' },
  { beat: 16, state: 'toggle', cursor: [{ kind: 'move', to: P.toggle, at: 4, dur: 20 }], note: 'shrinks into a toggle' },
  { beat: 17, cursor: [{ kind: 'click' }], note: 'click: toggle on' },
  { beat: 18, state: 'tabs', cursor: [{ kind: 'move', to: [70, 4], at: 4, dur: 20 }], note: 'widens into a tab bar' },
  { beat: 19, cursor: [{ kind: 'click' }, { kind: 'move', to: [210, 4], at: 6, dur: 18 }], note: 'liquid indicator stretches to tab 3' },
  { beat: 20, cursor: [{ kind: 'click' }], note: 'and to tab 4' },
  { beat: 21, state: 'chart', cursor: [{ kind: 'move', to: CHART_HOVER, at: 8, dur: 22 }], note: 'grows into a line chart, line draws on' },
  { beat: 22, cursor: [{ kind: 'idle' }], note: 'hover: tooltip on the August point' },
  { beat: 23, state: 'palette', cursor: [{ kind: 'move', to: P.paletteAside, at: 2, dur: 20 }, { kind: 'type', text: 'exp' }], note: 'command palette, query types out' },
  { beat: 24, cursor: [{ kind: 'idle' }], note: 'results filter, palette shrinks' },
  { beat: 25, cursor: [{ kind: 'move', to: [-120, 10], at: 0, dur: 30 }], note: 'cursor onto the top result' },
  { beat: 26, state: 'button', cursor: [{ kind: 'click' }, { kind: 'move', to: REST, at: 10, dur: 40 }], note: 'click: folds back into the button' },
  { beat: 27, cursor: [{ kind: 'idle' }], note: 'settle: the last frame equals the first' },
]

/** One entry per state change: the start frame and the beat it belongs to. */
export interface Segment { state: StateId; start: number; end: number; beat: number }

export function segments(): Segment[] {
  const s = BEATS.filter((b) => b.state)
  return s.map((b, i) => ({
    state: b.state!,
    beat: b.beat,
    start: b.beat * FRAMES_PER_BEAT,
    end: (i + 1 < s.length ? s[i + 1]!.beat : TOTAL_BEATS) * FRAMES_PER_BEAT,
  }))
}

export const beatFrame = (beat: number) => beat * FRAMES_PER_BEAT
export const frameToBeat = (frame: number) => frame / FRAMES_PER_BEAT

/** Typed characters land on half-beats, starting a few frames into the palette, the last one on the next beat. */
export function typingSchedule(): { frame: number; text: string }[] {
  const b = BEATS.find((e) => e.cursor.some((c) => c.kind === 'type'))!
  const text = (b.cursor.find((c) => c.kind === 'type') as { text: string }).text
  const end = beatFrame(b.beat + 1)
  const step = 8
  return text.split('').map((_, i) => ({ frame: end - (text.length - 1 - i) * step, text: text.slice(0, i + 1) }))
}

export function beatMap(): string {
  const lines = ['beat  frame  time     state change          cursor          note']
  for (const b of BEATS) {
    const f = beatFrame(b.beat)
    lines.push(
      `${String(b.beat).padStart(4)}  ${String(f).padStart(5)}  ${(f / FPS).toFixed(2).padStart(5)}s  ${(b.state ? '→ ' + STATE_LABEL[b.state] : '').padEnd(20)}  ${b.cursor.map((c) => c.kind).join('+').padEnd(14)}  ${b.note}`,
    )
  }
  return lines.join('\n')
}
