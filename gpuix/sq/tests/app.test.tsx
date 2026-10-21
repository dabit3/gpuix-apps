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
})
