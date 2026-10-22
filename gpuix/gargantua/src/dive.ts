/**
 * Radial free fall from rest at r0 (rs = 1), in closed form via the cycloid parameter η:
 *   r = r0/2 (1 + cos η),   τ = √(r0³/4) (η + sin η)
 *   t = ln|(q + tan η/2) / (q − tan η/2)| + q (η + r0/2 (η + sin η)),  q = √(r0 − 1)
 * τ is the faller's proper time, t the far-away (Schwarzschild) clock, which runs to ∞ at the horizon.
 */
export const radius = (r0: number, eta: number) => (r0 / 2) * (1 + Math.cos(eta))
export const properTime = (r0: number, eta: number) => Math.sqrt((r0 * r0 * r0) / 4) * (eta + Math.sin(eta))
export function farTime(r0: number, eta: number) {
  const q = Math.sqrt(r0 - 1), th = Math.tan(eta / 2)
  if (th >= q) return Infinity
  return Math.log((q + th) / (q - th)) + q * (eta + (r0 / 2) * (eta + Math.sin(eta)))
}
/** η where r = 1 (the horizon). */
export const etaHorizon = (r0: number) => Math.acos(2 / r0 - 1)
/** η for a radius r ≤ r0. */
export const etaAt = (r0: number, r: number) => Math.acos(Math.max(-1, Math.min(1, (2 * r) / r0 - 1)))
/** Speed relative to a static observer at r (fraction of c); → 1 at the horizon. */
export const localSpeed = (r0: number, r: number) => Math.sqrt(Math.max(0, (1 / r - 1 / r0) / (1 - 1 / r0)))
/** dt/dτ for the faller: E / (1 − 1/r), E = √(1 − 1/r0). */
export const dilation = (r0: number, r: number) => Math.sqrt(1 - 1 / r0) / (1 - 1 / r)

export type DivePhase = 'fall' | 'inside' | 'flash' | 'eject'

export interface Dive {
  r0: number
  phase: DivePhase
  /** Seconds of wall time spent in this phase. */
  clock: number
  eta: number
  r: number
  v: number
  tau: number
  t: number
  /** 0 at the horizon, 1 at the singularity (drives the shrinking-sky effect). */
  inside: number
  /** Look direction blend: 0 = towards the hole, 1 = straight back out. */
  turn: number
}

export const FALL_S = 9
export const INSIDE_S = 3.4
export const FLASH_S = 1.4
export const EJECT_S = 3.2

export function startDive(r0: number): Dive {
  return { r0, phase: 'fall', clock: 0, eta: 0, r: r0, v: 0, tau: 0, t: 0, inside: 0, turn: 0 }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Advance by `dt` wall seconds. Returns null when the dive is over (camera goes back to orbit). */
export function stepDive(d: Dive, dt: number): Dive | null {
  const n = { ...d, clock: d.clock + dt }
  const eh = etaHorizon(d.r0)
  if (n.phase === 'fall') {
    // Ease in from rest, slow a little near the horizon so the crossing reads.
    const f = Math.min(1, n.clock / FALL_S)
    const e = f < 0.75 ? 0.82 * Math.pow(f / 0.75, 1.6) : 0.82 + 0.18 * smooth(0, 1, (f - 0.75) / 0.25)
    n.eta = e * eh
    if (f >= 1) { n.phase = 'inside'; n.clock = 0; n.eta = eh }
  } else if (n.phase === 'inside') {
    const f = Math.min(1, n.clock / INSIDE_S)
    n.eta = eh + (Math.PI - eh) * 0.985 * f
    n.inside = f
    if (f >= 1) { n.phase = 'flash'; n.clock = 0 }
  } else if (n.phase === 'flash') {
    n.inside = 1
    if (n.clock >= FLASH_S) return null
    return n
  } else if (n.phase === 'eject') {
    const f = Math.min(1, n.clock / EJECT_S)
    n.r = n.r + (n.r0 - n.r) * Math.min(1, dt * 1.6 + f * f * 0.2)
    n.v = Math.max(0, n.v * (1 - Math.min(1, dt * 2.4)))
    n.turn = n.turn * (1 - Math.min(1, dt * 2))
    if (f >= 1) return null
    return n
  }
  n.r = Math.max(1e-3, radius(d.r0, n.eta))
  n.v = n.r > 1 ? localSpeed(d.r0, n.r) : 1
  n.tau = properTime(d.r0, n.eta)
  n.t = farTime(d.r0, n.eta)
  n.turn = smooth(2.4, 1.05, n.r)
  return n
}

/** Fire the thrusters: only possible outside the horizon. */
export function eject(d: Dive): Dive | null {
  if (d.phase !== 'fall' || d.r <= 1.0005) return null
  return { ...d, phase: 'eject', clock: 0 }
}
