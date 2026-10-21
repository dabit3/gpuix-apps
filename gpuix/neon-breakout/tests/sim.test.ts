import { describe, expect, test } from 'bun:test'
import { autopilot } from '../src/sim/autopilot'
import * as C from '../src/sim/constants'
import { Game } from '../src/sim/sim'

function run(seed: number, seconds: number) {
  const g = new Game(seed)
  for (let i = 0; i < seconds * C.STEP_HZ && g.phase !== 'gameOver'; i++) {
    autopilot(g)
    g.step()
    g.events = []
  }
  return g
}

describe('fixed-step simulation', () => {
  test('breaks bricks and scores under the autopilot', () => {
    const g = new Game(7)
    const startBricks = g.remaining
    expect(startBricks).toBe(65)
    expect(g.score).toBe(0)
    for (let i = 0; i < 20 * C.STEP_HZ; i++) {
      autopilot(g)
      g.step()
    }
    expect(g.bricksBroken).toBeGreaterThan(10)
    expect(g.remaining).toBeLessThan(startBricks)
    expect(g.score).toBeGreaterThan(500)
    expect(g.steps).toBe(20 * C.STEP_HZ)
  })

  test('is deterministic for a seed', () => {
    const a = run(42, 30)
    const b = run(42, 30)
    expect(a.score).toBe(b.score)
    expect(a.bricksBroken).toBe(b.bricksBroken)
    expect(a.balls.map((x) => [x.x, x.y])).toEqual(b.balls.map((x) => [x.x, x.y]))
    expect(run(43, 30).score).not.toBe(a.score)
  })

  test('the paddle hit point sets the bounce angle', () => {
    const angleAt = (offset: number) => {
      const g = new Game(1)
      g.launch()
      const ball = g.balls[0]!
      ball.x = g.paddleX + offset * (g.paddleW / 2)
      ball.y = C.PADDLE_Y - C.BALL_R - 1
      ball.vx = 0
      ball.vy = g.ballSpeed
      g.step()
      return Math.atan2(ball.vx, -ball.vy)
    }
    expect(angleAt(0)).toBeCloseTo(0, 5)
    expect(angleAt(0.5)).toBeGreaterThan(0.4)
    expect(angleAt(-0.5)).toBeLessThan(-0.4)
    expect(angleAt(1)).toBeCloseTo(C.MAX_BOUNCE_ANGLE, 1)
  })

  test('multi-hit bricks take several hits and steel never breaks', () => {
    const g = new Game(1, 2) // Fortress: armored, tough and steel bricks
    const armored = g.bricks.find((b) => b.kind === 'armored')!
    const steel = g.bricks.find((b) => b.kind === 'steel')!
    g.damageBrick(armored, 0, 0)
    g.damageBrick(armored, 0, 0)
    expect(armored.alive).toBe(true)
    expect(armored.hp).toBe(1)
    g.damageBrick(armored, 0, 0)
    expect(armored.alive).toBe(false)
    for (let i = 0; i < 20; i++) g.damageBrick(steel, 0, 0)
    expect(steel.alive).toBe(true)
  })

  test('combos multiply points until the ball touches the paddle', () => {
    const g = new Game(1)
    const row = g.bricks.slice(0, 4)
    const before = g.score
    for (const b of row) g.damageBrick(b, 0, 0)
    // 50 * (1 + 2 + 3 + 4)
    expect(g.score - before).toBe(500)
    expect(g.combo).toBe(4)
  })

  test('power-ups: multi-ball, wide paddle, laser and slow', () => {
    const g = new Game(3)
    g.launch()
    g.applyPower('multi')
    expect(g.balls.length).toBe(3)

    const normal = g.ballSpeed
    g.applyPower('slow')
    expect(g.ballSpeed).toBeCloseTo(normal * C.SLOW_FACTOR, 5)

    g.applyPower('wide')
    for (let i = 0; i < C.STEP_HZ; i++) g.step()
    expect(g.paddleW).toBeGreaterThan(C.PADDLE_W + 50)

    const g2 = new Game(3)
    g2.launch()
    g2.applyPower('laser')
    const alive = g2.remaining
    g2.paddleX = g2.bricks[0]!.x + C.BRICK_W / 2 + g2.paddleW / 2 - 10
    g2.input.targetX = g2.paddleX
    g2.input.fire = true
    for (let i = 0; i < C.STEP_HZ; i++) g2.step()
    expect(g2.remaining).toBeLessThan(alive)
  })

  test('losing every ball costs a life and ends the game at zero', () => {
    const g = new Game(5)
    g.lives = 1
    g.launch()
    g.balls[0]!.y = C.FIELD_H + 50
    g.balls[0]!.vy = 400
    for (let i = 0; i < 3 * C.STEP_HZ; i++) g.step()
    expect(g.lives).toBe(0)
    expect(g.phase).toBe('gameOver')
  })

  test('clearing a level advances to the next layout', () => {
    const g = new Game(1)
    g.launch()
    for (const b of g.bricks) b.alive = false
    g.step()
    expect(g.phase).toBe('levelClear')
    for (let i = 0; i < 3 * C.STEP_HZ; i++) g.step()
    expect(g.levelNumber).toBe(2)
    expect(g.level.name).toBe('Pyramid')
    expect(g.remaining).toBeGreaterThan(0)
  })
})
