/**
 * Probes: massive test particles on timelike Schwarzschild geodesics (rs = 1).
 * In the orbital plane:  (dr/dτ)² = E² − V(r),  V = (1 − 1/r)(1 + L²/r²),
 *   r'' = −1/(2r²) + L²/r³ − 3L²/(2r⁴),  φ' = L/r²,  t' = E/(1 − 1/r).
 * Every pane integrates the same spec deterministically, so linked panes show the same probe.
 */

export interface ProbeSpec {
  id: string
  /** Wall-clock ms when it was released (shared between processes on one machine). */
  at: number
  r0: number
  L: number
  /** Unit normal of the orbital plane. */
  n: [number, number, number]
  /** Starting azimuth in the plane. */
  phase: number
  hue: number
}

export interface Path {
  spec: ProbeSpec
  E: number
  /** Samples: coordinate time, radius, swept angle. */
  t: Float64Array
  r: Float64Array
  phi: Float64Array
  len: number
  /** Coordinate time when the path ends (fell in, as far as anyone outside can tell). */
  tEnd: number
}

export const V = (r: number, L: number) => (1 - 1 / r) * (1 + (L * L) / (r * r))
/** Radius of the potential's peak (the unstable circular orbit), L² > 3. */
export const rPeak = (L: number) => L * L * (1 - Math.sqrt(1 - 3 / (L * L)))

/**
 * Angular momentum for a zoom-whirl plunge from rest at apoapsis r0: E² just above the potential barrier, so the
 * probe whips around the photon sphere region a few times before diving in.
 */
export function plungeL(r0: number, eps = 1e-3) {
  let lo = Math.sqrt(3) + 1e-9, hi = Math.sqrt((r0 * r0) / 2)
  // f(L) = V(r0) − Vmax(L)(1+eps): positive for small L (falls straight in), negative near the circular orbit.
  const f = (L: number) => V(r0, L) - V(rPeak(L), L) * (1 + eps)
  if (f(hi) > 0) return hi
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m }
  return lo
}

export function integrate(spec: ProbeSpec, maxSamples = 6000): Path {
  const { r0, L } = spec
  const E = Math.sqrt(V(r0, L))
  const t = new Float64Array(maxSamples), r = new Float64Array(maxSamples), phi = new Float64Array(maxSamples)
  let R = r0, P = 0, T = 0, vr = 0
  const acc = (x: number) => -1 / (2 * x * x) + (L * L) / (x * x * x) - (1.5 * L * L) / (x * x * x * x)
  let n = 0
  const dtSample = 0.5
  let nextT = 0
  for (let step = 0; step < 4_000_000 && n < maxSamples; step++) {
    if (T >= nextT) { t[n] = T; r[n] = R; phi[n] = P; n++; nextT = T + dtSample }
    if (R < 1.002) break
    const h = 0.004 * Math.min(R, 3) * Math.sqrt(Math.min(R, 3)) * Math.max(0.05, Math.min(1, R - 1))
    // RK4 on (r, vr, φ, t) in proper time.
    const k1r = vr, k1v = acc(R)
    const k2r = vr + 0.5 * h * k1v, k2v = acc(R + 0.5 * h * k1r)
    const k3r = vr + 0.5 * h * k2v, k3v = acc(R + 0.5 * h * k2r)
    const k4r = vr + h * k3v, k4v = acc(R + h * k3r)
    const Rn = R + (h / 6) * (k1r + 2 * k2r + 2 * k3r + k4r)
    const Rm = (R + Rn) / 2
    P += (h * L) / (Rm * Rm)
    T += (h * E) / Math.max(1e-6, 1 - 1 / Rm)
    vr += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
    R = Rn
  }
  t[n] = T; r[n] = R; phi[n] = P; n++
  return { spec, E, t, r, phi, len: n, tEnd: T }
}

export interface ProbeState { r: number; phi: number; vr: number; g: number }

/** Position at coordinate time T after release; null once it has faded away at the horizon. */
export function sample(p: Path, T: number): ProbeState | null {
  if (T < 0) return null
  if (T >= p.tEnd) return null
  let lo = 0, hi = p.len - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.t[m] <= T) lo = m; else hi = m }
  const f = (T - p.t[lo]) / Math.max(1e-9, p.t[hi] - p.t[lo])
  const r = p.r[lo] + (p.r[hi] - p.r[lo]) * f
  const phi = p.phi[lo] + (p.phi[hi] - p.phi[lo]) * f
  const vr = (p.r[hi] - p.r[lo]) / Math.max(1e-9, p.t[hi] - p.t[lo])
  return { r, phi, vr, g: Math.sqrt(Math.max(0, 1 - 1 / r)) }
}

/** 3D position for an in-plane state. */
export function position(spec: ProbeSpec, r: number, phi: number): [number, number, number] {
  const [nx, ny, nz] = spec.n
  // Basis (a, b) of the orbital plane.
  let ax = -nz, ay = 0, az = nx
  if (Math.abs(ny) > 0.95) { ax = 1; ay = 0; az = 0 }
  const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al
  const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax
  const a = phi + spec.phase, c = Math.cos(a), s = Math.sin(a)
  return [r * (ax * c + bx * s), r * (ay * c + by * s), r * (az * c + bz * s)]
}

/** Tidal stretch factor: radial tidal acceleration ∝ 1/r³, normalised so it is ~1 at r = 6 and huge near the horizon. */
export const tidal = (r: number) => Math.min(40, Math.pow(6 / r, 3))

let seq = 0
/** A fresh probe dropped from somewhere around the hole. `seed` makes multi-drops fan out. */
export function makeSpec(now: number, seed = Math.random()): ProbeSpec {
  const rnd = (k: number) => { const x = Math.sin((seed + k) * 12.9898) * 43758.5453; return x - Math.floor(x) }
  const r0 = 7.5 + rnd(1) * 3
  const tilt = (rnd(2) - 0.5) * 1.1, yaw = rnd(3) * Math.PI * 2
  const n: [number, number, number] = [Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw)]
  return { id: `${process.pid}-${now}-${seq++}`, at: now, r0, L: plungeL(r0, 2e-4 + rnd(4) * 3e-3), n, phase: rnd(5) * Math.PI * 2, hue: rnd(6) }
}
