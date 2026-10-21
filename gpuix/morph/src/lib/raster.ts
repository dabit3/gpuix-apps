/** Tiny anti-aliased vector rasterizer (signed distances) for the bits GPUIX elements can't draw: arcs, strokes, morphing glyphs. */
export type V = readonly [number, number]
export interface Stroke { kind: 'stroke'; pts: V[]; width: number; color: string; alpha?: number }
export interface Fill { kind: 'fill'; pts: V[]; color: string; alpha?: number }
export interface Dot { kind: 'dot'; c: V; r: number; color: string; alpha?: number; ring?: { width: number; color: string } }
export type Prim = Stroke | Fill | Dot

const rgbCache = new Map<string, [number, number, number]>()
function rgb(c: string): [number, number, number] {
  let v = rgbCache.get(c)
  if (!v) { const h = c.replace('#', ''); v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; rgbCache.set(c, v) }
  return v
}

/** Straight-alpha RGBA, `w`x`h` pixels; primitives are in the same pixel units. */
export function rasterize(w: number, h: number, prims: Prim[]): Uint8Array {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
  const acc = new Float32Array(w * h * 4) // premultiplied
  const cov = new Float32Array(w * h)
  for (const p of prims) {
    cov.fill(0)
    let x0 = w, y0 = h, x1 = 0, y1 = 0
    const mark = (ax: number, ay: number, bx: number, by: number) => {
      x0 = Math.min(x0, Math.max(0, Math.floor(ax))); y0 = Math.min(y0, Math.max(0, Math.floor(ay)))
      x1 = Math.max(x1, Math.min(w, Math.ceil(bx))); y1 = Math.max(y1, Math.min(h, Math.ceil(by)))
    }
    if (p.kind === 'stroke') {
      const hw = p.width / 2
      for (let i = 0; i + 1 < p.pts.length || (i === 0 && p.pts.length === 1); i++) {
        const a = p.pts[i]!, b = p.pts[Math.min(i + 1, p.pts.length - 1)]!
        const bx0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - hw - 1)), bx1 = Math.min(w, Math.ceil(Math.max(a[0], b[0]) + hw + 1))
        const by0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - hw - 1)), by1 = Math.min(h, Math.ceil(Math.max(a[1], b[1]) + hw + 1))
        mark(bx0, by0, bx1, by1)
        const dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy || 1e-9
        for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
          const px = x + 0.5 - a[0], py = y + 0.5 - a[1]
          const t = Math.max(0, Math.min(1, (px * dx + py * dy) / ll))
          const ex = px - dx * t, ey = py - dy * t
          const c = hw + 0.5 - Math.sqrt(ex * ex + ey * ey)
          if (c > 0) { const k = y * w + x; const v = c > 1 ? 1 : c; if (v > cov[k]!) cov[k] = v }
        }
      }
    } else if (p.kind === 'fill') {
      const pts = p.pts
      let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity
      for (const q of pts) { mx0 = Math.min(mx0, q[0]); my0 = Math.min(my0, q[1]); mx1 = Math.max(mx1, q[0]); my1 = Math.max(my1, q[1]) }
      const bx0 = Math.max(0, Math.floor(mx0 - 1)), bx1 = Math.min(w, Math.ceil(mx1 + 1)), by0 = Math.max(0, Math.floor(my0 - 1)), by1 = Math.min(h, Math.ceil(my1 + 1))
      mark(bx0, by0, bx1, by1)
      for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
        const px = x + 0.5, py = y + 0.5
        let inside = false, d = Infinity
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[j]!, b = pts[i]!
          if ((b[1] > py) !== (a[1] > py) && px < ((a[0] - b[0]) * (py - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside
          const dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy || 1e-9
          const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / ll))
          const ex = px - a[0] - dx * t, ey = py - a[1] - dy * t
          d = Math.min(d, ex * ex + ey * ey)
        }
        const sd = Math.sqrt(d)
        const c = inside ? Math.min(1, 0.5 + sd) : Math.max(0, 0.5 - sd)
        if (c > 0) cov[y * w + x] = c
      }
    } else {
      const R = p.r + (p.ring ? p.ring.width : 0)
      const bx0 = Math.max(0, Math.floor(p.c[0] - R - 1)), bx1 = Math.min(w, Math.ceil(p.c[0] + R + 1)), by0 = Math.max(0, Math.floor(p.c[1] - R - 1)), by1 = Math.min(h, Math.ceil(p.c[1] + R + 1))
      if (p.ring) {
        const [rr, rg, rb] = rgb(p.ring.color)
        for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
          const d = Math.hypot(x + 0.5 - p.c[0], y + 0.5 - p.c[1])
          const c = Math.max(0, Math.min(1, R + 0.5 - d)) * (p.alpha ?? 1)
          if (c <= 0) continue
          const k = (y * w + x) * 4, ia = 1 - c
          acc[k] = rr * c + acc[k]! * ia; acc[k + 1] = rg * c + acc[k + 1]! * ia; acc[k + 2] = rb * c + acc[k + 2]! * ia; acc[k + 3] = c + acc[k + 3]! * ia
        }
      }
      mark(bx0, by0, bx1, by1)
      for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
        const d = Math.hypot(x + 0.5 - p.c[0], y + 0.5 - p.c[1])
        const c = p.r + 0.5 - d
        if (c > 0) cov[y * w + x] = Math.min(1, c)
      }
    }
    const [r, g, b] = rgb(p.color)
    const al = p.alpha ?? 1
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = y * w + x, c = cov[k]! * al
      if (c <= 0) continue
      const o = k * 4, ia = 1 - c
      acc[o] = r * c + acc[o]! * ia; acc[o + 1] = g * c + acc[o + 1]! * ia; acc[o + 2] = b * c + acc[o + 2]! * ia; acc[o + 3] = c + acc[o + 3]! * ia
    }
  }
  const out = new Uint8Array(w * h * 4)
  for (let k = 0; k < w * h; k++) {
    const a = acc[k * 4 + 3]!
    if (a <= 0) continue
    out[k * 4] = Math.round(acc[k * 4]! / a); out[k * 4 + 1] = Math.round(acc[k * 4 + 1]! / a); out[k * 4 + 2] = Math.round(acc[k * 4 + 2]! / a); out[k * 4 + 3] = Math.round(a * 255)
  }
  return out
}

