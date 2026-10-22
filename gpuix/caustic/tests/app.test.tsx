import { describe, expect, test } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, controls, keyName } from '../src/app'
import type { FromEngine, ToEngine } from '../src/protocol'
import type { Source } from '../src/source'
import { fallbackTheme } from '../src/theme'
import { DEFAULT_SETTINGS } from '../src/scene'

function fakeSource() {
  const sent: ToEngine[] = []
  const subs = new Set<(m: FromEngine) => void>()
  const source: Source = { post: (m) => sent.push(m), subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb) } }
  return { source, sent, emit: (m: FromEngine) => { for (const cb of subs) cb(m) } }
}

describe('keys', () => {
  test('terminal letters that arrive as key "space" with a keyChar still map to the letter', () => {
    expect(keyName({ key: 'space', keyChar: 'r' })).toBe('r')
    expect(keyName({ key: 'space', keyChar: ' ' })).toBe('space')
    expect(keyName({ key: 'left' })).toBe('left')
    expect(keyName({ key: 'R', keyChar: 'R' })).toBe('r')
  })
})

const describeNative = hasNativeTestRenderer ? describe : describe.skip
describeNative('caustic UI in the GPU test renderer', () => {
  test('quality toggle, pills, keys, pointer → engine messages, and the perf HUD', async () => {
    const W = 1200, H = 760
    const { source, sent, emit } = fakeSource()
    const { render, renderer } = createTestRoot({ width: W, height: H })
    const draw = () => render(<App source={source} theme={fallbackTheme()} size={{ width: W, height: H }} />)
    draw()
    const app = await connectTest(renderer)
    const text = () => renderer.getAllText().join('\n')
    expect(text()).toContain('CAUSTIC')
    expect(text()).toContain('LITE · 128² wave sim')
    expect(sent).toContainEqual({ type: 'size', w: W, h: H })

    await app.getByTestId('q-full').click()
    draw()
    expect(sent).toContainEqual({ type: 'set', settings: { quality: 'full' } })
    expect(text()).toContain('FULL · 256² wave sim')

    await app.getByTestId('pill-rain').click()
    expect(sent).toContainEqual({ type: 'set', settings: { rain: true } })

    controls.current!.key({ key: 'space', keyChar: 'b' })
    expect(sent).toContainEqual({ type: 'set', settings: { ball: false } })
    controls.current!.key({ key: '1', keyChar: '1' })
    expect(sent).toContainEqual({ type: 'set', settings: { quality: 'lite' } })

    // A drag on the water goes to the engine as normalized pointer coordinates.
    await app.mouse.drag({ x: W / 2, y: H / 2 + 80 }, { x: W / 2 + 120, y: H / 2 + 80 })
    const ptr = sent.filter((m) => m.type === 'pointer')
    expect(ptr.some((m) => m.type === 'pointer' && m.phase === 'up')).toBe(true)
    const down = ptr.find((m) => m.type === 'pointer' && m.phase === 'down')
    if (down?.type !== 'pointer') throw new Error('no pointer down')
    expect(down.u).toBeCloseTo(0, 1)
    expect(down.v).toBeCloseTo(-80 / (H / 2), 1)

    emit({ type: 'stats', stats: { fps: 59.6, simMs: 0.1, causticsMs: 2, renderMs: 6, frameMs: 16.7, w: 840, h: 532, sim: 128, photons: 82944, caustics: 192, workers: 6, steps: 60, peak: 4.2 }, settings: { ...DEFAULT_SETTINGS, rain: true, ball: false }, hover: 'water', drag: null })
    draw()
    expect(text()).toContain('60')
    expect(text()).toContain('840×532 → 1200×760')
    expect(text()).toContain('paravirtual')
  })

  test('a half-width split pane drops the hint bar and keeps the controls', async () => {
    const { source } = fakeSource()
    const { render, renderer } = createTestRoot({ width: 690, height: 760 })
    render(<App source={source} theme={fallbackTheme()} size={{ width: 690, height: 760 }} />)
    await connectTest(renderer)
    const all = renderer.getAllText().join('\n')
    expect(all).toContain('LITE')
    expect(all).toContain('Rain')
    expect(all).not.toContain('drag deck')
  })

  test('scenes and the sandbox: keys 3-6 pick a scene, T opens sliders, arrows and track drags tune them', async () => {
    const { source, sent } = fakeSource()
    const W = 1200, H = 760
    const { render, renderer } = createTestRoot({ width: W, height: H })
    render(<App source={source} theme={fallbackTheme()} size={{ width: W, height: H }} />)
    await connectTest(renderer)
    const sets = () => sent.flatMap((m) => (m.type === 'set' ? [m.settings] : []))
    expect(renderer.getAllText().join('\n')).toContain('lagoon')
    controls.current!.key({ key: '6' })
    expect(sets().at(-1)).toMatchObject({ look: 'night', sunElev: 70 })
    controls.current!.key({ key: 'space', keyChar: 'n' })
    expect(sets().at(-1)).toMatchObject({ look: 'pool' })
    controls.current!.key({ key: 'space', keyChar: 't' })
    await new Promise((r) => setTimeout(r, 30))
    const all = renderer.getAllText().join('\n')
    expect(all).toContain('Sandbox')
    expect(all).toContain('refraction (IOR)')
    // Arrow keys move through the rows instead of orbiting while the panel is open.
    const before = sent.length
    controls.current!.key({ key: 'right' })
    expect(sets().at(-1)).toMatchObject({ sunElev: 66 })
    controls.current!.key({ key: 'down' })
    controls.current!.key({ key: 'left' })
    expect(sets().at(-1)).toMatchObject({ sunAz: 18 })
    expect(sent.slice(before).some((m) => m.type === 'orbit')).toBe(false)
    controls.current!.key({ key: 'escape' })
  })
})

