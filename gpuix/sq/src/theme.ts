/** Colors from Ghostty's "GitHub Dark High Contrast" theme so the app blends into the terminal. */
export const T = {
  bg: '#0a0c10',
  panel: '#0e1117',
  raised: '#151a22',
  hover: '#1b2129',
  border: '#ffffff17',
  borderStrong: '#ffffff2b',
  fg: '#f0f3f6',
  dim: '#9ea7b3',
  muted: '#7a828e',
  blue: '#71b7ff',
  blueSoft: '#71b7ff26',
  green: '#26cd4d',
  red: '#ff9492',
  yellow: '#f0b72f',
  cyan: '#39c5cf',
  white: '#ffffff',
} as const
export const MONO = 'Menlo'
export const fmtN = (n: number) => Math.round(n).toLocaleString('en-US')
export const fmtMs = (ms: number) => (ms < 10 ? `${ms.toFixed(1)} ms` : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`)
