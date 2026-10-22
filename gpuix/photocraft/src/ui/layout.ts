export interface Layout {
  w: number
  h: number
  top: number
  /** Menu bar row; the tool options row sits under it, filling the rest of `top`. */
  menu: number
  status: number
  rail: number
  panel: number
  canvas: { x: number; y: number; w: number; h: number }
  compactTop: boolean
  showHistory: boolean
}

/** Full pane: rail + canvas + 296 px panel. A half split keeps a slimmer panel; very narrow panes give the canvas everything. */
export function computeLayout(w: number, h: number): Layout {
  w = Math.max(320, Math.floor(w))
  h = Math.max(240, Math.floor(h))
  const menu = 34
  const top = menu + 40
  const status = 28
  const rail = 52
  const panel = w >= 1100 ? 296 : w >= 640 ? 236 : 0
  return {
    w,
    h,
    top,
    menu,
    status,
    rail,
    panel,
    canvas: { x: rail, y: top, w: w - rail - panel, h: h - top - status },
    compactTop: w < 1100,
    showHistory: h >= 760,
  }
}
