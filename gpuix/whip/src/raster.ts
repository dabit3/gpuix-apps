import { sampleCurve } from './physics'

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export function hex(color: string, alpha = 1): Rgba {
  const h = color.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: alpha,
  }
}

export interface Flash {
  x: number
  y: number
  born: number
  life: number
  sparks: number[]
}

/** CPU raster of the whip into a transparent straight-alpha RGBA buffer. */
export class WhipCanvas {
  width = 0
  height = 0
  pixels = new Uint8Array(0)
  private dirty = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private next = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private samples: Float64Array<ArrayBufferLike> = new Float64Array(0)

  resize(width: number, height: number) {
    width = Math.max(1, Math.floor(width))
    height = Math.max(1, Math.floor(height))
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
    this.pixels = new Uint8Array(width * height * 4)
    this.dirty = { x0: 0, y0: 0, x1: width, y1: height }
  }

  begin() {
    const { x0, y0, x1, y1 } = this.dirty
    const w = this.width
    const p = this.pixels
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      p.fill(0, (y * w + Math.max(0, x0)) * 4, (y * w + Math.min(w, x1)) * 4)
    }
    this.next = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  }

  end() {
    const n = this.next
    this.dirty = n.x0 === Infinity ? { x0: 0, y0: 0, x1: 0, y1: 0 } : {
      x0: Math.floor(n.x0) - 2,
      y0: Math.floor(n.y0) - 2,
      x1: Math.ceil(n.x1) + 2,
      y1: Math.ceil(n.y1) + 2,
    }
  }

  private mark(x0: number, y0: number, x1: number, y1: number) {
    const n = this.next
    if (x0 < n.x0) n.x0 = x0
    if (y0 < n.y0) n.y0 = y0
    if (x1 > n.x1) n.x1 = x1
    if (y1 > n.y1) n.y1 = y1
  }

  private blend(i: number, c: Rgba, cover: number) {
    const sa = c.a * cover
    if (sa <= 0.002) return
    const p = this.pixels
    const da = p[i + 3] / 255
    const oa = sa + da * (1 - sa)
    const k = da * (1 - sa)
    p[i] = (c.r * sa + p[i] * k) / oa
    p[i + 1] = (c.g * sa + p[i + 1] * k) / oa
    p[i + 2] = (c.b * sa + p[i + 2] * k) / oa
    p[i + 3] = oa * 255
  }

  disc(cx: number, cy: number, r: number, c: Rgba) {
    const x0 = Math.max(0, Math.floor(cx - r - 1))
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r + 1))
    const y0 = Math.max(0, Math.floor(cy - r - 1))
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r + 1))
    if (x0 > x1 || y0 > y1) return
    this.mark(x0, y0, x1 + 1, y1 + 1)
    const w = this.width
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx
        const cover = r + 0.5 - Math.sqrt(dx * dx + dy * dy)
        if (cover <= 0) continue
        this.blend((y * w + x) * 4, c, cover >= 1 ? 1 : cover)
      }
    }
  }

  ring(cx: number, cy: number, r: number, thickness: number, c: Rgba) {
    const R = r + thickness
    const x0 = Math.max(0, Math.floor(cx - R - 1))
    const x1 = Math.min(this.width - 1, Math.ceil(cx + R + 1))
    const y0 = Math.max(0, Math.floor(cy - R - 1))
    const y1 = Math.min(this.height - 1, Math.ceil(cy + R + 1))
    if (x0 > x1 || y0 > y1) return
    this.mark(x0, y0, x1 + 1, y1 + 1)
    const w = this.width
    const half = thickness / 2
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx
        const d = Math.abs(Math.sqrt(dx * dx + dy * dy) - r)
        const cover = half + 0.5 - d
        if (cover <= 0) continue
        this.blend((y * w + x) * 4, c, cover >= 1 ? 1 : cover)
      }
    }
  }

  line(ax: number, ay: number, bx: number, by: number, r: number, c: Rgba) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(0.8, r * 0.6)))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      this.disc(ax + (bx - ax) * t, ay + (by - ay) * t, r, c)
    }
  }

  /** Tapered whip: thick at the handle, a hair at the tip. */
  whip(xs: ArrayLike<number>, ys: ArrayLike<number>, opts: { thick: number; thin: number; fill: Rgba; outline: Rgba; grip: Rgba; shadow: Rgba; ox?: number; oy?: number }) {
    const { points, count } = sampleCurve(xs, ys, 5, this.samples)
    this.samples = points
    const ox = opts.ox ?? 0
    const oy = opts.oy ?? 0
    const radius = (i: number) => {
      const t = i / (count - 1)
      return opts.thin + (opts.thick - opts.thin) * Math.pow(1 - t, 1.6)
    }
    // Shadow, then outline, then fill: each pass is a chain of discs.
    for (let pass = 0; pass < 3; pass++) {
      let lastX = Infinity
      let lastY = Infinity
      for (let i = 0; i < count; i++) {
        const x = points[i * 2] + ox
        const y = points[i * 2 + 1] + oy
        const r = radius(i)
        const spacing = Math.max(0.7, r * 0.45)
        const gap = Math.hypot(x - lastX, y - lastY)
        if (i !== count - 1 && gap < spacing) continue
        if (gap > spacing * 1.5 && gap < 400) {
          const steps = Math.ceil(gap / spacing)
          for (let k = 1; k < steps; k++) {
            const tx = lastX + ((x - lastX) * k) / steps
            const ty = lastY + ((y - lastY) * k) / steps
            if (pass === 0) this.disc(tx + 3, ty + 5, r + 1.5, opts.shadow)
            else if (pass === 1) this.disc(tx, ty, r + 1.4, opts.outline)
            else this.disc(tx, ty, r, i < count * 0.09 ? opts.grip : opts.fill)
          }
        }
        lastX = x
        lastY = y
        if (pass === 0) this.disc(x + 3, y + 5, r + 1.5, opts.shadow)
        else if (pass === 1) this.disc(x, y, r + 1.4, opts.outline)
        else this.disc(x, y, r, i < count * 0.09 ? opts.grip : opts.fill)
      }
    }
  }

  flash(f: Flash, now: number, color: Rgba) {
    const t = (now - f.born) / f.life
    if (t < 0 || t >= 1) return
    const ease = 1 - Math.pow(1 - t, 3)
    const fade = 1 - t
    this.ring(f.x, f.y, 4 + ease * 34, 2.2 * fade + 0.6, { ...color, a: color.a * fade })
    if (t < 0.35) this.disc(f.x, f.y, 5 * (1 - t / 0.35) + 1, { ...color, a: 0.9 * (1 - t / 0.35) })
    for (let i = 0; i < f.sparks.length; i++) {
      const a = f.sparks[i]
      const r0 = 8 + ease * 22
      const r1 = r0 + 8 * fade
      this.line(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0, f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1, 0.9, { ...color, a: color.a * fade })
    }
  }

  /** Alpha at a pixel, for tests. */
  alphaAt(x: number, y: number) {
    return this.pixels[(Math.floor(y) * this.width + Math.floor(x)) * 4 + 3]
  }
}

export function makeFlash(x: number, y: number, born: number): Flash {
  const sparks: number[] = []
  const base = Math.random() * Math.PI * 2
  for (let i = 0; i < 7; i++) sparks.push(base + (i / 7) * Math.PI * 2 + (Math.random() - 0.5) * 0.4)
  return { x, y, born, life: 320, sparks }
}
