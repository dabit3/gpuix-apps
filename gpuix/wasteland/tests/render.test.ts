import { describe, expect, it } from 'bun:test'
import { newGame } from '../src/engine/game'
import { createBuffers, renderFrame, type View } from '../src/render/frame'
import { tileCenter } from '../src/render/iso'
import { districtMap, portrait, weaponArt } from '../src/render/art2d'

describe('procedural renderer', () => {
  it('paints a non-empty, varied isometric frame fast', () => {
    const s = newGame()
    const fb = createBuffers(640, 400)
    const view: View = { width: 640, height: 400, time: 1000, cam: tileCenter(s.player.x, s.player.y), zoom: 2, hover: null, anim: new Map(), shots: [] }
    renderFrame(s, view, fb)
    const t0 = performance.now()
    for (let i = 0; i < 10; i++) { view.time += 16; renderFrame(s, view, fb) }
    const ms = (performance.now() - t0) / 10
    const colors = new Set<number>()
    const u32 = new Uint32Array(fb.out.buffer)
    for (let i = 0; i < u32.length; i += 37) colors.add(u32[i]!)
    expect(colors.size).toBeGreaterThan(40)
    expect(ms).toBeLessThan(40)
  })
  it('portraits differ per NPC and weapons show wear', () => {
    const a = portrait({ hair: 'afro', beard: 1 }, 'a'), b = portrait({ hair: 'bun', glasses: 1 }, 'b')
    expect(Buffer.compare(Buffer.from(a.lum), Buffer.from(b.lum))).not.toBe(0)
    const sum = (x: Uint8Array) => x.reduce((p, v) => p + v, 0)
    expect(sum(weaponArt('scrap_rifle', 20).lum)).toBeLessThan(sum(weaponArt('scrap_rifle', 100).lum))
    expect(districtMap([{ x: 5, y: 28, kind: 'player' }], 0).lum.some((v) => v === 255)).toBe(true)
  })
})
