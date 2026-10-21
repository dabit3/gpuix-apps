import { PALETTE, type Rect, type Shape, type SpatialIndex, arrowEnds } from './model'

/** Raster tiles are drawn at this many pixels per side. */
export const TILE_PX = 320
/** Below this zoom the board is drawn as cached raster tiles instead of nodes. */
export const LOD_Z = 0.3

export function tileLevel(z: number): number {
  return Math.max(0, Math.floor(Math.log2(TILE_PX / (z * 1024))))
}
export function tileWorld(level: number): number {
  return 1024 * 2 ** level
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

class Raster {
  data: Uint8Array
  constructor(public w: number, public h: number) {
    this.data = new Uint8Array(w * h * 4)
  }
  blend(i: number, r: number, g: number, b: number, a: number) {
    const d = this.data
    const o = i * 4
    const da = d[o + 3]! / 255
    const oa = a + da * (1 - a)
    if (oa <= 0) return
    d[o] = (r * a + d[o]! * da * (1 - a)) / oa
    d[o + 1] = (g * a + d[o + 1]! * da * (1 - a)) / oa
    d[o + 2] = (b * a + d[o + 2]! * da * (1 - a)) / oa
    d[o + 3] = oa * 255
  }
  fillRect(x: number, y: number, w: number, h: number, c: [number, number, number], a = 1) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(this.w, Math.ceil(x + w)), y1 = Math.min(this.h, Math.ceil(y + h))
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) this.blend(py * this.w + px, c[0], c[1], c[2], a)
  }
  /** Filled rounded box with a border, antialiased by coverage at the edges. */
  box(x: number, y: number, w: number, h: number, radius: number, fill: [number, number, number], stroke: [number, number, number] | null, sw: number, ellipse = false) {
    const x0 = Math.max(0, Math.floor(x - 1)), y0 = Math.max(0, Math.floor(y - 1))
    const x1 = Math.min(this.w, Math.ceil(x + w + 1)), y1 = Math.min(this.h, Math.ceil(y + h + 1))
    const cx = x + w / 2, cy = y + h / 2, hw = w / 2, hh = h / 2
    const r = Math.min(radius, hw, hh)
    for (let py = y0; py < y1; py++)
      for (let px = x0; px < x1; px++) {
        const qx = px + 0.5 - cx, qy = py + 0.5 - cy
        let dist: number
        if (ellipse) {
          const k = Math.hypot(qx / hw, qy / hh)
          dist = (k - 1) * Math.min(hw, hh)
        } else {
          const ax = Math.abs(qx) - (hw - r), ay = Math.abs(qy) - (hh - r)
          dist = Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - r
        }
        const cov = Math.max(0, Math.min(1, 0.5 - dist))
        if (cov <= 0) continue
        const i = py * this.w + px
        const inStroke = stroke && dist > -sw
        const c = inStroke ? stroke! : fill
        this.blend(i, c[0], c[1], c[2], cov)
      }
  }
  line(ax: number, ay: number, bx: number, by: number, width: number, c: [number, number, number]) {
    const pad = width / 2 + 1
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad)), x1 = Math.min(this.w, Math.ceil(Math.max(ax, bx) + pad))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - pad)), y1 = Math.min(this.h, Math.ceil(Math.max(ay, by) + pad))
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy || 1
    for (let py = y0; py < y1; py++)
      for (let px = x0; px < x1; px++) {
        const qx = px + 0.5, qy = py + 0.5
        const t = Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / l2))
        const d = Math.hypot(qx - (ax + t * dx), qy - (ay + t * dy))
        const cov = Math.max(0, Math.min(1, width / 2 + 0.5 - d))
        if (cov > 0) this.blend(py * this.w + px, c[0], c[1], c[2], cov)
      }
  }
}

