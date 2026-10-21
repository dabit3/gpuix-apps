export type ShapeType = 'rect' | 'ellipse' | 'sticky' | 'text' | 'pen' | 'arrow' | 'image'
export type Tool = 'select' | 'hand' | 'rect' | 'ellipse' | 'arrow' | 'pen' | 'sticky' | 'text'

export interface Binding {
  id?: string
  x: number
  y: number
}

export interface Shape {
  id: string
  type: ShapeType
  x: number
  y: number
  w: number
  h: number
  color: ColorKey
  text?: string
  /** Pen points relative to x/y, in world units. */
  points?: number[]
  from?: Binding
  to?: Binding
  src?: string
  stress?: boolean
}

export interface Camera {
  x: number
  y: number
  z: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type ColorKey = 'ink' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'gray' | 'teal'

export const PALETTE: Record<ColorKey, { stroke: string; fill: string; sticky: string; rgb: [number, number, number] }> = {
  ink: { stroke: '#1d1d1f', fill: '#f2f2f2', sticky: '#fff3b0', rgb: [29, 29, 31] },
  blue: { stroke: '#0a84ff', fill: '#e3f0ff', sticky: '#cfe6ff', rgb: [10, 132, 255] },
  teal: { stroke: '#0fa3a3', fill: '#dcf5f3', sticky: '#c6f0eb', rgb: [15, 163, 163] },
  green: { stroke: '#2f9e44', fill: '#e2f5e5', sticky: '#d3f2c9', rgb: [47, 158, 68] },
  yellow: { stroke: '#d4a106', fill: '#fff6d6', sticky: '#ffeb99', rgb: [212, 161, 6] },
  orange: { stroke: '#f2760b', fill: '#ffeadb', sticky: '#ffd8b5', rgb: [242, 118, 11] },
  red: { stroke: '#e5383b', fill: '#fde4e4', sticky: '#ffcdd0', rgb: [229, 56, 59] },
  gray: { stroke: '#8e8e93', fill: '#f1f1f3', sticky: '#e6e6ea', rgb: [142, 142, 147] },
}
export const COLOR_KEYS = Object.keys(PALETTE) as ColorKey[]

export const STROKE = 2.5
export const PEN_WIDTH = 4
export const MIN_Z = 0.02
export const MAX_Z = 8

let idCounter = 0
export function newId(prefix = 's'): string {
  idCounter++
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function toScreen(cam: Camera, x: number, y: number) {
  return { x: (x - cam.x) * cam.z, y: (y - cam.y) * cam.z }
}
export function toWorld(cam: Camera, sx: number, sy: number) {
  return { x: sx / cam.z + cam.x, y: sy / cam.z + cam.y }
}

/** Zoom to `z` keeping the world point under screen (sx, sy) fixed. */
export function zoomAt(cam: Camera, z: number, sx: number, sy: number): Camera {
  const nz = clamp(z, MIN_Z, MAX_Z)
  const w = toWorld(cam, sx, sy)
  return { x: w.x - sx / nz, y: w.y - sy / nz, z: nz }
}

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
}

export function intersects(a: Rect, b: Rect) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
}
export function contains(outer: Rect, inner: Rect) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// ── Arrows ─────────────────────────────────────────────────────────────────

/** Point where the ray from the shape's centre towards (tx, ty) leaves its outline. */
export function edgePoint(s: Shape, tx: number, ty: number, gap = 6): { x: number; y: number } {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2
  const dx = tx - cx, dy = ty - cy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  let t: number
  if (s.type === 'ellipse') {
    const a = s.w / 2, b = s.h / 2
    t = 1 / Math.sqrt((ux * ux) / (a * a) + (uy * uy) / (b * b))
  } else {
    const tx1 = ux !== 0 ? s.w / 2 / Math.abs(ux) : Infinity
    const ty1 = uy !== 0 ? s.h / 2 / Math.abs(uy) : Infinity
    t = Math.min(tx1, ty1)
  }
  t = Math.min(t + gap, len)
  return { x: cx + ux * t, y: cy + uy * t }
}

export function resolveEnd(b: Binding | undefined, other: { x: number; y: number }, byId: Map<string, Shape>) {
  if (!b) return { x: 0, y: 0 }
  const target = b.id ? byId.get(b.id) : undefined
  if (!target) return { x: b.x, y: b.y }
  return edgePoint(target, other.x, other.y)
}

