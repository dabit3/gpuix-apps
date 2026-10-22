// Doom-style monsters, the status-bar face and props, drawn at boot from a posed skeleton: tapered capsules
// and ellipses with N·L shading, skin texture detail and a dark outline. No image files.
// Monster frames: 0-3 walk, 4 aim/wind-up, 5 fire/strike, 6 pain, 7-11 death (11 = corpse), 12-15 gib (15 = gore pile).
import type { Sprite } from '../engine/raycast'
import type { Texture } from './texops'
import { clamp, hash2 } from './rng'

export type MonsterKind = 'trooper' | 'imp' | 'brute'

class Img implements Sprite {
  px: Uint32Array
  constructor(public w = 96, public h = w) { this.px = new Uint32Array(w * h) }
  put(x: number, y: number, c: number, a = 255) {
    x |= 0; y |= 0
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = ((a << 24) | (c & 0xffffff)) >>> 0
  }
  lit(x: number, y: number, c: number, nx: number, ny: number, nz: number, tex?: Texture) {
    const l = clamp(-nx * 0.5 - ny * 0.6 + nz * 0.75, 0.14, 1.25) + Math.max(0, nz - 0.9) * 0.6
    let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255
    if (tex) { const p = tex.px[((y * 2) & (tex.size - 1)) * tex.size + ((x * 2) & (tex.size - 1))]!, q = ((p >> 16 & 255) + (p >> 8 & 255) + (p & 255)) / 384; r *= 0.7 + q * 0.6; g *= 0.7 + q * 0.6; b *= 0.7 + q * 0.6 }
    this.put(x, y, (clamp(r * l, 0, 255) << 16) | (clamp(g * l, 0, 255) << 8) | clamp(b * l, 0, 255))
  }
  // Tapered capsule, cylinder-shaded across its width.
  limb(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, c: number, tex?: Texture) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1, R = Math.max(r0, r1)
    for (let y = Math.floor(Math.min(y0, y1) - R); y <= Math.max(y0, y1) + R; y++) for (let x = Math.floor(Math.min(x0, x1) - R); x <= Math.max(x0, x1) + R; x++) {
      const t = clamp(((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / L2, 0, 1), r = r0 + (r1 - r0) * t
      const ox = (x + 0.5 - x0 - dx * t) / r, oy = (y + 0.5 - y0 - dy * t) / r, d = ox * ox + oy * oy
      if (d <= 1) this.lit(x, y, c, ox, oy, Math.sqrt(1 - d), tex)
    }
  }
  ball(cx: number, cy: number, rx: number, ry: number, c: number, tex?: Texture) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, d = nx * nx + ny * ny
      if (d <= 1) this.lit(x, y, c, nx, ny, Math.sqrt(1 - d), tex)
    }
  }
  glow(cx: number, cy: number, r: number, c: number) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
      if (d > 1) continue
      const k = (1 - d) ** 1.4, w = k > 0.6 ? 0xfff6d8 : c
      this.put(x, y, (clamp(((w >> 16) & 255) * (0.5 + k), 0, 255) << 16) | (clamp(((w >> 8) & 255) * (0.5 + k), 0, 255) << 8) | clamp((w & 255) * (0.5 + k), 0, 255), 200)
    }
  }
  outline() {
    const o = this.px.slice(), W = this.w
    for (let y = 0; y < this.h; y++) for (let x = 0; x < W; x++) {
      if (o[y * W + x]) continue
      const s = (i: number) => (o[i]! >>> 24) === 255
      if ((x > 0 && s(y * W + x - 1)) || (x < W - 1 && s(y * W + x + 1)) || (y > 0 && s(y * W + x - W)) || (y < this.h - 1 && s(y * W + x + W))) this.put(x, y, 0x0c0808)
    }
  }
}

