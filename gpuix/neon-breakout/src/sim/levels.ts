import { COLORS } from './constants'

/**
 * One string per row, 13 columns.
 *   .  empty       a-f  one-hit colours      2  two-hit      3  three-hit
 *   #  steel (indestructible)
 */
export interface LevelDef {
  name: string
  rows: string[]
}

export const LEVELS: LevelDef[] = [
  {
    name: 'Neon Grid',
    rows: [
      '.............',
      'ccccccccccccc',
      'bbbbbbbbbbbbb',
      'aaaaaaaaaaaaa',
      'eeeeeeeeeeeee',
      'ddddddddddddd',
    ],
  },
  {
    name: 'Pyramid',
    rows: [
      '......2......',
      '.....2c2.....',
      '....ccbcc....',
      '...bbbabbb...',
      '..aaaa2aaaa..',
      '.eeeeeeeeeee.',
      '2ddddddddddd2',
    ],
  },
  {
    name: 'Fortress',
    rows: [
      '3...........3',
      '#.333.3.333.#',
      '#.2cc2.2cc2.#',
      '#.bbbb.bbbb.#',
      '#..aaaaaaa..#',
      '###.eeeee.###',
      '....ddddd....',
    ],
  },
  {
    name: 'Invaders',
    rows: [
      '..c.......c..',
      '...c.....c...',
      '..2222222222.',
      '.22.222.222..',
      '2bbbbbbbbbbb2',
      'b.bbbbbbbbb.b',
      'b.a.......a.b',
      '...aa...aa...',
    ],
  },
  {
    name: 'Prism Gate',
    rows: [
      '#3#3#3#3#3#3#',
      '.............',
      '.cc.2bbb2.cc.',
      '.ccc.bbb.ccc.',
      '..aaa2a2aaa..',
      '...eeeeeee...',
      '#...fffff...#',
      '##....d....##',
    ],
  },
]

export type BrickKind = 'normal' | 'tough' | 'armored' | 'steel'

export const BRICK_COLORS: Record<string, string> = {
  a: COLORS.teal,
  b: COLORS.amber,
  c: COLORS.pink,
  d: COLORS.sky,
  e: COLORS.mint,
  f: COLORS.coral,
  '2': '#ffd27a',
  '3': '#ff8fc0',
  '#': COLORS.steel,
}

export function kindOf(ch: string): BrickKind {
  if (ch === '2') return 'tough'
  if (ch === '3') return 'armored'
  if (ch === '#') return 'steel'
  return 'normal'
}

export const BRICK_HP: Record<BrickKind, number> = { normal: 1, tough: 2, armored: 3, steel: Infinity }
export const BRICK_POINTS: Record<BrickKind, number> = { normal: 50, tough: 120, armored: 200, steel: 0 }
