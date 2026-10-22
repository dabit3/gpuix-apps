import { DPHI, NPHI, impact, sOf, type Table } from './geodesic'
import { BB, bbIndex, diskG, diskProfile, motionObs, aberrate, staticObs } from './physics'
import { sampleSky, stars } from './sky'
import { DISK_IN, DISK_OUT, diskDensity } from './disk'

type V3 = [number, number, number]

/** Everything a render worker needs for one frame (plain data, posted by value). */
export interface Frame {
  /** Camera position (hole at origin) and orthonormal basis; the image plane spans ±tan·(aspect, 1). */
  cam: V3
  fwd: V3
  right: V3
  up: V3
  tanY: number
  aspect: number
  /** Camera radius (the lens table was traced from here). */
  r0: number
  /** Free-fall speed (fraction of c, radially inward); 0 when orbiting. */
  v: number
  /** 0 outside; 0…1 while inside the horizon (sky shrinks behind). */
  inside: number
  lens: boolean
  disk: boolean
  /** 0 = Physical (Doppler + gravitational shift), 1 = Interstellar (warm, symmetric). */
  look: number
  /** Disk normal and in-plane azimuth basis. */
  n: V3
  d1: V3
  d2: V3
  /** Simulation time, rs/c. */
  t: number
  /** Peak disk temperature (K) and brightness. */
  temp: number
  gain: number
  /** Disk optical depth scale. */
  opacity: number
  /** Number of disk-plane crossings followed (image orders). */
  orders: number
  sky: number
  starGain: number
}

