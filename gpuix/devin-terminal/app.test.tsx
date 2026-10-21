import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { DevinApp } from './src/App'

const SHOTS = path.join(import.meta.dir, 'test-screenshots')
fs.mkdirSync(SHOTS, { recursive: true })
const describeNative = hasNativeTestRenderer ? describe : describe.skip
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForText(app: Awaited<ReturnType<typeof connectTest>>, testId: string, expected: string, timeoutMs = 15_000) {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < timeoutMs) {
    last = (await app.getByTestId(testId).textContent()) ?? ''
    if (last.includes(expected)) return last
    await sleep(100)
  }
  throw new Error(`${testId} never contained "${expected}" (last: "${last}")`)
}

describeNative('devin-terminal', () => {
  it('switches sessions, changes agent mode, and streams a new session to a finished PR', async () => {
    const { render, renderer } = createTestRoot({ width: 1440, height: 900 })
    render(<DevinApp speed={4} />)
    const app = await connectTest(renderer)

    expect(await app.getByTestId('session-title').textContent()).toBe('Move API rate limiting to Redis')
    expect(await app.getByTestId('session-count').textContent()).toBe('13 sessions · 1 running')

    await app.getByTestId('session-s-index').click()
    expect(await app.getByTestId('session-title').textContent()).toBe('Slow billing dashboard query')
    expect(await app.getByTestId('session-status').textContent()).toBe('Awaiting input')

    await app.getByTestId('new-session').click()
    expect(await app.getByTestId('home-title').textContent()).toBe('What should Devin work on?')

    await app.getByTestId('mode-picker').click()
    await app.getByTestId('mode-ultra').click()
    expect(await app.getByTestId('mode-picker-label').textContent()).toBe('Ultra')

    await app.getByTestId('composer').fill('Add dark mode to the settings page')
    await app.getByTestId('send').click()

    expect(await app.getByTestId('session-title').textContent()).toBe('Add dark mode to the settings page')
    expect(await app.getByTestId('session-mode').textContent()).toBe('Ultra')
    await waitForText(app, 'session-count', '14 sessions · 2 running')
    expect(await app.getByTestId('session-status').textContent()).toBe('Working')
    await app.screenshot({ path: path.join(SHOTS, 'running.png') })

    await waitForText(app, 'session-status', 'Finished', 20_000)
    await waitForText(app, 'checks-1301', 'All checks passed (3/3)')
    expect(await app.getByTestId('session-count').textContent()).toBe('14 sessions · 1 running')
    await app.screenshot({ path: path.join(SHOTS, 'finished.png') })

    await app.getByTestId('session-s-index').click()
    renderer.simulateKeystrokes('down')
    await waitForText(app, 'session-title', 'Add haptics to the onboarding flow')
    renderer.simulateKeystrokes('up')
    renderer.simulateKeystrokes('up')
    await waitForText(app, 'session-title', 'Fix flaky checkout e2e test')

    renderer.simulateKeystrokes('cmd-k')
    await sleep(100)
    renderer.simulateKeystrokes('t e r r a f o r m')
    await sleep(200)
    expect(renderer.getAllText().join(' ')).toContain('Upgrade Terraform AWS provider to v6')
    expect(renderer.getAllText().join(' ')).not.toContain('Move API rate limiting to Redis')
    renderer.simulateKeystrokes('escape')
    await sleep(150)
    expect(renderer.getAllText().join(' ')).toContain('Move API rate limiting to Redis')

    await app.getByTestId('search').fill('okta')
    expect(renderer.getAllText().join(' ')).toContain('Add SSO login with Okta')
    expect(renderer.getAllText().join(' ')).not.toContain('Upgrade Terraform AWS provider to v6')
  }, 60_000)
})
