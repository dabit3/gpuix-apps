// Blend modes from the W3C Compositing and Blending Level 1 spec (§9 and §10). Colors are straight, in 0..1.

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const

export type BlendMode = (typeof BLEND_MODES)[number]

export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  'hard-light': 'Hard Light',
  'soft-light': 'Soft Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
}

export const isSeparable = (m: BlendMode) => m !== 'hue' && m !== 'saturation' && m !== 'color' && m !== 'luminosity'

const screen = (b: number, s: number) => b + s - b * s
const hardLight = (b: number, s: number) => (s <= 0.5 ? b * 2 * s : screen(b, 2 * s - 1))

/** Separable blend function B(Cb, Cs) for one channel. */
export function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'normal':
      return s
    case 'multiply':
      return b * s
    case 'screen':
      return screen(b, s)
    case 'overlay':
      return hardLight(s, b)
    case 'darken':
      return Math.min(b, s)
    case 'lighten':
      return Math.max(b, s)
    case 'color-dodge':
      if (b === 0) return 0
      if (s >= 1) return 1
      return Math.min(1, b / (1 - s))
    case 'color-burn':
      if (b >= 1) return 1
      if (s <= 0) return 0
      return 1 - Math.min(1, (1 - b) / s)
    case 'hard-light':
      return hardLight(b, s)
    case 'soft-light': {
      if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b)
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
      return b + (2 * s - 1) * (d - b)
    }
    case 'difference':
      return Math.abs(b - s)
    case 'exclusion':
      return b + s - 2 * b * s
    default:
      return s
  }
}

const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b

function clipColor(c: number[]) {
  const l = lum(c[0]!, c[1]!, c[2]!)
  const n = Math.min(c[0]!, c[1]!, c[2]!)
  const x = Math.max(c[0]!, c[1]!, c[2]!)
  for (let i = 0; i < 3; i++) {
    let v = c[i]!
    if (n < 0) v = l + ((v - l) * l) / (l - n || 1)
    if (x > 1) v = l + ((v - l) * (1 - l)) / (x - l || 1)
    c[i] = v
  }
}

function setLum(c: number[], l: number) {
  const d = l - lum(c[0]!, c[1]!, c[2]!)
  c[0]! += d
  c[1]! += d
  c[2]! += d
  clipColor(c)
}

const sat = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b)

function setSat(c: number[], s: number) {
  const idx = [0, 1, 2].sort((a, b) => c[a]! - c[b]!)
  const [lo, mid, hi] = idx as [number, number, number]
  if (c[hi]! > c[lo]!) {
    c[mid] = ((c[mid]! - c[lo]!) * s) / (c[hi]! - c[lo]!)
    c[hi] = s
  } else {
    c[mid] = 0
    c[hi] = 0
  }
  c[lo] = 0
}

const tmp = [0, 0, 0]

/** Non-separable blend (hue, saturation, color, luminosity). Writes into out. */
export function blendNonSeparable(mode: BlendMode, br: number, bg: number, bb: number, sr: number, sg: number, sb: number, out: number[]) {
  switch (mode) {
    case 'hue':
      tmp[0] = sr
      tmp[1] = sg
      tmp[2] = sb
      setSat(tmp, sat(br, bg, bb))
      setLum(tmp, lum(br, bg, bb))
      break
    case 'saturation':
      tmp[0] = br
      tmp[1] = bg
      tmp[2] = bb
      setSat(tmp, sat(sr, sg, sb))
      setLum(tmp, lum(br, bg, bb))
      break
    case 'color':
      tmp[0] = sr
      tmp[1] = sg
      tmp[2] = sb
      setLum(tmp, lum(br, bg, bb))
      break
    default:
      tmp[0] = br
      tmp[1] = bg
      tmp[2] = bb
      setLum(tmp, lum(sr, sg, sb))
  }
  out[0] = tmp[0]!
  out[1] = tmp[1]!
  out[2] = tmp[2]!
}

const nsOut = [0, 0, 0]

/**
 * Composite one straight-alpha source pixel over a straight-alpha backdrop (source-over with a blend mode, §5.3):
 *   Cr = (1 - ab)·Cs + ab·B(Cb, Cs);  ao = as + ab·(1 - as);  Co = (as·Cr + (1 - as)·ab·Cb) / ao
 */
export function compositePixel(mode: BlendMode, b: number[], s: number[], as: number, out: number[]) {
  const ab = b[3]!
  if (as <= 0) {
    out[0] = b[0]!
    out[1] = b[1]!
    out[2] = b[2]!
    out[3] = ab
    return
  }
  let mr: number, mg: number, mb: number
  if (isSeparable(mode)) {
    mr = blendChannel(mode, b[0]!, s[0]!)
    mg = blendChannel(mode, b[1]!, s[1]!)
    mb = blendChannel(mode, b[2]!, s[2]!)
  } else {
    blendNonSeparable(mode, b[0]!, b[1]!, b[2]!, s[0]!, s[1]!, s[2]!, nsOut)
    mr = nsOut[0]!
    mg = nsOut[1]!
    mb = nsOut[2]!
  }
  const ao = as + ab * (1 - as)
  const k = (1 - as) * ab
  out[0] = (as * ((1 - ab) * s[0]! + ab * mr) + k * b[0]!) / ao
  out[1] = (as * ((1 - ab) * s[1]! + ab * mg) + k * b[1]!) / ao
  out[2] = (as * ((1 - ab) * s[2]! + ab * mb) + k * b[2]!) / ao
  out[3] = ao
}
