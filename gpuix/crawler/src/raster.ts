import { clamp } from './math'
import type { Sim, Web, Fly } from './sim'
import { Spider, CEPH_R, ABD_R } from './spider'

type RGB = [number, number, number]
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

// GitHub Dark High Contrast accents (Ghostty theme palette)
export const ACCENTS: RGB[] = ['#f0b72f', '#ff9492', '#71b7ff', '#26cd4d', '#39c5cf'].map(hex)
const BODY: RGB = hex('#3b434f')
const LEG: RGB = hex('#56606d')
const JOINT: RGB = hex('#7a828e')
const TARSUS_C: RGB = hex('#3d4550')
const SILK: RGB = hex('#d9dee3')
const SCAN: RGB = hex('#71b7ff')
const FLY: RGB = hex('#c3ccd6')
const LX = -0.45, LY = -0.6, LZ = 0.66 // light from top-left, normalized-ish

/** A tiny CPU rasterizer with analytic anti-aliasing that draws into an RGBA buffer for <img>.setImagePixels. */
export class Raster {
  buf: Uint8Array
  u32: Uint32Array
  constructor(public w: number, public h: number) {
    this.buf = new Uint8Array(w * h * 4)
    this.u32 = new Uint32Array(this.buf.buffer)
  }

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return
    this.w = w
    this.h = h
    this.buf = new Uint8Array(w * h * 4)
    this.u32 = new Uint32Array(this.buf.buffer)
  }

  clear() {
    this.u32.fill(0)
  }

  /** Straight-alpha source-over. */
  blend(i: number, r: number, g: number, b: number, a: number) {
    if (a <= 0.002) return
    const B = this.buf
    const da = B[i + 3]! / 255
    const oa = a + da * (1 - a)
    const k = da * (1 - a)
    B[i] = (r * a + B[i]! * k) / oa
    B[i + 1] = (g * a + B[i + 1]! * k) / oa
    B[i + 2] = (b * a + B[i + 2]! * k) / oa
    B[i + 3] = oa * 255
  }

  /** Tapered capsule from (ax,ay,r0) to (bx,by,r1). */
  capsule(ax: number, ay: number, bx: number, by: number, r0: number, r1: number, c: RGB, alpha = 1, shade = false) {
    const pad = Math.max(r0, r1) + 1
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad)), x1 = Math.min(this.w - 1, Math.ceil(Math.max(ax, bx) + pad))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - pad)), y1 = Math.min(this.h - 1, Math.ceil(Math.max(ay, by) + pad))
    const dx = bx - ax, dy = by - ay
    const ll = dx * dx + dy * dy || 1e-6
    const len = Math.sqrt(ll)
    const nx = -dy / len, ny = dx / len
    const light = shade ? nx * LX + ny * LY : 0
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5 - ay
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax
        const t = clamp((px * dx + py * dy) / ll, 0, 1)
        const qx = px - dx * t, qy = py - dy * t
        const d = Math.sqrt(qx * qx + qy * qy)
        const r = r0 + (r1 - r0) * t
        const cov = clamp(r - d + 0.5, 0, 1)
        if (cov <= 0) continue
        let k = 1
        if (shade) {
          const side = (qx * nx + qy * ny) / Math.max(r, 0.5)
          k = 0.75 + 0.55 * side * light + 0.25 * (1 - side * side)
        }
        this.blend((y * this.w + x) * 4, c[0] * k, c[1] * k, c[2] * k, cov * alpha)
      }
    }
  }

  disc(cx: number, cy: number, r: number, c: RGB, alpha = 1) {
    this.capsule(cx, cy, cx, cy, r, r, c, alpha)
  }

  /** Lit ellipsoid seen from above: (a,b) radii, rotated by `ang`. */
  ellipsoid(cx: number, cy: number, a: number, b: number, ang: number, c: RGB, spec = 0.5) {
    const R = Math.max(a, b) + 1.5
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(this.w - 1, Math.ceil(cx + R))
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(this.h - 1, Math.ceil(cy + R))
    const ca = Math.cos(ang), sa = Math.sin(ang)
    const m = Math.min(a, b)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - cx, py = y + 0.5 - cy
        const u = (px * ca + py * sa) / a, v = (-px * sa + py * ca) / b
        const q = Math.sqrt(u * u + v * v)
        const cov = clamp((1 - q) * m + 0.5, 0, 1)
        if (cov <= 0) continue
        const qq = Math.min(1, q)
        const nz = Math.sqrt(1 - qq * qq)
        // normal back to screen space
        const nxs = (u * ca - v * sa), nys = (u * sa + v * ca)
        const diff = Math.max(0, nxs * LX + nys * LY + nz * LZ)
        const hx = LX, hy = LY, hz = LZ + 1
        const hl = Math.hypot(hx, hy, hz)
        const sp = Math.pow(Math.max(0, (nxs * hx + nys * hy + nz * hz) / hl), 28) * spec
        const k = 0.35 + 0.95 * diff
        const rim = Math.pow(qq, 6) * 0.25
        this.blend((y * this.w + x) * 4,
          c[0] * k + 255 * (sp + rim * 0.5), c[1] * k + 255 * (sp + rim * 0.55), c[2] * k + 255 * (sp + rim * 0.6), cov)
      }
    }
  }

  /** Soft blurred shadow ellipse. */
  shadow(cx: number, cy: number, a: number, b: number, ang: number, alpha: number) {
    const R = Math.max(a, b) * 1.6
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(this.w - 1, Math.ceil(cx + R))
    const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(this.h - 1, Math.ceil(cy + R))
    const ca = Math.cos(ang), sa = Math.sin(ang)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - cx, py = y + 0.5 - cy
        const u = (px * ca + py * sa) / a, v = (-px * sa + py * ca) / b
        const q = u * u + v * v
        if (q > 2.6) continue
        this.blend((y * this.w + x) * 4, 0, 0, 0, alpha * Math.exp(-q * 1.6))
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, alpha: number) {
    const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(this.w, Math.ceil(x + w))
    const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(this.h, Math.ceil(y + h))
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.blend((yy * this.w + xx) * 4, c[0], c[1], c[2], alpha)
  }
}

