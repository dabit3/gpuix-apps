import { describe, expect, test } from 'bun:test'
import { curveLut, makeAdjuster } from '../src/core/adjust'
import { BLEND_MODES, blendChannel, compositePixel } from '../src/core/blend'
import { StrokeEngine } from '../src/core/brush'
import { flatten } from '../src/core/composite'
import { Editor } from '../src/core/editor'
import { runFilter } from '../src/core/filters'
import { diffTiles, applyTiles, History } from '../src/core/history'
import { decodeImage, encodeJpeg, encodePng } from '../src/core/io'
import { ellipseMask, magicWand, maskBounds, polygonMask, rectMask } from '../src/core/selection'

const solid = (w: number, h: number, c: number[]) => {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < px.length; i += 4) px.set(c, i)
  return px
}

describe('blend modes (W3C Compositing and Blending formulas)', () => {
  test('separable reference values', () => {
    const b = 0.6
    const s = 0.3
    expect(blendChannel('multiply', b, s)).toBeCloseTo(0.18)
    expect(blendChannel('screen', b, s)).toBeCloseTo(0.72)
    expect(blendChannel('overlay', b, s)).toBeCloseTo(1 - 2 * (1 - b) * (1 - s)) // b > .5 → screen branch
    expect(blendChannel('hard-light', b, s)).toBeCloseTo(2 * b * s)
    expect(blendChannel('darken', b, s)).toBe(0.3)
    expect(blendChannel('lighten', b, s)).toBe(0.6)
    expect(blendChannel('difference', b, s)).toBeCloseTo(0.3)
    expect(blendChannel('exclusion', b, s)).toBeCloseTo(0.6 + 0.3 - 2 * 0.18)
    expect(blendChannel('color-dodge', b, s)).toBeCloseTo(0.6 / 0.7)
    expect(blendChannel('color-burn', b, s)).toBeCloseTo(0)
    // soft light, s <= .5: b - (1-2s) b (1-b)
    expect(blendChannel('soft-light', b, s)).toBeCloseTo(0.6 - 0.4 * 0.6 * 0.4)
    // soft light, s > .5, b > .25: b + (2s-1)(sqrt(b)-b)
    expect(blendChannel('soft-light', 0.6, 0.8)).toBeCloseTo(0.6 + 0.6 * (Math.sqrt(0.6) - 0.6))
  })

  test('every mode composites an opaque layer over an opaque backdrop into range, and luminosity keeps source luma', () => {
    const out = [0, 0, 0, 0]
    for (const m of BLEND_MODES) {
      compositePixel(m, [0.2, 0.5, 0.8, 1], [0.9, 0.1, 0.4], 1, out)
      for (const v of out) expect(v).toBeGreaterThanOrEqual(-1e-6)
      for (const v of out) expect(v).toBeLessThanOrEqual(1 + 1e-6)
      expect(out[3]).toBeCloseTo(1)
    }
    compositePixel('luminosity', [0.2, 0.5, 0.8, 1], [0.9, 0.1, 0.4], 1, out)
    const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b
    expect(lum(out[0]!, out[1]!, out[2]!)).toBeCloseTo(lum(0.9, 0.1, 0.4), 2)
  })

  test('layer opacity: normal at 50% over black is mid grey; transparent layers do nothing', () => {
    const ed = new Editor({ width: 2, height: 1, name: 't', layers: [] })
    ed.doc.layers.push({ id: 1, kind: 'pixel', name: 'b', visible: true, opacity: 1, blend: 'normal', mask: null, pixels: solid(2, 1, [0, 0, 0, 255]) })
    ed.doc.layers.push({ id: 2, kind: 'pixel', name: 'w', visible: true, opacity: 0.5, blend: 'normal', mask: null, pixels: solid(2, 1, [255, 255, 255, 255]) })
    expect(flatten(ed.doc)[0]).toBe(128)
    ed.doc.layers[1]!.visible = false
    expect(flatten(ed.doc)[0]).toBe(0)
  })
})

