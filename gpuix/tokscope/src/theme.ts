import type { Segment } from './types'

/** GitHub Dark High Contrast (Ghostty theme) */
export const C = {
  bg: '#0a0c10',
  panel: '#10141a',
  panelHi: '#161b22',
  line: '#272b33',
  lineHi: '#3d424d',
  fg: '#f0f3f6',
  muted: '#9ea7b3',
  dim: '#7a828e',
  faint: '#525964',
  blue: '#71b7ff',
  cyan: '#39c5cf',
  green: '#26cd4d',
  yellow: '#f0b72f',
  red: '#ff9492',
  orange: '#ffb757',
}

export const SEG_COLOR: Record<Segment, string> = {
  system: C.blue,
  tools: C.cyan,
  history: '#c4ccd6',
  context: C.green,
  toolResults: C.yellow,
  output: C.red,
}

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`
}

export const MONO = 'Menlo'