// screen projection: height lifts toward the top of the screen, shadows fall down-right
const PZ = 0.55
const proj = (x: number, y: number, z: number, oy: number) => [x, y - z * PZ - oy] as const
const shad = (x: number, y: number, z: number, oy: number) => [x + z * 0.45, y + z * 0.35 - oy] as const

export function drawSpider(r: Raster, s: Spider, t: number, oy: number) {
  const k = s.k
  const f = s.fwd
  const accent = ACCENTS[Math.floor(s.hue * ACCENTS.length) % ACCENTS.length]!
  const bob = s.state === 'drop' ? 0 : Math.sin(s.gaitPhase * 2) * 0.8 * k * Math.min(1, Math.hypot(s.vx, s.vy) / 40)
  const z = s.bodyHeight + bob
  const breath = 1 + 0.035 * Math.sin(t * 2.2 + s.id)
  const fat = s.fat
  // sway: lean into lateral velocity
  const lat = (s.vx * -f.y + s.vy * f.x) * 0.02
  const swx = -f.y * lat, swy = f.x * lat
  const cx = s.x + swx, cy = s.y + swy
  const ax = cx - f.x * 26 * k * (0.9 + 0.1 * fat), ay = cy - f.y * 26 * k * (0.9 + 0.1 * fat)

  const poses = s.legs.map((l) => s.pose(l))
  // shadows
  const [scx, scy] = shad(cx, cy, z, oy)
  const [sax, say] = shad(ax, ay, z + 2 * k, oy)
  r.shadow(sax, say, ABD_R.a * k * fat * 1.05, ABD_R.b * k * fat * 1.05, s.heading, 0.42)
  r.shadow(scx, scy, CEPH_R.a * k, CEPH_R.b * k, s.heading, 0.36)
  for (const p of poses) {
    const a = shad(p.hip.x, p.hip.y, p.hip.z, oy), b = shad(p.knee.x, p.knee.y, p.knee.z, oy)
    const c = shad(p.ankle.x, p.ankle.y, p.ankle.z, oy), d = shad(p.foot.x, p.foot.y, p.foot.z, oy)
    r.capsule(a[0], a[1], b[0], b[1], 2.2 * k, 1.8 * k, [0, 0, 0], 0.22)
    r.capsule(b[0], b[1], c[0], c[1], 1.8 * k, 1.2 * k, [0, 0, 0], 0.22)
    r.capsule(c[0], c[1], d[0], d[1], 1.2 * k, 0.7 * k, [0, 0, 0], 0.22)
  }
  // silk
  if (s.anchor && (s.state === 'drop' || s.threadFade > 0)) {
    const [px, py] = proj(ax, ay, z, oy)
    const top = s.anchor.y - oy
    r.capsule(s.anchor.x, top, px, py, 0.55, 0.55, SILK, s.state === 'drop' ? 0.65 : 0.65 * s.threadFade)
  }
  // legs: back legs first so front legs overlap
  const order = [3, 7, 2, 6, 1, 5, 0, 4]
  for (const i of order) {
    const p = poses[i]!
    const h = proj(p.hip.x, p.hip.y, p.hip.z, oy), kn = proj(p.knee.x, p.knee.y, p.knee.z, oy)
    const an = proj(p.ankle.x, p.ankle.y, p.ankle.z, oy), ft = proj(p.foot.x, p.foot.y, p.foot.z, oy)
    r.capsule(h[0], h[1], kn[0], kn[1], 2.4 * k, 2.0 * k, LEG, 1, true)
    r.capsule(kn[0], kn[1], an[0], an[1], 2.0 * k, 1.4 * k, LEG, 1, true)
    r.capsule(an[0], an[1], ft[0], ft[1], 1.3 * k, 0.75 * k, TARSUS_C, 1, true)
    r.disc(kn[0], kn[1], 2.3 * k, JOINT)
    r.disc(an[0], an[1], 1.5 * k, JOINT, 0.9)
  }
  // abdomen + markings
  const [pax, pay] = proj(ax, ay, z + 2 * k, oy)
  r.ellipsoid(pax, pay, ABD_R.a * k * fat * breath, ABD_R.b * k * fat * breath, s.heading, BODY, 0.55)
  // dorsal folium: a thin median stripe with paired spots
  const fl = ABD_R.a * k * fat
  r.capsule(pax + f.x * fl * 0.55, pay + f.y * fl * 0.55, pax - f.x * fl * 0.7, pay - f.y * fl * 0.7, 1.4 * k, 0.6 * k, accent, 0.55)
  for (let m = 0; m < 3; m++) {
    const off = (0.35 - m * 0.38) * fl
    const wv = (5.2 - m * 1.2) * k * fat
    for (const sd of [-1, 1]) {
      r.disc(pax + f.x * off - f.y * wv * sd, pay + f.y * off + f.x * wv * sd, (1.6 - m * 0.25) * k, accent, 0.9)
    }
  }
  // pedicel + cephalothorax
  const [pcx, pcy] = proj(cx, cy, z, oy)
  r.capsule(pcx - f.x * 9 * k, pcy - f.y * 9 * k, pax + f.x * 12 * k, pay + f.y * 12 * k, 3 * k, 3 * k, BODY, 1, true)
  r.ellipsoid(pcx, pcy, CEPH_R.a * k, CEPH_R.b * k, s.heading, BODY, 0.65)
  // chelicerae / pedipalps
  for (const sd of [-1, 1]) {
    const bx = pcx + f.x * 10 * k - f.y * 3.5 * k * sd, by = pcy + f.y * 10 * k + f.x * 3.5 * k * sd
    r.capsule(bx, by, bx + f.x * 5 * k - f.y * 1.5 * k * sd, by + f.y * 5 * k + f.x * 1.5 * k * sd, 1.8 * k, 1.1 * k, LEG, 1, true)
  }
  // eyes: two large front, two medium, four small
  const blink = s.blink > 0 ? 0.25 : 1
  const eye = (fw: number, sd: number, rad: number) => {
    const ex = pcx + f.x * fw * k - f.y * sd * k, ey = pcy + f.y * fw * k + f.x * sd * k
    r.disc(ex, ey, rad * k * Math.max(0.35, blink), [12, 14, 18])
    if (blink === 1) r.disc(ex - 0.5 * k, ey - 0.6 * k, rad * 0.38 * k, [235, 242, 250], 0.95)
  }
  for (const sd of [-1, 1]) {
    eye(7.4, 2.1 * sd, 1.9)
    eye(5.6, 4.6 * sd, 1.3)
    eye(4.2, 6.2 * sd, 1.0)
    eye(3.2, 2.4 * sd, 0.9)
  }
}

