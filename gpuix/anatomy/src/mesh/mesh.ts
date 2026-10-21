import type { Geometry, Vec2, Vec3 } from '../spec/types'

/** Triangle soup plus the feature edges a wireframe should draw. Local frame, Y up. */
export interface Mesh {
  positions: Float32Array
  edges: Uint32Array
  tris: Uint32Array
  /** Centre and radius of the local bounding sphere. */
  center: Vec3
  radius: number
}

class Builder {
  p: number[] = []
  e: number[] = []
  t: number[] = []
  v(x: number, y: number, z: number) { this.p.push(x, y, z); return this.p.length / 3 - 1 }
  edge(a: number, b: number) { this.e.push(a, b) }
  tri(a: number, b: number, c: number) { this.t.push(a, b, c) }
  quad(a: number, b: number, c: number, d: number) { this.tri(a, b, c); this.tri(a, c, d) }
  loop(ids: number[], closed = true) {
    for (let i = 0; i < ids.length - (closed ? 0 : 1); i++) this.edge(ids[i]!, ids[(i + 1) % ids.length]!)
  }
  build(): Mesh {
    const positions = new Float32Array(this.p)
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, positions[i + k]!); max[k] = Math.max(max[k]!, positions[i + k]!) }
    }
    if (!positions.length) { min = [0, 0, 0]; max = [0, 0, 0] }
    const center: Vec3 = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2]
    const radius = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) / 2
    return { positions, edges: new Uint32Array(this.e), tris: new Uint32Array(this.t), center, radius }
  }
}

const TAU = Math.PI * 2

/** Ring of vertices around Y at height y. */
function ring(b: Builder, r: number, y: number, n: number, phase = 0) {
  const ids: number[] = []
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU
    ids.push(b.v(Math.cos(a) * r, y, Math.sin(a) * r))
  }
  return ids
}

function stitch(b: Builder, a: number[], c: number[], flip = false) {
  const n = a.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (flip) b.quad(a[i]!, c[i]!, c[j]!, a[j]!)
    else b.quad(a[i]!, a[j]!, c[j]!, c[i]!)
  }
}

function cap(b: Builder, ids: number[], y: number, up: boolean) {
  const c = b.v(0, y, 0)
  for (let i = 0; i < ids.length; i++) {
    const j = (i + 1) % ids.length
    if (up) b.tri(c, ids[j]!, ids[i]!)
    else b.tri(c, ids[i]!, ids[j]!)
  }
}

function every(n: number, want: number) { return Math.max(1, Math.round(n / want)) }

function cylinder(b: Builder, r: number, rTop: number, h: number, n: number, hollow?: number) {
  const bot = ring(b, r, -h / 2, n)
  const top = ring(b, rTop, h / 2, n)
  stitch(b, bot, top)
  b.loop(bot); b.loop(top)
  const k = every(n, 8)
  for (let i = 0; i < n; i += k) b.edge(bot[i]!, top[i]!)
  if (hollow && hollow > 0) {
    const ib = ring(b, hollow, -h / 2, n)
    const it = ring(b, hollow * (rTop / r), h / 2, n)
    stitch(b, ib, it, true)
    stitch(b, bot, ib, true)
    stitch(b, top, it)
    b.loop(ib); b.loop(it)
  } else {
    cap(b, bot, -h / 2, false)
    cap(b, top, h / 2, true)
  }
}

function lathe(b: Builder, pts: Vec2[], n: number) {
  const rings = pts.map(([r, y]) => (r <= 1e-6 ? Array.from({ length: n }, () => b.v(0, y, 0)) : ring(b, r, y, n)))
  for (let i = 0; i + 1 < rings.length; i++) stitch(b, rings[i]!, rings[i + 1]!)
  rings.forEach((rg, i) => { if (pts[i]![0] > 1e-6) b.loop(rg) })
  const k = every(n, 8)
  for (let s = 0; s < n; s += k) for (let i = 0; i + 1 < rings.length; i++) b.edge(rings[i]![s]!, rings[i + 1]![s]!)
}

