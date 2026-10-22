/** Relativistic optics and disk physics, rs = 1 (M = 1/2). */

/** Seconds of light travel per Schwarzschild radius for a hole of `msun` solar masses (2GM/c³). */
export const rsOverC = (msun: number) => 9.8509e-6 * msun
/** Schwarzschild radius in km. */
export const rsKm = (msun: number) => 2.95325 * msun

/** Keplerian angular velocity of a circular orbit at r (coordinate time). */
export const omega = (r: number) => Math.sqrt(1 / (2 * r * r * r))
/** dt/dτ of a circular geodesic orbit (r > 1.5). */
export const orbitUt = (r: number) => 1 / Math.sqrt(1 - 1.5 / r)

/**
 * Frequency ratio g = ν_observed / ν_emitted for disk light.
 * lambda: the photon's angular momentum about the disk axis per unit energy (L_z/E).
 * obs: the observer's own factor E_obs/E_∞ (1/√(1−1/r0) for a static observer, more with aberration when falling).
 */
export const diskG = (r: number, lambda: number, obs: number) => obs / (orbitUt(r) * (1 - omega(r) * lambda))

/** Static observer at r0: light from infinity arrives blueshifted by this factor. */
export const staticObs = (r0: number) => 1 / Math.sqrt(1 - 1 / Math.max(1.0001, r0))

/**
 * Relativistic aberration. θo: angle between where the observer looks and its velocity (observer frame).
 * Returns cos of the same direction's angle in the static frame. Moving observers see the sky bunched forward.
 */
export const aberrate = (cosO: number, v: number) => (cosO - v) / (1 - v * cosO)
export const unaberrate = (cosS: number, v: number) => (cosS + v) / (1 + v * cosS)

/** Energy factor for an observer moving at v (local) relative to static, looking at static-frame angle θs from its velocity. */
export const motionObs = (cosS: number, v: number) => (1 + v * cosS) / Math.sqrt(1 - v * v)

/** Novikov–Thorne-like temperature profile, normalised to 1 at its peak. */
export function diskProfile(r: number, rin: number) {
  if (r <= rin) return 0
  return (Math.pow(r / rin, -0.75) * Math.pow(1 - Math.sqrt(rin / r), 0.25)) / PROFILE_PEAK
}
const PROFILE_PEAK = (() => { let m = 0; for (let x = 1.0001; x < 10; x += 0.0005) m = Math.max(m, Math.pow(x, -0.75) * Math.pow(1 - Math.sqrt(1 / x), 0.25)); return m })()

/** CIE 1931 colour matching (Wyman, Sloan & Shirley 2013 multi-lobe fit). */
function cie(l: number) {
  const g = (x: number, m: number, s1: number, s2: number) => { const t = (x - m) / (x < m ? s1 : s2); return Math.exp(-0.5 * t * t) }
  return [
    1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
  ] as const
}

/** Linear-sRGB chromaticity of a blackbody at T kelvin, scaled to luminance Y = 1. */
export function blackbody(T: number): [number, number, number] {
  let X = 0, Y = 0, Z = 0
  for (let l = 380; l <= 780; l += 5) {
    const lm = l * 1e-9
    const B = 1 / (Math.pow(lm, 5) * (Math.exp(1.4388e-2 / (lm * T)) - 1))
    const [x, y, z] = cie(l)
    X += B * x; Y += B * y; Z += B * z
  }
  X /= Y; Z /= Y; Y = 1
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z
  const g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z
  const b = 0.0557 * X - 0.204 * Y + 1.057 * Z
  return [Math.max(0, r), Math.max(0, g), Math.max(0, b)]
}

/** Log-spaced blackbody colour table, 800 K … 60 000 K, rgb interleaved. */
export const BB_N = 512
export const BB_MIN = Math.log(800)
export const BB_MAX = Math.log(60000)
export const BB = (() => {
  const t = new Float32Array(BB_N * 3)
  for (let i = 0; i < BB_N; i++) { const c = blackbody(Math.exp(BB_MIN + ((BB_MAX - BB_MIN) * i) / (BB_N - 1))); t[i * 3] = c[0]; t[i * 3 + 1] = c[1]; t[i * 3 + 2] = c[2] }
  return t
})()
export const bbIndex = (T: number) => { const f = ((Math.log(Math.max(800, T)) - BB_MIN) / (BB_MAX - BB_MIN)) * (BB_N - 1); return Math.max(0, Math.min(BB_N - 1, f | 0)) * 3 }
