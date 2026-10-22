// Document geometry (crop, rotate, flip, resize), free-transform resampling, feathering and spot-heal inpainting.
import type { Rect } from './doc'

type Buf = Uint8ClampedArray | Uint8Array
const like = <T extends Buf>(b: T, n: number): T => new (b.constructor as { new (n: number): T })(n)

export function cropBuf<T extends Buf>(src: T, w: number, ch: number, r: Rect): T {
  const nw = r.x1 - r.x0
  const out = like(src, nw * (r.y1 - r.y0) * ch)
  for (let y = r.y0; y < r.y1; y++) out.set(src.subarray((y * w + r.x0) * ch, (y * w + r.x1) * ch), (y - r.y0) * nw * ch)
  return out
}

/** Rotate by quarter turns clockwise (1, 2 or 3). Output is h×w for odd turns. */
export function rotateBuf<T extends Buf>(src: T, w: number, h: number, ch: number, turns: 1 | 2 | 3): T {
  const out = like(src, src.length)
  const nw = turns === 2 ? w : h
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [nx, ny] = turns === 1 ? [h - 1 - y, x] : turns === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x]
      const s = (y * w + x) * ch
      const d = (ny * nw + nx) * ch
      for (let c = 0; c < ch; c++) out[d + c] = src[s + c]!
    }
  return out
}

export function flipBuf<T extends Buf>(src: T, w: number, h: number, ch: number, axis: 'h' | 'v'): T {
  const out = like(src, src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * ch
      const d = axis === 'h' ? (y * w + (w - 1 - x)) * ch : ((h - 1 - y) * w + x) * ch
      for (let c = 0; c < ch; c++) out[d + c] = src[s + c]!
    }
  return out
}

/** Separable triangle-filter resample; widens the kernel when shrinking so downscales don't alias. */
function resample1D(src: Float32Array, w: number, h: number, ch: number, nw: number): Float32Array {
  const out = new Float32Array(nw * h * ch)
  const scale = nw / w
  const support = Math.max(1, 1 / scale)
  for (let x = 0; x < nw; x++) {
    const cx = (x + 0.5) / scale - 0.5
    const a = Math.max(0, Math.floor(cx - support))
    const b = Math.min(w - 1, Math.ceil(cx + support))
    const ws: number[] = []
    let sum = 0
    for (let i = a; i <= b; i++) {
      const wt = Math.max(0, 1 - Math.abs(i - cx) / support)
      ws.push(wt)
      sum += wt
    }
    if (!sum) {
      ws.fill(0)
      ws[Math.min(ws.length - 1, Math.max(0, Math.round(cx) - a))] = 1
      sum = 1
    }
    for (let y = 0; y < h; y++)
      for (let c = 0; c < ch; c++) {
        let v = 0
        for (let i = a; i <= b; i++) v += src[(y * w + i) * ch + c]! * ws[i - a]!
        out[(y * nw + x) * ch + c] = v / sum
      }
  }
  return out
}

function transpose(src: Float32Array, w: number, h: number, ch: number) {
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) out[(x * h + y) * ch + c] = src[(y * w + x) * ch + c]!
  return out
}

/** Resize to nw×nh. RGBA is premultiplied during filtering so transparent edges don't go dark. */
export function resizeBuf<T extends Buf>(src: T, w: number, h: number, ch: number, nw: number, nh: number): T {
  const f = new Float32Array(src.length)
  for (let i = 0; i < src.length; i += ch) {
    const a = ch === 4 ? src[i + 3]! / 255 : 1
    for (let c = 0; c < ch; c++) f[i + c] = ch === 4 && c < 3 ? src[i + c]! * a : src[i + c]!
  }
  let g = resample1D(f, w, h, ch, nw)
  g = transpose(g, nw, h, ch)
  g = resample1D(g, h, nw, ch, nh)
  g = transpose(g, nh, nw, ch)
  const out = like(src, nw * nh * ch)
  for (let i = 0; i < out.length; i += ch) {
    const a = ch === 4 ? g[i + 3]! / 255 : 1
    for (let c = 0; c < ch; c++) out[i + c] = ch === 4 && c < 3 ? (a > 0 ? g[i + c]! / a : 0) : g[i + c]!
  }
  return out
}

