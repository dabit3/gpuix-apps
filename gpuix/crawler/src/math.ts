export type V2 = { x: number; y: number }
export type V3 = { x: number; y: number; z: number }

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const len2 = (x: number, y: number) => Math.hypot(x, y)
export const len3 = (v: V3) => Math.hypot(v.x, v.y, v.z)
export const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const add3 = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const scale3 = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
export const norm3 = (a: V3): V3 => {
  const l = len3(a) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}
export const lerp3 = (a: V3, b: V3, t: number): V3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
})
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t)
export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

/**
 * Analytic two-bone IK. Places the knee so |hip-knee| = l1 and |knee-end| = l2,
 * bending toward `bendHint` (projected onto the plane orthogonal to hip→target).
 * The target is clamped into the reachable shell.
 */
export function solveTwoBone(hip: V3, target: V3, l1: number, l2: number, bendHint: V3) {
  const d0 = sub3(target, hip)
  const dist = len3(d0)
  const minD = Math.abs(l1 - l2) + 1e-3
  const maxD = l1 + l2 - 1e-3
  const d = clamp(dist, minD, maxD)
  const u = dist > 1e-6 ? scale3(d0, 1 / dist) : { x: 1, y: 0, z: 0 }
  const end = add3(hip, scale3(u, d))
  // bend direction orthogonal to u
  let b = sub3(bendHint, scale3(u, dot3(bendHint, u)))
  if (len3(b) < 1e-6) b = { x: 0, y: 0, z: 1 }
  b = norm3(b)
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  const knee = add3(add3(hip, scale3(u, a)), scale3(b, h))
  return { knee, end, reached: dist <= maxD + 1e-6 }
}

/** Critically damped spring step for an angle. Returns [angle, velocity]. */
export function springAngle(cur: number, vel: number, target: number, omega: number, dt: number): [number, number] {
  const x = wrapAngle(cur - target)
  const exp = Math.exp(-omega * dt)
  const temp = (vel + omega * x) * dt
  const nv = (vel - omega * temp) * exp
  const nx = (x + temp) * exp
  return [wrapAngle(target + nx), nv]
}

/** Legs 0..3 are left (front→back), 4..7 right. Alternating tetrapod gait groups. */
export const GAIT_GROUPS: readonly (readonly number[])[] = [
  [0, 5, 2, 7], // L1 R2 L3 R4
  [4, 1, 6, 3], // R1 L2 R3 L4
]
export const legGroup = (leg: number) => (GAIT_GROUPS[0]!.includes(leg) ? 0 : 1)
export function adjacentLegs(a: number, b: number) {
  const sa = a < 4 ? 0 : 1
  const sb = b < 4 ? 0 : 1
  const ia = a % 4
  const ib = b % 4
  if (sa === sb) return Math.abs(ia - ib) === 1
  return ia === ib
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
