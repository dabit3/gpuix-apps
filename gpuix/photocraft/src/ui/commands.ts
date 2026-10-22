// One command table drives the menu bar, the command palette and the shortcut hints.
import { ADJUST_LABELS, type AdjustKind } from '../core/adjust'
import type { Editor, Tool } from '../core/editor'
import { FILTER_LABELS, type FilterKind } from '../core/filters'

export type MenuName = 'File' | 'Edit' | 'Image' | 'Layer' | 'Select' | 'Filter' | 'View'
export const MENUS: MenuName[] = ['File', 'Edit', 'Image', 'Layer', 'Select', 'Filter', 'View']

export type Dialog = { kind: 'feather' } | { kind: 'resize' } | { kind: 'rename' } | { kind: 'open' } | { kind: 'place' } | { kind: 'filter'; filter: FilterKind }

export interface AppActions {
  exportPng(): void
  exportJpeg(): void
  saveProject(): void
  /** Open an image or .pcraft in place of the current document; returns an error message on failure. */
  openFile?(path: string): string | void
  /** Add an image file as a new layer; returns an error message on failure. */
  placeFile?(path: string): string | void
}

export interface Ctx {
  ed: Editor
  actions: AppActions
  fit(): void
  zoom(f: number): void
  actualSize(): void
  setTool(t: Tool): void
  dialog(d: Dialog): void
  palette(): void
  help(): void
}

export interface Command {
  id: string
  label: string
  menu: MenuName
  keys?: string
  /** Draw a separator above this item in its menu. */
  sep?: boolean
  /** Hidden from menus (still in the palette). */
  paletteOnly?: boolean
  enabled?: (ed: Editor) => boolean
  run: (c: Ctx) => void
}

const pixel = (ed: Editor) => ed.layer?.kind === 'pixel'
const hasSel = (ed: Editor) => !!ed.selection

const ADJ_KEYS: Partial<Record<AdjustKind, string>> = { levels: '⌃L', curves: '⌃M', 'hue-sat': '⌃U', 'color-balance': '⌃B', invert: '⌃I' }
const ADJ_ORDER: AdjustKind[] = ['levels', 'curves', 'hue-sat', 'brightness-contrast', 'color-balance', 'exposure', 'vibrance', 'black-white', 'invert', 'threshold']
const FILTER_ORDER: FilterKind[] = ['gaussian', 'unsharp', 'motion', 'noise', 'high-pass', 'median']
const FILTER_MENU: Record<FilterKind, string> = { gaussian: 'Gaussian Blur…', unsharp: 'Unsharp Mask…', motion: 'Motion Blur…', noise: 'Add Noise…', 'high-pass': 'High Pass…', median: 'Median…' }

export const TOOL_INFO: { id: Tool; label: string; key: string; icon: string; group: number }[] = [
  { id: 'move', label: 'Move', key: 'V', icon: 'move', group: 0 },
  { id: 'marquee', label: 'Rectangular Marquee', key: 'M', icon: 'marquee', group: 0 },
  { id: 'ellipse', label: 'Elliptical Marquee', key: 'O', icon: 'ellipse', group: 0 },
  { id: 'lasso', label: 'Lasso', key: 'L', icon: 'lasso', group: 0 },
  { id: 'wand', label: 'Magic Wand', key: 'W', icon: 'wand', group: 0 },
  { id: 'crop', label: 'Crop', key: 'C', icon: 'crop', group: 1 },
  { id: 'brush', label: 'Brush', key: 'B', icon: 'brush', group: 2 },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser', group: 2 },
  { id: 'clone', label: 'Clone Stamp', key: 'S', icon: 'clone', group: 2 },
  { id: 'heal', label: 'Spot Healing', key: 'J', icon: 'heal', group: 2 },
  { id: 'fill', label: 'Paint Bucket', key: 'K', icon: 'fill', group: 3 },
  { id: 'gradient', label: 'Gradient', key: 'G', icon: 'gradient', group: 3 },
  { id: 'text', label: 'Type', key: 'T', icon: 'text', group: 3 },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: 'eyedropper', group: 4 },
  { id: 'hand', label: 'Hand', key: 'H', icon: 'hand', group: 4 },
]

