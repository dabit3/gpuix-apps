export type V3 = [number, number, number]

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z]
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Snell refraction of unit `d` through unit normal `n` (facing against d), eta = n1/n2. Returns null on total internal reflection. */
export function refract(d: V3, n: V3, eta: number): V3 | null {
  const cosi = -dot(n, d)
  const k = 1 - eta * eta * (1 - cosi * cosi)
  if (k < 0) return null
  const s = eta * cosi - Math.sqrt(k)
  return [eta * d[0] + s * n[0], eta * d[1] + s * n[1], eta * d[2] + s * n[2]]
}
