import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { connectTest } from '@gpuix/react/automation'
import { PlotApp } from '../src/app'
import { Plotter } from '../src/plotter'
import { formatValue, stats } from '../src/series'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative('plot window', () => {
  const root = createTestRoot({ width: 1280, height: 760 })
  const saveDir = mkdtempSync(join(tmpdir(), 'plot-'))
  const plotter = new Plotter({ label: 'ping -i 0.2 1.1.1.1' })
  const t0 = 1_700_000_000
  let app: Awaited<ReturnType<typeof connectTest>>

  const pump = () => {
    root.renderer.flush()
    root.renderer.dispatchNativeEvents()
  }
  const settle = async (ms = 320) => {
    const end = performance.now() + ms
    while (performance.now() < end) {
      pump()
      await new Promise((r) => setTimeout(r, 16))
    }
    pump()
  }
  const text = (id: string) => app.getByTestId(id).textContent()

  beforeAll(async () => {
    plotter.ingest('PING 1.1.1.1 (1.1.1.1): 56 data bytes', t0)
    for (let i = 0; i < 150; i++) plotter.ingest(`64 bytes from 1.1.1.1: icmp_seq=${i} ttl=55 time=${(7 + Math.sin(i / 4) + (i === 90 ? 9 : 0)).toFixed(3)} ms`, t0 + i * 0.2)
    root.render(<PlotApp plotter={plotter} saveDir={saveDir} />)
    pump()
    app = await connectTest(root.renderer)
    await settle(300)
  })

  afterAll(() => rmSync(saveDir, { recursive: true, force: true }))

  it('charts the ping times, hides ttl/icmp_seq, and shows live stats', async () => {
    expect(plotter.visibleSeries().map((s) => s.name)).toEqual(['time'])
    const time = plotter.store.get('time')!
    const st = stats(time)!
    expect(await text('series-2-last')).toBe(formatValue(time.ys.at(-1)!, 'ms'))
    expect(await text('stat-time-max')).toBe(formatValue(st.max, 'ms'))
    expect(await text('stat-time-p95')).toBe(formatValue(st.p95, 'ms'))
    expect(await text('status-text')).toBe('LIVE')
  })

  it('hover shows a crosshair readout snapped to a real sample', async () => {
    await app.getByTestId('chart').hover()
    await settle()
    const v = plotter.view()
    const mid = (v.x0 + v.x1) / 2
    const time = plotter.store.get('time')!
    const i = time.xs.findIndex((x) => x >= mid - 0.11)
    const candidates = [i - 1, i, i + 1].filter((k) => k >= 0).map((k) => formatValue(time.ys[k]!, 'ms'))
    expect(candidates).toContain(await text('readout-time'))
  })

  it('drag-to-zoom narrows the window and leaves live mode; the status pill returns', async () => {
    const before = plotter.view()
    await app.getByTestId('chart').dragBy(-300, 0, { steps: 6 })
    await settle()
    const after = plotter.view()
    expect(plotter.follow).toBe(false)
    expect(after.x1 - after.x0).toBeLessThan((before.x1 - before.x0) * 0.5)
    expect(await text('status-text')).toBe('HISTORY')
    // The HISTORY pill jumps back to live (double-click does too, but automation has no click count).
    await app.getByTestId('status').click()
    await settle()
    expect(plotter.follow).toBe(true)
    expect(await text('status-text')).toBe('LIVE')
  })

  it('scrolling pans back through time', async () => {
    const before = plotter.view()
    await app.getByTestId('chart').wheel(0, 120)
    await settle()
    const after = plotter.view()
    expect(after.x1).not.toBe(before.x1)
    expect(after.x1 - after.x0).toBeCloseTo(before.x1 - before.x0, 6)
    root.renderer.simulateKeystrokes('r')
    await settle()
    expect(plotter.follow).toBe(true)
  })

  it('space pauses: new samples buffer but the view stays put', async () => {
    root.renderer.simulateKeystrokes('space')
    await settle()
    expect(await text('status-text')).toBe('PAUSED')
    const frozen = plotter.view()
    plotter.ingest('64 bytes from 1.1.1.1: icmp_seq=150 ttl=55 time=8.000 ms', t0 + 30)
    expect(plotter.view()).toEqual(frozen)
    root.renderer.simulateKeystrokes('space')
    await settle()
    expect(await text('status-text')).toBe('LIVE')
    expect(plotter.view().x1).toBe(t0 + 30)
  })

  it('switches chart style and toggles a series from the legend', async () => {
    await app.getByTestId('mode-bar').click()
    await settle()
    expect(plotter.mode).toBe('bar')
    await app.getByTestId('series-1').click()
    await settle()
    expect(plotter.visibleSeries().map((s) => s.name)).toEqual(['ttl', 'time'])
  })

  it('e exports a PNG of the window', async () => {
    root.renderer.simulateKeystrokes('e')
    await settle(300)
    const files = readdirSync(saveDir).filter((f) => f.endsWith('.png'))
    expect(files.length).toBe(1)
    const png = readFileSync(join(saveDir, files[0]!))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.length).toBeGreaterThan(5000)
    expect(existsSync(plotter.saved!)).toBe(true)
    expect(await text('toast')).toContain('Saved plot-')
  })
})
