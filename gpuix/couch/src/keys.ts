import type { Action } from './controller.ts'

export interface KeyLike { key?: string; keyChar?: string | null; modifiers?: { control?: boolean; platform?: boolean; alt?: boolean; shift?: boolean } }

const NAMED: Record<string, Action> = {
  up: 'up', down: 'down', left: 'left', right: 'right', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
  enter: 'ok', return: 'ok', escape: 'back', backspace: 'back', space: 'play', home: 'home', pageup: 'prev', pagedown: 'next',
}

const CHARS: Record<string, Action> = {
  ' ': 'play', h: 'hud', i: 'info', g: 'home', ']': 'ffwd', '[': 'rew', f: 'ffwd', r: 'rew', n: 'next', p: 'prev', k: 'play',
  w: 'up', a: 'left', s: 'down', d: 'right', b: 'back', q: 'back',
}

/** Keyboard → remote action. Terminal mode may send printable keys as key "space" with the real char in keyChar. */
export function keyToAction(e: KeyLike): Action | null {
  if (e.modifiers?.platform || e.modifiers?.control) return null
  const ch = e.keyChar && e.keyChar.length === 1 ? e.keyChar.toLowerCase() : undefined
  if (ch && ch !== ' ' && CHARS[ch]) return CHARS[ch]!
  const k = (e.key ?? '').toLowerCase()
  if (k.length === 1 && CHARS[k]) return CHARS[k]!
  return NAMED[k] ?? (ch === ' ' ? 'play' : null)
}

/** 1/2/3 jump to Home / Movies / TV Shows. */
export function keyToTab(e: KeyLike): 'home' | 'movies' | 'shows' | null {
  const c = e.keyChar ?? e.key
  return c === '1' ? 'home' : c === '2' ? 'movies' : c === '3' ? 'shows' : null
}
