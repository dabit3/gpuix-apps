import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, keyHandlers } from '../src/app'
import { Controller } from '../src/controller'
import { STEP_HZ } from '../src/sim/game'
import { fallbackTheme } from '../src/theme'
import { computeLayout } from '../src/ui/layout'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
let dir = ''
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'blockfall-')) })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('layout', () => {
  test('a full pane gets two side columns; a half split reflows to one and keeps the board big', () => {
    const full = computeLayout(1413, 840)
    const half = computeLayout(693, 840)
    const thin = computeLayout(420, 840)
    expect(full.kind).toBe('wide')
    expect(half.kind).toBe('narrow')
    expect(half.c).toBeGreaterThanOrEqual(full.c * 0.9)
    expect(thin.c).toBeLessThan(half.c)
    for (const L of [full, half, thin]) {
      expect(L.bx).toBeGreaterThanOrEqual(0)
      expect(L.rightX + L.sideW).toBeLessThanOrEqual(L.w)
      expect(L.by + L.bh).toBeLessThanOrEqual(L.h)
    }
  })
})

describeNative('blockfall in the GPU test renderer', () => {
  test('plays, holds, pauses, tops out and saves a high score through native input', async () => {
    const W = 1100, H = 760
    const scores = join(dir, 'scores.json')
    const c = new Controller({ seed: 21, scoresFile: scores })
    const t = fallbackTheme()
    const { render, renderer } = createTestRoot({ width: W, height: H, ...keyHandlers(c) })
    const draw = () => render(<App controller={c} theme={t} autoTick={false} size={{ width: W, height: H }} />)
    draw()
    const app = await connectTest(renderer)
    const text = () => renderer.getAllText().join('\n')

    expect(c.mode).toBe('title')
    expect(text()).toContain('Falling blocks for your terminal split')
    await app.getByTestId('level-up').click()
    draw()
    expect(text()).toContain('Level 2')
    await app.getByTestId('play-button').click()
    draw()
    expect(c.mode).toBe('playing')
    expect(c.game.level).toBe(2)

    // Keys go through the native key path: left moves, up rotates, c holds, space drops.
    const x0 = c.game.active!.x
    renderer.simulateKeystrokes('left')
    c.runSteps(2)
    expect(c.game.active!.x).toBe(x0 - 1)
    const first = c.game.active!.type
    renderer.simulateKeystrokes('c')
    c.runSteps(1)
    draw()
    expect(c.game.hold).toBe(first)
    expect(c.game.holdUsed).toBe(true)
    const rot = c.game.active!.rot
    renderer.simulateKeystrokes('up')
    c.runSteps(1)
    expect(c.game.active!.rot).not.toBe(rot)
    renderer.simulateKeystrokes('space')
    c.runSteps(1)
    expect(c.game.pieces).toBe(1)
    expect(c.game.score).toBeGreaterThan(0)
    c.game.input.left = c.game.input.right = false

    // Lines clear under the pilot and the HUD shows the new score.
    for (let i = 0; i < 40 * STEP_HZ && c.game.lines < 6; i++) { c.pilot.step(c.game); c.runSteps(1) }
    c.runSteps(STEP_HZ / 2)
    draw()
    expect(c.game.lines).toBeGreaterThanOrEqual(6)
    expect(text()).toContain(c.game.score.toLocaleString('en-US'))
    const shot = join(dir, 'play.png')
    renderer.captureScreenshot(shot)
    expect(statSync(shot).size).toBeGreaterThan(20_000)

    // F toggles the perf HUD; P pauses and the sim freezes; Resume resumes.
    renderer.simulateKeystrokes('f')
    draw()
    expect(text()).toContain('sim steps/s')
    renderer.simulateKeystrokes('p')
    draw()
    expect(c.mode).toBe('paused')
    expect(text()).toContain('Paused')
    const frozen = c.game.steps
    c.advance(1)
    expect(c.game.steps).toBe(frozen)
    await app.getByTestId('resume-button').click()
    draw()
    expect(c.mode).toBe('playing')

    // Hard-drop until the stack tops out, then type initials and save.
    for (let i = 0; i < 400 && c.mode === 'playing'; i++) { renderer.simulateKeystrokes('space'); c.runSteps(STEP_HZ / 2) }
    draw()
    expect(c.mode).toBe('gameover')
    expect(text()).toContain('Game over')
    expect(c.canEnterScore).toBe(true)
    await app.getByTestId('initials-input').fill('nd!x')
    draw()
    await app.getByTestId('save-score').click()
    draw()
    expect(c.savedInitials).toBe('NDX')
    expect(text()).toContain('Saved NDX at #1')
    expect(existsSync(scores)).toBe(true)
    const saved = JSON.parse(readFileSync(scores, 'utf8'))
    expect(saved[0].name).toBe('NDX')
    expect(saved[0].score).toBe(c.game.score)

    // A fresh controller reads the table back from disk.
    const again = new Controller({ seed: 1, scoresFile: scores })
    expect(again.scores[0]!.name).toBe('NDX')
  })

  test('the board reflows when the pane narrows like a Ghostty split', () => {
    const c = new Controller({ seed: 4, scoresFile: join(dir, 's2.json') })
    c.start()
    const t = fallbackTheme()
    const { render, renderer } = createTestRoot({ width: 1413, height: 840 })
    render(<App controller={c} theme={t} autoTick={false} size={{ width: 1413, height: 840 }} />)
    expect(renderer.getAllText().join('\n')).toContain('PIECES / SEC')
    render(<App controller={c} theme={t} autoTick={false} size={{ width: 693, height: 840 }} />)
    const narrow = renderer.getAllText().join('\n')
    expect(narrow).not.toContain('PIECES / SEC')
    expect(narrow).toContain('NEXT')
    expect(narrow).toContain('HOLD')
  })
})
