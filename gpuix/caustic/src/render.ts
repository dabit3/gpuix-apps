import { LAMPS, LOOKS, type Look } from './looks'
import { BALL_R, DECK, WATER_LEVEL, type Basis, type Scene } from './scene'

/** Plain data the per-pixel tracer reads; a Scene produces it each frame. */
export interface Frame {
  n: number
  h: Float32Array
  gx: Float32Array
  gz: Float32Array
  c: number
  cr: Float32Array
  cg: Float32Array
  cb: Float32Array
  lx: number; ly: number; lz: number
  ball: boolean; bx: number; by: number; bz: number; spin: number
  depth: number
  shafts: boolean
  basis: Basis
  /** Background (terminal theme) as 0..255 RGB, painted outside the pool so the app blends into Ghostty. */
  bg: [number, number, number]
  look: Look
  ior: number
  murk: number
  shaftGain: number
}

export function frameOf(s: Scene, aspect: number, bg: [number, number, number]): Frame {
  const w = s.water, c = s.caustics, b = s.ball
  return {
    n: w.n, h: w.h, gx: w.gx, gz: w.gz,
    c: c.c, cr: c.r, cg: c.g, cb: c.b,
    lx: s.light.x, ly: s.light.y, lz: s.light.z,
    ball: b.on, bx: b.x, by: b.y, bz: b.z, spin: b.spin,
    depth: s.settings.depth,
    shafts: s.q.shafts && s.settings.shafts,
    basis: s.basis(aspect),
    bg,
    look: LOOKS[s.settings.look], ior: s.settings.ior, murk: s.settings.murk, shaftGain: s.settings.shaftGain,
  }
}

const LUT_SIZE = 4096
const LUT_MAX = 8
/** ACES (Narkowicz fit) then sRGB encode, linear 0..8 → byte. */
const LUT = (() => {
  const t = new Uint8Array(LUT_SIZE)
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = (i / (LUT_SIZE - 1)) * LUT_MAX
    const a = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
    const v = Math.max(0, Math.min(1, a))
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    t[i] = Math.round(s * 255)
  }
  return t
})()
const LUT_SCALE = (LUT_SIZE - 1) / LUT_MAX
const tm = (x: number) => LUT[x <= 0 ? 0 : x >= LUT_MAX ? LUT_SIZE - 1 : (x * LUT_SCALE) | 0]!

