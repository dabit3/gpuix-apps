// CPU raycaster: textured walls + doors (DDA), perspective floor/ceiling casting, baked lightmap + dynamic
// point lights, fog, depth-sorted billboard sprites with hit-flash and dissolve, viewmodel and a cheap bloom.
// Output is BGRA (GPUI's native order) so the <img> upload skips a swizzle.
import { EMPTY, LMR, MH, MW, type Level } from '../gen/level'
import { M } from '../gen/materials'
import type { Texture } from '../gen/texops'

export interface Sprite { w: number; h: number; px: Uint32Array } // alpha 255 = lit, 1..254 = emissive, 0 = clear
export interface Cam { x: number; y: number; angle: number; z: number; pitch: number }
export interface SpriteDraw { x: number; y: number; z0: number; z1: number; w: number; img: Sprite; flash: number; dissolve: number }
export interface DynLight { x: number; y: number; r: number; g: number; b: number; radius: number }
export interface Viewmodel { img: Sprite; ox: number; oy: number; scale: number; flash: number; muzzle?: Sprite; tip?: number[] }
export interface Seg { ax: number; ay: number; az: number; bx: number; by: number; bz: number } // tail → head

const FOG = [10, 12, 16]
const FOG_FAR = 15
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const pack = (r: number, g: number, b: number) => 0xff000000 | ((r > 255 ? 255 : r) << 16) | ((g > 255 ? 255 : g) << 8) | (b > 255 ? 255 : b)

export class Renderer {
  W = 0; H = 0
  buf = new Uint8Array(0)
  u32 = new Uint32Array(0)
  zbuf = new Float32Array(0)
  top = new Int32Array(0)
  bot = new Int32Array(0)
  bloom = true
  stats = { ms: 0 }
  private bw = 0; private bh = 0
  private bb = new Float32Array(0); private bt = new Float32Array(0)

  resize(w: number, h: number) {
    w = Math.max(32, w | 0); h = Math.max(24, h | 0)
    if (w === this.W && h === this.H) return
    this.W = w; this.H = h
    this.buf = new Uint8Array(w * h * 4)
    this.u32 = new Uint32Array(this.buf.buffer)
    this.zbuf = new Float32Array(w); this.top = new Int32Array(w); this.bot = new Int32Array(w)
    this.bw = Math.max(1, w >> 2); this.bh = Math.max(1, h >> 2)
    this.bb = new Float32Array(this.bw * this.bh * 3); this.bt = new Float32Array(this.bw * this.bh * 3)
  }

