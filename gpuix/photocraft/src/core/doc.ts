import type { Adjust } from './adjust'
import type { BlendMode } from './blend'

export interface LayerBase {
  id: number
  name: string
  visible: boolean
  opacity: number
  blend: BlendMode
  /** 8-bit layer mask (255 = shown), or null. */
  mask: Uint8Array | null
}

export interface PixelLayer extends LayerBase {
  kind: 'pixel'
  /** Straight-alpha RGBA, doc.width × doc.height. */
  pixels: Uint8ClampedArray
}

export interface AdjustLayer extends LayerBase {
  kind: 'adjust'
  adjust: Adjust
}

export type Layer = PixelLayer | AdjustLayer

export interface Doc {
  width: number
  height: number
  /** Bottom → top. */
  layers: Layer[]
  name: string
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

let nextId = 1
export const newId = () => nextId++
export const bumpIds = (min: number) => {
  if (nextId <= min) nextId = min + 1
}

export function pixelLayer(w: number, h: number, name: string, pixels?: Uint8ClampedArray): PixelLayer {
  return { id: newId(), kind: 'pixel', name, visible: true, opacity: 1, blend: 'normal', mask: null, pixels: pixels ?? new Uint8ClampedArray(w * h * 4) }
}

export function adjustLayer(name: string, adjust: Adjust): AdjustLayer {
  return { id: newId(), kind: 'adjust', name, visible: true, opacity: 1, blend: 'normal', mask: null, adjust }
}

export const fullRect = (d: { width: number; height: number }): Rect => ({ x0: 0, y0: 0, x1: d.width, y1: d.height })

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x0))
  const y0 = Math.max(0, Math.floor(r.y0))
  const x1 = Math.min(w, Math.ceil(r.x1))
  const y1 = Math.min(h, Math.ceil(r.y1))
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}
