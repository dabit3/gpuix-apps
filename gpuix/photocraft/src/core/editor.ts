import { ADJUST_LABELS, defaultAdjust, type Adjust, type AdjustKind } from './adjust'
import type { BlendMode } from './blend'
import { StrokeEngine, stampDab } from './brush'
import { compositeRect, flatten } from './composite'
import { adjustLayer, bumpIds, clipRect, fullRect, pixelLayer, unionRect, type AdjustLayer, type Doc, type Layer, type PixelLayer, type Rect } from './doc'
import { FILTER_DEFAULT, FILTER_LABELS, runFilter, type FilterKind } from './filters'
import { applyTiles, diffBytes, diffRect, diffTiles, History, type Command, type TileDiff } from './history'
import { decodeImage, encodePng, type RGBAImage } from './io'
import { combine, ellipseMask, magicWand, maskBounds, polygonMask, rectMask, type SelectOp } from './selection'
import { readZip, writeZip } from './zip'
import { affineBuf, alphaBounds, cropBuf, featherMask, flipBuf, inpaint, resizeBuf, rotateBuf, type Xform } from './geometry'
import { renderText, textBounds, type TextSpec } from './text'

export type Tool = 'move' | 'marquee' | 'ellipse' | 'lasso' | 'wand' | 'crop' | 'brush' | 'eraser' | 'clone' | 'heal' | 'fill' | 'gradient' | 'text' | 'eyedropper' | 'hand'

export type RGB = [number, number, number]

export interface BrushOpts {
  size: number
  hardness: number
  opacity: number
  flow: number
  spacing: number
}

export class Editor {
  doc: Doc
  comp: Uint8ClampedArray
  history = new History()
  selection: Uint8Array | null = null
  selectionBounds: Rect | null = null
  active = 0
  /** Paint into the active layer's mask instead of its pixels. */
  editMask = false
  tool: Tool = 'brush'
  fg: RGB = [255, 255, 255]
  bg: RGB = [10, 12, 16]
  brush: BrushOpts = { size: 48, hardness: 0.35, opacity: 1, flow: 0.9, spacing: 0.12 }
  tolerance = 32
  contiguous = true
  filterAmount: Record<FilterKind, number> = { ...FILTER_DEFAULT }
  /** Doc rect whose composite is stale. */
  dirty: Rect | null = null
  /** Bumped on every change the UI should re-render for. */
  version = 0
  selVersion = 0
  lastAction = ''
  private listeners = new Set<() => void>()
  private stroke: { engine: StrokeEngine; cov: Float32Array; base: Uint8ClampedArray | Uint8Array; target: 'pixels' | 'mask'; layer: PixelLayer | AdjustLayer; erase: boolean; rect: Rect | null; color: RGB; mode: 'paint' | 'clone' | 'heal'; ox: number; oy: number; text?: TextSpec } | null = null
  /** Clone stamp source point (doc space), set with Alt-click. */
  cloneSource: { x: number; y: number } | null = null
  gradientShape: 'linear' | 'radial' = 'linear'
  textSize = 72
  /** Bumped whenever the canvas size changes (crop, rotate, resize). */
  docVersion = 0
  /** Live text editing session. */
  textEdit: { layer: PixelLayer; prev: TextSpec | null; prevPixels: Uint8ClampedArray | null; at: number } | null = null
  /** Live free transform session. */
  xf: { layer: PixelLayer; orig: Uint8ClampedArray; box: Rect; t: Xform } | null = null
  private lastPaint: { x: number; y: number } | null = null

  constructor(doc: Doc) {
    this.doc = doc
    this.comp = flatten(doc)
    this.active = doc.layers.length - 1
  }

  static fromImage(img: RGBAImage, name: string) {
    return new Editor({ width: img.width, height: img.height, name, layers: [pixelLayer(img.width, img.height, 'Background', new Uint8ClampedArray(img.data))] })
  }

  static blank(w: number, h: number, color: RGB = [255, 255, 255]) {
    const px = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < px.length; i += 4) (px[i] = color[0]), (px[i + 1] = color[1]), (px[i + 2] = color[2]), (px[i + 3] = 255)
    return new Editor({ width: w, height: h, name: 'Untitled', layers: [pixelLayer(w, h, 'Background', px)] })
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  emit(action?: string) {
    if (action) this.lastAction = action
    this.version++
    for (const fn of this.listeners) fn()
  }

  get layer(): Layer | undefined {
    return this.doc.layers[this.active]
  }

  invalidate(r: Rect | null = fullRect(this.doc)) {
    if (!r) return
    const c = clipRect(r, this.doc.width, this.doc.height)
    if (c) this.dirty = unionRect(this.dirty, c)
  }

  /** Re-composite the stale rect; returns it so the viewport can redraw just that part. */
  flush(): Rect | null {
    const d = this.dirty
    if (!d) return null
    this.dirty = null
    compositeRect(this.doc, this.comp, d)
    return d
  }

  // ---------- history helpers ----------

  private pushPixelDiff(label: string, d: TileDiff, rasterized?: { layer: PixelLayer; text: TextSpec }) {
    if (!d.tiles.length) {
      if (rasterized) rasterized.layer.text = rasterized.text
      return
    }
    const rect = diffRect(d)
    this.history.push({
      label,
      bytes: diffBytes(d),
      undo: () => {
        applyTiles(d, 'before')
        if (rasterized) rasterized.layer.text = rasterized.text
        this.invalidate(rect)
      },
      redo: () => {
        applyTiles(d, 'after')
        if (rasterized) delete rasterized.layer.text
        this.invalidate(rect)
      },
    })
  }

  private command(c: Command) {
    c.redo()
    this.history.push(c)
    this.emit(c.label)
  }

  undo() {
    const c = this.history.undo()
    if (c) this.emit(`Undo ${c.label}`)
  }

  redo() {
    const c = this.history.redo()
    if (c) this.emit(`Redo ${c.label}`)
  }

