import type { BlendMode } from '../core/blend'
import { BLEND_MODES } from '../core/blend'
import type { Editor, Tool } from '../core/editor'
import type { Dialog } from './commands'

export interface KeyLike {
  key?: string
  keyChar?: string
  modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean }
}

/** Terminal mode can report a letter as key "space" with the real character in keyChar; prefer the printable char. */
export function normKey(e: KeyLike): string {
  const ch = e.keyChar
  if (!e.modifiers?.ctrl && ch && ch.length === 1 && ch > ' ' && ch !== '\x7f') return ch.toLowerCase()
  return (e.key ?? '').toLowerCase()
}

export const TOOL_KEYS: Record<string, Tool> = { v: 'move', m: 'marquee', o: 'ellipse', l: 'lasso', w: 'wand', b: 'brush', e: 'eraser', k: 'fill', g: 'gradient', i: 'eyedropper', h: 'hand', c: 'crop', t: 'text', s: 'clone', j: 'heal' }

export interface KeyActions {
  exportPng(): void
  exportJpeg(): void
  saveProject(): void
  fit(): void
  zoom(f: number): void
  toggleHelp(): void
  palette?(): void
  dialog?(d: Dialog): void
  actualSize?(): void
  setTool?(t: Tool): void
}

/** The printable character a key event types, if any (terminal mode may report letters as key "space"). */
export function typedChar(e: KeyLike): string | null {
  const m = e.modifiers ?? {}
  if (m.ctrl || m.cmd) return null
  const ch = e.keyChar
  if (ch && ch.length >= 1 && ch >= ' ' && ch !== '\x7f' && [...ch].length === 1) return ch
  if ((e.key ?? '').toLowerCase() === 'space') return ' '
  return null
}

const nextBlend = (m: BlendMode, d: number) => BLEND_MODES[(BLEND_MODES.indexOf(m) + d + BLEND_MODES.length) % BLEND_MODES.length]!

/** Returns true when the key was handled. Ctrl is the modifier: Ghostty owns Cmd. */
export function handleKey(ed: Editor, e: KeyLike, act: KeyActions): boolean {
  const k = normKey(e)
  const m = e.modifiers ?? {}
  const ctrl = !!(m.ctrl || m.cmd)
  if (ctrl) {
    if (k === 'k') act.palette?.()
    else if (k === 't') ed.beginTransform()
    else if (k === 'o') act.dialog?.({ kind: 'open' })
    else if (k === 'p' && m.shift) act.dialog?.({ kind: 'place' })
    else if (k === 'l') ed.addAdjustment('levels')
    else if (k === 'm') ed.addAdjustment('curves')
    else if (k === 'u') ed.addAdjustment('hue-sat')
    else if (k === 'b') ed.addAdjustment('color-balance')
    else if (k === 'i' && m.alt) act.dialog?.({ kind: 'resize' })
    else if (k === 'i' && !m.shift) ed.addAdjustment('invert')
    else if (k === 'e' && m.alt) ed.mergeDown()
    else if (k === 'd' && m.alt) act.dialog?.({ kind: 'feather' })
    else if (k === ']') ed.reorder(1)
    else if (k === '[') ed.reorder(-1)
    else if (k === '1') act.actualSize?.()
    else if (k === 'z' && m.shift) ed.redo()
    else if (k === 'z') ed.undo()
    else if (k === 'y') ed.redo()
    else if (k === 'j') ed.duplicateLayer()
    else if (k === 'd') ed.deselect()
    else if (k === 'a') ed.selectAll()
    else if (k === 'i' && m.shift) ed.invertSelection()
    else if (k === 'e' && m.shift) act.exportJpeg()
    else if (k === 'e') act.exportPng()
    else if (k === 's') act.saveProject()
    else if (k === 'n' && m.shift) ed.addLayer()
    else if (k === '0') act.fit()
    else if (k === '=' || k === '+') act.zoom(1.25)
    else if (k === '-') act.zoom(0.8)
    else return false
    return true
  }
  if (k === 'f6' && m.shift) {
    act.dialog?.({ kind: 'feather' })
    return true
  }
  if (TOOL_KEYS[k]) {
    if (act.setTool) act.setTool(TOOL_KEYS[k]!)
    else {
      ed.tool = TOOL_KEYS[k]!
      ed.emit()
    }
    return true
  }
  const L = ed.layer
  switch (k) {
    case '[':
      ed.brush.size = Math.max(1, Math.round(ed.brush.size / 1.2))
      break
    case ']':
      ed.brush.size = Math.min(600, Math.round(ed.brush.size * 1.2) + 1)
      break
    case 'x':
      ;[ed.fg, ed.bg] = [ed.bg, ed.fg]
      break
    case 'd':
      ed.fg = [255, 255, 255]
      ed.bg = [10, 12, 16]
      break
    case 'f':
      act.fit()
      return true
    case 'q':
      if (L?.mask) ed.editMask = !ed.editMask
      else ed.addMask()
      break
    case '=':
    case '+':
      if (L) ed.setBlend(nextBlend(L.blend, 1))
      return true
    case '-':
      if (L) ed.setBlend(nextBlend(L.blend, -1))
      return true
    case 'backspace':
    case 'delete':
      ed.clear()
      return true
    case 'escape':
      ed.deselect()
      return true
    case 'up':
      ed.select(ed.active + 1)
      return true
    case 'down':
      ed.select(ed.active - 1)
      return true
    case '?':
    case '/':
      act.toggleHelp()
      return true
    default:
      if (/^[0-9]$/.test(k) && L) {
        ed.setOpacity(k === '0' ? 1 : Number(k) / 10)
        return true
      }
      return false
  }
  ed.emit()
  return true
}
