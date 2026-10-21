/**
 * Drives the real sq UI on the GPUIX GPU test renderer against a generated
 * SQLite file: query editing, autocomplete, sorting, plans, history and a
 * live refresh triggered by a second connection writing to the file.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { SqDb } from '../src/db'
import { DEFAULT_SQL, SqApp } from '../src/app'

const SHOTS = path.join(import.meta.dir, '..', 'screenshots')
fs.mkdirSync(SHOTS, { recursive: true })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-'))
const file = path.join(dir, 'shop.db')
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const d = hasNativeTestRenderer ? describe : describe.skip

beforeAll(() => {
  const r = Bun.spawnSync([process.execPath, path.join(import.meta.dir, '../scripts/make-sample.ts'), file, '20000'])
  expect(r.exitCode).toBe(0)
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

d('sq app', () => {
  it('runs, completes, sorts, explains, keeps history and refreshes live', async () => {
    const db = new SqDb(file)
    const { render, renderer, unmount } = createTestRoot({ width: 1400, height: 900 })
    render(<SqApp db={db} pollMs={30} />)
    await wait()
    renderer.flush()
    const app = await connectTest(renderer)
    const text = async (id: string) => (await app.getByTestId(id).textContent()).trim()
    const flush = async (ms?: number) => { await wait(ms); renderer.flush() }

    // The default query (revenue by country) runs on open.
    const top = db.run(DEFAULT_SQL).rows[0]!
    expect(await text('row-0')).toContain(String(top[0]))
    expect(await text('count-orders')).toBe('20k')

    // Type a query through the native textarea; autocomplete offers the table.
    await app.getByTestId('editor').click()
    await app.getByTestId('editor').fill('SELECT * FROM ord')
    await flush()
    expect(await text('completion-0')).toContain('order')
    await app.getByTestId('editor').fill('SELECT id, customer_id, total FROM orders ORDER BY id DESC LIMIT 50')
    await flush()
    await app.getByTestId('run').click()
    await flush()
    expect(await text('row-0')).toContain('20000')

    // Sorting by a column header reorders the grid without re-running SQL.
    await app.getByTestId('col-id').click()
    await flush()
    expect(await text('row-0')).toContain('19951')

    // Another process writes to the file: sq notices via PRAGMA data_version.
    const other = new Database(file)
    other.run("INSERT INTO orders(customer_id,status,channel,total,items,created_at) VALUES (7,'processing','ios',1299.5,3,'2026-10-21 12:00:00')")
    other.close()
    await flush(200)
    await flush()
    expect(await text('live-text')).toContain('orders +1')
    expect(await text('count-orders')).toBe('20k')
    await app.getByTestId('col-id').click() // back to id DESC order
    await app.getByTestId('col-id').click()
    await flush()
    expect(await text('row-0')).toContain('20001')
    renderer.captureScreenshot(path.join(SHOTS, 'live-refresh.png'))

    // EXPLAIN QUERY PLAN for an indexed lookup.
    await app.getByTestId('editor').fill('SELECT * FROM orders WHERE customer_id = 42')
    await flush()
    await app.getByTestId('explain').click()
    await flush()
    expect(await text('plan')).toContain('USING INDEX idx_orders_customer')

    // History records every run, newest first.
    await app.getByTestId('tab-history').click()
    await flush()
    expect(await text('history-0')).toContain('ORDER BY id DESC LIMIT 50')
    renderer.captureScreenshot(path.join(SHOTS, 'history.png'))
    unmount()
    db.close()
  }, 60_000)
  it('resizes a column from a header-edge drag released over the next header, without sorting', async () => {
    const db = new SqDb(file)
    const { render, renderer, unmount } = createTestRoot({ width: 1400, height: 900 })
    render(<SqApp db={db} pollMs={1000} initialSql="SELECT id, total FROM orders LIMIT 5" />)
    await wait()
    renderer.flush()
    const find = (testId: string): number => {
      const walk = (n: any): number | undefined => {
        if (!n || typeof n !== 'object') return undefined
        if (n.testId === testId && typeof n.id === 'number') return n.id
        for (const v of Object.values(n)) {
          const hit = Array.isArray(v) ? v.map(walk).find((x) => x !== undefined) : typeof v === 'object' ? walk(v) : undefined
          if (hit !== undefined) return hit
        }
        return undefined
      }
      const id = walk(JSON.parse(renderer.getAutomationTree()))
      expect(id).toBeNumber()
      return id!
    }
    const colBefore = renderer.getElementBounds(find('col-id'))!
    const handle = renderer.getElementBounds(find('resize-id'))!
    const target = renderer.getElementBounds(find('col-total'))!
    expect(colBefore.width).toBeGreaterThan(0)
    const x = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2
    // GPUIX terminal mode reports the press, then the release as a click on whatever is
    // under the pointer (no drag moves), so drive the drag exactly that way.
    const end = target.x + target.width / 2
    renderer.nativeSimulateMouseMove(x, y)
    renderer.flush()
    renderer.nativeSimulateMouseDown(x, y, 0)
    renderer.flush()
    renderer.nativeSimulateClick(end, y, 0)
    await wait()
    renderer.flush()
    const colAfter = renderer.getElementBounds(find('col-id'))!
    expect(colAfter.width).toBeGreaterThan(colBefore.width + (end - x) * 0.8)

    // A native-window drag streams moves with the left button (pressedButton 0) held.
    const h2 = renderer.getElementBounds(find('resize-total'))!
    const before2 = renderer.getElementBounds(find('col-total'))!.width
    const hx = h2.x + h2.width / 2
    renderer.nativeSimulateMouseMove(hx, y)
    renderer.flush()
    renderer.nativeSimulateMouseDown(hx, y, 0)
    renderer.flush()
    for (const dx of [15, 30, 45, 60]) {
      renderer.nativeSimulateMouseMove(hx + dx, y, 0)
      await wait(10)
      renderer.flush()
    }
    renderer.nativeSimulateMouseUp(hx + 60, y, 0)
    await wait()
    renderer.flush()
    expect(renderer.getElementBounds(find('col-total'))!.width).toBeGreaterThan(before2 + 45)
    const app = await connectTest(renderer)
    expect(await app.getByTestId('sort-arrow').count()).toBe(0)
    unmount()
    db.close()
  }, 30_000)
})
