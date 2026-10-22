// A tiny .kkrieger-style texture operator graph. Each texture is a short op list run on a stack machine of
// RGB float layers. Ops are terse arrays so the whole material library costs a few hundred bytes.
import { clamp, hash2, lerp, mulberry, smooth } from './rng'

export type Op =
  | ['noise', number, number, number] // scale, octaves, seed            → push gray value noise
  | ['cells', number, number, number] // count, seed, mode 0=F1 1=edges   → push gray voronoi
  | ['bricks', number, number, number, number] // cols, rows, mortar, seed  → push gray height
  | ['panel', number, number] // divisions, line width                → push gray tech grid
  | ['grad', number] // 0 = vertical, 1 = horizontal, 2 = radial        → push gray gradient
  | ['band', number, number, number] // dir 0=horizontal 1=vertical, center, width → push gray stripe
  | ['color', number] // rgb hex                                          → push flat color
  | ['ramp', ...number[]] // rgb stops, maps top gray layer to colors
  | ['blend', number] // 0 mul, 1 add, 2 screen, 3 lerp by 3rd layer (pops 3)
  | ['blur', number] // radius
  | ['warp', number] // amount: displace layer below by top (pops top)
  | ['emboss', number] // normal-from-height, lit from top-left, strength
  | ['level', number, number] // remap [lo,hi] to [0,1]
  | ['glow', number] // mark pixels brighter than threshold as emissive (keeps layer)
  | ['dup']
  | ['swap']

export interface Texture { size: number; px: Uint32Array; emis: Uint8Array; avg: number }

type Layer = Float32Array // size*size*3