function bindingCentre(b: Binding | undefined, byId: Map<string, Shape>) {
  if (!b) return { x: 0, y: 0 }
  const t = b.id ? byId.get(b.id) : undefined
  return t ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : { x: b.x, y: b.y }
}

export function arrowEnds(a: Shape, byId: Map<string, Shape>) {
  const fc = bindingCentre(a.from, byId)
  const tc = bindingCentre(a.to, byId)
  return { p0: resolveEnd(a.from, tc, byId), p1: resolveEnd(a.to, fc, byId) }
}

/** Recompute bound arrows' boxes after their targets moved. */
export function layoutArrows(shapes: Shape[]): Shape[] {
  const byId = new Map(shapes.map((s) => [s.id, s]))
  let changed = false
  const out = shapes.map((s) => {
    if (s.type !== 'arrow' || (!s.from?.id && !s.to?.id)) return s
    const { p0, p1 } = arrowEnds(s, byId)
    const r = normRect(p0.x, p0.y, p1.x, p1.y)
    if (r.x === s.x && r.y === s.y && r.w === s.w && r.h === s.h) return s
    changed = true
    return { ...s, ...r }
  })
  return changed ? out : shapes
}

// ── Pen smoothing ──────────────────────────────────────────────────────────

/** Ramer–Douglas–Peucker on a flat [x0,y0,x1,y1,…] list. */
export function simplify(pts: number[], eps: number): number[] {
  const n = pts.length / 2
  if (n < 3) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a * 2]!, ay = pts[a * 2 + 1]!, bx = pts[b * 2]!, by = pts[b * 2 + 1]!
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    let best = -1, bestD = eps
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2]! - ax) * dy - (pts[i * 2 + 1]! - ay) * dx) / len
      if (d > bestD) { bestD = d; best = i }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2]!, pts[i * 2 + 1]!)
  return out
}

/** Smooth path through points: quadratic curves via midpoints. */
export function smoothPath(pts: number[], ox: number, oy: number): string {
  const n = pts.length / 2
  const f = (v: number) => (Math.round(v * 10) / 10).toString()
  if (n === 0) return ''
  const X = (i: number) => pts[i * 2]! + ox
  const Y = (i: number) => pts[i * 2 + 1]! + oy
  if (n === 1) return `M${f(X(0))} ${f(Y(0))}L${f(X(0) + 0.1)} ${f(Y(0))}`
  if (n === 2) return `M${f(X(0))} ${f(Y(0))}L${f(X(1))} ${f(Y(1))}`
  let d = `M${f(X(0))} ${f(Y(0))}`
  for (let i = 1; i < n - 1; i++) {
    const mx = (X(i) + X(i + 1)) / 2, my = (Y(i) + Y(i + 1)) / 2
    d += `Q${f(X(i))} ${f(Y(i))} ${f(mx)} ${f(my)}`
  }
  d += `L${f(X(n - 1))} ${f(Y(n - 1))}`
  return d
}

/** Turn raw world points into a pen shape with points relative to its box. */
export function penShape(raw: number[], color: ColorKey, z: number): Shape {
  const pts = simplify(raw, 0.8 / z)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]!); x1 = Math.max(x1, pts[i]!)
    y0 = Math.min(y0, pts[i + 1]!); y1 = Math.max(y1, pts[i + 1]!)
  }
  const rel: number[] = []
  for (let i = 0; i < pts.length; i += 2) rel.push(pts[i]! - x0, pts[i + 1]! - y0)
  return { id: newId(), type: 'pen', x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), color, points: rel }
}

// ── Spatial index ──────────────────────────────────────────────────────────

export const CELL = 512

export class SpatialIndex {
  cells = new Map<number, number[]>()
  constructor(public shapes: Shape[]) {
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i]!
      const cx0 = Math.floor(s.x / CELL), cy0 = Math.floor(s.y / CELL)
      const cx1 = Math.floor((s.x + s.w) / CELL), cy1 = Math.floor((s.y + s.h) / CELL)
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const k = key(cx, cy)
          let list = this.cells.get(k)
          if (!list) this.cells.set(k, (list = []))
          list.push(i)
        }
    }
  }
  /** Indices of shapes whose box intersects r, in z-order. */
  query(r: Rect): number[] {
    const cx0 = Math.floor(r.x / CELL), cy0 = Math.floor(r.y / CELL)
    const cx1 = Math.floor((r.x + r.w) / CELL), cy1 = Math.floor((r.y + r.h) / CELL)
    const cellCount = (cx1 - cx0 + 1) * (cy1 - cy0 + 1)
    const out: number[] = []
    if (cellCount > this.cells.size) {
      for (let i = 0; i < this.shapes.length; i++) if (intersects(this.shapes[i]!, r)) out.push(i)
      return out
    }
    const seen = new Set<number>()
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(key(cx, cy))
        if (!list) continue
        for (const i of list) {
          if (seen.has(i)) continue
          seen.add(i)
          if (intersects(this.shapes[i]!, r)) out.push(i)
        }
      }
    return out.sort((a, b) => a - b)
  }
}
const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768)

