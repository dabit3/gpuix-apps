import { afterAll, describe, expect, it } from 'bun:test'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { connectTest } from '@gpuix/react/automation'
import { App, handleKey } from '../src/app'
import { Store } from '../src/store'
import { cleanup, fixture, RUN } from './helpers'

afterAll(cleanup)
const d = hasNativeTestRenderer ? describe : describe.skip

async function until(check: () => boolean, label: string, ms = 8000) {
  const t = Date.now()
  while (!check()) { if (Date.now() - t > ms) throw new Error(`timed out: ${label}`); await Bun.sleep(20) }
}

d('dashboard', () => {
  it('writes the setup, replays a dry run and shows verdicts (wide)', { timeout: 40000 }, async () => {
    const store = new Store({ root: fixture(), engine: 'replay', replay: RUN, replayMs: 0 })
    const { render, renderer } = createTestRoot({ width: 1440, height: 900 })
    render(<App store={store} size={{ width: 1440, height: 900 }} />)
    const app = await connectTest(renderer)
    try {
      const text = () => { renderer.flush(); return renderer.getAllText().join('\n') }
      expect(text()).toContain('8 to write')
      expect(text()).toContain('setup not written')
      await app.getByTestId('btn-write').click()
      await until(() => text().includes('in sync'), 'setup written')
      expect(text()).toContain('model: haiku')
      expect(text()).toContain('no Edit / Write / unscoped Bash')
      await app.getByTestId('file-.claude/agents/advisor.md').click()
      expect(store.selected).toBe(1)
      await app.getByTestId('btn-run').click()
      await until(() => store.run.status !== 'idle', 'replay started', 5000)
      await until(() => store.run.status === 'done', 'replay done', 20000)
      await until(() => text().includes('diff reviewed'), 'verdicts painted')
      const t = text()
      expect(t).toContain('advisor · CP1')
      expect(t).toContain('advisor · CP3')
      expect(t).toContain('REVISE')
      expect(t).toContain('plan reviewed')
      expect(t).toContain('diff reviewed')
      expect(store.checks().every((c) => c.ok === true)).toBe(true)
    } finally {
      store.dispose()
      await app.close()
    }
  })

  it('reflows to tabs in a split pane and switches with keys', { timeout: 20000 }, async () => {
    const store = new Store({ root: fixture(), engine: 'replay', replay: RUN, replayMs: 0 })
    const { render, renderer } = createTestRoot({ width: 700, height: 860 })
    render(<App store={store} size={{ width: 700, height: 860 }} />)
    const app = await connectTest(renderer)
    try {
      const text = () => { renderer.flush(); return renderer.getAllText().join('\n') }
      expect(text()).toContain('Setup')
      expect(text()).not.toContain('ADVISOR VERDICTS')
      expect(handleKey(store, { key: 'space', keyChar: '3' })).toBe(true)
      expect(store.view).toBe('review')
      await until(() => text().includes('Plan review'), 'review tab')
      await app.getByTestId('tab-run').click()
      expect(store.view).toBe('run')
      await until(() => text().includes('No dry run yet'), 'run tab')
      handleKey(store, { key: 'w' })
      expect(store.written).toBe(true)
    } finally {
      store.dispose()
      await app.close()
    }
  })
})
