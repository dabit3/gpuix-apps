// CPU viewport: samples the flattened document into a screen-sized RGBA buffer for <img>.setImagePixels.
// Pan/zoom redraw everything; brush dabs redraw only the screen rect under the dirty doc rect.
import type { Rect } from '../core/doc'

const BG = [10, 12, 16]
const EDGE = [39, 43, 51]

export type Preview =
  | { kind: 'rect' | 'ellipse'; a: { x: number; y: number }; b: { x: number; y: number } }
  | { kind: 'lasso'; pts: { x: number; y: number }[] }
  | { kind: 'line'; a: { x: number; y: number }; b: { x: number; y: number } }
  | null

export class Viewport {
  w = 1
  h = 1
  zoom = 1
  panX = 0
  panY = 0
  /** Refit on resize until the user zooms or pans. */
  fitMode = true
  base = new Uint8ClampedArray(4)
  out = new Uint8ClampedArray(4)
  private edges = new Int32Array(0)
  private edgeCount = 0
  docW = 1
  docH = 1

  resize(w: number, h: number) {
    w = Math.max(1, Math.floor(w))
    h = Math.max(1, Math.floor(h))
    if (w === this.w && h === this.h && this.base.length === w * h * 4) return false
    const cx = this.w / 2
    const cy = this.h / 2
    this.w = w
    this.h = h
    this.base = new Uint8ClampedArray(w * h * 4)
    this.out = new Uint8ClampedArray(w * h * 4)
    if (this.fitMode) this.fit()
    else {
      // Keep the doc point at the old center in the center.
      this.panX += w / 2 - cx
      this.panY += h / 2 - cy
    }
    return true
  }

  setDoc(w: number, h: number) {
    this.docW = w
    this.docH = h
    if (this.fitMode) this.fit()
  }

  fit() {
    const pad = Math.min(40, Math.min(this.w, this.h) * 0.06)
    this.zoom = Math.max(0.02, Math.min((this.w - pad * 2) / this.docW, (this.h - pad * 2) / this.docH, 16))
    this.panX = Math.round((this.w - this.docW * this.zoom) / 2)
    this.panY = Math.round((this.h - this.docH * this.zoom) / 2)
    this.fitMode = true
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const z = Math.max(0.05, Math.min(32, this.zoom * factor))
    const dx = (sx - this.panX) / this.zoom
    const dy = (sy - this.panY) / this.zoom
    this.zoom = z
    this.panX = sx - dx * z
    this.panY = sy - dy * z
    this.fitMode = false
  }

  pan(dx: number, dy: number) {
    this.panX += dx
    this.panY += dy
    this.fitMode = false
  }

