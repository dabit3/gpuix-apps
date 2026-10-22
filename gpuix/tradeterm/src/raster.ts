/** Small CPU rasterizer that writes BGRA pixels for <img>.setImagePixels(..., { format: 'bgra' }). */
export type RGBA = [number, number, number, number]

const cache = new Map<string, RGBA>()
export function rgba(hex: string, alpha = 1): RGBA {
  const key = `${hex}:${alpha}`
  const hit = cache.get(key)
  if (hit) return hit
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = (h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1) * alpha
  const out: RGBA = [r, g, b, a]
  cache.set(key, out)
  return out
}

export class Canvas {
  w = 0
  h = 0
  buf = new Uint8Array(0)
  private u32 = new Uint32Array(0)

  resize(w: number, h: number) {
    w = Math.max(1, Math.floor(w))
    h = Math.max(1, Math.floor(h))
    if (w === this.w && h === this.h) return
    this.w = w
    this.h = h
    this.buf = new Uint8Array(w * h * 4)
    this.u32 = new Uint32Array(this.buf.buffer)
  }

  clear(c: RGBA) {
    this.u32.fill((0xff << 24) | (c[0] << 16) | (c[1] << 8) | c[2])
  }

  /** Blend one pixel; `a` multiplies the colour's own alpha. */
  px(x: number, y: number, c: RGBA, a = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const al = c[3] * a
    if (al <= 0.004) return
    const i = (y * this.w + x) * 4
    const b = this.buf
    if (al >= 0.999) {
      b[i] = c[2]
      b[i + 1] = c[1]
      b[i + 2] = c[0]
      return
    }
    b[i] = b[i]! + (c[2] - b[i]!) * al
    b[i + 1] = b[i + 1]! + (c[1] - b[i + 1]!) * al
    b[i + 2] = b[i + 2]! + (c[0] - b[i + 2]!) * al
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA) {
    const x0 = Math.max(0, Math.round(x))
    const y0 = Math.max(0, Math.round(y))
    const x1 = Math.min(this.w, Math.round(x + w))
    const y1 = Math.min(this.h, Math.round(y + h))
    if (c[3] >= 0.999) {
      const v = (0xff << 24) | (c[0] << 16) | (c[1] << 8) | c[2]
      for (let yy = y0; yy < y1; yy++) this.u32.fill(v, yy * this.w + x0, yy * this.w + x1)
      return
    }
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, c)
  }

  hline(y: number, c: RGBA, dash = 0, x0 = 0, x1 = this.w) {
    const yy = Math.round(y)
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(this.w, x1); x++) if (!dash || Math.floor(x / dash) % 2 === 0) this.px(x, yy, c)
  }

  vline(x: number, c: RGBA, y0 = 0, y1 = this.h, dash = 0) {
    const xx = Math.round(x)
    const a = Math.max(0, Math.round(Math.min(y0, y1)))
    const b = Math.min(this.h, Math.round(Math.max(y0, y1)))
    for (let y = a; y < b; y++) if (!dash || Math.floor(y / dash) % 2 === 0) this.px(xx, y, c)
  }

  /** Anti-aliased line of a given width. */
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA, width = 1.2): void {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return
    const dx = x1 - x0
    const dy = y1 - y0
    const hw = width / 2
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (x0 > x1) return this.line(x1, y1, x0, y0, c, width)
      const k = dx === 0 ? 0 : dy / dx
      const thick = hw * Math.sqrt(1 + k * k)
      const xa = Math.max(0, Math.floor(x0))
      const xb = Math.min(this.w - 1, Math.ceil(x1))
      for (let x = xa; x <= xb; x++) {
        const cx = Math.min(Math.max(x + 0.5, x0), x1)
        const yc = y0 + (cx - x0) * k
        const cov = Math.min(1, x1 - x0 < 1 ? 1 : Math.min(x + 1, x1) - Math.max(x, x0) + 0.0001)
        for (let y = Math.floor(yc - thick - 1); y <= Math.ceil(yc + thick + 1); y++) {
          const d = Math.abs(y + 0.5 - yc)
          const a = Math.min(1, thick + 0.5 - d)
          if (a > 0) this.px(x, y, c, a * cov)
        }
      }
    } else {
      if (y0 > y1) return this.line(x1, y1, x0, y0, c, width)
      const k = dx / dy
      const thick = hw * Math.sqrt(1 + k * k)
      const ya = Math.max(0, Math.floor(y0))
      const yb = Math.min(this.h - 1, Math.ceil(y1))
      for (let y = ya; y <= yb; y++) {
        const cy = Math.min(Math.max(y + 0.5, y0), y1)
        const xc = x0 + (cy - y0) * k
        const cov = Math.min(1, Math.min(y + 1, y1) - Math.max(y, y0) + 0.0001)
        for (let x = Math.floor(xc - thick - 1); x <= Math.ceil(xc + thick + 1); x++) {
          const d = Math.abs(x + 0.5 - xc)
          const a = Math.min(1, thick + 0.5 - d)
          if (a > 0) this.px(x, y, c, a * cov)
        }
      }
    }
  }

  /** Polyline through (xs[i], ys[i]); NaN y values break the line. */
  polyline(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, c: RGBA, width = 1.2) {
    for (let i = 1; i < n; i++) {
      const ya = ys[i - 1]!
      const yb = ys[i]!
      if (Number.isNaN(ya) || Number.isNaN(yb)) continue
      this.line(xs[i - 1]!, ya, xs[i]!, yb, c, width)
    }
  }

  /** Fill each column between yTop and yBot (pixel space), linearly interpolated between samples. */
  fillBetween(xs: ArrayLike<number>, yTop: ArrayLike<number>, yBot: ArrayLike<number>, n: number, c: RGBA) {
    for (let i = 1; i < n; i++) {
      const xa = xs[i - 1]!
      const xb = xs[i]!
      if ([yTop[i - 1]!, yTop[i]!, yBot[i - 1]!, yBot[i]!].some(Number.isNaN)) continue
      for (let x = Math.max(0, Math.ceil(xa)); x < Math.min(this.w, Math.ceil(xb)); x++) {
        const f = xb === xa ? 0 : (x - xa) / (xb - xa)
        const t = yTop[i - 1]! + (yTop[i]! - yTop[i - 1]!) * f
        const b = yBot[i - 1]! + (yBot[i]! - yBot[i - 1]!) * f
        const y0 = Math.max(0, Math.round(Math.min(t, b)))
        const y1 = Math.min(this.h, Math.round(Math.max(t, b)))
        for (let y = y0; y < y1; y++) this.px(x, y, c)
      }
    }
  }

  /** Vertical gradient area under a line down to `base`. */
  area(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, base: number, c: RGBA, top = 0.28, bottom = 0.02) {
    for (let i = 1; i < n; i++) {
      const xa = xs[i - 1]!
      const xb = xs[i]!
      if (Number.isNaN(ys[i - 1]!) || Number.isNaN(ys[i]!)) continue
      for (let x = Math.max(0, Math.ceil(xa)); x < Math.min(this.w, Math.ceil(xb)); x++) {
        const f = xb === xa ? 0 : (x - xa) / (xb - xa)
        const y = ys[i - 1]! + (ys[i]! - ys[i - 1]!) * f
        const y0 = Math.max(0, Math.round(Math.min(y, base)))
        const y1 = Math.min(this.h, Math.round(Math.max(y, base)))
        const span = Math.max(1, y1 - y0)
        for (let yy = y0; yy < y1; yy++) this.px(x, yy, c, top + (bottom - top) * ((yy - y0) / span))
      }
    }
  }

  triangle(x: number, y: number, size: number, up: boolean, c: RGBA) {
    for (let r = 0; r <= size; r++) {
      const half = (r / size) * size * 0.75
      const yy = Math.round(up ? y + r : y - r)
      for (let xx = Math.floor(x - half); xx <= Math.ceil(x + half); xx++) {
        const edge = Math.min(1, half + 0.5 - Math.abs(xx + 0.5 - x))
        if (edge > 0) this.px(xx, yy, c, edge)
      }
    }
  }
}
