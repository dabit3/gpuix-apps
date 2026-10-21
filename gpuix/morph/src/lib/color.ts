export type RGBA = [number, number, number, number]

export function parse(c: string): RGBA {
  const h = c.replace('#', '')
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) / 255 : 1]
}
export function hex([r, g, b, a]: RGBA): string {
  const t = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${t(r)}${t(g)}${t(b)}${a >= 0.999 ? '' : t(a * 255)}`
}
export function mixColor(a: string, b: string, t: number): string {
  const x = parse(a), y = parse(b), k = Math.max(0, Math.min(1, t))
  return hex([0, 1, 2, 3].map((i) => x[i]! + (y[i]! - x[i]!) * k) as RGBA)
}
export function withAlpha(c: string, a: number): string {
  const [r, g, b] = parse(c)
  return hex([r, g, b, Math.max(0, Math.min(1, a))])
}