  toDoc(sx: number, sy: number) {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom }
  }

  toScreen(x: number, y: number) {
    return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY }
  }

  /** Screen rect covering a doc rect, clipped to the viewport. */
  screenRect(r: Rect): Rect | null {
    const x0 = Math.max(0, Math.floor(r.x0 * this.zoom + this.panX) - 1)
    const y0 = Math.max(0, Math.floor(r.y0 * this.zoom + this.panY) - 1)
    const x1 = Math.min(this.w, Math.ceil(r.x1 * this.zoom + this.panX) + 1)
    const y1 = Math.min(this.h, Math.ceil(r.y1 * this.zoom + this.panY) + 1)
    return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
  }

  /** Sample `comp` (docW×docH straight RGBA) into `base` for screen rect `sr` (everything when omitted). */
  render(comp: Uint8ClampedArray, sr?: Rect | null) {
    const r = sr ?? { x0: 0, y0: 0, x1: this.w, y1: this.h }
    const { w, zoom, panX, panY, docW, docH } = this
    const inv = 1 / zoom
    const ss = zoom < 1 ? 2 : 1
    const grid = zoom >= 8
    const buf = this.base
    const dx0 = panX
    const dy0 = panY
    const dx1 = panX + docW * zoom
    const dy1 = panY + docH * zoom
    for (let y = r.y0; y < r.y1; y++) {
      const insideY = y >= dy0 && y < dy1
      for (let x = r.x0; x < r.x1; x++) {
        const o = (y * w + x) * 4
        if (!insideY || x < dx0 || x >= dx1) {
          const edge = (x >= dx0 - 1 && x < dx1 + 1 && (y === Math.floor(dy0) - 1 || y === Math.floor(dy1))) || (y >= dy0 - 1 && y < dy1 + 1 && (x === Math.floor(dx0) - 1 || x === Math.floor(dx1)))
          const c = edge ? EDGE : BG
          buf[o] = c[0]!
          buf[o + 1] = c[1]!
          buf[o + 2] = c[2]!
          buf[o + 3] = 255
          continue
        }
        let rr = 0
        let gg = 0
        let bb = 0
        let aa = 0
        for (let s = 0; s < ss * ss; s++) {
          const fx = ss === 1 ? 0.5 : 0.25 + (s & 1) * 0.5
          const fy = ss === 1 ? 0.5 : 0.25 + (s >> 1) * 0.5
          let px = ((x + fx - panX) * inv) | 0
          let py = ((y + fy - panY) * inv) | 0
          if (px >= docW) px = docW - 1
          if (py >= docH) py = docH - 1
          if (px < 0) px = 0
          if (py < 0) py = 0
          const q = (py * docW + px) * 4
          const a = comp[q + 3]!
          rr += comp[q]! * a
          gg += comp[q + 1]! * a
          bb += comp[q + 2]! * a
          aa += a
        }
        const n = ss * ss
        const a = aa / n / 255
        // Transparent pixels show a checkerboard.
        const ck = ((((x - panX) >> 3) + ((y - panY) >> 3)) & 1) === 0 ? 255 : 204
        const k = aa > 0 ? 1 / aa : 0
        let R = rr * k * a + ck * (1 - a)
        let G = gg * k * a + ck * (1 - a)
        let B = bb * k * a + ck * (1 - a)
        if (grid) {
          const gx = (x - panX) % zoom
          const gy = (y - panY) % zoom
          if (gx < 1 || gy < 1) {
            R = R * 0.75 + 32
            G = G * 0.75 + 32
            B = B * 0.75 + 32
          }
        }
        buf[o] = R
        buf[o + 1] = G
        buf[o + 2] = B
        buf[o + 3] = 255
      }
    }
  }

  /** Screen-space selection boundary for the marching ants. */
  traceSelection(sel: Uint8Array | null) {
    const { w, h, zoom, panX, panY, docW, docH } = this
    if (!sel) {
      this.edgeCount = 0
      return
    }
    const inside = new Uint8Array(w * h)
    const inv = 1 / zoom
    for (let y = 0; y < h; y++) {
      const py = Math.floor((y + 0.5 - panY) * inv)
      if (py < 0 || py >= docH) continue
      for (let x = 0; x < w; x++) {
        const px = Math.floor((x + 0.5 - panX) * inv)
        if (px < 0 || px >= docW) continue
        inside[y * w + x] = sel[py * docW + px]! > 127 ? 1 : 0
      }
    }
    const edges: number[] = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (!inside[i]) continue
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !inside[i - 1] || !inside[i + 1] || !inside[i - w] || !inside[i + w]) edges.push(i)
      }
    this.edges = Int32Array.from(edges)
    this.edgeCount = edges.length
  }

  get antCount() {
    return this.edgeCount
  }

  private plot(x: number, y: number, c: readonly number[]) {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const o = (y * this.w + x) * 4
    this.out[o] = c[0]!
    this.out[o + 1] = c[1]!
    this.out[o + 2] = c[2]!
  }

  private dashLine(ax: number, ay: number, bx: number, by: number, phase: number, color?: readonly number[]) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const on = color ?? (((i + phase) >> 2) & 1 ? [255, 255, 255] : [0, 0, 0])
      this.plot(ax + (bx - ax) * t, ay + (by - ay) * t, on)
    }
  }

  /** Copy base → out and draw ants, tool previews and the brush ring on top. */
  present(phase: number, preview: Preview, ring: { x: number; y: number; r: number } | null) {
    this.out.set(this.base)
    const w = this.w
    for (let k = 0; k < this.edgeCount; k++) {
      const i = this.edges[k]!
      const x = i % w
      const y = (i - x) / w
      const v = ((x + y + phase) >> 2) & 1 ? 255 : 0
      const o = i * 4
      this.out[o] = this.out[o + 1] = this.out[o + 2] = v
    }
    if (preview) {
      if (preview.kind === 'rect') {
        const { a, b } = preview
        this.dashLine(a.x, a.y, b.x, a.y, phase)
        this.dashLine(b.x, a.y, b.x, b.y, phase)
        this.dashLine(b.x, b.y, a.x, b.y, phase)
        this.dashLine(a.x, b.y, a.x, a.y, phase)
      } else if (preview.kind === 'ellipse') {
        const cx = (preview.a.x + preview.b.x) / 2
        const cy = (preview.a.y + preview.b.y) / 2
        const rx = Math.abs(preview.b.x - preview.a.x) / 2
        const ry = Math.abs(preview.b.y - preview.a.y) / 2
        const n = Math.max(16, Math.ceil(Math.PI * (rx + ry)))
        for (let i = 0; i < n; i++) {
          const t = (i / n) * Math.PI * 2
          this.plot(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, ((i + phase) >> 2) & 1 ? [255, 255, 255] : [0, 0, 0])
        }
      } else if (preview.kind === 'lasso') {
        const p = preview.pts
        for (let i = 1; i < p.length; i++) this.dashLine(p[i - 1]!.x, p[i - 1]!.y, p[i]!.x, p[i]!.y, phase)
      } else {
        this.dashLine(preview.a.x, preview.a.y, preview.b.x, preview.b.y, 0, [113, 183, 255])
        this.dashLine(preview.a.x + 1, preview.a.y, preview.b.x + 1, preview.b.y, 0, [10, 12, 16])
      }
    }
    if (ring && ring.r >= 2) {
      const n = Math.max(24, Math.ceil(ring.r * 2 * Math.PI))
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2
        const x = ring.x + Math.cos(t) * ring.r
        const y = ring.y + Math.sin(t) * ring.r
        this.plot(x, y, [255, 255, 255])
        this.plot(x + Math.cos(t), y + Math.sin(t), [0, 0, 0])
      }
    }
    return this.out
  }
}
