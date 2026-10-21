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
export interface Viewmodel { img: Sprite; ox: number; oy: number; scale: number; flash: number }

const FOG = [10, 12, 16]
const FOG_FAR = 15

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

  render(l: Level, mats: Texture[], cam: Cam, sprites: SpriteDraw[], dyn: DynLight[], vm: Viewmodel | null, tint: [number, number, number, number] | null) {
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
      const lx = Math.min(LW - 1, Math.max(0, Math.floor(hx * LMR))), ly = Math.min(LH - 1, Math.max(0, Math.floor(hy * LMR)))
      const li = (ly * LW + lx) * 3
      const shadeSide = side === 1 ? 0.82 : 1
      let lr = lm[li]! * shadeSide, lg = lm[li + 1]! * shadeSide, lb = lm[li + 2]! * shadeSide
      for (let k = 0; k < nd; k++) {
        const L = dyn[k]!
        const dd = Math.hypot(hx - L.x, hy - L.y)
        if (dd < L.radius) { const a = (1 - dd / L.radius) ** 2 * 2; lr += L.r * a; lg += L.g * a; lb += L.b * a }
      }
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
      const lx = Math.min(LW - 1, Math.max(0, Math.floor(s.x * LMR))), ly = Math.min(LH - 1, Math.max(0, Math.floor(s.y * LMR)))
      const li = (ly * LW + lx) * 3
      let lr = lm[li]! + 0.15, lg = lm[li + 1]! + 0.15, lb = lm[li + 2]! + 0.15
      for (let k = 0; k < nd; k++) {
        const L = dyn[k]!
        const dd = Math.hypot(s.x - L.x, s.y - L.y)
        if (dd < L.radius) { const a = (1 - dd / L.radius) ** 2 * 2; lr += L.r * a; lg += L.g * a; lb += L.b * a }
      }
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
          r = r * nf + fr; g = g * nf + fg; b = b * nf + fb
          u32[y * W + x] = 0xff000000 | ((r > 255 ? 255 : r) << 16) | ((g > 255 ? 255 : g) << 8) | (b > 255 ? 255 : b)
        }
      }
    }
    // Viewmodel (no depth test), lit by the light at the player.
    if (vm) {
      const lx = Math.min(LW - 1, Math.max(0, Math.floor(cam.x * LMR))), ly = Math.min(LH - 1, Math.max(0, Math.floor(cam.y * LMR)))
      const li = (ly * LW + lx) * 3
      const lr = Math.min(1.6, lm[li]! + 0.35 + vm.flash), lg = Math.min(1.6, lm[li + 1]! + 0.35 + vm.flash * 0.8), lb = Math.min(1.6, lm[li + 2]! + 0.35 + vm.flash * 0.5)
      const h = Math.round(H * vm.scale), w = Math.round((h * vm.img.w) / vm.img.h)
      const ox = Math.round(W / 2 - w / 2 + vm.ox * H), oy = Math.round(H - h + vm.oy * H)
      const img = vm.img
      for (let y = Math.max(0, oy); y < Math.min(H, oy + h); y++) {
        const iy = Math.floor(((y - oy) / h) * img.h)
        for (let x = Math.max(0, ox); x < Math.min(W, ox + w); x++) {
          const p = img.px[iy * img.w + Math.floor(((x - ox) / w) * img.w)]!
          const a = p >>> 24
          if (a === 0) continue
          let r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255
          if (a === 255) { r *= lr; g *= lg; b *= lb }
          u32[y * W + x] = 0xff000000 | ((r > 255 ? 255 : r) << 16) | ((g > 255 ? 255 : g) << 8) | (b > 255 ? 255 : b)
        }
      }
    }
    if (this.bloom) this.applyBloom()
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
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = -2; k <= 2; k++) { const xx = x + k; if (xx < 0 || xx >= bw) continue; const i = (y * bw + xx) * 3; r += bb[i]!; g += bb[i + 1]!; b += bb[i + 2]!; n++ }
        const o = (y * bw + x) * 3; bt[o] = r / n; bt[o + 1] = g / n; bt[o + 2] = b / n
      }
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        let r = 0, g = 0, b = 0, n = 0
        for (let k = -2; k <= 2; k++) { const yy = y + k; if (yy < 0 || yy >= bh) continue; const i = (yy * bw + x) * 3; r += bt[i]!; g += bt[i + 1]!; b += bt[i + 2]!; n++ }
        const o = (y * bw + x) * 3; bb[o] = r / n; bb[o + 1] = g / n; bb[o + 2] = b / n
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