/** Draw every shape intersecting a world rect into a w x h RGBA buffer. */
export function rasterize(index: SpatialIndex, byId: Map<string, Shape>, area: Rect, w: number, h: number): Uint8Array {
  const r = new Raster(w, h)
  const s = w / area.w
  for (const i of index.query(area)) {
    const sh = index.shapes[i]!
    const p = PALETTE[sh.color]
    const x = (sh.x - area.x) * s, y = (sh.y - area.y) * s, sw = sh.w * s, shh = sh.h * s
    switch (sh.type) {
      case 'rect':
        r.box(x, y, sw, shh, 8 * s, hexRgb(p.fill), p.rgb, Math.max(1, 2.5 * s))
        break
      case 'ellipse':
        r.box(x, y, sw, shh, 0, hexRgb(p.fill), p.rgb, Math.max(1, 2.5 * s), true)
        break
      case 'sticky': {
        const fill = hexRgb(p.sticky)
        r.box(x + 2 * s, y + 4 * s, sw, shh, 6 * s, [0, 0, 0], null, 0)
        r.box(x, y, sw, shh, 6 * s, fill, null, 0)
        const lineC: [number, number, number] = [60, 60, 60]
        if (shh > 8) for (let k = 0; k < 2; k++) r.fillRect(x + sw * 0.12, y + shh * (0.18 + k * 0.14), sw * (k ? 0.45 : 0.7), Math.max(1, shh * 0.05), lineC, 0.55)
        break
      }
      case 'text':
        r.fillRect(x, y + shh * 0.3, sw, Math.max(1, shh * 0.3), [29, 29, 31], 0.6)
        break
      case 'image':
        r.box(x, y, sw, shh, 4 * s, [200, 205, 212], null, 0)
        break
      case 'pen': {
        const pts = sh.points ?? []
        for (let k = 0; k + 3 < pts.length; k += 2) r.line(x + pts[k]! * s, y + pts[k + 1]! * s, x + pts[k + 2]! * s, y + pts[k + 3]! * s, Math.max(1, 4 * s), p.rgb)
        break
      }
      case 'arrow': {
        const { p0, p1 } = arrowEnds(sh, byId)
        r.line((p0.x - area.x) * s, (p0.y - area.y) * s, (p1.x - area.x) * s, (p1.y - area.y) * s, Math.max(1, 2.5 * s), p.rgb)
        break
      }
    }
  }
  return r.data
}

/** Dot grid covering w x h with dots every `pitch` px, offset by (ox, oy). */
export function dotGrid(w: number, h: number, pitch: number, major: number): Uint8Array {
  const r = new Raster(w, h)
  const d = r.data
  // opaque canvas colour so the grid image is the background itself
  for (let i = 0; i < w * h; i++) { d[i * 4] = 248; d[i * 4 + 1] = 248; d[i * 4 + 2] = 247; d[i * 4 + 3] = 255 }
  const dot = (cx: number, cy: number, rad: number, shade: number) => {
    for (let py = Math.floor(cy - rad - 1); py <= cy + rad + 1; py++)
      for (let px = Math.floor(cx - rad - 1); px <= cx + rad + 1; px++) {
        if (px < 0 || py < 0 || px >= w || py >= h) continue
        const cov = Math.max(0, Math.min(1, rad + 0.5 - Math.hypot(px + 0.5 - cx, py + 0.5 - cy)))
        if (cov > 0) r.blend(py * w + px, shade, shade, shade, cov)
      }
  }
  let row = 0
  for (let y = pitch / 2; y < h; y += pitch, row++) {
    let col = 0
    for (let x = pitch / 2; x < w; x += pitch, col++) {
      const isMajor = major > 0 && row % major === 0 && col % major === 0
      dot(x, y, isMajor ? 1.3 : 0.9, isMajor ? 168 : 196)
    }
  }
  return d
}

/** Minimap: every shape as a tiny box in the board's bounding rect. */
export function minimap(shapes: Shape[], world: Rect, w: number, h: number): Uint8Array {
  const r = new Raster(w, h)
  const s = Math.min(w / world.w, h / world.h)
  const ox = (w - world.w * s) / 2, oy = (h - world.h * s) / 2
  const byId = new Map(shapes.map((sh) => [sh.id, sh]))
  for (const sh of shapes) {
    if (sh.type === 'arrow') {
      const { p0, p1 } = arrowEnds(sh, byId)
      r.line(ox + (p0.x - world.x) * s, oy + (p0.y - world.y) * s, ox + (p1.x - world.x) * s, oy + (p1.y - world.y) * s, 1, PALETTE[sh.color].rgb)
      continue
    }
    const c = sh.type === 'sticky' ? hexRgb(PALETTE[sh.color].sticky).map((v) => v * 0.85) as [number, number, number] : PALETTE[sh.color].rgb
    r.fillRect(ox + (sh.x - world.x) * s, oy + (sh.y - world.y) * s, Math.max(1, sh.w * s), Math.max(1, sh.h * s), c, sh.stress ? 0.55 : 0.9)
  }
  return r.data
}

export function minimapTransform(world: Rect, w: number, h: number) {
  const s = Math.min(w / world.w, h / world.h)
  return { s, ox: (w - world.w * s) / 2, oy: (h - world.h * s) / 2 }
}
