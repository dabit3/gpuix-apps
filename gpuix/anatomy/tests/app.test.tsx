/** Drives the real app on the GPUIX GPU test renderer (Metal on macOS): native clicks on painted bounds. */
import { describe, expect, it } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { design } from '../src/designers'
import { loadGhosttyTheme } from '../src/theme'
import { App, keyName } from '../src/ui/app'
import { Viewer } from '../src/ui/viewer'

const settle = () => new Promise((r) => setTimeout(r, 60))
const d = hasNativeTestRenderer ? describe : describe.skip
const palette = { bg: [10, 12, 16] as [number, number, number], grid: [122, 130, 142] as [number, number, number], accent: [113, 183, 255] as [number, number, number] }

describe('keys', () => {
  it('reads letters from keyChar when terminal mode reports key "space"', () => {
    expect(keyName({ key: 'space', keyChar: 'E' })).toBe('e')
    expect(keyName({ key: 'space', keyChar: ' ' })).toBe('space')
    expect(keyName({ key: 'down' })).toBe('down')
    expect(keyName({ key: 'e', keyChar: 'e' })).toBe('e')
  })

  it('viewer keyboard map drives clock, explode, view and selection', () => {
    const v = new Viewer(design('a V8 engine')!, palette)
    v.key('space'); expect(v.playing).toBe(false)
    v.key('.'); expect(v.t).toBeCloseTo(1 / 60, 6)
    v.key(']'); expect(v.speed).toBe(2)
    v.key('['); v.key('['); expect(v.speed).toBe(0.5)
    v.key('e'); expect(v.explodeTarget).toBe(1)
    v.tick(0.5); expect(v.explode).toBeGreaterThan(0.9)
    v.key('v'); expect(v.cam.view).toBe('perspective')
    v.key('down'); expect(v.selected).toBe(0)
    v.key('up'); expect(v.selected).toBe(v.scene.parts.length - 1)
    v.key('escape'); expect(v.selected).toBe(-1)
  })

  it('hot reload keeps the selection and clock on the same machine, reframes a new one', () => {
    const v = new Viewer(design('a V8 engine')!, palette)
    v.select(v.scene.byId.get('camshaft')!)
    v.t = 3
    v.orbit(50, 0)
    const yaw = v.cam.yaw
    v.load(design('a V8 engine')!, 'reloaded')
    expect(v.scene.parts[v.selected]!.part.id).toBe('camshaft')
    expect(v.cam.yaw).toBe(yaw)
    expect(v.t).toBe(3)
    v.load(design('a steam locomotive')!)
    expect(v.selected).toBe(-1)
    expect(v.cam.yaw).not.toBe(yaw)
    expect(v.reloads).toBe(2)
  })

  it('renders a frame with visible machine pixels and picks the part under them', () => {
    const v = new Viewer(design('a planetary gearbox')!, palette)
    const f = v.frame(400, 300)!
    let lit = 0
    for (let i = 0; i < f.rgba.length; i += 4) if (f.rgba[i]! + f.rgba[i + 1]! + f.rgba[i + 2]! > 120) lit++
    expect(lit).toBeGreaterThan(2000)
    expect(v.pick(200, 150, 400, 300)).toBeGreaterThanOrEqual(0)
    expect(v.frame(400, 300)).toBeNull() // nothing changed while paused → no re-render
  })
})

d('app on the GPU test renderer', () => {
  it('play, explode, inspect a part from the tree, toggle view', async () => {
    const v = new Viewer(design('a V8 engine')!, palette, 'specs/v8.json')
    const { render, renderer } = createTestRoot({ width: 1400, height: 880 })
    render(<App v={v} theme={loadGhosttyTheme()} />)
    await settle(); renderer.flush(); await settle(); renderer.flush()
    const app = await connectTest(renderer)
    const text = async (id: string) => (await app.getByTestId(id).textContent()).trim()
    expect(await text('title')).toBe('V8 engine')
    expect(await text('stats')).toContain('101 parts')

    await app.getByTestId('play').click()
    expect(v.playing).toBe(false)
    await app.getByTestId('faster').click()
    await settle(); renderer.flush()
    expect(await text('speed')).toBe('2×')

    await app.getByTestId('tree-camshaft').click()
    await settle(); renderer.flush()
    expect(v.scene.parts[v.selected]!.part.id).toBe('camshaft')

    await app.getByTestId('view').click()
    expect(v.cam.view).toBe('perspective')

    await app.getByTestId('fx').click()
    expect(v.effects).toBe(false)
  })
})
