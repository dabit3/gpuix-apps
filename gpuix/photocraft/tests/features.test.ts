import { describe, expect, test } from 'bun:test'
import { levelsLut, makeAdjuster } from '../src/core/adjust'
import { Editor } from '../src/core/editor'
import { affineBuf, featherMask, flipBuf, resizeBuf, rotateBuf } from '../src/core/geometry'
import { loadFont, renderText } from '../src/core/text'
import { fuzzyScore, searchCommands } from '../src/ui/commands'

const ramp = (w: number, h: number) => {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([x * 4, y * 4, 100, 255], (y * w + x) * 4)
  return px
}
const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4))

describe('canvas geometry', () => {
  test('crop, rotate, flip and resize remap every layer, mask and the selection, and undo restores them', () => {
    const ed = Editor.fromImage({ width: 60, height: 40, data: ramp(60, 40) }, 'r.png')
    ed.addMask(false)
    ed.selectRect({ x0: 10, y0: 10, x1: 20, y1: 20 })
    const before = ed.flattened().data.slice()
    expect(ed.crop({ x0: 5, y0: 8, x1: 45, y1: 38 })).toBe(true)
    expect([ed.doc.width, ed.doc.height]).toEqual([40, 30])
    expect(at((ed.doc.layers[0] as any).pixels, 40, 0, 0)).toEqual([20, 32, 100, 255])
    expect(ed.doc.layers[0]!.mask!.length).toBe(40 * 30)
    expect(ed.selectionBounds).toEqual({ x0: 5, y0: 2, x1: 15, y1: 12 })
    ed.rotateCanvas(1)
    expect([ed.doc.width, ed.doc.height]).toEqual([30, 40])
    ed.flipCanvas('h')
    ed.resizeImage(15, 20)
    expect([ed.doc.width, ed.doc.height]).toEqual([15, 20])
    for (let i = 0; i < 4; i++) ed.undo()
    expect([ed.doc.width, ed.doc.height]).toEqual([60, 40])
    expect(ed.flattened().data).toEqual(before)
    expect(ed.comp.length).toBe(60 * 40 * 4)
  })

  test('buffer helpers: quarter turns compose to identity, flips are involutions, resize keeps flat colour', () => {
    const px = ramp(7, 5)
    let r = px
    let w = 7
    let h = 5
    for (let i = 0; i < 4; i++) {
      r = rotateBuf(r, w, h, 4, 1)
      ;[w, h] = [h, w]
    }
    expect(r).toEqual(px)
    expect(flipBuf(flipBuf(px, 7, 5, 4, 'v'), 7, 5, 4, 'v')).toEqual(px)
    const flat = new Uint8ClampedArray(20 * 10 * 4).fill(200)
    const small = resizeBuf(flat, 20, 10, 4, 7, 3)
    expect(small.length).toBe(7 * 3 * 4)
    expect(Math.min(...small)).toBeGreaterThanOrEqual(199)
  })

  test('affine resample: identity copies, 2× scale doubles the box, 90° turns it', () => {
    const w = 40
    const px = new Uint8ClampedArray(w * w * 4)
    for (let y = 10; y < 20; y++) for (let x = 10; x < 30; x++) px.set([255, 0, 0, 255], (y * w + x) * 4)
    const box = { x0: 10, y0: 10, x1: 30, y1: 20 }
    expect(affineBuf(px, w, w, box, { cx: 20, cy: 15, sx: 1, sy: 1, rot: 0 }).out).toEqual(px)
    const big = affineBuf(px, w, w, box, { cx: 20, cy: 20, sx: 1.5, sy: 2, rot: 0 })
    expect(big.rect).toEqual({ x0: 5, y0: 10, x1: 36, y1: 31 })
    const turned = affineBuf(px, w, w, box, { cx: 20, cy: 20, sx: 1, sy: 1, rot: Math.PI / 2 }).out
    expect(turned[(28 * w + 20) * 4 + 3]).toBe(255)
    expect(turned[(20 * w + 28) * 4 + 3]).toBe(0)
  })
})

describe('free transform, clone, heal', () => {
  test('transform previews live, Esc restores, Enter commits one undoable step', () => {
    const ed = Editor.blank(50, 50)
    ed.addLayer()
    ed.selectRect({ x0: 10, y0: 10, x1: 20, y1: 20 })
    ed.fill(15, 15)
    ed.deselect()
    const orig = (ed.layer as any).pixels.slice()
    expect(ed.beginTransform()).toBe(true)
    ed.setTransform({ cx: 35, cy: 35 })
    expect(at((ed.layer as any).pixels, 50, 35, 35)[3]).toBe(255)
    ed.cancelTransform()
    expect((ed.layer as any).pixels).toEqual(orig)
    ed.beginTransform()
    ed.setTransform({ sx: 2, sy: 2 })
    ed.commitTransform()
    expect(ed.history.entries.at(-1)!.label).toBe('Free Transform')
    expect(at((ed.layer as any).pixels, 50, 7, 7)[3]).toBe(255)
    ed.undo()
    expect((ed.layer as any).pixels).toEqual(orig)
  })

  test('clone stamp copies from the Alt-click source; spot healing fills a blemish from its surroundings', () => {
    const w = 80
    const h = 60
    const px = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) px.set([120, 140, 160, 255], i * 4)
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) px.set([250, 20, 20, 255], (y * w + x) * 4)
    const ed = Editor.fromImage({ width: w, height: h, data: px }, 'p.png')
    ed.tool = 'clone'
    ed.brush = { size: 8, hardness: 1, opacity: 1, flow: 1, spacing: 0.1 }
    expect(ed.beginStroke(15, 15)).toBe(false) // first click without a source sets it
    expect(ed.cloneSource).toEqual({ x: 15, y: 15 })
    ed.beginStroke(55, 40)
    ed.endStroke()
    expect(at((ed.layer as any).pixels, w, 55, 40)).toEqual([250, 20, 20, 255])
    ed.tool = 'heal'
    ed.brush.size = 18
    ed.beginStroke(15, 15)
    ed.strokeTo(15.5, 15)
    ed.endStroke()
    expect(ed.history.entries.at(-1)!.label).toBe('Spot Healing')
    const c = at((ed.layer as any).pixels, w, 15, 15)
    expect(Math.abs(c[0]! - 120)).toBeLessThan(20)
    expect(Math.abs(c[1]! - 140)).toBeLessThan(20)
  })
})

