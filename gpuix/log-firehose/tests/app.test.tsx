/**
 * Drives the real app on the GPU test renderer (Metal on macOS): native clicks,
 * native text input, highlight quads and painted <code> text.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { Controller } from '../src/controller'
import { FirehoseApp } from '../src/app'
import { fmt } from '../src/theme'

const SHOTS = path.join(import.meta.dir, '..', 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })
const T0 = Date.UTC(2026, 9, 21, 14, 0, 0)
const settle = () => new Promise((r) => setTimeout(r, 30))
const d = hasNativeTestRenderer ? describe : describe.skip

d('Firehose app', () => {
  it('filters, searches, highlights, inspects and jumps on 200k lines', async () => {
    const ctl = new Controller()
    ctl.gen.fill(ctl.store, 200_000, T0, T0 + 20_000)
    ctl.rebuildView()
    const { render, renderer } = createTestRoot({ width: 1480, height: 920 })
    render(<FirehoseApp ctl={ctl} />)
    await settle()
    renderer.flush()
    const app = await connectTest(renderer)
    const text = async (id: string) => (await app.getByTestId(id).textContent()).trim()

    expect(await text('stat-total')).toBe('200,000')
    expect(await text('follow-state')).toBe('Following tail')

    // Solo ERROR with an option-click: the view shrinks to exactly the error lines.
    await app.getByTestId('level-ERROR').click({ modifiers: 'alt' })
    await settle()
    renderer.flush()
    const errors = ctl.store.levelCounts[4]!
    expect(errors).toBeGreaterThan(1000)
    expect(ctl.view.count).toBe(errors)
    expect(await text('stat-view')).toBe(fmt(errors))

    // Native text input → incremental search → highlight quads on the visible rows.
    await app.getByTestId('search').click()
    await app.getByTestId('search').fill('deadlock')
    await new Promise((r) => setTimeout(r, 150)) // input debounce
    while (ctl.job && !ctl.job.done) ctl.tick(performance.now())
    expect(ctl.job?.re.source).toBe('deadlock')
    await app.getByTestId('only-matches').click()
    await settle()
    ctl.flushNow()
    await settle()
    renderer.flush()
    const expected = ctl.view.count
    expect(expected).toBeGreaterThan(10)
    for (let k = 0; k < expected; k++) {
      const line = ctl.view.lineAt(k)
      expect(ctl.store.level[line]).toBe(4)
      expect(ctl.store.line(line).toLowerCase()).toContain('deadlock')
    }
    expect(await text('stat-matches')).toContain(fmt(expected))
    renderer.flush()
    const hits = renderer.getPaintedHighlights()
    expect(hits.length).toBeGreaterThan(5)
    for (const h of hits) expect(h.text.slice(h.start, h.end).toLowerCase()).toBe('deadlock')
    // every mounted matching row paints its hit (deep payload hits are shown as a snippet)
    const rowsWithHits = new Set(hits.map((h) => h.elementId))
    expect(rowsWithHits.size).toBeGreaterThanOrEqual(Math.min(expected, 20))
    renderer.captureScreenshot(path.join(SHOTS, 'search-only-matches.png'))

    // Next match moves the find cursor; Cmd-G style navigation reports a rank.
    await app.getByTestId('next-match').click()
    await settle()
    renderer.flush()
    expect(await text('match-count')).toMatch(new RegExp(`^1 of ${fmt(expected)}$`))

    // Click the row the cursor revealed: the inspector shows its JSON payload and stack trace.
    const first = ctl.view.lineAt(0)
    await app.getByTestId(`row-${first}`).click()
    await settle()
    renderer.flush()
    await app.getByTestId('inspector').waitFor()
    const painted = renderer.getPaintedText().join('\n')
    expect(painted).toContain('"trace_id"')
    expect(painted).toContain('"code": "40P01"')
    expect(renderer.getAllText().join('\n')).toContain('PostgresError: deadlock detected')
    renderer.captureScreenshot(path.join(SHOTS, 'inspector.png'))

    // Jump to a clock time selects the first line at or after it.
    await app.getByTestId('reset-filters').click()
    await app.getByTestId('only-matches').click()
    await app.getByTestId('jump').click()
    await app.getByTestId('jump').fill('14:00:12')
    await app.getByTestId('jump').press('enter')
    await settle()
    renderer.flush()
    const target = ctl.lineAtClock(12 * 1000 + 14 * 3600_000)
    expect(ctl.store.ts[target]!).toBeGreaterThanOrEqual(T0 + 12_000)
    expect(renderer.getAllText().join('\n')).toContain(`Line ${fmt(target + 1)}`)
    expect(await text('follow-state')).not.toBe('Following tail')
  }, 60_000)

  it('keeps the frame cheap while 50k lines/s stream in', async () => {
    const ctl = new Controller()
    ctl.gen.fill(ctl.store, 300_000, T0, T0 + 6_000)
    ctl.rebuildView()
    const { render, renderer } = createTestRoot({ width: 1480, height: 920 })
    render(<FirehoseApp ctl={ctl} />)
    await settle()
    renderer.flush()
    const times: number[] = []
    for (let f = 0; f < 90; f++) {
      ctl.ingestLive(833, T0 + 6_000 + f * 17) // one 60 Hz frame of 50k lines/s
      ctl.flushNow()
      await new Promise((r) => setTimeout(r, 0))
      const t = performance.now()
      renderer.flush()
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    const p50 = times[45]!
    console.log(`streaming frame (native flush) p50 ${p50.toFixed(2)} ms, p90 ${times[81]!.toFixed(2)} ms`)
    expect(ctl.store.count).toBe(300_000 + 90 * 833)
    // The newest line is on screen: tail-follow kept up.
    const newest = ctl.store.count - 1
    expect(renderer.findByTestId(`row-${newest}`)).not.toBeNull()
    expect(p50).toBeLessThan(25)
  }, 60_000)
})
