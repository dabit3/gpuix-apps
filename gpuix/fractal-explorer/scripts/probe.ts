// Offline probe: render a view with the worker pool and write a PNG.
// bun scripts/probe.ts <re> <im> <width> <iter> <palette> <out>
import { writeFileSync } from 'node:fs'
import { WorkerPool, tiles, SLOT_MAIN } from '../src/pool'
import { encodePng } from '../src/png'
import type { PaletteId } from '../src/fractal'
const [re, im, w, it, pal, out] = process.argv.slice(2)
const W = Number(process.env.PW || 1140), H = Number(process.env.PH || 860)
const pool = new WorkerPool()
const sab = new SharedArrayBuffer(W * H * 4)
const ps = Number(w) / W
for (let k = 0; k < 2; k++) {
  const r = await pool.run(SLOT_MAIN, sab, { kind: 'mandelbrot', width: W, height: H, originRe: Number(re) - (W / 2) * ps, originIm: Number(im) + (H / 2) * ps, pixelSize: ps, maxIter: Number(it), juliaRe: 0, juliaIm: 0, density: 0.22 }, (pal || 'classic') as PaletteId, tiles(W, H, 128, 64))
  console.log(`pass ${k}: ${r.ms.toFixed(1)} ms, ${(r.iters / 1e6).toFixed(1)} M iters, threads ${pool.size}`)
}
writeFileSync(out || 'tmp/probe.png', encodePng(new Uint8Array(sab), W, H))
pool.terminate()
