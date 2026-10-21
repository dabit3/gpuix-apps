import { describe, expect, test } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, keyHandlers } from '../src/app'
import { Controller } from '../src/controller'
import { computeLayout } from '../src/layout'
import { FALLBACK_THEME } from '../src/theme'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative('morph in the GPU test renderer', () => {
  test('play/pause, keys, scrubbing and the half-pane reflow through native input', async () => {
    let size = { width: 1400, height: 860 }
    const c = new Controller({ paused: true })
    const { render, renderer } = createTestRoot({ width: size.width, height: size.height, ...keyHandlers(c) })
    const draw = () => render(<App controller={c} theme={FALLBACK_THEME} autoTick={false} size={size} />)
    draw()
    const app = await connectTest(renderer)
    const text = () => renderer.getAllText().join('\n')

    expect(text()).toContain('frame 000 / 839')
    expect(text()).toContain('Button')
    expect(text()).toContain('Get started')

    await app.getByTestId('play-button').click()
    draw()
    expect(c.playing).toBe(true)
    c.advance(3000)
    draw()
    expect(text()).toContain('frame 180 / 839')
    expect(text()).toContain('Dynamic Island')
    await app.getByTestId('play-button').click()
    draw()
    expect(c.playing).toBe(false)

    renderer.simulateKeystrokes('right')
    draw()
    expect(c.shown).toBe(181)
    renderer.simulateKeystrokes('up')
    draw()
    expect(c.shown).toBe(210)
    expect(text()).toContain('Music player')
    renderer.simulateKeystrokes('t')
    draw()
    expect(c.palette).toBe('light')

    // Click the timeline four fifths of the way along: the playhead jumps there and the scene follows.
    const L = computeLayout(size.width, size.height, c.aspect)
    await app.mouse.click({ x: L.tl.trackX + L.tl.trackW * 0.8, y: L.tl.trackY })
    draw()
    expect(Math.abs(c.shown - Math.round(839 * 0.8))).toBeLessThanOrEqual(2)
    expect(text()).toContain('Line chart')

    // Half a Ghostty split: narrow layout, artboard still big, controls still respond.
    size = { width: 700, height: 860 }
    draw()
    expect(text()).not.toContain('one shape that never cuts')
    expect(computeLayout(700, 860, 'square').art.w).toBeGreaterThan(600)
    await app.getByTestId('chip-aspect').click()
    draw()
    expect(c.aspect).toBe('vertical')
    renderer.simulateKeystrokes('space')
    draw()
    expect(c.playing).toBe(true)
  }, 30000)
})