/** Involute spur gear outline (polar points), axis Y, plane XZ. */
export function gearOutline(teeth: number, module: number, pressureAngleDeg = 20): Vec2[] {
  const z = Math.max(4, Math.round(teeth))
  const rp = (module * z) / 2
  const ra = rp + module
  const rf = Math.max(rp - 1.25 * module, module * 0.5)
  const pa = (pressureAngleDeg * Math.PI) / 180
  const rb = rp * Math.cos(pa)
  const inv = (a: number) => Math.tan(a) - a
  const half = Math.PI / (2 * z) + inv(pa)
  const psi = (r: number) => (r <= rb ? half : half - inv(Math.acos(rb / r)))
  const flank: number[] = []
  const steps = z > 40 ? 2 : 4
  const r0 = Math.max(rf, rb * 0.999)
  for (let i = 0; i <= steps; i++) flank.push(r0 + ((ra - r0) * i) / steps)
  const out: Vec2[] = []
  const pitch = TAU / z
  for (let t = 0; t < z; t++) {
    const c = t * pitch
    // Root land, right flank up, tip land, left flank down.
    out.push([rf, c - pitch / 2 + (pitch / 2 - psi(r0)) * 0.5])
    out.push([rf, c - psi(r0)])
    for (const r of flank) out.push([r, c - psi(r)])
    for (let i = flank.length - 1; i >= 0; i--) out.push([flank[i]!, c + psi(flank[i]!)])
    out.push([rf, c + psi(r0)])
  }
  return out
}

function gear(b: Builder, g: Extract<Geometry, { type: 'gear' }>) {
  const outline = gearOutline(g.teeth, g.module, g.pressureAngle)
  const h = g.thickness
  const bore = g.bore ?? 0
  const top: number[] = [], bot: number[] = [], tIn: number[] = [], bIn: number[] = []
  for (const [r, a] of outline) {
    const c = Math.cos(a), s = Math.sin(a)
    bot.push(b.v(c * r, -h / 2, s * r))
    top.push(b.v(c * r, h / 2, s * r))
    const ri = bore > 0 ? bore : 0
    bIn.push(b.v(c * ri, -h / 2, s * ri))
    tIn.push(b.v(c * ri, h / 2, s * ri))
  }
  stitch(b, bot, top)
  stitch(b, bot, bIn, true)
  stitch(b, top, tIn)
  b.loop(bot); b.loop(top)
  const n = outline.length
  const per = n / Math.max(4, Math.round(g.teeth))
  for (let i = 0; i < n; i++) {
    const k = i % per
    if (k === 2 || k === per - 2) b.edge(bot[i]!, top[i]!)
  }
  if (bore > 0) {
    stitch(b, bIn, tIn, true)
    const kb = Math.max(1, Math.round(n / 24))
    const bi: number[] = [], ti: number[] = []
    for (let i = 0; i < n; i += kb) { bi.push(bIn[i]!); ti.push(tIn[i]!) }
    b.loop(bi); b.loop(ti)
  }
  // Spokes read as gear webs in wireframe: radial lines on the top face.
  const spokes = g.spokes ?? 0
  if (spokes > 0) {
    const rp = (g.module * g.teeth) / 2
    const rIn = Math.max(bore * 1.6, rp * 0.25), rOut = rp - 1.6 * g.module
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * TAU
      for (const off of [-0.08, 0.08]) {
        const p0 = b.v(Math.cos(a + off) * rIn, h / 2 + 0.01, Math.sin(a + off) * rIn)
        const p1 = b.v(Math.cos(a + off * 0.5) * rOut, h / 2 + 0.01, Math.sin(a + off * 0.5) * rOut)
        b.edge(p0, p1)
      }
    }
  }
}

function spring(b: Builder, g: Extract<Geometry, { type: 'spring' }>) {
  const n = Math.max(8, Math.round(g.turns * 16))
  const prev: number[][] = []
  const line: number[] = []
  const tubeN = 5
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = t * g.turns * TAU
    const y = -g.height / 2 + t * g.height
    const cx = Math.cos(a) * g.radius, cz = Math.sin(a) * g.radius
    line.push(b.v(cx, y, cz))
    // Small tube cross-section for depth/picking.
    const ids: number[] = []
    for (let k = 0; k < tubeN; k++) {
      const q = (k / tubeN) * TAU
      const rr = g.radius + Math.cos(q) * g.wire
      ids.push(b.v(Math.cos(a) * rr, y + Math.sin(q) * g.wire, Math.sin(a) * rr))
    }
    if (prev.length) stitch(b, prev[0]!, ids)
    prev[0] = ids
  }
  b.loop(line, false)
}