describe('type layers', () => {
  test('typing renders glyphs live; commit is one undo step; project files keep the text editable', () => {
    expect(loadFont()).not.toBeNull()
    const ed = Editor.blank(300, 120, [0, 0, 0])
    ed.fg = [255, 255, 255]
    ed.textSize = 48
    ed.beginText(20, 60)
    for (const ch of 'Hello') ed.typeText(ch)
    const L = ed.layer as any
    expect(L.text.content).toBe('Hello')
    expect(L.pixels.some((v: number, i: number) => i % 4 === 3 && v > 200)).toBe(true)
    ed.commitText()
    expect(ed.history.entries.at(-1)!.label).toBe('Type Layer')
    expect(ed.doc.layers.length).toBe(2)
    expect(ed.layer!.name).toBe('Hello')
    ed.beginText(30, 60)
    ed.backspaceText()
    ed.commitText()
    expect((ed.layer as any).text.content).toBe('Hell')
    const re = Editor.openProject(ed.saveProject())
    expect((re.doc.layers[1] as any).text.content).toBe('Hell')
    expect(re.flattened().data).toEqual(ed.flattened().data)
    ed.undo()
    expect((ed.layer as any).text.content).toBe('Hello')
    ed.undo()
    expect(ed.doc.layers.length).toBe(1)
  })

  test('empty type is discarded and painting rasterizes (undo brings the live text back)', () => {
    const ed = Editor.blank(200, 100)
    ed.beginText(10, 50)
    ed.commitText()
    expect(ed.doc.layers.length).toBe(1)
    ed.beginText(10, 50)
    ed.typeText('Hi')
    ed.commitText()
    ed.tool = 'brush'
    ed.beginStroke(10, 10)
    ed.endStroke()
    expect((ed.layer as any).text).toBeUndefined()
    ed.undo()
    expect((ed.layer as any).text.content).toBe('Hi')
    const px = renderText({ content: 'A', x: 0, y: 40, size: 40, color: [1, 2, 3] }, 60, 50)
    expect(px.some((v, i) => i % 4 === 3 && v === 255)).toBe(true)
  })
})

describe('adjustments, selection and layers', () => {
  test('levels maps input black/white to output range with midtone gamma; color balance keeps luminosity', () => {
    const lut = levelsLut({ inBlack: 0.2, gamma: 1, inWhite: 0.8, outBlack: 0, outWhite: 1 })
    expect(lut[51]).toBeCloseTo(0, 2)
    expect(lut[204]).toBeCloseTo(1, 2)
    expect(lut[128]).toBeCloseTo((128 / 255 - 0.2) / 0.6, 2)
    const bright = levelsLut({ inBlack: 0, gamma: 2, inWhite: 1, outBlack: 0, outWhite: 1 })
    expect(bright[128]!).toBeGreaterThan(0.65)
    const cb = makeAdjuster({ kind: 'color-balance', cyanRed: 80, magentaGreen: 0, yellowBlue: 0, preserveLuminosity: true })
    const o = [0, 0, 0]
    cb(0.5, 0.5, 0.5, o)
    expect(o[0]!).toBeGreaterThan(o[1]!)
    expect(0.3 * o[0]! + 0.59 * o[1]! + 0.11 * o[2]!).toBeCloseTo(0.5, 2)
  })

  test('feather softens a hard selection edge; merge down and flatten bake layers', () => {
    const m = new Uint8Array(40 * 40)
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) m[y * 40 + x] = 255
    const f = featherMask(m, 40, 40, 6)
    expect(f[20 * 40 + 20]!).toBeGreaterThan(240)
    expect(f[20 * 40 + 10]!).toBeGreaterThan(60)
    expect(f[20 * 40 + 10]!).toBeLessThan(200)
    const ed = Editor.blank(20, 20, [0, 0, 0])
    ed.addLayer()
    ed.fg = [255, 0, 0]
    ed.fill(5, 5)
    ed.setOpacity(0.5)
    const flat = ed.flattened().data.slice()
    ed.mergeDown()
    expect(ed.doc.layers.length).toBe(1)
    const merged = ed.flattened().data
    expect(Math.max(...merged.map((v, i) => Math.abs(v - flat[i]!)))).toBeLessThanOrEqual(1)
    ed.undo()
    expect(ed.doc.layers.length).toBe(2)
    ed.addAdjustment('invert')
    ed.flattenImage()
    expect(ed.doc.layers.length).toBe(1)
  })

  test('command palette search ranks word-start matches first', () => {
    const ed = Editor.blank(10, 10)
    expect(searchCommands('lev', ed)[0]!.id).toBe('adj-levels')
    expect(searchCommands('gau', ed)[0]!.id).toBe('filter-gaussian')
    expect(searchCommands('free tr', ed)[0]!.id).toBe('transform')
    expect(fuzzyScore('xyz', 'Levels')).toBe(-1)
  })
})