  jumpTo(n: number) {
    this.history.jumpTo(n)
    this.emit()
  }

  // ---------- painting ----------

  /** The buffer a pixel tool writes into, or null when the target can't be painted (adjustment layer pixels). */
  private paintTarget(): { layer: Layer; buf: Uint8ClampedArray | Uint8Array; target: 'pixels' | 'mask' } | null {
    const L = this.layer
    if (!L) return null
    if (this.editMask) {
      if (!L.mask) return null
      return { layer: L, buf: L.mask, target: 'mask' }
    }
    if (L.kind !== 'pixel') return null
    return { layer: L, buf: L.pixels, target: 'pixels' }
  }

  canPaint() {
    return this.paintTarget() !== null
  }

  beginStroke(x: number, y: number, erase = this.tool === 'eraser', from: { x: number; y: number } | null = null) {
    const t = this.paintTarget()
    if (!t) return false
    const mode = t.target === 'pixels' && (this.tool === 'clone' || this.tool === 'heal') ? this.tool : 'paint'
    if (mode === 'clone' && !this.cloneSource) {
      this.cloneSource = { x, y }
      this.emit('Clone source set · Alt-click to change')
      return false
    }
    const text = t.target === 'pixels' ? (t.layer as PixelLayer).text : undefined
    if (text) delete (t.layer as PixelLayer).text
    const { width: w, height: h } = this.doc
    const cov = new Float32Array(w * h)
    const radius = this.brush.size / 2
    const spacing = Math.max(0.6, this.brush.size * this.brush.spacing)
    const s = (this.stroke = {
      engine: null as unknown as StrokeEngine,
      cov,
      base: t.buf.slice(),
      target: t.target,
      layer: t.layer as PixelLayer,
      erase,
      rect: null as Rect | null,
      color: [...this.fg] as RGB,
      mode: mode as 'paint' | 'clone' | 'heal',
      ox: mode === 'clone' ? Math.round(this.cloneSource!.x - x) : 0,
      oy: mode === 'clone' ? Math.round(this.cloneSource!.y - y) : 0,
      text,
    })
    s.engine = new StrokeEngine(spacing, (cx, cy) => {
      const r = stampDab(cov, w, h, cx, cy, radius, this.brush.hardness, this.brush.flow)
      this.applyStroke(r)
      s.rect = unionRect(s.rect, r)
    })
    if (from) s.engine.add(from.x, from.y)
    s.engine.add(x, y)
    this.lastPaint = { x, y }
    return true
  }

  /** Last stroke end point, for Shift-click straight lines. */
  get lastPoint() {
    return this.lastPaint
  }

  strokeTo(x: number, y: number) {
    this.stroke?.engine.add(x, y)
    if (this.stroke) this.lastPaint = { x, y }
  }

  endStroke() {
    const s = this.stroke
    if (!s) return
    s.engine.end()
    this.stroke = null
    if (!s.rect) return
    const { width: w, height: h } = this.doc
    const buf = s.target === 'mask' ? s.layer.mask! : (s.layer as PixelLayer).pixels
    if (s.mode === 'heal') {
      const healed = inpaint(s.base as Uint8ClampedArray, w, h, s.cov, s.rect)
      const px = buf as Uint8ClampedArray
      const base = s.base as Uint8ClampedArray
      for (let y = s.rect.y0; y < s.rect.y1; y++)
        for (let x = s.rect.x0; x < s.rect.x1; x++) {
          const i = y * w + x
          let a = Math.min(1, s.cov[i]! * 1.6)
          if (this.selection) a *= this.selection[i]! / 255
          const q = i * 4
          for (let c = 0; c < 4; c++) px[q + c] = base[q + c]! + (healed[q + c]! - base[q + c]!) * a
        }
      this.invalidate(s.rect)
    }
    const label = s.target === 'mask' ? (s.erase ? 'Reveal Mask' : 'Hide Mask') : s.mode === 'clone' ? 'Clone Stamp' : s.mode === 'heal' ? 'Spot Healing' : s.erase ? 'Eraser' : 'Brush'
    this.pushPixelDiff(label, diffTiles(s.base, buf, w, h, s.target === 'mask' ? 1 : 4, s.rect), s.text ? { layer: s.layer as PixelLayer, text: s.text } : undefined)
    this.emit(label)
  }

  get strokeDabs() {
    return this.stroke?.engine.dabs ?? 0
  }

