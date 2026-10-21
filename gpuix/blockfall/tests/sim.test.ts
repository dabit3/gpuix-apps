import { describe, expect, test } from 'bun:test'
import { Pilot } from '../src/sim/ai'
import { COLS, DT, Game, gravityInterval, HIDDEN, ROWS, STEP_HZ } from '../src/sim/game'
import { kicks, SHAPES } from '../src/sim/pieces'

const sec = (s: number) => Math.round(s * STEP_HZ)

function fill(g: Game, rows: number[], gapX = -1) {
  for (const y of rows) for (let x = 0; x < COLS; x++) g.board[y]![x] = x === gapX ? null : 'O'
}

function autoplay(seed: number, seconds: number) {
  const g = new Game(seed, 1)
  const pilot = new Pilot(4)
  for (let i = 0; i < sec(seconds) && g.phase !== 'over'; i++) { pilot.step(g); g.step() }
  return g
}

describe('pieces', () => {
  test('SRS states come from rotating the bounding box', () => {
    expect(SHAPES.T[1]).toEqual([[2, 1], [1, 0], [1, 1], [1, 2]])
    expect(SHAPES.I[1]!.map(([x]) => x)).toEqual([2, 2, 2, 2])
    expect(kicks('I', 0, 1)[4]).toEqual([1, -2])
    expect(kicks('T', 0, 1)[2]).toEqual([-1, -1])
  })
})

