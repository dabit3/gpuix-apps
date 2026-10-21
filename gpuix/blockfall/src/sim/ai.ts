import { COLS, ROWS, type Active, type Game } from './game'
import { SHAPES, type PieceType } from './pieces'

export interface Plan { hold: boolean; rot: number; x: number; value: number; type: PieceType }

// El-Tetris style weights (Yiyuan Lee): heights, lines, holes, bumpiness.
const W = { height: -0.510066, lines: 0.760666, holes: -0.35663, bump: -0.184483 }

type Board = (PieceType | null)[][]

function fits(board: Board, type: PieceType, rot: number, x: number, y: number) {
  for (const [cx, cy] of SHAPES[type][rot]!) {
    const bx = x + cx, by = y + cy
    if (bx < 0 || bx >= COLS || by >= ROWS) return false
    if (by >= 0 && board[by]![bx]) return false
  }
  return true
}

function evaluate(board: Board, cleared: number) {
  const heights = Array<number>(COLS).fill(0)
  let holes = 0
  for (let x = 0; x < COLS; x++) {
    let seen = false
    for (let y = 0; y < ROWS; y++) {
      if (board[y]![x]) { if (!seen) { heights[x] = ROWS - y; seen = true } }
      else if (seen) holes++
    }
  }
  const agg = heights.reduce((s, h) => s + h, 0)
  let bump = 0
  for (let x = 0; x < COLS - 1; x++) bump += Math.abs(heights[x]! - heights[x + 1]!)
  return W.height * agg + W.lines * cleared + W.holes * holes + W.bump * bump
}

function best(board: Board, type: PieceType, startY: number): Omit<Plan, 'hold'> | null {
  let top: Omit<Plan, 'hold'> | null = null
  const rots = type === 'O' ? 1 : 4
  for (let rot = 0; rot < rots; rot++) {
    for (let x = -3; x < COLS; x++) {
      if (!fits(board, type, rot, x, startY)) continue
      let y = startY
      while (fits(board, type, rot, x, y + 1)) y++
      const next = board.map((r) => r.slice())
      for (const [cx, cy] of SHAPES[type][rot]!) if (y + cy >= 0) next[y + cy]![x + cx] = type
      const kept = next.filter((r) => !r.every(Boolean))
      const cleared = ROWS - kept.length
      const value = evaluate([...Array.from({ length: cleared }, () => Array<PieceType | null>(COLS).fill(null)), ...kept], cleared)
      if (!top || value > top.value) top = { rot, x, value, type }
    }
  }
  return top
}

/** Best placement for the active piece, considering a swap with hold. */
export function plan(game: Game): Plan | null {
  const a = game.active
  if (!a) return null
  const here = best(game.board, a.type, a.y)
  let alt: Omit<Plan, 'hold'> | null = null
  if (!game.holdUsed) {
    const other = game.hold ?? game.queue[0]!
    if (other !== a.type) alt = best(game.board, other, 0)
  }
  if (alt && (!here || alt.value > here.value + 0.4)) return { ...alt, hold: true }
  return here ? { ...here, hold: false } : null
}

/** Drives a Game through its Input like a quick human: rotate, shift, drop, with a short beat between actions. */
export class Pilot {
  private target: Plan | null = null
  private key = ''
  private wait = 0
  constructor(private beat = 7) {}

  current() { return this.target }

  step(game: Game) {
    const a: Active | null = game.active
    if (game.phase !== 'play' || !a) { this.key = ''; return }
    const key = `${game.pieces}:${a.type}:${game.holdUsed}`
    if (key !== this.key) { this.key = key; this.target = plan(game); this.wait = this.beat * 2 }
    if (this.wait-- > 0 || !this.target) return
    this.wait = this.beat
    const t = this.target
    if (t.hold && !game.holdUsed) { game.input.hold = true; return }
    if (a.rot !== t.rot) { game.input.rotateCW = true; return }
    if (a.x !== t.x) { game.move(Math.sign(t.x - a.x)); return }
    game.input.hardDrop = true
  }
}