export interface Shared {
  table: Table
  sky: Float32Array
  disk: Float32Array
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** u along the interpolated ray (i, i+1, weight f) at swept angle φ; −1 once the nearer ray has ended. */
function uRay(t: Table, i: number, f: number, phi: number) {
  const j = Math.floor(phi / DPHI)
  if (j >= NPHI - 1) return -1
  const ff = phi / DPHI - j
  const a = i * NPHI + j, b = a + NPHI
  const ua0 = t.u[a]!, ua1 = t.u[a + 1]!, ub0 = t.u[b]!, ub1 = t.u[b + 1]!
  const okA = ua0 >= 0 && ua1 >= 0 && phi <= t.end[i]!
  const okB = ub0 >= 0 && ub1 >= 0 && phi <= t.end[i + 1]!
  const ua = ua0 + (ua1 - ua0) * ff, ub = ub0 + (ub1 - ub0) * ff
  if (okA && okB) return ua + (ub - ua) * f
  if (f < 0.5) return okA ? ua : -1
  return okB ? ub : -1
}

const tmp = new Float32Array(3)

/**
 * Trace rows [y0, y1) into the HDR buffer (rgb float). Lensing comes from the shared ray table: each pixel's ray is
 * one of the table's rays rotated into its own orbital plane (spanned by the camera's radial direction and the ray).
 */
export function traceRows(fr: Frame, S: Shared, hdr: Float32Array, w: number, h: number, y0: number, y1: number) {
  const T = S.table
  const C = fr.cam, r0 = fr.r0
  const cl = Math.hypot(C[0], C[1], C[2])
  const ex: V3 = [C[0] / cl, C[1] / cl, C[2] / cl]
  const inward: V3 = [-ex[0], -ex[1], -ex[2]]
  const obsStatic = staticObs(r0)
  const fw = (2 * fr.tanY) / h
  const tanX = fr.tanY * fr.aspect
  const N = fr.n
  const ac = T.ac, na = T.na
  const ain = 1 / DISK_IN, aout = 1 / DISK_OUT
  const lookI = fr.look >= 0.5
  for (let y = y0; y < y1; y++) {
    const sy = (1 - (2 * (y + 0.5)) / h) * fr.tanY
    for (let x = 0; x < w; x++) {
      const sx = ((2 * (x + 0.5)) / w - 1) * tanX
      let dx = fr.fwd[0] + fr.right[0] * sx + fr.up[0] * sy
      let dy = fr.fwd[1] + fr.right[1] * sx + fr.up[1] * sy
      let dz = fr.fwd[2] + fr.right[2] * sx + fr.up[2] * sy
      const dl = 1 / Math.hypot(dx, dy, dz)
      dx *= dl; dy *= dl; dz *= dl
      let R = 0, G = 0, B = 0
      const o = (y * w + x) * 3
      if (fr.inside > 0) {
        insideSky(fr, S, dx, dy, dz, ex, fw, o, hdr)
        continue
      }
      // Free fall: the camera's frame moves inward at v; map its view direction into the static frame.
      let obs = obsStatic
      if (fr.v > 0) {
        const co = dx * inward[0] + dy * inward[1] + dz * inward[2]
        const cs = aberrate(co, fr.v)
        let px = dx - co * inward[0], py = dy - co * inward[1], pz = dz - co * inward[2]
        const pl = Math.hypot(px, py, pz)
        const ss = Math.sqrt(Math.max(0, 1 - cs * cs))
        if (pl > 1e-9) { px /= pl; py /= pl; pz /= pl } else { px = 0; py = 0; pz = 0 }
        dx = cs * inward[0] + ss * px; dy = cs * inward[1] + ss * py; dz = cs * inward[2] + ss * pz
        obs *= motionObs(cs, fr.v)
      }
      let trans = 1
      let skyX = dx, skyY = dy, skyZ = dz
      let captured = false
      if (fr.lens) {
        const ca = Math.max(-1, Math.min(1, dx * inward[0] + dy * inward[1] + dz * inward[2]))
        const alpha = Math.acos(ca)
        let eyx = dx + ca * ex[0], eyy = dy + ca * ex[1], eyz = dz + ca * ex[2]
        const el = Math.hypot(eyx, eyy, eyz)
        if (el > 1e-9) { eyx /= el; eyy /= el; eyz /= el } else { eyx = fr.up[0]; eyy = fr.up[1]; eyz = fr.up[2] }
        const s = sOf(alpha, ac) * (na - 1)
        const i = Math.min(na - 2, Math.max(0, Math.floor(s)))
        const f = s - i
        const near = f < 0.5 ? i : i + 1
        if (fr.disk) {
          const nx = dot(ex, N), ny = eyx * N[0] + eyy * N[1] + eyz * N[2]
          let phi0 = Math.atan2(-nx, ny)
          if (phi0 < 0) phi0 += Math.PI
          // Photon angular momentum about the disk axis, per unit energy (light travels back along the ray).
          const lx = ex[1] * eyz - ex[2] * eyy, ly = ex[2] * eyx - ex[0] * eyz, lz = ex[0] * eyy - ex[1] * eyx
          const lambda = -impact(r0, alpha) * (lx * N[0] + ly * N[1] + lz * N[2])
          for (let k = 0; k < fr.orders && trans > 0.004; k++) {
            const phi = phi0 + k * Math.PI
            const u = uRay(T, i, f, phi)
            if (u < 0) break
            if (u > ain || u < aout) continue
            const r = 1 / u
            const cp = Math.cos(phi), sp = Math.sin(phi)
            const px = r * (cp * ex[0] + sp * eyx), py = r * (cp * ex[1] + sp * eyy), pz = r * (cp * ex[2] + sp * eyz)
            const e = emit(fr, S, r, px, py, pz, lambda, obs, lookI, k)
            const a = e.a
            R += trans * a * e.r; G += trans * a * e.g; B += trans * a * e.b
            trans *= 1 - a
          }
        }
        if (T.cap[near]) captured = true
        else {
          let qx = T.ex[i]! + (T.ex[i + 1]! - T.ex[i]!) * f, qy = T.ey[i]! + (T.ey[i + 1]! - T.ey[i]!) * f
          const ql = Math.hypot(qx, qy) || 1
          qx /= ql; qy /= ql
          skyX = qx * ex[0] + qy * eyx; skyY = qx * ex[1] + qy * eyy; skyZ = qx * ex[2] + qy * eyz
        }
      } else {
        // Flat space: straight rays, an opaque sphere at r = 1 and the same disk.
        const b = C[0] * dx + C[1] * dy + C[2] * dz, c = cl * cl - 1
        const disc = b * b - c
        const tS = disc > 0 ? -b - Math.sqrt(disc) : Infinity
        if (tS > 0 && tS < Infinity) captured = true
        const dn = dx * N[0] + dy * N[1] + dz * N[2]
        if (fr.disk && Math.abs(dn) > 1e-6) {
          const td = -(C[0] * N[0] + C[1] * N[1] + C[2] * N[2]) / dn
          if (td > 0 && td < tS) {
            const px = C[0] + dx * td, py = C[1] + dy * td, pz = C[2] + dz * td
            const r = Math.hypot(px, py, pz)
            if (r >= DISK_IN && r <= DISK_OUT) {
              const lx = py * dz - pz * dy, ly = pz * dx - px * dz, lz = px * dy - py * dx
              const e = emit(fr, S, r, px, py, pz, -(lx * N[0] + ly * N[1] + lz * N[2]), 1, lookI, 0)
              R += e.a * e.r; G += e.a * e.g; B += e.a * e.b
              trans *= 1 - e.a
            }
          }
        }
      }
      if (!captured && trans > 0.004) {
        sampleSky(S.sky, skyX, skyY, skyZ, tmp)
        tmp[0] *= fr.sky; tmp[1] *= fr.sky; tmp[2] *= fr.sky
        stars(skyX, skyY, skyZ, fw, tmp)
        let kr = tmp[0]!, kg = tmp[1]!, kb = tmp[2]!
        if (obs !== 1) {
          // Blueshift: brighter as g⁴ and bluer; redshift the reverse (capped so the forward cone saturates nicely).
          const g = Math.min(6, obs)
          const I = Math.min(40, g * g * g * g)
          const tint = Math.log(g)
          kr *= I * Math.exp(-0.9 * tint); kg *= I; kb *= I * Math.exp(0.9 * tint)
          if (g > 1.6) { const wht = Math.min(1, (g - 1.6) * 0.25); const m = (kr + kg + kb) / 3; kr += (m - kr) * wht; kg += (m - kg) * wht; kb += (m - kb) * wht }
        }
        const sg = trans * fr.starGain
        R += kr * sg; G += kg * sg; B += kb * sg
      }
      hdr[o] = R; hdr[o + 1] = G; hdr[o + 2] = B
    }
  }
}

const E = { r: 0, g: 0, b: 0, a: 0 }
function emit(fr: Frame, S: Shared, r: number, px: number, py: number, pz: number, lambda: number, obs: number, interstellar: boolean, order: number) {
  const az = Math.atan2(px * fr.d2[0] + py * fr.d2[1] + pz * fr.d2[2], px * fr.d1[0] + py * fr.d1[1] + pz * fr.d1[2])
  const dens = diskDensity(S.disk, r, az, fr.t)
  const prof = diskProfile(r, DISK_IN)
  // Soft outer edge, sharp inner edge at the ISCO.
  const edge = Math.min(1, (r - DISK_IN) / 0.25) * Math.min(1, Math.pow((DISK_OUT - r) / 7, 1.5))
  let T: number, I: number
  if (interstellar) {
    T = 1900 + 1700 * Math.pow(prof, 0.8)
    I = Math.pow(prof, 1.5) * 1.3
  } else {
    const g = diskG(r, lambda, obs)
    T = fr.temp * prof * g
    I = Math.pow(prof, 2.2) * g * g * g * g
  }
  const k = bbIndex(T)
  const e = fr.gain * I * dens * edge * (order > 0 ? 1.15 : 1)
  E.r = BB[k]! * e; E.g = BB[k + 1]! * e; E.b = BB[k + 2]! * e
  E.a = Math.min(0.985, 1 - Math.exp(-(0.35 + dens) * fr.opacity * edge))
  return E
}

/**
 * Inside the horizon every direction leads to r = 0; the outside universe is only visible in a cone behind the
 * camera that narrows as it falls, crushed and blue-shifted.
 */
function insideSky(fr: Frame, S: Shared, dx: number, dy: number, dz: number, ex: V3, fw: number, o: number, hdr: Float32Array) {
  const cb = dx * ex[0] + dy * ex[1] + dz * ex[2]
  const thb = Math.acos(Math.max(-1, Math.min(1, cb)))
  const k = fr.inside
  const tmax = Math.max(0.0, (1 - k) * 1.35 + 0.04 * (1 - k))
  if (thb >= tmax) { hdr[o] = 0; hdr[o + 1] = 0; hdr[o + 2] = 0; return }
  // Squeeze: the whole sky behind crowds into the cone.
  const q = thb / tmax
  const ts = q * Math.PI * 0.75
  let px = dx - cb * ex[0], py = dy - cb * ex[1], pz = dz - cb * ex[2]
  const pl = Math.hypot(px, py, pz) || 1
  px /= pl; py /= pl; pz /= pl
  const c = Math.cos(ts), s = Math.sin(ts)
  const sx = c * ex[0] + s * px, sy = c * ex[1] + s * py, sz = c * ex[2] + s * pz
  sampleSky(S.sky, sx, sy, sz, tmp)
  tmp[0] *= fr.sky; tmp[1] *= fr.sky; tmp[2] *= fr.sky
  stars(sx, sy, sz, fw * (1 + k * 4), tmp)
  const boost = (2 + 18 * k * k) * (1 - 0.6 * q)
  const rim = Math.exp(-Math.pow((1 - q) * 9, 2)) * (0.4 + 3 * k)
  hdr[o] = (tmp[0]! * 0.7 + 0.002) * boost + rim * 0.5
  hdr[o + 1] = (tmp[1]! * 0.95 + 0.003) * boost + rim * 0.75
  hdr[o + 2] = (tmp[2]! * 1.3 + 0.005) * boost + rim * 1.2
}

/** ACES-fitted tone map + sRGB gamma, as a 4096-entry LUT over log exposure. */
const LUT_N = 4096
const LUT_MAX = 64
const LUT = (() => {
  const t = new Uint8Array(LUT_N)
  for (let i = 0; i < LUT_N; i++) {
    const x = (i / (LUT_N - 1)) ** 2 * LUT_MAX
    const a = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
    const c = Math.max(0, Math.min(1, a))
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    t[i] = Math.round(s * 255)
  }
  return t
})()
const lut = (v: number) => { const f = Math.sqrt(Math.max(0, v) / LUT_MAX) * (LUT_N - 1); return LUT[f >= LUT_N - 1 ? LUT_N - 1 : f | 0]! }

/**
 * Tone map rows of the HDR image plus the (quarter-res, bilinear) bloom into BGRA. Exposure and a gentle filmic
 * desaturation of highlights so the hot side of the disk blows out to white like a real exposure.
 */
export function postRows(hdr: Float32Array, bloom: Float32Array, bw: number, bh: number, out: Uint8Array, w: number, h: number, y0: number, y1: number, exposure: number, bloomGain: number, flash: number) {
  const sx = bw / w, sy = bh / h
  for (let y = y0; y < y1; y++) {
    const fy = Math.min(bh - 1.001, Math.max(0, (y + 0.5) * sy - 0.5))
    const by = fy | 0, ty = fy - by
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1.001, Math.max(0, (x + 0.5) * sx - 0.5))
      const bx = fx | 0, tx = fx - bx
      const a = (by * bw + bx) * 3, b = a + 3, c = a + bw * 3, d = c + 3
      const i = (y * w + x) * 3
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty
      let r = hdr[i]! + bloomGain * (bloom[a]! * w00 + bloom[b]! * w10 + bloom[c]! * w01 + bloom[d]! * w11)
      let g = hdr[i + 1]! + bloomGain * (bloom[a + 1]! * w00 + bloom[b + 1]! * w10 + bloom[c + 1]! * w01 + bloom[d + 1]! * w11)
      let bl = hdr[i + 2]! + bloomGain * (bloom[a + 2]! * w00 + bloom[b + 2]! * w10 + bloom[c + 2]! * w01 + bloom[d + 2]! * w11)
      r = r * exposure + flash; g = g * exposure + flash; bl = bl * exposure + flash
      const o = (y * w + x) * 4
      out[o] = lut(bl); out[o + 1] = lut(g); out[o + 2] = lut(r); out[o + 3] = 255
    }
  }
}

