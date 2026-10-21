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

export type Tool = 'move' | 'marquee' | 'ellipse' | 'lasso' | 'wand' | 'brush' | 'eraser' | 'fill' | 'gradient' | 'eyedropper' | 'hand'

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
  private stroke: { engine: StrokeEngine; cov: Float32Array; base: Uint8ClampedArray | Uint8Array; target: 'pixels' | 'mask'; layer: PixelLayer | AdjustLayer; erase: boolean; rect: Rect | null; color: RGB } | null = null

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

  private pushPixelDiff(label: string, d: TileDiff) {
    if (!d.tiles.length) return
    const rect = diffRect(d)
    this.history.push({
      label,
      bytes: diffBytes(d),
      undo: () => {
        applyTiles(d, 'before')
        this.invalidate(rect)
      },
      redo: () => {
        applyTiles(d, 'after')
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

  beginStroke(x: number, y: number, erase = this.tool === 'eraser') {
    const t = this.paintTarget()
    if (!t) return false
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
    })
    s.engine = new StrokeEngine(spacing, (cx, cy) => {
      const r = stampDab(cov, w, h, cx, cy, radius, this.brush.hardness, this.brush.flow)
      this.applyStroke(r)
      s.rect = unionRect(s.rect, r)
    })
    s.engine.add(x, y)
    return true
  }

  strokeTo(x: number, y: number) {
    this.stroke?.engine.add(x, y)
  }

  endStroke() {
    const s = this.stroke
    if (!s) return
    s.engine.end()
    this.stroke = null
    if (!s.rect) return
    const buf = s.target === 'mask' ? s.layer.mask! : (s.layer as PixelLayer).pixels
    const label = s.target === 'mask' ? (s.erase ? 'Reveal Mask' : 'Hide Mask') : s.erase ? 'Eraser' : 'Brush'
    this.pushPixelDiff(label, diffTiles(s.base, buf, this.doc.width, this.doc.height, s.target === 'mask' ? 1 : 4, s.rect))
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
    const r = edit(t.buf, t.target)
    if (!r) return false
    this.pushPixelDiff(label, diffTiles(before, t.buf, this.doc.width, this.doc.height, t.target === 'mask' ? 1 : 4, r))
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
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2))
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
          const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2))
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

  addAdjustment(kind: AdjustKind) {
    this.insertLayer(adjustLayer(ADJUST_LABELS[kind], defaultAdjust(kind)), this.active + 1, `New ${ADJUST_LABELS[kind]}`)
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
    const manifest = { format: 'pcraft', version: 1, app: 'PhotoCraft (GPUIX)', width, height, name: this.doc.name, active: this.active, layers }
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
      if (e.kind === 'pixel') return { ...base, kind: 'pixel', pixels: new Uint8ClampedArray(decodeImage(z.get(e.pixels)!).data) }
      return { ...base, kind: 'adjust', adjust: e.adjust }
    })
    const ed = new Editor({ width: m.width, height: m.height, name: m.name, layers })
    ed.active = Math.min(m.active ?? layers.length - 1, layers.length - 1)
    return ed
  }
}