const PAL = {
  trooper: { skin: 0x8f8a6c, cloth: 0x56623a, dark: 0x2c3122, eye: 0xff3a20 },
  imp: { skin: 0x8e5634, cloth: 0x7a462a, dark: 0x3a1e12, eye: 0xffb020 },
  brute: { skin: 0xc27a72, cloth: 0xa45e58, dark: 0x4a2020, eye: 0xffe040 },
}
const BONE = 0xd8ccaa, BLOOD = 0x8a1010

// mode: 0 walk, 1 aim, 2 fire, 3 pain.
function body(c: Img, kind: MonsterKind, mode: number, ph: number, tex: Texture) {
  const B = kind === 'brute', I = kind === 'imp', P = PAL[kind], W = B ? 1.4 : 1
  const hipY = B ? 64 : 60, neckY = B ? 38 : 32, cx = 48, lean = mode === 3 ? 3 : 0
  const limbC = I || B ? P.skin : P.cloth
  for (const sd of [-1, 1]) {
    const s = mode ? 0 : Math.sin(ph + (sd > 0 ? Math.PI : 0)), lift = Math.max(0, s)
    const hx = cx + sd * 6 * W, kx = hx + sd * (2 + W), ky = (hipY + 90) / 2 - lift * 5, fx = hx + sd * 3 * W + s, fy = 90 - lift * 4
    c.limb(hx, hipY, kx, ky, 5 * W, 4 * W, limbC, tex)
    c.limb(kx, ky, fx, fy - 2, 4 * W, 3 * W, limbC, tex)
    if (I || B) for (const t of [-2, 0, 2]) c.limb(fx + t * W, fy - 1, fx + t * 1.6 * W, fy + 1, 1.3, 0.5, BONE)
    else c.ball(fx, fy - 1, 4.5, 2.6, P.dark)
  }
  c.ball(cx + lean * 0.3, hipY, 9 * W, 5, P.dark)
  const ty = (hipY + neckY) / 2 + 1
  c.ball(cx + lean * 0.6, ty, 11 * W, (hipY - neckY) / 2 + 3, B ? P.skin : P.cloth, tex)
  if (B) { c.ball(cx, ty + 5, 9 * W, 8, 0xd49088, tex); for (const sd of [-1, 1]) c.ball(cx + sd * 6, neckY + 6, 7, 5, P.skin, tex) }
  else if (I) { for (let k = 0; k < 3; k++) c.limb(cx - 6, ty - 4 + k * 4, cx + 6, ty - 4 + k * 4, 0.9, 0.9, P.dark); c.ball(cx, ty - 2, 6, 7, P.skin, tex) }
  else { c.ball(cx + lean * 0.6, ty - 2, 9, 10, P.dark); c.limb(cx - 10, hipY - 5, cx + 10, hipY - 5, 1.6, 1.6, 0x4a3420); c.ball(cx + 4, ty - 6, 2, 2.5, 0x6a6a52) }
  // Arms.
  const hand: [number, number][] = []
  for (const sd of [-1, 1]) {
    const sx = cx + sd * 11 * W + lean, sy = neckY + 4, s = mode ? 0 : Math.sin(ph + (sd > 0 ? 0 : Math.PI))
    let ex = sx + sd * 3 * W, ey = sy + 12 + s * 2, hx = sx + sd * 2 * W, hy = sy + 24 + s * 4
    if (mode === 3) { ex = sx + sd * 8; ey = sy - 2; hx = sx + sd * 12; hy = sy - 12 }
    else if (mode && kind === 'trooper') { ex = sx + sd * 2; ey = sy + 11; hx = cx + sd * 4; hy = sy + 12 }
    else if (mode && I && sd > 0) { if (mode === 1) { ex = sx + 6; ey = sy - 8; hx = sx + 4; hy = sy - 20 } else { ex = sx + 1; ey = sy + 7; hx = cx + 7; hy = sy + 9 } }
    else if (mode && B) { ex = sx + sd * 7; ey = sy + (mode === 2 ? 4 : 8); hx = sx + sd * (mode === 2 ? 2 : 9); hy = sy + (mode === 2 ? 12 : 18) }
    c.limb(sx, sy, ex, ey, 4.3 * W, 3.4 * W, limbC, tex)
    c.limb(ex, ey, hx, hy, 3.4 * W, 2.8 * W, P.skin, tex)
    c.ball(hx, hy, 3 * W, 3 * W, P.skin, tex)
    if (I || B) for (const t of [-1.5, 0, 1.5]) c.limb(hx + t, hy + 2, hx + t * 1.6, hy + 5, 0.9, 0.3, BONE)
    if (I) c.limb(sx, sy - 3, sx + sd * 3, sy - 9, 1.6, 0.3, BONE)
    hand.push([hx, hy])
  }
  // Heads.
  const hx = cx + lean * 1.5, open = mode === 1 || mode === 2
  if (B) {
    c.ball(hx, neckY, 11, 9, P.skin, tex)
    c.ball(hx, neckY + 4, 8, open ? 5.5 : 2.2, 0x1c0606)
    for (let k = -3; k <= 3; k++) { c.limb(hx + k * 2.2, neckY + 4 - (open ? 5 : 2), hx + k * 2.2, neckY + 4 - (open ? 3 : 1), 0.8, 0.3, BONE); if (open) c.limb(hx + k * 2.2 + 1, neckY + 9, hx + k * 2.2 + 1, neckY + 7, 0.8, 0.3, BONE) }
    for (const sd of [-1, 1]) { c.glow(hx + sd * 5, neckY - 4, 1.8, P.eye); c.limb(hx + sd * 8, neckY - 6, hx + sd * 13, neckY - 13, 2.2, 0.4, BONE) }
  } else {
    const hy = neckY - 8
    c.limb(hx, neckY + 2, hx, hy + 4, 3.5, 3.5, P.skin, tex)
    c.ball(hx, hy, 7, 8, P.skin, tex)
    if (I) {
      c.ball(hx, hy - 3, 7, 2.6, P.dark)
      for (const sd of [-1, 1]) { c.glow(hx + sd * 3, hy - 0.5, 2.2, P.eye); c.limb(hx + sd * 5, hy - 6, hx + sd * 9, hy - 13, 1.8, 0.4, BONE) }
      c.ball(hx, hy + 4, 3.6, open ? 2.4 : 1.4, 0x1c0606)
      for (const k of [-2, 0, 2]) c.put(hx + k, hy + 3, 0xe8e0d0)
    } else {
      c.ball(hx, hy - 4, 8.4, 5.6, P.dark)
      c.limb(hx - 8, hy - 2, hx + 8, hy - 2, 1.1, 1.1, 0x1c2016)
      for (const sd of [-1, 1]) c.glow(hx + sd * 3, hy + 1, 1.8, P.eye)
      c.limb(hx - 2, hy + 5, hx + 2, hy + 5, 0.7, 0.7, 0x3a2420)
      c.ball(hx + 3, hy + 6, 1.6, 2.5, BLOOD)
    }
  }
  // Weapons and effects in the hands.
  if (kind === 'trooper' && mode !== 3) {
    if (mode) { c.limb(cx, neckY + 10, cx, neckY + 20, 3.4, 3.4, 0x2a2e34); c.ball(cx, neckY + 13, 3.2, 3.2, 0x1a1d22); c.ball(cx, neckY + 13, 1.4, 1.4, 0x050505); if (mode === 2) { c.glow(cx, neckY + 13, 11, 0xffb040); c.glow(cx, neckY + 13, 5, 0xfff0c0) } }
    else c.limb(cx - 14, hipY - 2, cx + 13, neckY + 4, 2.2, 2, 0x24282e)
  }
  if (I && mode === 1) c.glow(hand[1]![0], hand[1]![1] - 3, 7, 0xff7a20)
  if (I && mode === 2) c.glow(hand[1]![0], hand[1]![1], 9, 0xff8a28)
}

