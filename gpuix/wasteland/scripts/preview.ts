// Renders world frames to raw RGBA for visual checks: bun scripts/preview.ts out.rgba x y zoom
import { newGame, startCombat, openTarget, liveActors } from '../src/engine/game'
import { renderFrame, createBuffers } from '../src/render/frame'
import { tileCenter } from '../src/render/iso'
const [out = '/tmp/frame.rgba', xs = '', ys = '', zs = '2', mode = ''] = process.argv.slice(2)
const s = newGame()
if (xs) { s.player.x = Number(xs); s.player.y = Number(ys) }
if (mode === 'target') { startCombat(s); const a = liveActors(s).find((a) => a.engaged); if (a) openTarget(s, a.id) }
const W = 1000, H = 700
const fb = createBuffers(W, H)
const t0 = performance.now()
const view = { width: W, height: H, time: 1234, cam: tileCenter(s.player.x, s.player.y) as [number, number], zoom: Number(zs), hover: [s.player.x + 1, s.player.y] as [number, number], anim: new Map(), shots: [] }
renderFrame(s, view, fb)
const t1 = performance.now()
for (let i = 0; i < 20; i++) { view.time += 16; renderFrame(s, view, fb) }
console.log('first', (t1 - t0).toFixed(1), 'ms; steady', ((performance.now() - t1) / 20).toFixed(2), 'ms/frame')
await Bun.write(out, fb.out)
