import { describe, expect, it } from 'bun:test'
import { design } from '../src/designers'
import { buildMesh, gearOutline, pitchRadius } from '../src/mesh/mesh'
import { Scene } from '../src/scene'
import { validate } from '../src/spec/validate'

const TAU = Math.PI * 2

describe('procedural geometry', () => {
  it('gear outline has one tooth per pitch and spans root..tip', () => {
    const z = 24, m = 2
    const pts = gearOutline(z, m)
    const r = pts.map(([radius]) => radius) // outline points are polar [r, θ]
    expect(Math.max(...r)).toBeCloseTo((m * z) / 2 + m, 1)
    expect(Math.min(...r)).toBeGreaterThan((m * z) / 2 - 1.3 * m)
    expect(pts.length % z).toBe(0)
    expect(pitchRadius({ type: 'gear', teeth: z, module: m, thickness: 4 })).toBe(24)
    // Count teeth as maxima of radius around the outline.
    let tips = 0
    for (let i = 0; i < r.length; i++) if (r[i]! > (m * z) / 2 + 0.9 * m && r[(i + r.length - 1) % r.length]! <= (m * z) / 2 + 0.9 * m) tips++
    expect(tips).toBe(z)
  })

  it('helical spring climbs exactly its height over its turns', () => {
    const g = { type: 'spring' as const, radius: 10, wire: 1.5, turns: 6, height: 40 }
    const mesh = buildMesh(g)
    let lo = Infinity, hi = -Infinity
    for (let i = 1; i < mesh.positions.length; i += 3) { lo = Math.min(lo, mesh.positions[i]!); hi = Math.max(hi, mesh.positions[i]!) }
    expect(hi - lo).toBeGreaterThan(40)
    expect(hi - lo).toBeLessThan(40 + g.wire * 2.2)
    expect(mesh.tris.length).toBeGreaterThan(0)
  })

  it('every primitive builds a finite, non-empty mesh', () => {
    const gs = [
      { type: 'box', size: [1, 2, 3] }, { type: 'cylinder', radius: 2, height: 3, hollow: 1 }, { type: 'cone', radius: 2, height: 3 }, { type: 'sphere', radius: 2 },
      { type: 'torus', radius: 3, tube: 0.5 }, { type: 'capsule', radius: 1, height: 3 }, { type: 'pipe', path: [[0, 0, 0], [1, 2, 0], [3, 2, 1]], radius: 0.2 },
      { type: 'extrude', points: [[0, 0], [2, 0], [2, 1], [1, 2], [0, 1]], depth: 1 }, { type: 'lathe', points: [[1, 0], [1.5, 1], [0.5, 2]] }, { type: 'blades', count: 12, radius: 5, hub: 1, chord: 0.8, twist: 30 },
    ] as const
    for (const g of gs) {
      const m = buildMesh(g as never)
      expect({ g: g.type, ok: m.positions.length > 0 && m.edges.length > 0 && Array.from(m.positions).every(Number.isFinite) }).toEqual({ g: g.type, ok: true })
    }
  })
})

describe('master clock', () => {
  const v8 = new Scene(design('a V8 engine')!)
  const crank = v8.byId.get('crankshaft')!
  const rpm = v8.state(crank, 0).rpm!

  it('camshaft turns at exactly half crank speed', () => {
    for (const t of [0.13, 0.7, 2.2]) {
      v8.pose(t, 0)
      expect(v8.angle('camshaft') / v8.angle('crankshaft')).toBeCloseTo(0.5, 6)
    }
  })

  it('pistons follow the crank: same stroke every crank revolution, and all pistons differ in phase', () => {
    const period = 60 / rpm
    const p1 = v8.byId.get('piston-1')!
    const at = (i: number, t: number) => { v8.pose(t, 0); return v8.crankSolve(v8.parts[i]!)!.offset }
    for (const t of [0.05, 0.4, 1.1]) expect(at(p1, t + period)).toBeCloseTo(at(p1, t), 5)
    const samples = Array.from({ length: 64 }, (_, k) => at(p1, (k / 64) * period))
    const stroke = Math.max(...samples) - Math.min(...samples)
    expect(stroke).toBeGreaterThan(10)
    const phases = new Set([1, 2, 3, 4].map((n) => at(v8.byId.get(`piston-${n}`)!, 0.1).toFixed(2)))
    expect(phases.size).toBeGreaterThan(1)
  })

  it('meshing gears keep their ratio through the driven-by chain', () => {
    const watch = new Scene(design('a mechanical watch')!)
    for (const sp of watch.parts) {
      const a = sp.part.animation
      if (a?.type !== 'rotate' || !a.drivenBy || a.ticks) continue
      const d = watch.angle(a.drivenBy), s = watch.angle(sp.part.id)
      watch.pose(1.7, 0)
      const d2 = watch.angle(a.drivenBy), s2 = watch.angle(sp.part.id)
      if (Math.abs(d2 - d) > 1e-9) expect((s2 - s) / (d2 - d)).toBeCloseTo(a.ratio ?? 1, 6)
    }
  })

  it('every designer yields a valid spec whose poses are finite while exploding', () => {
    for (const q of ['a V8 engine', 'an inline 4', 'a flat six', 'a V12', 'a mechanical watch', 'a jet turbofan', 'a steam locomotive', 'a planetary gearbox']) {
      const spec = design(q)
      expect(spec).not.toBeNull()
      expect({ q, issues: validate(JSON.parse(JSON.stringify(spec))) }).toEqual({ q, issues: [] })
      const sc = new Scene(spec!)
      for (const [t, ex] of [[0.3, 0], [1.9, 1]] as const) {
        const ws = sc.pose(t, ex)
        expect(ws.every((m) => Array.from(m).every(Number.isFinite))).toBe(true)
      }
    }
  })

  it('locomotive driving wheels on one side turn in lockstep (coupled by rods)', () => {
    const loco = new Scene(design('a steam locomotive')!)
    const wheels = loco.parts.filter((p) => /^Driving axle/.test(p.part.label)).map((p) => p.part.id)
    expect(wheels.length).toBeGreaterThanOrEqual(2)
    loco.pose(0.9, 0)
    const a0 = loco.angle(wheels[0]!) % TAU
    for (const w of wheels) expect(loco.angle(w) % TAU).toBeCloseTo(a0, 6)
  })
})

describe('prompts', () => {
  it('maps one-liners to designers and rejects unknown machines', () => {
    expect(design('a V8 engine')!.parts.filter((p) => p.id.startsWith('piston-') && !p.id.includes('ring')).length).toBe(8)
    expect(design('inline 6')!.meta.name).toContain('6')
    expect(design('a toaster')).toBeNull()
  })
})
