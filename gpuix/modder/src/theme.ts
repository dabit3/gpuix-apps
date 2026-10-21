import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Theme { bg: string; fg: string; dim: string; faint: string; panel: string; panel2: string; line: string; accent: string; good: string; warn: string; bad: string; cyan: string; orange: string }

const THEME_DIRS = ['/Applications/Ghostty.app/Contents/Resources/ghostty/themes', join(homedir(), '.config/ghostty/themes')]

// GitHub Dark High Contrast, the theme the demo Ghostty uses; also the fallback when no theme is found.
export function fallbackTheme(): Theme {
  return { bg: '#0a0c10', fg: '#f0f3f6', dim: '#9ea7b3', faint: '#7a828e', panel: '#12161d', panel2: '#191e27', line: '#272d38', accent: '#71b7ff', good: '#26cd4d', warn: '#f0b72f', bad: '#ff9492', cyan: '#39c5cf', orange: '#ffb1af' }
}

export function loadGhosttyTheme(name?: string): Theme {
  const t = fallbackTheme()
  let theme = name
  if (!theme) {
    const cfg = join(homedir(), '.config/ghostty/config')
    if (existsSync(cfg)) theme = /^\s*theme\s*=\s*(.+?)\s*$/m.exec(readFileSync(cfg, 'utf8'))?.[1]
  }
  if (!theme) return t
  for (const d of THEME_DIRS) {
    const f = join(d, theme)
    if (!existsSync(f)) continue
    const kv: Record<string, string> = {}
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^\s*(palette\s*=\s*(\d+)|[\w-]+)\s*=\s*(#[0-9a-fA-F]{6})/.exec(line)
      if (m) kv[m[2] != null ? `p${m[2]}` : m[1]!] = m[3]!
    }
    return {
      ...t,
      bg: kv.background ?? t.bg,
      fg: kv.foreground ?? t.fg,
      dim: kv.p8 ?? t.dim,
      faint: kv.p0 ?? t.faint,
      accent: kv.p4 ?? t.accent,
      good: kv.p2 ?? t.good,
      warn: kv.p3 ?? t.warn,
      bad: kv.p1 ?? t.bad,
      cyan: kv.p6 ?? t.cyan,
      orange: kv.p9 ?? t.orange,
    }
  }
  return t
}

export function alpha(hex: string, a: number) {
  return hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
}
