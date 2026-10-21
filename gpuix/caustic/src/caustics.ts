import { f32 } from './shared'
import { IOR, IOR_RGB } from './quality'
import type { Water } from './water'

export interface Light { x: number; y: number; z: number }
export interface Ball { on: boolean; x: number; y: number; z: number; r: number }

/**
 * Light-space photon splatting: a P×P grid of sun rays enters the surface, refracts through the
 * local normal (Snell, IOR 1.333) and lands on the pool floor. Each photon adds (C/P)² to the
 * C×C floor texture, so flat water gives exactly 1.0 everywhere, and the value is the ratio of the
 * original to refracted area: >1 where the surface focuses light into a caustic, <1 where it spreads it.
 */
export class Caustics {
  readonly c: number
  readonly p: number
  readonly dispersion: boolean
  /** One channel per colour; without dispersion all three alias the same array. */
  r: Float32Array
  g: Float32Array
  b: Float32Array
  private tmp: Float32Array
  /** Photons that reached the floor last frame (diagnostics). */
  landed = 0

  constructor(c: number, p: number, dispersion: boolean) {
    this.c = c
    this.p = p
    this.dispersion = dispersion
    this.g = f32(c * c)
    this.r = dispersion ? f32(c * c) : this.g
    this.b = dispersion ? f32(c * c) : this.g
    this.tmp = f32(c * c)
  }

  compute(w: Water, waterLevel: number, depth: number, L: Light, ball: Ball) {
    const { c, p } = this
    const chans = this.dispersion ? [this.r, this.g, this.b] : [this.g]
    const etas = this.dispersion ? IOR_RGB.map((i) => 1 / i) : [1 / IOR]
    for (const a of chans) a.fill(0)
    const n = w.n, h = w.h, gx = w.gx, gz = w.gz
    const weight = (c / p) * (c / p)
    const floorY = -depth
    const Lx = L.x, Ly = L.y, Lz = L.z
    const bx = ball.x, by = ball.y, bz = ball.z, br = ball.r, br2 = br * br
    const ballOn = ball.on
    let landed = 0
    for (let pj = 0; pj < p; pj++) {
      const pz = -1 + ((pj + 0.5) * 2) / p
      let fz = ((pz + 1) / 2) * n - 0.5
      if (fz < 0) fz = 0; else if (fz > n - 1.001) fz = n - 1.001
      const j0 = fz | 0, tz = fz - j0
      for (let pi = 0; pi < p; pi++) {
        const px = -1 + ((pi + 0.5) * 2) / p
        let fx = ((px + 1) / 2) * n - 0.5
        if (fx < 0) fx = 0; else if (fx > n - 1.001) fx = n - 1.001
        const i0 = fx | 0, tx = fx - i0
        const k = j0 * n + i0
        const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz
        const hh = h[k]! * w00 + h[k + 1]! * w10 + h[k + n]! * w01 + h[k + n + 1]! * w11
        const sx = gx[k]! * w00 + gx[k + 1]! * w10 + gx[k + n]! * w01 + gx[k + n + 1]! * w11
        const sz = gz[k]! * w00 + gz[k + 1]! * w10 + gz[k + n]! * w01 + gz[k + n + 1]! * w11
        const y = waterLevel + hh
        // Rim shadow: follow the sun ray back up to the deck (y = 0); outside the opening the wall blocks it.
        const up = -y / -Ly
        const qx = px - Lx * up, qz = pz - Lz * up
        if (qx < -1 || qx > 1 || qz < -1 || qz > 1) continue
        if (ballOn) {
          // Above the water the ball blocks the incoming sun ray.
          const ox = px - bx, oy = y - by, oz = pz - bz
          const bb = -(ox * Lx + oy * Ly + oz * Lz), cc = ox * ox + oy * oy + oz * oz - br2
          if (cc < 0 || (bb > 0 && bb * bb - cc > 0)) continue
        }
        let nx = -sx, ny = 1, nz = -sz
        const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz)
        nx *= il; ny *= il; nz *= il
        const cosi = -(nx * Lx + ny * Ly + nz * Lz)
        for (let ch = 0; ch < chans.length; ch++) {
          const eta = etas[ch]!
          const kk = 1 - eta * eta * (1 - cosi * cosi)
          if (kk < 0) continue
          const s = eta * cosi - Math.sqrt(kk)
          const rx = eta * Lx + s * nx, ry = eta * Ly + s * ny, rz = eta * Lz + s * nz
          const t = (y - floorY) / -ry
          const hx = px + rx * t, hz = pz + rz * t
          if (hx <= -1 || hx >= 1 || hz <= -1 || hz >= 1) continue
          if (ballOn) {
            const ox = px - bx, oy = y - by, oz = pz - bz
            const bb = ox * rx + oy * ry + oz * rz, cc = ox * ox + oy * oy + oz * oz - br2
            const disc = bb * bb - cc
            if (cc < 0 || (disc > 0 && -bb - Math.sqrt(disc) > 0 && -bb - Math.sqrt(disc) < t)) continue
          }
          const cxf = ((hx + 1) / 2) * c - 0.5, czf = ((hz + 1) / 2) * c - 0.5
          let ci = Math.floor(cxf), cj = Math.floor(czf)
          const ux = cxf - ci, uz = czf - cj
          const a = chans[ch]!
          // Bilinear splat; edge cells clamp so no energy leaks off the floor.
          const i1 = ci + 1 > c - 1 ? c - 1 : ci + 1, j1 = cj + 1 > c - 1 ? c - 1 : cj + 1
          if (ci < 0) ci = 0
          if (cj < 0) cj = 0
          a[cj * c + ci]! += weight * (1 - ux) * (1 - uz)
          a[cj * c + i1]! += weight * ux * (1 - uz)
          a[j1 * c + ci]! += weight * (1 - ux) * uz
          a[j1 * c + i1]! += weight * ux * uz
          if (ch === 0) landed++
        }
      }
    }
    this.landed = landed
    for (const a of chans) this.blur(a)
  }

  /** Separable [1 2 1] / 4 blur, once each way. */
  private blur(a: Float32Array) {
    const { c, tmp } = this
    for (let j = 0; j < c; j++) {
      const row = j * c
      for (let i = 0; i < c; i++) {
        const l = i > 0 ? i - 1 : i, r = i < c - 1 ? i + 1 : i
        tmp[row + i] = (a[row + l]! + 2 * a[row + i]! + a[row + r]!) * 0.25
      }
    }
    for (let j = 0; j < c; j++) {
      const u = j > 0 ? j - 1 : j, d = j < c - 1 ? j + 1 : j
      for (let i = 0; i < c; i++) a[j * c + i] = (tmp[u * c + i]! + 2 * tmp[j * c + i]! + tmp[d * c + i]!) * 0.25
    }
  }

  /** Mean over the floor of the green channel. */
  mean() { let s = 0; for (let k = 0; k < this.g.length; k++) s += this.g[k]!; return s / this.g.length }
  max() { let m = 0; for (let k = 0; k < this.g.length; k++) if (this.g[k]! > m) m = this.g[k]!; return m }
}
