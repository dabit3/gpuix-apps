import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, handleKey, keyHandlers, keyName, uiState, visibleRows } from '../src/app'
import { Controller } from '../src/controller'
import { AD_DOMAINS } from '../src/corpus'
import { HashedBlocklist, Matcher } from '../src/dns/blocklist'
import { fallbackTheme } from '../src/theme'
import { layout } from '../src/ui/format'
import { ask, fakeUpstream } from './helpers'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
let up: Awaited<ReturnType<typeof fakeUpstream>>
let c: Controller
beforeAll(async () => {
  up = await fakeUpstream()
  c = new Controller({ port: 0, upstreams: [up.addr], matcher: new Matcher(HashedBlocklist.fromDomains(AD_DOMAINS)) })
  await c.start()
})
afterAll(() => { c.stop(); up.close() })

describe('layout and keys', () => {
  test('full pane is wide; a split pane is narrow; a thin pane is tiny', () => {
    expect(layout(1426, 880).kind).toBe('wide')
    expect(layout(700, 880).kind).toBe('narrow')
    expect(layout(420, 880).kind).toBe('tiny')
    expect(layout(700, 880).showSide).toBe(false)
  })
  test('terminal key events with the letter in keyChar', () => {
    expect(keyName({ key: 'space', keyChar: 'b' })).toBe('b')
    expect(keyName({ key: 'space', keyChar: ' ' })).toBe('space')
    expect(keyName({ key: 'Down' })).toBe('down')
  })
  test('keys typed into a field do not trigger shortcuts; Esc leaves the field', () => {
    const c = new Controller({ port: 0, upstreams: [], matcher: new Matcher(HashedBlocklist.fromDomains(AD_DOMAINS)) })
    let blurred = 0
    const ui = { sel: 0, typing: true, field: 'rule' as const, blur: () => { blurred++ } }
    expect(handleKey(c, ui, { key: 'a', keyChar: 'a' }, () => [])).toBe(false)
    expect(handleKey(c, ui, { key: 'p', keyChar: 'p' }, () => [])).toBe(false)
    expect(c.dns.pausedFor).toBe(0)
    expect(handleKey(c, ui, { key: 'escape' }, () => [])).toBe(true)
    expect(ui.typing).toBe(false)
    expect(blurred).toBe(1)
  })
})

describeNative('dashboard in the GPU test renderer', () => {
  test('shows live queries, blocks and allows from the log, pauses, and reflows when split', async () => {
    const t = fallbackTheme()
    let W = 1400
    const H = 880
    const { render, renderer } = createTestRoot({ width: W, height: H, ...keyHandlers(c) })
    const draw = () => render(<App controller={c} theme={t} size={{ width: W, height: H }} tickMs={0} />)
    draw()
    const app = await connectTest(renderer)
    const text = () => renderer.getAllText().join('\n')
    expect(text()).toContain('Waiting for queries')
    expect(text()).toContain('ESP32-C3 DNS blocker design, emulated on macOS')

    await ask(c.dns.port, 'doubleclick.net')
    await ask(c.dns.port, 'github.com')
    await ask(c.dns.port, 'github.com')
    draw()
    expect(text()).toContain('doubleclick.net')
    expect(text()).toContain('FORWARDED')
    expect(text()).toContain('CACHED')
    expect(text()).toContain('33%')
    expect(visibleRows(c)[0]!.name).toBe('github.com')

    // Select the github.com row (newest first) with the mouse and block it from the row action.
    await app.getByTestId('log-row-1').click()
    draw()
    await app.getByTestId('row-block').click()
    draw()
    expect(c.dns.matcher.deny.has('github.com')).toBe(true)
    expect(text()).toContain('Blocking github.com')
    await ask(c.dns.port, 'github.com')
    draw()
    expect(c.dns.stats.recent[0]!.status).toBe('blocked')

    // Keyboard: select the blocked doubleclick row and allow it with "a" (as terminal mode reports it).
    const dc = visibleRows(c).find((e) => e.name === 'doubleclick.net')!
    uiState.seq = dc.seq
    expect(handleKey(c, uiState, { key: 'space', keyChar: 'a' }, () => visibleRows(c))).toBe(true)
    expect(c.dns.matcher.allow.has('doubleclick.net')).toBe(true)
    draw()
    expect(text()).toContain('ALLOW')

    // Pause 5 minutes from the header, then resume with "p".
    await app.getByTestId('pause-5').click()
    draw()
    expect(c.dns.pausedFor).toBeGreaterThan(4 * 60_000)
    expect(text()).toContain('PAUSED 5:00')
    renderer.simulateKeystrokes('p')
    draw()
    expect(c.dns.blocking).toBe(true)
    expect(text()).toContain('BLOCKING')

    // Rules editor: type a domain and block it.
    await app.getByTestId('rule-input').fill('ads.example.org')
    draw()
    await app.getByTestId('rule-deny').click()
    draw()
    expect(c.dns.matcher.deny.has('ads.example.org')).toBe(true)
    await app.getByTestId('unrule-ads.example.org').click()
    draw()
    expect(c.dns.matcher.deny.has('ads.example.org')).toBe(false)

    // Split: half width drops the side column for tabs.
    W = 700
    draw()
    expect(text()).toContain('1 Live')
    expect(renderer.findByTestId('rules-panel')).toBeUndefined()
    await app.getByTestId('tab-rules').click()
    draw()
    expect(c.tab).toBe('rules')
    expect(renderer.findByTestId('rules-panel')).toBeDefined()
    renderer.simulateKeystrokes('1')
    draw()
    expect(c.tab).toBe('live')
  }, 20_000)
})
