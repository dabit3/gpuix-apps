// Terminal mode reports printable keys as key "space" with the real character in keyChar,
// while a native window reports key "w". Normalise both to one lowercase name.
export interface KeyLike { key?: string; keyChar?: string | null; modifiers?: { control?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean; platform?: boolean; cmd?: boolean } }

export function normKey(e: KeyLike): string {
  const ch = e.keyChar ?? ''
  if (ch.length === 1 && ch.trim()) return ch.toLowerCase()
  const k = (e.key ?? '').toLowerCase()
  if (k === ' ' || (k === 'space' && ch === ' ')) return 'space'
  return k
}

export const isCtrl = (e: KeyLike) => !!(e.modifiers?.control || e.modifiers?.ctrl)