function blot(c: Img, x: number, y: number, rx: number, ry: number, seed: number) {
  for (let yy = Math.floor(y - ry); yy <= y + ry; yy++) for (let xx = Math.floor(x - rx); xx <= x + rx; xx++) {
    const d = ((xx - x) / rx) ** 2 + ((yy - y) / ry) ** 2 + (hash2(xx, yy, seed) - 0.5) * 0.35
    if (d <= 1) c.put(xx, yy, d < 0.5 ? 0x5a0606 : 0x6e0a0a)
  }
}

// Rotate the standing pain pose about its feet into a fall: frame k of 5, k = 4 lies flat.
function fall(src: Img, k: number, seed: number) {
  const c = new Img(), th = (k / 4) ** 1.3 * Math.PI / 2, cs = Math.cos(th), sn = Math.sin(th), px = 48 - (k / 4) * 40
  if (k >= 2) blot(c, 44, 90, 8 + k * 6, 1.5 + k, seed)
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
    const u = x - px, v = y - 90, sx = Math.round(48 + u * cs + v * sn), sy = Math.round(90 - u * sn + v * cs)
    if (sx < 0 || sy < 0 || sx > 95 || sy > 95) continue
    const p = src.px[sy * 96 + sx]!
    if (p) c.px[y * 96 + x] = p
  }
  if (k < 3) for (let i = 0; i < 14 - k * 4; i++) c.ball(48 + (hash2(i, k, seed) - 0.5) * 30 + k * 6, 40 + hash2(k, i, seed) * 20 + k * 10, 1.4, 1.4, 0xb01818)
  c.outline()
  return c
}

