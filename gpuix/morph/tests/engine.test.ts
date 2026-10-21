import { describe, expect, test } from 'bun:test'
import { BEATS, FRAMES_PER_BEAT, LAST_FRAME, TOTAL_BEATS, TOTAL_FRAMES, segments, typingSchedule } from '../src/lib/beats'
import { cursorAt } from '../src/lib/cursor'
import { makePalette } from '../src/lib/palette'
import { peak, settleFrames, CAMERA, QUICK, SLOW, SNAPPY, spring } from '../src/lib/spring'
import { paletteHeight, sceneAt } from '../src/scene'
import { timingIssues } from '../src/check'
import { Controller, keyName, timecode } from '../src/controller'
import { computeLayout } from '../src/layout'
import { stackFilter } from '../src/export'

const pal = makePalette('dark')

describe('timing engine', () => {
  test('120 BPM at 60 fps: 30 frames a beat, 28 beats, 840 frames', () => {
    expect(FRAMES_PER_BEAT).toBe(30)
    expect(TOTAL_BEATS).toBe(28)
    expect(TOTAL_FRAMES).toBe(840)
  })

  test('every beat carries an event and every state change lands exactly on its beat', () => {
    expect(BEATS.map((b) => b.beat)).toEqual(Array.from({ length: 28 }, (_, i) => i))
    for (const b of BEATS) expect(b.state != null || b.cursor.length > 0).toBe(true)
    expect(timingIssues()).toEqual([])
    const segs = segments()
    expect(segs.map((s) => s.state)).toEqual(['button', 'loader', 'check', 'island', 'player', 'scrubber', 'volume', 'toggle', 'tabs', 'chart', 'palette', 'button'])
    for (const s of segs) {
      expect(s.start % FRAMES_PER_BEAT).toBe(0)
      expect(sceneAt(s.start, pal).state).toBe(s.state)
      if (s.start > 0) expect(sceneAt(s.start - 1, pal).state).not.toBe(s.state)
    }
  })

  test('springs are deterministic, settle to exactly 1, and overshoot at most a little', () => {
    for (const cfg of [SNAPPY, CAMERA, QUICK, SLOW]) {
      expect(peak(cfg)).toBeLessThan(1.05)
      expect(spring(settleFrames(cfg) + 1, 0, cfg)).toBe(1)
      expect(spring(0, 0, cfg)).toBe(0)
    }
    expect(spring(17.5, 3)).toBe(spring(17.5, 3))
  })

  test('the last frame equals the first (seamless loop)', () => {
    const a = sceneAt(0, pal), b = sceneAt(LAST_FRAME, pal)
    expect(b.state).toBe(a.state)
    expect(b.box).toEqual(a.box)
    expect(b.camera).toBeCloseTo(a.camera, 9)
    expect(b.cursor).toEqual(a.cursor)
    expect(b.layers.map((l) => [l.state, l.opacity])).toEqual(a.layers.map((l) => [l.state, l.opacity]))
  })

  test('no hard cuts: the shape changes continuously frame to frame and never disappears', () => {
    let prev = sceneAt(0, pal)
    for (let f = 1; f <= LAST_FRAME; f++) {
      const s = sceneAt(f, pal)
      expect(s.box.w).toBeGreaterThan(40)
      expect(s.box.h).toBeGreaterThan(40)
      expect(Math.abs(s.box.w - prev.box.w)).toBeLessThan(60)
      expect(Math.abs(s.box.h - prev.box.h)).toBeLessThan(40)
      expect(Math.abs(s.camera - prev.camera)).toBeLessThan(0.05)
      const total = s.layers.reduce((a, l) => a + l.opacity, 0)
      expect(total).toBeGreaterThan(0.3)
      prev = s
    }
  })

  test('the cursor moves smoothly and clicks press', () => {
    for (let f = 1; f <= LAST_FRAME; f++) {
      const a = cursorAt(f - 1), b = cursorAt(f)
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(40)
    }
    expect(Math.max(...Array.from({ length: 12 }, (_, i) => cursorAt(24 + i).press))).toBeGreaterThan(0.9)
    expect(cursorAt(100).press).toBe(0)
  })

  test('state dynamics: play morphs to pause, toggle turns on, the palette filters as the query types', () => {
    expect(sceneAt(235, pal).p.playMorph).toBe(0)
    expect(sceneAt(270, pal).p.playMorph).toBeCloseTo(1, 2)
    expect(sceneAt(505, pal).p.toggle).toBe(0)
    expect(sceneAt(560, pal).p.toggle).toBeCloseTo(1, 2)
    expect(typingSchedule().map((t) => t.text)).toEqual(['e', 'ex', 'exp'])
    expect(typingSchedule().at(-1)!.frame).toBe(720)
    const early = sceneAt(695, pal).p, late = sceneAt(770, pal).p
    expect(early.query).toBe('')
    expect(late.query).toBe('exp')
    expect(late.rows.filter((r) => r > 0.99).length).toBe(2)
    expect(paletteHeight(late.rows)).toBeLessThan(paletteHeight(early.rows))
  })

  test('the volume slider rubber-bands past max and snaps back', () => {
    const over = Math.max(...Array.from({ length: 30 }, (_, i) => sceneAt(450 + i, pal).p.stretch))
    expect(over).toBeGreaterThan(10)
    expect(sceneAt(470 + 40, pal).p.stretch).toBeLessThan(0.5)
    expect(sceneAt(460, pal).p.volume).toBe(1)
  })
})

