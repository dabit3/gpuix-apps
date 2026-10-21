import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface TermTheme {
  name: string
  background: string
  foreground: string
  palette: string[]
}

const FALLBACK: TermTheme = {
  name: 'GitHub Dark High Contrast',
  background: '#0a0c10',
  foreground: '#f0f3f6',
  palette: ['#7a828e', '#ff9492', '#26cd4d', '#f0b72f', '#71b7ff', '#cb9eff', '#39c5cf', '#d9dee3', '#9ea7b3', '#ffb1af', '#4ae168', '#f7c843', '#91cbff', '#dbb7ff', '#56d4dd', '#ffffff'],
}

const THEME_DIRS = [
  join(homedir(), '.config/ghostty/themes'),
  '/Applications/Ghostty.app/Contents/Resources/ghostty/themes',
]

export function parseThemeFile(text: string, name: string): TermTheme {
  const t: TermTheme = { name, background: FALLBACK.background, foreground: FALLBACK.foreground, palette: [...FALLBACK.palette] }
  for (const raw of text.split('\n')) {
    const m = raw.match(/^\s*([a-z-]+)\s*=\s*(.+?)\s*$/)
    if (!m) continue
    const [, key, value] = m
    if (key === 'background') t.background = norm(value)
    else if (key === 'foreground') t.foreground = norm(value)
    else if (key === 'palette') {
      const p = value.match(/^(\d+)\s*=\s*(#?[0-9a-fA-F]{6})/)
      if (p) t.palette[Number(p[1])] = norm(p[2])
    }
  }
  return t
}

function norm(v: string) {
  return (v.startsWith('#') ? v : `#${v}`).toLowerCase()
}

/** The theme named in the user's Ghostty config, so the app blends into the terminal it paints in. */
export function loadGhosttyTheme(): TermTheme {
  try {
    const cfgPath = join(homedir(), '.config/ghostty/config')
    if (!existsSync(cfgPath)) return FALLBACK
    const cfg = readFileSync(cfgPath, 'utf8')
    const name = cfg.match(/^\s*theme\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^"|"$/g, '')
    if (!name) return parseThemeFile(cfg, 'custom')
    for (const dir of THEME_DIRS) {
      const p = join(dir, name)
      if (existsSync(p)) return { ...parseThemeFile(readFileSync(p, 'utf8'), name) }
    }
  } catch {}
  return FALLBACK
}

export function mix(a: string, b: string, t: number): string {
  const pa = hex(a)
  const pb = hex(b)
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

function hex(c: string): number[] {
  const h = c.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

export function makePalette(t: TermTheme) {
  const bg = t.background
  const fg = t.foreground
  return {
    themeName: t.name,
    bg,
    panel: mix(bg, fg, 0.035),
    raised: mix(bg, fg, 0.075),
    hover: mix(bg, fg, 0.06),
    selected: mix(bg, t.palette[4], 0.2),
    border: mix(bg, fg, 0.13),
    text: fg,
    text2: t.palette[8],
    text3: t.palette[0],
    green: t.palette[2],
    red: t.palette[1],
    yellow: t.palette[3],
    blue: t.palette[4],
    cyan: t.palette[6],
  }
}

export type Palette = ReturnType<typeof makePalette>
export const P: Palette = makePalette(loadGhosttyTheme())
export const MONO = 'JetBrains Mono'
