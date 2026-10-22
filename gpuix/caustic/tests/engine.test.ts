import { describe, expect, test } from 'bun:test'
import { Caustics } from '../src/caustics'
import { Engine } from '../src/engine'
import { encodePng } from '../src/png'
import type { FromEngine } from '../src/protocol'
import { QUALITY } from '../src/quality'
import { frameOf, renderRows } from '../src/render'
import { Scene, WATER_LEVEL, clampTunable, lookSettings } from '../src/scene'
import { LOOKS, type LookName } from '../src/looks'
import { dot, norm, refract, type V3 } from '../src/vec'
import { Water } from '../src/water'

const sun = { x: 0, y: -1, z: 0 }
const noBall = { on: false, x: 0, y: 0, z: 0, r: 0.1 }

describe('water height field', () => {
  test('a drop spreads outward as a ring and damps away', () => {
    const w = new Water(96)
    w.drop(0, 0, 0.08, 0.05)
    const centre = () => w.h[48 * 96 + 48]!
    const ring = () => w.h[48 * 96 + 72]!
    expect(centre()).toBeGreaterThan(0.01)
    expect(Math.abs(ring())).toBeLessThan(1e-6)
    let reached = 0
    for (let i = 0; i < 80; i++) { w.step(); reached = Math.max(reached, Math.abs(ring())) }
    expect(reached).toBeGreaterThan(1e-4)
    for (let i = 0; i < 4000; i++) w.step()
    let energy = 0
    for (const v of w.h) energy += v * v
    expect(energy).toBeLessThan(1e-4)
  })

  test('the wave step conserves volume (no water leaks out of the pool)', () => {
    const w = new Water(64)
    w.drop(0.3, -0.2, 0.1, 0.04)
    const v0 = w.volume()
    for (let i = 0; i < 300; i++) w.step()
    expect(Math.abs(w.volume() - v0)).toBeLessThan(Math.abs(v0) * 0.02 + 1e-6)
  })

  test('switching quality resamples the waves instead of resetting them', () => {
    const s = new Scene({ quality: 'lite', breeze: false, swell: 0 })
    s.drop(0.4, 0.4, 0.12, 0.05)
    const mean = () => s.water.volume() / (s.water.n * s.water.n)
    const before = mean()
    expect(Math.abs(before)).toBeGreaterThan(1e-5)
    s.setQuality('full')
    expect(s.water.n).toBe(QUALITY.full.sim)
    expect(mean()).toBeCloseTo(before, 5)
    expect(s.caustics.dispersion).toBe(true)
  })
})

describe('optics', () => {
  test("Snell's law: refracted angle matches n1 sin θ1 = n2 sin θ2, with total internal reflection", () => {
    const n: V3 = [0, 1, 0]
    const d = norm([Math.sin(0.6), -Math.cos(0.6), 0])
    const t = refract(d, n, 1 / 1.333)!
    const sin2 = Math.hypot(t[0], t[2])
    expect(Math.sin(0.6)).toBeCloseTo(1.333 * sin2, 5)
    expect(dot(t, t)).toBeCloseTo(1, 6)
    expect(refract(norm([Math.sin(1.2), Math.cos(1.2), 0]), [0, -1, 0], 1.333)).toBeNull()
  })

  test('flat water lights the floor evenly; a ripple focuses light into bright caustics and dark gaps', () => {
    const w = new Water(128)
    w.updateNormals()
    const c = new Caustics(160, 240, false)
    c.compute(w, WATER_LEVEL, 1, sun, noBall)
    const flatMax = c.max()
    expect(c.mean()).toBeGreaterThan(0.5)
    expect(flatMax).toBeLessThan(1.6)
    w.drop(0, 0, 0.15, 0.06)
    for (let i = 0; i < 30; i++) w.step()
    w.updateNormals()
    c.compute(w, WATER_LEVEL, 1, sun, noBall)
    expect(c.max()).toBeGreaterThan(flatMax * 1.6)
  })

  test('caustics focus with depth: a deeper pool concentrates the same ripple into sharper peaks', () => {
    const peak = (depth: number) => {
      const w = new Water(128)
      w.drop(0, 0, 0.2, 0.02)
      for (let i = 0; i < 6; i++) w.step()
      w.updateNormals()
      const c = new Caustics(200, 300, false)
      c.compute(w, WATER_LEVEL, depth, sun, noBall)
      return c.max()
    }
    expect(peak(1.4)).toBeGreaterThan(peak(0.5))
  })

  test('FULL disperses: red and blue caustics land in different places', () => {
    const w = new Water(128)
    w.drop(0.1, 0, 0.12, 0.05)
    for (let i = 0; i < 25; i++) w.step()
    w.updateNormals()
    const c = new Caustics(160, 240, true)
    c.compute(w, WATER_LEVEL, 1.2, { x: -0.4, y: -0.9, z: 0 }, noBall)
    let diff = 0
    for (let i = 0; i < c.r.length; i++) diff += Math.abs(c.r[i]! - c.b[i]!)
    expect(diff / c.r.length).toBeGreaterThan(0.002)
  })
})

