import { describe, expect, test } from 'bun:test'
import { B_CRIT, DPHI, NPHI, alphaAt, alphaCrit, allocTable, deflection, fillTable, impact, traceRay, uAt } from '../src/geodesic'
import { diskG, orbitUt, omega, aberrate, unaberrate, motionObs } from '../src/physics'
import { dilation, etaHorizon, farTime, localSpeed, properTime, radius, startDive, stepDive, eject } from '../src/dive'
import { integrate, makeSpec, plungeL, sample, tidal, V } from '../src/probe'
import { images } from '../src/lensing'

describe('null geodesics', () => {
  test('b_crit = 3√3/2 rs and the analytic critical angle splits captured from escaping rays', () => {
    expect(B_CRIT).toBeCloseTo(2.598076, 5)
    for (const r0 of [30, 8, 3, 2, 1.3]) {
      const ac = alphaCrit(r0)
      expect(impact(r0, ac)).toBeCloseTo(B_CRIT, 6)
      expect(traceRay(r0, ac * 0.995).captured).toBe(true)
      expect(traceRay(r0, ac * 1.005 > Math.PI ? Math.PI : ac * 1.005).captured).toBe(false)
    }
  })

  test('weak field: deflection ≈ 2 rs / b (+ 15π/32 (rs/b)² at second order)', () => {
    for (const b of [40, 100, 400]) {
      const r0 = 4000
      const alpha = Math.asin((b * Math.sqrt(1 - 1 / r0)) / r0)
      const exact = 2 / b + (15 * Math.PI) / 32 / (b * b)
      const d = deflection(r0, alpha).deflection
      expect(Math.abs(d - exact) / exact).toBeLessThan(0.03)
    }
  })

  test('photon sphere: rays just above b_crit hang at r ≈ 1.5 rs and wind by ever more turns', () => {
    const r0 = 30, ac = alphaCrit(r0)
    let prev = 0
    for (const k of [1e-2, 1e-4, 1e-6]) {
      const a = Math.asin((B_CRIT * (1 + k) * Math.sqrt(1 - 1 / r0)) / r0)
      expect(a).toBeGreaterThan(ac)
      const u = new Float32Array(NPHI)
      const res = traceRay(r0, a, u)
      expect(res.captured).toBe(false)
      // Closest approach: 1/max(u) → the photon sphere as b → b_crit.
      let um = 0
      for (let i = 0; i < NPHI; i++) if (u[i]! > um) um = u[i]!
      expect(1 / um).toBeGreaterThan(1.5)
      expect(1 / um).toBeLessThan(k === 1e-2 ? 1.8 : 1.53)
      // Winding grows logarithmically, ~ −ln(b − b_crit): one more ~half-turn every ×e^π closer.
      expect(res.end).toBeGreaterThan(prev)
      prev = res.end
    }
    expect(prev).toBeGreaterThan(2 * Math.PI)
  })

  test('disk-plane crossings: 1st/2nd/3rd image orders come from rays that sweep π, 2π, 3π', () => {
    // Camera in the disk's plane edge-on ↔ crossings at multiples of π. Count orders a table ray can reach.
    const T = allocTable(512)
    fillTable(T, 30)
    const orders = (i: number) => (T.cap[i] ? Math.floor(Math.min(T.end[i]!, (NPHI - 1) * DPHI) / Math.PI) : Math.floor(T.end[i]! / Math.PI))
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < T.na; i++) counts[Math.min(3, orders(i))]!++
    expect(counts[1]).toBeGreaterThan(0)
    expect(counts[2]).toBeGreaterThan(0)
    expect(counts[3]).toBeGreaterThan(0)
    // Higher orders live in an exponentially thin band near the critical ray (the photon ring).
    expect(counts[2]!).toBeLessThan(counts[1]!)
    expect(counts[3]!).toBeLessThan(counts[2]! + counts[1]!)
    // uAt interpolates the stored orbit and ends where the ray does.
    const i = Math.round(T.na * 0.6)
    expect(uAt(T, i, 0)).toBeCloseTo(1 / 30, 5)
    expect(uAt(T, i, T.end[i]! + 0.1)).toBe(-1)
    expect(alphaAt(0, T.ac)).toBeLessThan(alphaAt(1, T.ac))
  })

  test('lensing.images finds a primary and a secondary image on opposite sides of the hole', () => {
    const T = allocTable(512)
    fillTable(T, 30)
    const im = images(T, [0, 0, 30], [6, 0, -10])
    expect(im.length).toBe(2)
    expect(Math.sign(im[0]!.d[0])).toBe(1)
    expect(Math.sign(im[1]!.d[0])).toBe(-1)
    // The secondary hugs the shadow edge: its angle from the hole is just outside α_crit.
    expect(im[1]!.a).toBeGreaterThan(T.ac)
    expect(im[1]!.a).toBeLessThan(im[0]!.a)
  })
})

