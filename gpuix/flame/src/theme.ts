// Colours from Ghostty's "GitHub Dark High Contrast" theme, so the app
// blends into the terminal it paints in.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { Frame } from './profile.ts'

export const T = {
  bg: '#0a0c10',
  fg: '#f0f3f6',
  muted: '#9ea7b3',
  faint: '#7a828e',
  line: '#272b33',
  panel: '#11141a',
  hover: '#ffffff0d',
  blue: '#71b7ff',
  green: '#26cd4d',
  yellow: '#f0b72f',
  red: '#ff9492',
  cyan: '#39c5cf',
  selected: '#71b7ff26',
}

const mono = ['/Library/Fonts', `${homedir()}/Library/Fonts`].some((d) => existsSync(`${d}/JetBrainsMono-Regular.ttf`))
/** Ghostty's default font when installed, else Menlo. */
export const FONT = mono ? 'JetBrains Mono' : 'Menlo'
export const CHAR_W = mono ? 7.2 : 7.22

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

const cache = new Map<string, { bg: string; fg: string }>()
/** Warm hues per source file for user code, cool greys for runtime frames. */
export function frameColor(f: Frame): { bg: string; fg: string } {
  const hit = cache.get(f.key)
  if (hit) return hit
  let c: { bg: string; fg: string }
  switch (f.kind) {
    case 'root':
      c = { bg: '#2d333b', fg: T.fg }
      break
    case 'gc':
      c = { bg: '#545d68', fg: T.fg }
      break
    case 'native':
    case 'idle':
      c = { bg: '#3a4350', fg: '#d9dee3' }
      break
    case 'regexp':
      c = { bg: '#2f5f7a', fg: '#e6f3ff' }
      break
    case 'runtime':
      c = { bg: '#24727a', fg: '#e6fbff' }
      break
    default: {
      const fh = hash(f.file || f.url)
      const hue = [4, 18, 30, 40, 48][fh % 5]! + (hash(f.name) % 7) - 3
      const light = 0.6 + ((hash(f.name) >>> 3) % 10) / 100
      c = { bg: hsl(hue, 0.92, light), fg: '#0a0c10' }
    }
  }
  cache.set(f.key, c)
  return c
}
