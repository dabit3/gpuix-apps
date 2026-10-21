// Behaviour tests: drive the real <App> through the GPUIX Metal test renderer with
// native mouse/keyboard simulation and assert on the state it paints.
import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRoot, hasNativeTestRenderer, type TestRoot } from '@gpuix/react/testing'
import { App } from '../src/App'
import { SpatialIndex, deserialize, serialize, stressShapes, toScreen, toWorld, unionRect, zoomAt } from '../src/model'
import { cull } from '../src/board'

const dir = mkdtempSync(join(tmpdir(), 'canvas-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

type Stats = { total: number; painted: number; mode: string; zoom: number }

function mount(savePath?: string) {
  const t: TestRoot = createTestRoot({ width: 1280, height: 800 })
  const stats: { last: Stats } = { last: { total: 0, painted: 0, mode: '', zoom: 1 } }
  t.render(<App savePath={savePath} onStats={(s) => { stats.last = s }} />)
  t.renderer.flush()
  const r = t.renderer
  const app = r.findByTestId('app')!
  const key = (k: string) => { r.nativeSimulateKeystrokes(app.id, k); r.flush() }
  const drag = (x0: number, y0: number, x1: number, y1: number) => {
    r.nativeSimulateMouseDown(x0, y0)
    for (let i = 1; i <= 6; i++) r.nativeSimulateMouseMove(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6, 0)
    r.nativeSimulateMouseUp(x1, y1)
    r.flush()
  }
  const click = (testId: string) => {
    const b = r.getElementBounds(r.findByTestId(testId)!.id)!
    r.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2)
    r.flush()
  }
  const text = () => r.getAllText().join('\n')
  return { t, r, stats, key, drag, click, text }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

describe('model', () => {
  it('zooms under the cursor: the world point under the pointer stays put', () => {
    const cam = { x: -200, y: 140, z: 1 }
    const before = toWorld(cam, 400, 300)
    const next = zoomAt(cam, 2.5, 400, 300)
    const after = toWorld(next, 400, 300)
    expect(next.z).toBe(2.5)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    expect(toScreen(next, after.x, after.y).x).toBeCloseTo(400, 6)
  })

  it('culls the 10k stress field to what the viewport can see', () => {
    const field = stressShapes(10_000)
    const index = new SpatialIndex(field)
    const near = cull(index, { x: 3000, y: -2000, z: 1 }, 1280, 800)
    expect(near.mode).toBe('nodes')
    expect(near.painted).toBeGreaterThan(0)
    expect(near.painted).toBeLessThan(400)
    const b = unionRect(field)!
    const z = Math.min(1280 / b.w, 800 / b.h) * 0.9
    const far = cull(index, { x: b.x + b.w / 2 - 640 / z, y: b.y + b.h / 2 - 400 / z, z }, 1280, 800)
    expect(far.mode).toBe('tiles')
    expect(far.painted).toBe(10_000)
    const empty = cull(index, { x: -90_000, y: -90_000, z: 1 }, 1280, 800)
    expect(empty.painted).toBe(0)
  })

  it('round-trips a board through JSON', () => {
    const shapes = stressShapes(50)
    const b = deserialize(serialize(shapes, { x: 1, y: 2, z: 0.5 }))
    expect(b.shapes).toEqual(shapes)
    expect(b.camera).toEqual({ x: 1, y: 2, z: 0.5 })
    expect(() => deserialize('{"format":"nope"}')).toThrow()
  })
})

describe.skipIf(!hasNativeTestRenderer)('app (native test renderer)', () => {
  it('draws shapes with tools, edits a sticky, connects an arrow, and undoes', () => {
    const { r, stats, key, drag, text } = mount()
    expect(stats.last.total).toBe(0)

    key('r')
    drag(300, 300, 480, 400)
    expect(stats.last.total).toBe(1)
    expect(text()).toContain('1 total · 1 painted')

    key('n')
    r.nativeSimulateClick(760, 350)
    r.flush()
    const ta = r.findByType('textarea')[0]!
    r.nativeSimulateKeystrokes(ta.id, 'S h i p space i t')
    r.flush()
    key('escape')
    expect(stats.last.total).toBe(2)
    expect(r.getPaintedText().join(' ')).toContain('Ship it')

    key('a')
    drag(390, 350, 760, 350)
    expect(stats.last.total).toBe(3)

    key('cmd-z')
    expect(stats.last.total).toBe(2)
    key('cmd-shift-z')
    expect(stats.last.total).toBe(3)
  })

  it('selects, duplicates with cmd-d, and deletes', () => {
    const { r, stats, key, drag } = mount()
    key('o')
    drag(200, 200, 320, 300)
    key('v')
    r.nativeSimulateClick(260, 250)
    r.flush()
    key('cmd-d')
    expect(stats.last.total).toBe(2)
    key('cmd-a')
    key('backspace')
    expect(stats.last.total).toBe(0)
  })

  it('spawns the 10k stress field and culls when zoomed in', async () => {
    const { r, stats, click, text } = mount()
    click('stress')
    await sleep(900)
    r.flush()
    expect(stats.last.total).toBe(10_000)
    expect(text()).toContain('10,000 total')
    expect(stats.last.mode).toBe('tiles')

    for (let i = 0; i < 60 && stats.last.zoom < 0.32; i++) {
      r.nativeSimulateScrollWheel(640, 400, 0, 20, 'cmd')
      r.flush()
    }
    expect(stats.last.zoom).toBeGreaterThan(0.3)
    expect(stats.last.mode).toBe('nodes')
    expect(stats.last.painted).toBeGreaterThan(0)
    expect(stats.last.painted).toBeLessThan(2_000)

    const zoom = stats.last.zoom
    for (let i = 0; i < 10; i++) r.nativeSimulateScrollWheel(640, 400, 30, 0)
    r.flush()
    expect(stats.last.zoom).toBe(zoom)
  })

  it('saves the board to JSON with cmd-s', () => {
    const path = join(dir, 'board.json')
    const { stats, key, drag } = mount(path)
    key('r')
    drag(100, 100, 260, 200)
    key('r')
    drag(400, 100, 560, 200)
    expect(stats.last.total).toBe(2)
    key('cmd-s')
    const deadline = Date.now() + 2000
    while (!existsSync(path) && Date.now() < deadline) Bun.sleepSync(20)
    const b = deserialize(readFileSync(path, 'utf8'))
    expect(b.shapes.length).toBe(2)
    expect(b.shapes.every((s) => s.type === 'rect')).toBe(true)
  })
})