describe('scene', () => {
  test('picking hits the water, the ball and the deck', () => {
    const s = new Scene({ breeze: false, swell: 0 })
    expect(s.pick(0, -0.05, 1.6).kind).not.toBe('none')
    expect(s.pick(-0.99, 0.99, 1.6).kind).toBe('none')
    // Project the ball centre to the screen, then pick there.
    const B = s.basis(1.6)
    const b = s.ball
    const dx = b.x - B.ex, dy = b.y - B.ey, dz = b.z - B.ez
    const f = dx * B.fx + dy * B.fy + dz * B.fz
    const u = (dx * B.rx + dy * B.ry + dz * B.rz) / f / B.tanX
    const v = (dx * B.ux + dy * B.uy + dz * B.uz) / f / B.tanY
    expect(s.pick(u, v, 1.6).kind).toBe('ball')
  })

  test('the ball rides the waves: a ripple next to it pushes it away', () => {
    const s = new Scene({ breeze: false, swell: 0 })
    const x0 = s.ball.x, z0 = s.ball.z
    for (let i = 0; i < 90; i++) s.advance(1 / 60)
    expect(Math.hypot(s.ball.x - x0, s.ball.z - z0)).toBeLessThan(1e-4)
    s.drop(x0 - 0.2, z0, 0.12, 0.08)
    for (let i = 0; i < 90; i++) s.advance(1 / 60)
    expect(Math.hypot(s.ball.x - x0, s.ball.z - z0)).toBeGreaterThan(0.01)
  })

  test('the ray tracer paints the pool, and ripples change the pixels', () => {
    const s = new Scene({ breeze: false, swell: 0 })
    const W = 160, H = 100
    const a = new Uint8Array(W * H * 4), b = new Uint8Array(W * H * 4)
    s.advance(1 / 60)
    s.caustics.compute(s.water, WATER_LEVEL, 1, s.light, s.ball)
    renderRows(frameOf(s, W / H, [10, 12, 16]), a, W, H, 0, H)
    // Corner is the terminal background (BGRA), so the app blends into Ghostty.
    expect([a[2], a[1], a[0]]).toEqual([10, 12, 16])
    s.drop(0, 0, 0.12, 0.05)
    for (let i = 0; i < 10; i++) s.advance(1 / 60)
    s.caustics.compute(s.water, WATER_LEVEL, 1, s.light, s.ball)
    renderRows(frameOf(s, W / H, [10, 12, 16]), b, W, H, 0, H)
    let changed = 0
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) > 6) changed++
    expect(changed).toBeGreaterThan(80)
    expect(encodePng(b, W, H).subarray(1, 4).toString()).toBe('PNG')
  })
})

