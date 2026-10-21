export const FIELD_W = 760
export const FIELD_H = 680
export const STEP_HZ = 120
export const DT = 1 / STEP_HZ

export const COLS = 13
export const BRICK_W = 52
export const BRICK_H = 22
export const BRICK_GAP = 4
export const BRICK_LEFT = (FIELD_W - (COLS * BRICK_W + (COLS - 1) * BRICK_GAP)) / 2
export const BRICK_TOP = 78

export const PADDLE_Y = 626
export const PADDLE_H = 14
export const PADDLE_W = 112
export const PADDLE_WIDE_W = 176
export const PADDLE_MAX_SPEED = 2600
export const PADDLE_KEY_SPEED = 860

export const BALL_R = 7
export const BALL_BASE_SPEED = 520
export const BALL_LEVEL_SPEEDUP = 22
export const BALL_HIT_SPEEDUP = 4
export const BALL_MAX_FACTOR = 1.45
export const MAX_BOUNCE_ANGLE = (62 * Math.PI) / 180
export const MAX_BALLS = 9

export const CAPSULE_W = 40
export const CAPSULE_H = 16
export const CAPSULE_SPEED = 165
export const DROP_CHANCE = 0.2

export const LASER_SPEED = 980
export const LASER_COOLDOWN = 0.2

export const WIDE_TIME = 15
export const LASER_TIME = 12
export const SLOW_TIME = 10
export const SLOW_FACTOR = 0.6

export const MAX_PARTICLES = 220
export const START_LIVES = 3
export const MAX_LIVES = 6

export const COLORS = {
  teal: '#2ee6d6',
  amber: '#ffb547',
  pink: '#ff4f9a',
  coral: '#ff7a59',
  sky: '#4fb3ff',
  mint: '#7cf2a0',
  white: '#f4fffd',
  steel: '#9fb0c4',
} as const
