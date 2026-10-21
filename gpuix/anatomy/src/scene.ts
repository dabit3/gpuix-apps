import { add, alignY, apply, applyDir, axisAngle, dot, euler, len, type Mat4, mat4, mul, norm, scale, scaling, sub, translation } from './math'
import { buildMesh, type Mesh } from './mesh/mesh'
import type { MachineSpec, Part, Vec3 } from './spec/types'

const TAU = Math.PI * 2

export interface ScenePart {
  part: Part
  index: number
  mesh: Mesh
  parent: number
  children: number[]
  depth: number
  /** Explode direction (machine units at explode = 1). */
  explodeDir: Vec3
}

export interface PartState {
  angleDeg?: number
  rpm?: number
  offset?: number
  kind: string
}

/**
 * A machine compiled for animation: meshes built once, then `pose(t, explode)` returns every part's world matrix.
 * Every motion derives from the master clock `t` (seconds) through rpm or "driven by" ratios, so linked parts stay in sync.
 */
export class Scene {
  parts: ScenePart[] = []
  byId = new Map<string, number>()
  center: Vec3 = [0, 0, 0]
  radius = 1
  floorY = 0
  worlds: Mat4[] = []
  private angleCache = new Map<string, number>()
  private t = 0

  constructor(public spec: MachineSpec) {
    spec.parts.forEach((p, i) => this.byId.set(p.id, i))
    this.parts = spec.parts.map((part, index) => ({ part, index, mesh: buildMesh(part.geometry), parent: -1, children: [], depth: 0, explodeDir: [0, 0, 0] }))
    for (const sp of this.parts) {
      const pi = sp.part.parentId ? this.byId.get(sp.part.parentId) : undefined
      if (pi !== undefined && pi !== sp.index) { sp.parent = pi; this.parts[pi]!.children.push(sp.index) }
    }
    for (const sp of this.parts) { let d = 0, p = sp.parent; while (p >= 0 && d < 64) { d++; p = this.parts[p]!.parent } sp.depth = d }
    this.pose(0, 0)
    // Rest-pose bounds give the camera framing, the floor grid and explode directions.
    const centers = this.parts.map((sp) => apply(this.worlds[sp.index]!, sp.mesh.center))
    let min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
    this.parts.forEach((sp, i) => {
      const c = centers[i]!, r = sp.mesh.radius * this.scaleOf(this.worlds[i]!)
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, c[k]! - r); max[k] = Math.max(max[k]!, c[k]! + r) }
    })
    if (!this.parts.length) { min = [-1, -1, -1]; max = [1, 1, 1] }
    this.center = scale(add(min, max), 0.5)
    this.radius = Math.max(1e-3, len(sub(max, min)) / 2)
    this.floorY = min[1]
    for (const sp of this.parts) {
      if (sp.part.explode) { sp.explodeDir = sp.part.explode; continue }
      const from = sp.parent >= 0 ? centers[sp.parent]! : this.center
      const d = sub(centers[sp.index]!, from)
      const l = len(d)
      const k = this.radius * (sp.parent >= 0 ? 0.32 : 0.55)
      sp.explodeDir = l > this.radius * 0.01 ? scale(d, k / l) : [0, 0, 0]
    }
  }

  private scaleOf(m: Mat4) { return Math.hypot(m[0]!, m[1]!, m[2]!) }

  /** Rotation angle (radians) of a part at the current clock. */
  angle(id: string, depth = 0): number {
    const cached = this.angleCache.get(id)
    if (cached !== undefined) return cached
    const i = this.byId.get(id)
    const a = i === undefined ? undefined : this.parts[i]!.part.animation
    let v = 0
    if (a && a.type === 'rotate' && depth < 32) {
      const phase = ((a.phase ?? 0) * Math.PI) / 180
      if (a.drivenBy) v = (a.ratio ?? 1) * this.angle(a.drivenBy, depth + 1) + phase
      else v = ((a.rpm ?? 0) / 60) * TAU * this.t + phase
      if (a.ticks && a.ticks > 0) {
        // Escapement-style stepping: hold, then snap to the next tick with a short ease.
        const step = TAU / a.ticks
        const k = v / step
        const base = Math.floor(k)
        const f = k - base
        const snap = f < 0.75 ? 0 : 1 - Math.pow(1 - (f - 0.75) / 0.25, 3)
        v = (base + snap) * step
      }
    }
    this.angleCache.set(id, v)
    return v
  }

  /** Cycle position (in cycles) of something driven by `driver` at `ratio` cycles per driver revolution. */
  cycles(driver: string | undefined, ratio: number, hz: number): number {
    if (driver) return (this.angle(driver) / TAU) * ratio
    return this.t * hz
  }

  private oscValue(sp: ScenePart): number {
    const a = sp.part.animation
    if (!a || a.type !== 'oscillate') return 0
    const c = this.cycles(a.driver, a.frequency, a.frequency) + (a.phase ?? 0) / 360
    const s = Math.sin(c * TAU)
    if (a.wave === 'cam') {
      // Cam lobe: lifts for a third of the cycle, rests otherwise.
      const x = ((c % 1) + 1) % 1
      return x < 1 / 3 ? a.amplitude * Math.pow(Math.sin(x * 3 * Math.PI), 2) : 0
    }
    return a.amplitude * s
  }

  private local(sp: ScenePart): Mat4 {
    const tr = sp.part.transform ?? {}
    const pos = tr.position ?? [0, 0, 0]
    let m = translation(pos[0], pos[1], pos[2])
    if (tr.rotation) m = mul(m, euler(tr.rotation))
    const a = sp.part.animation
    if (a?.type === 'rotate') m = mul(m, axisAngle(a.axis, this.angle(sp.part.id)))
    else if (a?.type === 'oscillate') {
      const v = this.oscValue(sp)
      const mode = a.mode ?? 'rotate'
      if (mode === 'rotate') m = mul(m, axisAngle(a.axis, (v * Math.PI) / 180))
      else if (mode === 'translate') { const d = norm(a.axis); m = mul(m, translation(d[0] * v, d[1] * v, d[2] * v)) }
      else { const d = norm(a.axis).map(Math.abs) as Vec3; m = mul(m, scaling(1 + d[0] * v, 1 + d[1] * v, 1 + d[2] * v)) }
    } else if (a?.type === 'slide' && a.path.length >= 2) {
      const c = this.cycles(a.driver, a.ratio ?? 1, 1 / Math.max(1e-3, a.period ?? 1))
      const p = samplePath(a.path, ((c % 1) + 1) % 1)
      m = mul(translation(p[0], p[1], p[2]), tr.rotation ? euler(tr.rotation) : mat4())
    }
    if (tr.scale) m = mul(m, scaling(tr.scale[0], tr.scale[1], tr.scale[2]))
    return m
  }

  /** Crank-slider solution: piston pin on the line through the crank axis along `direction`, rod length from the pin. */
  crankSolve(sp: ScenePart): { pin: Vec3; wrist: Vec3; offset: number } | null {
    const a = sp.part.animation
    if (!a || a.type !== 'crank') return null
    const ci = this.byId.get(a.crank)
    if (ci === undefined) return null
    const cw = this.worlds[ci]!
    const P = apply(cw, a.pin)
    const ca = this.parts[ci]!.part.animation
    const axisLocal: Vec3 = ca && ca.type === 'rotate' ? ca.axis : [1, 0, 0]
    const ax = norm(applyDir(cw, axisLocal))
    const O = apply(cw, [0, 0, 0])
    const C0 = add(O, scale(ax, dot(sub(P, O), ax)))
    const u = norm(a.direction)
    const d = sub(P, C0)
    const du = dot(d, u)
    const s = du + Math.sqrt(Math.max(0, a.rod * a.rod - dot(d, d) + du * du))
    return { pin: P, wrist: add(C0, scale(u, s)), offset: s - a.rod }
  }

  /** Compute world matrices for every part at clock `t` and explode amount `explode` (0..1). */
  pose(t: number, explode: number): Mat4[] {
    this.t = t
    this.angleCache.clear()
    const n = this.parts.length
    const worlds: Mat4[] = new Array(n)
    const done = new Uint8Array(n)
    const visit = (i: number, stack: number) => {
      if (done[i]) return worlds[i]!
      const sp = this.parts[i]!
      const parent = sp.parent >= 0 && stack < 64 ? visit(sp.parent, stack + 1) : mat4()
      worlds[i] = mul(parent, this.local(sp))
      done[i] = 1
      return worlds[i]!
    }
    for (let i = 0; i < n; i++) visit(i, 0)
    this.worlds = worlds
    // Machine-frame mechanisms, after their drivers are posed.
    const tr = (sp: ScenePart) => sp.part.transform ?? {}
    for (const sp of this.parts) {
      const a = sp.part.animation
      if (a?.type === 'crank') {
        const s = this.crankSolve(sp)
        if (!s) continue
        let m = translation(...s.wrist)
        if (tr(sp).rotation) m = mul(m, euler(tr(sp).rotation!))
        if (tr(sp).scale) m = mul(m, scaling(...tr(sp).scale!))
        worlds[sp.index] = m
      }
    }
    for (const sp of this.parts) {
      const a = sp.part.animation
      if (a?.type === 'rod') {
        const pi = this.byId.get(a.piston)
        if (pi === undefined) continue
        const s = this.crankSolve(this.parts[pi]!)
        if (!s) continue
        worlds[sp.index] = alignY(scale(add(s.pin, s.wrist), 0.5), sub(s.wrist, s.pin))
      } else if (a?.type === 'follow') {
        const fi = this.byId.get(a.part)
        if (fi === undefined) continue
        const p = apply(worlds[fi]!, a.point)
        let m = translation(...p)
        if (tr(sp).rotation) m = mul(m, euler(tr(sp).rotation!))
        worlds[sp.index] = m
      }
    }
    // Children of machine-frame parts (e.g. a piston's rings) follow them.
    for (const sp of this.parts) {
      if (sp.parent < 0) continue
      const pa = this.parts[sp.parent]!.part.animation?.type
      if (pa === 'crank' || pa === 'rod' || pa === 'follow') worlds[sp.index] = mul(worlds[sp.parent]!, this.local(sp))
    }
    if (explode > 0) {
      const off: Vec3[] = new Array(n)
      const offOf = (i: number, stack: number): Vec3 => {
        if (off[i]) return off[i]!
        const sp = this.parts[i]!
        const own = scale(sp.explodeDir, explode)
        off[i] = sp.parent >= 0 && stack < 64 ? add(own, offOf(sp.parent, stack + 1)) : own
        return off[i]!
      }
      for (let i = 0; i < n; i++) worlds[i] = mul(translation(...offOf(i, 0)), worlds[i]!)
    }
    return worlds
  }

  /** World centre of a part in the current pose. */
  partCenter(i: number): Vec3 {
    return apply(this.worlds[i]!, this.parts[i]!.mesh.center)
  }

  partRadius(i: number): number {
    return this.parts[i]!.mesh.radius * this.scaleOf(this.worlds[i]!)
  }

  /** Live animation values for the inspect panel. */
  state(i: number, t: number): PartState {
    const sp = this.parts[i]!
    const a = sp.part.animation
    if (!a) return { kind: 'static' }
    const save = this.t
    const at = (time: number, f: () => number) => { this.t = time; this.angleCache.clear(); const v = f(); return v }
    let out: PartState
    if (a.type === 'rotate') {
      const dt = 0.01
      const a0 = at(t, () => this.angle(sp.part.id))
      const a1 = at(t + dt, () => this.angle(sp.part.id))
      const deg = ((a0 * 180) / Math.PI) % 360
      out = { kind: a.drivenBy ? `driven ×${fmt(a.ratio ?? 1)}` : 'rotate', angleDeg: (deg + 360) % 360, rpm: a.ticks ? avgRpm(sp, this) : ((a1 - a0) / dt / TAU) * 60 }
    } else if (a.type === 'oscillate') {
      out = { kind: `oscillate ${a.mode ?? 'rotate'}`, offset: at(t, () => this.oscValue(sp)) }
    } else if (a.type === 'crank') {
      const s = this.crankSolve(sp)
      out = { kind: 'crank-slider', offset: s?.offset ?? 0, angleDeg: (((this.angle(a.crank) * 180) / Math.PI) % 360 + 360) % 360 }
    } else out = { kind: a.type }
    this.t = save
    this.angleCache.clear()
    return out
  }
}

