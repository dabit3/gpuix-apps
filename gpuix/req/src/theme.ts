import type { GpuixTheme } from '@gpuix/react'

/** Colors from Ghostty's "GitHub Dark High Contrast" theme, so req blends into the terminal. */
export const C = {
  bg: '#0a0c10',
  panel: '#0d1016',
  raised: '#151a22',
  hover: '#1a202a',
  selected: '#1c2533',
  border: '#232a35',
  borderStrong: '#3a4250',
  text: '#f0f3f6',
  dim: '#9ea7b3',
  faint: '#7a828e',
  ghost: '#4f5663',
  blue: '#71b7ff',
  blueSoft: '#71b7ff22',
  green: '#26cd4d',
  greenSoft: '#26cd4d22',
  yellow: '#f0b72f',
  yellowSoft: '#f0b72f22',
  red: '#ff9492',
  redSoft: '#ff949222',
  cyan: '#39c5cf',
  white: '#ffffff',
  find: '#f0b72f55',
  findActive: '#f0b72f',
} as const

export const MONO = 'JetBrains Mono'
export const SANS = '.SystemUIFont'

export const METHOD_COLOR: Record<string, string> = {
  GET: C.green,
  POST: C.yellow,
  PUT: C.blue,
  PATCH: C.cyan,
  DELETE: C.red,
  HEAD: C.dim,
  OPTIONS: C.dim,
}

export const statusColor = (status: number | null) =>
  status == null ? C.red : status < 300 ? C.green : status < 400 ? C.cyan : status < 500 ? C.yellow : C.red

export const PHASE_COLOR = {
  dns: C.cyan,
  connect: C.yellow,
  tls: C.red,
  ttfb: C.blue,
  download: C.green,
} as const

export const THEME: GpuixTheme = {
  appearance: 'dark',
  text: C.text,
  textMuted: C.dim,
  textFaint: C.faint,
  textDim: C.dim,
  border: C.border,
  bg: C.bg,
  accent: C.blue,
  caret: C.blue,
  fontSans: SANS,
  fontMono: MONO,
  codeText: C.text,
  codeWash: '#ffffff08',
}
