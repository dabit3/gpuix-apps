import { apply, applyDir, cross, dot, hexToRgb, len, norm, sub } from '../math'
import type { Scene } from '../scene'
import type { Vec3 } from '../spec/types'

export interface Camera {
  view: 'iso' | 'perspective'
  yaw: number
  pitch: number
  /** Distance from target, machine units. Also sets orthographic scale. */
  dist: number
  target: Vec3
}

export const ISO_YAW = Math.PI / 4
export const ISO_PITCH = Math.atan(1 / Math.SQRT2)
export const FOV = (38 * Math.PI) / 180

export interface Palette {
  bg: [number, number, number]
  grid: [number, number, number]
  accent: [number, number, number]
}

export interface FrameInput {
  scene: Scene
  camera: Camera
  time: number
  hover: number
  selected: number
  palette: Palette
  effects: boolean
}

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; kind: 0 | 1; size: number }

const STYLE = {
  // faceAlpha, writesDepth, frontEdge, backEdge, edgeWidth
  wire: [0.07, true, 1, 0.22, 1.5],
  solid: [0.82, true, 1, 0, 1.4],
  ghost: [0.035, false, 0.42, 0.16, 1.1],
  glow: [0.1, false, 1, 0.45, 1.8],
} as const

/**
 * CPU wireframe renderer. Writes straight-alpha RGBA for `<img>.setImagePixels`, plus a per-pixel part id for picking.
 * Passes: faces into depth + triangle id, resolve (flat-shaded, nearly transparent faces), ghost faces, hidden-line edges
 * (front bright, back dim), connections, then CPU "shader" effects (fire, smoke, electric arcs, plasma, water).
 */
export class Renderer {
  w = 0
  h = 0
  rgba = new Uint8Array(0)
  pick = new Int16Array(0)
  private depth = new Float32Array(0)
  private tri = new Int32Array(0)
  private sx = new Float32Array(0)
  private sy = new Float32Array(0)
  private iz = new Float32Array(0)
  private triR = new Float32Array(0)
  private triG = new Float32Array(0)
  private triB = new Float32Array(0)
  private triA = new Float32Array(0)
  private triPart = new Int16Array(0)
  private particles: Particle[] = []
  private lastTime = 0
  private seed = 1
  // View basis for the current frame.
  private R: Vec3 = [1, 0, 0]
  private U: Vec3 = [0, 1, 0]
  private D: Vec3 = [0, 0, 1]
  private cx = 0
  private cy = 0
  private f = 1
  private camDist = 1
  private persp = false
  private target: Vec3 = [0, 0, 0]
  lastMs = 0

  resize(w: number, h: number) {
    w = Math.max(16, Math.floor(w)); h = Math.max(16, Math.floor(h))
    if (w === this.w && h === this.h) return
    this.w = w; this.h = h
    this.rgba = new Uint8Array(w * h * 4)
    this.pick = new Int16Array(w * h)
    this.depth = new Float32Array(w * h)
    this.tri = new Int32Array(w * h)
  }