export const COMMANDS: Command[] = [
  { id: 'open', label: 'Open…', menu: 'File', keys: '⌃O', run: (c) => c.dialog({ kind: 'open' }) },
  { id: 'place', label: 'Place Image…', menu: 'File', keys: '⌃⇧P', run: (c) => c.dialog({ kind: 'place' }) },
  { id: 'save', label: 'Save Project', menu: 'File', keys: '⌃S', sep: true, run: (c) => c.actions.saveProject() },
  { id: 'export-png', label: 'Export PNG', menu: 'File', keys: '⌃E', run: (c) => c.actions.exportPng() },
  { id: 'export-jpg', label: 'Export JPEG', menu: 'File', keys: '⌃⇧E', run: (c) => c.actions.exportJpeg() },

  { id: 'undo', label: 'Undo', menu: 'Edit', keys: '⌃Z', enabled: (ed) => ed.history.canUndo, run: (c) => c.ed.undo() },
  { id: 'redo', label: 'Redo', menu: 'Edit', keys: '⌃⇧Z', enabled: (ed) => ed.history.canRedo, run: (c) => c.ed.redo() },
  { id: 'transform', label: 'Free Transform', menu: 'Edit', keys: '⌃T', sep: true, enabled: pixel, run: (c) => c.ed.beginTransform() },
  { id: 'clear', label: 'Clear', menu: 'Edit', keys: '⌫', run: (c) => c.ed.clear() },
  { id: 'swap', label: 'Swap Colors', menu: 'Edit', keys: 'X', sep: true, run: (c) => (([c.ed.fg, c.ed.bg] = [c.ed.bg, c.ed.fg]), c.ed.emit()) },
  { id: 'reset-colors', label: 'Default Colors', menu: 'Edit', keys: 'D', run: (c) => ((c.ed.fg = [255, 255, 255]), (c.ed.bg = [10, 12, 16]), c.ed.emit()) },

  ...ADJ_ORDER.map((k, i): Command => ({ id: `adj-${k}`, label: `${ADJUST_LABELS[k]}`, menu: 'Image', keys: ADJ_KEYS[k], sep: i === 0, run: (c) => c.ed.addAdjustment(k) })),
  { id: 'image-size', label: 'Image Size…', menu: 'Image', keys: '⌃⌥I', sep: true, run: (c) => c.dialog({ kind: 'resize' }) },
  { id: 'crop-sel', label: 'Crop to Selection', menu: 'Image', enabled: hasSel, run: (c) => c.ed.selectionBounds && c.ed.crop(c.ed.selectionBounds) },
  { id: 'rot-cw', label: 'Rotate 90° Clockwise', menu: 'Image', sep: true, run: (c) => c.ed.rotateCanvas(1) },
  { id: 'rot-ccw', label: 'Rotate 90° Counter-Clockwise', menu: 'Image', run: (c) => c.ed.rotateCanvas(3) },
  { id: 'rot-180', label: 'Rotate 180°', menu: 'Image', run: (c) => c.ed.rotateCanvas(2) },
  { id: 'flip-h', label: 'Flip Canvas Horizontal', menu: 'Image', run: (c) => c.ed.flipCanvas('h') },
  { id: 'flip-v', label: 'Flip Canvas Vertical', menu: 'Image', run: (c) => c.ed.flipCanvas('v') },

  { id: 'new-layer', label: 'New Layer', menu: 'Layer', keys: '⌃⇧N', run: (c) => c.ed.addLayer() },
  { id: 'dup-layer', label: 'Duplicate Layer', menu: 'Layer', keys: '⌃J', run: (c) => c.ed.duplicateLayer() },
  { id: 'rename-layer', label: 'Rename Layer…', menu: 'Layer', run: (c) => c.dialog({ kind: 'rename' }) },
  { id: 'del-layer', label: 'Delete Layer', menu: 'Layer', enabled: (ed) => ed.doc.layers.length > 1, run: (c) => c.ed.deleteLayer() },
  { id: 'add-mask', label: 'Add Layer Mask', menu: 'Layer', keys: 'Q', sep: true, enabled: (ed) => !ed.layer?.mask, run: (c) => c.ed.addMask() },
  { id: 'del-mask', label: 'Delete Layer Mask', menu: 'Layer', enabled: (ed) => !!ed.layer?.mask, run: (c) => c.ed.deleteMask() },
  { id: 'forward', label: 'Bring Forward', menu: 'Layer', keys: '⌃]', sep: true, enabled: (ed) => ed.active < ed.doc.layers.length - 1, run: (c) => c.ed.reorder(1) },
  { id: 'backward', label: 'Send Backward', menu: 'Layer', keys: '⌃[', enabled: (ed) => ed.active > 0, run: (c) => c.ed.reorder(-1) },
  { id: 'flip-layer-h', label: 'Flip Layer Horizontal', menu: 'Layer', enabled: pixel, run: (c) => c.ed.flipLayer('h') },
  { id: 'flip-layer-v', label: 'Flip Layer Vertical', menu: 'Layer', enabled: pixel, run: (c) => c.ed.flipLayer('v') },
  { id: 'merge-down', label: 'Merge Down', menu: 'Layer', keys: '⌃⌥E', sep: true, enabled: (ed) => ed.doc.layers[ed.active - 1]?.kind === 'pixel', run: (c) => c.ed.mergeDown() },
  { id: 'flatten', label: 'Flatten Image', menu: 'Layer', enabled: (ed) => ed.doc.layers.length > 1, run: (c) => c.ed.flattenImage() },

  { id: 'select-all', label: 'All', menu: 'Select', keys: '⌃A', run: (c) => c.ed.selectAll() },
  { id: 'deselect', label: 'Deselect', menu: 'Select', keys: '⌃D', enabled: hasSel, run: (c) => c.ed.deselect() },
  { id: 'inverse', label: 'Inverse', menu: 'Select', keys: '⌃⇧I', enabled: hasSel, run: (c) => c.ed.invertSelection() },
  { id: 'feather', label: 'Feather…', menu: 'Select', keys: '⇧F6', sep: true, enabled: hasSel, run: (c) => c.dialog({ kind: 'feather' }) },

  ...FILTER_ORDER.map((k): Command => ({ id: `filter-${k}`, label: FILTER_MENU[k], menu: 'Filter', enabled: pixel, run: (c) => c.dialog({ kind: 'filter', filter: k }) })),

  { id: 'zoom-in', label: 'Zoom In', menu: 'View', keys: '⌃+', run: (c) => c.zoom(1.25) },
  { id: 'zoom-out', label: 'Zoom Out', menu: 'View', keys: '⌃−', run: (c) => c.zoom(0.8) },
  { id: 'fit', label: 'Fit on Screen', menu: 'View', keys: '⌃0', run: (c) => c.fit() },
  { id: 'actual', label: 'Actual Pixels', menu: 'View', keys: '⌃1', run: (c) => c.actualSize() },
  { id: 'palette', label: 'Command Palette', menu: 'View', keys: '⌃K', sep: true, run: (c) => c.palette() },
  { id: 'help', label: 'Keyboard Shortcuts', menu: 'View', keys: '?', run: (c) => c.help() },

  ...TOOL_INFO.map((t): Command => ({ id: `tool-${t.id}`, label: `${t.label} Tool`, menu: 'Edit', keys: t.key, paletteOnly: true, run: (c) => c.setTool(t.id) })),
]

