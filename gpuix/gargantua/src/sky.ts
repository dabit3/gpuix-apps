import { fbm, hash3, ridged } from './noise'
import { blackbody } from './physics'

/**
 * The celestial sphere: an equirectangular texture for the diffuse light (Milky-Way band, dust lanes, a nebula),
 * plus analytic stars on two cube-map cell grids so they stay pin-sharp however hard the lens magnifies them.
 */
export const SKY_W = 1536
export const SKY_H = 768

/** Galactic plane normal and the galactic-centre direction. */
const GN = norm([-0.42, 0.86, 0.29])
const GC = norm(cross(GN, [0, 0, 1]))
function norm(v: number[]): [number, number, number] { const l = Math.hypot(v[0]!, v[1]!, v[2]!); return [v[0]! / l, v[1]! / l, v[2]! / l] }
function cross(a: number[], b: number[]) { return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!] }

/** Fill rows [y0, y1) of the diffuse sky (rgb float). */
export function fillSky(buf: Float32Array, y0: number, y1: number) {
  for (let y = y0; y < y1; y++) {
    const th = ((y + 0.5) / SKY_H) * Math.PI
    const st = Math.sin(th), ct = Math.cos(th)
    for (let x = 0; x < SKY_W; x++) {
      const ph = ((x + 0.5) / SKY_W) * Math.PI * 2
      const dx = st * Math.cos(ph), dy = ct, dz = st * Math.sin(ph)
      const c = diffuse(dx, dy, dz)
      const o = (y * SKY_W + x) * 3
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]
    }
  }
}

export function diffuse(dx: number, dy: number, dz: number): [number, number, number] {
  const h = dx * GN[0] + dy * GN[1] + dz * GN[2]
  const toC = dx * GC[0] + dy * GC[1] + dz * GC[2]
  const warp = (fbm(dx * 3 + 7, dy * 3, dz * 3, 3) - 0.5) * 0.16
  const hh = h + warp
  const band = Math.exp(-(hh * hh) / 0.022) * (0.55 + 0.45 * Math.max(0, toC))
  const bulge = Math.exp(-(1 - toC) * 5.5) * Math.exp(-(hh * hh) / 0.05)
  const cloud = fbm(dx * 5, dy * 5, dz * 5, 6)
  const dust = ridged(dx * 7 + 3, dy * 7, dz * 7, 5)
  const lane = Math.exp(-((hh + 0.015) * (hh + 0.015)) / 0.0035)
  let m = (band * (0.35 + 0.9 * cloud * cloud) + bulge * 0.9) * (1 - Math.min(0.92, lane * dust * 1.5) - 0.35 * dust * band)
  m = Math.max(0, m)
  // Granular unresolved stars inside the band.
  const grain = Math.pow(fbm(dx * 60, dy * 60, dz * 60, 2), 3) * band * 1.4
  const r = 0.03 * m * 1.05 + grain * 0.03
  const g = 0.03 * m * 0.95 + grain * 0.028
  const b = 0.03 * m * 0.82 + grain * 0.03
  // A teal/amber emission nebula off the band.
  const nd = dx * 0.62 + dy * -0.28 + dz * -0.73
  const neb = Math.max(0, nd - 0.86) / 0.14
  const nf = fbm(dx * 9 + 11, dy * 9, dz * 9, 6)
  const nv = neb * neb * Math.max(0, nf - 0.35) * 2.2
  return [r + nv * 0.05, g + nv * 0.032, b + nv * 0.028 + nv * nf * 0.02]
}

/** Bilinear diffuse lookup. */
export function sampleSky(buf: Float32Array, dx: number, dy: number, dz: number, out: Float32Array) {
  const th = Math.acos(Math.max(-1, Math.min(1, dy)))
  let ph = Math.atan2(dz, dx); if (ph < 0) ph += Math.PI * 2
  const fx = (ph / (Math.PI * 2)) * SKY_W - 0.5, fy = Math.min(SKY_H - 1.001, Math.max(0, (th / Math.PI) * SKY_H - 0.5))
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
  const xa = ((x0 % SKY_W) + SKY_W) % SKY_W, xb = (xa + 1) % SKY_W
  const a = (y0 * SKY_W + xa) * 3, b = (y0 * SKY_W + xb) * 3, c = ((y0 + 1) * SKY_W + xa) * 3, d = ((y0 + 1) * SKY_W + xb) * 3
  for (let k = 0; k < 3; k++) out[k] = (buf[a + k]! * (1 - tx) + buf[b + k]! * tx) * (1 - ty) + (buf[c + k]! * (1 - tx) + buf[d + k]! * tx) * ty
}

const STAR_T = (() => { const t = new Float32Array(64 * 3); for (let i = 0; i < 64; i++) { const c = blackbody(2800 + Math.pow(i / 63, 1.6) * 22000); t.set(c, i * 3) } return t })()

/**
 * Analytic stars along direction d. `fw` is the angular pixel footprint (radians), so stars render as a crisp
 * one-to-two-pixel point at any resolution. Adds into out.
 */
export function stars(dx: number, dy: number, dz: number, fw: number, out: Float32Array) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz)
  let f: number, u: number, v: number, m: number
  if (ax >= ay && ax >= az) { f = dx > 0 ? 0 : 1; m = ax; u = dz / ax; v = dy / ax }
  else if (ay >= az) { f = dy > 0 ? 2 : 3; m = ay; u = dx / ay; v = dz / ay }
  else { f = dz > 0 ? 4 : 5; m = az; u = dx / az; v = dy / az }
  const h = Math.abs(dx * GN[0] + dy * GN[1] + dz * GN[2])
  const dens = 0.18 + 0.82 * Math.exp(-(h * h) / 0.03)
  layer(u, v, f, 160, 0.05 + 0.1 * dens, 6, fw * m, out)
  layer(u, v, f, 520, 0.06 + 0.3 * dens, 0.5, fw * m, out)
}

function layer(u: number, v: number, f: number, N: number, p: number, bright: number, fw: number, out: Float32Array) {
  const gx = (u * 0.5 + 0.5) * N, gy = (v * 0.5 + 0.5) * N
  const cx = Math.floor(gx), cy = Math.floor(gy)
  const h0 = hash3(cx, cy, f * 7919 + N)
  if (h0 > p) return
  const sx = cx + 0.2 + 0.6 * hash3(cx, cy, f + 31), sy = cy + 0.2 + 0.6 * hash3(cx, cy, f + 57)
  const ddx = gx - sx, ddy = gy - sy
  // Angular size of one cell ≈ 2/N; keep the star's core at least one pixel wide.
  const sig = Math.max(fw * 0.5, 0.00025) * N * 0.5
  const d2 = (ddx * ddx + ddy * ddy) / (sig * sig)
  if (d2 > 9) return
  const mag = Math.pow(hash3(cx, cy, f + 99) + 1e-4, 9)
  // Energy conserving: a star's flux is spread over its footprint.
  const e = (bright * mag * Math.exp(-0.5 * d2)) / (1 + sig * sig * 2)
  const ti = Math.min(63, (hash3(cy, cx, f + 3) * 64) | 0) * 3
  out[0] += e * STAR_T[ti]!; out[1] += e * STAR_T[ti + 1]!; out[2] += e * STAR_T[ti + 2]!
}
