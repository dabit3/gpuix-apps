/**
 * Null geodesics in Schwarzschild, in units where the Schwarzschild radius rs = 1 (so M = 1/2, c = G = 1).
 *
 * Every photon path lies in a plane through the hole, and its shape u(φ) (u = 1/r) depends only on where it starts and
 * at what angle. For one camera radius r0 that leaves a single parameter: the angle α between the ray and the inward
 * radial direction, as measured by a static observer at r0 (α ↔ impact parameter b = r0·sin α / √(1 − 1/r0)).
 * We integrate a fan of rays over α once per camera radius and store, per ray:
 *   - u at evenly spaced swept angles φ (so a pixel can find where its ray crosses the disk plane, at any order),
 *   - whether it falls into the horizon, the swept angle where it ends,
 *   - and the in-plane direction it escapes to (where on the sky it comes from).
 * A pixel then only computes its α and orbital plane, interpolates two neighbouring rays and rotates the answer.
 *
 * The integrator uses the fact that u'' + u = 3/2·u² (the orbit equation, rs = 1) is exactly the orbit of a Newtonian
 * particle under the central acceleration 3/2·h²/r⁴, h = |x × v|: straight-line RK4 in Cartesian coordinates with a
 * step proportional to r, which is well-behaved for radial rays where φ-parameterised integration blows up.
 */

export const B_CRIT = (3 * Math.sqrt(3)) / 2
export const R_PHOTON = 1.5
export const R_ISCO = 3
export const NPHI = 321
export const DPHI = Math.PI / 64
export const PHI_MAX = (NPHI - 1) * DPHI

/** Impact parameter of a ray leaving a static observer at r0 at angle α from the inward radial direction. */
export const impact = (r0: number, alpha: number) => (r0 * Math.sin(alpha)) / Math.sqrt(1 - 1 / r0)

/** Rays with α below this fall into the hole (the edge of the shadow seen from r0). */
export function alphaCrit(r0: number) {
  const s = Math.min(1, (B_CRIT * Math.sqrt(1 - 1 / r0)) / r0)
  const a = Math.asin(s)
  return r0 >= R_PHOTON ? a : Math.PI - a
}

/** Table index ↔ α. Cubic spacing packs rays around α_c, where the photon ring's windings change fastest. */
export function alphaAt(s: number, ac: number) {
  if (s < 0.5) { const t = (0.5 - s) * 2; return ac - ac * t * t * t }
  const t = (s - 0.5) * 2
  return ac + (Math.PI - ac) * t * t * t
}
export function sOf(alpha: number, ac: number) {
  if (alpha < ac) return 0.5 - 0.5 * Math.cbrt((ac - alpha) / ac)
  return 0.5 + 0.5 * Math.cbrt((alpha - ac) / (Math.PI - ac))
}

export interface Table {
  na: number
  r0: number
  ac: number
  /** u = 1/r at φ = j·DPHI along ray i: u[i·NPHI + j]; −1 past the end of the ray. */
  u: Float32Array
  /** Swept angle where the ray ends (horizon or escape). */
  end: Float32Array
  /** 1 = falls through the horizon. */
  cap: Uint8Array
  /** In-plane escape direction (cos, sin) relative to (x̂ = outward radial at the camera, ŷ = in-plane perpendicular). */
  ex: Float32Array
  ey: Float32Array
}

const sab = (bytes: number) => (typeof SharedArrayBuffer === 'function' ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes))

export function allocTable(na: number): Table {
  return {
    na, r0: 0, ac: 0,
    u: new Float32Array(sab(na * NPHI * 4)),
    end: new Float32Array(sab(na * 4)),
    cap: new Uint8Array(sab(na)),
    ex: new Float32Array(sab(na * 4)),
    ey: new Float32Array(sab(na * 4)),
  }
}

export interface RayResult { captured: boolean; end: number; ex: number; ey: number; steps: number }

/**
 * Trace one ray from a static observer at r0, angle α from the inward radial. Writes u(φ_j) into `u` at `off`
 * when given. Returns where it went.
 */
