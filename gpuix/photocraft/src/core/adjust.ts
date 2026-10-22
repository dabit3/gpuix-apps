// Non-destructive adjustment layers: each one maps a straight RGB color (0..1) to a new color.

export type AdjustKind = 'levels' | 'color-balance' | 'hue-sat' | 'brightness-contrast' | 'curves' | 'exposure' | 'vibrance' | 'black-white' | 'invert' | 'threshold'

export type Adjust =
  | { kind: 'levels'; inBlack: number; gamma: number; inWhite: number; outBlack: number; outWhite: number }
  | { kind: 'color-balance'; cyanRed: number; magentaGreen: number; yellowBlue: number; preserveLuminosity: boolean }
  | { kind: 'hue-sat'; hue: number; saturation: number; lightness: number }
  | { kind: 'brightness-contrast'; brightness: number; contrast: number }
  | { kind: 'curves'; points: [number, number][] }
  | { kind: 'exposure'; ev: number }
  | { kind: 'vibrance'; amount: number }
  | { kind: 'black-white' }
  | { kind: 'invert' }
  | { kind: 'threshold'; level: number }

export const ADJUST_LABELS: Record<AdjustKind, string> = {
  levels: 'Levels',
  'color-balance': 'Color Balance',
  'hue-sat': 'Hue / Saturation',
  'brightness-contrast': 'Brightness / Contrast',
  curves: 'Curves',
  exposure: 'Exposure',
  vibrance: 'Vibrance',
  'black-white': 'Black & White',
  invert: 'Invert',
  threshold: 'Threshold',
}

export function defaultAdjust(kind: AdjustKind): Adjust {
  switch (kind) {
    case 'levels':
      return { kind, inBlack: 0.06, gamma: 1.1, inWhite: 0.94, outBlack: 0, outWhite: 1 }
    case 'color-balance':
      return { kind, cyanRed: 12, magentaGreen: 0, yellowBlue: -14, preserveLuminosity: true }
    case 'hue-sat':
      return { kind, hue: 0, saturation: 25, lightness: 0 }
    case 'brightness-contrast':
      return { kind, brightness: 10, contrast: 20 }
    case 'curves':
      return { kind, points: [[0, 0], [0.25, 0.18], [0.75, 0.84], [1, 1]] }
    case 'exposure':
      return { kind, ev: 0.5 }
    case 'vibrance':
      return { kind, amount: 40 }
    case 'threshold':
      return { kind, level: 0.5 }
    default:
      return { kind } as Adjust
  }
}

/** Monotone cubic (Fritsch-Carlson) interpolation through the curve points, sampled into a 256-entry LUT. */
export function curveLut(points: [number, number][]): Float32Array {
  const p = [...points].sort((a, b) => a[0] - b[0])
  const n = p.length
  const lut = new Float32Array(256)
  if (n < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i / 255
    return lut
  }
  const d: number[] = []
  const m: number[] = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1]![1] - p[i]![1]) / (p[i + 1]![0] - p[i]![0] || 1e-6))
  m[0] = d[0]!
  m[n - 1] = d[n - 2]!
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i]! / d[i]!
    const b = m[i + 1]! / d[i]!
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]!
      m[i + 1] = t * b * d[i]!
    }
  }
  let k = 0
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    if (x <= p[0]![0]) {
      lut[i] = p[0]![1]
      continue
    }
    if (x >= p[n - 1]![0]) {
      lut[i] = p[n - 1]![1]
      continue
    }
    while (k < n - 2 && x > p[k + 1]![0]) k++
    const h = p[k + 1]![0] - p[k]![0]
    const t = (x - p[k]![0]) / h
    const t2 = t * t
    const t3 = t2 * t
    lut[i] = Math.min(1, Math.max(0, (2 * t3 - 3 * t2 + 1) * p[k]![1] + (t3 - 2 * t2 + t) * h * m[k]! + (-2 * t3 + 3 * t2) * p[k + 1]![1] + (t3 - t2) * h * m[k + 1]!))
  }
  return lut
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function rgbToHsl(r: number, g: number, b: number, o: number[]) {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  let h = 0
  let s = 0
  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  o[0] = h
  o[1] = s
  o[2] = l
}

