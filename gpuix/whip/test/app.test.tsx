import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushSync } from '@gpuix/react'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, effectiveLength } from '../src/app'
import { AgentLink } from '../src/link'

const d = hasNativeTestRenderer ? describe : describe.skip

describe('layout math', () => {
  test('whip shortens to fit a split pane', () => {
    expect(effectiveLength(420, 1440, 900)).toBe(420)
    expect(effectiveLength(420, 700, 400)).toBe(248)
    expect(effectiveLength(420, 200, 150)).toBe(120)
  })
})

d('whip app (GPU test renderer)', () => {
  test('first run explains what it does, then shows the disarmed whip', () => {
    const { render, renderer } = createTestRoot()
    const link = new AgentLink(join(mkdtempSync(join(tmpdir(), 'whip-')), 'agents'))
    render(<App persist={false} loop={false} intro link={link} />)
    renderer.flush()
    const text = renderer.getPaintedText().join(' ')
    expect(text).toContain('whip sends keystrokes')
    expect(text).toContain('Esc, one message, Enter')

    const ok = renderer.findByTestId?.('intro-ok') ?? null
    expect(ok).toBeTruthy()
  })

  test('without the intro it shows the controls and the empty leash card', () => {
    const { render, renderer } = createTestRoot()
    const link = new AgentLink(join(mkdtempSync(join(tmpdir(), 'whip-')), 'agents'))
    flushSync(() => render(<App persist={false} loop={false} link={link} />))
    renderer.flush()
    const text = renderer.getPaintedText().join(' ')
    expect(text).toContain('DISARMED')
    expect(text).toContain('polite')
    expect(text).toContain('No agent on a leash')
    expect(text).toContain('whip -- claude')
    expect(text).toContain('INJECTED EVENTS')
    expect(text).toContain('nothing sent')
  })
})
