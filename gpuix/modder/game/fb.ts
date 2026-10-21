// Tiny CPU framebuffer: packed RGBA in a Uint32Array (little-endian, so bytes are R,G,B,A).
export const W = 320
export const H = 180

export function hex(c: string): number {
  const n = parseInt(c.replace('#', '').slice(0, 6), 16)
  return pack((n >> 16) & 255, (n >> 8) & 255, n & 255)
}
export const pack = (r: number, g: number, b: number) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
export const R = (c: number) => c & 255
export const G = (c: number) => (c >>> 8) & 255
export const B = (c: number) => (c >>> 16) & 255

export function mix(a: number, b: number, t: number): number {
  return pack(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, B(a) + (B(b) - B(a)) * t)
}

export type Palette = Record<string, number>
export interface Sprite { rows: string[]; keys: Record<string, number> }

export class FB {
  px: Uint32Array
  constructor(public w = W, public h = H) { this.px = new Uint32Array(w * h) }

  set(x: number, y: number, c: number) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.px[y * this.w + x] = c
  }
  blend(x: number, y: number, c: number, a: number) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return
    const i = y * this.w + x
    this.px[i] = a >= 1 ? c : mix(this.px[i]!, c, a)
  }
  rect(x: number, y: number, w: number, h: number, c: number, a = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.blend(x + i, y + j, c, a)
  }
  // Additive glow with a quadratic falloff: projectiles and sparks.
  glow(cx: number, cy: number, radius: number, c: number, k = 1) {
    const r0 = Math.ceil(radius)
    const cr = R(c) * k, cg = G(c) * k, cb = B(c) * k
    for (let y = -r0; y <= r0; y++) {
      const py = (cy + y) | 0
      if (py < 0 || py >= this.h) continue
      for (let x = -r0; x <= r0; x++) {
        const px = (cx + x) | 0
        if (px < 0 || px >= this.w) continue
        const d = Math.sqrt(x * x + y * y) / radius
        if (d >= 1) continue
        const f = (1 - d) * (1 - d)
        const i = py * this.w + px
        const p = this.px[i]!
        this.px[i] = pack(Math.min(255, R(p) + cr * f), Math.min(255, G(p) + cg * f), Math.min(255, B(p) + cb * f))
      }
    }
  }
  sprite(s: Sprite, x: number, y: number, opts: { flip?: boolean; flash?: number; squash?: number } = {}) {
    const rows = s.rows
    const h = rows.length
    const sq = opts.squash ?? 0
    for (let j = 0; j < h; j++) {
      const row = rows[j]!
      const w = row.length
      for (let i = 0; i < w; i++) {
        const ch = row[opts.flip ? w - 1 - i : i]!
        if (ch === '.') continue
        let c = s.keys[ch]
        if (c == null) continue
        if (opts.flash) c = mix(c, 0xffffffff, opts.flash)
        // squash: widen the bottom, shrink the top (slime hop)
        const t = j / h
        const dx = sq ? Math.round((i - w / 2) * sq * (t - 0.5)) : 0
        const dy = sq ? Math.round(-sq * 4 * (1 - t)) : 0
        this.set(x + i + dx, y + j - dy, c)
      }
    }
  }
  shadow(cx: number, cy: number, rw: number, rh: number, a = 0.35) {
    for (let y = -rh; y <= rh; y++) for (let x = -rw; x <= rw; x++) {
      if ((x * x) / (rw * rw) + (y * y) / (rh * rh) <= 1) this.blend(cx + x, cy + y, 0xff0a0c10, a)
    }
  }
}

// Nearest-neighbour upscale into an RGBA byte buffer for <img>.setImagePixels.
export function upscale(src: FB, s: number, out: Uint32Array) {
  const ow = src.w * s
  const row = new Uint32Array(ow)
  for (let y = 0; y < src.h; y++) {
    const base = y * src.w
    for (let x = 0; x < src.w; x++) row.fill(src.px[base + x]!, x * s, x * s + s)
    for (let k = 0; k < s; k++) out.set(row, (y * s + k) * ow)
  }
}

export function spriteFrom(rows: string[], keys: Record<string, string>, palette: Record<string, string>): Sprite {
  const k: Record<string, number> = {}
  for (const [ch, name] of Object.entries(keys)) k[ch] = hex(palette[name] ?? name)
  return { rows, keys: k }
}