describe('history', () => {
  test('tile diffs store only changed 64px tiles and restore exactly', () => {
    const w = 300
    const h = 200
    const buf = solid(w, h, [10, 20, 30, 255])
    const before = buf.slice()
    buf[(150 * w + 250) * 4] = 99
    const d = diffTiles(before, buf, w, h, 4)
    expect(d.tiles.length).toBe(1)
    expect(d.tiles[0]!.x).toBe(192)
    applyTiles(d, 'before')
    expect(buf).toEqual(before)
    applyTiles(d, 'after')
    expect(buf[(150 * w + 250) * 4]).toBe(99)
  })

  test('caps steps, merges slider drags, and redo is dropped after a new command', () => {
    const hist = new History(3)
    let v = 0
    const cmd = (to: number, key?: string) => {
      const from = v
      return { label: `set ${to}`, mergeKey: key, redo: () => (v = to), undo: () => (v = from) }
    }
    for (const n of [1, 2, 3, 4, 5]) {
      const c = cmd(n)
      c.redo()
      hist.push(c)
    }
    expect(hist.entries.length).toBe(3)
    for (const n of [6, 7, 8]) {
      const c = cmd(n, 'slider')
      c.redo()
      hist.push(c)
    }
    expect(hist.entries.length).toBe(3)
    hist.undo()
    expect(v).toBe(5)
    hist.push(cmd(9))
    expect(hist.canRedo).toBe(false)
  })
})

describe('selection math', () => {
  test('rect, ellipse, polygon and wand', () => {
    expect(maskBounds(rectMask(100, 100, { x0: 10, y0: 20, x1: 30, y1: 50 }), 100, 100)).toEqual({ x0: 10, y0: 20, x1: 30, y1: 50 })
    const e = ellipseMask(101, 101, { x0: 0, y0: 0, x1: 100, y1: 100 })
    const area = e.reduce((n, v) => n + v / 255, 0)
    expect(area / (Math.PI * 50 * 50)).toBeCloseTo(1, 1)
    const tri = polygonMask(100, 100, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }])
    expect(tri.reduce((n, v) => n + (v ? 1 : 0), 0) / 5000).toBeCloseTo(1, 1)
    const px = solid(10, 10, [0, 0, 0, 255])
    for (let y = 0; y < 10; y++) px.set([255, 255, 255, 255], (y * 10 + 5) * 4) // white wall at x = 5
    expect(magicWand(px, 10, 10, 1, 1, 10, true).reduce((n, v) => n + (v ? 1 : 0), 0)).toBe(50)
    expect(magicWand(px, 10, 10, 1, 1, 10, false).reduce((n, v) => n + (v ? 1 : 0), 0)).toBe(90)
  })
})

describe('stroke engine', () => {
  test('Catmull-Rom stroke places evenly spaced dabs through the points', () => {
    const dabs: { x: number; y: number }[] = []
    const s = new StrokeEngine(5, (x, y) => dabs.push({ x, y }))
    for (let x = 0; x <= 100; x += 20) s.add(x, 0)
    s.end()
    expect(dabs.length).toBeGreaterThanOrEqual(19)
    expect(dabs.length).toBeLessThanOrEqual(22)
    for (let i = 1; i < dabs.length; i++) expect(Math.hypot(dabs[i]!.x - dabs[i - 1]!.x, dabs[i]!.y - dabs[i - 1]!.y)).toBeCloseTo(5, 0)
    for (const d of dabs) expect(Math.abs(d.y)).toBeLessThan(0.01)
  })

  test('brush paints, respects the selection, and undo restores the layer', () => {
    const ed = Editor.blank(200, 100, [0, 0, 0])
    const before = (ed.doc.layers[0] as { pixels: Uint8ClampedArray }).pixels.slice()
    ed.selectRect({ x0: 0, y0: 0, x1: 100, y1: 100 })
    ed.fg = [255, 0, 0]
    ed.brush = { size: 20, hardness: 1, opacity: 1, flow: 1, spacing: 0.1 }
    ed.beginStroke(20, 50)
    ed.strokeTo(180, 50)
    ed.endStroke()
    ed.flush()
    const at = (x: number, y: number) => ed.comp[(y * 200 + x) * 4]!
    expect(at(50, 50)).toBe(255)
    expect(at(150, 50)).toBe(0) // outside the selection
    ed.undo()
    ed.flush()
    expect((ed.doc.layers[0] as { pixels: Uint8ClampedArray }).pixels).toEqual(before)
  })
})