export function polylineLength(pts: V[]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
  return l
}

/** The first `t` (0..1) of a polyline by arc length: stroke-dashoffset. */
export function trim(pts: V[], t: number): V[] {
  if (t >= 1) return pts
  if (t <= 0 || pts.length < 2) return pts.slice(0, 1)
  const target = polylineLength(pts) * t
  const out: V[] = [pts[0]!]
  let l = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, s = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l + s >= target) { const k = (target - l) / s; out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); return out }
    out.push(b); l += s
  }
  return out
}

export function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 48): V[] {
  const out: V[] = []
  for (let i = 0; i <= steps; i++) { const a = a0 + ((a1 - a0) * i) / steps; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]) }
  return out
}

/** Play triangle → pause bars as two quads whose vertices interpolate (a path tween). */
export function playPause(cx: number, cy: number, s: number, t: number): V[][] {
  const L = (a: V, b: V): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const h = s, x0 = cx - s * 0.42, x1 = cx + s * 0.58, xm = (x0 + x1) / 2, ym = cy
  const play1: V[] = [[x0, cy - h / 2], [xm, cy - h / 4], [xm, cy + h / 4], [x0, cy + h / 2]]
  const play2: V[] = [[xm, cy - h / 4], [x1, ym], [x1, ym], [xm, cy + h / 4]]
  const bw = s * 0.3, gap = s * 0.22
  const p1: V[] = [[cx - gap / 2 - bw, cy - h / 2], [cx - gap / 2, cy - h / 2], [cx - gap / 2, cy + h / 2], [cx - gap / 2 - bw, cy + h / 2]]
  const p2: V[] = [[cx + gap / 2, cy - h / 2], [cx + gap / 2 + bw, cy - h / 2], [cx + gap / 2 + bw, cy + h / 2], [cx + gap / 2, cy + h / 2]]
  return [play1.map((v, i) => L(v, p1[i]!)), play2.map((v, i) => L(v, p2[i]!))]
}
