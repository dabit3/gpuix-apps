// Background, text and accents come from GitHub Dark High Contrast (as shipped in Ghostty.app) so the dashboard blends into the terminal.
export const T = {
  bg: '#0a0c10',
  surface: '#0e1116',
  raised: '#151920',
  hover: '#12161c',
  selected: '#1a1f27',
  line: '#1b2027',
  lineStrong: '#2a3039',
  text: '#f0f3f6',
  muted: '#9aa1aa',
  faint: '#646b75',
  blue: '#71b7ff',
  cyan: '#39c5cf',
  green: '#26cd4d',
  yellow: '#f0b72f',
  red: '#ff9492',
  orange: '#f0b72f',
} as const

export const SANS = '.SystemUIFont'
export const MONO = 'Menlo'

// Monochrome tiers with one accent for the advisor, the role this app is about.
export const ROLE_COLOR = { builder: '#d6dce3', scout: '#6e7681', advisor: T.blue, other: T.faint } as const
export const VERDICT_COLOR = { approve: T.green, revise: T.orange, block: T.red } as const

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
export const fmtSecs = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
