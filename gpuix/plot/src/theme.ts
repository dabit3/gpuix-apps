// Colours from Ghostty's "GitHub Dark High Contrast" theme so the app blends into the terminal.
export const T = {
  bg: '#0a0c10',
  fg: '#f0f3f6',
  panel: '#0e1117',
  raised: '#161b22',
  border: '#272c35',
  borderHi: '#3d4450',
  dim: '#9ea7b3',
  faint: '#6e7681',
  grid: '#161a21',
  gridHi: '#262c36',
  blue: '#71b7ff',
  green: '#26cd4d',
  yellow: '#f0b72f',
  cyan: '#39c5cf',
  red: '#ff9492',
} as const

export const SERIES_COLORS = ['#71b7ff', '#26cd4d', '#f0b72f', '#39c5cf', '#ff9492', '#d9dee3', '#4ae168', '#91cbff']

export const MONO = 'Menlo'

export type RGB = readonly [number, number, number]

export function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
