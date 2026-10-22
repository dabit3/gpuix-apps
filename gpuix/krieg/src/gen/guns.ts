// First-person weapons, built at boot from 3D primitives (tubes, boxes, spheres) and rasterised with a
// z-buffer and per-face lighting into viewmodel sprites. The vanishing point sits at the sprite's top-centre,
// which the renderer places on the crosshair, so barrels recede toward the aim point. No image files.
import type { Sprite } from '../engine/raycast'
import { clamp, hash2 } from './rng'

type V = [number, number, number]
export type GunSprite = Sprite & { tip: number[] }
const W = 192, H = 120, F = 330, L: V = [-0.42, 0.78, -0.46]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V): V => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

class Gun implements Sprite {
  w = W; h = H; px = new Uint32Array(W * H); zb = new Float32Array(W * H)
  tip: number[] = [0.5, 0.3]
  cs = Math.cos(-0.075); sn = Math.sin(-0.075); ox = 0.045
  rot(p: V): V { return [p[0] * this.cs + p[2] * this.sn, p[1], -p[0] * this.sn + p[2] * this.cs] }
  xf(p: V): V { const r = this.rot(p); return [r[0] + this.ox, r[1], r[2]] }
  // Flat-shaded triangle with 1/z depth; e = emissive (unlit, alpha < 255 so the renderer skips scene light).
  tri(a: V, b: V, c: V, col: number, e = 0, n?: V) {
    a = this.xf(a); b = this.xf(b); c = this.xf(c)
    n = n ? this.rot(n) : norm(cross(sub(b, a), sub(c, a)))
    if (dot(n, a) > 0) return
    const P = [a, b, c].map((p) => [W / 2 + (F * p[0]) / p[2], (-F * p[1]) / p[2], 1 / p[2]] as V)
    const [p0, p1, p2] = P as [V, V, V]
    const ar = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
    if (Math.abs(ar) < 1e-6) return
    const d = dot(n, L), spec = Math.max(0, dot(norm(sub(L, norm(a))), n)) ** 24
    const k = e ? 1 : 0.22 + Math.max(0, d) * 0.95 + Math.max(0, -n[2]) * 0.18
    for (let y = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))); y <= Math.min(H - 1, Math.max(p0[1], p1[1], p2[1])); y++)
      for (let x = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))); x <= Math.min(W - 1, Math.max(p0[0], p1[0], p2[0])); x++) {
        const px = x + 0.5, py = y + 0.5
        const w0 = ((p1[0] - px) * (p2[1] - py) - (p1[1] - py) * (p2[0] - px)) / ar
        const w1 = ((p2[0] - px) * (p0[1] - py) - (p2[1] - py) * (p0[0] - px)) / ar
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const iz = w0 * p0[2] + w1 * p1[2] + w2 * p2[2], i = y * W + x
        if (iz <= this.zb[i]!) continue
        this.zb[i] = iz
        const g = e ? 1 : 0.93 + hash2(x, y, col & 255) * 0.14, s = e ? 0 : spec * 120
        const ch = (sh: number) => clamp(((col >> sh) & 255) * k * g + s, 0, 255)
        this.px[i] = (((e ? 230 : 255) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0
      }
  }
  quad(a: V, b: V, c: V, d: V, col: number, e = 0) { const n = norm(cross(sub(b, a), sub(c, a))); this.tri(a, b, c, col, e, n); this.tri(a, c, d, col, e, n) }
  // Tapered tube from a to b with smooth (per-segment) normals; caps on both ends.
  tube(a: V, b: V, r0: number, r1: number, col: number, seg = 14, e = 0) {
    const ax = norm(sub(b, a)), up: V = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], u = norm(cross(ax, up)), v = cross(u, ax)
    const ring = (c: V, r: number, t: number): V => { const cs = Math.cos(t), sn = Math.sin(t); return [c[0] + (u[0] * cs + v[0] * sn) * r, c[1] + (u[1] * cs + v[1] * sn) * r, c[2] + (u[2] * cs + v[2] * sn) * r] }
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * 6.2832, t1 = ((i + 1) / seg) * 6.2832, tm = (t0 + t1) / 2
      const n: V = norm([u[0] * Math.cos(tm) + v[0] * Math.sin(tm), u[1] * Math.cos(tm) + v[1] * Math.sin(tm), u[2] * Math.cos(tm) + v[2] * Math.sin(tm)])
      const A = ring(a, r0, t0), B = ring(a, r0, t1), C = ring(b, r1, t1), D = ring(b, r1, t0)
      this.tri(A, B, C, col, e, n); this.tri(A, C, D, col, e, n)
      this.tri(a, B, A, col, e, [-ax[0], -ax[1], -ax[2]]); this.tri(b, D, C, col, e, ax)
    }
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: number, e = 0) {
    const p = (i: number): V => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0]
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) this.quad(p(a!), p(b!), p(c!), p(d!), col, e)
  }
  ball(c: V, r: number, col: number, sy = 1) {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 12; j++) {
      const s = (a: number, b: number): V => { const th = (a / 8) * Math.PI, ph = (b / 12) * 6.2832; return [c[0] + Math.sin(th) * Math.cos(ph) * r, c[1] + Math.cos(th) * r * sy, c[2] + Math.sin(th) * Math.sin(ph) * r] }
      const n = norm(sub(s(i + 0.5, j + 0.5), c))
      this.tri(s(i, j), s(i + 1, j), s(i + 1, j + 1), col, 0, n); this.tri(s(i, j), s(i + 1, j + 1), s(i, j + 1), col, 0, n)
    }
  }
  // Gloved hand wrapped around a horizontal grip at c, with a sleeved forearm reaching back to `from`.
  hand(c: V, from: V, side: number) {
    this.tube(from, [c[0] + side * 0.012, c[1] - 0.025, c[2] - 0.035], 0.05, 0.034, 0x3d4a2e, 10)
    this.ball([c[0] + side * 0.018, c[1] - 0.02, c[2] - 0.01], 0.034, 0x3b342b, 0.85)
    for (let k = 0; k < 4; k++) { const z = c[2] - 0.03 + k * 0.017; this.tube([c[0] + side * 0.03, c[1] - 0.012, z], [c[0] - side * 0.006, c[1] + 0.05, z + 0.004], 0.009, 0.008, 0x463e33, 8) }
    this.tube([c[0] + side * 0.03, c[1] - 0.01, c[2] - 0.045], [c[0] - side * 0.02, c[1] + 0.04, c[2] - 0.02], 0.01, 0.009, 0x463e33, 8)
  }
  at(p: V) { p = this.xf(p); this.tip = [(W / 2 + (F * p[0]) / p[2]) / W, (-F * p[1]) / p[2] / H] }
  done() {
    const o = this.px.slice()
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (o[y * W + x]) continue
      const s = (i: number) => o[i]! >>> 24
      if ((x > 0 && s(y * W + x - 1)) || (x < W - 1 && s(y * W + x + 1)) || (y > 0 && s(y * W + x - W)) || (y < H - 1 && s(y * W + x + W))) this.px[y * W + x] = 0xff0a0a0c
    }
    return this
  }
}

