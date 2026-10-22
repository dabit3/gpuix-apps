// Local UI preferences (not secrets): ~/.config/devin-tui/prefs.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export type Prefs = {
  theme?: 'dark' | 'light'
  mode?: string
  repo?: string
  /** Unix seconds; notifications updated after this are unread. */
  readAt?: number
  /** Local title overrides (the public API has no rename). */
  titles?: Record<string, string>
  /** UI zoom (⌘+ / ⌘− / ⌘0), 0.75–2. */
  zoom?: number
}

export function prefsPath(env: Record<string, string | undefined> = process.env) {
  return env.DEVIN_TUI_PREFS ?? `${env.HOME ?? ''}/.config/devin-tui/prefs.json`
}

export function loadPrefs(path = prefsPath()): Prefs {
  if (process.env.NODE_ENV === 'test' && !process.env.DEVIN_TUI_PREFS) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Prefs
  } catch {
    return {}
  }
}

export function savePrefs(p: Prefs, path = prefsPath()) {
  if (process.env.NODE_ENV === 'test' && !process.env.DEVIN_TUI_PREFS) return
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(p, null, 2))
  } catch {}
}