const hue2 = (p: number, q: number, t: number) => {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h: number, s: number, l: number, o: number[]) {
  if (s === 0) {
    o[0] = o[1] = o[2] = l
    return
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  o[0] = hue2(p, q, h + 1 / 3)
  o[1] = hue2(p, q, h)
  o[2] = hue2(p, q, h - 1 / 3)
}

export type Adjuster = (r: number, g: number, b: number, out: number[]) => void

export function makeAdjuster(a: Adjust): Adjuster {
  const hsl = [0, 0, 0]
  switch (a.kind) {
    case 'levels': {
      const lut = levelsLut(a)
      return (r, g, b, o) => {
        o[0] = lut[(r * 255 + 0.5) | 0]!
        o[1] = lut[(g * 255 + 0.5) | 0]!
        o[2] = lut[(b * 255 + 0.5) | 0]!
      }
    }
    case 'color-balance': {
      // Midtone shift: strongest at 50% luma, fading to nothing at black and white.
      const k = [a.cyanRed / 100, a.magentaGreen / 100, a.yellowBlue / 100]
      return (r, g, b, o) => {
        const l0 = 0.3 * r + 0.59 * g + 0.11 * b
        const wgt = 4 * l0 * (1 - l0) * 0.32
        o[0] = clamp01(r + k[0]! * wgt)
        o[1] = clamp01(g + k[1]! * wgt)
        o[2] = clamp01(b + k[2]! * wgt)
        if (a.preserveLuminosity) {
          const d = l0 - (0.3 * o[0]! + 0.59 * o[1]! + 0.11 * o[2]!)
          o[0] = clamp01(o[0]! + d)
          o[1] = clamp01(o[1]! + d)
          o[2] = clamp01(o[2]! + d)
        }
      }
    }
    case 'hue-sat': {
      const dh = a.hue / 360
      const ds = a.saturation / 100
      const dl = a.lightness / 100
      return (r, g, b, o) => {
        rgbToHsl(r, g, b, hsl)
        let h = hsl[0]! + dh
        h -= Math.floor(h)
        const s = clamp01(ds >= 0 ? hsl[1]! + (1 - hsl[1]!) * ds * hsl[1]! * 1.6 : hsl[1]! * (1 + ds))
        const l = clamp01(dl >= 0 ? hsl[2]! + (1 - hsl[2]!) * dl : hsl[2]! * (1 + dl))
        hslToRgb(h, s, l, o)
      }
    }
    case 'brightness-contrast': {
      const br = a.brightness / 200
      const c = Math.tan(((a.contrast / 100) * 0.98 + 1) * (Math.PI / 4))
      return (r, g, b, o) => {
        o[0] = clamp01((r - 0.5) * c + 0.5 + br)
        o[1] = clamp01((g - 0.5) * c + 0.5 + br)
        o[2] = clamp01((b - 0.5) * c + 0.5 + br)
      }
    }
    case 'curves': {
      const lut = curveLut(a.points)
      return (r, g, b, o) => {
        o[0] = lut[(r * 255 + 0.5) | 0]!
        o[1] = lut[(g * 255 + 0.5) | 0]!
        o[2] = lut[(b * 255 + 0.5) | 0]!
      }
    }
    case 'exposure': {
      const k = 2 ** a.ev
      const enc = (v: number) => clamp01(Math.pow(Math.pow(v, 2.2) * k, 1 / 2.2))
      return (r, g, b, o) => {
        o[0] = enc(r)
        o[1] = enc(g)
        o[2] = enc(b)
      }
    }
    case 'vibrance': {
      const amt = a.amount / 100
      return (r, g, b, o) => {
        const mx = Math.max(r, g, b)
        const avg = (r + g + b) / 3
        const k = (1 - (mx - Math.min(r, g, b))) * amt * 1.5
        o[0] = clamp01(r + (r - avg) * k)
        o[1] = clamp01(g + (g - avg) * k)
        o[2] = clamp01(b + (b - avg) * k)
      }
    }
    case 'black-white':
      return (r, g, b, o) => {
        o[0] = o[1] = o[2] = 0.3 * r + 0.59 * g + 0.11 * b
      }
    case 'invert':
      return (r, g, b, o) => {
        o[0] = 1 - r
        o[1] = 1 - g
        o[2] = 1 - b
      }
    case 'threshold': {
      const t = a.level
      return (r, g, b, o) => {
        o[0] = o[1] = o[2] = 0.3 * r + 0.59 * g + 0.11 * b >= t ? 1 : 0
      }
    }
  }
}

/** Input black/white points, midtone gamma, then output range: the classic Levels transfer curve. */
export function levelsLut(a: { inBlack: number; gamma: number; inWhite: number; outBlack: number; outWhite: number }): Float32Array {
  const lut = new Float32Array(256)
  const span = Math.max(1 / 255, a.inWhite - a.inBlack)
  for (let i = 0; i < 256; i++) {
    const t = clamp01((i / 255 - a.inBlack) / span)
    lut[i] = clamp01(a.outBlack + Math.pow(t, 1 / Math.max(0.1, a.gamma)) * (a.outWhite - a.outBlack))
  }
  return lut
}
