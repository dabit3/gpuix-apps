import { FRAMES_PER_BEAT, LAST_FRAME, TOTAL_FRAMES, segments, typingSchedule, type StateId } from './lib/beats'
import { mixColor } from './lib/color'
import { cursorAt, isPressed, pressAt } from './lib/cursor'
import { BOX, PALETTE_INPUT_H, PALETTE_ITEMS, PALETTE_PAD, PALETTE_ROW_H, SCRUB, TAB_W, VOLUME, type Box } from './lib/layout'
import type { Palette } from './lib/palette'
import { CAMERA, QUICK, SLOW, SNAPPY, clamp, easeInOut, lerp, ramp, spring } from './lib/spring'

const SEGS = segments()

export interface Layer { state: StateId; opacity: number; offsetY: number; scale: number; start: number; box: Box }
export interface ShapeBox { w: number; h: number; r: number; fill: string; border: string; scale: number }

export interface Params {
  loaderRot: number; loaderSweep: number; checkDraw: number
  bars: number[]
  playMorph: number; progress: number; artPulse: number; playPress: number
  scrub: number; scrubPress: number
  volume: number; stretch: number; volumePress: number
  toggle: number
  tabL: number; tabR: number; tabActive: number; tabPress: number
  chartDraw: number; tooltip: number
  query: string; rows: number[]; rowHover: number; rowPress: number; caret: number
}

export interface Scene {
  frame: number
  beat: number
  segment: number
  state: StateId
  box: ShapeBox
  camera: number
  layers: Layer[]
  cursor: { x: number; y: number; press: number }
  p: Params
}

export const wrapFrame = (f: number) => ((Math.round(f) % TOTAL_FRAMES) + TOTAL_FRAMES) % TOTAL_FRAMES

export function segmentIndexAt(frame: number): number {
  for (let i = SEGS.length - 1; i >= 0; i--) if (frame >= SEGS[i]!.start) return i
  return 0
}

// --- per-state dynamics (pure functions of the absolute frame) ---------------------------------------------------
const dragValue = (frame: number, down: number, up: number, x0: number, x1: number, center: number, before: number) => {
  if (frame < down) return before
  const f = Math.min(frame, up)
  const cx = cursorAt(f).x + center
  return (cx - x0) / (x1 - x0)
}

function scrubAt(frame: number) {
  const v = clamp(dragValue(frame, 326, 360, SCRUB.x0, SCRUB.x1, BOX.scrubber.w / 2, 0.32))
  return v
}

function volumeAt(frame: number) {
  const raw = dragValue(frame, 416, 470, VOLUME.x0, VOLUME.x1, BOX.volume.w / 2, 0.4)
  const over = Math.max(0, (raw - 1) * (VOLUME.x1 - VOLUME.x0))
  let stretch = 30 * (1 - Math.exp(-over / 46))
  if (frame >= 470) {
    const rawAt = dragValue(470, 416, 470, VOLUME.x0, VOLUME.x1, BOX.volume.w / 2, 0.4)
    const s0 = 30 * (1 - Math.exp(-Math.max(0, (rawAt - 1) * (VOLUME.x1 - VOLUME.x0)) / 46))
    stretch = s0 * (1 - spring(frame, 470, QUICK))
  }
  return { v: clamp(raw), stretch }
}

function tabsAt(frame: number) {
  const L = (i: number) => i * TAB_W + 10, R = (i: number) => (i + 1) * TAB_W - 10
  const moves = [{ f: 570, from: 0, to: 2 }, { f: 600, from: 2, to: 3 }]
  let l = L(0), r = R(0), active = 0
  for (const m of moves) {
    if (frame < m.f) break
    active = m.to
    const fwd = m.to > m.from
    const lead = spring(frame, m.f, QUICK), trail = spring(frame, m.f + 3, SLOW)
    l = lerp(L(m.from), L(m.to), fwd ? trail : lead)
    r = lerp(R(m.from), R(m.to), fwd ? lead : trail)
  }
  return { l, r, active }
}

function paletteAt(frame: number) {
  let query = ''
  const sched = typingSchedule()
  for (const s of sched) if (frame >= s.frame) query = s.text
  const rows = PALETTE_ITEMS.map((it) => {
    // A row's presence springs toward 0 on the keystroke that filters it out.
    let v = 1
    let prev = ''
    for (const s of sched) {
      const was = it.label.toLowerCase().includes(prev)
      const now = it.label.toLowerCase().includes(s.text)
      if (was && !now) v = 1 - spring(frame, s.frame, SNAPPY)
      prev = s.text
    }
    return clamp(v)
  })
  return { query, rows }
}

export function paletteHeight(rows: number[]) {
  return PALETTE_INPUT_H + PALETTE_PAD * 2 + rows.reduce((a, b) => a + b, 0) * PALETTE_ROW_H
}

function stateFill(s: StateId, pal: Palette, frame: number): { fill: string; border: string } {
  const none = { border: '#00000000' }
  switch (s) {
    case 'button': case 'loader': case 'island': case 'tabs': return { fill: pal.solid, ...none }
    case 'check': return { fill: pal.accent, ...none }
    case 'toggle': return { fill: mixColor(pal.track, pal.accent, clamp(spring(frame, 510, SNAPPY))), ...none }
    default: return { fill: pal.card, border: pal.cardBorder }
  }
}