export interface Xform {
  /** Centre of the transformed content in doc space. */
  cx: number
  cy: number
  sx: number
  sy: number
  /** Radians. */
  rot: number
}

/** Corners of `box` after the transform, in doc space (TL, TR, BR, BL). */
export function xformCorners(box: Rect, t: Xform): [number, number][] {
  const ox = (box.x0 + box.x1) / 2
  const oy = (box.y0 + box.y1) / 2
  const c = Math.cos(t.rot)
  const s = Math.sin(t.rot)
  return ([[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]] as [number, number][]).map(([x, y]) => {
    const u = (x - ox) * t.sx
    const v = (y - oy) * t.sy
    return [t.cx + u * c - v * s, t.cy + u * s + v * c]
  })
}

/** Bilinear free transform of `box` in src into a fresh buffer; returns the written rect. */
export function affineBuf(src: Uint8ClampedArray, w: number, h: number, box: Rect, t: Xform): { out: Uint8ClampedArray; rect: Rect | null } {
  const out = new Uint8ClampedArray(src.length)
  const cs = xformCorners(box, t)
  const x0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[0]))))
  const y0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[1]))))
  const x1 = Math.min(w, Math.ceil(Math.max(...cs.map((p) => p[0]))) + 1)
  const y1 = Math.min(h, Math.ceil(Math.max(...cs.map((p) => p[1]))) + 1)
  if (x1 <= x0 || y1 <= y0 || !t.sx || !t.sy) return { out, rect: null }
  const ox = (box.x0 + box.x1) / 2
  const oy = (box.y0 + box.y1) / 2
  const c = Math.cos(-t.rot)
  const s = Math.sin(-t.rot)
  const px = (x: number, y: number, k: number) => (x < box.x0 || y < box.y0 || x >= box.x1 || y >= box.y1 ? 0 : src[(y * w + x) * 4 + k]!)
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - t.cx
      const dy = y + 0.5 - t.cy
      const sxf = (dx * c - dy * s) / t.sx + ox - 0.5
      const syf = (dx * s + dy * c) / t.sy + oy - 0.5
      if (sxf < box.x0 - 1 || syf < box.y0 - 1 || sxf > box.x1 || syf > box.y1) continue
      const ix = Math.floor(sxf)
      const iy = Math.floor(syf)
      const fx = sxf - ix
      const fy = syf - iy
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy
      const a00 = px(ix, iy, 3), a10 = px(ix + 1, iy, 3), a01 = px(ix, iy + 1, 3), a11 = px(ix + 1, iy + 1, 3)
      const a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11
      if (a <= 0.01) continue
      const q = (y * w + x) * 4
      for (let k = 0; k < 3; k++) out[q + k] = (px(ix, iy, k) * a00 * w00 + px(ix + 1, iy, k) * a10 * w10 + px(ix, iy + 1, k) * a01 * w01 + px(ix + 1, iy + 1, k) * a11 * w11) / a
      out[q + 3] = a
    }
  return { out, rect: { x0, y0, x1, y1 } }
}

/** Bounds of the non-transparent pixels, or null for an empty layer. */
export function alphaBounds(px: Uint8ClampedArray, w: number, h: number): Rect | null {
  let x0 = w, y0 = h, x1 = 0, y1 = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[(y * w + x) * 4 + 3]! > 0) {
        if (x < x0) x0 = x
        if (x >= x1) x1 = x + 1
        if (y < y0) y0 = y
        if (y >= y1) y1 = y + 1
      }
  return x1 > x0 ? { x0, y0, x1, y1 } : null
}

function boxBlur1(m: Float32Array, w: number, h: number, r: number, horiz: boolean) {
  const out = new Float32Array(m.length)
  const n = horiz ? w : h
  const lines = horiz ? h : w
  const at = (line: number, i: number) => (horiz ? line * w + i : i * w + line)
  for (let l = 0; l < lines; l++) {
    let acc = 0
    for (let i = -r; i <= r; i++) acc += m[at(l, Math.min(n - 1, Math.max(0, i)))]!
    for (let i = 0; i < n; i++) {
      out[at(l, i)] = acc / (2 * r + 1)
      acc += m[at(l, Math.min(n - 1, i + r + 1))]! - m[at(l, Math.max(0, i - r))]!
    }
  }
  return out
}