describe('disk redshift', () => {
  test('Keplerian Ω = √(rs / 2r³), u^t = 1/√(1 − 3rs/2r), ISCO orbit has a finite clock', () => {
    expect(omega(3)).toBeCloseTo(Math.sqrt(1 / 54), 8)
    expect(orbitUt(3)).toBeCloseTo(Math.SQRT2, 8)
  })

  test('Doppler factor: approaching side blueshifted, receding redshifted, b=0 gives pure gravitational + transverse', () => {
    for (const r of [3, 6, 15]) {
      const g0 = diskG(r, 0, 1)
      expect(g0).toBeCloseTo(Math.sqrt(1 - 1.5 / r), 8)
      const b = 6
      // λ = photon angular momentum along the orbit: λ > 0 leaves the approaching side.
      expect(diskG(r, b, 1)).toBeGreaterThan(g0)
      expect(diskG(r, -b, 1)).toBeLessThan(g0)
    }
    // Inner disk, approaching side at ISCO: beaming wins over gravitational redshift (g > 1).
    expect(diskG(3, 5, 1)).toBeGreaterThan(1)
    expect(diskG(3, -5, 1)).toBeLessThan(0.5)
  })

  test('aberration round-trips and a forward-moving observer sees forward light blueshifted', () => {
    for (const c of [-0.9, 0, 0.5]) expect(unaberrate(aberrate(c, 0.6), 0.6)).toBeCloseTo(c, 10)
    expect(motionObs(1, 0.6)).toBeCloseTo(2, 10)
    expect(motionObs(-1, 0.6)).toBeCloseTo(0.5, 10)
  })
})

describe('dive', () => {
  test('radial free fall from rest: finite proper time to the horizon, infinite far-away time', () => {
    const r0 = 20
    const eh = etaHorizon(r0)
    expect(radius(r0, eh)).toBeCloseTo(1, 10)
    // τ to the singularity from rest at r0: (π/2) √(r0³/rs) / ... in units rs = c = 1: π/2 · r0^1.5 / √1 ... (π √(r0³/4))
    expect(properTime(r0, Math.PI)).toBeCloseTo(Math.PI * Math.sqrt((r0 ** 3) / 4), 8)
    expect(farTime(r0, eh * 0.5)).toBeGreaterThan(properTime(r0, eh * 0.5))
    expect(farTime(r0, eh * 0.9999)).toBeGreaterThan(farTime(r0, eh * 0.99))
    expect(farTime(r0, eh * (1 - 1e-9))).toBeGreaterThan(farTime(r0, eh * (1 - 1e-5)) + 5)
    // Cross-check t(η) against dt/dτ = E / (1 − rs/r), E = √(1 − rs/r0), integrated numerically.
    const E = Math.sqrt(1 - 1 / r0), n = 20000, eta1 = eh * 0.8
    let t = 0
    for (let i = 0; i < n; i++) {
      const a = (i / n) * eta1, b = ((i + 1) / n) * eta1, m = (a + b) / 2
      t += (E / (1 - 1 / radius(r0, m))) * (properTime(r0, b) - properTime(r0, a))
    }
    expect(farTime(r0, eta1)).toBeCloseTo(t, 3)
    expect(localSpeed(r0, r0)).toBe(0)
    expect(localSpeed(r0, 1)).toBeCloseTo(1, 10)
    expect(dilation(1e9, 4)).toBeCloseTo(1 / 0.75, 6)
  })

  test('the dive state machine falls, crosses the horizon, flashes, and resets; eject only before the horizon', () => {
    let d = startDive(24)
    const phases = new Set<string>()
    let lastR = 24, monotonic = true
    for (let i = 0; i < 2000 && d; i++) {
      phases.add(d.phase)
      if (d.phase === 'fall') { if (d.r > lastR + 1e-9) monotonic = false; lastR = d.r }
      const next = stepDive(d, 1 / 60)
      if (!next) break
      d = next
    }
    expect(monotonic).toBe(true)
    expect([...phases]).toEqual(['fall', 'inside', 'flash'])
    let e = startDive(24)
    for (let i = 0; i < 60; i++) e = stepDive(e, 1 / 60)!
    const ej = eject(e)
    expect(ej?.phase).toBe('eject')
    let inside = startDive(24)
    while (inside.phase === 'fall') inside = stepDive(inside, 1 / 30)!
    expect(eject(inside)).toBeNull()
  })
})

describe('probes (timelike geodesics)', () => {
  test('plunge orbits sit just above the potential barrier and fall in after a few turns', () => {
    const spec = makeSpec(0, 0.3)
    expect(spec.L).toBeGreaterThan(Math.sqrt(3))
    const L = plungeL(spec.r0)
    expect(V(spec.r0, L)).toBeLessThan(1)
    const p = integrate(spec)
    expect(p.r[p.len - 1]!).toBeLessThan(1.05)
    expect(p.phi[p.len - 1]!).toBeGreaterThan(Math.PI)
    const s = sample(p, p.tEnd * 0.5)!
    expect(s.r).toBeGreaterThan(1)
    expect(s.g).toBeLessThan(1)
    expect(sample(p, p.tEnd + 10)).toBeNull()
    expect(tidal(1.2)).toBeGreaterThan(tidal(6))
  })
})