// ── Hit testing ────────────────────────────────────────────────────────────

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function hitShape(s: Shape, x: number, y: number, tol: number, byId: Map<string, Shape>): boolean {
  if (s.type === 'arrow') {
    const { p0, p1 } = arrowEnds(s, byId)
    return distToSegment(x, y, p0.x, p0.y, p1.x, p1.y) <= tol + 4
  }
  if (s.type === 'pen') {
    const p = s.points ?? []
    for (let i = 0; i + 3 < p.length; i += 2)
      if (distToSegment(x, y, s.x + p[i]!, s.y + p[i + 1]!, s.x + p[i + 2]!, s.y + p[i + 3]!) <= tol + PEN_WIDTH) return true
    return p.length === 2 && Math.hypot(x - s.x - p[0]!, y - s.y - p[1]!) <= tol + PEN_WIDTH
  }
  if (s.type === 'ellipse') {
    const a = s.w / 2 + tol, b = s.h / 2 + tol
    const dx = x - (s.x + s.w / 2), dy = y - (s.y + s.h / 2)
    return (dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1
  }
  return x >= s.x - tol && x <= s.x + s.w + tol && y >= s.y - tol && y <= s.y + s.h + tol
}

export function topHit(index: SpatialIndex, x: number, y: number, tol: number, byId: Map<string, Shape>): Shape | null {
  const cand = index.query({ x: x - tol - 8, y: y - tol - 8, w: (tol + 8) * 2, h: (tol + 8) * 2 })
  for (let k = cand.length - 1; k >= 0; k--) {
    const s = index.shapes[cand[k]!]!
    if (hitShape(s, x, y, tol, byId)) return s
  }
  return null
}

// ── Snapping ───────────────────────────────────────────────────────────────

export interface Guide {
  axis: 'x' | 'y'
  pos: number
  from: number
  to: number
}

/** Snap a moving box against reference boxes; returns the offset and guides. */
export function snapBox(box: Rect, refs: Rect[], tol: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w]
  const ys = [box.y, box.y + box.h / 2, box.y + box.h]
  let bestX: { d: number; pos: number } | null = null
  let bestY: { d: number; pos: number } | null = null
  for (const r of refs) {
    for (const rx of [r.x, r.x + r.w / 2, r.x + r.w])
      for (const x of xs) {
        const d = rx - x
        if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, pos: rx }
      }
    for (const ry of [r.y, r.y + r.h / 2, r.y + r.h])
      for (const y of ys) {
        const d = ry - y
        if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, pos: ry }
      }
  }
  const dx = bestX?.d ?? 0, dy = bestY?.d ?? 0
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }
  const guides: Guide[] = []
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5
  if (bestX) {
    let from = moved.y, to = moved.y + moved.h
    for (const r of refs)
      if ([r.x, r.x + r.w / 2, r.x + r.w].some((v) => near(v, bestX!.pos))) { from = Math.min(from, r.y); to = Math.max(to, r.y + r.h) }
    guides.push({ axis: 'x', pos: bestX.pos, from, to })
  }
  if (bestY) {
    let from = moved.x, to = moved.x + moved.w
    for (const r of refs)
      if ([r.y, r.y + r.h / 2, r.y + r.h].some((v) => near(v, bestY!.pos))) { from = Math.min(from, r.x); to = Math.max(to, r.x + r.w) }
    guides.push({ axis: 'y', pos: bestY.pos, from, to })
  }
  return { dx, dy, guides }
}

// ── Transforms ─────────────────────────────────────────────────────────────

export function translate(s: Shape, dx: number, dy: number): Shape {
  const out: Shape = { ...s, x: s.x + dx, y: s.y + dy }
  if (s.type === 'arrow') {
    if (s.from && !s.from.id) out.from = { x: s.from.x + dx, y: s.from.y + dy }
    if (s.to && !s.to.id) out.to = { x: s.to.x + dx, y: s.to.y + dy }
  }
  return out
}