/** The target box of a state at a frame (some states reshape themselves: the volume rubber band, the filtering palette). */
export function targetBox(s: StateId, frame: number): Box {
  const b = BOX[s]
  if (s === 'volume') { const { stretch } = volumeAt(frame); return { w: b.w + stretch, h: b.h - stretch * 0.22, r: (b.h - stretch * 0.22) / 2 } }
  if (s === 'palette') return { ...b, h: paletteHeight(paletteAt(frame).rows) }
  return b
}

const cameraFor = (b: Box) => clamp(Math.pow(648 / Math.max(b.w, b.h * 1.15), 0.42), 0.96, 1.55)

const BOX_CLICKS = [30, 150, 210, 510]
const bell = (frame: number, at: number, len: number) => (frame > at && frame < at + len ? Math.sin((Math.PI * (frame - at)) / len) : 0)

export function sceneAt(frameIn: number, pal: Palette): Scene {
  const frame = clamp(frameIn, 0, LAST_FRAME)
  const si = segmentIndexAt(frame)
  const seg = SEGS[si]!
  const prev = si > 0 ? SEGS[si - 1]! : null
  const f0 = seg.start
  const k = prev ? spring(frame, f0, SNAPPY) : 1
  const kc = clamp(k)

  const to = targetBox(seg.state, frame)
  const from = prev ? targetBox(prev.state, f0) : to
  const toFill = stateFill(seg.state, pal, frame)
  const fromFill = prev ? stateFill(prev.state, pal, f0) : toFill
  const press = pressAt(frame)
  const boxPressed = BOX_CLICKS.some((c) => frame >= c - 5 && frame < c + 24)
  const box: ShapeBox = {
    w: Math.max(1, lerp(from.w, to.w, k)),
    h: Math.max(1, lerp(from.h, to.h, k)),
    r: Math.max(0, lerp(from.r, to.r, k)),
    fill: mixColor(fromFill.fill, toFill.fill, kc),
    border: mixColor(fromFill.border, toFill.border, kc),
    scale: (boxPressed ? 1 - 0.04 * press : 1) * (1 + 0.06 * bell(frame, 120, 20)),
  }
  box.r = Math.min(box.r, box.w / 2, box.h / 2)
  const camera = prev ? lerp(cameraFor(from), cameraFor(to), spring(frame, f0, CAMERA)) : cameraFor(to)

  const fadeIn = easeInOut(ramp(frame, f0 + 2, f0 + 9))
  const layers: Layer[] = []
  if (prev) {
    const out = 1 - easeInOut(ramp(frame, f0, f0 + 7))
    if (out > 0) layers.push({ state: prev.state, opacity: out, offsetY: -6 * (1 - out), scale: 1 - 0.03 * (1 - out), start: prev.start, box: from })
  }
  layers.push({ state: seg.state, opacity: prev ? fadeIn : 1, offsetY: prev ? 8 * (1 - fadeIn) : 0, scale: prev ? 0.97 + 0.03 * fadeIn : 1, start: f0, box: to })

  const B = FRAMES_PER_BEAT
  const beatPhase = frame % B
  const bars = [0, 1, 2, 3].map((i) => {
    const hit = Math.exp(-((frame - 2 * i) % B + B) % B / 9)
    return 0.28 + 0.62 * hit * [1, 0.7, 0.9, 0.55][i]! + 0.1 * Math.sin(frame * 0.21 + i * 1.7)
  })
  const vol = volumeAt(frame)
  const tabs = tabsAt(frame)
  const pa = paletteAt(frame)
  const p: Params = {
    loaderRot: (frame - 30) * 0.12,
    loaderSweep: 0.18 + 0.42 * spring(frame, 60, SNAPPY) + 0.4 * spring(frame, 90, SNAPPY),
    checkDraw: easeInOut(ramp(frame, 94, 116)),
    bars,
    playMorph: clamp(spring(frame, 240, QUICK)),
    progress: 0.18 + Math.max(0, frame - 240) * 0.0011,
    artPulse: 0.04 * bell(frame, 270, 18),
    playPress: frame >= 230 && frame < 270 ? press : 0,
    scrub: scrubAt(frame),
    scrubPress: frame >= 320 && frame < 390 ? press : 0,
    volume: vol.v,
    stretch: vol.stretch,
    volumePress: frame >= 410 && frame < 500 ? press : 0,
    toggle: spring(frame, 510, SNAPPY),
    tabL: tabs.l, tabR: tabs.r, tabActive: tabs.active,
    tabPress: frame >= 560 && frame < 630 ? press : 0,
    chartDraw: easeInOut(ramp(frame, 636, 672)),
    tooltip: spring(frame, 660, SNAPPY),
    query: pa.query, rows: pa.rows,
    rowHover: clamp(spring(frame, 742, SNAPPY)),
    rowPress: frame >= 770 ? press : 0,
    caret: frame >= 690 && frame < 780 ? (Math.floor((frame - 690) / 15) % 2 === 0 || isPressed(frame) ? 1 : 0) : 0,
  }
  void beatPhase
  return { frame, beat: Math.floor(frame / B), segment: si, state: seg.state, box, camera, layers, cursor: cursorAt(frame), p }
}