export function runOps(ops: Op[], size = 128): Texture {
  const n = size * size
  const stack: Layer[] = []
  const emis = new Uint8Array(n)
  const mk = () => new Float32Array(n * 3)
  const gray = (f: (x: number, y: number) => number) => {
    const l = mk()
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = f(x / size, y / size)
      const i = (y * size + x) * 3
      l[i] = l[i + 1] = l[i + 2] = v
    }
    stack.push(l)
  }
  const pop = () => stack.pop()!
  for (const op of ops) {
    switch (op[0]) {
      case 'noise': {
        const [, scale, oct, seed] = op
        gray((u, v) => fbm(u * scale, v * scale, oct, seed, scale))
        break
      }
      case 'cells': {
        const [, count, seed, mode] = op
        const r = mulberry(seed)
        const pts: number[] = []
        for (let i = 0; i < count; i++) pts.push(r(), r())
        gray((u, v) => {
          let d1 = 9, d2 = 9
          for (let i = 0; i < pts.length; i += 2) {
            let dx = Math.abs(u - pts[i]!), dy = Math.abs(v - pts[i + 1]!)
            if (dx > 0.5) dx = 1 - dx
            if (dy > 0.5) dy = 1 - dy
            const d = dx * dx + dy * dy
            if (d < d1) { d2 = d1; d1 = d } else if (d < d2) d2 = d
          }
          const k = Math.sqrt(count)
          return mode ? clamp((Math.sqrt(d2) - Math.sqrt(d1)) * k * 2.2, 0, 1) : clamp(Math.sqrt(d1) * k * 1.3, 0, 1)
        })
        break
      }
      case 'bricks': {
        const [, cols, rows, mortar, seed] = op
        gray((u, v) => {
          const row = Math.floor(v * rows)
          const uu = u * cols + (row & 1) * 0.5
          const col = Math.floor(uu)
          const fx = uu - col, fy = v * rows - row
          const e = Math.min(fx, 1 - fx, (fy * cols) / rows, ((1 - fy) * cols) / rows) / mortar
          return clamp(e, 0, 1) * (0.8 + 0.2 * hash2(col % cols, row, seed))
        })
        break
      }
      case 'panel': {
        const [, div, w] = op
        gray((u, v) => {
          const fx = (u * div) % 1, fy = (v * div) % 1
          const e = Math.min(fx, 1 - fx, fy, 1 - fy)
          return smooth(clamp(e / w, 0, 1))
        })
        break
      }
      case 'grad': {
        const d = op[1]
        gray((u, v) => (d === 0 ? v : d === 1 ? u : clamp(1 - Math.hypot(u - 0.5, v - 0.5) * 2, 0, 1)))
        break
      }
      case 'band': {
        const [, d, c, w] = op
        gray((u, v) => smooth(clamp(1 - Math.abs((d ? u : v) - c) / w, 0, 1)))
        break
      }
      case 'color': {
        const l = mk()
        const [r, g, b] = rgb(op[1])
        for (let i = 0; i < n * 3; i += 3) { l[i] = r; l[i + 1] = g; l[i + 2] = b }
        stack.push(l)
        break
      }
      case 'ramp': {
        const stops = (op.slice(1) as number[]).map(rgb)
        const l = stack[stack.length - 1]!
        const m = stops.length - 1
        for (let i = 0; i < n * 3; i += 3) {
          const t = clamp(l[i]!, 0, 1) * m
          const k = Math.min(m - 1, Math.floor(t))
          const f = t - k
          const a = stops[k]!, b = stops[k + 1]!
          l[i] = lerp(a[0], b[0], f); l[i + 1] = lerp(a[1], b[1], f); l[i + 2] = lerp(a[2], b[2], f)
        }
        break
      }
      case 'blend': {
        const mode = op[1]
        if (mode === 3) {
          const t = pop(), b = pop(), a = stack[stack.length - 1]!
          for (let i = 0; i < n * 3; i++) a[i] = lerp(a[i]!, b[i]!, t[i]!)
          break
        }
        const b = pop(), a = stack[stack.length - 1]!
        for (let i = 0; i < n * 3; i++) {
          const x = a[i]!, y = b[i]!
          a[i] = mode === 0 ? x * y : mode === 1 ? x + y : 1 - (1 - x) * (1 - y)
        }
        break
      }
      case 'blur': {
        const r = op[1]
        const l = stack[stack.length - 1]!
        const tmp = mk()
        for (let pass = 0; pass < 2; pass++) {
          const src = pass ? tmp : l, dst = pass ? l : tmp
          for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            let s0 = 0, s1 = 0, s2 = 0
            for (let k = -r; k <= r; k++) {
              const xx = pass ? x : (x + k + size) % size, yy = pass ? (y + k + size) % size : y
              const j = (yy * size + xx) * 3
              s0 += src[j]!; s1 += src[j + 1]!; s2 += src[j + 2]!
            }
            const i = (y * size + x) * 3, d = 2 * r + 1
            dst[i] = s0 / d; dst[i + 1] = s1 / d; dst[i + 2] = s2 / d
          }
        }
        break
      }
      case 'warp': {
        const amt = op[1] * size
        const w = pop(), l = stack[stack.length - 1]!
        const src = l.slice()
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 3
          const sx = ((x + Math.round((w[i]! - 0.5) * amt)) % size + size) % size
          const sy = ((y + Math.round((w[i + 1]! - 0.5) * amt * 0.7)) % size + size) % size
          const j = (sy * size + sx) * 3
          l[i] = src[j]!; l[i + 1] = src[j + 1]!; l[i + 2] = src[j + 2]!
        }
        break
      }
      case 'emboss': {
        const k = op[1]
        const h = stack[stack.length - 1]!
        const out = mk()
        // Height → normal (central differences) → N·L with a fixed key light from the top-left.
        const lx = -0.5, ly = -0.6, lz = 0.62
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const at = (xx: number, yy: number) => h[((((yy + size) % size) * size + ((xx + size) % size)) * 3)]!
          const nx = (at(x - 1, y) - at(x + 1, y)) * k, ny = (at(x, y - 1) - at(x, y + 1)) * k
          const len = Math.hypot(nx, ny, 1)
          const d = clamp((nx * lx + ny * ly + lz) / len, 0, 1) / lz
          const i = (y * size + x) * 3
          out[i] = out[i + 1] = out[i + 2] = d
        }
        stack.push(out)
        break
      }
      case 'level': {
        const [, lo, hi] = op
        const l = stack[stack.length - 1]!
        for (let i = 0; i < n * 3; i++) l[i] = clamp((l[i]! - lo) / (hi - lo), 0, 1)
        break
      }
      case 'glow': {
        const th = op[1]
        const l = stack[stack.length - 1]!
        for (let p = 0; p < n; p++) {
          const v = Math.max(l[p * 3]!, l[p * 3 + 1]!, l[p * 3 + 2]!)
          emis[p] = Math.max(emis[p]!, Math.round(clamp((v - th) / (1 - th), 0, 1) * 255))
        }
        break
      }
      case 'dup': stack.push(stack[stack.length - 1]!.slice()); break
      case 'swap': { const a = pop(), b = pop(); stack.push(a, b); break }
    }
  }
  const top = stack[stack.length - 1]!
  const px = new Uint32Array(n)
  let ar = 0, ag = 0, ab = 0
  for (let p = 0; p < n; p++) {
    const r = clamp(top[p * 3]! * 255, 0, 255) | 0, g = clamp(top[p * 3 + 1]! * 255, 0, 255) | 0, b = clamp(top[p * 3 + 2]! * 255, 0, 255) | 0
    ar += r; ag += g; ab += b
    px[p] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0
  }
  return { size, px, emis, avg: ((ar / n) << 16) | ((ag / n) << 8) | (ab / n) }
}

export function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}

function vnoise(x: number, y: number, seed: number, period: number): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const fx = smooth(x - xi), fy = smooth(y - yi)
  const p = Math.max(1, Math.round(period))
  const h = (a: number, b: number) => hash2(((a % p) + p) % p, ((b % p) + p) % p, seed)
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), fx), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), fx), fy)
}

// Tileable fBm: each octave wraps at its own period so textures repeat seamlessly on walls.
export function fbm(x: number, y: number, oct: number, seed: number, period: number): number {
  let s = 0, a = 0.5, f = 1, norm = 0
  for (let o = 0; o < oct; o++) {
    s += vnoise(x * f, y * f, seed + o * 17, period * f) * a
    norm += a; a *= 0.5; f *= 2
  }
  return s / norm
}