function avgRpm(sp: ScenePart, scene: Scene): number {
  const a = sp.part.animation
  if (!a || a.type !== 'rotate') return 0
  if (a.rpm !== undefined && !a.drivenBy) return a.rpm
  let ratio = a.ratio ?? 1, cur = a.drivenBy, guard = 0
  while (cur && guard++ < 32) {
    const d = scene.parts[scene.byId.get(cur) ?? -1]?.part.animation
    if (!d || d.type !== 'rotate') return 0
    if (!d.drivenBy) return ratio * (d.rpm ?? 0)
    ratio *= d.ratio ?? 1
    cur = d.drivenBy
  }
  return 0
}

const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''))

export function samplePath(path: Vec3[], f: number): Vec3 {
  const segs: number[] = []
  let total = 0
  for (let i = 0; i < path.length; i++) {
    const l = len(sub(path[(i + 1) % path.length]!, path[i]!))
    segs.push(l); total += l
  }
  let d = f * total
  for (let i = 0; i < path.length; i++) {
    if (d <= segs[i]! || i === path.length - 1) {
      const k = segs[i]! > 0 ? d / segs[i]! : 0
      const a = path[i]!, b = path[(i + 1) % path.length]!
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
    }
    d -= segs[i]!
  }
  return path[0]!
}
