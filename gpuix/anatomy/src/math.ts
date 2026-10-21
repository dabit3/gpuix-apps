import type { Vec3 } from './spec/types'

/** Column-major 4x4 affine matrices as Float64Array(16), same layout as WebGL. */
export type Mat4 = Float64Array

export const mat4 = (): Mat4 => {
  const m = new Float64Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

export function mul(a: Mat4, b: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  const r = new Float64Array(16)
  for (let c = 0; c < 4; c++) {
    for (let rI = 0; rI < 4; rI++) {
      r[c * 4 + rI] = a[rI]! * b[c * 4]! + a[4 + rI]! * b[c * 4 + 1]! + a[8 + rI]! * b[c * 4 + 2]! + a[12 + rI]! * b[c * 4 + 3]!
    }
  }
  out.set(r)
  return out
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = mat4()
  m[12] = x; m[13] = y; m[14] = z
  return m
}

export function scaling(x: number, y: number, z: number): Mat4 {
  const m = mat4()
  m[0] = x; m[5] = y; m[10] = z
  return m
}

/** Rotation about an arbitrary (unnormalised) axis, angle in radians. */
export function axisAngle(axis: Vec3, a: number): Mat4 {
  let [x, y, z] = axis
  const len = Math.hypot(x, y, z) || 1
  x /= len; y /= len; z /= len
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c
  const m = mat4()
  m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y
  m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x
  m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c
  return m
}

const DEG = Math.PI / 180
/** Euler XYZ in degrees (applied X, then Y, then Z). */
export function euler(r: Vec3): Mat4 {
  return mul(axisAngle([0, 0, 1], r[2] * DEG), mul(axisAngle([0, 1, 0], r[1] * DEG), axisAngle([1, 0, 0], r[0] * DEG)))
}

export function apply(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!]
}

export function applyDir(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p
  return [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z]
}

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

/** Matrix whose local +Y points along `dir` (unit), origin at `at`. */
export function alignY(at: Vec3, dir: Vec3): Mat4 {
  const y = norm(dir)
  const ref: Vec3 = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const x = norm(cross(ref, y))
  const z = cross(x, y)
  const m = mat4()
  m[0] = x[0]; m[1] = x[1]; m[2] = x[2]
  m[4] = y[0]; m[5] = y[1]; m[6] = y[2]
  m[8] = z[0]; m[9] = z[1]; m[10] = z[2]
  m[12] = at[0]; m[13] = at[1]; m[14] = at[2]
  return m
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