function gib(kind: MonsterKind, src: Img, k: number, seed: number) {
  const c = new Img(), P = PAL[kind], cols = [P.skin, BLOOD, 0xb02424, P.cloth, P.skin]
  if (k === 0) { c.px.set(src.px); for (let i = 0; i < 18; i++) c.ball(48 + (hash2(i, 1, seed) - 0.5) * 26, 34 + hash2(1, i, seed) * 30, 3, 3, 0xb01818) }
  else {
    if (k >= 2) blot(c, 48, 90, 14 + k * 6, 3 + k, seed)
    const n = k === 3 ? 9 : 16
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 7, seed) * 6.283, sp = 0.5 + hash2(7, i, seed), t = k / 2
      const x = k === 3 ? 48 + (hash2(i, 3, seed) - 0.5) * 34 : 48 + Math.cos(a) * sp * 26 * t
      const y = k === 3 ? 86 - hash2(3, i, seed) * 6 : Math.min(88, 50 + Math.sin(a) * sp * 18 * t + t * t * 22)
      const r = 2 + hash2(i, i, seed) * 3.5
      c.ball(x, y, r * 1.3, r, cols[i % 5]!, undefined)
    }
    if (k === 3) { c.limb(36, 84, 52, 80, 1.4, 1.4, BONE); c.ball(36, 84, 2, 2, BONE); c.ball(58, 84, 6, 4, P.skin) }
  }
  c.outline()
  return c
}

export function buildMonster(kind: MonsterKind, tex: Texture): Img[] {
  const frame = (mode: number, ph: number) => { const c = new Img(); body(c, kind, mode, ph, tex); return c }
  const out: Img[] = [0, 1, 2, 3].map((f) => frame(0, (f / 4) * Math.PI * 2))
  out.push(frame(1, 0), frame(2, 0))
  const pain = frame(3, 0)
  const seed = kind.length * 31
  for (let k = 0; k < 5; k++) out.push(fall(pain, k, seed))
  for (let k = 0; k < 4; k++) out.push(gib(kind, pain, k, seed))
  for (const c of out.slice(0, 7)) c.outline()
  return out
}