/** Bright-pass + downsample (by 4) of rows [y0,y1) of the bloom source. */
export function downRows(hdr: Float32Array, w: number, h: number, dst: Float32Array, bw: number, bh: number, y0: number, y1: number, thresh: number) {
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < bw; x++) {
      let r = 0, g = 0, b = 0, n = 0
      for (let j = 0; j < 4; j++) {
        const yy = Math.min(h - 1, y * 4 + j)
        for (let i = 0; i < 4; i++) {
          const xx = Math.min(w - 1, x * 4 + i)
          const o = (yy * w + xx) * 3
          const l = Math.max(hdr[o]!, hdr[o + 1]!, hdr[o + 2]!)
          const k = l > thresh ? (l - thresh) / l : 0
          r += hdr[o]! * k; g += hdr[o + 1]! * k; b += hdr[o + 2]! * k; n++
        }
      }
      const o = (y * bw + x) * 3
      dst[o] = r / n; dst[o + 1] = g / n; dst[o + 2] = b / n
    }
  }
}

/** Wide two-scale separable Gaussian-ish blur (in place via tmp). Mixing two radii gives a tight core + soft halo. */
export function blur(src: Float32Array, tmpB: Float32Array, w: number, h: number, rad: number) {
  const k: number[] = []
  let sum = 0
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * (rad / 2.2) ** 2)) + 0.25 * Math.exp(-(i * i) / (2 * (rad / 7) ** 2)); k.push(v); sum += v }
  for (let i = 0; i < k.length; i++) k[i]! /= sum
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0
    for (let i = -rad; i <= rad; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); const o = (y * w + xx) * 3; const kk = k[i + rad]!; r += src[o]! * kk; g += src[o + 1]! * kk; b += src[o + 2]! * kk }
    const o = (y * w + x) * 3; tmpB[o] = r; tmpB[o + 1] = g; tmpB[o + 2] = b
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0
    for (let i = -rad; i <= rad; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); const o = (yy * w + x) * 3; const kk = k[i + rad]!; r += tmpB[o]! * kk; g += tmpB[o + 1]! * kk; b += tmpB[o + 2]! * kk }
    const o = (y * w + x) * 3; src[o] = r; src[o + 1] = g; src[o + 2] = b
  }
}
