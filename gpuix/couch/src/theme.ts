import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Theme {
  name: string
  bg: string
  fg: string
  palette: string[]
  panel: string
  raised: string
  line: string
  dim: string
  faint: string
  accent: string
  focus: string
  good: string
  bad: string
}

const FALLBACK = {
  name: 'GitHub Dark High Contrast',
  bg: '#0a0c10',
  fg: '#f0f3f6',
  palette: ['#7a828e', '#ff9492', '#26cd4d', '#f0b72f', '#71b7ff', '#cb9eff', '#39c5cf', '#d9dee3', '#9ea7b3', '#ffb1af', '#4ae168', '#f7c843', '#91cbff', '#dbb7ff', '#56d4dd', '#ffffff'],
}

const THEME_DIRS = [
  join(homedir(), '.config/ghostty/themes'),
  '/Applications/Ghostty.app/Contents/Resources/ghostty/themes',
  '/usr/share/ghostty/themes',
]

interface Raw { bg?: string; fg?: string; palette: (string | undefined)[]; theme?: string }

const norm = (c: string) => (c.startsWith('#') ? c : `#${c}`).toLowerCase()

export function parseGhostty(text: string, into: Raw = { palette: [] }): Raw {
  for (const line of text.split('\n')) {
    const m = /^\s*([a-z-]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    const key = m[1]!, value = m[2]!
    if (key === 'theme') {
      const dark = /dark:([^,]+)/.exec(value)
      into.theme = (dark ? dark[1]! : value).trim().replace(/^"|"$/g, '')
    } else if (key === 'background') into.bg = norm(value)
    else if (key === 'foreground') into.fg = norm(value)
    else if (key === 'palette') {
      const p = /^(\d+)\s*=\s*(\S+)/.exec(value)
      if (p) into.palette[Number(p[1])] = norm(p[2]!)
    }
  }
  return into
}

function hex(c: string): [number, number, number] {
  const h = c.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Mix two hex colors: t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')
}

export function alpha(c: string, a: number): string {
  return c.slice(0, 7) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
}

export function makeTheme(name: string, bg: string, fg: string, palette: string[]): Theme {
  const p = (i: number) => palette[i] ?? FALLBACK.palette[i]!
  return {
    name, bg, fg, palette,
    panel: mix(bg, fg, 0.06),
    raised: mix(bg, fg, 0.11),
    line: mix(bg, fg, 0.16),
    dim: mix(bg, fg, 0.62),
    faint: mix(bg, fg, 0.4),
    accent: p(4),
    focus: p(3),
    good: p(2),
    bad: p(1),
  }
}

export function fallbackTheme(): Theme {
  return makeTheme(FALLBACK.name, FALLBACK.bg, FALLBACK.fg, FALLBACK.palette)
}

/** Reads `theme = …` from the Ghostty config, then the theme file, then the config's own color overrides. */
export function loadGhosttyTheme(override?: string): Theme {
  try {
    const cfgPath = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ghostty/config')
    const cfg = existsSync(cfgPath) ? parseGhostty(readFileSync(cfgPath, 'utf8')) : { palette: [] as (string | undefined)[] } as Raw
    const name = override ?? cfg.theme
    const base: Raw = { palette: [] }
    if (name) {
      const file = THEME_DIRS.map((d) => join(d, name)).find((f) => existsSync(f))
      if (file) parseGhostty(readFileSync(file, 'utf8'), base)
    }
    const bg = (override ? undefined : cfg.bg) ?? base.bg ?? FALLBACK.bg
    const fg = (override ? undefined : cfg.fg) ?? base.fg ?? FALLBACK.fg
    const palette = FALLBACK.palette.map((c, i) => (override ? undefined : cfg.palette[i]) ?? base.palette[i] ?? c)
    return makeTheme(name ?? FALLBACK.name, bg, fg, palette)
  } catch {
    return fallbackTheme()
  }
}
