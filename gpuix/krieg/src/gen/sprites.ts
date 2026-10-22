// Procedural sprites: enemies, pickups, projectiles and the two viewmodels are drawn with a few raster
// helpers (shaded ellipses, thick lines, rects) at boot. No image files.
import type { Sprite } from '../engine/raycast'
import type { Texture } from './texops'
import { clamp, hash2 } from './rng'
import { buildFaces, buildMonster, buildProps, type MonsterKind } from './monsters'
import { chaingun, launcher, shotgun, type GunSprite } from './guns'

class Canvas implements Sprite {
  px: Uint32Array
  constructor(public w: number, public h: number) { this.px = new Uint32Array(w * h) }
  put(x: number, y: number, c: number, a = 255) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.px[y * this.w + x] = ((a << 24) | (c & 0xffffff)) >>> 0
  }
  // Sphere-shaded ellipse: N·L from top-left gives volume; optional texture for surface detail.
  ball(cx: number, cy: number, rx: number, ry: number, base: number, tex?: Texture, emissive = false) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, d = nx * nx + ny * ny
      if (d > 1) continue
      const nz = Math.sqrt(1 - d)
      const l = clamp(-nx * 0.45 - ny * 0.55 + nz * 0.7, 0.08, 1) * 1.15
      let r = (base >> 16) & 255, g = (base >> 8) & 255, b = base & 255
      if (tex) { const p = tex.px[((y * 3) & (tex.size - 1)) * tex.size + ((x * 3) & (tex.size - 1))]!; r = (r + ((p >> 16) & 255)) / 2; g = (g + ((p >> 8) & 255)) / 2; b = (b + (p & 255)) / 2 }
      const k = emissive ? 1 : l
      this.put(x, y, (clamp(r * k, 0, 255) << 16) | (clamp(g * k, 0, 255) << 8) | clamp(b * k, 0, 255), emissive ? 200 : 255)
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: number, a = 255) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t
      for (let yy = -w; yy <= w; yy++) for (let xx = -w; xx <= w; xx++) if (xx * xx + yy * yy <= w * w) this.put(x + xx, y + yy, shade(c, 1 - (yy + w) / (4 * w + 1) * 0.6), a)
    }
  }
  rect(x0: number, y0: number, w: number, h: number, c: number, bevel = 2, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const e = Math.min(x - x0, y - y0, x0 + w - 1 - x, y0 + h - 1 - y)
      const k = e < bevel ? (x - x0 < bevel || y - y0 < bevel ? 1.35 : 0.6) : 1 - ((y - y0) / h) * 0.25
      this.put(x, y, shade(c, k), a)
    }
  }
  glowDot(cx: number, cy: number, r: number, c: number) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
      if (d > 1) continue
      const k = (1 - d) ** 1.5
      this.put(x, y, shade(c, 0.6 + k * 0.8), 200)
    }
  }
}

function shade(c: number, k: number) {
  return (clamp(((c >> 16) & 255) * k, 0, 255) << 16) | (clamp(((c >> 8) & 255) * k, 0, 255) << 8) | clamp((c & 255) * k, 0, 255)
}

export interface SpriteSet {
  mon: Record<MonsterKind, Sprite[]>; faces: Sprite[]; barrel: Sprite; fireball: Sprite; guns: GunSprite[][]
  pickups: Record<'health' | 'ammo' | 'shells' | 'rockets' | 'key', Sprite>
  bolt: Sprite; rocket: Sprite; explosion: Sprite[]; exitPad: Sprite
  muzzle: Sprite[]; dots: Sprite[] // dots: spark, blood, ember, smoke, gib
}

