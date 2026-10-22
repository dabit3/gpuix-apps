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
  blocked: string
  forwarded: string
  cached: string
  warn: string
  failed: string
}

/** GitHub Dark High Contrast, as shipped in Ghostty.app. */
const FALLBACK = {
  name: 'GitHub Dark High Contrast',
  bg: '#0a0c10',
  fg: '#f0f3f6',
  palette: ['#7a828e', '#ff9492', '#26cd4d', '#f0b72f', '#71b7ff', '#cb9eff', '#39c5cf', '#d9dee3', '#9ea7b3', '#ffb1af', '#4ae168', '#f7c843', '#91cbff', '#dbb7ff', '#56d4dd', '#ffffff'],
}

const THEME_DIRS = [join(homedir(), '.config/ghostty/themes'), '/Applications/Ghostty.app/Contents/Resources/ghostty/themes', '/usr/share/ghostty/themes']
const norm = (c: string) => (c.startsWith('#') ? c : `#${c}`).toLowerCase()

interface Raw { bg?: string; fg?: string; palette: (string | undefined)[]; theme?: string }
function parse(text: string): Raw {
  const r: Raw = { palette: [] }
  for (const line of text.split('\n')) {
    const m = /^\s*([a-z-]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    const key = m[1]!, value = m[2]!
    if (key === 'theme') r.theme = value.includes('dark:') ? /dark:([^,]+)/.exec(value)![1]!.trim() : value.replace(/^"|"$/g, '')
    else if (key === 'background') r.bg = norm(value)
    else if (key === 'foreground') r.fg = norm(value)
    else if (key === 'palette') {
      const p = /^(\d+)\s*=\s*(\S+)/.exec(value)
      if (p) r.palette[Number(p[1])] = norm(p[2]!)
    }
  }
  return r
}

/** Paints with the terminal's own colors: the Ghostty config's theme, then its overrides. */
export function loadGhosttyTheme(override?: string): Theme {
  const configPath = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ghostty/config')
  const cfg = existsSync(configPath) ? parse(readFileSync(configPath, 'utf8')) : { palette: [] as (string | undefined)[] } as Raw
  const name = override ?? cfg.theme
  let th: Raw = { palette: [] }
  if (name) for (const d of THEME_DIRS) if (existsSync(join(d, name))) { th = parse(readFileSync(join(d, name), 'utf8')); break }
  const found = !!th.bg
  const pick = (i: number) => (override ? undefined : cfg.palette[i]) ?? th.palette[i] ?? FALLBACK.palette[i]!
  return build({
    name: found ? name! : FALLBACK.name,
    bg: (override ? undefined : cfg.bg) ?? th.bg ?? FALLBACK.bg,
    fg: (override ? undefined : cfg.fg) ?? th.fg ?? FALLBACK.fg,
    palette: Array.from({ length: 16 }, (_, i) => pick(i)),
  })
}

export const fallbackTheme = () => build(FALLBACK)

function hex(c: string) { const h = c.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
export function mix(a: string, b: string, t: number) {
  const [ar, ag, ab] = hex(a), [br, bg, bb] = hex(b)
  const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${m(ar!, br!)}${m(ag!, bg!)}${m(ab!, bb!)}`
}
export const alpha = (c: string, a: number) => c.slice(0, 7) + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')

function build(t: { name: string; bg: string; fg: string; palette: string[] }): Theme {
  const p = t.palette
  return {
    ...t,
    panel: mix(t.bg, t.fg, 0.04),
    raised: mix(t.bg, t.fg, 0.08),
    line: mix(t.bg, t.fg, 0.13),
    dim: mix(t.bg, t.fg, 0.64),
    faint: mix(t.bg, t.fg, 0.4),
    accent: p[4]!,
    blocked: p[1]!,
    forwarded: p[2]!,
    cached: p[6]!,
    warn: p[3]!,
    failed: p[8]!,
  }
}