export function traceRay(r0: number, alpha: number, u?: Float32Array, off = 0, maxSteps = 40000): RayResult {
  const u0 = 1 / r0
  // Map the local (static observer) angle to the Newtonian analogue's launch angle so the orbit shapes match:
  // GR: du/dφ = u·√(1−u)·cot α at launch, analogue: du/dφ = u·cot α'.
  const ap = Math.atan2(Math.sin(alpha), Math.sqrt(Math.max(0, 1 - u0)) * Math.cos(alpha))
  let x = r0, y = 0
  let vx = -Math.cos(ap), vy = Math.sin(ap)
  const h = r0 * Math.sin(ap)
  const k = 1.5 * h * h
  const far = Math.max(600, 3 * r0)
  let j = 0
  if (u) { u[off] = u0; j = 1 }
  let prevPhi = 0, prevU = u0, phi = 0
  let steps = 0
  const fill = (toPhi: number, toU: number) => {
    if (!u) return
    while (j < NPHI && j * DPHI <= toPhi) {
      const f = toPhi > prevPhi ? (j * DPHI - prevPhi) / (toPhi - prevPhi) : 1
      u[off + j] = prevU + (toU - prevU) * f
      j++
    }
  }
  const done = (captured: boolean, end: number): RayResult => {
    if (u) for (; j < NPHI; j++) u[off + j] = -1
    return { captured, end, ex: Math.cos(Math.atan2(vy, vx)), ey: Math.sin(Math.atan2(vy, vx)), steps }
  }
  if (h < 1e-9) {
    // Radial: straight in (captured at φ = 0) or straight out.
    if (vx < 0) { if (u) for (; j < NPHI; j++) u[off + j] = -1; return { captured: true, end: 0, ex: 1, ey: 0, steps } }
    return done(false, 0)
  }
  const acc = (px: number, py: number, out: number[]) => {
    const r2 = px * px + py * py
    const r = Math.sqrt(r2)
    const f = -k / (r2 * r2 * r)
    out[0] = f * px; out[1] = f * py
  }
  const a1 = [0, 0], a2 = [0, 0], a3 = [0, 0], a4 = [0, 0]
  let lastAng = 0
  while (steps < maxSteps) {
    const r = Math.hypot(x, y)
    const ds = (r < 4 ? 0.006 * r : r < 30 ? 0.02 * r : 0.05 * r) / Math.hypot(vx, vy)
    // RK4 on (x, v)
    acc(x, y, a1)
    const x2 = x + vx * ds / 2, y2 = y + vy * ds / 2, vx2 = vx + a1[0]! * ds / 2, vy2 = vy + a1[1]! * ds / 2
    acc(x2, y2, a2)
    const x3 = x + vx2 * ds / 2, y3 = y + vy2 * ds / 2, vx3 = vx + a2[0]! * ds / 2, vy3 = vy + a2[1]! * ds / 2
    acc(x3, y3, a3)
    const x4 = x + vx3 * ds, y4 = y + vy3 * ds, vx4 = vx + a3[0]! * ds, vy4 = vy + a3[1]! * ds
    acc(x4, y4, a4)
    x += (ds / 6) * (vx + 2 * vx2 + 2 * vx3 + vx4)
    y += (ds / 6) * (vy + 2 * vy2 + 2 * vy3 + vy4)
    vx += (ds / 6) * (a1[0]! + 2 * a2[0]! + 2 * a3[0]! + a4[0]!)
    vy += (ds / 6) * (a1[1]! + 2 * a2[1]! + 2 * a3[1]! + a4[1]!)
    steps++
    const ang = Math.atan2(y, x)
    let d = ang - lastAng
    if (d < -Math.PI) d += 2 * Math.PI
    lastAng = ang
    phi += d
    const rn = Math.hypot(x, y)
    if (rn <= 1) {
      // Interpolate to the horizon crossing.
      const f = (1 - 1 / prevU) / (rn - 1 / prevU || -1)
      const endPhi = prevPhi + (phi - prevPhi) * Math.max(0, Math.min(1, f))
      fill(endPhi, 1)
      return done(true, endPhi)
    }
    fill(phi, 1 / rn)
    prevPhi = phi; prevU = 1 / rn
    if (rn > far && x * vx + y * vy > 0) return done(false, phi)
  }
  return done(true, phi)
}

/** Fill rays [i0, i1) of a table for camera radius r0 (workers split the fan between them). */
export function fillTable(t: Table, r0: number, i0 = 0, i1 = t.na) {
  const ac = alphaCrit(r0)
  t.r0 = r0; t.ac = ac
  for (let i = i0; i < i1; i++) {
    const a = alphaAt(i / (t.na - 1), ac)
    const res = traceRay(r0, a, t.u, i * NPHI)
    t.end[i] = res.end
    t.cap[i] = res.captured ? 1 : 0
    t.ex[i] = res.ex; t.ey[i] = res.ey
  }
}

/** Bending angle of an escaping ray: total turning of its direction beyond the straight line's π − α'. */
export function deflection(r0: number, alpha: number) {
  const res = traceRay(r0, alpha)
  const ap = Math.atan2(Math.sin(alpha), Math.sqrt(1 - 1 / r0) * Math.cos(alpha))
  let th = Math.atan2(res.ey, res.ex)
  // Unwrap the escape direction to the branch nearest the swept angle (they agree far away).
  th += Math.round((res.end - th) / (2 * Math.PI)) * 2 * Math.PI
  return { ...res, deflection: th - (Math.PI - ap) }
}

/** u at swept angle φ along ray i (linear in φ); −1 if the ray ended before φ. */
export function uAt(t: Table, i: number, phi: number) {
  if (phi < 0 || phi > t.end[i]!) return -1
  const f = phi / DPHI
  const j = Math.floor(f)
  if (j >= NPHI - 1) return -1
  const a = t.u[i * NPHI + j]!, b = t.u[i * NPHI + j + 1]!
  if (a < 0) return -1
  if (b < 0) return a
  return a + (b - a) * (f - j)
}