export function buildSprites(skin: Texture, metal: Texture): SpriteSet {
  const mon = { trooper: buildMonster('trooper', skin), imp: buildMonster('imp', skin), brute: buildMonster('brute', skin) }
  const props = buildProps()
  const pick = (draw: (c: Canvas) => void) => { const c = new Canvas(32, 32); draw(c); return c }
  const pickups = {
    health: pick((c) => { c.rect(4, 8, 24, 20, 0xd9dee3, 2); c.rect(13, 11, 6, 14, 0xff4a4a, 1, 210); c.rect(9, 15, 14, 6, 0xff4a4a, 1, 210) }),
    ammo: pick((c) => { c.rect(4, 14, 24, 14, 0x6a5a2a, 2); for (let k = 0; k < 4; k++) c.rect(6 + k * 6, 6, 4, 9, 0xf0b72f, 1) }),
    rockets: pick((c) => { for (let k = 0; k < 3; k++) { c.rect(5 + k * 8, 10, 6, 18, 0x2a6a3a, 1); c.ball(8 + k * 8, 10, 3, 4, 0x4ae168, undefined, true) } }),
    shells: props.shells,
    key: pick((c) => { c.rect(6, 6, 20, 24, 0xf0b72f, 2, 220); c.rect(10, 10, 12, 4, 0x2a1c08, 1); c.glowDot(16, 22, 4, 0xfff0a0) }),
  }
  const bolt = new Canvas(16, 16); bolt.glowDot(8, 8, 8, 0x71e7ff)
  const rocket = new Canvas(16, 16); rocket.glowDot(8, 8, 8, 0xffa040); rocket.ball(8, 8, 3, 3, 0xffffff, undefined, true)
  const explosion = [0, 1, 2, 3].map((f) => {
    const c = new Canvas(48, 48), R = 10 + f * 4
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const d = Math.hypot(x - 24, y - 24) / R + (hash2(x >> 1, y >> 1, f) - 0.5) * 0.5
      if (d > 1) continue
      const heat = clamp(1 - d - f * 0.15, 0, 1)
      c.put(x, y, (255 << 16) | (clamp(90 + heat * 200, 0, 255) << 8) | clamp(heat * 160, 0, 255), 200)
    }
    return c
  })
  const exitPad = new Canvas(48, 16)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 48; x++) { const d = Math.abs(Math.hypot((x - 24) / 24, (y - 8) / 8) - 0.8); if (d < 0.2) exitPad.put(x, y, 0x4ae168, 200) }
  const guns = [[shotgun(0), shotgun(1)], [chaingun(0), chaingun(1), chaingun(2)], [launcher()]]
  // Muzzle flare: a hot radial core with randomised spikes, centred on the sprite; drawn additively at the barrel tip.
  const muzzle = [0, 1, 2].map((f) => {
    const c = new Canvas(48, 48), sp = [0, 1, 2, 3, 4, 5, 6].map((k) => [(k / 7) * 6.283 + hash2(k, f, 9) * 0.6, 0.45 + hash2(f, k, 3) * 0.55])
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const a = Math.atan2(y - 24, x - 24), d = Math.hypot(x - 24, (y - 24) * 1.4) / 24
      let r = 0.3
      for (const [ak, lk] of sp) { const da = Math.abs(((a - ak! + 9.42) % 6.283) - 3.14); r = Math.max(r, lk! * Math.max(0, 1 - da / 0.22)) }
      const k = clamp(1 - d / r, 0, 1)
      if (k <= 0) continue
      c.put(x, y, k > 0.55 ? 0xfffbe8 : shade(k > 0.25 ? 0xffd27a : 0xff8a30, 0.5 + k), 200)
    }
    return c
  })
  const dot = (n: number, col: number, lit: boolean) => { const c = new Canvas(n, n); lit ? c.ball(n / 2, n / 2, n / 2, n / 2, col) : c.glowDot(n / 2, n / 2, n / 2, col); return c }
  const dots = [dot(8, 0xffd890, false), dot(8, 0x8a2418, true), dot(8, 0xffa040, false), dot(16, 0x5a5c62, true), dot(10, 0x9a2a20, true)]
  return { mon, faces: buildFaces(), barrel: props.barrel, fireball: props.fireball, guns, pickups, bolt, rocket, explosion, exitPad, muzzle, dots }
}
