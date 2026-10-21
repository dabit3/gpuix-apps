export const C = {
  bg: '#0e0f11',
  panel: '#131417',
  sidebar: '#121315',
  raised: '#1a1b1f',
  raisedHover: '#202126',
  border: '#ffffff12',
  borderStrong: '#ffffff1f',
  text: '#e7e7ea',
  textDim: '#a1a3aa',
  textMuted: '#6c6f78',
  accent: '#3d8bfd',
  accentSoft: '#3d8bfd2e',
  rowHover: '#ffffff08',
  rowSelected: '#3d8bfd30',
  match: '#f5c54266',
  matchActive: '#f59e0bdd',
  green: '#34c77b',
} as const

export const MONO = 'Menlo'

export const LEVEL_COLOR = ['#6c6f78', '#7aa2d6', '#9aa0a8', '#e8a93b', '#f0564f', '#ff3b30'] as const
export const LEVEL_TINT = ['#00000000', '#00000000', '#00000000', '#e8a93b0d', '#f0564f14', '#ff3b3026'] as const

export const SERVICE_COLOR = ['#8fb3e0', '#a5c99a', '#d9b98c', '#e39b8f', '#9fc7c4', '#c9b3d9', '#d6c27a', '#a8b4c2', '#e0a7b8', '#9ccfa1']
export const serviceColor = (id: number) => SERVICE_COLOR[id % SERVICE_COLOR.length]!

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
export const fmtCompact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : fmt(n)
