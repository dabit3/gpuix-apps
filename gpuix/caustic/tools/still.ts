// Offline still: bun tools/still.ts out.png [quality] [w] [h] — renders one frame on this thread for look-dev.
import { writeFileSync } from 'node:fs'
import { encodePng } from '../src/png'
import { frameOf, renderRows } from '../src/render'
import { Scene, WATER_LEVEL } from '../src/scene'
import type { QualityName } from '../src/quality'

const [out = '/tmp/still.png', q = 'full', W = '1400', H = '840', ...rest] = process.argv.slice(2)
const extra = Object.fromEntries(rest.map((kv) => kv.split('=')).map(([k, v]) => [k, isNaN(Number(v)) ? v === 'true' ? true : v === 'false' ? false : v : Number(v)]))
const s = new Scene({ quality: q as QualityName, ...extra })
s.drop(-0.3, -0.2, 0.08, 0.03); s.drop(0.35, 0.4, 0.07, 0.03); s.drop(0.1, -0.55, 0.06, -0.025)
for (let i = 0; i < 90; i++) s.advance(1 / 60)
s.caustics.compute(s.water, WATER_LEVEL, s.settings.depth, s.light, s.ball, s.settings.ior)
const w = Number(W), h = Number(H)
const buf = new Uint8Array(w * h * 4)
const t0 = performance.now()
renderRows(frameOf(s, w / h, [10, 12, 16]), buf, w, h, 0, h)
console.log('trace ms', (performance.now() - t0).toFixed(0), 'peak', s.caustics.max().toFixed(2))
writeFileSync(out, encodePng(buf, w, h))
