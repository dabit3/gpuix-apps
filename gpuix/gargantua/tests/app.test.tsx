import { describe, expect, test } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, controls, fmtTime, keyName } from '../src/app'
import type { FromEngine, ToEngine } from '../src/protocol'
import type { Source } from '../src/source'
import { fallbackTheme } from '../src/theme'

function fakeSource() {
  const sent: ToEngine[] = []
  const subs = new Set<(m: FromEngine) => void>()
  const source: Source = { post: (m) => sent.push(m), subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb) } }
  return { source, sent, emit: (m: FromEngine) => { for (const cb of subs) cb(m) } }
}
const tick = () => new Promise((r) => setTimeout(r, 20))

describe('formatting + keys', () => {
  test('keyName normalises terminal letters', () => {
    expect(keyName({ key: 'space', keyChar: 'l' })).toBe('l')
    expect(keyName({ key: 'space', keyChar: ' ' })).toBe('space')
    expect(keyName({ key: 'L', keyChar: 'L' })).toBe('l')
  })
  test('fmtTime picks sensible units and ∞', () => {
    expect(fmtTime(0.25)).toBe('250 ms')
    expect(fmtTime(42)).toBe('42.0 s')
    expect(fmtTime(3600 * 5)).toBe('5.0 h')
    expect(fmtTime(Infinity)).toBe('∞')
  })
})

const describeNative = hasNativeTestRenderer ? describe : describe.skip
describeNative('gargantua UI in the GPU test renderer', () => {
  test('top bar buttons, keys, help overlay and drag orbit drive the engine', async () => {
    const W = 1400, H = 820
    const { source, sent, emit } = fakeSource()
    const { render, renderer } = createTestRoot({ width: W, height: H })
    const draw = () => render(<App source={source} theme={fallbackTheme()} size={{ width: W, height: H }} />)
    draw()
    const app = await connectTest(renderer)
    const text = () => renderer.getAllText().join('\n')
    expect(text()).toContain('GARGANTUA')
    expect(text()).toContain('Interstellar look · LITE')
    expect(sent).toContainEqual({ type: 'size', w: W, h: H })

    for (const [id, msg] of [
      ['q-full', { type: 'set', settings: { quality: 'full' } }],
      ['pill-lens', { type: 'set', settings: { lens: false } }],
      ['pill-disk', { type: 'set', settings: { disk: false } }],
      ['pill-look', { type: 'set', settings: { look: 'physical' } }],
      ['pill-pause', { type: 'set', settings: { paused: true } }],
      ['pill-drop', { type: 'drop' }],
      ['pill-dive', { type: 'dive' }],
      ['tilt-inc', { type: 'set', settings: { tilt: 5 } }],
      ['mass-dec', { type: 'set', settings: { mass: 7.5 } }],
      ['scene-m87', { type: 'set', settings: { scene: 'm87', look: 'physical', tilt: 0, mass: 9.81 } }],
    ] as const) {
      await app.getByTestId(id).click()
      draw()
      expect(sent).toContainEqual(msg as ToEngine)
    }
    await app.getByTestId('pill-snap').click()
    expect(sent.some((m) => m.type === 'screenshot' && m.path.endsWith('.png'))).toBe(true)
    expect(text()).toContain('M87*')
    expect(text()).toContain('flat space')

    // Plain-key shortcuts mirror the buttons.
    const n = sent.length
    for (const k of ['l', 'k', 'i', '1', 'b', '3', '[', '=', 'space', 'e']) controls.current!.key({ key: k === 'space' ? 'space' : k, keyChar: k === 'space' ? ' ' : k })
    const after = sent.slice(n)
    expect(after).toContainEqual({ type: 'set', settings: { lens: true } })
    expect(after).toContainEqual({ type: 'set', settings: { disk: true } })
    expect(after).toContainEqual({ type: 'set', settings: { quality: 'lite' } })
    expect(after).toContainEqual({ type: 'drop' })
    expect(after).toContainEqual({ type: 'eject' })
    expect(after.some((m) => m.type === 'set' && m.settings.scene === 'gargantua')).toBe(true)

    // Help overlay toggles on the button and on H.
    await app.getByTestId('pill-help').click()
    draw()
    expect(text()).toContain('Controls')
    expect(text()).toContain('dive: free fall through the horizon')
    controls.current!.key({ key: 'h', keyChar: 'h' })
    draw()
    await tick()
    expect(text()).not.toContain('dive: free fall through the horizon')

    // Drag on the sky orbits the camera: normalised pointer messages down → move → up.
    await app.mouse.drag({ x: W / 2, y: H / 2 + 120 }, { x: W / 2 + 200, y: H / 2 + 120 })
    const ptr = sent.filter((m) => m.type === 'pointer')
    const down = ptr.find((m) => m.type === 'pointer' && m.phase === 'down')
    if (down?.type !== 'pointer') throw new Error('no pointer down')
    expect(down.u).toBeCloseTo(0, 1)
    expect(ptr.some((m) => m.type === 'pointer' && m.phase === 'move' && m.u > 0.2)).toBe(true)
    expect(ptr.some((m) => m.type === 'pointer' && m.phase === 'up')).toBe(true)

    // Dive HUD shows the mission numbers, then the horizon moment.
    emit({ type: 'stats', stats: { fps: 41, traceMs: 18, tableMs: 0, postMs: 3, w: 700, h: 410, workers: 8, rays: 640 }, hud: { r: 2.5, yaw: 0, pitch: 0, probes: 0, probe: null, dive: { phase: 'fall', r: 2.5, v: 0.62, tau: 140, t: 260, inside: 0 } } })
    emit({ type: 'dive', phase: 'horizon' })
    draw()
    await tick()
    expect(text()).toContain('FREE FALL')
    expect(text()).toContain('0.620 c')
    expect(text()).toContain('proper time τ')
    expect(text()).toContain('EVENT HORIZON')

    controls.current!.key({ key: 'g', keyChar: 'g' })
    draw()
    await tick()
    expect(text()).toContain('640 rays')
  })

  test('half-width split pane: the bar wraps instead of clipping', async () => {
    const W = 780, H = 820
    const { source } = fakeSource()
    const { render, renderer } = createTestRoot({ width: W, height: H })
    render(<App source={source} theme={fallbackTheme()} size={{ width: W, height: H }} />)
    const app = await connectTest(renderer)
    for (const id of ['pill-help', 'pill-dive', 'scene-quasar', 'tilt-inc']) {
      const b = await app.getByTestId(id).bounds()
      expect(b).not.toBeNull()
      expect(b!.x + b!.width).toBeLessThanOrEqual(W)
      expect(b!.x).toBeGreaterThanOrEqual(0)
    }
  })
})
