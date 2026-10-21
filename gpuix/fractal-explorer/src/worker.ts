/// <reference lib="webworker" />
/**
 * Tile worker. Receives TileJobs with a SharedArrayBuffer target and a slot in
 * a shared generation array; aborts mid-tile once the main thread bumps that
 * generation.
 */
import { buildLut, interiorColor, paletteById, renderTile, type PaletteId, type TileJob } from './fractal'

declare const self: Worker

export interface WorkerJob extends TileJob {
  id: number
  palette: PaletteId
  target: SharedArrayBuffer
  gens: SharedArrayBuffer
  slot: number
  gen: number
}

export interface WorkerResult {
  id: number
  aborted: boolean
  iters: number
  ms: number
}

const luts = new Map<PaletteId, { lut: Uint32Array; interior: number }>()

function lutFor(id: PaletteId) {
  let entry = luts.get(id)
  if (!entry) {
    const p = paletteById(id)
    entry = { lut: buildLut(p), interior: interiorColor(p) }
    luts.set(id, entry)
  }
  return entry
}

self.onmessage = (event: MessageEvent<WorkerJob>) => {
  const job = event.data
  const t0 = performance.now()
  const gens = new Int32Array(job.gens)
  const out = new Uint32Array(job.target)
  const { lut, interior } = lutFor(job.palette)
  const iters = renderTile(job, out, lut, interior, () => Atomics.load(gens, job.slot) !== job.gen)
  const result: WorkerResult = { id: job.id, aborted: iters < 0, iters: Math.max(0, iters), ms: performance.now() - t0 }
  self.postMessage(result)
}