describe('engine (workers + pipeline)', () => {
  test('streams frames at the scaled pane size and reports stats', async () => {
    const got: FromEngine[] = []
    const e = new Engine({ quality: 'lite' }, [10, 12, 16], (m) => got.push(m), 2)
    e.handle({ type: 'size', w: 400, h: 250 })
    // Find a screen point over open water (not the ball), then drag across it.
    let at = { u: 0, v: 0 }
    for (let u = -0.5; u <= 0.5; u += 0.1) for (let v = -0.5; v <= 0.3; v += 0.1) if (e.scene.pick(u, v, 1.6).kind === 'water') at = { u, v }
    expect(e.scene.pick(at.u, at.v, 1.6).kind).toBe('water')
    e.handle({ type: 'pointer', phase: 'down', ...at })
    e.handle({ type: 'pointer', phase: 'move', u: at.u + 0.02, v: at.v })
    e.handle({ type: 'pointer', phase: 'up', u: at.u + 0.02, v: at.v })
    void e.run()
    await Bun.sleep(1200)
    e.handle({ type: 'set', settings: { quality: 'full' } })
    await Bun.sleep(800)
    e.handle({ type: 'stop' })
    const frames = got.filter((m) => m.type === 'frame')
    const stats = got.filter((m) => m.type === 'stats')
    expect(frames.length).toBeGreaterThan(15)
    const f0 = frames[0]!
    if (f0.type !== 'frame') throw new Error('unreachable')
    expect(f0.w).toBe(Math.round(400 * QUALITY.lite.scale))
    const last = frames[frames.length - 1]!
    if (last.type !== 'frame') throw new Error('unreachable')
    expect(last.w).toBe(Math.round(400 * QUALITY.full.scale))
    expect(stats.length).toBeGreaterThan(2)
    expect(got.some((m) => m.type === 'ripples')).toBe(true)
  })
})

describe('sandbox + scenes', () => {
  test('wind swell adds a fine caustic web without touching the sim heights', () => {
    const calm = new Scene({ breeze: false, swell: 0, ball: false }), windy = new Scene({ breeze: false, swell: 1, ball: false })
    for (const s of [calm, windy]) { for (let i = 0; i < 30; i++) s.advance(1 / 60); s.caustics.compute(s.water, WATER_LEVEL, 1, s.light, s.ball) }
    expect(Math.max(...windy.water.h.map(Math.abs))).toBeLessThan(1e-6)
    expect(windy.caustics.max()).toBeGreaterThan(calm.caustics.max() + 0.5)
    expect(windy.caustics.mean()).toBeCloseTo(calm.caustics.mean(), 1)
  })

  test('IOR slider: stronger refraction focuses the same ripple harder (up to its focal depth); IOR 1 casts no caustics', () => {
    const peak = (ior: number) => {
      const s = new Scene({ breeze: false, swell: 0, ball: false, ior })
      s.drop(0, 0, 0.12, 0.05)
      for (let i = 0; i < 20; i++) s.advance(1 / 60)
      s.caustics.compute(s.water, WATER_LEVEL, 1, s.light, s.ball, ior)
      return s.caustics.max()
    }
    expect(peak(1.0)).toBeLessThan(peak(1.333) * 0.6)
    // Past ~1.4 this ripple focuses above the floor and the peak falls again, so compare below that.
    expect(peak(1.333)).toBeGreaterThan(peak(1.15))
  })

  test('wave speed and life feed the solver; presets set the sun, swell and depth; sliders clamp', () => {
    const s = new Scene({ breeze: false, waveSpeed: 2, life: 0 })
    expect(s.water.stepsPerSecond).toBeCloseTo(2 * 120 * (s.water.n / 256))
    const shortLived = s.water.damping
    s.settings.life = 1; s.applyWater()
    expect(s.water.damping).toBeGreaterThan(shortLived)
    expect(lookSettings('sunset')).toMatchObject({ look: 'sunset', sunElev: LOOKS.sunset.elev, depth: LOOKS.sunset.depth })
    expect(clampTunable('ior', 9)).toBe(1.8)
    expect(clampTunable('sunAz', -10)).toBe(350)
  })

  test('every scene renders a distinct image (night is darker, golden hour is warmer)', () => {
    const W = 160, H = 100
    const shot = (look: LookName) => {
      const s = new Scene({ breeze: false, ...lookSettings(look) })
      s.caustics.compute(s.water, WATER_LEVEL, s.settings.depth, s.light, s.ball, s.settings.ior)
      const out = new Uint8Array(W * H * 4)
      renderRows(frameOf(s, W / H, [10, 12, 16]), out, W, H, 0, H)
      let r = 0, g = 0, b = 0
      for (let k = 0; k < out.length; k += 4) { b += out[k]!; g += out[k + 1]!; r += out[k + 2]! }
      return { r, g, b, lum: r + g + b }
    }
    const pool = shot('pool'), night = shot('night'), sunset = shot('sunset'), lagoon = shot('lagoon')
    expect(night.lum).toBeLessThan(pool.lum)
    expect(sunset.r / sunset.b).toBeGreaterThan(pool.r / pool.b)
    expect(lagoon.lum).not.toBe(pool.lum)
  })
})