/** Gaussian-ish feather of an 8-bit mask (three box passes). */
export function featherMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius < 0.5) return mask.slice()
  const r = Math.max(1, Math.round(radius / 1.7))
  let f = Float32Array.from(mask)
  for (let p = 0; p < 3; p++) f = boxBlur1(boxBlur1(f, w, h, r, true), w, h, r, false)
  return Uint8Array.from(f, (v) => Math.round(v))
}

/**
 * Spot heal: fill the pixels where `hole` > 0 inside `r` from their surroundings by solving a membrane
 * (Laplace) interpolation coarse-to-fine, then add back the surrounding grain so the patch doesn't look smeared.
 */
export function inpaint(px: Uint8ClampedArray, w: number, h: number, hole: Float32Array, r: Rect): Uint8ClampedArray {
  const pad = 6
  const x0 = Math.max(0, r.x0 - pad), y0 = Math.max(0, r.y0 - pad), x1 = Math.min(w, r.x1 + pad), y1 = Math.min(h, r.y1 + pad)
  const rw = x1 - x0, rh = y1 - y0
  const out = px.slice()
  const known = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) known[y * rw + x] = hole[(y + y0) * w + x + x0]! > 0.02 ? 0 : 1
  const solve = (vals: Float32Array, kn: Uint8Array, W: number, H: number, iters: number) => {
    for (let it = 0; it < iters; it++)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x
          if (kn[i]) continue
          let s = 0, n = 0
          if (x > 0) (s += vals[i - 1]!), n++
          if (x < W - 1) (s += vals[i + 1]!), n++
          if (y > 0) (s += vals[i - W]!), n++
          if (y < H - 1) (s += vals[i + W]!), n++
          vals[i] = s / n
        }
  }
  for (let c = 0; c < 4; c++) {
    const v = new Float32Array(rw * rh)
    let mean = 0, cnt = 0
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x
        if (known[i]) (v[i] = px[((y + y0) * w + x + x0) * 4 + c]!), (mean += v[i]!), cnt++
      }
    mean = cnt ? mean / cnt : 0
    // Coarse pass: 4× downsampled solve seeds the fine pass so large holes converge quickly.
    const cw = Math.max(1, Math.ceil(rw / 4)), chh = Math.max(1, Math.ceil(rh / 4))
    const cv = new Float32Array(cw * chh).fill(mean)
    const ck = new Uint8Array(cw * chh)
    const acc = new Float32Array(cw * chh), num = new Float32Array(cw * chh)
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) if (known[y * rw + x]) (acc[(y >> 2) * cw + (x >> 2)]! += v[y * rw + x]!), num[(y >> 2) * cw + (x >> 2)]!++
    for (let i = 0; i < cv.length; i++) if (num[i]! >= 12) (cv[i] = acc[i]! / num[i]!), (ck[i] = 1)
    solve(cv, ck, cw, chh, 160)
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) if (!known[y * rw + x]) v[y * rw + x] = cv[Math.min(chh - 1, y >> 2) * cw + Math.min(cw - 1, x >> 2)]!
    solve(v, known, rw, rh, 60)
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x
        if (known[i]) continue
        out[((y + y0) * w + x + x0) * 4 + c] = v[i]!
      }
  }
  // Borrow grain: high-frequency detail from a ring just outside the hole, offset by the hole size.
  const ox = Math.max(4, r.x1 - r.x0)
  for (let y = r.y0; y < r.y1; y++)
    for (let x = r.x0; x < r.x1; x++) {
      const a = hole[y * w + x]!
      if (a <= 0.02) continue
      const sx = x + ox < w - 1 ? x + ox : x - ox
      if (sx < 1 || sx >= w - 1) continue
      const q = (y * w + x) * 4
      const s = (y * w + sx) * 4
      for (let c = 0; c < 3; c++) {
        const hf = px[s + c]! - (px[s - 4 + c]! + px[s + 4 + c]! + px[s + c]! * 2) / 4
        out[q + c] = out[q + c]! + hf * 0.8
      }
    }
  return out
}