  private applyStroke(r: Rect) {
    const s = this.stroke!
    const { width: w } = this.doc
    const op = this.brush.opacity
    const sel = this.selection
    if (s.target === 'mask') {
      const m = s.layer.mask!
      const base = s.base as Uint8Array
      for (let y = r.y0; y < r.y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const i = y * w + x
          let a = s.cov[i]! * op
          if (sel) a *= sel[i]! / 255
          if (a <= 0) continue
          // Brush hides (paints black into the mask), eraser reveals.
          m[i] = s.erase ? base[i]! + (255 - base[i]!) * a : base[i]! * (1 - a)
        }
      }
    } else {
      const px = (s.layer as PixelLayer).pixels
      const base = s.base as Uint8ClampedArray
      const [cr, cg, cb] = s.color
      for (let y = r.y0; y < r.y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const i = y * w + x
          let a = s.cov[i]! * op
          if (sel) a *= sel[i]! / 255
          if (a <= 0) continue
          const q = i * 4
          const ba = base[q + 3]! / 255
          if (s.mode === 'clone') {
            const sx = x + s.ox
            const sy = y + s.oy
            if (sx < 0 || sy < 0 || sx >= w || sy >= this.doc.height) continue
            const sq = (sy * w + sx) * 4
            for (let c = 0; c < 4; c++) px[q + c] = base[q + c]! + (base[sq + c]! - base[q + c]!) * a
            continue
          }
          if (s.mode === 'heal') {
            // Live feedback while painting the spot; the real fill happens on release.
            for (let c = 0; c < 3; c++) px[q + c] = base[q + c]! * (1 - a * 0.45)
            px[q + 3] = base[q + 3]!
            continue
          }
          if (s.erase) {
            px[q] = base[q]!
            px[q + 1] = base[q + 1]!
            px[q + 2] = base[q + 2]!
            px[q + 3] = base[q + 3]! * (1 - a)
            continue
          }
          const ao = a + ba * (1 - a)
          const k = (ba * (1 - a)) / (ao || 1)
          px[q] = cr * (a / (ao || 1)) + base[q]! * k
          px[q + 1] = cg * (a / (ao || 1)) + base[q + 1]! * k
          px[q + 2] = cb * (a / (ao || 1)) + base[q + 2]! * k
          px[q + 3] = ao * 255
        }
      }
    }
    this.invalidate(r)
  }

  // ---------- fill, gradient, filters ----------

  /** Run `edit` on the paint target and record the changed tiles. */
  private editPixels(label: string, edit: (buf: Uint8ClampedArray | Uint8Array, target: 'pixels' | 'mask') => Rect | null) {
    const t = this.paintTarget()
    if (!t) {
      this.emit(this.editMask ? 'Add a mask first' : 'Pick a pixel layer')
      return false
    }
    const before = t.buf.slice()
    const text = t.target === 'pixels' ? (t.layer as PixelLayer).text : undefined
    if (text) delete (t.layer as PixelLayer).text
    const r = edit(t.buf, t.target)
    if (!r) {
      if (text) (t.layer as PixelLayer).text = text
      return false
    }
    this.pushPixelDiff(label, diffTiles(before, t.buf, this.doc.width, this.doc.height, t.target === 'mask' ? 1 : 4, r), text ? { layer: t.layer as PixelLayer, text } : undefined)
    this.invalidate(r)
    this.emit(label)
    return true
  }

  /** Blend `src` into `buf` through the selection (everything when nothing is selected). */
  private mixThroughSelection(buf: Uint8ClampedArray, src: Uint8ClampedArray, cov?: Float32Array | Uint8Array) {
    const sel = this.selection
    const n = this.doc.width * this.doc.height
    for (let i = 0; i < n; i++) {
      let a = sel ? sel[i]! / 255 : 1
      if (cov) a *= cov instanceof Float32Array ? cov[i]! : cov[i]! / 255
      if (a <= 0) continue
      const q = i * 4
      if (a >= 1) {
        buf[q] = src[q]!
        buf[q + 1] = src[q + 1]!
        buf[q + 2] = src[q + 2]!
        buf[q + 3] = src[q + 3]!
      } else {
        for (let c = 0; c < 4; c++) buf[q + c] = buf[q + c]! + (src[q + c]! - buf[q + c]!) * a
      }
    }
  }

  fill(x: number, y: number) {
    const { width: w, height: h } = this.doc
    return this.editPixels('Fill', (buf, target) => {
      if (target === 'mask') {
        const m = buf as Uint8Array
        const sel = this.selection
        for (let i = 0; i < m.length; i++) m[i] = sel ? m[i]! * (1 - sel[i]! / 255) : 0
        return fullRect(this.doc)
      }
      const px = buf as Uint8ClampedArray
      const region = magicWand(px, w, h, x, y, this.tolerance, this.contiguous)
      const src = new Uint8ClampedArray(px.length)
      for (let i = 0; i < w * h; i++) (src[i * 4] = this.fg[0]), (src[i * 4 + 1] = this.fg[1]), (src[i * 4 + 2] = this.fg[2]), (src[i * 4 + 3] = 255)
      this.mixThroughSelection(px, src, region)
      return maskBounds(region, w, h)
    })
  }

  /** Linear fg → transparent-to-bg gradient from a to b, through the selection. */
  gradient(ax: number, ay: number, bx: number, by: number) {
    const { width: w, height: h } = this.doc
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy || 1
    return this.editPixels('Gradient', (buf, target) => {
      if (target === 'mask') {
        const m = buf as Uint8Array
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const t = this.gradientT(x, y, ax, ay, dx, dy, len2)
            const i = y * w + x
            const a = this.selection ? this.selection[i]! / 255 : 1
            m[i] = m[i]! + (t * 255 - m[i]!) * a
          }
        return fullRect(this.doc)
      }
      const px = buf as Uint8ClampedArray
      const src = new Uint8ClampedArray(px.length)
      const cov = new Float32Array(w * h)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const t = this.gradientT(x, y, ax, ay, dx, dy, len2)
          const i = y * w + x
          src[i * 4] = this.fg[0] + (this.bg[0] - this.fg[0]) * t
          src[i * 4 + 1] = this.fg[1] + (this.bg[1] - this.fg[1]) * t
          src[i * 4 + 2] = this.fg[2] + (this.bg[2] - this.fg[2]) * t
          src[i * 4 + 3] = 255
          cov[i] = this.brush.opacity
        }
      this.mixThroughSelection(px, src, cov)
      return fullRect(this.doc)
    })
  }

  private gradientT(x: number, y: number, ax: number, ay: number, dx: number, dy: number, len2: number) {
    if (this.gradientShape === 'radial') return Math.min(1, Math.hypot(x + 0.5 - ax, y + 0.5 - ay) / Math.sqrt(len2))
    return Math.min(1, Math.max(0, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / len2))
  }

  applyFilter(kind: FilterKind, amount = this.filterAmount[kind]) {
    const L = this.layer
    if (!L || L.kind !== 'pixel') {
      this.emit('Filters run on pixel layers')
      return false
    }
    const was = this.editMask
    this.editMask = false
    const ok = this.editPixels(FILTER_LABELS[kind], (buf) => {
      const px = buf as Uint8ClampedArray
      const out = runFilter(kind, px, this.doc.width, this.doc.height, amount, this.history.index + 1)
      this.mixThroughSelection(px, out)
      return this.selectionBounds ?? fullRect(this.doc)
    })
    this.editMask = was
    return ok
  }

  eyedrop(x: number, y: number): RGB | null {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= this.doc.width || yi >= this.doc.height) return null
    const q = (yi * this.doc.width + xi) * 4
    this.fg = [this.comp[q]!, this.comp[q + 1]!, this.comp[q + 2]!]
    this.emit('Eyedropper')
    return this.fg
  }

  /** Bake a move of the active layer (pixels and mask) by dx, dy. */
  moveLayer(dx: number, dy: number) {
    dx = Math.round(dx)
    dy = Math.round(dy)
    const L = this.layer
    if (!L || L.kind !== 'pixel' || (!dx && !dy)) return
    const { width: w, height: h } = this.doc
    const shift = <T extends Uint8ClampedArray | Uint8Array>(src: T, ch: number): T => {
      const out = new (src.constructor as { new (n: number): T })(src.length)
      for (let y = 0; y < h; y++) {
        const sy = y - dy
        if (sy < 0 || sy >= h) continue
        const x0 = Math.max(0, dx)
        const x1 = Math.min(w, w + dx)
        if (x1 > x0) out.set(src.subarray((sy * w + x0 - dx) * ch, (sy * w + x1 - dx) * ch), (y * w + x0) * ch)
      }
      return out
    }
    const before = L.pixels
    const after = shift(before, 4)
    this.command({
      label: 'Move',
      bytes: before.length * 2,
      redo: () => {
        L.pixels = after
        this.invalidate()
      },
      undo: () => {
        L.pixels = before
        this.invalidate()
      },
    })
  }

  // ---------- selection ----------

  setSelection(mask: Uint8Array | null, op: SelectOp = 'replace', label = 'Select') {
    const prev = this.selection
    const next = mask ? combine(prev, mask, op) : null
    const bounds = next ? maskBounds(next, this.doc.width, this.doc.height) : null
    const set = (m: Uint8Array | null, b: Rect | null) => {
      this.selection = b ? m : null
      this.selectionBounds = b
      this.selVersion++
    }
    const prevBounds = this.selectionBounds
    this.command({ label, redo: () => set(next, bounds), undo: () => set(prev, prevBounds), bytes: next?.length ?? 0 })
  }

  selectRect(r: Rect, op: SelectOp = 'replace') {
    this.setSelection(rectMask(this.doc.width, this.doc.height, r), op, 'Rectangle Select')
  }
  selectEllipse(r: Rect, op: SelectOp = 'replace') {
    this.setSelection(ellipseMask(this.doc.width, this.doc.height, r), op, 'Ellipse Select')
  }
  selectLasso(pts: { x: number; y: number }[], op: SelectOp = 'replace') {
    this.setSelection(polygonMask(this.doc.width, this.doc.height, pts), op, 'Lasso')
  }
  selectWand(x: number, y: number, op: SelectOp = 'replace') {
    this.setSelection(magicWand(this.comp, this.doc.width, this.doc.height, x, y, this.tolerance, this.contiguous), op, 'Magic Wand')
  }
  selectAll() {
    this.setSelection(new Uint8Array(this.doc.width * this.doc.height).fill(255), 'replace', 'Select All')
  }
  deselect() {
    if (this.selection) this.setSelection(null, 'replace', 'Deselect')
  }
  invertSelection() {
    const m = this.selection ? this.selection.map((v) => 255 - v) : new Uint8Array(this.doc.width * this.doc.height)
    this.setSelection(m, 'replace', 'Invert Selection')
  }

  /** Delete / clear the selection on the active layer (or the whole layer). */
  clear() {
    return this.editPixels('Clear', (buf, target) => {
      const sel = this.selection
      if (target === 'mask') {
        const m = buf as Uint8Array
        for (let i = 0; i < m.length; i++) m[i] = sel ? m[i]! * (1 - sel[i]! / 255) : 0
      } else {
        const px = buf as Uint8ClampedArray
        for (let i = 0; i < px.length / 4; i++) px[i * 4 + 3] = sel ? px[i * 4 + 3]! * (1 - sel[i]! / 255) : 0
      }
      return this.selectionBounds ?? fullRect(this.doc)
    })
  }

  // ---------- layers ----------

  private insertLayer(L: Layer, at: number, label: string) {
    const prevActive = this.active
    this.editMask = false
    this.command({
      label,
      bytes: L.kind === 'pixel' ? L.pixels.length : 0,
      redo: () => {
        this.doc.layers.splice(at, 0, L)
        this.active = at
        this.invalidate()
      },
      undo: () => {
        this.doc.layers.splice(at, 1)
        this.active = prevActive
        this.invalidate()
      },
    })
  }

  addLayer() {
    const n = this.doc.layers.filter((l) => l.kind === 'pixel').length
    this.insertLayer(pixelLayer(this.doc.width, this.doc.height, `Layer ${n}`), this.active + 1, 'New Layer')
  }

  duplicateLayer() {
    const L = this.layer
    if (!L) return
    const copy: Layer = L.kind === 'pixel' ? { ...L, pixels: L.pixels.slice(), mask: L.mask?.slice() ?? null } : { ...L, adjust: structuredClone(L.adjust), mask: L.mask?.slice() ?? null }
    copy.id = pixelLayer(1, 1, '').id
    copy.name = `${L.name} copy`
    this.insertLayer(copy, this.active + 1, 'Duplicate Layer')
  }

  /** With an active selection the adjustment gets it as its layer mask, so it only affects that area. */
  addAdjustment(kind: AdjustKind) {
    const L = adjustLayer(ADJUST_LABELS[kind], defaultAdjust(kind))
    if (this.selection) L.mask = this.selection.slice()
    this.insertLayer(L, this.active + 1, `New ${ADJUST_LABELS[kind]}`)
  }

  deleteLayer() {
    const L = this.layer
    if (!L || this.doc.layers.length <= 1) return
    const at = this.active
    this.command({
      label: 'Delete Layer',
      redo: () => {
        this.doc.layers.splice(at, 1)
        this.active = Math.min(at, this.doc.layers.length - 1)
        this.editMask = false
        this.invalidate()
      },
      undo: () => {
        this.doc.layers.splice(at, 0, L)
        this.active = at
        this.invalidate()
      },
    })
  }

  reorder(dir: 1 | -1) {
    const at = this.active
    const to = at + dir
    if (to < 0 || to >= this.doc.layers.length) return
    const swap = (a: number, b: number) => {
      const l = this.doc.layers
      ;[l[a], l[b]] = [l[b]!, l[a]!]
      this.invalidate()
    }
    this.command({
      label: dir > 0 ? 'Move Layer Up' : 'Move Layer Down',
      redo: () => {
        swap(at, to)
        this.active = to
      },
      undo: () => {
        swap(at, to)
        this.active = at
      },
    })
  }

  select(i: number) {
    if (i < 0 || i >= this.doc.layers.length) return
    this.active = i
    if (!this.doc.layers[i]!.mask) this.editMask = false
    this.emit()
  }

  private setProp<K extends 'opacity' | 'blend' | 'visible' | 'name'>(i: number, key: K, value: Layer[K], label: string, merge = false) {
    const L = this.doc.layers[i]
    if (!L || L[key] === value) return
    const prev = L[key]
    this.command({
      label,
      mergeKey: merge ? `${key}:${L.id}` : undefined,
      redo: () => {
        L[key] = value
        this.invalidate()
      },
      undo: () => {
        L[key] = prev
        this.invalidate()
      },
    })
  }

  setOpacity(v: number, i = this.active) {
    this.setProp(i, 'opacity', Math.round(Math.min(1, Math.max(0, v)) * 100) / 100, 'Opacity', true)
  }
  setBlend(m: BlendMode, i = this.active) {
    this.setProp(i, 'blend', m, 'Blend Mode')
  }
  toggleVisible(i = this.active) {
    const L = this.doc.layers[i]
    if (L) this.setProp(i, 'visible', !L.visible, L.visible ? 'Hide Layer' : 'Show Layer')
  }

  setAdjust(a: Adjust, i = this.active) {
    const L = this.doc.layers[i]
    if (!L || L.kind !== 'adjust') return
    const prev = L.adjust
    this.command({
      label: `Edit ${ADJUST_LABELS[a.kind]}`,
      mergeKey: `adjust:${L.id}`,
      redo: () => {
        L.adjust = a
        this.invalidate()
      },
      undo: () => {
        L.adjust = prev
        this.invalidate()
      },
    })
  }

  addMask(fromSelection = !!this.selection) {
    const L = this.layer
    if (!L || L.mask) {
      this.editMask = !!L?.mask
      this.emit()
      return
    }
    const mask = fromSelection && this.selection ? this.selection.slice() : new Uint8Array(this.doc.width * this.doc.height).fill(255)
    this.command({
      label: 'Add Mask',
      bytes: mask.length,
      redo: () => {
        L.mask = mask
        this.editMask = true
        this.invalidate()
      },
      undo: () => {
        L.mask = null
        this.editMask = false
        this.invalidate()
      },
    })
  }

  deleteMask() {
    const L = this.layer
    if (!L?.mask) return
    const mask = L.mask
    this.command({
      label: 'Delete Mask',
      redo: () => {
        L.mask = null
        this.editMask = false
        this.invalidate()
      },
      undo: () => {
        L.mask = mask
        this.invalidate()
      },
    })
  }

  // ---------- canvas geometry ----------

  /**
   * Remap every layer, mask and the selection to a new canvas size in one undoable step.
   * `text` maps a live text spec (or returns null to rasterize it).
   */
  private reshape(label: string, nw: number, nh: number, map: <T extends Uint8ClampedArray | Uint8Array>(b: T, ch: number) => T, text: (t: TextSpec) => TextSpec | null = () => null, keepSel = true) {
    this.cancelTransform()
    this.commitText()
    const ow = this.doc.width
    const oh = this.doc.height
    type Snap = { L: Layer; pixels?: Uint8ClampedArray; mask: Uint8Array | null; text?: TextSpec }
    const before: Snap[] = this.doc.layers.map((L) => ({ L, pixels: L.kind === 'pixel' ? L.pixels : undefined, mask: L.mask, text: L.kind === 'pixel' ? L.text : undefined }))
    const after: Snap[] = before.map((b) => {
      const t = b.text ? text(b.text) : null
      return { L: b.L, pixels: b.pixels && (t ? renderText(t, nw, nh) : map(b.pixels, 4)), mask: b.mask && map(b.mask, 1), text: t ?? undefined }
    })
    const sel0 = this.selection
    const bounds0 = this.selectionBounds
    const sel1 = keepSel && sel0 ? map(sel0, 1) : null
    const bounds1 = sel1 ? maskBounds(sel1, nw, nh) : null
    const apply = (snaps: Snap[], w: number, h: number, sel: Uint8Array | null, b: Rect | null) => {
      this.doc.width = w
      this.doc.height = h
      for (const s of snaps) {
        if (s.L.kind === 'pixel') {
          s.L.pixels = s.pixels!
          if (s.text) s.L.text = s.text
          else delete s.L.text
        }
        s.L.mask = s.mask
      }
      this.selection = b ? sel : null
      this.selectionBounds = b
      this.selVersion++
      this.comp = new Uint8ClampedArray(w * h * 4)
      this.docVersion++
      this.cloneSource = null
      this.dirty = null
      this.invalidate()
    }
    this.command({
      label,
      bytes: after.reduce((n, s) => n + (s.pixels?.length ?? 0) + (s.mask?.length ?? 0), 0) * 2,
      redo: () => apply(after, nw, nh, sel1, bounds1),
      undo: () => apply(before, ow, oh, sel0, bounds0),
    })
  }

  crop(r: Rect) {
    const c = clipRect(r, this.doc.width, this.doc.height)
    if (!c || c.x1 - c.x0 < 2 || c.y1 - c.y0 < 2) return false
    const w = this.doc.width
    this.reshape('Crop', c.x1 - c.x0, c.y1 - c.y0, (b, ch) => cropBuf(b, w, ch, c), (t) => ({ ...t, x: t.x - c.x0, y: t.y - c.y0 }))
    return true
  }

  rotateCanvas(turns: 1 | 2 | 3) {
    const { width: w, height: h } = this.doc
    const [nw, nh] = turns === 2 ? [w, h] : [h, w]
    this.reshape(turns === 1 ? 'Rotate 90° CW' : turns === 3 ? 'Rotate 90° CCW' : 'Rotate 180°', nw, nh, (b, ch) => rotateBuf(b, w, h, ch, turns))
  }

  flipCanvas(axis: 'h' | 'v') {
    const { width: w, height: h } = this.doc
    this.reshape(axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical', w, h, (b, ch) => flipBuf(b, w, h, ch, axis))
  }

  resizeImage(nw: number, nh: number) {
    nw = Math.max(1, Math.round(nw))
    nh = Math.max(1, Math.round(nh))
    const { width: w, height: h } = this.doc
    if (nw === w && nh === h) return
    const k = nw / w
    this.reshape('Image Size', nw, nh, (b, ch) => resizeBuf(b, w, h, ch, nw, nh), (t) => ({ ...t, x: t.x * k, y: t.y * (nh / h), size: t.size * k }), true)
  }

  flipLayer(axis: 'h' | 'v') {
    const L = this.layer
    if (!L || L.kind !== 'pixel') return
    const { width: w, height: h } = this.doc
    const before = L.pixels
    const text = L.text
    const after = flipBuf(before, w, h, 4, axis)
    this.command({
      label: axis === 'h' ? 'Flip Layer Horizontal' : 'Flip Layer Vertical',
      bytes: before.length * 2,
      redo: () => {
        L.pixels = after
        delete L.text
        this.invalidate()
      },
      undo: () => {
        L.pixels = before
        if (text) L.text = text
        this.invalidate()
      },
    })
  }

  // ---------- free transform ----------

  beginTransform() {
    const L = this.layer
    if (this.xf) return true
    if (!L || L.kind !== 'pixel') {
      this.emit('Transform works on pixel layers')
      return false
    }
    this.commitText()
    const { width: w, height: h } = this.doc
    let src = L.pixels
    let box = alphaBounds(src, w, h)
    // With a selection, transform just the selected pixels (lifted onto the same layer).
    if (this.selection && this.selectionBounds) {
      box = this.selectionBounds
      src = L.pixels.slice()
      for (let i = 0; i < w * h; i++) src[i * 4 + 3] = (src[i * 4 + 3]! * this.selection[i]!) / 255
    }
    if (!box) {
      this.emit('Layer is empty')
      return false
    }
    this.xf = { layer: L, orig: L.pixels, box, t: { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, sx: 1, sy: 1, rot: 0 } }
    ;(this.xf as any).src = src
    this.emit('Free Transform · Enter to apply, Esc to cancel')
    return true
  }

  setTransform(t: Partial<Xform>) {
    const x = this.xf
    if (!x) return
    x.t = { ...x.t, ...t }
    const { width: w, height: h } = this.doc
    const src: Uint8ClampedArray = (x as any).src
    const { out } = affineBuf(src, w, h, x.box, x.t)
    if (src !== x.orig) {
      // Composite the transformed selection over what stays behind.
      const sel = this.selection!
      const bg = x.orig.slice()
      for (let i = 0; i < w * h; i++) bg[i * 4 + 3] = (bg[i * 4 + 3]! * (255 - sel[i]!)) / 255
      for (let i = 0; i < w * h; i++) {
        const q = i * 4
        const a = out[q + 3]! / 255
        if (a <= 0) continue
        const ba = (bg[q + 3]! / 255) * (1 - a)
        const ao = a + ba
        for (let c = 0; c < 3; c++) bg[q + c] = (out[q + c]! * a + bg[q + c]! * ba) / ao
        bg[q + 3] = ao * 255
      }
      x.layer.pixels = bg
    } else x.layer.pixels = out
    this.invalidate()
    this.emit()
  }

  commitTransform() {
    const x = this.xf
    if (!x) return
    this.xf = null
    const after = x.layer.pixels
    const before = x.orig
    const L = x.layer
    const text = L.text
    const t = x.t
    const identity = t.sx === 1 && t.sy === 1 && !t.rot && t.cx === (x.box.x0 + x.box.x1) / 2 && t.cy === (x.box.y0 + x.box.y1) / 2
    if (identity) {
      L.pixels = before
      this.invalidate()
      this.emit('Transform cancelled')
      return
    }
    const hadSel = !!this.selection
    this.command({
      label: 'Free Transform',
      bytes: before.length * 2,
      redo: () => {
        L.pixels = after
        delete L.text
        this.invalidate()
      },
      undo: () => {
        L.pixels = before
        if (text) L.text = text
        this.invalidate()
      },
    })
    if (hadSel) this.deselect()
  }

  cancelTransform() {
    const x = this.xf
    if (!x) return
    this.xf = null
    x.layer.pixels = x.orig
    this.invalidate()
    this.emit('Transform cancelled')
  }

  // ---------- text ----------

  /** Text layer whose glyph box contains the point, top-most first. */
  textLayerAt(x: number, y: number): number {
    for (let i = this.doc.layers.length - 1; i >= 0; i--) {
      const L = this.doc.layers[i]!
      if (L.kind !== 'pixel' || !L.text || !L.visible) continue
      const b = textBounds(L.text)
      if (x >= b.x0 - 6 && x <= b.x1 + 6 && y >= b.y0 - 6 && y <= b.y1 + 6) return i
    }
    return -1
  }

  /** Click with the type tool: edit the text layer under the cursor, or start a new one. */
  beginText(x: number, y: number) {
    this.commitText()
    this.cancelTransform()
    const hit = this.textLayerAt(x, y)
    if (hit >= 0) {
      const L = this.doc.layers[hit] as PixelLayer
      this.active = hit
      this.editMask = false
      this.textEdit = { layer: L, prev: { ...L.text! }, prevPixels: L.pixels, at: hit }
      this.emit('Editing text · Esc to finish')
      return
    }
    const { width: w, height: h } = this.doc
    const L = pixelLayer(w, h, 'Text')
    L.text = { content: '', x: Math.round(x), y: Math.round(y + this.textSize * 0.35), size: this.textSize, color: [...this.fg] as RGB }
    const at = this.active + 1
    this.doc.layers.splice(at, 0, L)
    this.active = at
    this.editMask = false
    this.textEdit = { layer: L, prev: null, prevPixels: null, at }
    this.emit('Type your text · Esc to finish')
  }

  private rerenderText(L: PixelLayer) {
    L.pixels = renderText(L.text!, this.doc.width, this.doc.height)
    this.invalidate()
  }

  editText(fn: (t: TextSpec) => TextSpec) {
    const e = this.textEdit
    if (!e || !e.layer.text) return
    e.layer.text = fn(e.layer.text)
    this.rerenderText(e.layer)
    this.emit()
  }

  typeText(s: string) {
    this.editText((t) => ({ ...t, content: t.content + s }))
  }

  backspaceText() {
    this.editText((t) => ({ ...t, content: [...t.content].slice(0, -1).join('') }))
  }

  /** Finish the edit and record it as one history step. Empty new text is discarded. */
  commitText() {
    const e = this.textEdit
    if (!e) return
    this.textEdit = null
    const L = e.layer
    const spec = { ...L.text! }
    const name = spec.content.split('\n')[0]!.slice(0, 28) || 'Text'
    if (!e.prev) {
      const at = this.doc.layers.indexOf(L)
      this.doc.layers.splice(at, 1)
      this.active = Math.min(this.active, this.doc.layers.length - 1)
      if (!spec.content.trim()) {
        this.invalidate()
        this.emit('Text discarded')
        return
      }
      L.name = name
      this.insertLayer(L, at, 'Type Layer')
      return
    }
    if (JSON.stringify(e.prev) === JSON.stringify(spec)) {
      this.emit()
      return
    }
    const prev = e.prev
    const prevPixels = e.prevPixels!
    const pixels = L.pixels
    const prevName = L.name
    this.command({
      label: 'Edit Type',
      bytes: pixels.length,
      redo: () => {
        L.text = spec
        L.pixels = pixels
        L.name = name
        this.invalidate()
      },
      undo: () => {
        L.text = prev
        L.pixels = prevPixels
        L.name = prevName
        this.invalidate()
      },
    })
  }

  textBox(L: PixelLayer) {
    return L.text ? textBounds(L.text) : null
  }

  // ---------- more selection + layer commands ----------

  feather(radius: number) {
    if (!this.selection) {
      this.emit('Make a selection first')
      return
    }
    this.setSelection(featherMask(this.selection, this.doc.width, this.doc.height, radius), 'replace', `Feather ${Math.round(radius)} px`)
  }

  /** Bake the active layer (opacity, blend, mask, adjustments) into the pixel layer below it. */
  mergeDown() {
    const at = this.active
    const top = this.doc.layers[at]
    const below = this.doc.layers[at - 1]
    if (!top || !below || below.kind !== 'pixel') {
      this.emit('Nothing to merge into')
      return
    }
    const merged = flatten({ ...this.doc, layers: [{ ...below, opacity: 1, blend: 'normal', mask: null }, top] })
    // Keep the lower layer's own opacity/blend/mask; only its pixels change.
    const prevPixels = below.pixels
    const prevText = below.text
    this.command({
      label: 'Merge Down',
      bytes: merged.length * 2,
      redo: () => {
        below.pixels = new Uint8ClampedArray(merged)
        delete below.text
        this.doc.layers.splice(at, 1)
        this.active = at - 1
        this.editMask = false
        this.invalidate()
      },
      undo: () => {
        below.pixels = prevPixels
        if (prevText) below.text = prevText
        this.doc.layers.splice(at, 0, top)
        this.active = at
        this.invalidate()
      },
    })
  }

  flattenImage() {
    if (this.doc.layers.length <= 1 && this.doc.layers[0]?.kind === 'pixel') return
    const layers = this.doc.layers.slice()
    const active = this.active
    const flat = pixelLayer(this.doc.width, this.doc.height, 'Background', new Uint8ClampedArray(flatten(this.doc)))
    this.command({
      label: 'Flatten Image',
      bytes: flat.pixels.length,
      redo: () => {
        this.doc.layers = [flat]
        this.active = 0
        this.editMask = false
        this.invalidate()
      },
      undo: () => {
        this.doc.layers = layers.slice()
        this.active = active
        this.invalidate()
      },
    })
  }

  renameLayer(name: string, i = this.active) {
    const n = name.trim()
    if (n) this.setProp(i, 'name', n, 'Rename Layer')
  }

  setCloneSource(x: number, y: number) {
    this.cloneSource = { x: Math.round(x), y: Math.round(y) }
    this.emit('Clone source set')
  }

  // ---------- live filter preview ----------

  filterPreview: { kind: FilterKind; layer: PixelLayer; orig: Uint8ClampedArray; amount: number } | null = null

  /** Show the filter result on the canvas without recording history; commit or cancel ends it. */
  previewFilter(kind: FilterKind, amount: number) {
    const L = this.filterPreview?.layer ?? this.layer
    if (!L || L.kind !== 'pixel') {
      this.emit('Filters run on pixel layers')
      return false
    }
    if (!this.filterPreview) this.filterPreview = { kind, layer: L, orig: L.pixels, amount }
    const p = this.filterPreview
    p.kind = kind
    p.amount = amount
    const out = runFilter(kind, p.orig, this.doc.width, this.doc.height, amount, this.history.index + 1)
    const px = p.orig.slice()
    this.mixThroughSelection(px, out)
    L.pixels = px
    this.invalidate(this.selectionBounds ?? fullRect(this.doc))
    this.emit()
    return true
  }

  commitFilter() {
    const p = this.filterPreview
    if (!p) return
    this.filterPreview = null
    p.layer.pixels = p.orig
    this.filterAmount[p.kind] = p.amount
    const was = this.active
    this.active = this.doc.layers.indexOf(p.layer)
    this.applyFilter(p.kind, p.amount)
    this.active = was
  }

  cancelFilter() {
    const p = this.filterPreview
    if (!p) return
    this.filterPreview = null
    p.layer.pixels = p.orig
    this.invalidate()
    this.emit('Cancelled')
  }

  // ---------- open / place ----------

  /** Replace the whole document (File › Open). History starts fresh. */
  load(doc: Doc, notice: string) {
    this.cancelTransform()
    this.textEdit = null
    this.filterPreview = null
    this.doc = doc
    this.comp = new Uint8ClampedArray(doc.width * doc.height * 4)
    this.history = new History()
    this.selection = null
    this.selectionBounds = null
    this.selVersion++
    this.active = doc.layers.length - 1
    this.editMask = false
    this.cloneSource = null
    this.docVersion++
    this.dirty = null
    this.invalidate()
    this.emit(notice)
  }

  /** Add an image as a new layer, fitted inside the canvas and centred, then enter Free Transform. */
  placeImage(img: RGBAImage, name: string) {
    const { width: W, height: H } = this.doc
    const k = Math.min(1, (W * 0.8) / img.width, (H * 0.8) / img.height)
    const w = Math.max(1, Math.round(img.width * k))
    const h = Math.max(1, Math.round(img.height * k))
    const src = k < 1 ? resizeBuf(new Uint8ClampedArray(img.data), img.width, img.height, 4, w, h) : new Uint8ClampedArray(img.data)
    const L = pixelLayer(W, H, name)
    const ox = Math.round((W - w) / 2)
    const oy = Math.round((H - h) / 2)
    for (let y = 0; y < h; y++) {
      const dy = y + oy
      if (dy < 0 || dy >= H) continue
      for (let x = 0; x < w; x++) {
        const dx = x + ox
        if (dx < 0 || dx >= W) continue
        const s = (y * w + x) * 4
        const d = (dy * W + dx) * 4
        L.pixels[d] = src[s]!
        L.pixels[d + 1] = src[s + 1]!
        L.pixels[d + 2] = src[s + 2]!
        L.pixels[d + 3] = src[s + 3]!
      }
    }
    if (this.selection) this.setSelection(null, 'replace', 'Deselect')
    this.insertLayer(L, this.active + 1, 'Place')
    this.beginTransform()
  }

  // ---------- files ----------

  flattened(): RGBAImage {
    return { width: this.doc.width, height: this.doc.height, data: flatten(this.doc) }
  }

  /** .pcraft = zip of manifest.json + one PNG per pixel layer and mask. */
  saveProject(): Buffer {
    const { width, height } = this.doc
    const files: { name: string; data: Uint8Array }[] = []
    const layers = this.doc.layers.map((L, i) => {
      const entry: Record<string, unknown> = { id: L.id, kind: L.kind, name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend }
      if (L.kind === 'pixel') {
        if (L.text) entry.text = L.text
        entry.pixels = `layers/${i}.png`
        files.push({ name: entry.pixels as string, data: encodePng({ width, height, data: L.pixels }) })
      } else entry.adjust = L.adjust
      if (L.mask) {
        entry.mask = `masks/${i}.png`
        const rgba = new Uint8ClampedArray(width * height * 4)
        for (let p = 0; p < L.mask.length; p++) (rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = L.mask[p]!), (rgba[p * 4 + 3] = 255)
        files.push({ name: entry.mask as string, data: encodePng({ width, height, data: rgba }) })
      }
      return entry
    })
    const manifest = { format: 'pcraft', version: 2, app: 'PhotoCraft (GPUIX)', width, height, name: this.doc.name, active: this.active, layers }
    files.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) })
    return writeZip(files)
  }

  static openProject(buf: Buffer): Editor {
    const z = readZip(buf)
    const m = JSON.parse(z.get('manifest.json')?.toString('utf8') ?? 'null')
    if (!m || m.format !== 'pcraft') throw new Error('not a .pcraft project')
    const layers: Layer[] = m.layers.map((e: Record<string, any>) => {
      const base = { id: e.id as number, name: e.name, visible: e.visible, opacity: e.opacity, blend: e.blend, mask: null as Uint8Array | null }
      bumpIds(base.id)
      if (e.mask) {
        const img = decodeImage(z.get(e.mask)!)
        base.mask = new Uint8Array(img.width * img.height)
        for (let p = 0; p < base.mask.length; p++) base.mask[p] = img.data[p * 4]!
      }
      if (e.kind === 'pixel') {
        const L: PixelLayer = { ...base, kind: 'pixel', pixels: new Uint8ClampedArray(decodeImage(z.get(e.pixels)!).data) }
        if (e.text) L.text = e.text
        return L
      }
      return { ...base, kind: 'adjust', adjust: e.adjust }
    })
    const ed = new Editor({ width: m.width, height: m.height, name: m.name, layers })
    ed.active = Math.min(m.active ?? layers.length - 1, layers.length - 1)
    return ed
  }
}