function pipe(b: Builder, g: Extract<Geometry, { type: 'pipe' }>) {
  const n = 8
  const pts = g.path
  if (pts.length < 2) return
  let prev: number[] | null = null
  const rails: number[][] = [[], [], [], []]
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const a = pts[Math.max(0, i - 1)]!, c = pts[Math.min(pts.length - 1, i + 1)]!
    let d: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const dl = Math.hypot(...d) || 1
    d = [d[0] / dl, d[1] / dl, d[2] / dl]
    const ref: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    let u: Vec3 = [ref[1] * d[2] - ref[2] * d[1], ref[2] * d[0] - ref[0] * d[2], ref[0] * d[1] - ref[1] * d[0]]
    const ul = Math.hypot(...u) || 1
    u = [u[0] / ul, u[1] / ul, u[2] / ul]
    const w: Vec3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
    const ids: number[] = []
    for (let k = 0; k < n; k++) {
      const q = (k / n) * TAU
      const cq = Math.cos(q) * g.radius, sq = Math.sin(q) * g.radius
      ids.push(b.v(p[0] + u[0] * cq + w[0] * sq, p[1] + u[1] * cq + w[1] * sq, p[2] + u[2] * cq + w[2] * sq))
    }
    if (i === 0 || i === pts.length - 1) b.loop(ids)
    for (let r = 0; r < 4; r++) rails[r]!.push(ids[(r * n) / 4]!)
    if (prev) stitch(b, prev, ids)
    prev = ids
  }
  for (const r of rails) b.loop(r, false)
}

/** Ear clipping for a simple polygon. Returns index triples. */
export function triangulate(pts: Vec2[]): number[] {
  const n = pts.length
  if (n < 3) return []
  let area = 0
  for (let i = 0; i < n; i++) { const a = pts[i]!, c = pts[(i + 1) % n]!; area += a[0] * c[1] - c[0] * a[1] }
  const idx = Array.from({ length: n }, (_, i) => i)
  if (area < 0) idx.reverse()
  const out: number[] = []
  const inside = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => {
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1])
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
  }
  let guard = 0
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!, ib = idx[i]!, ic = idx[(i + 1) % idx.length]!
      const a = pts[ia]!, b = pts[ib]!, c = pts[ic]!
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) continue
      let ok = true
      for (const j of idx) if (j !== ia && j !== ib && j !== ic && inside(pts[j]!, a, b, c)) { ok = false; break }
      if (!ok) continue
      out.push(ia, ib, ic)
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  if (idx.length === 3) out.push(idx[0]!, idx[1]!, idx[2]!)
  return out
}

function extrude(b: Builder, g: Extract<Geometry, { type: 'extrude' }>) {
  const d = g.depth / 2
  const f = g.points.map(([x, y]) => b.v(x, y, d))
  const k = g.points.map(([x, y]) => b.v(x, y, -d))
  const tri = triangulate(g.points)
  for (let i = 0; i < tri.length; i += 3) {
    b.tri(f[tri[i]!]!, f[tri[i + 1]!]!, f[tri[i + 2]!]!)
    b.tri(k[tri[i]!]!, k[tri[i + 2]!]!, k[tri[i + 1]!]!)
  }
  stitch(b, f, k)
  b.loop(f); b.loop(k)
  for (let i = 0; i < f.length; i++) b.edge(f[i]!, k[i]!)
}

function blades(b: Builder, g: Extract<Geometry, { type: 'blades' }>) {
  cylinder(b, g.hub, g.hub, g.chord * 1.1, 20)
  const twist = ((g.twist ?? 35) * Math.PI) / 180
  const steps = 4
  for (let i = 0; i < g.count; i++) {
    const a = (i / g.count) * TAU
    const ca = Math.cos(a), sa = Math.sin(a)
    const lead: number[] = [], trail: number[] = []
    for (let s = 0; s <= steps; s++) {
      const r = g.hub + ((g.radius - g.hub) * s) / steps
      const pitch = 0.9 - (twist * s) / steps
      const hc = (g.chord / 2) * (1 - 0.25 * (s / steps))
      const dy = Math.cos(pitch) * hc, dt = Math.sin(pitch) * hc
      // Blade chord tilts between the axis (Y) and the tangent direction.
      const tx = -sa, tz = ca
      lead.push(b.v(ca * r + tx * dt, dy, sa * r + tz * dt))
      trail.push(b.v(ca * r - tx * dt, -dy, sa * r - tz * dt))
    }
    for (let s = 0; s < steps; s++) b.quad(lead[s]!, lead[s + 1]!, trail[s + 1]!, trail[s]!)
    b.loop([...lead, ...trail.slice().reverse()])
  }
}

