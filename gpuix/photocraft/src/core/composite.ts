import { makeAdjuster } from './adjust'
import { BLEND_MODES, blendChannel, blendNonSeparable, isSeparable, type BlendMode } from './blend'
import type { Doc, Rect } from './doc'


/**
 * Flatten the layer stack into `out` (straight RGBA, doc-sized) for the pixels inside `r` only, so a brush dab
 * re-composites a few hundred pixels instead of the whole photo.
 */
export function compositeRect(doc: Doc, out: Uint8ClampedArray, r: Rect) {
  const W = doc.width
  const rw = r.x1 - r.x0
  if (rw <= 0 || r.y1 <= r.y0) return
  const R = new Float32Array(rw)
  const G = new Float32Array(rw)
  const B = new Float32Array(rw)
  const A = new Float32Array(rw)
  const o3 = [0, 0, 0]
  const layers = doc.layers.filter((l) => l.visible && l.opacity > 0)
  const adjusters = layers.map((l) => (l.kind === 'adjust' ? makeAdjuster(l.adjust) : null))
  for (let y = r.y0; y < r.y1; y++) {
    R.fill(0)
    G.fill(0)
    B.fill(0)
    A.fill(0)
    const rowBase = y * W
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li]!
      const mask = L.mask
      const op = L.opacity
      if (L.kind === 'adjust') {
        const adj = adjusters[li]!
        for (let i = 0; i < rw; i++) {
          if (A[i]! <= 0) continue
          const p = rowBase + r.x0 + i
          const k = mask ? (op * mask[p]!) / 255 : op
          if (k <= 0) continue
          adj(R[i]!, G[i]!, B[i]!, o3)
          R[i]! += (o3[0]! - R[i]!) * k
          G[i]! += (o3[1]! - G[i]!) * k
          B[i]! += (o3[2]! - B[i]!) * k
        }
        continue
      }
      const px = L.pixels
      const mode = L.blend
      const sep = isSeparable(mode)
      const normal = mode === 'normal'
      for (let i = 0; i < rw; i++) {
        const p = rowBase + r.x0 + i
        const q = p * 4
        let as = (px[q + 3]! / 255) * op
        if (mask) as *= mask[p]! / 255
        if (as <= 0) continue
        const sr = px[q]! / 255
        const sg = px[q + 1]! / 255
        const sb = px[q + 2]! / 255
        const ab = A[i]!
        if (ab <= 0) {
          R[i] = sr
          G[i] = sg
          B[i] = sb
          A[i] = as
          continue
        }
        const br = R[i]!
        const bg = G[i]!
        const bb = B[i]!
        let mr: number, mg: number, mb: number
        if (normal) {
          mr = sr
          mg = sg
          mb = sb
        } else if (sep) {
          mr = blendChannel(mode, br, sr)
          mg = blendChannel(mode, bg, sg)
          mb = blendChannel(mode, bb, sb)
        } else {
          blendNonSeparable(mode, br, bg, bb, sr, sg, sb, o3)
          mr = o3[0]!
          mg = o3[1]!
          mb = o3[2]!
        }
        const ao = as + ab * (1 - as)
        const k = (1 - as) * ab
        R[i] = (as * ((1 - ab) * sr + ab * mr) + k * br) / ao
        G[i] = (as * ((1 - ab) * sg + ab * mg) + k * bg) / ao
        B[i] = (as * ((1 - ab) * sb + ab * mb) + k * bb) / ao
        A[i] = ao
      }
    }
    let q = (rowBase + r.x0) * 4
    for (let i = 0; i < rw; i++, q += 4) {
      out[q] = R[i]! * 255 + 0.5
      out[q + 1] = G[i]! * 255 + 0.5
      out[q + 2] = B[i]! * 255 + 0.5
      out[q + 3] = A[i]! * 255 + 0.5
    }
  }
}

export function flatten(doc: Doc): Uint8ClampedArray {
  const out = new Uint8ClampedArray(doc.width * doc.height * 4)
  compositeRect(doc, out, { x0: 0, y0: 0, x1: doc.width, y1: doc.height })
  return out
}