export function drawFly(r: Raster, f: Fly, t: number, oy: number) {
  const age = t - f.t0
  const eaten = f.eatenAt !== null ? clamp(1 - (t - f.eatenAt) / 0.4, 0, 1) : 1
  const enter = clamp(age * 3, 0, 1)
  const x = f.x + Math.sin(t * 7.3 + f.id) * 5 + Math.sin(t * 13 + f.id * 3) * 1.5
  const y = f.y + Math.cos(t * 5.1 + f.id * 2) * 4 - oy - (1 - enter) * 40
  const s = eaten * enter * 1.9
  if (s <= 0.02) return
  r.shadow(x + 3.5 * s, y + 5 * s, 4 * s, 2.5 * s, 0, 0.35)
  const flap = Math.abs(Math.sin(t * 60 + f.id)) * 0.8 + 0.2
  for (const sd of [-1, 1]) r.ellipsoid(x + sd * 3.5 * s, y - 2.2 * s * flap, 3.6 * s, 2 * s, sd * 0.5, [190, 205, 220], 0.2)
  r.ellipsoid(x, y, 2.6 * s, 3.8 * s, 0, FLY, 0.6)
  r.disc(x, y - 3 * s, 1.6 * s, [255, 148, 146])
}

export function drawWeb(r: Raster, w: Web, t: number, oy: number) {
  if (w.t0 < 0) return
  const p = clamp((t - w.t0) / w.dur, 0, 1)
  const cx = w.cx, cy = w.cy - oy
  const n = w.spokes
  const ang = (i: number) => (i / n) * Math.PI * 2 + (((w.seed >> (i % 16)) & 7) - 3.5) * 0.03
  const spokeP = clamp(p / 0.35, 0, 1)
  for (let i = 0; i < n; i++) {
    const pi = clamp(spokeP * n - i, 0, 1)
    if (pi <= 0) break
    const a = ang(i), rr = w.r * (0.85 + ((w.seed >> (i % 13)) & 3) * 0.05) * pi
    r.capsule(cx, cy, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.5, 0.5, SILK, 0.4)
  }
  const spiralP = clamp((p - 0.35) / 0.65, 0, 1)
  const turns = 9
  const total = turns * n
  const upto = Math.floor(total * spiralP)
  let prev: [number, number] | null = null
  for (let j = 0; j <= upto; j++) {
    const i = j % n
    const rr = w.r * (0.92 - (0.78 * j) / total)
    const pt: [number, number] = [cx + Math.cos(ang(i)) * rr, cy + Math.sin(ang(i)) * rr]
    if (prev) {
      // sag the thread slightly toward the hub
      r.capsule(prev[0], prev[1], pt[0], pt[1], 0.45, 0.45, SILK, 0.33)
    }
    prev = pt
  }
  r.disc(cx, cy, 2, SILK, 0.35 * spokeP)
}

