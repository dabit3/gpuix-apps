import { fbm, noise3 } from './noise'

/**
 * Accretion-disk density texture over (log r, azimuth), periodic in azimuth. Gas streams in tight spirals, so the
 * noise is stretched along the flow. Two copies are advected at the local Keplerian rate and cross-faded on a
 * staggered period, which keeps differential rotation visible without the pattern shearing into fine rings.
 */
export const DISK_NR = 192
export const DISK_NA = 1024
export const DISK_IN = 3
export const DISK_OUT = 20
export const LR0 = Math.log(DISK_IN)
export const LR1 = Math.log(DISK_OUT)

export function fillDisk(buf: Float32Array, i0: number, i1: number) {
  for (let i = i0; i < i1; i++) {
    const lr = i / (DISK_NR - 1)
    for (let j = 0; j < DISK_NA; j++) {
      const a = (j / DISK_NA) * Math.PI * 2
      // Spiral: azimuth shifts with log r, so streaks wind like a real sheared flow.
      const sa = a + lr * 4.0
      // Azimuthal circumference ~14 noise cells, radial ~40: long sheared filaments with clumps.
      const X = Math.cos(sa) * 2.4, Y = Math.sin(sa) * 2.4, Z = lr * 34
      const warp = fbm(X * 0.8 + 9, Y * 0.8, Z * 0.35, 3) * 3.2
      const base = fbm(X, Y, Z + warp, 6)
      const fil = fbm(X * 0.9 + 4, Y * 0.9, Z * 1.5 + warp * 2, 5)
      const clump = fbm(X * 2.2 + 17, Y * 2.2, Z * 0.9, 4)
      let d = Math.pow(base, 2.2) * 2.6 + Math.pow(fil, 3) * 2.2
      d *= 0.2 + 1.9 * clump * clump * clump
      buf[i * DISK_NA + j] = d
    }
  }
}

/** Cross-fade period (rs/c) of the two advected copies. */
export const SHEAR_T = 420

/** Density at radius r and disk azimuth az, at simulation time t (rs/c). */
export function diskDensity(buf: Float32Array, r: number, az: number, t: number) {
  const fr = ((Math.log(r) - LR0) / (LR1 - LR0)) * (DISK_NR - 1)
  if (fr < 0 || fr > DISK_NR - 1) return 0
  const om = Math.sqrt(1 / (2 * r * r * r))
  const t1 = ((t % SHEAR_T) + SHEAR_T) % SHEAR_T
  const t2 = (((t + SHEAR_T / 2) % SHEAR_T) + SHEAR_T) % SHEAR_T
  const w = Math.abs(t1 / SHEAR_T - 0.5) * 2
  return look(buf, fr, az - om * t1) * w + look(buf, fr, az - om * t2 + 2.1) * (1 - w)
}

function look(buf: Float32Array, fr: number, az: number) {
  let fa = (az / (Math.PI * 2)) * DISK_NA
  fa = ((fa % DISK_NA) + DISK_NA) % DISK_NA
  const i = Math.min(DISK_NR - 2, Math.floor(fr)), j = Math.floor(fa), tr = fr - i, ta = fa - j
  const j1 = (j + 1) % DISK_NA
  const a = buf[i * DISK_NA + j]!, b = buf[i * DISK_NA + j1]!, c = buf[(i + 1) * DISK_NA + j]!, d = buf[(i + 1) * DISK_NA + j1]!
  return (a * (1 - ta) + b * ta) * (1 - tr) + (c * (1 - ta) + d * ta) * tr
}
