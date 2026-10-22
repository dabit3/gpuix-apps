import { describe, expect, test } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { Editor } from '../src/core/editor'
import { App, keyHandlers } from '../src/ui/app'
import { computeLayout } from '../src/ui/layout'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
const tick = () => new Promise((r) => setTimeout(r, 20))

describe('layout', () => {
  test('a full pane gets the panel; a half split slims it; a thin pane gives the canvas everything', () => {
    const full = computeLayout(1420, 860)
    const half = computeLayout(700, 860)
    const thin = computeLayout(480, 860)
    expect(full.panel).toBe(296)
    expect(half.panel).toBe(236)
    expect(thin.panel).toBe(0)
    for (const L of [full, half, thin]) {
      expect(L.canvas.w).toBeGreaterThan(200)
      expect(L.canvas.x + L.canvas.w + L.panel).toBe(L.w)
    }
  })
})

describeNative('PhotoCraft in the GPU test renderer', () => {
  test('tools, blend menu, adjustments, filters, painting and undo through native input', async () => {
    const W = 1400
    const H = 860
    const px = new Uint8ClampedArray(400 * 250 * 4)
    for (let i = 0; i < 400 * 250; i++) px.set([(i % 400) % 64 < 32 ? 230 : 20, 90, 160, 255], i * 4)
    const ed = Editor.fromImage({ width: 400, height: 250, data: px }, 'stripes.png')
    let exported = 0
    const { render, renderer } = createTestRoot({ width: W, height: H, ...keyHandlers })
    const draw = () =>
      render(<App ed={ed} size={{ width: W, height: H }} actions={{ exportPng: () => exported++, exportJpeg() {}, saveProject() {} }} fileLabel="test.png" />)
    draw()
    await tick()
    renderer.flush()
    const app = await connectTest(renderer)
    const text = () => renderer.getAllText().join('\n')
    const click = async (id: string) => {
      await app.getByTestId(id).click()
      await tick()
      draw()
      renderer.flush()
    }
    expect(text()).toContain('test.png')
    expect(text()).toContain('Background')

    await click('dup-layer')
    expect(ed.doc.layers.length).toBe(2)
    expect(text()).toContain('Background copy')

    await click('blend-button')
    await click('blend-soft-light')
    expect(ed.layer!.blend).toBe('soft-light')
    expect(text()).toContain('Soft Light · 100%')

    // Drag the opacity slider from the right end to 40 %.
    const sb = await app.getByTestId('opacity-slider').bounds()
    const sy = sb.y + sb.height / 2
    renderer.nativeSimulateMouseDown(sb.x + sb.width - 2, sy, 0)
    renderer.flush()
    for (let i = 1; i <= 6; i++) {
      renderer.nativeSimulateMouseMove(sb.x + sb.width - 2 - (i / 6) * (sb.width * 0.6 - 2), sy, 0)
      renderer.flush()
    }
    renderer.nativeSimulateMouseUp(sb.x + sb.width * 0.4, sy, 0)
    renderer.flush()
    expect(Math.round(ed.layer!.opacity * 100)).toBe(40)
    expect(ed.history.entries.at(-1)!.label).toBe('Opacity')

    await click('filter-gaussian')
    expect(text()).toContain('Gaussian Blur')
    expect(ed.filterPreview).not.toBeNull()
    await click('dialog-apply')
    expect(ed.filterPreview).toBeNull()
    expect(ed.history.entries.at(-1)!.label).toBe('Gaussian Blur')

    await click('add-mask')
    expect(ed.layer!.mask).not.toBeNull()
    expect(ed.editMask).toBe(true)

    // Paint across the canvas center with real mouse events: the mask gets hidden pixels.
    const L = computeLayout(W, H)
    const cx = L.canvas.x + L.canvas.w / 2
    const cy = L.canvas.y + L.canvas.h / 2
    renderer.nativeSimulateMouseDown(cx - 100, cy, 0)
    renderer.flush()
    for (let i = 1; i <= 10; i++) {
      renderer.nativeSimulateMouseMove(cx - 100 + i * 20, cy, 0)
      renderer.flush()
    }
    renderer.nativeSimulateMouseUp(cx + 100, cy, 0)
    renderer.flush()
    expect(ed.history.entries.at(-1)!.label).toBe('Hide Mask')
    expect(ed.layer!.mask!.some((v) => v < 128)).toBe(true)

    await click('adj-curves')
    expect(ed.layer!.kind).toBe('adjust')
    await tick()
    renderer.flush()
    expect(text().split('\n').filter((t) => t === 'Curves').length).toBeGreaterThanOrEqual(3)

    await click('tool-marquee')
    renderer.nativeSimulateMouseDown(cx - 80, cy - 50, 0)
    renderer.flush()
    renderer.nativeSimulateMouseMove(cx + 80, cy + 50, 0)
    renderer.flush()
    renderer.nativeSimulateMouseUp(cx + 80, cy + 50, 0)
    renderer.flush()
    expect(ed.selectionBounds).not.toBeNull()

    const n = ed.history.index
    renderer.simulateKeystrokes('ctrl-z')
    renderer.flush()
    expect(ed.history.index).toBe(n - 1)
    expect(ed.selection).toBeNull()
    renderer.simulateKeystrokes('ctrl-shift-z')
    renderer.flush()
    expect(ed.selection).not.toBeNull()

    renderer.simulateKeystrokes('e')
    renderer.flush()
    expect(ed.tool).toBe('eraser')

    await click('export')
    expect(exported).toBe(1)

    // Command palette: Ctrl-K, type, Enter.
    renderer.simulateKeystrokes('ctrl-k')
    await tick()
    draw()
    renderer.flush()
    expect(text()).toContain('Search commands, tools and adjustments')
    renderer.simulateKeystrokes('l e v')
    await tick()
    draw()
    renderer.flush()
    renderer.simulateKeystrokes('enter')
    await tick()
    renderer.flush()
    expect(ed.layer!.kind === 'adjust' && ed.layer!.adjust.kind).toBe('levels')

    // Menu bar: Image › Rotate 90° Clockwise.
    await click('menu-Image')
    await click('cmd-rot-cw')
    expect([ed.doc.width, ed.doc.height]).toEqual([250, 400])

    // Crop tool: drag a frame inside the canvas, then Crop.
    await click('tool-crop')
    const L2 = computeLayout(W, H)
    const mx = L2.canvas.x + L2.canvas.w / 2
    const my = L2.canvas.y + L2.canvas.h / 2
    renderer.nativeSimulateMouseDown(mx - 120, my - 120, 0)
    renderer.flush()
    renderer.nativeSimulateMouseMove(mx + 60, my + 90, 0)
    renderer.flush()
    renderer.nativeSimulateMouseUp(mx + 60, my + 90, 0)
    renderer.flush()
    await click('crop-apply')
    expect(ed.doc.width).toBeLessThan(250)
    expect(ed.history.entries.at(-1)!.label).toBe('Crop')

    // Type tool: click, type, Esc commits a type layer.
    await click('tool-text')
    renderer.nativeSimulateMouseDown(mx - 40, my, 0)
    renderer.nativeSimulateMouseUp(mx - 40, my, 0)
    renderer.flush()
    expect(ed.textEdit).not.toBeNull()
    renderer.simulateKeystrokes('h i')
    renderer.flush()
    renderer.simulateKeystrokes('escape')
    renderer.flush()
    expect(ed.textEdit).toBeNull()
    expect((ed.layer as any).text.content).toBe('hi')
  })
})
