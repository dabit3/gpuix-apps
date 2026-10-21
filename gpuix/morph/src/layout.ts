import type { Aspect } from './controller'

export interface AppLayout {
  w: number; h: number
  narrow: boolean
  top: { h: number }
  art: { x: number; y: number; w: number; h: number }
  tl: { x: number; y: number; w: number; h: number; trackX: number; trackW: number; trackY: number; labels: boolean }
}

/** Reflows for a full Ghostty pane, a half split, or a short pane: top bar, the artboard as big as fits, a timeline. */
export function computeLayout(w: number, h: number, aspect: Aspect): AppLayout {
  const narrow = w < 820
  const top = { h: narrow ? 40 : 48 }
  const tlH = narrow ? 92 : 104
  const pad = narrow ? 14 : 22
  const availW = w - pad * 2, availH = h - top.h - tlH - pad
  const ratio = aspect === 'square' ? 1 : 1350 / 1080
  let aw = Math.min(availW, availH / ratio)
  aw = Math.max(80, Math.floor(aw))
  const ah = Math.floor(aw * ratio)
  const art = { x: Math.round((w - aw) / 2), y: Math.round(top.h + (availH - ah) / 2), w: aw, h: ah }
  const tlW = Math.min(w - pad * 2, narrow ? 10000 : Math.max(aw, Math.min(1100, w - pad * 2)))
  const tlX = Math.round((w - tlW) / 2)
  const ctrl = narrow ? 132 : 200
  const right = narrow ? 0 : 236
  const tl = { x: tlX, y: h - tlH, w: tlW, h: tlH, trackX: tlX + ctrl, trackW: Math.max(60, tlW - ctrl - right), trackY: h - tlH + (narrow ? 44 : 52), labels: !narrow }
  return { w, h, narrow, top, art, tl }
}
