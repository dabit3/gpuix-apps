import { expect, test } from 'bun:test'
import { Engine } from '../src/engine'
import type { FromEngine } from '../src/protocol'
import { makeSpec } from '../src/probe'

async function frames(settings: Record<string, unknown>, n = 2) {
  const got: FromEngine[] = []
  const e = new Engine({ quality: 'lite', ...settings }, (m) => got.push(m), 4, { dist: 30, pitch: 5 })
  e.handle({ type: 'size', w: 320, h: 180 })
  void e.run()
  const t0 = Date.now()
  while (got.filter((m) => m.type === 'frame').length < n && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 20))
  e.handle({ type: 'stop' })
  const f = got.filter((m) => m.type === 'frame').at(-1)
  if (f?.type !== 'frame') throw new Error('no frame')
  return { px: new Uint8Array(f.buf, 0, f.w * f.h * 4).slice(), w: f.w, h: f.h, e }
}
const lum = (px: Uint8Array, w: number, x: number, y: number) => { const o = (y * w + x) * 4; return px[o]! + px[o + 1]! + px[o + 2]! }

test('engine renders a black shadow with a bright disk, and lensing on/off really changes the picture', async () => {
  const lensed = await frames({ disk: false })
  const { px, w, h } = lensed
  // Shadow at the centre is black; flat space with no disk has no shadow beyond the hole itself.
  expect(lum(px, w, w >> 1, h >> 1)).toBeLessThan(6)
  const flat = await frames({ disk: false, lens: false })
  expect(flat.w).toBe(w)
  let diff = 0
  for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i]! - flat.px[i]!)
  expect(diff / (w * h)).toBeGreaterThan(1)
  const withDisk = await frames({ look: 'physical' })
  let bright = 0
  for (let i = 0; i < withDisk.px.length; i += 4) bright += withDisk.px[i]! + withDisk.px[i + 1]! + withDisk.px[i + 2]!
  expect(bright / (withDisk.w * withDisk.h)).toBeGreaterThan(30)
}, 60000)

test('dropped probes are shared by spec and stay in sync; a dive starts and reports its phase', () => {
  const sent: FromEngine[] = []
  const e = new Engine({}, (m) => sent.push(m), 1)
  e.handle({ type: 'drop', n: 2 })
  const out = sent.find((m) => m.type === 'probes')
  if (out?.type !== 'probes') throw new Error('no probes message')
  expect(out.specs.length).toBe(2)
  expect(e.paths.length).toBe(2)
  const other = new Engine({}, () => {}, 1)
  other.handle({ type: 'drop', specs: out.specs })
  other.handle({ type: 'drop', specs: out.specs })
  expect(other.paths.map((p) => p.spec.id)).toEqual(e.paths.map((p) => p.spec.id))
  e.handle({ type: 'dive' })
  expect(e.dive?.phase).toBe('fall')
  expect(sent).toContainEqual({ type: 'dive', phase: 'start' })
  e.handle({ type: 'stop' }); other.handle({ type: 'stop' })
})

test('a probe from a linked pane starts at t=0 even after this pane was paused', async () => {
  const e = new Engine({}, () => {}, 1)
  e.handle({ type: 'set', settings: { paused: true } })
  await new Promise((r) => setTimeout(r, 300))
  e.handle({ type: 'set', settings: { paused: false } })
  const spec = makeSpec(Date.now())
  e.handle({ type: 'drop', specs: [spec] })
  expect(e.paths).toHaveLength(1)
  const local = (e as unknown as { now(): number }).now() - e.paths[0]!.at0
  expect(Math.abs(local)).toBeLessThan(50)
  e.handle({ type: 'stop' })
})

test('pause freezes the dive', () => {
  const e = new Engine({}, () => {}, 1)
  e.handle({ type: 'dive' })
  e.handle({ type: 'set', settings: { paused: true } })
  const priv = e as unknown as { dive: { r: number } | null; step(dt: number): void }
  const r = priv.dive!.r
  for (let i = 0; i < 30; i++) priv.step(0.1)
  expect(priv.dive!.r).toBe(r)
  e.handle({ type: 'stop' })
})
