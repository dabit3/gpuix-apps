export interface Layout {
  w: number
  h: number
  /** Cell size in px; everything scales from it. */
  c: number
  kind: 'wide' | 'narrow'
  bx: number
  by: number
  bw: number
  bh: number
  sideW: number
  gap: number
  leftX: number
  rightX: number
}

const SIDE = 4.8
const GAP = 0.8

/** Fits a 10x20 well plus side panels into any pane: two side columns when wide, one when narrow. */
export function computeLayout(w: number, h: number): Layout {
  const pad = Math.max(10, Math.min(w, h) * 0.03)
  const vert = (h - pad * 2) / 20
  const wideC = Math.min(vert, (w - pad * 2) / (10 + 2 * (SIDE + GAP)))
  const narrowC = Math.min(vert, (w - pad * 2) / (10 + SIDE + GAP))
  const kind = wideC >= narrowC * 0.92 ? 'wide' : 'narrow'
  const c = Math.max(6, Math.floor(kind === 'wide' ? wideC : narrowC))
  const bw = c * 10, bh = c * 20, sideW = Math.round(c * SIDE), gap = Math.round(c * GAP)
  const total = kind === 'wide' ? bw + 2 * (sideW + gap) : bw + sideW + gap
  const x0 = Math.round((w - total) / 2)
  const by = Math.round((h - bh) / 2)
  if (kind === 'wide') {
    const leftX = x0, bx = x0 + sideW + gap
    return { w, h, c, kind, bx, by, bw, bh, sideW, gap, leftX, rightX: bx + bw + gap }
  }
  return { w, h, c, kind, bx: x0, by, bw, bh, sideW, gap, leftX: x0, rightX: x0 + bw + gap }
}