export function buildMesh(g: Geometry): Mesh {
  const b = new Builder()
  switch (g.type) {
    case 'box': {
      const [x, y, z] = g.size.map((v) => v / 2) as Vec3
      const c = [
        b.v(-x, -y, -z), b.v(x, -y, -z), b.v(x, y, -z), b.v(-x, y, -z),
        b.v(-x, -y, z), b.v(x, -y, z), b.v(x, y, z), b.v(-x, y, z),
      ]
      const q = (a: number, bb: number, cc: number, d: number) => b.quad(c[a]!, c[bb]!, c[cc]!, c[d]!)
      q(0, 3, 2, 1); q(4, 5, 6, 7); q(0, 1, 5, 4); q(3, 7, 6, 2); q(0, 4, 7, 3); q(1, 2, 6, 5)
      for (const [a, bb] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) b.edge(c[a!]!, c[bb!]!)
      break
    }
    case 'cylinder':
      cylinder(b, g.radius, g.radiusTop ?? g.radius, g.height, g.segments ?? 24, g.hollow)
      break
    case 'cone': {
      const n = g.segments ?? 24
      const base = ring(b, g.radius, -g.height / 2, n)
      const apex = b.v(0, g.height / 2, 0)
      for (let i = 0; i < n; i++) b.tri(base[i]!, apex, base[(i + 1) % n]!)
      cap(b, base, -g.height / 2, false)
      b.loop(base)
      for (let i = 0; i < n; i += every(n, 6)) b.edge(base[i]!, apex)
      break
    }
    case 'sphere': {
      const n = g.segments ?? 20
      const pts: Vec2[] = []
      for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; pts.push([Math.cos(a) * g.radius, Math.sin(a) * g.radius]) }
      lathe(b, pts, n)
      break
    }
    case 'capsule': {
      const n = g.segments ?? 20
      const pts: Vec2[] = []
      for (let i = 0; i <= 4; i++) { const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2); pts.push([Math.cos(a) * g.radius, -g.height / 2 + Math.sin(a) * g.radius]) }
      for (let i = 0; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); pts.push([Math.cos(a) * g.radius, g.height / 2 + Math.sin(a) * g.radius]) }
      lathe(b, pts, n)
      break
    }
    case 'torus': {
      const n = g.segments ?? 32, m = 10
      const rings: number[][] = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU
        const ids: number[] = []
        for (let k = 0; k < m; k++) {
          const q = (k / m) * TAU
          const r = g.radius + Math.cos(q) * g.tube
          ids.push(b.v(Math.cos(a) * r, Math.sin(q) * g.tube, Math.sin(a) * r))
        }
        rings.push(ids)
      }
      for (let i = 0; i < n; i++) stitch(b, rings[i]!, rings[(i + 1) % n]!)
      for (let i = 0; i < n; i += every(n, 12)) b.loop(rings[i]!)
      for (let k = 0; k < m; k += every(m, 4)) b.loop(rings.map((r) => r[k]!))
      break
    }
    case 'gear':
      gear(b, g)
      break
    case 'spring':
      spring(b, g)
      break
    case 'pipe':
      pipe(b, g)
      break
    case 'extrude':
      extrude(b, g)
      break
    case 'lathe':
      lathe(b, g.points, g.segments ?? 24)
      break
    case 'blades':
      blades(b, g)
      break
  }
  return b.build()
}

/** Pitch radius of a gear geometry, used to check meshing and size belts. */
export function pitchRadius(g: Geometry): number | undefined {
  return g.type === 'gear' ? (g.module * g.teeth) / 2 : undefined
}
