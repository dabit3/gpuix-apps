// Selections are 8-bit masks (255 = selected), doc-sized.
import type { Rect } from './doc'

export type SelectOp = 'replace' | 'add' | 'subtract'

export function rectMask(w: number, h: number, r: Rect): Uint8Array {
  const m = new Uint8Array(w * h)
  const x0 = Math.max(0, Math.round(Math.min(r.x0, r.x1)))
  const x1 = Math.min(w, Math.round(Math.max(r.x0, r.x1)))
  const y0 = Math.max(0, Math.round(Math.min(r.y0, r.y1)))
  const y1 = Math.min(h, Math.round(Math.max(r.y0, r.y1)))
  for (let y = y0; y < y1; y++) m.fill(255, y * w + x0, y * w + x1)
  return m
}

export function ellipseMask(w: number, h: number, r: Rect): Uint8Array {
  const m = new Uint8Array(w * h)
  const cx = (r.x0 + r.x1) / 2
  const cy = (r.y0 + r.y1) / 2
  const rx = Math.abs(r.x1 - r.x0) / 2
  const ry = Math.abs(r.y1 - r.y0) / 2
  if (rx < 0.5 || ry < 0.5) return m
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(w, Math.ceil(cx + rx)); x++) {
      // 2×2 supersampling for a soft edge.
      let n = 0
      for (let s = 0; s < 4; s++) {
        const dx = (x + 0.25 + (s & 1) * 0.5 - cx) / rx
        const dy = (y + 0.25 + (s >> 1) * 0.5 - cy) / ry
        if (dx * dx + dy * dy <= 1) n++
      }
      m[y * w + x] = (n * 255) / 4
    }
  }
  return m
}

/** Even-odd scanline fill of a closed polygon. */
export function polygonMask(w: number, h: number, pts: { x: number; y: number }[]): Uint8Array {
  const m = new Uint8Array(w * h)
  if (pts.length < 3) return m
  const xs: number[] = []
  for (let y = 0; y < h; y++) {
    const sy = y + 0.5
    xs.length = 0
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]!
      const b = pts[j]!
      if (a.y > sy !== b.y > sy) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
    if (!xs.length) continue
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.round(xs[k]!))
      const x1 = Math.min(w, Math.round(xs[k + 1]!))
      if (x1 > x0) m.fill(255, y * w + x0, y * w + x1)
    }
  }
  return m
}

/** Magic wand: pixels within `tolerance` (0..255, max channel distance) of the seed color; flood fill when contiguous. */
export function magicWand(px: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tolerance: number, contiguous: boolean): Uint8Array {
  const m = new Uint8Array(w * h)
  sx = Math.floor(sx)
  sy = Math.floor(sy)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return m
  const s = (sy * w + sx) * 4
  const r = px[s]!
  const g = px[s + 1]!
  const b = px[s + 2]!
  const a = px[s + 3]!
  const near = (i: number) => {
    const q = i * 4
    return Math.max(Math.abs(px[q]! - r), Math.abs(px[q + 1]! - g), Math.abs(px[q + 2]! - b), Math.abs(px[q + 3]! - a)) <= tolerance
  }
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (near(i)) m[i] = 255
    return m
  }
  const stack = new Int32Array(w * h)
  let sp = 0
  stack[sp++] = sy * w + sx
  m[sy * w + sx] = 255
  while (sp) {
    const i = stack[--sp]!
    const x = i % w
    const y = (i - x) / w
    if (x > 0 && !m[i - 1] && near(i - 1)) (m[i - 1] = 255), (stack[sp++] = i - 1)
    if (x < w - 1 && !m[i + 1] && near(i + 1)) (m[i + 1] = 255), (stack[sp++] = i + 1)
    if (y > 0 && !m[i - w] && near(i - w)) (m[i - w] = 255), (stack[sp++] = i - w)
    if (y < h - 1 && !m[i + w] && near(i + w)) (m[i + w] = 255), (stack[sp++] = i + w)
  }
  return m
}

export function combine(prev: Uint8Array | null, next: Uint8Array, op: SelectOp): Uint8Array {
  if (op === 'replace' || !prev) return op === 'subtract' ? new Uint8Array(next.length) : next
  const out = new Uint8Array(next.length)
  for (let i = 0; i < next.length; i++) out[i] = op === 'add' ? Math.max(prev[i]!, next[i]!) : Math.max(0, prev[i]! - next[i]!)
  return out
}

export function maskBounds(m: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let any = false
    for (let x = 0; x < w; x++) {
      if (m[row + x]! > 127) {
        any = true
        if (x < x0) x0 = x
        break
      }
    }
    if (!any) continue
    for (let x = w - 1; x >= 0; x--) {
      if (m[row + x]! > 127) {
        if (x > x1) x1 = x
        break
      }
    }
    if (y < y0) y0 = y
    y1 = y
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

export const invertMask = (m: Uint8Array) => m.map((v) => 255 - v)
