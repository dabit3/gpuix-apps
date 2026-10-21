import type { Animation, Geometry, Material, MachineSpec, Part, Vec3 } from '../spec/types'

/** Theme-friendly part colours (GitHub Dark High Contrast accents). */
export const C = {
  steel: '#9ea7b3', light: '#f0f3f6', blue: '#71b7ff', cyan: '#39c5cf', green: '#26cd4d',
  yellow: '#f0b72f', orange: '#ffa657', red: '#ff9492', gray: '#7a828e', brass: '#e2c08d',
}

export const TAU = Math.PI * 2
export const deg = (r: number) => (r * 180) / Math.PI

/** Accumulates parts with terse helpers so each designer reads like an assembly list. */
export class Assembly {
  parts: Part[] = []
  annotations: { part: string; text: string }[] = []
  connections: NonNullable<MachineSpec['connections']> = []

  add(id: string, label: string, description: string, geometry: Geometry, material: Material, opts: { parent?: string; pos?: Vec3; rot?: Vec3; anim?: Animation; explode?: Vec3; note?: string } = {}): string {
    const p: Part = { id, label, description, geometry, material }
    if (opts.parent) p.parentId = opts.parent
    if (opts.pos || opts.rot) p.transform = { ...(opts.pos ? { position: opts.pos.map(r3) as Vec3 } : {}), ...(opts.rot ? { rotation: opts.rot.map(r3) as Vec3 } : {}) }
    if (opts.anim) p.animation = opts.anim
    if (opts.explode) p.explode = opts.explode
    this.parts.push(p)
    if (opts.note) this.annotations.push({ part: id, text: opts.note })
    return id
  }

  spec(meta: MachineSpec['meta'], bounds = 2000): MachineSpec {
    return { version: 1, meta, bounds, parts: this.parts, connections: this.connections, annotations: this.annotations }
  }
}

export const r3 = (v: number) => Math.round(v * 1000) / 1000
export const wire = (color: string, extra: Partial<Material> = {}): Material => ({ style: 'wire', color, ...extra })
export const ghost = (color: string, extra: Partial<Material> = {}): Material => ({ style: 'ghost', color, ...extra })
export const solid = (color: string, extra: Partial<Material> = {}): Material => ({ style: 'solid', color, ...extra })
export const glow = (color: string, extra: Partial<Material> = {}): Material => ({ style: 'glow', color, ...extra })

/**
 * Rest phase (degrees) for gear B so its teeth interlock with gear A. A's teeth sit at local angles 2πk/zA, A's rest
 * angle is `phiA` (radians), B is driven at ratio -zA/zB, and B sits at world angle `beta` around A (x→z plane).
 */
export function meshPhase(zA: number, phiA: number, zB: number, beta: number): number {
  const pitch = TAU / zA
  let e = (beta + phiA) % pitch
  if (e > pitch / 2) e -= pitch
  if (e < -pitch / 2) e += pitch
  const gamma = beta + Math.PI + (e * zA) / zB
  const ratio = -zA / zB
  return deg(Math.PI / zB - gamma - ratio * phiA)
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/^(an?|the)\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'machine'
}
