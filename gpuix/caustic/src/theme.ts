import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Theme { name: string; bg: string; fg: string; palette: string[]; dim: string; faint: string; line: string; panel: string; accent: string; good: string; warn: string; bad: string }

/** GitHub Dark High Contrast as shipped in Ghostty.app: used when no Ghostty theme can be read. */
const FALLBACK = {
  name: 'GitHub Dark High Contrast',
  bg: '#0a0c10',
  fg: '#f0f3f6',
  palette: ['#7a828e', '#ff9492', '#26cd4d', '#f0b72f', '#71b7ff', '#cb9eff', '#39c5cf', '#d9dee3', '#9ea7b3', '#ffb1af', '#4ae168', '#f7c843', '#91cbff', '#dbb7ff', '#56d4dd', '#ffffff'],
}
const THEME_DIRS = [join(homedir(), '.config/ghostty/themes'), '/Applications/Ghostty.app/Contents/Resources/ghostty/themes', '/usr/share/ghostty/themes']
interface Raw { bg?: string; fg?: string; palette: (string | undefined)[] }
const norm = (c: string) => (c.startsWith('#') ? c : `#${c}`).toLowerCase()

export function parseGhostty(text: string, into: Raw, name: { value?: string }) {
  for (const line of text.split('\n')) {
    const m = /^\s*([a-z-]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    const key = m[1]!, value = m[2]!
    if (key === 'theme') name.value = value.includes('dark:') ? /dark:([^,]+)/.exec(value)![1]!.trim() : value.replace(/^"|"$/g, '')
    else if (key === 'background') into.bg = norm(value)
    else if (key === 'foreground') into.fg = norm(value)
    else if (key === 'palette') { const p = /^(\d+)\s*=\s*(\S+)/.exec(value); if (p) into.palette[Number(p[1])] = norm(p[2]!) }
  }
}

/** Reads `theme = …` from the Ghostty config, then the theme file, then the config's own colour overrides. */
export function loadGhosttyTheme(override?: string): Theme {
  const config = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ghostty/config')
  const fromConfig: Raw = { palette: [] }
  const name: { value?: string } = {}
  if (existsSync(config)) parseGhostty(readFileSync(config, 'utf8'), fromConfig, name)
  const themeName = override ?? name.value
  const fromTheme: Raw = { palette: [] }
  let found = false
  if (themeName) for (const dir of THEME_DIRS) {
    const file = join(dir, themeName)
    if (existsSync(file)) { parseGhostty(readFileSync(file, 'utf8'), fromTheme, {}); found = true; break }
  }
  return build({
    name: found ? themeName! : FALLBACK.name,
    bg: (override ? undefined : fromConfig.bg) ?? fromTheme.bg ?? FALLBACK.bg,
    fg: (override ? undefined : fromConfig.fg) ?? fromTheme.fg ?? FALLBACK.fg,
    palette: Array.from({ length: 16 }, (_, i) => (override ? undefined : fromConfig.palette[i]) ?? fromTheme.palette[i] ?? FALLBACK.palette[i]!),
  })
}
export const fallbackTheme = () => build(FALLBACK)

export function rgb(c: string): [number, number, number] {
  const h = c.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
export function mix(a: string, b: string, t: number) {
  const A = rgb(a), B = rgb(b)
  return '#' + A.map((x, i) => Math.round(x + (B[i]! - x) * t).toString(16).padStart(2, '0')).join('')
}
export const alpha = (c: string, a: number) => c.slice(0, 7) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')

function build(t: { name: string; bg: string; fg: string; palette: string[] }): Theme {
  const p = t.palette
  return { ...t, dim: mix(t.bg, t.fg, 0.6), faint: mix(t.bg, t.fg, 0.36), line: mix(t.bg, t.fg, 0.14), panel: mix(t.bg, t.fg, 0.04), accent: p[4]!, good: p[2]!, warn: p[3]!, bad: p[1]! }
}
