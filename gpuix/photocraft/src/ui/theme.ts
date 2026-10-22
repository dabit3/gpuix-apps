// GitHub Dark High Contrast, as shipped in Ghostty.app, so the editor blends into the terminal.
export const T = {
  bg: '#0a0c10',
  fg: '#f0f3f6',
  panel: '#0d1117',
  raised: '#161b22',
  hover: '#1c2330',
  line: '#272b33',
  lineHi: '#3d434d',
  dim: '#9ea7b3',
  faint: '#7a828e',
  accent: '#71b7ff',
  accentBg: '#0d2a47',
  green: '#26cd4d',
  yellow: '#f0b72f',
  cyan: '#39c5cf',
  red: '#ff9492',
} as const

export const hex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

export const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

export const SWATCHES = ['#ffffff', '#f0f3f6', '#0a0c10', '#71b7ff', '#39c5cf', '#26cd4d', '#f0b72f', '#ff9492', '#ff6a3d', '#ffd8a8', '#2f6f4f', '#1f3b73']
