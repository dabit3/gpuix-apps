import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface TerminalTheme { name: string; bg: string; fg: string; found: boolean }

/** GitHub Dark High Contrast, as shipped in Ghostty.app. */
export const FALLBACK_THEME: TerminalTheme = { name: 'GitHub Dark High Contrast', bg: '#0a0c10', fg: '#f0f3f6', found: false }

const THEME_DIRS = [join(homedir(), '.config/ghostty/themes'), '/Applications/Ghostty.app/Contents/Resources/ghostty/themes', '/usr/share/ghostty/themes']
const norm = (c: string) => (c.startsWith('#') ? c : `#${c}`).toLowerCase()

function read(text: string) {
  const out: { theme?: string; bg?: string; fg?: string } = {}
  for (const line of text.split('\n')) {
    const m = /^\s*([a-z-]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    const key = m[1]!, value = m[2]!.replace(/^"|"$/g, '')
    if (key === 'theme') out.theme = /dark:([^,]+)/.exec(value)?.[1]?.trim() ?? value
    else if (key === 'background') out.bg = norm(value)
    else if (key === 'foreground') out.fg = norm(value)
  }
  return out
}

/** Background and foreground of the Ghostty theme (config `theme = …`, or `override`), so the piece blends into the pane. */
export function loadTerminalTheme(override?: string): TerminalTheme {
  const cfgPath = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'ghostty/config')
  const cfg = existsSync(cfgPath) ? read(readFileSync(cfgPath, 'utf8')) : {}
  const name = override ?? cfg.theme
  if (name) {
    for (const dir of THEME_DIRS) {
      const file = join(dir, name)
      if (!existsSync(file)) continue
      const t = read(readFileSync(file, 'utf8'))
      return { name, bg: (override ? undefined : cfg.bg) ?? t.bg ?? FALLBACK_THEME.bg, fg: (override ? undefined : cfg.fg) ?? t.fg ?? FALLBACK_THEME.fg, found: true }
    }
  }
  return { ...FALLBACK_THEME, bg: cfg.bg ?? FALLBACK_THEME.bg, fg: cfg.fg ?? FALLBACK_THEME.fg }
}