/** Draw the whole overlay. Coordinates are page coordinates; `oy` is the scroll offset. */
export function drawScene(r: Raster, sim: Sim, ox: number, oyPage: number) {
  r.clear()
  const t = sim.t
  const oy = oyPage
  for (const w of sim.webs) drawWeb(r, w, t, oy)
  for (const sc of sim.scans.values()) {
    const l = sim.links.find((q) => q.id === sc.linkId)
    if (!l) continue
    const fade = sc.done === null ? 1 : clamp(1 - (t - sc.done) / 1.2, 0, 1)
    const wpx = l.w * sc.progress
    r.rect(l.x - 3, l.y - oy - 1, wpx + 6, l.h + 2, SCAN, 0.16 * fade)
    r.rect(l.x - 3 + wpx + 4, l.y - oy - 3, 2, l.h + 6, SCAN, 0.85 * fade)
  }
  for (const f of sim.flies) drawFly(r, f, t, oy)
  const vis = sim.spiders.filter((s) => s.y - oy > -120 && s.y - oy < r.h + 120)
  vis.sort((a, b) => (a.state === 'drop' ? 1 : 0) - (b.state === 'drop' ? 1 : 0) || a.k - b.k)
  for (const s of vis) drawSpider(r, s, t, oy)
  void ox
}
