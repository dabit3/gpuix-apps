import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { launch } from '@gpuix/react/automation'

const OUT = path.resolve(import.meta.dir, '..', 'test-output')
const live = process.platform === 'darwin' && !process.env.CI ? describe : describe.skip

const yesChildren = (parent: number) =>
  spawnSync('pgrep', ['-P', String(parent), '-x', 'yes'], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean)
    .map(Number)

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until<T>(fn: () => T | undefined | false, timeoutMs = 15_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** Rows exist in the retained tree a frame before GPUI paints them. */
async function painted(locator: { bounds(): Promise<unknown> }, timeoutMs = 10_000) {
  const start = Date.now()
  for (;;) {
    try {
      await locator.bounds()
      return
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

live('System Pulse live app (real window, real processes)', () => {
  it('starts real yes workers, quits one through the dialog, then stops the rest', async () => {
    const app = await launch({
      command: process.execPath,
      args: ['src/main.tsx'],
      cwd: path.resolve(import.meta.dir, '..'),
      env: { ...process.env, GPUIX_BACKGROUND: '1' },
    })
    try {
      await app.getByTestId('stress-button').waitFor({ timeoutMs: 30_000 })
      // Real data: the table fills from `ps`.
      await app.getByTestId('process-row-1').waitFor({ timeoutMs: 15_000 })

      await app.getByTestId('stress-button').click()
      const label = await app.getByTestId('stress-label').textContent()
      const n = Number(label.match(/(\d+) workers/)?.[1])
      expect(n).toBeGreaterThanOrEqual(2)

      const appPid = Number(spawnSync('pgrep', ['-n', '-f', 'src/main.tsx'], { encoding: 'utf8' }).stdout.trim())
      const workers = await until(() => {
        const w = yesChildren(appPid)
        return w.length === n && w
      })

      // The worker shows up in the table (ps refreshes every second) and is tagged.
      const victim = workers[0]!
      await app.getByTestId('search').fill('yes')
      await app.getByTestId(`process-row-${victim}`).waitFor({ timeoutMs: 15_000 })
      await painted(app.getByTestId(`process-row-${victim}`))
      await app.getByTestId(`process-row-${victim}`).click()
      expect(await app.getByTestId('detail-name').textContent()).toBe('yes')
      await new Promise((r) => setTimeout(r, 500)) // panel slide-in animation
      await app.getByTestId('quit-button').click()
      await app.getByTestId('quit-dialog').waitFor()
      await painted(app.getByTestId('confirm-quit'))
      await app.getByTestId('confirm-quit').click()
      await until(() => !alive(victim))
      expect(await app.getByTestId('stress-label').textContent()).toBe(`Stop stress · ${n - 1} workers`)

      fs.mkdirSync(OUT, { recursive: true })
      await app.screenshot({ path: path.join(OUT, 'live.png') })

      await app.getByTestId('stress-button').click()
      await until(() => yesChildren(appPid).length === 0)
      expect(await app.getByTestId('stress-label').textContent()).toBe('Stress test')
    } finally {
      await app.close()
    }
  }, 90_000)
})
