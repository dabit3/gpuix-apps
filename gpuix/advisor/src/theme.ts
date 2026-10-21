// GitHub Dark High Contrast, as shipped in Ghostty.app, so the dashboard blends into the terminal.
export const T = {
  bg: '#0a0c10',
  panel: '#0f1318',
  raised: '#151a21',
  hover: '#1b212a',
  selected: '#1d2633',
  line: '#232a33',
  lineStrong: '#3a424d',
  text: '#f0f3f6',
  muted: '#9ea7b3',
  faint: '#7a828e',
  blue: '#71b7ff',
  cyan: '#39c5cf',
  green: '#26cd4d',
  yellow: '#f0b72f',
  red: '#ff9492',
  orange: '#ffb757',
} as const

export const SANS = '.SystemUIFont'
export const MONO = 'Menlo'

export const ROLE_COLOR = { builder: T.blue, scout: T.cyan, advisor: T.yellow, other: T.muted } as const
export const VERDICT_COLOR = { approve: T.green, revise: T.orange, block: T.red } as const

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
export const fmtSecs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
