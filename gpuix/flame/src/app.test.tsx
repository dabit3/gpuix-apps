import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { flushSync } from '@gpuix/react'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { FlameApp, type ProfileSource } from './app.tsx'
import { formatTime, layoutLeftHeavy, topFunctions, type Profile } from './profile.ts'
import { loadProfile } from './watch.ts'

const EX = path.resolve(import.meta.dir, '..', 'examples')
const OUT = path.resolve(import.meta.dir, '..', 'test-output')
const describeNative = hasNativeTestRenderer ? describe : describe.skip
mkdirSync(OUT, { recursive: true })

function manualSource(p: Profile) {
  let cur = p
  const subs = new Set<(p: Profile) => void>()
  const src: ProfileSource & { emit(p: Profile): void } = {
    current: () => cur,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    emit(next) {
      cur = next
      for (const s of subs) s(next)
    },
  }
  return src
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describeNative('flame (GPU test renderer)', () => {
  const before = loadProfile(path.join(EX, 'before.cpuprofile'))
  const after = loadProfile(path.join(EX, 'after.cpuprofile'))

  it('hovers, zooms, searches, switches views, and reloads a real Bun profile', async () => {
    const source = manualSource(before)
    const root = createTestRoot({ width: 1320, height: 840 })
    root.render(<FlameApp source={source} />)
    root.renderer.flush()
    const app = await connectTest(root.renderer)
    const r = root.renderer
    const text = (id: string) => app.getByTestId(id).textContent()

    expect(await text('file-name')).toBe('before.cpuprofile')
    expect(await text('meta')).toContain('2,813 samples')
    // The top-functions virtual list is ranked by self time.
    const top = topFunctions(before)[0]!
    expect(before.frames[top.frame]!.name).toBe('addPostingSlow')
    await app.getByTestId('fn-addPostingSlow').waitFor()

    // Hover the heaviest leaf in the flamegraph (root at the bottom).
    const lh = layoutLeftHeavy(before)
    const cell = lh.cells.find((c) => before.frames[c.frame]!.name === 'addPostingSlow')!
    const g = r.getElementBounds(r.findByTestId('graph')!.id)!
    const x = g.x + ((cell.start + (cell.end - cell.start) / 2) / lh.total) * g.width
    const y = g.y + g.height - (cell.depth + 0.5) * 20
    r.nativeSimulateMouseMove(x, y)
    r.flush()
    await app.getByTestId('tooltip-name').waitFor()
    expect(await text('tooltip-name')).toBe('addPostingSlow')
    expect(await text('tooltip-total')).toContain(formatTime(cell.end - cell.start))
    expect(await text('tooltip-self')).toContain(formatTime(cell.self))
    expect(await text('status-name')).toBe('addPostingSlow')

    // Click zooms to the frame, shows the breadcrumb path and opens its source.
    r.nativeSimulateClick(x, y)
    r.flush()
    expect(await text('zoom-span')).toBe(`${formatTime(cell.end - cell.start)} visible`)
    expect(r.getAllText()).toContain('buildSearchIndex')
    expect(await text('source-name')).toBe('addPostingSlow')
    expect(r.getPaintedText().join('\n')).toContain('list.includes(path)')

    // Esc zooms back out.
    await wait(400)
    const rootId = r.findByTestId('root')!.id
    r.focusElement(rootId)
    r.nativeSimulateKeyDown(rootId, 'escape')
    r.flush()
    expect(await text('zoom-span')).toBe(`${formatTime(before.total)} visible`)

    // Search highlights matching frames and reports their share of time.
    await app.getByTestId('search').fill('stem')
    r.flush()
    expect(await text('match-summary')).toMatch(/^\d+\.\d% match “stem” · /)
    await app.getByTestId('search').fill('')

    // Sandwich: starts on the hottest function, a table click retargets it.
    await app.getByTestId('view-sandwich').click()
    expect(await text('sandwich-name')).toBe('addPostingSlow')
    await app.getByTestId('fn-stemWord').click()
    expect(await text('sandwich-name')).toBe('stemWord')
    r.captureScreenshot(path.join(OUT, 'sandwich.png'))

    // Time order lays out the same profile chronologically.
    await app.getByTestId('view-flame').click()
    await app.getByTestId('order-time').click()
    expect(await text('zoom-span')).toBe(`${formatTime(before.total)} visible`)

    // Re-profiling with --fast reloads in place and reports the speed-up.
    flushSync(() => source.emit(after))
    r.flush()
    expect(await text('meta')).toContain('556 samples')
    const toast = await text('toast-text')
    expect(toast).toStartWith(`Reloaded · ${formatTime(before.total)} → ${formatTime(after.total)} (−`)
    r.captureScreenshot(path.join(OUT, 'reloaded.png'))
    root.unmount()
  })

  it('reflows into a narrow split pane', async () => {
    const root = createTestRoot({ width: 720, height: 700 })
    root.render(<FlameApp source={manualSource(before)} />)
    root.renderer.flush()
    expect(root.renderer.findByTestId('graph')).toBeDefined()
    expect(root.renderer.findByTestId('sidebar')).toBeUndefined()
    expect(root.renderer.findByTestId('order-time')).toBeUndefined()
    expect(root.renderer.findByTestId('view-sandwich')).toBeDefined()
    root.unmount()
  })
})
