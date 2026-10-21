import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { flushSync } from '@gpuix/react'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { SystemPulseApp, sortProcesses } from './app.tsx'
import { createFakeSource } from './fake-source.ts'

const OUT = path.resolve(import.meta.dir, '..', 'test-output')
const describeNative = hasNativeTestRenderer ? describe : describe.skip

describe('sortProcesses', () => {
  const procs = [
    { pid: 3, ppid: 1, cpu: 5, rss: 300, user: 'b', name: 'zsh' },
    { pid: 1, ppid: 0, cpu: 50, rss: 100, user: 'a', name: 'Arc' },
    { pid: 2, ppid: 1, cpu: 0.5, rss: 200, user: 'c', name: 'bun' },
  ]
  it('sorts by number and by name, both directions', () => {
    expect(sortProcesses(procs, 'cpu', true).map((p) => p.pid)).toEqual([1, 3, 2])
    expect(sortProcesses(procs, 'rss', false).map((p) => p.pid)).toEqual([1, 2, 3])
    expect(sortProcesses(procs, 'name', false).map((p) => p.name)).toEqual(['Arc', 'bun', 'zsh'])
  })
})

describeNative('System Pulse window (GPU test renderer)', () => {
  it('sorts, filters, stresses, and quits a stress worker through the dialog', async () => {
    const source = createFakeSource(8)
    const root = createTestRoot({ width: 1240, height: 860 })
    root.render(<SystemPulseApp source={source} fps={0} />)
    flushSync(() => source.tick(4))
    root.renderer.flush()
    const app = await connectTest(root.renderer)
    const settle = async () => {
      // Let the detail panel's native width animation finish before clicking inside it.
      await new Promise((r) => setTimeout(r, 450))
      root.renderer.flush()
    }
    const order = (...names: string[]) => {
      const text = root.renderer.getAllText()
      return names.map((n) => text.indexOf(n))
    }

    // Live numbers from the source reach the window.
    expect(await app.getByTestId('process-count').textContent()).toBe('6')
    expect(await app.getByTestId('load').textContent()).toBe('2.41 · 1.98 · 1.77')
    expect(await app.getByTestId('memory-used').textContent()).toBe('9.4 GB')

    // Default sort is % CPU descending; clicking "Process" sorts by name.
    let [ws, xcode, finder] = order('WindowServer', 'Xcode', 'Finder')
    expect(ws).toBeLessThan(xcode!)
    expect(xcode).toBeLessThan(finder!)
    await app.getByTestId('sort-name').click()
    ;[ws, xcode, finder] = order('WindowServer', 'Xcode', 'Finder')
    expect(finder).toBeLessThan(ws!)
    expect(ws).toBeLessThan(xcode!)
    await app.getByTestId('sort-name').click()
    ;[ws, xcode, finder] = order('WindowServer', 'Xcode', 'Finder')
    expect(xcode).toBeLessThan(ws!)

    // Keyboard: Tab leaves the search field, and Enter on a focused header sorts.
    const r = root.renderer as unknown as { getFocusedElementId(): number | null }
    await app.getByTestId('search').click()
    const searchFocus = r.getFocusedElementId()
    await app.getByTestId('search').press('tab')
    root.renderer.flush()
    expect(r.getFocusedElementId()).not.toBe(searchFocus)
    expect(r.getFocusedElementId()).not.toBeNull()
    const before = order('WindowServer', 'Xcode', 'Finder').join()
    await app.getByTestId('sort-name').press('enter')
    root.renderer.flush()
    expect(order('WindowServer', 'Xcode', 'Finder').join()).not.toBe(before)
    await app.getByTestId('sort-cpu').click()

    // Search filters the table.
    await app.getByTestId('search').fill('safari')
    expect(await app.getByTestId('process-count').textContent()).toBe('1 of 6')
    expect(root.renderer.getAllText()).not.toContain('Xcode')
    await app.getByTestId('search').fill('')
    expect(await app.getByTestId('process-count').textContent()).toBe('6')

    // Stress test: 4 workers appear, pin 4 of 8 cores, and the CPU total jumps.
    const idleCpu = await app.getByTestId('cpu-total').textContent()
    await app.getByTestId('stress-button').click()
    expect(await app.getByTestId('stress-label').textContent()).toBe('Stop stress · 4 workers')
    flushSync(() => source.tick(2))
    await app.getByTestId('process-row-9000').waitFor()
    expect(await app.getByTestId('core-0').textContent()).toBe('98')
    expect(await app.getByTestId('core-7').textContent()).not.toBe('98')
    expect(Number.parseInt(await app.getByTestId('cpu-total').textContent())).toBeGreaterThan(Number.parseInt(idleCpu) + 30)

    // Chart hover shows a value tooltip.
    await app.getByTestId('chart-cpu').hover()
    root.renderer.flush()
    await app.getByTestId('chart-cpu-tooltip').waitFor()

    // A process System Pulse didn't start can be inspected but not quit.
    await app.getByTestId('process-row-189').click()
    expect(await app.getByTestId('detail-name').textContent()).toBe('WindowServer')
    expect(await app.getByTestId('quit-disabled').count()).toBe(1)
    expect(await app.getByTestId('quit-button').count()).toBe(0)

    // Select a worker → detail panel → Quit → confirm.
    await app.getByTestId('process-row-9000').click()
    expect(await app.getByTestId('detail-name').textContent()).toBe('yes')
    await settle()
    await app.getByTestId('quit-button').click()
    root.renderer.flush()
    await app.getByTestId('quit-dialog').waitFor()
    expect(root.renderer.getAllText().join(' ')).toContain('Quit “yes”?')
    await app.getByTestId('confirm-quit').click()
    for (let i = 0; i < 20 && source.killed.length === 0; i++) await new Promise((r) => setTimeout(r, 20))
    expect(source.killed).toEqual([9000])
    flushSync(() => source.tick(2))
    root.renderer.flush()
    expect(await app.getByTestId('process-row-9000').count()).toBe(0)
    expect(await app.getByTestId('quit-dialog').count()).toBe(0)
    expect(await app.getByTestId('stress-label').textContent()).toBe('Stop stress · 3 workers')

    // Stop the rest.
    await app.getByTestId('stress-button').click()
    expect(await app.getByTestId('stress-label').textContent()).toBe('Stress test')

    fs.mkdirSync(OUT, { recursive: true })
    const shot = path.join(OUT, 'app.png')
    root.renderer.captureScreenshot(shot)
    expect(fs.statSync(shot).size).toBeGreaterThan(20_000)
    await app.close()
  })
})
