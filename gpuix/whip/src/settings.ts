import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { POLITE, SPICY } from './messages'
import { whipHome } from './protocol'

export interface Settings {
  polite: boolean
  sound: boolean
  length: number
  messages: { polite: string[]; spicy: string[] }
  seenIntro: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  polite: true,
  sound: true,
  length: 420,
  messages: { polite: POLITE, spicy: SPICY },
  seenIntro: false,
}

export function settingsPath() {
  return join(whipHome(), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    if (existsSync(settingsPath())) {
      const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'))
      return {
        ...DEFAULT_SETTINGS,
        ...raw,
        messages: { ...DEFAULT_SETTINGS.messages, ...(raw.messages ?? {}) },
      }
    }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s: Settings) {
  try {
    mkdirSync(whipHome(), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2) + '\n')
  } catch {}
}
