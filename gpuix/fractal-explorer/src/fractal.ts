/**
 * Pure fractal math shared by the workers and the main thread: palettes,
 * the escape-time kernel, and the tile renderer. No DOM, no GPUIX.
 *
 * Pixels are written as little-endian Uint32 values `0xAARRGGBB`, which lay
 * out in memory as B, G, R, A: GPUI's native BGRA order, so
 * `setImagePixels(..., { format: 'bgra' })` uploads them without a swizzle.
 */

export type FractalKind = 'mandelbrot' | 'julia'

export type PaletteId = 'classic' | 'ember' | 'glacier' | 'citrus' | 'graphite' | 'coral'

export interface Palette {
  id: PaletteId
  name: string
  /** Gradient stops, evenly spaced around one cycle. */
  stops: string[]
  /** Colour for points that never escape. */
  interior: string
}

export const PALETTES: Palette[] = [
  {
    id: 'classic',
    name: 'Classic',
    // The Ultra Fractal default gradient: midnight blue, white, amber, black.
    stops: ['#000764', '#206bcb', '#edffff', '#ffaa00', '#2a1102', '#000764'],
    interior: '#000000',
  },
  {
    id: 'ember',
    name: 'Ember',
    stops: ['#0b0303', '#5c0d06', '#c43c0e', '#f59a23', '#ffe9a8', '#7a1f08', '#0b0303'],
    interior: '#050101',
  },
  {
    id: 'glacier',
    name: 'Glacier',
    stops: ['#03101f', '#0b3c5d', '#1d7fa6', '#7fd3e6', '#f2fbff', '#2a6f97', '#03101f'],
    interior: '#020a14',
  },
  {
    id: 'citrus',
    name: 'Citrus',
    stops: ['#06120a', '#14532d', '#4d9b3a', '#c8e05a', '#fff7c2', '#e3a72f', '#06120a'],
    interior: '#030805',
  },
  {
    id: 'coral',
    name: 'Coral Reef',
    stops: ['#04161a', '#0e5e6f', '#3fb7a6', '#f7f3e3', '#f08a5d', '#b83b5e', '#04161a'],
    interior: '#020b0d',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    stops: ['#0a0a0b', '#3a3c40', '#a9adb3', '#f5f6f7', '#6b6f75', '#0a0a0b'],
    interior: '#000000',
  },
]

export const LUT_SIZE = 2048

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function packBgra(r: number, g: number, b: number): number {
  return ((255 << 24) | (r << 16) | (g << 8) | b) >>> 0
}

/** One cycle of the palette as packed BGRA, smoothstepped between stops. */
export function buildLut(palette: Palette): Uint32Array {
  const lut = new Uint32Array(LUT_SIZE)
  const stops = palette.stops.map(parseHex)
  const segments = stops.length - 1
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i / LUT_SIZE) * segments
    const k = Math.min(segments - 1, Math.floor(t))
    let f = t - k
    f = f * f * (3 - 2 * f)
    const a = stops[k]!
    const b = stops[k + 1]!
    lut[i] = packBgra(
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    )
  }
  return lut
}

export function interiorColor(palette: Palette): number {
  const [r, g, b] = parseHex(palette.interior)
  return packBgra(r, g, b)
}

export function paletteById(id: PaletteId): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]!
}

/** Sample `n` evenly spaced colours from a palette, as `#rrggbb`. */
export function paletteSwatches(palette: Palette, n: number): string[] {
  const lut = buildLut(palette)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const v = lut[Math.floor((i / n) * LUT_SIZE)]!
    out.push('#' + (v & 0xffffff).toString(16).padStart(6, '0'))
  }
  return out
}

const BAILOUT = 256
const LOG2 = Math.LN2

/**
 * Smooth escape count for z -> z^2 + c, or -1 when the orbit stays bounded.
 * Includes cardioid / period-2 bulb rejection and Brent-style periodicity
 * checking so deep interior pixels exit early instead of running maxIter.
 */
export function escape(
  zr: number,
  zi: number,
  cr: number,
  ci: number,
  maxIter: number,
  mandelbrot: boolean,
  periodEps: number,
): number {
  if (mandelbrot) {
    const xq = cr - 0.25
    const q = xq * xq + ci * ci
    if (q * (q + xq) <= 0.25 * ci * ci) return -1
    const xb = cr + 1
    if (xb * xb + ci * ci <= 0.0625) return -1
  }
  let zr2 = zr * zr
  let zi2 = zi * zi
  let pr = zr
  let pi = zi
  let period = 0
  let check = 8
  let n = 0
  while (n < maxIter) {
    zi = 2 * zr * zi + ci
    zr = zr2 - zi2 + cr
    zr2 = zr * zr
    zi2 = zi * zi
    n++
    const m = zr2 + zi2
    if (m > BAILOUT) {
      return n + 1 - Math.log(0.5 * Math.log(m)) / LOG2
    }
    if (Math.abs(zr - pr) < periodEps && Math.abs(zi - pi) < periodEps) return -1
    if (++period === check) {
      period = 0
      check *= 2
      pr = zr
      pi = zi
    }
  }
  return -1
}

export interface TileJob {
  kind: FractalKind
  /** Target pixel buffer (SharedArrayBuffer in the app). */
  width: number
  height: number
  x0: number
  y0: number
  x1: number
  y1: number
  /** Complex coordinate of pixel (0, 0)'s centre and the size of one pixel. */
  originRe: number
  originIm: number
  pixelSize: number
  maxIter: number
  juliaRe: number
  juliaIm: number
  /** Colour density: cycles per sqrt(iteration). */
  density: number
}

/**
 * Render one rectangle. `shouldAbort` is polled once per row so a stale job
 * stops within a row's worth of work. Returns the iteration total, or -1 if
 * aborted.
 */
export function renderTile(
  job: TileJob,
  out: Uint32Array,
  lut: Uint32Array,
  interior: number,
  shouldAbort?: () => boolean,
): number {
  const { width, x0, y0, x1, y1, originRe, originIm, pixelSize, maxIter, density } = job
  const mandelbrot = job.kind === 'mandelbrot'
  const periodEps = Math.min(1e-12, pixelSize * 1e-3)
  const lutMask = LUT_SIZE - 1
  let iters = 0
  for (let y = y0; y < y1; y++) {
    if (shouldAbort && shouldAbort()) return -1
    const im = originIm - y * pixelSize
    let idx = y * width + x0
    for (let x = x0; x < x1; x++, idx++) {
      const re = originRe + x * pixelSize
      const mu = mandelbrot
        ? escape(0, 0, re, im, maxIter, true, periodEps)
        : escape(re, im, job.juliaRe, job.juliaIm, maxIter, false, periodEps)
      if (mu < 0) {
        out[idx] = interior
        iters += maxIter
      } else {
        iters += mu
        const t = Math.sqrt(mu > 0 ? mu : 0) * density
        out[idx] = lut[Math.floor((t - Math.floor(t)) * LUT_SIZE) & lutMask]!
      }
    }
  }
  return iters
}
