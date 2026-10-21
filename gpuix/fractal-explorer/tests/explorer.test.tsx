import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { connectTest } from '@gpuix/react/automation'
import { FractalApp, iterToT, tToIter } from '../src/app'
import { BOOKMARKS, homeFor, zoomPath } from '../src/camera'
import { Explorer } from '../src/engine'
import { LUT_SIZE, PALETTES, buildLut, renderTile } from '../src/fractal'
import { encodePng } from '../src/png'
import { tiles } from '../src/pool'

describe('fractal math', () => {
  it('colours the interior flat and the exterior from the palette', () => {
    const lut = buildLut(PALETTES[0]!)
    expect(lut.length).toBe(LUT_SIZE)
    const out = new Uint32Array(2)
    // Pixel 0 sits at c = 0 (inside the main cardioid), pixel 1 at c = 2 (escapes at once).
    renderTile(
      { kind: 'mandelbrot', width: 2, height: 1, x0: 0, y0: 0, x1: 2, y1: 1, originRe: 0, originIm: 0, pixelSize: 2, maxIter: 200, juliaRe: 0, juliaIm: 0, density: 0.4 },
      out,
      lut,
      0xff000000,
    )
    expect(out[0]).toBe(0xff000000)
    expect(out[1]).not.toBe(0xff000000)
  })

  it('tiles cover every pixel exactly once, centre first', () => {
    const ts = tiles(300, 200, 64, 64)
    const hit = new Uint8Array(300 * 200)
    for (const t of ts) for (let y = t.y0; y < t.y1; y++) for (let x = t.x0; x < t.x1; x++) hit[y * 300 + x]!++
    expect(hit.every((v) => v === 1)).toBe(true)
    const first = ts[0]!
    expect(first.x0 <= 150 && first.x1 >= 150 - 64).toBe(true)
  })

  it('camera flights stay finite between the 10¹² abyss and home', () => {
    const abyss = BOOKMARKS.find((b) => b.id === 'abyss')!.cam
    const home = homeFor(1140, 860)
    for (const [a, b] of [[home, abyss], [abyss, home]] as const) {
      const path = zoomPath(a, b)
      expect(path.duration).toBeGreaterThan(1)
      for (let i = 0; i <= 100; i++) {
        const c = path(i / 100)
        expect(Number.isFinite(c.re) && Number.isFinite(c.im) && c.w > 0).toBe(true)
      }
      expect(path(1)).toEqual(b)
      const end = path(0.999)
      expect(end.w / b.w).toBeGreaterThan(0.9)
      expect(end.w / b.w).toBeLessThan(1.1)
      expect(Math.abs(end.re - b.re)).toBeLessThan(b.w)
      expect(Math.abs(end.im - b.im)).toBeLessThan(b.w)
    }
  })

  it('maps the iteration slider on a log scale', () => {
    expect(tToIter(0)).toBe(50)
    expect(tToIter(1)).toBe(10000)
    expect(tToIter(iterToT(600))).toBe(600)
  })

  it('encodes a valid PNG', () => {
    const png = encodePng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4)
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })
})

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative('fractal explorer window', () => {
  const W = 1300
  const H = 820
  const saveDir = mkdtempSync(join(tmpdir(), 'fractal-'))
  const explorer = new Explorer()
  const root = createTestRoot({ width: W, height: H })
  let app: Awaited<ReturnType<typeof connectTest>>

  const pump = () => {
    root.renderer.flush()
    root.renderer.dispatchNativeEvents()
  }
  const text = (id: string) => app.getByTestId(id).textContent()
  const settle = async () => {
    const start = performance.now()
    while (!explorer.isIdle()) {
      if (performance.now() - start > 20000) {
        const e = explorer as unknown as Record<string, unknown>
        throw new Error(`explorer did not settle: ${JSON.stringify({ W: e.W, H: e.H, running: e.running, dirty: e.dirty, anim: explorer.isAnimating(), complete: e.bufComplete })}`)
      }
      pump()
      await new Promise((r) => setTimeout(r, 15))
    }
    await new Promise((r) => setTimeout(r, 120))
    pump()
  }

  beforeAll(async () => {
    root.render(<FractalApp explorer={explorer} saveDir={saveDir} />)
    pump()
    app = await connectTest(root.renderer)
    await settle()
  })

  afterAll(() => {
    explorer.dispose()
    rmSync(saveDir, { recursive: true, force: true })
  })

  it('opens on the full set, rendered across worker threads', async () => {
    const home = homeFor(explorer.W, explorer.H)
    expect(explorer.W).toBe(W - 300)
    expect(explorer.cam).toEqual(home)
    expect(await text('readout-zoom')).toBe('1.00×')
    expect(await text('hud-phase')).toBe('Sharp')
    expect(explorer.stats().renderMs).toBeGreaterThan(0)
  })

  it('flies to a bookmark and lands exactly on it', async () => {
    const mini = BOOKMARKS.find((b) => b.id === 'minibrot')!
    await app.getByTestId('bookmark-minibrot').click()
    pump()
    expect(explorer.isAnimating()).toBe(true)
    await settle()
    expect(explorer.cam).toEqual(mini.cam)
    expect(await text('readout-re')).toContain('-1.75488')
    expect(await text('readout-zoom')).toBe('80.0×')
    expect(await text('iter-value')).toBe(String(mini.maxIter))
  })

  it('drag pans by exactly the dragged pixels', async () => {
    const before = { ...explorer.cam }
    const ps = before.w / explorer.W
    await app.getByTestId('view').dragBy(120, -40, { steps: 8 })
    await settle()
    expect(explorer.cam.re).toBeCloseTo(before.re - 120 * ps, 12)
    expect(explorer.cam.im).toBeCloseTo(before.im - 40 * ps, 12)
    expect(explorer.cam.w).toBe(before.w)
  })

  it('hovering the Mandelbrot sets the Julia c under the pointer', async () => {
    await app.getByTestId('view').hover()
    pump()
    const c = explorer.pixelToComplex(explorer.W / 2, explorer.H / 2)
    expect(explorer.julia.re).toBeCloseTo(c.re, 3)
    expect(explorer.julia.im).toBeCloseTo(c.im, 3)
    await new Promise((r) => setTimeout(r, 150))
    pump()
    expect(await text('readout-c')).toContain(c.re.toFixed(5))
  })

  it('wheel zooms in under the pointer', async () => {
    const before = explorer.cam.w
    await app.getByTestId('view').wheel(0, 120)
    await settle()
    expect(explorer.cam.w).toBeLessThan(before / 1.5)
  })

  it('keyboard: + zooms, R resets home', async () => {
    const before = explorer.cam.w
    await app.getByTestId('app').press('=')
    await settle()
    expect(explorer.cam.w).toBeCloseTo(before / 2, 12)
    await app.getByTestId('app').press('r')
    await settle()
    expect(explorer.cam).toEqual(homeFor(explorer.W, explorer.H))
    expect(await text('readout-zoom')).toBe('1.00×')
  })

  it('switches palette from the Select', async () => {
    const shotA = join(saveDir, 'a.png')
    const shotB = join(saveDir, 'b.png')
    root.renderer.captureScreenshot(shotA)
    await app.getByTestId('palette-trigger').click()
    pump()
    await app.getByTestId('palette-ember').click()
    await settle()
    expect(explorer.palette).toBe('ember')
    root.renderer.captureScreenshot(shotB)
    expect(readFileSync(shotA).equals(readFileSync(shotB))).toBe(false)
  })

  it('S saves a PNG of the current view', async () => {
    await app.getByTestId('app').press('s')
    for (let i = 0; i < 200 && !readdirSync(saveDir).some((f) => f.startsWith('Fractal')); i++) {
      await new Promise((r) => setTimeout(r, 20))
    }
    const file = readdirSync(saveDir).find((f) => f.startsWith('Fractal'))
    expect(file).toBeDefined()
    const png = readFileSync(join(saveDir, file!))
    expect(png.readUInt32BE(16)).toBe(explorer.W)
    expect(png.readUInt32BE(20)).toBe(explorer.H)
    await new Promise((r) => setTimeout(r, 50))
    pump()
    expect(await text('toast')).toContain('Saved Fractal')
    expect(existsSync(join(saveDir, file!))).toBe(true)
  })
})
