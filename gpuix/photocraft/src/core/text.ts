// Text layers: glyph outlines from a system font (opentype.js), filled by our own anti-aliased scanline rasterizer.
import { existsSync, readFileSync } from 'node:fs'
import opentype from 'opentype.js'
import type { Rect } from './doc'

export interface TextSpec {
  content: string
  x: number
  /** Baseline of the first line. */
  y: number
  size: number
  color: [number, number, number]
}

const FONT_PATHS = ['/System/Library/Fonts/SFNS.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
let font: opentype.Font | null | undefined

export function loadFont(): opentype.Font | null {
  if (font !== undefined) return font
  font = null
  for (const p of FONT_PATHS) {
    if (!existsSync(p)) continue
    try {
      const b = readFileSync(p)
      font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
      break
    } catch {}
  }
  return font
}

type Pt = [number, number]

/** Flatten the text outline into closed polygons (doc pixel coordinates). */
export function textPolygons(t: TextSpec): Pt[][] {
  const f = loadFont()
  if (!f) return []
  const polys: Pt[][] = []
  let cur: Pt[] = []
  const lines = t.content.split('\n')
  lines.forEach((line, li) => {
    const path = f.getPath(line, t.x, t.y + li * t.size * 1.2, t.size, { kerning: true })
    let px = 0
    let py = 0
    for (const c of path.commands as any[]) {
      if (c.type === 'M') {
        if (cur.length > 2) polys.push(cur)
        cur = [[c.x, c.y]]
        px = c.x
        py = c.y
      } else if (c.type === 'L') {
        cur.push([c.x, c.y])
        px = c.x
        py = c.y
      } else if (c.type === 'Q') {
        const n = Math.max(2, Math.min(16, Math.ceil(Math.hypot(c.x - px, c.y - py) / 3)))
        for (let i = 1; i <= n; i++) {
          const s = i / n
          const a = (1 - s) * (1 - s)
          const b = 2 * (1 - s) * s
          cur.push([a * px + b * c.x1 + s * s * c.x, a * py + b * c.y1 + s * s * c.y])
        }
        px = c.x
        py = c.y
      } else if (c.type === 'C') {
        const n = Math.max(3, Math.min(24, Math.ceil(Math.hypot(c.x - px, c.y - py) / 3)))
        for (let i = 1; i <= n; i++) {
          const s = i / n
          const u = 1 - s
          cur.push([u * u * u * px + 3 * u * u * s * c.x1 + 3 * u * s * s * c.x2 + s * s * s * c.x, u * u * u * py + 3 * u * u * s * c.y1 + 3 * u * s * s * c.y2 + s * s * s * c.y])
        }
        px = c.x
        py = c.y
      } else if (c.type === 'Z') {
        if (cur.length > 2) polys.push(cur)
        cur = []
      }
    }
  })
  if (cur.length > 2) polys.push(cur)
  return polys
}

/** Advance-width box of the text (for hit testing and the caret). */
export function textBounds(t: TextSpec): Rect {
  const f = loadFont()
  const lines = t.content.split('\n')
  let w = 0
  for (const l of lines) w = Math.max(w, f ? f.getAdvanceWidth(l || ' ', t.size, { kerning: true }) : l.length * t.size * 0.55)
  return { x0: t.x, y0: t.y - t.size * 0.92, x1: t.x + Math.max(w, t.size * 0.3), y1: t.y + t.size * 0.25 + (lines.length - 1) * t.size * 1.2 }
}

/** Nonzero-winding coverage (0..1) per pixel, 4 sub-scanlines with exact horizontal coverage spans. */
export function rasterize(polys: Pt[][], w: number, h: number): { cov: Float32Array; rect: Rect | null } {
  const cov = new Float32Array(w * h)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const edges: { ax: number; ay: number; bx: number; by: number; dir: number }[] = []
  for (const p of polys)
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!
      const b = p[(i + 1) % p.length]!
      x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); y0 = Math.min(y0, a[1]); y1 = Math.max(y1, a[1])
      if (a[1] === b[1]) continue
      edges.push(a[1] < b[1] ? { ax: a[0], ay: a[1], bx: b[0], by: b[1], dir: 1 } : { ax: b[0], ay: b[1], bx: a[0], by: a[1], dir: -1 })
    }
  if (!edges.length) return { cov, rect: null }
  const ry0 = Math.max(0, Math.floor(y0))
  const ry1 = Math.min(h, Math.ceil(y1) + 1)
  const SS = 4
  const xs: { x: number; d: number }[] = []
  const row = new Float32Array(w + 2)
  for (let y = ry0; y < ry1; y++) {
    row.fill(0)
    for (let s = 0; s < SS; s++) {
      const sy = y + (s + 0.5) / SS
      xs.length = 0
      for (const e of edges) if (sy >= e.ay && sy < e.by) xs.push({ x: e.ax + ((sy - e.ay) / (e.by - e.ay)) * (e.bx - e.ax), d: e.dir })
      xs.sort((a, b) => a.x - b.x)
      let wind = 0
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k]!.d
        if (!wind) continue
        const a = Math.max(0, xs[k]!.x)
        const b = Math.min(w, xs[k + 1]!.x)
        if (b <= a) continue
        const ia = Math.floor(a)
        const ib = Math.floor(b)
        if (ia === ib) row[ia]! += (b - a) / SS
        else {
          row[ia]! += (ia + 1 - a) / SS
          for (let x = ia + 1; x < ib; x++) row[x]! += 1 / SS
          if (ib < w) row[ib]! += (b - ib) / SS
        }
      }
    }
    for (let x = 0; x < w; x++) if (row[x]) cov[y * w + x] = Math.min(1, row[x]!)
  }
  const rect = { x0: Math.max(0, Math.floor(x0)), y0: ry0, x1: Math.min(w, Math.ceil(x1) + 1), y1: ry1 }
  return { cov, rect: rect.x1 > rect.x0 && rect.y1 > rect.y0 ? rect : null }
}

/** Fresh straight-alpha RGBA pixels for a text layer. */
export function renderText(t: TextSpec, w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  const { cov, rect } = rasterize(textPolygons(t), w, h)
  if (!rect) return px
  const [r, g, b] = t.color
  for (let y = rect.y0; y < rect.y1; y++)
    for (let x = rect.x0; x < rect.x1; x++) {
      const c = cov[y * w + x]!
      if (c <= 0) continue
      const q = (y * w + x) * 4
      px[q] = r
      px[q + 1] = g
      px[q + 2] = b
      px[q + 3] = c * 255
    }
  return px
}

/** Caret at the end of the text, in doc space. */
export function textCaret(t: TextSpec): { x: number; y0: number; y1: number } {
  const f = loadFont()
  const lines = t.content.split('\n')
  const last = lines[lines.length - 1] ?? ''
  const w = f ? f.getAdvanceWidth(last, t.size, { kerning: true }) : last.length * t.size * 0.55
  const base = t.y + (lines.length - 1) * t.size * 1.2
  return { x: t.x + w + Math.max(1, t.size * 0.04), y0: base - t.size * 0.8, y1: base + t.size * 0.12 }
}