// f = pump travel (0 rest, 1 racked back).
export function shotgun(f: number) {
  const g = new Gun(), y = -0.095, dz = -0.07 * f
  g.box(-0.03, y - 0.06, 0.12, 0.03, y + 0.014, 0.34, 0x343c48)
  g.box(-0.008, y + 0.014, 0.18, 0.008, y + 0.024, 0.32, 0x1c2028)
  g.tube([0, y, 0.33], [0, y, 0.84], 0.017, 0.016, 0x56606e)
  g.tube([0, y - 0.034, 0.33], [0, y - 0.034, 0.74], 0.014, 0.014, 0x3c4450)
  g.tube([0, y - 0.03, 0.42 + dz], [0, y - 0.03, 0.62 + dz], 0.032, 0.03, 0x8a5428)
  for (let k = 0; k < 6; k++) g.tube([0, y - 0.03, 0.44 + dz + k * 0.028], [0, y - 0.03, 0.448 + dz + k * 0.028], 0.0325, 0.0325, 0x4a2a14)
  g.tube([0, y + 0.017, 0.81], [0, y + 0.026, 0.82], 0.004, 0.004, 0xe0e0d8, 6)
  g.hand([0, y - 0.04, 0.52 + dz], [-0.24, -0.42, 0.2], -1)
  g.hand([0.004, y - 0.08, 0.17], [0.17, -0.38, 0.08], 1)
  g.at([0, y, 0.84])
  return g.done()
}

// f = barrel-cluster spin phase (0..2).
export function chaingun(f: number) {
  const g = new Gun(), y = -0.11, a = (f * Math.PI) / 9
  g.box(-0.04, y - 0.06, 0.09, 0.04, y + 0.02, 0.36, 0x353d4a)
  g.box(-0.012, y + 0.02, 0.12, 0.012, y + 0.034, 0.33, 0x232933)
  g.box(-0.041, y - 0.035, 0.16, -0.039, y - 0.025, 0.32, 0x71b7ff, 1)
  g.box(0.039, y - 0.035, 0.16, 0.041, y - 0.025, 0.32, 0x71b7ff, 1)
  g.tube([0, y, 0.34], [0, y, 0.44], 0.04, 0.036, 0x2a303a)
  g.tube([0, y, 0.62], [0, y, 0.645], 0.033, 0.033, 0x2a303a)
  for (let k = 0; k < 6; k++) { const t = a + (k * Math.PI) / 3, ox = Math.cos(t) * 0.021, oy = Math.sin(t) * 0.021; g.tube([ox, y + oy, 0.43], [ox, y + oy, 0.76], 0.0075, 0.0075, 0x5a6472, 8) }
  g.hand([-0.036, y - 0.05, 0.27], [-0.24, -0.4, 0.18], -1)
  g.hand([0.006, y - 0.085, 0.13], [0.16, -0.36, 0.07], 1)
  g.at([0, y, 0.76])
  return g.done()
}

export function launcher() {
  const g = new Gun(), y = -0.125
  g.tube([0.004, y, 0.09], [0.004, y, 0.64], 0.05, 0.05, 0x3a4a34, 18)
  g.tube([0.004, y, 0.6], [0.004, y, 0.68], 0.057, 0.057, 0x262e24, 18)
  g.tube([0.004, y, 0.3], [0.004, y, 0.335], 0.0505, 0.0505, 0xf0b72f, 18)
  g.box(-0.012, y + 0.05, 0.2, 0.02, y + 0.07, 0.34, 0x22281f)
  g.box(-0.003, y + 0.07, 0.31, 0.011, y + 0.078, 0.33, 0x4ae168, 1)
  g.hand([-0.044, y - 0.035, 0.36], [-0.25, -0.42, 0.2], -1)
  g.hand([0.01, y - 0.07, 0.17], [0.17, -0.38, 0.07], 1)
  g.at([0.004, y, 0.68])
  return g.done()
}