describe('Game', () => {
  test('7-bag: every piece once per seven, and seeds replay exactly', () => {
    const a = new Game(42)
    const seq = [a.active!.type, ...a.queue.slice(0, 6)]
    expect(new Set(seq).size).toBe(7)
    expect(new Game(42).queue).toEqual(a.queue)
    expect(new Game(43).queue).not.toEqual(a.queue)
  })

  test('the autopilot clears lines and the score climbs, deterministically', () => {
    const g = autoplay(7, 90)
    expect(g.phase).not.toBe('over')
    expect(g.lines).toBeGreaterThanOrEqual(10)
    expect(g.level).toBeGreaterThanOrEqual(2)
    expect(g.score).toBeGreaterThan(2000)
    expect(g.pieces).toBeGreaterThan(60)
    const again = autoplay(7, 90)
    expect(again.score).toBe(g.score)
    expect(again.board).toEqual(g.board)
  })

  test('ghost and hard drop land on the stack and score 2 per cell', () => {
    const g = new Game(3)
    const ghost = g.ghost()!
    const d = g.dropDistance()
    expect(ghost.y).toBe(g.active!.y + d)
    g.input.hardDrop = true
    g.step()
    expect(g.score).toBe(d * 2)
    expect(g.pieces).toBe(1)
    expect(g.board[ROWS - 1]!.some(Boolean)).toBe(true)
  })

  test('hold swaps once per piece', () => {
    const g = new Game(5)
    const first = g.active!.type
    const next = g.queue[0]
    expect(g.holdPiece()).toBe(true)
    expect(g.hold).toBe(first)
    expect(g.active!.type).toBe(next)
    expect(g.holdPiece()).toBe(false)
    g.hardDrop()
    expect(g.holdUsed).toBe(false)
    expect(g.holdPiece()).toBe(true)
    expect(g.active!.type).toBe(first)
  })

  test('DAS waits, then ARR repeats; key-up stops it', () => {
    const g = new Game(9, 1, { das: 0.1, arr: 0.025 })
    const x0 = g.active!.x
    g.input.left = true
    g.step()
    expect(g.active!.x).toBe(x0 - 1)
    g.run(sec(0.09))
    expect(g.active!.x).toBe(x0 - 1)
    g.run(sec(0.06))
    expect(g.active!.x).toBeLessThanOrEqual(x0 - 2)
    g.run(sec(0.5))
    const wall = Math.min(...g.cells().map(([x]) => x))
    expect(wall).toBe(0)
    g.input.left = false
    g.input.right = true
    g.step()
    expect(Math.min(...g.cells().map(([x]) => x))).toBe(1)
    g.input.right = false
    const x1 = g.active!.x
    g.run(sec(0.3))
    expect(g.active!.x).toBe(x1)
  })

  test('wall kicks let pieces rotate against the wall', () => {
    const g = new Game(1)
    g.active = { type: 'I', rot: 1, x: -2, y: 5 }
    expect(g.fits(g.active)).toBe(true)
    expect(g.rotate(1)).toBe(true)
    expect(Math.min(...g.cells().map(([x]) => x))).toBe(0)
  })

  test('gravity follows the level curve and lock delay waits', () => {
    expect(gravityInterval(1)).toBeCloseTo(1, 5)
    expect(gravityInterval(10)).toBeLessThan(0.1)
    const g = new Game(2)
    const y0 = g.active!.y
    g.run(sec(1.01))
    expect(g.active!.y).toBe(y0 + 1)
    g.active = { ...g.active!, y: g.active!.y + g.dropDistance() }
    const pieces = g.pieces
    g.run(sec(0.4))
    expect(g.pieces).toBe(pieces)
    g.run(sec(0.2))
    expect(g.pieces).toBe(pieces + 1)
  })

  test('line clears score by count and level, with combo and back-to-back', () => {
    const g = new Game(4)
    fill(g, [18, 19, 20, 21], 0)
    g.active = { type: 'I', rot: 1, x: -2, y: 10 }
    g.score = 0
    g.hardDrop()
    expect(g.phase).toBe('clearing')
    expect(g.clearingRows).toEqual([18, 19, 20, 21])
    expect(g.score - 0).toBe(800 + (g.active ? 0 : 0) + 2 * 8)
    expect(g.particles.length).toBe(4 * 10 * 3)
    expect(g.popups[0]!.text).toBe('Quad')
    g.run(sec(0.4))
    expect(g.phase).toBe('play')
    expect(g.lines).toBe(4)
    expect(g.board.flat().filter(Boolean).length).toBe(0)

    // A second quad right away is back-to-back (x1.5) and a 1-combo (+50).
    fill(g, [18, 19, 20, 21], 9)
    g.active = { type: 'I', rot: 1, x: 7, y: 10 }
    const before = g.score
    g.hardDrop()
    expect(g.score - before).toBe(1200 + 50 + 16)
    expect(g.popups.some((p) => p.sub?.includes('Back-to-back'))).toBe(true)
    expect(g.combo).toBe(1)
  })

  test('T-spin double is recognised and scored', () => {
    const g = new Game(6)
    // Slot: rows 20-21 full except a T-shaped hole at x=3..5 (row 20) / x=4 (row 21), with an overhang at x=3 row 19.
    fill(g, [20, 21])
    g.board[20]![3] = g.board[20]![4] = g.board[20]![5] = null
    g.board[21]![4] = null
    g.board[19]![3] = 'O'
    g.active = { type: 'T', rot: 1, x: 3, y: 19 }
    expect(g.fits(g.active)).toBe(true)
    expect(g.rotate(1)).toBe(true) // into rot 2, pointing down into the slot
    expect(g.active!.rot).toBe(2)
    g.score = 0
    g.hardDrop()
    expect(g.tspins).toBe(1)
    expect(g.lines).toBe(2)
    expect(g.popups[0]!.text).toBe('T-Spin Double')
    expect(g.score).toBe(1200)
  })

  test('topping out ends the game', () => {
    const g = new Game(8)
    for (let y = HIDDEN; y < ROWS; y++) for (let x = 0; x < COLS; x++) g.board[y]![x] = x === 0 ? null : 'Z'
    for (let i = 0; i < 40 && g.phase !== 'over'; i++) { g.input.hardDrop = true; g.step() }
    expect(g.phase).toBe('over')
  })

  test('steps are fixed at 120 Hz', () => {
    expect(DT).toBeCloseTo(1 / 120, 10)
  })
})