// Status-bar face (original design): 6 expressions × 2 health tiers.
// Expressions: 0 ahead, 1 look left, 2 look right, 3 ouch, 4 grin, 5 dead.
export function buildFaces(): Img[] {
  const out: Img[] = []
  for (const tier of [0, 1]) for (let e = 0; e < 6; e++) {
    const c = new Img(32, 36), dead = e === 5, sk = dead ? 0x9a8a80 : 0xd09a74, dk = 0x2a1a12
    for (const sd of [-1, 1]) c.ball(16 + sd * 10, 19, 2.2, 3.4, sk)
    c.ball(16, 19, 10, 13, sk)
    c.ball(16, 8, 10.5, 5.5, 0x4a3220)
    c.limb(16, 17, 16, 22, 1.2, 1.8, sk)
    const off = e === 1 ? -1.2 : e === 2 ? 1.2 : 0
    for (const sd of [-1, 1]) {
      const ex = 16 + sd * 4.5
      if (dead) { c.limb(ex - 1.5, 15.5, ex + 1.5, 18.5, 0.6, 0.6, dk); c.limb(ex - 1.5, 18.5, ex + 1.5, 15.5, 0.6, 0.6, dk) }
      else if (e === 3) c.limb(ex - 2, 17, ex + 2, 17, 0.7, 0.7, dk)
      else { c.ball(ex, 17, 2.6, 1.8, 0xf2f2f0); c.ball(ex + off, 17, 1.1, 1.3, 0x22384a) }
      const by = e === 3 ? (sd < 0 ? 13 : 13) : e === 4 ? 12.5 : 14
      c.limb(ex - sd * 2.5, e === 3 ? by + 1.5 : by, ex + sd * 2.5, by, 0.8, 0.8, 0x3a2416)
    }
    if (e === 3 || dead) { c.ball(16, 27, 3.4, 2.4, 0x2a0808); c.limb(13.5, 25.6, 18.5, 25.6, 0.5, 0.5, 0xf0e8e0) }
    else if (e === 4) { c.ball(16, 26, 5.5, 2.6, 0x2a0808); c.limb(11.5, 25.4, 20.5, 25.4, 0.9, 0.9, 0xf0e8e0) }
    else c.limb(13, 26, 19, 26, 0.7, 0.7, 0x6a3a2a)
    if (tier) { c.limb(22, 9, 23.5, 24, 0.9, 0.4, BLOOD); c.limb(9, 12, 10.5, 18, 0.8, 0.3, BLOOD); c.ball(11, 22, 2, 1.4, 0x9a5a50) }
    c.outline()
    out.push(c)
  }
  return out
}

export function buildProps() {
  const barrel = new Img(48, 64)
  for (let y = 9; y < 63; y++) for (let x = 6; x < 42; x++) {
    const nx = (x + 0.5 - 24) / 18, nz = Math.sqrt(Math.max(0, 1 - nx * nx)), rib = y === 20 || y === 21 || y === 46 || y === 47
    barrel.lit(x, y, rib ? 0x6a7a5a : (y > 28 && y < 36 ? 0xc8a020 : 0x4a6038), nx, rib ? -0.3 : 0, nz)
  }
  barrel.ball(24, 9, 18, 5, 0x3a4a2c)
  barrel.glow(24, 9, 13, 0x6aff40)
  for (const x of [14, 22, 31]) barrel.limb(x, 10, x + 0.5, 14 + (x % 7), 1.2, 0.8, 0x7aff50)
  barrel.outline()
  const fireball = new Img(24, 24)
  fireball.glow(12, 12, 12, 0xff6a18); fireball.glow(12, 12, 6, 0xffc060)
  const shells = new Img(32, 32)
  shells.ball(16, 26, 13, 4, 0x3a2a18)
  for (let k = 0; k < 4; k++) { shells.limb(7 + k * 6, 24, 7 + k * 6, 9, 2.6, 2.6, 0xc02a1a); shells.limb(7 + k * 6, 25, 7 + k * 6, 21, 2.7, 2.7, 0xd8a838) }
  shells.outline()
  return { barrel, fireball, shells }
}
