// Destructive filters on a straight-alpha RGBA buffer. Blurs run on premultiplied color so transparent edges don't halo.

export type FilterKind = 'gaussian' | 'unsharp' | 'noise' | 'motion' | 'high-pass' | 'median'

export const FILTER_LABELS: Record<FilterKind, string> = {
  gaussian: 'Gaussian Blur',
  unsharp: 'Unsharp Mask',
  noise: 'Add Noise',
  motion: 'Motion Blur',
  'high-pass': 'High Pass',
  median: 'Median',
}

/** Default strength (pixels for blurs, percent for noise). */
export const FILTER_DEFAULT: Record<FilterKind, number> = { gaussian: 8, unsharp: 3, noise: 12, motion: 24, 'high-pass': 6, median: 2 }

function premul(px: Uint8ClampedArray): Float32Array {
  const f = new Float32Array(px.length)
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]! / 255
    f[i] = px[i]! * a
    f[i + 1] = px[i + 1]! * a
    f[i + 2] = px[i + 2]! * a
    f[i + 3] = px[i + 3]!
  }
  return f
}

function unpremul(f: Float32Array, out: Uint8ClampedArray) {
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3]!
    const k = a > 0 ? 255 / a : 0
    out[i] = f[i]! * k
    out[i + 1] = f[i + 1]! * k
    out[i + 2] = f[i + 2]! * k
    out[i + 3] = a
  }
}

/** One horizontal or vertical box blur pass (radius r) with a running sum; edges clamp. */
function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) {
  const len = horizontal ? w : h
  const lines = horizontal ? h : w
  const stride = horizontal ? 4 : w * 4
  const norm = 1 / (2 * r + 1)
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w * 4 : l * 4
    for (let c = 0; c < 4; c++) {
      let sum = 0
      for (let k = -r; k <= r; k++) sum += src[base + Math.min(len - 1, Math.max(0, k)) * stride + c]!
      for (let i = 0; i < len; i++) {
        dst[base + i * stride + c] = sum * norm
        const add = Math.min(len - 1, i + r + 1)
        const sub = Math.max(0, i - r)
        sum += src[base + add * stride + c]! - src[base + sub * stride + c]!
      }
    }
  }
}

/** Gaussian approximated by three box blurs (Wells 1986). */
export function gaussianBlurF(f: Float32Array, w: number, h: number, sigma: number) {
  if (sigma <= 0) return f
  const n = 3
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal)
  if (wl % 2 === 0) wl--
  const wu = wl + 2
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4))
  const tmp = new Float32Array(f.length)
  for (let i = 0; i < n; i++) {
    const r = ((i < m ? wl : wu) - 1) / 2
    boxPass(f, tmp, w, h, r, true)
    boxPass(tmp, f, w, h, r, false)
  }
  return f
}

function motionBlurF(f: Float32Array, w: number, h: number, dist: number) {
  const r = Math.max(1, Math.round(dist / 2))
  const tmp = new Float32Array(f.length)
  boxPass(f, tmp, w, h, r, true)
  boxPass(tmp, f, w, h, r, true)
  return f
}

function median(px: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px)
  const hist = new Uint32Array(256)
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        hist.fill(0)
        let n = 0
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy))
          for (let dx = -r; dx <= r; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx))
            hist[px[(yy * w + xx) * 4 + c]!]!++
            n++
          }
        }
        let acc = 0
        let v = 0
        while (v < 255 && (acc += hist[v]!) <= n / 2) v++
        out[(y * w + x) * 4 + c] = v
      }
    }
  }
  return out
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Run a filter on `px` (w×h) and return the filtered copy. The caller blends it back through the selection.
 * `amount` is the radius in px for blurs / sharpening and the percent for noise.
 */
export function runFilter(kind: FilterKind, px: Uint8ClampedArray, w: number, h: number, amount: number, seed = 1): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length)
  switch (kind) {
    case 'gaussian': {
      unpremul(gaussianBlurF(premul(px), w, h, amount / 2), out)
      return out
    }
    case 'motion': {
      unpremul(motionBlurF(premul(px), w, h, amount), out)
      return out
    }
    case 'unsharp':
    case 'high-pass': {
      const blur = new Uint8ClampedArray(px.length)
      unpremul(gaussianBlurF(premul(px), w, h, amount / 2), blur)
      const k = kind === 'unsharp' ? 1.2 : 1
      for (let i = 0; i < px.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const d = px[i + c]! - blur[i + c]!
          out[i + c] = kind === 'unsharp' ? px[i + c]! + d * k : 128 + d
        }
        out[i + 3] = px[i + 3]!
      }
      return out
    }
    case 'noise': {
      const rnd = mulberry32(seed)
      const s = (amount / 100) * 255
      for (let i = 0; i < px.length; i += 4) {
        const n = (rnd() + rnd() + rnd() - 1.5) * s
        out[i] = px[i]! + n
        out[i + 1] = px[i + 1]! + n
        out[i + 2] = px[i + 2]! + n
        out[i + 3] = px[i + 3]!
      }
      return out
    }
    case 'median':
      return median(px, w, h, Math.max(1, Math.round(amount)))
  }
}
