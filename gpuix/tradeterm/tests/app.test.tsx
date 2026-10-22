import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'tradeterm-'))
process.env.TRADETERM_HOME = home
process.env.TRADETERM_OFFLINE = '1'

const { createTestRoot, hasNativeTestRenderer } = await import('@gpuix/react/testing')
const { connectTest } = await import('@gpuix/react/automation')
const { App } = await import('../src/app')
const { sampleBars } = await import('../src/data/feed')
const { findStrategy, runBacktest } = await import('../src/backtest')

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative('tradeterm window', () => {
  const root = createTestRoot({ width: 1440, height: 900 })
  const bars = sampleBars('BTC-USD', '1h', 1500)
  let app: Awaited<ReturnType<typeof connectTest>>
  const pump = () => {
    root.renderer.flush()
    root.renderer.dispatchNativeEvents()
  }
  const settle = async (ms = 250) => {
    const end = performance.now() + ms
    while (performance.now() < end) {
      pump()
      await new Promise((r) => setTimeout(r, 16))
    }
    pump()
  }
  const text = (id: string) => app.getByTestId(id).textContent()
  const visible = async () => Number((await text("range")).match(/(\d[\d,]*) bars/)![1]!.replace(/,/g, ''))
  const press = async (k: string) => {
    await app.getByTestId('root').press(k)
    await settle(120)
  }

  beforeAll(async () => {
    root.render(<App symbol="BTC-USD" timeframe="1h" offline strategy="sma" preload={{ bars, source: 'sample', note: 'test' }} />)
    pump()
    app = await connectTest(root.renderer)
    await settle(400)
  })
  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it('shows the symbol, timeframe, sample badge and last price', async () => {
    expect(await text('symbol')).toBe('BTC-USD')
    expect(await text('tf')).toBe('1h')
    expect((await text('source')).toUpperCase()).toContain('SAMPLE')
    expect(await app.getByTestId('pane-main').count()).toBe(1)
  })

  it('backtest metrics match the engine', async () => {
    const r = runBacktest(bars, findStrategy('sma')!, { fast: 20, slow: 50 }, { feeBps: 10, slippageBps: 5, capital: 10_000 })
    expect(await text('m-trades')).toBe(String(r.metrics.trades))
    expect(await text('bt-params')).toContain('fee 10bp')
    expect(await app.getByTestId('trades').count()).toBe(1)
  })

  it('n cycles to the RSI strategy', async () => {
    await press('n')
    expect(await text('bt-params')).toContain('length 14')
    const r = runBacktest(bars, findStrategy('rsi')!, { length: 14, lower: 30, exit: 55 }, { feeBps: 10, slippageBps: 5, capital: 10_000 })
    expect(await text('m-trades')).toBe(String(r.metrics.trades))
    await press('n')
    await press('n')
    expect(await text('bt-params')).toContain('fast 20')
  })

  it('hover draws a crosshair and an OHLC readout', async () => {
    await app.getByTestId('pane-main').hover()
    await settle()
    expect(await app.getByTestId('cross-main').count()).toBe(1)
    expect(await text('ohlc')).toMatch(/O\s*[\d,.]+\s*H\s*[\d,.]+\s*L\s*[\d,.]+\s*C\s*[\d,.]+/)
  })

  it('drag-zooms into the selected range and 0 resets', async () => {
    const before = await visible()
    await app.getByTestId('pane-main').dragBy(-200, 0, { steps: 8 })
    await settle()
    const zoomed = await visible()
    expect(zoomed).toBeLessThan(before)
    expect(zoomed).toBeGreaterThan(5)
    await press('0')
    expect(await visible()).toBe(before)
  })

  it('ctrl-scroll zooms around the pointer', async () => {
    const before = await visible()
    await app.getByTestId('pane-main').wheel(0, 120, { modifiers: 'ctrl' })
    await settle()
    expect(await visible()).not.toBe(before)
    await press('0')
    expect(await visible()).toBe(before)
  })

  it('toggles indicators with keys', async () => {
    expect(await app.getByTestId('pane-rsi').count()).toBe(1)
    await press('r')
    expect(await app.getByTestId('pane-rsi').count()).toBe(0)
    await press('r')
    expect(await app.getByTestId('pane-rsi').count()).toBe(1)
  })

  it('w opens the parameter sweep with an overfitting warning', async () => {
    await press('w')
    await settle(600)
    expect(await app.getByTestId('sweep-view').count()).toBe(1)
    expect(await text('overfit')).toMatch(/overfit/i)
    await press('escape')
    expect(await app.getByTestId('sweep-view').count()).toBe(0)
  })

  it('the Indicators menu toggles panes with checkmarks', async () => {
    expect(await app.getByTestId('pane-stoch').count()).toBe(0)
    await app.getByTestId('menu-ind').click()
    await settle(150)
    expect(await app.getByTestId('menu').count()).toBe(1)
    await app.getByTestId('ind-stoch').click()
    await settle(200)
    expect(await app.getByTestId('pane-stoch').count()).toBe(1)
    await press('escape')
    expect(await app.getByTestId('menu').count()).toBe(0)
    await press('k')
    expect(await app.getByTestId('pane-stoch').count()).toBe(0)
  })

  it('/ opens the command palette and "sol 1d" opens SOL-USD on the daily chart', async () => {
    await press('/')
    expect(await app.getByTestId('palette').count()).toBe(1)
    for (const ch of ['s', 'o', 'l']) await press(ch)
    await press('space')
    for (const ch of ['1', 'd']) await press(ch)
    expect(await text('palette-query')).toBe('sol 1d')
    expect(await app.getByTestId('cmd-go-SOL-USD-1D').count()).toBe(1)
    await press('enter')
    await settle(500)
    expect(await app.getByTestId('palette').count()).toBe(0)
    expect(await text('symbol')).toBe('SOL-USD')
    expect(await text('tf')).toBe('1D')
  })

  it('palette searches actions too: "sweep" opens the sweep sheet', async () => {
    await press('/')
    for (const ch of 'sweep') await press(ch)
    await press('enter')
    await settle(600)
    expect(await app.getByTestId('sweep-view').count()).toBe(1)
    await press('escape')
    expect(await app.getByTestId('sweep-view').count()).toBe(0)
  })

  it('palette switches the data source to Hyperliquid and back', async () => {
    const pick = async () => {
      await press('/')
      for (const ch of 'hl data') await press(ch === ' ' ? 'space' : ch)
      expect(await app.getByTestId('cmd-exchange').count()).toBe(1)
      const title = await app.getByTestId('cmd-exchange').textContent()
      await app.getByTestId('cmd-exchange').click()
      await settle(200)
      expect(await app.getByTestId('palette').count()).toBe(0)
      return title
    }
    expect(await pick()).toContain('Use Hyperliquid data')
    expect(await pick()).toContain('Use Binance data')
    expect(await text('symbol')).toBe('SOL-USD')
  })

  it('switches timeframe with number keys', async () => {
    await press('5')
    await settle(400)
    expect(await text('tf')).toBe('4h')
  })
})