function hash(i: number, j: number) {
  let h = (i * 374761393 + j * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// Shared scratch for tile() so the hot loop allocates nothing.
let tileK = 0
/** Returns the grout mask (0 grout .. 1 tile face) and leaves a per-tile brightness jitter in tileK. */
function tile(a: number, b: number, size: number, grout: number) {
  const fa = a / size, fb = b / size
  const ia = Math.floor(fa), ib = Math.floor(fb)
  const ua = fa - ia, ub = fb - ib
  tileK = 0.94 + 0.12 * hash(ia, ib)
  const ea = Math.min(ua, 1 - ua), eb = Math.min(ub, 1 - ub)
  const e = Math.min(ea, eb)
  return e < grout ? e / grout : 1
}

/**
 * CPU ray tracer for one band of rows into a BGRA buffer (GPUI's native order, so setImagePixels skips a swizzle).
 * Camera ray → deck / dry wall / ball / water surface; at the surface a Fresnel mix of the reflected sky and the
 * refracted ray, which is traced to the floor (tiles × caustics), a wall, or the submerged ball, then attenuated
 * by Beer–Lambert absorption, with optional raymarched light shafts.
 */
export function renderRows(F: Frame, out: Uint8Array, W: number, H: number, y0: number, y1: number) {
  const B = F.basis
  const ex = B.ex, ey = B.ey, ez = B.ez
  const n = F.n, hA = F.h, gxA = F.gx, gzA = F.gz
  const C = F.c, cr = F.cr, cg = F.cg, cb = F.cb
  const lx = F.lx, ly = F.ly, lz = F.lz
  const D = F.depth, floorY = -D
  const WL = WATER_LEVEL
  const bgR = F.bg[0], bgG = F.bg[1], bgB = F.bg[2]
  const ballOn = F.ball, bx = F.bx, by = F.by, bz = F.bz, br = BALL_R, br2 = br * br
  const cosSpin = Math.cos(F.spin), sinSpin = Math.sin(F.spin)
  const eta = 1 / F.ior
  const LK = F.look
  const sunR = LK.sun[0], sunG = LK.sun[1], sunB = LK.sun[2]
  const amb = LK.ambient, sand = LK.floor === 'sand', lane = LK.floor === 'tiles' && LK.lamps === 0
  const flR = LK.floorTint[0], flG = LK.floorTint[1], flB = LK.floorTint[2]
  const wlR = LK.wallTint[0], wlG = LK.wallTint[1], wlB = LK.wallTint[2]
  const zR = LK.skyZenith[0], zG = LK.skyZenith[1], zB = LK.skyZenith[2]
  const hR = LK.skyHorizon[0], hG = LK.skyHorizon[1], hB = LK.skyHorizon[2]
  const lamps = LK.lamps > 0 ? LAMPS : []
  const nL = lamps.length
  // Sun direction refracted through flat water: what lights the floor and walls.
  let R0x: number, R0y: number, R0z: number
  {
    const cosi = -ly
    const k = 1 - eta * eta * (1 - cosi * cosi)
    const s = eta * cosi - Math.sqrt(k)
    R0x = eta * lx; R0y = eta * ly - s * -1 * 0 + s * 1; R0z = eta * lz
    R0y = eta * ly + s
  }
  const floorNdl = -R0y
  const sunUx = -lx, sunUy = -ly, sunUz = -lz
  const shafts = F.shafts
  // Absorption per unit distance (water eats red first) and in-scatter colour.
  const aR = LK.absorb[0] * F.murk, aG = LK.absorb[1] * F.murk, aB = LK.absorb[2] * F.murk
  const sR = LK.scatter[0], sG = LK.scatter[1], sB = LK.scatter[2]
  const sunLum = (sunR + sunG + sunB) / 3

  let lR = 0, lG = 0, lB = 0
  /** Night lamps: light reaching (x,y,z) with normal (nx,ny,nz) from the wall lamps, through the water. */
  const lampLight = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    lR = 0; lG = 0; lB = 0
    for (let i = 0; i < nL; i++) {
      const Lp = lamps[i]!
      let dx = Lp.x - x, dy = Lp.y - y, dz = Lp.z - z
      const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2) + 1e-6
      dx /= d; dy /= d; dz /= d
      // The lamp faces into the pool (opposite its wall's outward normal).
      const face = Math.max(0, -(dx * Lp.x + dz * Lp.z))
      const ndl = Math.max(0, nx * dx + ny * dy + nz * dz)
      const k = (ndl * (0.2 + face * face) * 0.3) / (0.05 + d2)
      lR += Lp.c[0] * k * Math.exp(-aR * d); lG += Lp.c[1] * k * Math.exp(-aG * d); lB += Lp.c[2] * k * Math.exp(-aB * d)
    }
  }

  const causAt = (x: number, z: number, a: Float32Array) => {
    let fx = ((x + 1) / 2) * C - 0.5, fz = ((z + 1) / 2) * C - 0.5
    if (fx < 0) fx = 0; else if (fx > C - 1.001) fx = C - 1.001
    if (fz < 0) fz = 0; else if (fz > C - 1.001) fz = C - 1.001
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * C + i
    const p = a[k]! + (a[k + 1]! - a[k]!) * tx, q = a[k + C]! + (a[k + C + 1]! - a[k + C]!) * tx
    return p + (q - p) * tz
  }

  let cR = 0, cG = 0, cB = 0
  /** Beach ball albedo × light at hit point (hx,hy,hz); `under` darkens for the submerged half. */
  const shadeBall = (hx: number, hy: number, hz: number, under: boolean) => {
    const nx = (hx - bx) / br, ny = (hy - by) / br, nz = (hz - bz) / br
    // Rotate the stripe pattern with the roll.
    const rx = nx * cosSpin - ny * sinSpin, ry = nx * sinSpin + ny * cosSpin
    const seg = Math.floor(((Math.atan2(nz, rx) / Math.PI + 1) * 3)) & 1
    const cap = Math.abs(ry) > 0.86
    let aR2: number, aG2: number, aB2: number
    if (cap) { aR2 = 0.9; aG2 = 0.9; aB2 = 0.9 } else if (seg === 0) { aR2 = 0.86; aG2 = 0.46; aB2 = 0.03 } else { aR2 = 0.92; aG2 = 0.92; aB2 = 0.9 }
    const ndl = Math.max(0, nx * sunUx + ny * sunUy + nz * sunUz)
    const lit = under ? amb * 3 + 0.6 * ndl : amb * 4 + 1.15 * ndl
    // Blinn-ish highlight toward the camera.
    let vx = ex - hx, vy = ey - hy, vz = ez - hz
    const vl = Math.hypot(vx, vy, vz); vx /= vl; vy /= vl; vz /= vl
    let hx2 = vx + sunUx, hy2 = vy + sunUy, hz2 = vz + sunUz
    const hl = Math.hypot(hx2, hy2, hz2); hx2 /= hl; hy2 /= hl; hz2 /= hl
    const sp = under ? 0 : Math.pow(Math.max(0, nx * hx2 + ny * hy2 + nz * hz2), 60) * 1.6
    cR = aR2 * lit * sunR + sp * sunR; cG = aG2 * lit * sunG + sp * sunG; cB = aB2 * lit * sunB + sp * sunB
    if (nL) { lampLight(hx, hy, hz, nx, ny, nz); cR += aR2 * lR * 0.5; cG += aG2 * lG * 0.5; cB += aB2 * lB * 0.5 }
  }

  const sphereT = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => {
    const px = ox - bx, py = oy - by, pz = oz - bz
    const b = px * dx + py * dy + pz * dz, c = px * px + py * py + pz * pz - br2
    const disc = b * b - c
    if (disc <= 0) return Infinity
    const t = -b - Math.sqrt(disc)
    return t > 1e-4 ? t : Infinity
  }

  for (let y = y0; y < y1; y++) {
    const v = 1 - (2 * (y + 0.5)) / H
    const vx0 = B.fx + B.ux * v * B.tanY, vy0 = B.fy + B.uy * v * B.tanY, vz0 = B.fz + B.uz * v * B.tanY
    let o = y * W * 4
    for (let x = 0; x < W; x++, o += 4) {
      const u = (2 * (x + 0.5)) / W - 1
      let dx = vx0 + B.rx * u * B.tanX, dy = vy0 + B.ry * u * B.tanX, dz = vz0 + B.rz * u * B.tanX
      const il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz)
      dx *= il; dy *= il; dz *= il
      if (dy >= -1e-4) { out[o] = bgB; out[o + 1] = bgG; out[o + 2] = bgR; out[o + 3] = 255; continue }
      const t0 = -ey / dy
      const x0 = ex + dx * t0, z0 = ez + dz * t0
      let r = 0, g = 0, b = 0
      if (x0 <= -1 || x0 >= 1 || z0 <= -1 || z0 >= 1) {
        const m = Math.max(Math.abs(x0), Math.abs(z0))
        if (m >= DECK) { out[o] = bgB; out[o + 1] = bgG; out[o + 2] = bgR; out[o + 3] = 255; continue }
        // Deck: dark slate tiles, a pale coping ring at the edge, fading into the terminal background.
        const face = tile(x0 + 4, z0 + 4, 0.165, 0.05)
        const coping = m < 1.07 ? 1 : 0
        const base = coping ? 0.2 : 0.032 * tileK
        const lit = (0.55 + 0.45 * sunUy) * (0.35 + 0.65 * Math.min(1, sunLum))
        r = base * lit * (0.75 + 0.25 * face); g = (base * 1.04) * lit * (0.75 + 0.25 * face); b = base * 1.12 * lit * (0.75 + 0.25 * face)
        const fade = Math.min(1, (DECK - m) / 0.16)
        const fr = tm(r), fg = tm(g), fb = tm(b)
        out[o] = Math.round(bgB + (fb - bgB) * fade); out[o + 1] = Math.round(bgG + (fg - bgG) * fade); out[o + 2] = Math.round(bgR + (fr - bgR) * fade); out[o + 3] = 255
        continue
      }
      const tw = (WL - ey) / dy
      const txw = dx > 0 ? (1 - ex) / dx : (-1 - ex) / dx
      const tzw = dz > 0 ? (1 - ez) / dz : (-1 - ez) / dz
      const tWall = txw < tzw ? txw : tzw
      const tb = ballOn ? sphereT(ex, ey, ez, dx, dy, dz) : Infinity
      if (tb < tw && tb < tWall && ey + dy * tb > WL) {
        shadeBall(ex + dx * tb, ey + dy * tb, ez + dz * tb, false)
        r = cR; g = cG; b = cB
      } else if (tWall < tw) {
        // Dry wall above the waterline.
        const px = ex + dx * tWall, py = ey + dy * tWall, pz = ez + dz * tWall
        const onX = txw < tzw
        const along = onX ? pz : px
        const face = tile(along + 4, py + 4, 0.165, 0.05)
        const wnx = onX ? -Math.sign(px) : 0, wnz = onX ? 0 : -Math.sign(pz)
        const ndl = Math.max(0, wnx * sunUx + wnz * sunUz)
        // In the rim's shadow unless the sun ray back to y=0 stays inside the opening.
        const s = -py / sunUy
        const qx = px + sunUx * s * 1.0001 + wnx * 1e-3, qz = pz + sunUz * s + wnz * 1e-3
        const lit = Math.abs(qx) < 1 && Math.abs(qz) < 1 ? ndl : 0
        const band = py > -0.06 ? 0.35 : 1
        const a = (0.55 + 0.25 * face) * tileK * band
        r = a * wlR * (amb * 3 + 0.9 * lit * sunR); g = a * wlG * (amb * 3 + 0.9 * lit * sunG); b = a * wlB * (amb * 3 + 0.9 * lit * sunB)
      } else {
        const px = ex + dx * tw, pz = ez + dz * tw
        // Surface sample.
        let fx = ((px + 1) / 2) * n - 0.5, fz = ((pz + 1) / 2) * n - 0.5
        if (fx < 0) fx = 0; else if (fx > n - 1.001) fx = n - 1.001
        if (fz < 0) fz = 0; else if (fz > n - 1.001) fz = n - 1.001
        const i0 = fx | 0, j0 = fz | 0, tx = fx - i0, tz = fz - j0, k = j0 * n + i0
        const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz
        const hh = hA[k]! * w00 + hA[k + 1]! * w10 + hA[k + n]! * w01 + hA[k + n + 1]! * w11
        const sx = gxA[k]! * w00 + gxA[k + 1]! * w10 + gxA[k + n]! * w01 + gxA[k + n + 1]! * w11
        const sz = gzA[k]! * w00 + gzA[k + 1]! * w10 + gzA[k + n]! * w01 + gzA[k + n + 1]! * w11
        let nx = -sx, ny = 1, nz = -sz
        const nl = 1 / Math.sqrt(nx * nx + 1 + nz * nz)
        nx *= nl; ny *= nl; nz *= nl
        const py = WL + hh
        const cosi = -(nx * dx + ny * dy + nz * dz)
        const fres = 0.02 + 0.98 * Math.pow(1 - Math.max(0, cosi), 5)
        // Reflection: dark sky gradient plus the sun.
        const rdx = dx + 2 * cosi * nx, rdy = dy + 2 * cosi * ny, rdz = dz + 2 * cosi * nz
        const up = rdy > 0 ? Math.sqrt(rdy) : 0
        const sd = Math.max(0, rdx * sunUx + rdy * sunUy + rdz * sunUz)
        const sd2 = sd * sd, sd4 = sd2 * sd2, sd16 = sd4 * sd4 * sd4 * sd4, sd64 = sd16 * sd16 * sd16 * sd16
        const sun = sd64 * sd64 * sd64 * sd64 * 30 + sd16 * 0.05
        let refR = hR + (zR - hR) * up + sun * sunR
        let refG = hG + (zG - hG) * up + sun * sunG
        let refB = hB + (zB - hB) * up + sun * sunB
        // Refraction into the water.
        const kk = 1 - eta * eta * (1 - cosi * cosi)
        const ss = eta * cosi - Math.sqrt(kk > 0 ? kk : 0)
        let qx = eta * dx + ss * nx, qy = eta * dy + ss * ny, qz = eta * dz + ss * nz
        const ql = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz)
        qx *= ql; qy *= ql; qz *= ql
        const ux = qx > 0 ? (1 - px) / qx : (-1 - px) / qx
        const uz = qz > 0 ? (1 - pz) / qz : (-1 - pz) / qz
        const uf = qy < 0 ? (py - floorY) / -qy : Infinity
        const ub = ballOn ? sphereT(px, py, pz, qx, qy, qz) : Infinity
        let t = ux < uz ? ux : uz
        if (uf < t) t = uf
        let wr: number, wg: number, wb: number
        if (ub < t) {
          t = ub
          shadeBall(px + qx * t, py + qy * t, pz + qz * t, true)
          wr = cR; wg = cG; wb = cB
        } else if (t === uf) {
          const hx = px + qx * t, hz = pz + qz * t
          let a: number
          if (sand) {
            // Wind-rippled sand: two crossed ridge sets with a little grain.
            const rip = Math.sin(hx * 19 + Math.sin(hz * 5.3) * 1.6) * 0.5 + Math.sin(hz * 27 - hx * 6 + Math.sin(hx * 7) * 1.2) * 0.25
            a = 0.86 + 0.09 * rip + 0.06 * (hash((hx * 500) | 0, (hz * 500) | 0) - 0.5)
          } else {
            const face = tile(hx + 4, hz + 4, 0.165, 0.045)
            a = (0.6 + 0.4 * face) * tileK
          }
          // Caustic response is superlinear (k² dominates) so focused lines read as bright, sharp filaments.
          const kr = causAt(hx, hz, cr), lr = amb + floorNdl * kr * (0.1 + 0.55 * kr) * sunR
          const kg = causAt(hx, hz, cg), lg = amb + floorNdl * kg * (0.1 + 0.55 * kg) * sunG
          const kb = causAt(hx, hz, cb), lb = amb + floorNdl * kb * (0.1 + 0.55 * kb) * sunB
          const ln = lane && Math.abs(hx) < 0.035 && Math.abs(hz) < 0.72 ? 1 : 0
          wr = (ln ? 0.06 : flR * a) * lr; wg = (ln ? 0.2 : flG * a) * lg; wb = (ln ? 0.55 : flB * a) * lb
          if (nL) { lampLight(hx, floorY, hz, 0, 1, 0); wr += flR * a * lR; wg += flG * a * lG; wb += flB * a * lB }
        } else {
          const hx = px + qx * t, hy = py + qy * t, hz = pz + qz * t
          const onX = ux < uz
          const along = onX ? hz : hx
          const face = tile(along + 4, hy + 4, 0.165, 0.045)
          const wnx = onX ? -Math.sign(hx) : 0, wnz = onX ? 0 : -Math.sign(hz)
          const ndl = Math.max(0, -(wnx * R0x + wnz * R0z))
          // Light reaching this wall point entered the surface up-sun of it; shimmer with that spot's caustics.
          const s = (WL - hy) / -R0y
          const sx2 = hx - R0x * s, sz2 = hz - R0z * s
          const inside = Math.abs(sx2) < 1 && Math.abs(sz2) < 1
          const shimmer = inside ? 0.45 + 0.55 * causAt(sx2 * 0.96, sz2 * 0.96, cg) : 0
          const a = (0.58 + 0.3 * face) * tileK
          const l = amb * 2 + 1.1 * ndl * shimmer
          wr = a * wlR * (amb * 2 + 1.1 * ndl * shimmer * sunR); wg = a * wlG * (amb * 2 + 1.1 * ndl * shimmer * sunG); wb = a * wlB * (amb * 2 + 1.1 * ndl * shimmer * sunB)
          void l
          if (nL) {
            lampLight(hx, hy, hz, wnx, 0, wnz)
            wr += a * wlR * lR; wg += a * wlG * lG; wb += a * wlB * lB
            // The lamp lenses themselves.
            for (let i = 0; i < nL; i++) {
              const Lp = lamps[i]!
              const dd = Math.hypot(hx - Lp.x, hy - Lp.y, hz - Lp.z)
              if (dd < 0.075) { const e = 7 * (1 - (dd / 0.075) ** 4); wr += Lp.c[0] * e; wg += Lp.c[1] * e; wb += Lp.c[2] * e }
            }
          }
        }
        const er = Math.exp(-aR * t), eg = Math.exp(-aG * t), eb = Math.exp(-aB * t)
        wr = wr * er + sR * (1 - eg); wg = wg * eg + sG * (1 - eg); wb = wb * eb + sB * (1 - eg)
        if (shafts) {
          // Light shafts: march the underwater ray, look up the floor caustic each sample's sun ray would land on.
          let acc = 0
          const K = 6
          for (let s = 0; s < K; s++) {
            const ts = ((s + 0.5) / K) * t
            const sy = py + qy * ts
            const f = (sy - floorY) / -R0y
            const fxp = px + qx * ts + R0x * f, fzp = pz + qz * ts + R0z * f
            const depthFrac = (WL - sy) / (WL + D)
            const c = fxp > -1 && fxp < 1 && fzp > -1 && fzp < 1 ? causAt(fxp, fzp, cg) : 0
            // Only focused light (c above the mean) makes a visible shaft; uniform light would just veil the floor.
            acc += (c > 0.8 ? c - 0.8 : 0) * Math.min(1, depthFrac * 1.6) * Math.exp(-0.9 * ts)
          }
          // Henyey–Greenstein, g = 0.55, relative to isotropic.
          const ct = qx * R0x + qy * R0y + qz * R0z
          const g2 = 0.3025
          const hg = (1 - g2) / Math.pow(1 + g2 - 1.1 * ct, 1.5)
          const amt = (acc / K) * t * hg * 0.11 * F.shaftGain
          // Scattered light is tinted by absorption along a typical path: half the view ray plus the sun ray down to it.
          const path = 0.5 * t + (0.5 * (WL + D)) / -R0y
          wr += amt * sunR * Math.exp(-aR * path); wg += amt * sunG * Math.exp(-aG * path); wb += amt * sunB * Math.exp(-aB * path)
        }
        if (nL) {
          // Lamp glow: in-scatter along the underwater ray, evaluated at its closest approach to each lamp.
          for (let i = 0; i < nL; i++) {
            const Lp = lamps[i]!
            const ox = Lp.x - px, oy = Lp.y - py, oz = Lp.z - pz
            let tc = ox * qx + oy * qy + oz * qz
            tc = tc < 0 ? 0 : tc > t ? t : tc
            const cx = ox - qx * tc, cy = oy - qy * tc, cz = oz - qz * tc
            const g = (0.018 * LK.lamps) / (0.012 + cx * cx + cy * cy + cz * cz) * Math.exp(-0.8 * tc)
            wr += Lp.c[0] * g * 0.35; wg += Lp.c[1] * g; wb += Lp.c[2] * g
          }
        }
        const T = 1 - fres
        r = wr * T + refR * fres; g = wg * T + refG * fres; b = wb * T + refB * fres
      }
      out[o] = tm(b); out[o + 1] = tm(g); out[o + 2] = tm(r); out[o + 3] = 255
    }
  }
}
