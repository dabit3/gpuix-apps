/** Pure mapping from GPUIX input events to Chrome DevTools Protocol Input.* params. */

export interface Box { x: number; y: number; width: number; height: number }
export interface Mods { ctrl?: boolean; cmd?: boolean; shift?: boolean; alt?: boolean; platform?: boolean; function?: boolean }

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function cdpModifiers(m?: Mods): number {
  if (!m) return 0
  return (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.cmd || m.platform ? 4 : 0) | (m.shift ? 8 : 0)
}

/**
 * Maps a window-space pointer position onto page CSS pixels.
 * `box` is where the page image is laid out (GPUIX logical px); `view` is the page viewport in CSS px.
 * Points outside the box clamp to its edge so drags that leave the page still track.
 */
export function mapPoint(x: number, y: number, box: Box, view: { width: number; height: number }) {
  const sx = box.width > 0 ? view.width / box.width : 1
  const sy = box.height > 0 ? view.height / box.height : 1
  const cx = Math.min(Math.max(x - box.x, 0), Math.max(box.width - 1, 0))
  const cy = Math.min(Math.max(y - box.y, 0), Math.max(box.height - 1, 0))
  return { x: Math.round(cx * sx * 100) / 100, y: Math.round(cy * sy * 100) / 100 }
}

/**
 * Picks the Chrome viewport and frame size for a page box.
 * The viewport stays in CSS px (= GPUIX logical px); frames are captured at `dpr` device px per CSS px,
 * so the frame uploaded to `<img>` maps 1:1 onto physical terminal pixels.
 */
export function viewportFor(box: { width: number; height: number }, dpr: number) {
  const scale = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 3) : 1
  const width = Math.max(1, Math.floor(box.width))
  const height = Math.max(1, Math.floor(box.height))
  return { width, height, deviceScaleFactor: scale, frameWidth: Math.round(width * scale), frameHeight: Math.round(height * scale) }
}

export type CdpButton = 'none' | 'left' | 'middle' | 'right'
/** GPUIX reports left as 0, middle 1, right 2 (0 is a real button, not "none"). */
export function cdpButton(b: number | null | undefined): CdpButton {
  if (b == null) return 'none'
  return b === 0 ? 'left' : b === 1 ? 'middle' : b === 2 ? 'right' : 'none'
}
/** `buttons` bitmask for mouseMoved while a button is held. */
export function cdpButtons(b: number | null | undefined): number {
  return b == null ? 0 : b === 0 ? 1 : b === 1 ? 4 : b === 2 ? 2 : 0
}

/**
 * GPUI wheel deltas are positive when content should move down (wheel up); CDP's mouseWheel deltaY is positive to scroll down.
 * Precise (trackpad / terminal pixel) deltas are pixels; line deltas are scaled to 40 px a line like Chrome.
 */
export function wheelDelta(dx: number, dy: number, precise: boolean | undefined, lineHeight = 40) {
  const k = precise ? 1 : lineHeight
  return { deltaX: -dx * k, deltaY: -dy * k }
}

interface KeyDef { key: string; code: string; keyCode: number; text?: string }
const SPECIAL: Record<string, KeyDef> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
}
for (let i = 1; i <= 12; i++) SPECIAL[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i }

const SHIFTED_DIGITS = ')!@#$%^&*('
const PUNCT: Record<string, [string, number]> = {
  '-': ['Minus', 189], '_': ['Minus', 189], '=': ['Equal', 187], '+': ['Equal', 187], '[': ['BracketLeft', 219], '{': ['BracketLeft', 219],
  ']': ['BracketRight', 221], '}': ['BracketRight', 221], '\\': ['Backslash', 220], '|': ['Backslash', 220], ';': ['Semicolon', 186], ':': ['Semicolon', 186],
  "'": ['Quote', 222], '"': ['Quote', 222], ',': ['Comma', 188], '<': ['Comma', 188], '.': ['Period', 190], '>': ['Period', 190],
  '/': ['Slash', 191], '?': ['Slash', 191], '`': ['Backquote', 192], '~': ['Backquote', 192],
}

function charDef(ch: string): KeyDef {
  const lower = ch.toLowerCase()
  if (/^[a-z]$/.test(lower)) return { key: ch, code: `Key${lower.toUpperCase()}`, keyCode: lower.toUpperCase().charCodeAt(0), text: ch }
  if (/^[0-9]$/.test(ch)) return { key: ch, code: `Digit${ch}`, keyCode: ch.charCodeAt(0), text: ch }
  const sd = SHIFTED_DIGITS.indexOf(ch)
  if (sd >= 0) return { key: ch, code: `Digit${sd}`, keyCode: 48 + sd, text: ch }
  const p = PUNCT[ch]
  if (p) return { key: ch, code: p[0], keyCode: p[1], text: ch }
  return { key: ch, code: '', keyCode: 0, text: ch }
}

export interface KeyLike { key?: string; keyChar?: string | null; modifiers?: Mods }

/**
 * The printable character a key event carries, if any. Terminal mode can report a letter as
 * key "space" with the real character in keyChar, so keyChar wins whenever it is a single printable char.
 */
export function printable(e: KeyLike): string | null {
  const ch = e.keyChar
  if (ch && [...ch].length === 1 && ch >= ' ' && ch !== '\x7f') return ch
  const k = e.key ?? ''
  if (k === 'space') return ' '
  if ([...k].length === 1 && k >= ' ') return e.modifiers?.shift ? k.toUpperCase() : k
  return null
}

export type KeyEventParams = { type: 'keyDown' | 'rawKeyDown' | 'keyUp' | 'char'; key: string; code: string; windowsVirtualKeyCode: number; nativeVirtualKeyCode: number; modifiers: number; text?: string; unmodifiedText?: string; autoRepeat?: boolean; commands?: string[] }

/** Down + up CDP events for one GPUIX key press, or null if the key has no page meaning. */
export function keyEvents(e: KeyLike, repeat = false): KeyEventParams[] | null {
  const mods = cdpModifiers(e.modifiers)
  const name = (e.key ?? '').toLowerCase()
  const editing = !!(e.modifiers?.ctrl || e.modifiers?.cmd || e.modifiers?.alt)
  let def: KeyDef | undefined = SPECIAL[name]
  if (!def || name === 'space') {
    const ch = printable(e)
    if (ch != null) def = ch === ' ' ? SPECIAL.space : charDef(ch)
  }
  if (!def) return null
  const withText = def.text != null && !editing
  const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode, modifiers: mods }
  const down: KeyEventParams = withText
    ? { type: 'keyDown', ...base, text: def.text, unmodifiedText: def.text!.toLowerCase(), autoRepeat: repeat }
    : { type: 'rawKeyDown', ...base, autoRepeat: repeat }
  const cmd = editCommand(name, def.key, e.modifiers)
  if (cmd) down.commands = [cmd]
  return [down, { type: 'keyUp', ...base }]
}

/** Headless Chrome has no OS edit menu, so selection/clipboard shortcuts must be sent as editing commands. */
function editCommand(name: string, key: string, m?: Mods): string | undefined {
  if (!(m?.ctrl || m?.cmd)) return undefined
  const k = key.length === 1 ? key.toLowerCase() : name
  return ({ a: 'selectAll', z: m.shift ? 'redo' : 'undo', y: 'redo', backspace: 'deleteWordBackward', delete: 'deleteWordForward' } as Record<string, string>)[k]
}