/** Subsequence match with bonuses for word starts and contiguous runs; -1 when it doesn't match. */
export function fuzzyScore(q: string, label: string): number {
  if (!q) return 0
  const s = label.toLowerCase()
  q = q.toLowerCase()
  const direct = s.indexOf(q)
  if (direct >= 0) return 1000 - direct * 4 - s.length + (direct === 0 || s[direct - 1] === ' ' ? 200 : 0)
  let score = 0
  let j = 0
  let prev = -2
  for (let i = 0; i < s.length && j < q.length; i++) {
    if (s[i] !== q[j]) continue
    score += i === prev + 1 ? 8 : 1
    if (i === 0 || s[i - 1] === ' ') score += 12
    prev = i
    j++
  }
  return j === q.length ? score : -1
}

export function searchCommands(q: string, ed: Editor): Command[] {
  const base = COMMANDS.filter((c) => !c.enabled || c.enabled(ed))
  if (!q.trim()) return base.filter((c) => ['adj-levels', 'transform', 'crop-sel', 'image-size', 'filter-gaussian', 'export-png', 'place', 'rot-cw', 'feather', 'merge-down', 'tool-text', 'tool-crop'].includes(c.id))
  return base
    .map((c) => ({ c, s: Math.max(fuzzyScore(q, c.label), fuzzyScore(q, `${c.menu} ${c.label}`) - 50) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.c)
}

export const filterLabel = (k: FilterKind) => FILTER_LABELS[k]
