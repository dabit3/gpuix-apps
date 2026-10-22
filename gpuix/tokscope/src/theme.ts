import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GpuixTheme } from '@gpuix/react'
import type { Segment } from './types'

/** Neutral dark palette (devin.ai, dark) on the Ghostty GitHub Dark High Contrast background. */
export const C = {
  bg: '#0a0c10',
  surface: '#111318',
  surfaceHi: '#171a1f',
  line: '#1d2026',
  lineHi: '#2b2f36',
  fg: '#ededed',
  fg2: '#b4b6b9',
  fg3: '#8b8e94',
  fg4: '#45484e',
  green: '#3ecf6e',
  red: '#ff6b63',
}

/** Cached prefix sits dark at the bottom; what a turn adds is bright. */
export const SEG_COLOR: Record<Segment, string> = {
  system: '#2b2e33',
  tools: '#3d4046',
  history: '#55585e',
  context: '#6e7177',
  toolResults: '#9a9da2',
  output: '#ededed',
}

export const SANS = 'Geist'
export const MONO = 'Geist Mono'

/** Monochrome theme for <code> and <markdown>. */
export const TEXT_THEME: GpuixTheme = {
  appearance: 'dark',
  bg: C.bg,
  border: C.line,
  text: '#d6d7d9',
  textMuted: C.fg2,
  textFaint: C.fg3,
  textDim: C.fg4,
  accent: C.fg,
  codeText: C.fg2,
  codeWash: C.surface,
  fontSans: SANS,
  fontMono: MONO,
  syntax: {
    comment: C.fg3,
    keyword: C.fg,
    string: '#c2c4c7',
    stringSpecial: '#c2c4c7',
    number: C.fg,
    boolean: C.fg,
    constant: C.fg,
    typeName: C.fg2,
    typeBuiltin: C.fg2,
    constructor: C.fg2,
    function: C.fg,
    functionBuiltin: C.fg,
    property: C.fg2,
    variable: C.fg2,
    parameter: C.fg2,
    operator: C.fg3,
    punctuation: C.fg3,
    tag: C.fg,
    attribute: C.fg2,
  },
}

const FONT_FILES = [
  'geist-sans/Geist-Regular.ttf',
  'geist-sans/Geist-Medium.ttf',
  'geist-sans/Geist-SemiBold.ttf',
  'geist-mono/GeistMono-Regular.ttf',
]

export function registerFonts(renderer: { registerFont?: (bytes: Buffer) => void } | null | undefined) {
  if (!renderer?.registerFont) return
  const dir = join(import.meta.dir, '..', 'node_modules', 'geist', 'dist', 'fonts')
  for (const f of FONT_FILES) {
    const p = join(dir, f)
    if (!existsSync(p)) continue
    try {
      renderer.registerFont(readFileSync(p))
    } catch (e) {
      if (process.env.TOKSCOPE_DEBUG) appendFileSync('/tmp/tokscope-fonts.log', `${f}: ${e}\n`)
    }
  }
}

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`
}
