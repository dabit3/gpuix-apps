import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, keyHandlers } from '../src/app'
import { Controller } from '../src/controller'
import { STEP_HZ } from '../src/sim/constants'
import { FIELD_X, FIELD_Y, WIN_H, WIN_W } from '../src/ui/theme'

const describeNative = hasNativeTestRenderer ? describe : describe.skip
let dir = ''

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'neon-breakout-'))
  process.env.NEON_BREAKOUT_SCORES = join(dir, 'scores.json')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describeNative('Neon Breakout in the GPU test renderer', () => {
  test('plays a level, pauses, and saves a high score through native input', async () => {
    const c = new Controller({ seed: 11, muted: true })
    const { render, renderer } = createTestRoot({ width: WIN_W, height: WIN_H, ...keyHandlers(c) })
    const draw = () => render(<App controller={c} autoTick={false} />)
    draw()
    const app = await connectTest(renderer)
    const text = () => renderer.getAllText().join('\n')

    expect(c.mode).toBe('title')
    expect(text()).toContain('BREAKOUT')

    // Title -> play through a native click on the Play button.
    await app.getByTestId('play-button').click()
    draw()
    expect(c.mode).toBe('playing')
    expect(text()).toContain('Neon Grid')
    expect(text()).toContain('Click or press Space to launch')

    // The mouse drives the paddle through the pointer pad.
    renderer.nativeSimulateMouseMove(FIELD_X + 200, FIELD_Y + 500)
    c.runSteps(STEP_HZ / 2)
    expect(c.game.paddleX).toBeCloseTo(200, 0)

    // A native click launches the ball.
    expect(c.game.balls[0]!.stuck).toBe(true)
    renderer.nativeSimulateClick(FIELD_X + 200, FIELD_Y + 500)
    expect(c.game.input.launch).toBe(true)
    c.runSteps(1)
    expect(c.game.balls[0]!.stuck).toBe(false)
    expect(c.game.phase).toBe('play')

    // 25 s of 120 Hz sim under the attract pilot: bricks break and the HUD score climbs.
    c.autopilot = true
    const bricksBefore = c.game.remaining
    c.runSteps(25 * STEP_HZ)
    c.autopilot = false
    draw()
    expect(c.game.remaining).toBeLessThan(bricksBefore)
    expect(c.game.bricksBroken).toBeGreaterThan(5)
    expect(c.game.score).toBeGreaterThan(300)
    expect(text()).toContain(c.game.score.toLocaleString('en-US'))

    const shot = join(dir, 'play.png')
    renderer.captureScreenshot(shot)
    expect(statSync(shot).size).toBeGreaterThan(20_000)

    // F toggles the perf HUD, Esc pauses, the Resume button resumes.
    renderer.simulateKeystrokes('f')
    draw()
    expect(text()).toContain('PERF · PARAVIRTUAL METAL')
    renderer.simulateKeystrokes('escape')
    draw()
    expect(c.mode).toBe('paused')
    expect(text()).toContain('Paused')
    const frozen = c.game.steps
    c.advance(1)
    expect(c.game.steps).toBe(frozen)
    await app.getByTestId('resume-button').click()
    draw()
    expect(c.mode).toBe('playing')

    // Lose the last ball with a record score: game over asks for initials.
    c.game.score = 99_999
    c.game.lives = 1
    for (const b of c.game.balls) { b.stuck = false; b.y = 2000; b.vy = 500 }
    c.runSteps(3 * STEP_HZ)
    draw()
    expect(c.mode).toBe('gameover')
    expect(text()).toContain('New high score!')

    await app.getByTestId('initials-input').fill('nb7')
    draw()
    await app.getByTestId('save-score').click()
    draw()
    expect(text()).toContain('Saved NB7 at #1')
    expect(text()).toContain('99,999')

    // Persisted: a fresh controller reads the table back from disk.
    const file = process.env.NEON_BREAKOUT_SCORES!
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))[0]).toMatchObject({ initials: 'NB7', score: 99_999 })
    expect(new Controller({ muted: true }).scores[0]!.initials).toBe('NB7')

    await app.close()
  }, 60_000)
})
