// Stroke engine: Catmull-Rom smoothing through the input points, then dabs placed at a fixed spacing along the curve.

export type Pt = { x: number; y: number }

export function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  }
}

export class StrokeEngine {
  private pts: Pt[] = []
  private carry = 0
  private last: Pt | null = null
  dabs = 0

  constructor(
    public spacing: number,
    private onDab: (x: number, y: number) => void,
  ) {}

  add(x: number, y: number) {
    const p = { x, y }
    const prev = this.pts[this.pts.length - 1]
    if (prev && Math.hypot(prev.x - x, prev.y - y) < 0.5) return
    this.pts.push(p)
    const n = this.pts.length
    if (n === 1) {
      this.dab(p)
      this.last = p
      return
    }
    // Emit the segment ending one point behind the newest, so it has a real next-point tangent.
    if (n >= 3) this.segment(this.pts[n - 4] ?? this.pts[n - 3]!, this.pts[n - 3]!, this.pts[n - 2]!, p)
    if (this.pts.length > 8) this.pts.splice(0, this.pts.length - 4)
  }

  end() {
    const n = this.pts.length
    if (n >= 2) this.segment(this.pts[n - 3] ?? this.pts[n - 2]!, this.pts[n - 2]!, this.pts[n - 1]!, this.pts[n - 1]!)
    this.pts = []
    this.last = null
    this.carry = 0
  }

  private segment(p0: Pt, p1: Pt, p2: Pt, p3: Pt) {
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const steps = Math.max(2, Math.ceil(chord / 0.75))
    let prev = this.last ?? p1
    for (let s = 1; s <= steps; s++) {
      const q = catmullRom(p0, p1, p2, p3, s / steps)
      let seg = Math.hypot(q.x - prev.x, q.y - prev.y)
      let from = prev
      while (this.carry + seg >= this.spacing) {
        const need = this.spacing - this.carry
        const t = need / seg
        const d = { x: from.x + (q.x - from.x) * t, y: from.y + (q.y - from.y) * t }
        this.dab(d)
        seg -= need
        from = d
        this.carry = 0
      }
      this.carry += seg
      prev = q
    }
    this.last = prev
  }

  private dab(p: Pt) {
    this.dabs++
    this.onDab(p.x, p.y)
  }
}

/** Brush tip falloff: 1 inside the hard core, smoothstep to 0 at the edge. Always keeps ~1 px of antialiasing. */
export function falloff(d: number, radius: number, hardness: number) {
  if (d >= radius) return 0
  const core = Math.min(hardness, 1 - 1 / Math.max(1, radius)) * radius
  if (d <= core) return 1
  const t = (d - core) / (radius - core)
  return 1 - t * t * (3 - 2 * t)
}

/** Accumulate one dab into a coverage buffer (0..1) with flow; returns the touched rect. */
export function stampDab(cov: Float32Array, w: number, h: number, cx: number, cy: number, radius: number, hardness: number, flow: number) {
  const x0 = Math.max(0, Math.floor(cx - radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const x1 = Math.min(w, Math.ceil(cx + radius) + 1)
  const y1 = Math.min(h, Math.ceil(cy + radius) + 1)
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - cy
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx
      const a = falloff(Math.sqrt(dx * dx + dy * dy), radius, hardness) * flow
      if (a <= 0) continue
      const i = y * w + x
      cov[i]! += (1 - cov[i]!) * a
    }
  }
  return { x0, y0, x1, y1 }
}