describe('adjustments and filters', () => {
  test('curves LUT passes through its points and is monotone', () => {
    const lut = curveLut([[0, 0], [0.25, 0.18], [0.75, 0.84], [1, 1]])
    expect(lut[0]).toBeCloseTo(0)
    expect(lut[255]).toBeCloseTo(1)
    expect(lut[Math.round(0.75 * 255)]).toBeCloseTo(0.84, 1)
    for (let i = 1; i < 256; i++) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]! - 1e-6)
    const out = [0, 0, 0]
    makeAdjuster({ kind: 'invert' })(0.2, 0.4, 1, out)
    expect(out).toEqual([0.8, 0.6, 0])
  })

  test('gaussian blur keeps flat areas flat and spreads an edge', () => {
    const w = 40
    const px = solid(w, 1, [0, 0, 0, 255])
    for (let x = 20; x < w; x++) px.set([255, 255, 255, 255], x * 4)
    const out = runFilter('gaussian', px, w, 1, 8)
    expect(out[0]).toBe(0)
    expect(out[(w - 1) * 4]).toBe(255)
    expect(out[19 * 4]!).toBeGreaterThan(60)
    expect(out[19 * 4]!).toBeLessThan(200)
  })
})

describe('files', () => {
  test('PNG and JPEG encode/decode', () => {
    const img = { width: 8, height: 4, data: solid(8, 4, [200, 100, 50, 255]) }
    expect(decodeImage(encodePng(img)).data).toEqual(img.data)
    const j = decodeImage(encodeJpeg(img))
    expect(Math.abs(j.data[0]! - 200)).toBeLessThan(6)
  })

  test('acceptance flow: duplicate, blur, soft light 40%, brush a mask, curves, export, save and reopen identically', () => {
    const w = 120
    const h = 80
    const px = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) px.set([(i % w) * 2, (i / w) * 3, 128, 255], i * 4)
    const ed = Editor.fromImage({ width: w, height: h, data: px }, 'photo.png')
    ed.duplicateLayer()
    ed.applyFilter('gaussian', 6)
    ed.setBlend('soft-light')
    ed.setOpacity(0.4)
    ed.addMask()
    expect(ed.editMask).toBe(true)
    ed.brush = { size: 30, hardness: 0.5, opacity: 1, flow: 1, spacing: 0.1 }
    ed.beginStroke(10, 40)
    ed.strokeTo(60, 40)
    ed.endStroke()
    expect(ed.doc.layers[1]!.mask![40 * w + 30]).toBeLessThan(10)
    ed.addAdjustment('curves')
    expect(ed.doc.layers.map((l) => `${l.kind}:${l.blend}:${l.opacity}`)).toEqual(['pixel:normal:1', 'pixel:soft-light:0.4', 'adjust:normal:1'])
    const flat = ed.flattened()
    expect(decodeImage(encodeJpeg(flat)).width).toBe(w)
    const re = Editor.openProject(ed.saveProject())
    expect(re.doc.layers.length).toBe(3)
    expect(re.doc.layers[1]!.blend).toBe('soft-light')
    expect(re.doc.layers[1]!.opacity).toBe(0.4)
    expect(re.doc.layers[1]!.mask).toEqual(ed.doc.layers[1]!.mask)
    expect(re.flattened().data).toEqual(flat.data)
  })
})