  render(l: Level, mats: Texture[], cam: Cam, sprites: SpriteDraw[], dyn: DynLight[], vm: Viewmodel | null, tint: [number, number, number, number] | null, tr: Seg[] = []) {
    const t0 = performance.now()
    const { W, H, u32, zbuf, top, bot } = this
    const f = H * 0.95
    const hor = H / 2 + cam.pitch * H
    const dx = Math.cos(cam.angle), dy = Math.sin(cam.angle)
    const pl = W / (2 * f)
    const plx = -dy * pl, ply = dx * pl
    const z = cam.z
    const lm = l.lightmap, LW = MW * LMR, LH = MH * LMR
    const nd = dyn.length
    const lmi = (x: number, y: number) => (Math.min(LH - 1, Math.max(0, Math.floor(y * LMR))) * LW + Math.min(LW - 1, Math.max(0, Math.floor(x * LMR)))) * 3
    const lit = (x: number, y: number, r: number, g: number, b: number) => {
      for (const L of dyn) { const d = Math.hypot(x - L.x, y - L.y); if (d < L.radius) { const a = (1 - d / L.radius) ** 2 * 2; r += L.r * a; g += L.g * a; b += L.b * a } }
      return [r, g, b] as const
    }
    // Walls.
    for (let x = 0; x < W; x++) {
      const c = (2 * (x + 0.5)) / W - 1
      const rdx = dx + plx * c, rdy = dy + ply * c
      let mx = Math.floor(cam.x), my = Math.floor(cam.y)
      const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx), ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy)
      const sx = rdx < 0 ? -1 : 1, sy = rdy < 0 ? -1 : 1
      let sdx = rdx < 0 ? (cam.x - mx) * ddx : (mx + 1 - cam.x) * ddx
      let sdy = rdy < 0 ? (cam.y - my) * ddy : (my + 1 - cam.y) * ddy
      let side = 0, perp = 30, mat: number = M.concrete, u = 0, hit = false
      for (let n = 0; n < 96 && !hit; n++) {
        if (sdx < sdy) { sdx += ddx; mx += sx; side = 0 } else { sdy += ddy; my += sy; side = 1 }
        if (mx < 0 || my < 0 || mx >= MW || my >= MH) { perp = side === 0 ? sdx - ddx : sdy - ddy; break }
        const i = my * MW + mx
        const v = l.cells[i]!
        if (v === EMPTY) continue
        const di = l.doorAt[i]!
        if (di >= 0) {
          const d = l.doors[di]!
          let t: number, along: number
          if (d.vertical) { t = (mx + 0.5 - cam.x) / rdx; along = cam.y + t * rdy - my }
          else { t = (my + 0.5 - cam.y) / rdy; along = cam.x + t * rdx - mx }
          if (t > 0 && along >= 0 && along < 1 && along < 1 - d.open) {
            perp = t; mat = v; u = along + d.open; side = d.vertical ? 0 : 1; hit = true
          }
          continue
        }
        perp = side === 0 ? sdx - ddx : sdy - ddy
        u = side === 0 ? cam.y + perp * rdy : cam.x + perp * rdx
        u -= Math.floor(u)
        if ((side === 0 && rdx < 0) || (side === 1 && rdy > 0)) u = 1 - u
        mat = v; hit = true
      }
      if (perp < 0.02) perp = 0.02
      zbuf[x] = perp
      const yt = hor - ((1 - z) * f) / perp, yb = hor + (z * f) / perp
      const y0 = Math.max(0, Math.ceil(yt)), y1 = Math.min(H, Math.ceil(yb))
      top[x] = y0; bot[x] = y1
      // Light at the hit point, nudged back toward the camera so it samples the open cell in front of the face.
      const hx = cam.x + rdx * perp * 0.995, hy = cam.y + rdy * perp * 0.995
      const li = lmi(hx, hy)
      const shadeSide = side === 1 ? 0.82 : 1
      const [lr, lg, lb] = lit(hx, hy, lm[li]! * shadeSide, lm[li + 1]! * shadeSide, lm[li + 2]! * shadeSide)
      const fog = Math.min(1, perp / FOG_FAR) ** 1.4
      const tex = mats[mat]!, ts = tex.size, tm = ts - 1
      const tx = Math.min(tm, Math.floor(u * ts))
      const vstep = ts / (yb - yt)
      let tv = (y0 - yt) * vstep
      const kr = (1 - fog) * lr, kg = (1 - fog) * lg, kb = (1 - fog) * lb
      const fr = fog * FOG[0]!, fg = fog * FOG[1]!, fb = fog * FOG[2]!
      const px = tex.px, em = tex.emis
      for (let y = y0; y < y1; y++) {
        const ti = (Math.min(tm, tv | 0) * ts + tx)
        const p = px[ti]!
        let r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255
        const e = em[ti]!
        if (e) {
          const ef = e / 255
          r = r * ((1 - ef) * kr + ef * 1.4 * (1 - fog)) + fr; g = g * ((1 - ef) * kg + ef * 1.4 * (1 - fog)) + fg; b = b * ((1 - ef) * kb + ef * 1.4 * (1 - fog)) + fb
        } else { r = r * kr + fr; g = g * kg + fg; b = b * kb + fb }
        u32[y * W + x] = 0xff000000 | ((r > 255 ? 255 : r) << 16) | ((g > 255 ? 255 : g) << 8) | (b > 255 ? 255 : b)
        tv += vstep
      }
    }
    // Floor and ceiling.
    const fl = mats[M.floor]!, ce = mats[M.ceil]!
    const ts = fl.size, tm = ts - 1
    for (let y = 0; y < H; y++) {
      const floor = y + 0.5 > hor
      const rowDist = floor ? (z * f) / (y + 0.5 - hor) : ((1 - z) * f) / (hor - y - 0.5)
      if (!(rowDist > 0) || rowDist > 60) { for (let x = 0; x < W; x++) if (floor ? y >= bot[x]! : y < top[x]!) u32[y * W + x] = 0xff0a0c10; continue }
      let wx = cam.x + rowDist * (dx - plx), wy = cam.y + rowDist * (dy - ply)
      const stx = (rowDist * 2 * plx) / W, sty = (rowDist * 2 * ply) / W
      wx += stx * 0.5; wy += sty * 0.5
      const fog = Math.min(1, rowDist / FOG_FAR) ** 1.4
      const nf = 1 - fog, fr = fog * FOG[0]!, fg = fog * FOG[1]!, fb = fog * FOG[2]!
      const tex = floor ? fl : ce
      const px = tex.px, em = tex.emis
      const dim = floor ? nf : nf * 0.7
      for (let x = 0; x < W; x++, wx += stx, wy += sty) {
        if (floor ? y < bot[x]! : y >= top[x]!) continue
        const ti = ((wy * ts) & tm) * ts + ((wx * ts) & tm)
        const p = px[ti]!
        let lx = (wx * LMR) | 0, ly = (wy * LMR) | 0
        if (lx < 0) lx = 0; else if (lx >= LW) lx = LW - 1
        if (ly < 0) ly = 0; else if (ly >= LH) ly = LH - 1
        const li = (ly * LW + lx) * 3
        let lr = lm[li]!, lg = lm[li + 1]!, lb = lm[li + 2]!
        for (let k = 0; k < nd; k++) {
          const L = dyn[k]!
          const ex = wx - L.x, ey = wy - L.y, d2 = ex * ex + ey * ey
          if (d2 < L.radius * L.radius) { const a = (1 - Math.sqrt(d2) / L.radius) ** 2 * 2; lr += L.r * a; lg += L.g * a; lb += L.b * a }
        }
        const e = em[ti]!
        if (e) { const ef = e / 255; lr = lr * (1 - ef) + ef * 1.5; lg = lg * (1 - ef) + ef * 1.5; lb = lb * (1 - ef) + ef * 1.5 }
        let r = ((p >> 16) & 255) * lr * dim + fr, g = ((p >> 8) & 255) * lg * dim + fg, b = (p & 255) * lb * dim + fb
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255
        u32[y * W + x] = 0xff000000 | (r << 16) | (g << 8) | b
      }
    }
    // Sprites, far to near.
    const inv = 1 / (plx * dy - dx * ply)
    const order = sprites.map((s) => ({ s, d: (s.x - cam.x) * dx + (s.y - cam.y) * dy })).filter((o) => o.d > 0.15).sort((a, b) => b.d - a.d)
    for (const { s } of order) {
      const rx = s.x - cam.x, ry = s.y - cam.y
      const tX = inv * (dy * rx - dx * ry), tY = inv * (-ply * rx + plx * ry)
      if (tY <= 0.15) continue
      const scx = (W / 2) * (1 + tX / tY)
      const sw = (s.w * f) / tY
      const sTop = hor - ((s.z1 - z) * f) / tY, sBot = hor - ((s.z0 - z) * f) / tY
      const x0 = Math.max(0, Math.floor(scx - sw / 2)), x1 = Math.min(W, Math.ceil(scx + sw / 2))
      const y0 = Math.max(0, Math.floor(sTop)), y1 = Math.min(H, Math.ceil(sBot))
      if (x0 >= x1 || y0 >= y1) continue
      const li = lmi(s.x, s.y)
      const [cr, cg, cb] = lit(s.x, s.y, lm[li]! + 0.15, lm[li + 1]! + 0.15, lm[li + 2]! + 0.15)
      const L = (cr + cg + cb) / 3, sat = (c: number) => Math.min(1.3, L + (c - L) * 0.35), lr = sat(cr), lg = sat(cg), lb = sat(cb)
      const fog = Math.min(1, tY / FOG_FAR) ** 1.4, nf = 1 - fog
      const fr = fog * FOG[0]!, fg = fog * FOG[1]!, fb = fog * FOG[2]!
      const img = s.img, iw = img.w, ih = img.h
      const fl2 = s.flash
      for (let x = x0; x < x1; x++) {
        if (tY >= zbuf[x]!) continue
        const ix = Math.min(iw - 1, Math.floor(((x + 0.5 - (scx - sw / 2)) / sw) * iw))
        for (let y = y0; y < y1; y++) {
          const iy = Math.min(ih - 1, Math.floor(((y + 0.5 - sTop) / (sBot - sTop)) * ih))
          const p = img.px[iy * iw + ix]!
          const a = p >>> 24
          if (a === 0) continue
          let r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255
          if (s.dissolve > 0) {
            const hsh = ((ix * 73856093) ^ (iy * 19349663)) >>> 0
            const th = (hsh % 1000) / 1000
            if (th < s.dissolve) continue
            if (th < s.dissolve + 0.08) { r = 255; g = 160; b = 60 }
          }
          if (a === 255) { r *= lr; g *= lg; b *= lb }
          if (fl2 > 0) { r += (255 - r) * fl2; g += (255 - g) * fl2; b += (255 - b) * fl2 }
          u32[y * W + x] = pack(r * nf + fr, g * nf + fg, b * nf + fb)
        }
      }
    }
    // Bullet tracers: projected world segments, depth-tested per column, brightening toward the head.
    const add = (x: number, y: number, k: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return
      const i = y * W + x, p = u32[i]!
      u32[i] = pack(((p >> 16) & 255) + 255 * k, ((p >> 8) & 255) + 228 * k, (p & 255) + 160 * k)
    }
    const depth = (x: number, y: number) => inv * (-ply * (x - cam.x) + plx * (y - cam.y))
    for (const g of tr) {
      let { ax, ay, az, bx, by, bz } = g
      let da = depth(ax, ay), db = depth(bx, by)
      if (da < 0.12 && db < 0.12) continue
      if (da < 0.12) { const k = (0.12 - da) / (db - da); ax += (bx - ax) * k; ay += (by - ay) * k; az += (bz - az) * k; da = 0.12 }
      if (db < 0.12) { const k = (0.12 - db) / (da - db); bx += (ax - bx) * k; by += (ay - by) * k; bz += (az - bz) * k; db = 0.12 }
      const x0 = (W / 2) * (1 + inv * (dy * (ax - cam.x) - dx * (ay - cam.y)) / da), y0 = hor - ((az - z) * f) / da
      const x1 = (W / 2) * (1 + inv * (dy * (bx - cam.x) - dx * (by - cam.y)) / db), y1 = hor - ((bz - z) * f) / db
      const n = Math.min(2000, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1)
      for (let i = 0; i <= n; i++) {
        const u = i / n, d = 1 / ((1 - u) / da + u / db), x = Math.round(x0 + (x1 - x0) * u), y = Math.round(y0 + (y1 - y0) * u)
        if (x < 0 || x >= W || d > zbuf[x]! + 0.05) continue
        const k = (0.2 + 0.8 * u * u) * (1 - Math.min(1, d / FOG_FAR) * 0.5)
        add(x, y, k); add(x + 1, y, k); add(x, y + 1, k * 0.8)
        for (const [ox, oy] of NB) add(x + ox! * 2, y + oy! * 2, k * 0.3)
      }
    }
    // Viewmodel (no depth test), lit by the light at the player.
    if (vm) {
      const li = lmi(cam.x, cam.y)
      const lr = Math.min(1.6, lm[li]! + 0.35 + vm.flash), lg = Math.min(1.6, lm[li + 1]! + 0.35 + vm.flash * 0.8), lb = Math.min(1.6, lm[li + 2]! + 0.35 + vm.flash * 0.5)
      const h = Math.round(H * vm.scale), w = Math.round((h * vm.img.w) / vm.img.h)
      const ox = Math.round(W / 2 - w / 2 + vm.ox * H), oy = Math.round(H - h + vm.oy * H)
      // Additive when k > 0 (muzzle flare), otherwise lit by the light at the player.
      const blit = (img: Sprite, x0: number, y0: number, w: number, h: number, k: number) => {
        for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
          const p = img.px[Math.floor(((y - y0) / h) * img.h) * img.w + Math.floor(((x - x0) / w) * img.w)]!, a = p >>> 24
          if (!a) continue
          let r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255
          if (k) { const q = u32[y * W + x]!; r = ((q >> 16) & 255) + r * k; g = ((q >> 8) & 255) + g * k; b = (q & 255) + b * k }
          else if (a === 255) { r *= lr; g *= lg; b *= lb }
          u32[y * W + x] = pack(r, g, b)
        }
      }
      blit(vm.img, ox, oy, w, h, 0)
      const mz = vm.muzzle, tip = vm.tip
      if (mz && tip && vm.flash > 0.05) {
        const ms = Math.round(h * 0.42 * (0.55 + 0.45 * vm.flash))
        blit(mz, Math.round(ox + tip[0]! * w - ms / 2), Math.round(oy + tip[1]! * h - ms / 2), ms, ms, vm.flash)
      }
    }
    if (this.bloom) this.applyBloom()
    this.vignette()
    if (tint && tint[3] > 0) {
      const [tr, tg, tb, ta] = tint
      for (let i = 0; i < W * H; i++) {
        const p = u32[i]!
        const r = ((p >> 16) & 255) * (1 - ta) + tr * ta, g = ((p >> 8) & 255) * (1 - ta) + tg * ta, b = (p & 255) * (1 - ta) + tb * ta
        u32[i] = 0xff000000 | (r << 16) | (g << 8) | b
      }
    }
    this.stats.ms = performance.now() - t0
  }

  private vr = new Float32Array(0)
  private vc = new Float32Array(0)
  // Darkens the top and bottom bands so the HUD text stays readable over bright ceiling lights.
  private vignette() {
    const { W, H, u32 } = this
    if (this.vr.length !== H || this.vc.length !== W) {
      this.vr = new Float32Array(H); this.vc = new Float32Array(W)
      for (let y = 0; y < H; y++) { const t = y / H, a = Math.min(1, t / 0.16), b = Math.min(1, (1 - t) / 0.14); this.vr[y] = (0.42 + 0.58 * a * a * (3 - 2 * a)) * (0.55 + 0.45 * b * b * (3 - 2 * b)) }
      for (let x = 0; x < W; x++) { const t = Math.min(x, W - 1 - x) / W, a = Math.min(1, t / 0.12); this.vc[x] = 0.78 + 0.22 * a }
    }
    for (let y = 0; y < H; y++) {
      const fy = this.vr[y]!
      for (let x = 0, i = y * W; x < W; x++, i++) {
        const f = fy * this.vc[x]!
        if (f > 0.995) continue
        const p = u32[i]!
        u32[i] = 0xff000000 | ((((p >> 16) & 255) * f) << 16) | ((((p >> 8) & 255) * f) << 8) | ((p & 255) * f)
      }
    }
  }

  // Bright-pass at quarter resolution, two box blurs, bilinear add back.
  private applyBloom() {
    const { W, H, u32, bw, bh, bb, bt } = this
    bb.fill(0)
    for (let y = 0; y < bh * 4 && y < H; y++) {
      const by = y >> 2
      for (let x = 0; x < bw * 4 && x < W; x++) {
        const p = u32[y * W + x]!
        const r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255
        const lum = r * 0.3 + g * 0.55 + b * 0.15
        if (lum < 150) continue
        const k = (lum - 150) / 105 / 16
        const i = (by * bw + (x >> 2)) * 3
        bb[i] += r * k; bb[i + 1] += g * k; bb[i + 2] += b * k
      }
    }
    // Two separable 5-tap box blurs: even passes horizontal bb → bt, odd passes vertical bt → bb.
    for (let pass = 0; pass < 4; pass++) {
      const v = pass & 1, src = v ? bt : bb, dst = v ? bb : bt
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = -2; k <= 2; k++) {
          const xx = v ? x : x + k, yy = v ? y + k : y
          if (xx < 0 || xx >= bw || yy < 0 || yy >= bh) continue
          const i = (yy * bw + xx) * 3; r += src[i]!; g += src[i + 1]!; b += src[i + 2]!; n++
        }
        const o = (y * bw + x) * 3; dst[o] = r / n; dst[o + 1] = g / n; dst[o + 2] = b / n
      }
    }
    const S = 1.6
    for (let y = 0; y < H; y++) {
      const fy = Math.min(bh - 1.001, Math.max(0, y / 4 - 0.5)), y0 = fy | 0, ay = fy - y0, y1 = Math.min(bh - 1, y0 + 1)
      for (let x = 0; x < W; x++) {
        const fx = Math.min(bw - 1.001, Math.max(0, x / 4 - 0.5)), x0 = fx | 0, ax = fx - x0, x1 = Math.min(bw - 1, x0 + 1)
        const i00 = (y0 * bw + x0) * 3, i01 = (y0 * bw + x1) * 3, i10 = (y1 * bw + x0) * 3, i11 = (y1 * bw + x1) * 3
        const w00 = (1 - ax) * (1 - ay), w01 = ax * (1 - ay), w10 = (1 - ax) * ay, w11 = ax * ay
        const br = (bb[i00]! * w00 + bb[i01]! * w01 + bb[i10]! * w10 + bb[i11]! * w11) * S
        if (br < 0.5) { const bg0 = bb[i00 + 1]! * w00 + bb[i01 + 1]! * w01 + bb[i10 + 1]! * w10 + bb[i11 + 1]! * w11; if (bg0 * S < 0.5) continue }
        const bg = (bb[i00 + 1]! * w00 + bb[i01 + 1]! * w01 + bb[i10 + 1]! * w10 + bb[i11 + 1]! * w11) * S
        const bl = (bb[i00 + 2]! * w00 + bb[i01 + 2]! * w01 + bb[i10 + 2]! * w10 + bb[i11 + 2]! * w11) * S
        const p = u32[y * W + x]!
        let r = ((p >> 16) & 255) + br, g = ((p >> 8) & 255) + bg, b = (p & 255) + bl
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255
        u32[y * W + x] = 0xff000000 | (r << 16) | (g << 8) | b
      }
    }
  }
}