/** Map a shape from box `a` into box `b` (proportional resize). */
export function remap(s: Shape, a: Rect, b: Rect): Shape {
  const sx = a.w ? b.w / a.w : 1, sy = a.h ? b.h / a.h : 1
  const mx = (x: number) => b.x + (x - a.x) * sx
  const my = (y: number) => b.y + (y - a.y) * sy
  const out: Shape = { ...s, x: mx(s.x), y: my(s.y), w: Math.max(1, s.w * sx), h: Math.max(1, s.h * sy) }
  if (s.points) out.points = s.points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy))
  if (s.type === 'arrow') {
    if (s.from && !s.from.id) out.from = { x: mx(s.from.x), y: my(s.from.y) }
    if (s.to && !s.to.id) out.to = { x: mx(s.to.x), y: my(s.to.y) }
  }
  return out
}

// ── Stress field ───────────────────────────────────────────────────────────

/** Deterministic PRNG so the stress field is the same every run. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const STRESS_ORIGIN = { x: 3000, y: -2000 }

/** 10,000 shapes laid out as clustered "boards" across a ~40k x 26k field. */
export function stressShapes(count = 10_000, seed = 7): Shape[] {
  const rand = mulberry32(seed)
  const out: Shape[] = []
  const words = ['Auth', 'Billing', 'Search', 'Inbox', 'Sync', 'Export', 'Upload', 'Onboard', 'Share', 'Notify', 'Profile', 'Admin', 'Cache', 'Queue', 'Deploy', 'Metrics']
  const colors: ColorKey[] = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'gray', 'ink']
  const clusters = 100
  const per = Math.ceil(count / clusters)
  for (let c = 0; c < clusters && out.length < count; c++) {
    const gx = c % 10, gy = Math.floor(c / 10)
    const ox = STRESS_ORIGIN.x + gx * 4000 + rand() * 600
    const oy = STRESS_ORIGIN.y + gy * 2600 + rand() * 400
    const cols = 10
    for (let i = 0; i < per && out.length < count; i++) {
      const col = i % cols, row = Math.floor(i / cols)
      const r = rand()
      const type: ShapeType = r < 0.45 ? 'rect' : r < 0.7 ? 'ellipse' : 'sticky'
      const w = type === 'sticky' ? 160 : 120 + Math.floor(rand() * 120)
      const h = type === 'sticky' ? 160 : 70 + Math.floor(rand() * 90)
      out.push({
        id: `x${out.length}`,
        type,
        x: Math.round(ox + col * 320 + rand() * 40),
        y: Math.round(oy + row * 230 + rand() * 30),
        w, h,
        color: colors[Math.floor(rand() * colors.length)]!,
        text: type === 'sticky' ? `${words[(c + i) % words.length]} #${i + 1}` : undefined,
        stress: true,
      })
    }
  }
  return out
}

// ── Persistence ────────────────────────────────────────────────────────────

export interface BoardFile {
  format: 'gpuix-infinite-canvas'
  version: 1
  camera: Camera
  shapes: Shape[]
}

export function serialize(shapes: Shape[], camera: Camera): string {
  const file: BoardFile = { format: 'gpuix-infinite-canvas', version: 1, camera, shapes }
  return JSON.stringify(file)
}

export function deserialize(json: string): BoardFile {
  const data = JSON.parse(json) as Partial<BoardFile>
  if (data.format !== 'gpuix-infinite-canvas' || !Array.isArray(data.shapes)) throw new Error('Not a board file')
  return { format: 'gpuix-infinite-canvas', version: 1, camera: data.camera ?? { x: 0, y: 0, z: 1 }, shapes: data.shapes }
}

/** Read width/height from PNG, JPEG, GIF or WebP headers without decoding. */
export function imageSize(buf: Uint8Array): { w: number; h: number } | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20) }
  if (buf[0] === 0x47 && buf[1] === 0x49) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const m = buf[i + 1]!
      const len = dv.getUint16(i + 2)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) }
      i += 2 + len
    }
  }
  if (buf[0] === 0x52 && buf[8] === 0x57 && buf[12] === 0x56) {
    const tag = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!)
    if (tag === 'VP8X') return { w: 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)), h: 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)) }
    if (tag === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff }
    if (tag === 'VP8L') {
      const b = dv.getUint32(21, true)
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }
    }
  }
  return null
}
