/** Parses hex / rgb() / hsl() colour input and converts between formats. */
export interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

const clamp = (v: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, v))

export function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase()
  let m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (m && (s.startsWith('#') || /[a-f]/.test(m[1]!) || m[1]!.length === 6)) {
    let h = m[1]!
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  m = s.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:[\s,/]+(\d*\.?\d+))?\s*\)$/)
  if (m) return { r: clamp(+m[1]!), g: clamp(+m[2]!), b: clamp(+m[3]!), a: m[4] ? clamp(+m[4], 0, 1) : 1 }
  m = s.match(/^hsla?\(\s*(\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%(?:[\s,/]+(\d*\.?\d+))?\s*\)$/)
  if (m) return { ...hslToRgb(+m[1]!, +m[2]!, +m[3]!), a: m[4] ? clamp(+m[4], 0, 1) : 1 }
  return null
}

export function hslToRgb(h: number, s: number, l: number): Omit<Rgb, 'a'> {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) }
}

export function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)]
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0')
export const toHex = (c: Rgb) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ''}`.toUpperCase()
export const toRgbString = (c: Rgb) =>
  c.a < 1 ? `rgba(${c.r}, ${c.g}, ${c.b}, ${+c.a.toFixed(2)})` : `rgb(${c.r}, ${c.g}, ${c.b})`
export const toHslString = (c: Rgb) => {
  const [h, s, l] = rgbToHsl(c)
  return `hsl(${h}, ${s}%, ${l}%)`
}

export function toOklch(c: Rgb): string {
  const lin = (v: number) => {
    v /= 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [lin(c.r), lin(c.g), lin(c.b)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.sqrt(A * A + B * B)
  let H = (Math.atan2(B, A) * 180) / Math.PI
  if (H < 0) H += 360
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${C < 0.0005 ? 0 : H.toFixed(1)})`
}

/** Nine tints and shades around the input, for the picker strip. */
export function shades(c: Rgb): string[] {
  const [h, s] = rgbToHsl(c)
  return [95, 88, 78, 66, 54, 44, 34, 24, 14].map((l) => {
    const { r, g, b } = hslToRgb(h, s, l)
    return toHex({ r, g, b, a: 1 })
  })
}

export const isLight = (c: Rgb) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 150
