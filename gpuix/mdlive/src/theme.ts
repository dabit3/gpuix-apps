import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_THEME = 'GitHub Dark High Contrast'

export type Palette = {
  name: string
  bg: string
  fg: string
  ansi: string[]
}

const FALLBACK: Palette = {
  name: DEFAULT_THEME,
  bg: '#0a0c10',
  fg: '#f0f3f6',
  ansi: [
    '#7a828e', '#ff9492', '#26cd4d', '#f0b72f', '#71b7ff', '#cb9eff', '#39c5cf', '#d9dee3',
    '#9ea7b3', '#ffb1af', '#4ae168', '#f7c843', '#91cbff', '#dbb7ff', '#56d4dd', '#ffffff',
  ],
}

const THEME_DIRS = [
  join(homedir(), '.config/ghostty/themes'),
  '/Applications/Ghostty.app/Contents/Resources/ghostty/themes',
]

export function parseTheme(text: string, name: string): Palette {
  const p: Palette = { name, bg: FALLBACK.bg, fg: FALLBACK.fg, ansi: [...FALLBACK.ansi] }
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*([a-z-]+)\s*=\s*(.+?)\s*$/)
    if (!m) continue
    const [, key, value] = m as unknown as [string, string, string]
    if (key === 'background') p.bg = normHex(value)
    else if (key === 'foreground') p.fg = normHex(value)
    else if (key === 'palette') {
      const pm = value.match(/^(\d+)\s*=\s*(#?[0-9a-fA-F]{6})$/)
      if (pm) p.ansi[Number(pm[1])] = normHex(pm[2]!)
    }
  }
  return p
}

function normHex(v: string) {
  return (v.startsWith('#') ? v : `#${v}`).toLowerCase()
}

/** The theme Ghostty is using (config `theme = …`), else GitHub Dark High Contrast. */
export function ghosttyThemeName(): string {
  const cfg = join(homedir(), '.config/ghostty/config')
  if (!existsSync(cfg)) return DEFAULT_THEME
  const m = readFileSync(cfg, 'utf8').match(/^\s*theme\s*=\s*(.+?)\s*$/m)
  const v = m?.[1]?.replace(/^"|"$/g, '') ?? DEFAULT_THEME
  // `theme = dark:X,light:Y` → take the dark one
  const dark = v.match(/dark:([^,]+)/)
  return (dark ? dark[1]! : v).trim()
}

export function loadPalette(name = ghosttyThemeName()): Palette {
  for (const dir of THEME_DIRS) {
    const f = join(dir, name)
    if (existsSync(f)) return parseTheme(readFileSync(f, 'utf8'), name)
  }
  return FALLBACK
}

/** Mix two #rrggbb colours: t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`
}

export function alpha(hex: string, a: number): string {
  return `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`
}

export type UiTheme = ReturnType<typeof uiTheme>

export function uiTheme(p: Palette) {
  const grey = p.ansi[8] ?? '#9ea7b3'
  return {
    name: p.name,
    bg: p.bg,
    surface: mix(p.bg, p.fg, 0.04),
    raised: mix(p.bg, p.fg, 0.08),
    hairline: mix(p.bg, p.fg, 0.08),
    text: p.fg,
    text2: mix(p.fg, grey, 0.55),
    text3: p.ansi[0] ?? '#7a828e',
    blue: p.ansi[4] ?? '#71b7ff',
    green: p.ansi[2] ?? '#26cd4d',
    yellow: p.ansi[3] ?? '#f0b72f',
    red: p.ansi[1] ?? '#ff9492',
    cyan: p.ansi[6] ?? '#39c5cf',
  }
}
