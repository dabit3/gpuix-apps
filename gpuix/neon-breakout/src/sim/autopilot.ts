import * as C from './constants'
import type { Game } from './sim'

/** Fold a straight-line x position back into the field, like wall bounces. */
function foldX(x: number): number {
  const lo = C.BALL_R
  const span = C.FIELD_W - 2 * C.BALL_R
  let t = (x - lo) % (2 * span)
  if (t < 0) t += 2 * span
  return lo + (t <= span ? t : 2 * span - t)
}

/**
 * Attract-mode pilot. Writes `game.input` like a player would: chases the
 * most urgent falling ball, aims the bounce at the densest brick column,
 * grabs capsules when there is time, launches and fires lasers.
 */
export function autopilot(game: Game) {
  const input = game.input
  input.axis = 0
  if (game.phase === 'serve' && game.time % 1 > 0.55) input.launch = true
  if (game.laserTimer > 0) input.fire = true
  input.targetX = pilotTarget(game)
}

/** Where the pilot wants the paddle centre, in field coordinates. */
export function pilotTarget(game: Game): number {
  // Densest column of remaining bricks, used to steer the bounce.
  const counts = new Array(C.COLS).fill(0)
  for (const b of game.bricks) {
    if (!b.alive || b.kind === 'steel') continue
    const col = Math.round((b.x - C.BRICK_LEFT) / (C.BRICK_W + C.BRICK_GAP))
    counts[col] += b.hp
  }
  let best = 0
  for (let i = 1; i < C.COLS; i++) if (counts[i] > counts[best]) best = i
  const aimX = C.BRICK_LEFT + best * (C.BRICK_W + C.BRICK_GAP) + C.BRICK_W / 2

  let urgent: { t: number; x: number } | null = null
  for (const ball of game.balls) {
    if (ball.stuck || ball.vy <= 0) continue
    const t = (C.PADDLE_Y - C.BALL_R - ball.y) / ball.vy
    if (t < 0) continue
    if (!urgent || t < urgent.t) urgent = { t, x: foldX(ball.x + ball.vx * t) }
  }
  let target = urgent ? urgent.x : game.balls[0]?.x ?? C.FIELD_W / 2
  if (urgent) {
    const want = Math.max(-0.65, Math.min(0.65, (aimX - urgent.x) / 380))
    target = urgent.x - want * (game.paddleW / 2) * 0.85
  }
  // Grab a capsule if the next ball is far away.
  const reach = (x: number) => Math.abs(x - game.paddleX) / C.PADDLE_MAX_SPEED
  for (const cap of game.capsules) {
    const tCap = (C.PADDLE_Y - cap.y) / C.CAPSULE_SPEED
    if (tCap < 0 || tCap > 1.2) continue
    if (!urgent || urgent.t > tCap + reach(cap.x) + reach(urgent.x) + 0.25) {
      target = cap.x
      break
    }
  }
  return target
}