describe('controller', () => {
  test('plays in real time, loops, pauses, steps frames and jumps beats', () => {
    const c = new Controller()
    c.advance(1000)
    expect(c.shown).toBe(60)
    c.advance(14000)
    expect(c.shown).toBe(60)
    c.toggle()
    expect(c.playing).toBe(false)
    c.advance(500)
    expect(c.shown).toBe(60)
    c.step(1); expect(c.shown).toBe(61)
    c.step(-2); expect(c.shown).toBe(59)
    c.jumpBeat(1); expect(c.shown).toBe(60)
    c.jumpBeat(1); expect(c.shown).toBe(90)
    c.jumpBeat(-1); expect(c.shown).toBe(60)
    c.seek(0); c.step(-1); expect(c.shown).toBe(LAST_FRAME)
  })

  test('keys work whether they arrive as key or as keyChar (terminal mode)', () => {
    const c = new Controller()
    expect(keyName({ key: 'space', keyChar: 't' })).toBe('t')
    expect(keyName({ key: 'space', keyChar: ' ' })).toBe('space')
    expect(keyName({ key: 'right' })).toBe('right')
    c.keyDown({ key: 'space', keyChar: ' ' })
    expect(c.playing).toBe(false)
    c.keyDown({ key: 'space', keyChar: 't' })
    expect(c.palette).toBe('light')
    c.keyDown({ key: 'v' })
    expect(c.aspect).toBe('vertical')
    let exported = 0
    c.onExport = () => exported++
    c.keyDown({ key: 'e' })
    expect(exported).toBe(1)
    expect(c.keyDown({ key: 'z' })).toBe(false)
    expect(timecode(372)).toBe('00:06.12')
  })
})

describe('layout', () => {
  test('a full Ghostty pane and a half split both fit the artboard, the timeline and the bar', () => {
    for (const [w, h] of [[1440, 860], [716, 860], [1440, 420], [480, 700]] as const) {
      for (const aspect of ['square', 'vertical'] as const) {
        const L = computeLayout(w, h, aspect)
        expect(L.art.x).toBeGreaterThanOrEqual(0)
        expect(L.art.x + L.art.w).toBeLessThanOrEqual(w)
        expect(L.art.y).toBeGreaterThanOrEqual(L.top.h)
        expect(L.art.y + L.art.h).toBeLessThanOrEqual(L.tl.y)
        expect(L.tl.trackX + L.tl.trackW).toBeLessThanOrEqual(w)
      }
    }
    const full = computeLayout(1440, 860, 'square'), half = computeLayout(716, 860, 'square')
    expect(full.narrow).toBe(false)
    expect(half.narrow).toBe(true)
    expect(half.art.w).toBeGreaterThan(600)
  })

  test('export bands stack back into the full frame', () => {
    expect(stackFilter(2, 1080, 540, 1080)).toContain('vstack=inputs=2')
    expect(stackFilter(3, 1080, 450, 1350)).toContain('crop=1080:1350:0:0')
  })
})