  private rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 }

  setCamera(c: Camera) {
    this.D = [Math.cos(c.pitch) * Math.sin(c.yaw), Math.sin(c.pitch), Math.cos(c.pitch) * Math.cos(c.yaw)]
    this.R = norm(cross([0, 1, 0], this.D))
    this.U = cross(this.D, this.R)
    this.f = this.h / 2 / Math.tan(FOV / 2)
    this.cx = this.w / 2; this.cy = this.h / 2
    this.camDist = c.dist
    this.persp = c.view === 'perspective'
    this.target = c.target
  }

  /** Project a world point: [sx, sy, 1/zc]. Orthographic uses a far virtual eye so 1/zc still orders depth. */
  project(p: Vec3): [number, number, number] {
    const q = sub(p, this.target)
    const x = dot(q, this.R), y = dot(q, this.U), z = dot(q, this.D)
    if (this.persp) {
      const zc = this.camDist - z
      const k = this.f / Math.max(zc, 1e-6)
      return [this.cx + x * k, this.cy - y * k, zc > this.camDist * 0.05 ? 1 / zc : -1]
    }
    const k = this.f / this.camDist
    const far = this.camDist * 8
    return [this.cx + x * k, this.cy - y * k, 1 / (far - z)]
  }

  render(fi: FrameInput) {
    const t0 = performance.now()
    const { scene, palette } = fi
    const { w, h, rgba, depth, tri, pick } = this
    this.setCamera(fi.camera)
    depth.fill(0); tri.fill(-1); pick.fill(-1)
    const [br, bgc, bb] = palette.bg
    for (let i = 0, n = w * h * 4; i < n; i += 4) { rgba[i] = br; rgba[i + 1] = bgc; rgba[i + 2] = bb; rgba[i + 3] = 255 }

    const parts = scene.parts
    const highlight = new Uint8Array(parts.length)
    const mark = (i: number, v: number) => { highlight[i] = Math.max(highlight[i]!, v); for (const c of parts[i]!.children) mark(c, v) }
    if (fi.selected >= 0 && fi.selected < parts.length) mark(fi.selected, 2)
    if (fi.hover >= 0 && fi.hover < parts.length) mark(fi.hover, 1)
    const dimOthers = fi.selected >= 0

    this.drawGrid(scene, palette)

    // Triangle tables sized to the whole machine.
    let triCount = 0
    for (const sp of parts) triCount += sp.mesh.tris.length / 3
    if (this.triR.length < triCount) {
      this.triR = new Float32Array(triCount); this.triG = new Float32Array(triCount); this.triB = new Float32Array(triCount)
      this.triA = new Float32Array(triCount); this.triPart = new Int16Array(triCount)
    }
    const light = norm([-0.35 * this.R[0] + 0.8 * this.U[0] + 0.5 * this.D[0], -0.35 * this.R[1] + 0.8 * this.U[1] + 0.5 * this.D[1], -0.35 * this.R[2] + 0.8 * this.U[2] + 0.5 * this.D[2]])
    const accent = palette.accent
    const pulses = parts.map((sp) => pulseOf(scene, sp.part.material.pulse))

    // Project every part's vertices once.
    const projected: { sx: Float32Array; sy: Float32Array; iz: Float32Array; wp: Float32Array }[] = []
    for (const sp of parts) {
      const m = scene.worlds[sp.index]!
      const pos = sp.mesh.positions
      const n = pos.length / 3
      const sx = new Float32Array(n), sy = new Float32Array(n), iz = new Float32Array(n), wp = new Float32Array(n * 3)
      const [Rx, Ry, Rz] = this.R, [Ux, Uy, Uz] = this.U, [Dx, Dy, Dz] = this.D, [tx, ty, tz] = this.target
      const persp = this.persp, f = this.f, cd = this.camDist, cx = this.cx, cy = this.cy, ko = f / cd, far = cd * 8
      for (let v = 0; v < n; v++) {
        const lx = pos[v * 3]!, ly = pos[v * 3 + 1]!, lz = pos[v * 3 + 2]!
        const X = m[0]! * lx + m[4]! * ly + m[8]! * lz + m[12]!
        const Y = m[1]! * lx + m[5]! * ly + m[9]! * lz + m[13]!
        const Z = m[2]! * lx + m[6]! * ly + m[10]! * lz + m[14]!
        wp[v * 3] = X; wp[v * 3 + 1] = Y; wp[v * 3 + 2] = Z
        const qx = X - tx, qy = Y - ty, qz = Z - tz
        const x = qx * Rx + qy * Ry + qz * Rz, y = qx * Ux + qy * Uy + qz * Uz, z = qx * Dx + qy * Dy + qz * Dz
        if (persp) {
          const zc = cd - z, k = f / Math.max(zc, 1e-6)
          sx[v] = cx + x * k; sy[v] = cy - y * k; iz[v] = zc > cd * 0.05 ? 1 / zc : -1
        } else {
          sx[v] = cx + x * ko; sy[v] = cy - y * ko; iz[v] = 1 / (far - z)
        }
      }
      projected.push({ sx, sy, iz, wp })
    }

    // Pass 1: depth + triangle id for depth-writing styles; colours per triangle.
    let base = 0
    const ghostList: number[] = []
    for (const sp of parts) {
      const mat = sp.part.material
      const st = STYLE[mat.style] ?? STYLE.wire
      const [cr, cg, cb] = hexToRgb(mat.color)
      const P = projected[sp.index]!
      const tris = sp.mesh.tris
      const hl = highlight[sp.index]!
      const dim = dimOthers && hl === 0 ? 0.35 : 1
      const pulse = pulses[sp.index]!
      for (let k = 0; k < tris.length; k += 3) {
        const a = tris[k]!, b = tris[k + 1]!, c = tris[k + 2]!
        const id = base + k / 3
        // Flat shading from the world-space face normal (two-sided).
        const wa: Vec3 = [P.wp[a * 3]!, P.wp[a * 3 + 1]!, P.wp[a * 3 + 2]!]
        const nrm = cross(sub([P.wp[b * 3]!, P.wp[b * 3 + 1]!, P.wp[b * 3 + 2]!], wa), sub([P.wp[c * 3]!, P.wp[c * 3 + 1]!, P.wp[c * 3 + 2]!], wa))
        const nl = len(nrm) || 1
        const lam = Math.abs(dot(nrm, light)) / nl
        let shade = 0.35 + 0.65 * lam
        let r = cr * shade, g = cg * shade, bl = cb * shade
        let alpha: number = st[0]
        if (mat.effect === 'plasma' && fi.effects) {
          const q = Math.sin(wa[0] * 0.07 + fi.time * 3.1) + Math.sin(wa[1] * 0.09 - fi.time * 2.3) + Math.sin((wa[0] + wa[2]) * 0.05 + fi.time * 1.7)
          const m = 0.5 + q / 6
          r = 57 + m * 198; g = 197 + m * 58; bl = 207 + m * 48; alpha = 0.22 + 0.25 * m * pulse
        } else if (mat.effect === 'water' && fi.effects) {
          const fres = 1 - Math.abs(dot(nrm, this.D)) / nl
          const ripple = 0.5 + 0.5 * Math.sin(wa[0] * 0.12 + wa[2] * 0.09 + fi.time * 2.5)
          r = 40 + 80 * fres; g = 120 + 100 * fres + 20 * ripple; bl = 220 + 35 * ripple; alpha = 0.16 + 0.35 * fres
        } else if (mat.effect === 'fire' && fi.effects && mat.pulse) {
          alpha = Math.max(alpha, 0.05 + 0.25 * pulse); r = r * (1 - pulse) + 255 * pulse; g = g * (1 - pulse) + 150 * pulse; bl = bl * (1 - pulse) + 40 * pulse
        }
        if (hl) { const k2 = hl === 2 ? 0.35 : 0.5; r = r * (1 - k2) + accent[0] * k2; g = g * (1 - k2) + accent[1] * k2; bl = bl * (1 - k2) + accent[2] * k2; alpha = Math.max(alpha, hl === 2 ? 0.2 : 0.16) }
        shade = dim
        this.triR[id] = r; this.triG[id] = g; this.triB[id] = bl; this.triA[id] = alpha * dim; this.triPart[id] = sp.index
        if (st[1]) this.rasterTri(P.sx, P.sy, P.iz, a, b, c, id, true)
        else ghostList.push(sp.index, k, id)
      }
      base += tris.length / 3
    }

    // Resolve the nearest face per pixel over the background.
    for (let i = 0, n = w * h; i < n; i++) {
      const id = tri[i]!
      if (id < 0) continue
      const a = this.triA[id]!
      const o = i * 4
      rgba[o] = rgba[o]! * (1 - a) + this.triR[id]! * a
      rgba[o + 1] = rgba[o + 1]! * (1 - a) + this.triG[id]! * a
      rgba[o + 2] = rgba[o + 2]! * (1 - a) + this.triB[id]! * a
      pick[i] = this.triPart[id]!
    }

    // Ghost and glow faces tint without occluding.
    for (let g = 0; g < ghostList.length; g += 3) {
      const pi = ghostList[g]!, k = ghostList[g + 1]!, id = ghostList[g + 2]!
      const P = projected[pi]!
      const tris = parts[pi]!.mesh.tris
      this.rasterTri(P.sx, P.sy, P.iz, tris[k]!, tris[k + 1]!, tris[k + 2]!, id, false, parts[pi]!.part.material.style === 'glow')
    }

    // Edges: hidden-line style, front edges full strength, back edges dim.
    for (const sp of parts) {
      const mat = sp.part.material
      const st = STYLE[mat.style] ?? STYLE.wire
      const hl = highlight[sp.index]!
      const dim = dimOthers && hl === 0 ? 0.3 : 1
      let [cr, cg, cb] = hexToRgb(mat.color)
      if (hl) { cr = accent[0]; cg = accent[1]; cb = accent[2] }
      if (mat.effect === 'fire' && fi.effects && mat.pulse) { const p = pulses[sp.index]!; cr = cr + (255 - cr) * p; cg = cg + (190 - cg) * p * 0.6; cb = cb * (1 - p * 0.7) }
      const P = projected[sp.index]!
      const e = sp.mesh.edges
      const width = st[4] + (hl ? 0.8 : 0)
      const front = st[2] * dim, back = (hl ? Math.max(st[3], 0.35) : st[3]) * dim
      const additive = mat.style === 'glow'
      for (let k = 0; k < e.length; k += 2) {
        const a = e[k]!, b = e[k + 1]!
        if (P.iz[a]! <= 0 || P.iz[b]! <= 0) continue
        if (additive) this.line(P.sx[a]!, P.sy[a]!, P.iz[a]!, P.sx[b]!, P.sy[b]!, P.iz[b]!, width + 3.5, cr, cg, cb, 0.12, 0.08, true)
        this.line(P.sx[a]!, P.sy[a]!, P.iz[a]!, P.sx[b]!, P.sy[b]!, P.iz[b]!, width, cr, cg, cb, front, back, additive)
      }
    }

    this.drawConnections(scene, fi)
    const dt = Math.min(0.1, Math.max(0, fi.time - this.lastTime))
    this.lastTime = fi.time
    if (fi.effects) this.drawEffects(scene, fi, pulses, dt)
    this.lastMs = performance.now() - t0
  }

  private rasterTri(sx: Float32Array, sy: Float32Array, iz: Float32Array, a: number, b: number, c: number, id: number, writeDepth: boolean, additive = false) {
    const za = iz[a]!, zb = iz[b]!, zc = iz[c]!
    if (za <= 0 || zb <= 0 || zc <= 0) return
    const x0 = sx[a]!, y0 = sy[a]!, x1 = sx[b]!, y1 = sy[b]!, x2 = sx[c]!, y2 = sy[c]!
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (Math.abs(area) < 1e-6) return
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
    const maxX = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1, x2)))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1, y2)))
    if (minX > maxX || minY > maxY) return
    const sign = area > 0 ? 1 : -1
    area = Math.abs(area)
    const inv = 1 / area
    const W = this.w
    const depth = this.depth, tri = this.tri, pick = this.pick, rgba = this.rgba
    const A0 = (y1 - y2) * sign, B0 = (x2 - x1) * sign
    const A1 = (y2 - y0) * sign, B1 = (x0 - x2) * sign
    const A2 = (y0 - y1) * sign, B2 = (x1 - x0) * sign
    const px = minX + 0.5, py = minY + 0.5
    let r0 = ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) * -sign
    let r1 = ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)) * -sign
    let r2 = ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)) * -sign
    // Edge functions: w_i = A_i*x + B_i*y + C_i, stepped incrementally.
    r0 = A0 * px + B0 * py - (A0 * x1 + B0 * y1)
    r1 = A1 * px + B1 * py - (A1 * x2 + B1 * y2)
    r2 = A2 * px + B2 * py - (A2 * x0 + B2 * y0)
    const tr = this.triR[id]!, tg = this.triG[id]!, tb = this.triB[id]!, ta = this.triA[id]!, tp = this.triPart[id]!
    for (let y = minY; y <= maxY; y++) {
      let w0 = r0, w1 = r1, w2 = r2
      let i = y * W + minX
      for (let x = minX; x <= maxX; x++, i++, w0 += A0, w1 += A1, w2 += A2) {
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = (w0 * za + w1 * zb + w2 * zc) * inv
        if (writeDepth) {
          if (z > depth[i]!) { depth[i] = z; tri[i] = id }
        } else if (z > depth[i]!) {
          const o = i * 4
          if (additive) {
            rgba[o] = Math.min(255, rgba[o]! + tr * ta); rgba[o + 1] = Math.min(255, rgba[o + 1]! + tg * ta); rgba[o + 2] = Math.min(255, rgba[o + 2]! + tb * ta)
          } else {
            rgba[o] = rgba[o]! * (1 - ta) + tr * ta; rgba[o + 1] = rgba[o + 1]! * (1 - ta) + tg * ta; rgba[o + 2] = rgba[o + 2]! * (1 - ta) + tb * ta
          }
          if (pick[i]! < 0) pick[i] = tp
        }
      }
      r0 += B0; r1 += B1; r2 += B2
    }
  }

  /** Anti-aliased thick line with per-pixel depth test: alpha `front` where visible, `back` where occluded. */
  line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, r: number, g: number, b: number, front: number, back: number, additive = false) {
    if (front <= 0 && back <= 0) return
    const W = this.w, H = this.h
    const dx = x1 - x0, dy = y1 - y0
    const steep = Math.abs(dy) > Math.abs(dx)
    // Walk the major axis; cover `width` (perpendicular) across the minor axis.
    let a0 = steep ? y0 : x0, a1 = steep ? y1 : x1, m0 = steep ? x0 : y0, m1 = steep ? x1 : y1
    let za = z0, zb = z1
    if (a0 > a1) { [a0, a1] = [a1, a0]; [m0, m1] = [m1, m0]; [za, zb] = [zb, za] }
    const span = a1 - a0
    const slope = span > 1e-6 ? (m1 - m0) / span : 0
    const hw = (width * Math.sqrt(1 + slope * slope)) / 2
    const start = Math.max(0, Math.floor(a0)), end = Math.min(steep ? H - 1 : W - 1, Math.ceil(a1))
    const depth = this.depth, rgba = this.rgba
    const limit = steep ? W : H
    for (let s = start; s <= end; s++) {
      const c = s + 0.5
      let cov0 = 1
      if (c < a0) cov0 = Math.max(0, 1 - (a0 - c)); else if (c > a1) cov0 = Math.max(0, 1 - (c - a1))
      if (cov0 <= 0) continue
      const t = span > 1e-6 ? Math.min(1, Math.max(0, (c - a0) / span)) : 0
      const m = m0 + slope * (c - a0)
      const z = za + (zb - za) * t
      const lo = m - hw, hi = m + hw
      const p0 = Math.max(0, Math.floor(lo)), p1 = Math.min(limit - 1, Math.floor(hi))
      for (let p = p0; p <= p1; p++) {
        const cov = Math.min(p + 1, hi) - Math.max(p, lo)
        if (cov <= 0) continue
        const i = steep ? s * W + p : p * W + s
        const d = depth[i]!
        const visible = d === 0 || z >= d * 0.996
        const al = (visible ? front : back) * cov * cov0
        if (al <= 0.003) continue
        const o = i * 4
        if (additive) {
          rgba[o] = Math.min(255, rgba[o]! + r * al); rgba[o + 1] = Math.min(255, rgba[o + 1]! + g * al); rgba[o + 2] = Math.min(255, rgba[o + 2]! + b * al)
        } else {
          const k = Math.min(1, al)
          rgba[o] = rgba[o]! + (r - rgba[o]!) * k; rgba[o + 1] = rgba[o + 1]! + (g - rgba[o + 1]!) * k; rgba[o + 2] = rgba[o + 2]! + (b - rgba[o + 2]!) * k
        }
      }
    }
  }

  private seg3(a: Vec3, b: Vec3, width: number, col: [number, number, number], front: number, back: number, additive = false) {
    const p = this.project(a), q = this.project(b)
    if (p[2] <= 0 || q[2] <= 0) return
    this.line(p[0], p[1], p[2], q[0], q[1], q[2], width, col[0], col[1], col[2], front, back, additive)
  }

  private drawGrid(scene: Scene, palette: Palette) {
    const R = scene.radius
    const raw = R / 4
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    const step = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? raw
    const ext = Math.ceil((R * 1.6) / step) * step
    const y = scene.floorY - R * 0.04
    const cx = Math.round(scene.center[0] / step) * step, cz = Math.round(scene.center[2] / step) * step
    for (let v = -ext; v <= ext + 1e-9; v += step) {
      const major = Math.abs(v) < 1e-9
      const al = major ? 0.16 : 0.09
      this.seg3([cx + v, y, cz - ext], [cx + v, y, cz + ext], 1, palette.grid, al, al)
      this.seg3([cx - ext, y, cz + v], [cx + ext, y, cz + v], 1, palette.grid, al, al)
    }
  }

  private drawConnections(scene: Scene, fi: FrameInput) {
    for (const c of scene.spec.connections ?? []) {
      const ai = scene.byId.get(c.from), bi = scene.byId.get(c.to)
      if (ai === undefined || bi === undefined) continue
      const col = hexToRgb(c.color ?? '#9ea7b3')
      const A = scene.partCenter(ai), B = scene.partCenter(bi)
      if (c.type === 'shaft') { this.seg3(A, B, 2.2, col, 0.9, 0.3); continue }
      if (c.type === 'wire') {
        const mid: Vec3 = wireMid(A, B, c.arc)
        let prev = A
        for (let k = 1; k <= 12; k++) {
          const t = k / 12
          const p: Vec3 = [0, 1, 2].map((i) => (1 - t) * (1 - t) * A[i]! + 2 * (1 - t) * t * mid[i]! + t * t * B[i]!) as Vec3
          this.seg3(prev, p, 1.3, col, 0.85, 0.3)
          prev = p
        }
        continue
      }
      // Belt / chain: open belt around two pulleys in the plane normal to the driver's axis.
      const anim = scene.parts[ai]!.part.animation
      const axisL: Vec3 = anim && anim.type === 'rotate' ? anim.axis : [0, 0, 1]
      const ax = norm(applyDir(scene.worlds[ai]!, axisL))
      const r1 = c.radiusFrom ?? scene.partRadius(ai) * 0.7, r2 = c.radiusTo ?? scene.partRadius(bi) * 0.7
      const d = sub(B, A)
      const dist = len(d)
      if (dist < 1e-6) continue
      const ex = norm(d), ey = cross(ax, ex)
      const beta = Math.asin(Math.max(-1, Math.min(1, (r1 - r2) / dist)))
      const pts: Vec3[] = []
      const at = (C: Vec3, r: number, ang: number): Vec3 => [C[0] + (ex[0] * Math.cos(ang) + ey[0] * Math.sin(ang)) * r, C[1] + (ex[1] * Math.cos(ang) + ey[1] * Math.sin(ang)) * r, C[2] + (ex[2] * Math.cos(ang) + ey[2] * Math.sin(ang)) * r]
      const top = Math.PI / 2 + beta
      for (let k = 0; k <= 16; k++) pts.push(at(A, r1, top + (k / 16) * (Math.PI - 2 * beta)))
      for (let k = 0; k <= 16; k++) pts.push(at(B, r2, -top + (k / 16) * (Math.PI + 2 * beta) - Math.PI + Math.PI))
      const loop = [...pts.slice(0, 17), ...pts.slice(17).reverse().map((_, i, arr) => arr[arr.length - 1 - i]!)]
      for (let k = 0; k < loop.length; k++) this.seg3(loop[k]!, loop[(k + 1) % loop.length]!, c.type === 'chain' ? 2.2 : 1.8, col, 0.95, 0.3)
      // Moving teeth/links show the belt speed (surface speed of the driver pulley).
      const speed = scene.angle(c.from) * r1
      let total = 0
      const segL = loop.map((p, k) => { const l = len(sub(loop[(k + 1) % loop.length]!, p)); total += l; return l })
      const spacing = Math.max(total / 40, 1e-6)
      for (let s = ((speed % spacing) + spacing) % spacing; s < total; s += spacing) {
        let rem = s, k = 0
        while (k < segL.length && rem > segL[k]!) { rem -= segL[k]!; k++ }
        if (k >= loop.length) break
        const p0 = loop[k]!, p1 = loop[(k + 1) % loop.length]!
        const t = segL[k]! > 0 ? rem / segL[k]! : 0
        const p: Vec3 = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t]
        const q = this.project(p)
        this.dot(q[0], q[1], c.type === 'chain' ? 2.2 : 1.6, col, 0.9, false)
      }
    }
  }

  private dot(x: number, y: number, r: number, col: [number, number, number], a: number, additive: boolean) {
    const W = this.w, H = this.h, rgba = this.rgba
    const x0 = Math.max(0, Math.floor(x - r - 1)), x1 = Math.min(W - 1, Math.ceil(x + r + 1))
    const y0 = Math.max(0, Math.floor(y - r - 1)), y1 = Math.min(H - 1, Math.ceil(y + r + 1))
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = Math.hypot(px + 0.5 - x, py + 0.5 - y) / r
        if (d >= 1) continue
        const al = a * (1 - d * d)
        const o = (py * W + px) * 4
        if (additive) { rgba[o] = Math.min(255, rgba[o]! + col[0] * al); rgba[o + 1] = Math.min(255, rgba[o + 1]! + col[1] * al); rgba[o + 2] = Math.min(255, rgba[o + 2]! + col[2] * al) }
        else { rgba[o] = rgba[o]! + (col[0] - rgba[o]!) * al; rgba[o + 1] = rgba[o + 1]! + (col[1] - rgba[o + 1]!) * al; rgba[o + 2] = rgba[o + 2]! + (col[2] - rgba[o + 2]!) * al }
      }
    }
  }

  private drawEffects(scene: Scene, fi: FrameInput, pulses: number[], dt: number) {
    const R = scene.radius
    const pxPerUnit = this.f / this.camDist
    for (const sp of scene.parts) {
      const mat = sp.part.material
      if (!mat.effect || mat.effect === 'plasma' || mat.effect === 'water') continue
      const m = scene.worlds[sp.index]!
      const c = apply(m, sp.mesh.center)
      const pulse = pulses[sp.index]!
      const pr = scene.partRadius(sp.index)
      if (mat.effect === 'electric') {
        if (pulse < 0.05) continue
        const tgt = apply(m, mat.effectTarget ?? [0, sp.mesh.radius * 2, 0])
        for (let arc = 0; arc < 2; arc++) {
          let prev = c
          const n = 9
          for (let k = 1; k <= n; k++) {
            const t = k / n
            const j = k === n ? 0 : (this.rand() - 0.5) * pr * 0.9
            const p: Vec3 = [c[0] + (tgt[0] - c[0]) * t + j * this.R[0] + j * 0.6 * this.U[0], c[1] + (tgt[1] - c[1]) * t + j * this.R[1] + j * 0.6 * this.U[1], c[2] + (tgt[2] - c[2]) * t + j * this.R[2] + j * 0.6 * this.U[2]]
            this.seg3(prev, p, 5, [57, 197, 207], 0.25 * pulse, 0.12 * pulse, true)
            this.seg3(prev, p, 1.4, [215, 250, 255], 0.95 * pulse, 0.5 * pulse, true)
            prev = p
          }
        }
        continue
      }
      // Fire and smoke: spawn particles along the effect direction.
      const dir = norm(mat.effectTarget ? applyDir(m, mat.effectTarget) : [0, 1, 0])
      const rate = mat.effect === 'fire' ? 90 * pulse : 22
      const count = rate * dt + (this.rand() < (rate * dt) % 1 ? 1 : 0)
      for (let k = 0; k < Math.floor(count); k++) {
        if (this.particles.length > 900) break
        const spread = mat.effect === 'fire' ? pr * 0.45 : Math.min(pr * 0.45, R * 0.05)
        const sp2 = mat.effect === 'fire' ? R * (0.35 + this.rand() * 0.3) : R * (0.12 + this.rand() * 0.1)
        this.particles.push({
          x: c[0] + (this.rand() - 0.5) * spread, y: c[1] + (this.rand() - 0.5) * spread, z: c[2] + (this.rand() - 0.5) * spread,
          vx: dir[0] * sp2 + (this.rand() - 0.5) * R * 0.08, vy: dir[1] * sp2 + (this.rand() - 0.5) * R * 0.08, vz: dir[2] * sp2 + (this.rand() - 0.5) * R * 0.08,
          life: 0, max: mat.effect === 'fire' ? 0.35 + this.rand() * 0.35 : 1.6 + this.rand() * 1.2, kind: mat.effect === 'fire' ? 0 : 1,
          size: mat.effect === 'fire' ? pr * (0.1 + this.rand() * 0.08) : Math.min(pr * 0.3, R * 0.035) * (0.7 + this.rand() * 0.6),
        })
      }
    }
    const alive: Particle[] = []
    for (const p of this.particles) {
      p.life += dt
      if (p.life >= p.max) continue
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      if (p.kind === 1) { p.vy += R * 0.02 * dt; p.size *= 1 + 0.5 * dt }
      alive.push(p)
      const q = this.project([p.x, p.y, p.z])
      if (q[2] <= 0) continue
      const k = p.life / p.max
      const rpx = Math.max(1.5, p.size * (this.persp ? this.f * q[2] : pxPerUnit) * (p.kind === 0 ? 1 - k * 0.6 : 1))
      if (p.kind === 0) {
        // Colour ramp: white-yellow core to orange to deep red as the particle cools.
        const col: [number, number, number] = k < 0.25 ? [255, 236, 170] : k < 0.55 ? [255, 168, 60] : [235, 80, 40]
        this.dot(q[0], q[1], rpx, col, 0.32 * (1 - k), true)
      } else {
        this.dot(q[0], q[1], rpx, [158, 167, 179], 0.07 * (1 - k) * Math.min(1, k * 6), false)
      }
    }
    this.particles = alive
  }

  /** Part index under a pixel, or -1. */
  pickAt(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y)
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return -1
    // Search a small neighbourhood so thin wire edges are still easy to hit.
    for (const r of [0, 2, 4, 7]) {
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]] as const) {
        const px = xi + dx, py = yi + dy
        if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue
        const v = this.pick[py * this.w + px]!
        if (v >= 0) return v
      }
    }
    return -1
  }
}

/** Effect intensity 0..1 from a pulse window (e.g. combustion flash in the power stroke). */
export function pulseOf(scene: Scene, pulse: import('../spec/types').Pulse | undefined): number {
  if (!pulse) return 1
  const deg = ((scene.angle(pulse.driver) * 180) / Math.PI) * pulse.ratio
  const x = (((deg - pulse.phase) % 360) + 360) % 360
  return x < pulse.width ? 1 - x / pulse.width : 0
}

/** Control point of a wire's quadratic curve: sags by default, or lifts by `arc` × span. */
export function wireMid(A: Vec3, B: Vec3, arc?: number): Vec3 {
  const span = len(sub(A, B))
  return [(A[0] + B[0]) / 2, arc === undefined ? Math.min(A[1], B[1]) - span * 0.15 : Math.max(A[1], B[1]) + span * arc, (A[2] + B[2]) / 2]
}
