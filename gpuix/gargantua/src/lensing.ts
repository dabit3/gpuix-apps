import { DPHI, NPHI, alphaAt, type Table } from './geodesic'
import { unaberrate } from './physics'

type V3 = [number, number, number]

/**
 * Where a point source at P appears to a camera at C: the directions (in the static frame at C) of its primary and
 * secondary images. Both lie in the plane through C, P and the hole; the primary ray sweeps the angle ψ between C and
 * P, the secondary goes round the other side and sweeps 2π − ψ. We search the table for the ray whose u(φ) passes
 * through 1/|P| at that swept angle.
 */
export function images(T: Table, C: V3, P: V3): { d: V3; order: number; a: number }[] {
  const cl = Math.hypot(C[0], C[1], C[2]), pl = Math.hypot(P[0], P[1], P[2])
  const ex: V3 = [C[0] / cl, C[1] / cl, C[2] / cl]
  const cp = (P[0] * ex[0] + P[1] * ex[1] + P[2] * ex[2]) / pl
  const psi = Math.acos(Math.max(-1, Math.min(1, cp)))
  let ey: V3 = [P[0] / pl - cp * ex[0], P[1] / pl - cp * ex[1], P[2] / pl - cp * ex[2]]
  const el = Math.hypot(ey[0], ey[1], ey[2])
  if (el < 1e-6) ey = Math.abs(ex[1]) < 0.9 ? norm(cross(ex, [0, 1, 0])) : norm(cross(ex, [1, 0, 0]))
  else ey = [ey[0] / el, ey[1] / el, ey[2] / el]
  const up = 1 / pl
  const out: { d: V3; order: number; a: number }[] = []
  for (const [order, phi, sgn] of [[0, psi, 1], [1, 2 * Math.PI - psi, -1]] as const) {
    const a = solve(T, phi, up)
    if (a == null) continue
    const s = Math.sin(a), c = Math.cos(a)
    out.push({ d: [-c * ex[0] + s * sgn * ey[0], -c * ex[1] + s * sgn * ey[1], -c * ex[2] + s * sgn * ey[2]], order, a })
  }
  return out
}

function uAt(T: Table, i: number, phi: number) {
  if (phi > T.end[i]!) return -1
  const f = phi / DPHI, j = Math.floor(f)
  if (j >= NPHI - 1) return -1
  const a = T.u[i * NPHI + j]!, b = T.u[i * NPHI + j + 1]!
  if (a < 0 || b < 0) return -1
  return a + (b - a) * (f - j)
}

/** α of the most direct table ray reaching u at swept angle φ (scanning from outward-pointing rays inward). */
function solve(T: Table, phi: number, u: number): number | null {
  let prev = uAt(T, T.na - 1, phi)
  for (let i = T.na - 2; i >= 0; i--) {
    const cur = uAt(T, i, phi)
    if (prev >= 0 && cur >= 0 && (prev - u) * (cur - u) <= 0 && prev !== cur) {
      const f = (u - prev) / (cur - prev)
      const a1 = alphaAt((i + 1) / (T.na - 1), T.ac), a0 = alphaAt(i / (T.na - 1), T.ac)
      return a1 + (a0 - a1) * f
    }
    prev = cur
  }
  return null
}

/** Static-frame direction → the falling camera's frame (inverse aberration about the inward radial direction). */
export function toCamera(d: V3, inward: V3, v: number): V3 {
  if (v <= 0) return d
  const cs = d[0] * inward[0] + d[1] * inward[1] + d[2] * inward[2]
  const co = unaberrate(cs, v)
  let p: V3 = [d[0] - cs * inward[0], d[1] - cs * inward[1], d[2] - cs * inward[2]]
  const pl = Math.hypot(p[0], p[1], p[2])
  p = pl > 1e-9 ? [p[0] / pl, p[1] / pl, p[2] / pl] : [0, 0, 0]
  const so = Math.sqrt(Math.max(0, 1 - co * co))
  return [co * inward[0] + so * p[0], co * inward[1] + so * p[1], co * inward[2] + so * p[2]]
}

export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
