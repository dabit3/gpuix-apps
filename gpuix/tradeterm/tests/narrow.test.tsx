import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'tradeterm-narrow-'))
process.env.TRADETERM_HOME = home
process.env.TRADETERM_OFFLINE = '1'

const { createTestRoot, hasNativeTestRenderer } = await import('@gpuix/react/testing')
const { connectTest } = await import('@gpuix/react/automation')
const { App } = await import('../src/app')
const { sampleBars } = await import('../src/data/feed')

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative('tradeterm in a narrow split pane', () => {
  const root = createTestRoot({ width: 640, height: 800 })
  const bars = sampleBars('ETH-USD', '15m', 800)
  let app: Awaited<ReturnType<typeof connectTest>>
  const settle = async (ms = 250) => {
    const end = performance.now() + ms
    while (performance.now() < end) {
      root.renderer.flush()
      root.renderer.dispatchNativeEvents()
      await new Promise((r) => setTimeout(r, 16))
    }
  }

  beforeAll(async () => {
    root.render(<App symbol="ETH-USD" timeframe="15m" offline strategy="sma" preload={{ bars, source: 'sample', note: 'test' }} />)
    root.renderer.flush()
    app = await connectTest(root.renderer)
    await settle(400)
  })
  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it('wraps the header and toolbar so the far-right controls stay clickable', async () => {
    await app.getByTestId('tf-1W').click()
    await settle(300)
    expect(await app.getByTestId('tf').textContent()).toBe('1W')
    await app.getByTestId('tool-fib').click()
    await settle(150)
    expect(await app.getByTestId('tool-hint').textContent()).toContain('Drag to draw')
    await app.getByTestId('sweep').click()
    await settle(300)
    expect(await app.getByTestId('sweep-view').count()).toBe(1)
  })
})
