export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'
export const PIECES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']
export type Cell = readonly [x: number, y: number]

/** Spawn-orientation cells inside each piece's SRS bounding box (y grows downward). */
const BASE: Record<PieceType, { size: number; cells: Cell[] }> = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
}

/** Rotating the box matrix clockwise reproduces the four SRS states exactly. */
export const SHAPES: Record<PieceType, Cell[][]> = Object.fromEntries(
  PIECES.map((t) => {
    const { size, cells } = BASE[t]
    const states: Cell[][] = [cells]
    for (let r = 1; r < 4; r++) states.push(states[r - 1]!.map(([x, y]) => [size - 1 - y, x] as const))
    return [t, states]
  }),
) as Record<PieceType, Cell[][]>

export const BOX_SIZE: Record<PieceType, number> = Object.fromEntries(PIECES.map((t) => [t, BASE[t].size])) as Record<PieceType, number>

// SRS wall-kick offsets, written with +y up as in the guideline and flipped when used.
type Kicks = Record<string, Cell[]>
const JLSTZ: Kicks = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
}
const I_KICKS: Kicks = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
}

/** Kick tests for a rotation, already converted to board space (y down). */
export function kicks(type: PieceType, from: number, to: number): Cell[] {
  if (type === 'O') return [[0, 0]]
  const table = type === 'I' ? I_KICKS : JLSTZ
  return table[`${from}>${to}`]!.map(([x, y]) => [x, -y] as const)
}
