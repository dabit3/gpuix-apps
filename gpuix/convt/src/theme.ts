import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Theme {
  name: string
  bg: string
  fg: string
  palette: string[]
  /** Derived surfaces. */
  panel: string
  well: string
  line: string
  dim: string
  faint: string
  accent: string
  good: string
  warn: string
  bad: string
  kinds: Record<'image' | 'video' | 'audio' | 'pdf' | 'doc', string>
}

/** GitHub Dark High Contrast, as shipped in Ghostty.app — used when no Ghostty theme can be read. */
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

interface Raw { bg?: string; fg?: string; palette: (string | undefined)[] }

function parse(text: string, into: Raw, themeName: { value?: string }) {
  for (const line of text.split('\n')) {
    const m = /^\s*([a-z-]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    const [, key, value] = m as unknown as [string, string, string]
    if (key === 'theme') themeName.value = value.includes('dark:') ? /dark:([^,]+)/.exec(value)![1]!.trim() : value.replace(/^"|"$/g, '')
    else if (key === 'background') into.bg = norm(value)
    else if (key === 'foreground') into.fg = norm(value)
    else if (key === 'palette') {
      const p = /^(\d+)\s*=\s*(\S+)/.exec(value)
      if (p) into.palette[Number(p[1])] = norm(p[2]!)
    }
  }
}

const norm = (c: string) => (c.startsWith('#') ? c : `#${c}`).toLowerCase()

/** Reads `theme = …` from the Ghostty config (or `override`), then the theme file, then config overrides. */
export function loadGhosttyTheme(override?: string): Theme {
  const config = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ghostty/config')
  const fromConfig: Raw = { palette: [] }
  const name: { value?: string } = {}
  if (existsSync(config)) parse(readFileSync(config, 'utf8'), fromConfig, name)
  const themeName = override ?? name.value
  const fromTheme: Raw = { palette: [] }
  let found = false
  if (themeName) {
    for (const dir of THEME_DIRS) {
      const file = join(dir, themeName)
      if (existsSync(file)) { parse(readFileSync(file, 'utf8'), fromTheme, {}); found = true; break }
    }
  }
  const pick = (i: number) => (override ? undefined : fromConfig.palette[i]) ?? fromTheme.palette[i] ?? FALLBACK.palette[i]!
  return build({
    name: found ? themeName! : FALLBACK.name,
    bg: (override ? undefined : fromConfig.bg) ?? fromTheme.bg ?? FALLBACK.bg,
    fg: (override ? undefined : fromConfig.fg) ?? fromTheme.fg ?? FALLBACK.fg,
    palette: Array.from({ length: 16 }, (_, i) => pick(i)),
  })
}

export function fallbackTheme(): Theme { return build(FALLBACK) }

function hex(c: string) {
  const h = c.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
export function mix(a: string, b: string, t: number) {
  const [ar, ag, ab] = hex(a), [br, bg, bb] = hex(b)
  const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${m(ar!, br!)}${m(ag!, bg!)}${m(ab!, bb!)}`
}
export function alpha(c: string, a: number) {
  return c.slice(0, 7) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
}

function build(t: { name: string; bg: string; fg: string; palette: string[] }): Theme {
  const p = t.palette
  return {
    ...t,
    panel: mix(t.bg, t.fg, 0.035),
    well: mix(t.bg, t.fg, 0.02),
    line: mix(t.bg, t.fg, 0.1),
    dim: mix(t.bg, t.fg, 0.62),
    faint: mix(t.bg, t.fg, 0.38),
    accent: p[4]!,
    good: p[2]!,
    warn: p[3]!,
    bad: p[1]!,
    kinds: { image: p[6]!, video: p[4]!, audio: p[2]!, pdf: p[1]!, doc: p[3]! },
  }
}
