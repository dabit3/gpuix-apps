// Colours from Ghostty's "GitHub Dark High Contrast" theme so jx blends into the terminal.
export const T = {
  bg: '#0a0c10',
  panel: '#0e1218',
  raised: '#151b23',
  hover: '#121820',
  select: '#1a2636',
  border: '#232a33',
  fg: '#f0f3f6',
  text: '#d9dee3',
  muted: '#9ea7b3',
  dim: '#7a828e',
  blue: '#71b7ff',
  blueSoft: '#91cbff',
  green: '#26cd4d',
  greenSoft: '#4ae168',
  yellow: '#f0b72f',
  red: '#ff9492',
  cyan: '#39c5cf',
}

export const KIND_COLOR = {
  string: T.greenSoft,
  number: T.yellow,
  boolean: T.red,
  null: T.muted,
  object: T.text,
  array: T.text,
} as const

export const MONO = 'JetBrains Mono'
