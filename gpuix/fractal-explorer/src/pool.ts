/**
 * A pool of Bun Workers that renders rectangles of a SharedArrayBuffer in
 * parallel. Each "pass" belongs to a slot (Mandelbrot, Julia, thumbnails);
 * starting a new pass on a slot cancels the previous one by bumping the
 * slot's generation, which running workers poll once per row.
 */
import type { PaletteId, TileJob } from './fractal'
import type { WorkerJob, WorkerResult } from './worker'

export const SLOT_MAIN = 0
export const SLOT_JULIA = 1
export const SLOT_THUMB = 2

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PassResult {
  aborted: boolean
  ms: number
  iters: number
}

interface Pending {
  job: WorkerJob
  pass: PassState
}

interface PassState {
  slot: number
  gen: number
  remaining: number
  aborted: boolean
  iters: number
  started: number
  priority: number
  resolve: (r: PassResult) => void
  onTile?: (rect: Rect) => void
}

export class WorkerPool {
  readonly size: number
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: Pending[] = []
  private inflight = new Map<number, Pending>()
  private gensBuf = new SharedArrayBuffer(16)
  private gens = new Int32Array(this.gensBuf)
  private nextId = 1

  constructor(size = Math.max(2, (navigator.hardwareConcurrency || 4) - 1)) {
    this.size = size
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url).href)
      w.onmessage = (e: MessageEvent<WorkerResult>) => this.onResult(w, e.data)
      this.workers.push(w)
      this.idle.push(w)
    }
  }

  /** Cancel whatever is running on a slot. */
  cancel(slot: number) {
    Atomics.add(this.gens, slot, 1)
    this.queue = this.queue.filter((p) => {
      if (p.pass.slot !== slot) return true
      p.pass.aborted = true
      this.finishOne(p.pass)
      return false
    })
  }

  /**
   * Render `rects` of `target`. Resolves once every tile has finished or the
   * pass was cancelled. Lower `priority` runs first (the Julia inset uses 0 so
   * it never waits behind a full-resolution Mandelbrot pass).
   */
  run(
    slot: number,
    target: SharedArrayBuffer,
    base: Omit<TileJob, 'x0' | 'y0' | 'x1' | 'y1'>,
    palette: PaletteId,
    rects: Rect[],
    opts: { priority?: number; onTile?: (rect: Rect) => void; cancelPrevious?: boolean } = {},
  ): Promise<PassResult> {
    if (opts.cancelPrevious !== false) this.cancel(slot)
    const gen = Atomics.load(this.gens, slot)
    return new Promise((resolve) => {
      const pass: PassState = {
        slot,
        gen,
        remaining: rects.length,
        aborted: false,
        iters: 0,
        started: performance.now(),
        priority: opts.priority ?? 1,
        resolve,
        onTile: opts.onTile,
      }
      if (rects.length === 0) {
        resolve({ aborted: false, ms: 0, iters: 0 })
        return
      }
      for (const r of rects) {
        const job: WorkerJob = {
          ...base,
          ...r,
          id: this.nextId++,
          palette,
          target,
          gens: this.gensBuf,
          slot,
          gen,
        }
        this.queue.push({ job, pass })
      }
      this.queue.sort((a, b) => a.pass.priority - b.pass.priority)
      this.pump()
    })
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!
      const p = this.queue.shift()!
      this.inflight.set(p.job.id, p)
      w.postMessage(p.job)
    }
  }

  private onResult(w: Worker, r: WorkerResult) {
    this.idle.push(w)
    const p = this.inflight.get(r.id)
    this.inflight.delete(r.id)
    if (p) {
      if (r.aborted) p.pass.aborted = true
      else {
        p.pass.iters += r.iters
        p.pass.onTile?.({ x0: p.job.x0, y0: p.job.y0, x1: p.job.x1, y1: p.job.y1 })
      }
      this.finishOne(p.pass)
    }
    this.pump()
  }

  private finishOne(pass: PassState) {
    pass.remaining--
    if (pass.remaining === 0) {
      pass.resolve({ aborted: pass.aborted, ms: performance.now() - pass.started, iters: pass.iters })
    }
  }

  terminate() {
    for (const w of this.workers) w.terminate()
    this.workers = []
    this.idle = []
  }
}

/** Split a rectangle into tiles, ordered from the centre outward. */
export function tiles(width: number, height: number, tw: number, th: number, area?: Rect): Rect[] {
  const a = area ?? { x0: 0, y0: 0, x1: width, y1: height }
  const out: Rect[] = []
  for (let y = a.y0; y < a.y1; y += th) {
    for (let x = a.x0; x < a.x1; x += tw) {
      out.push({ x0: x, y0: y, x1: Math.min(a.x1, x + tw), y1: Math.min(a.y1, y + th) })
    }
  }
  const cx = width / 2
  const cy = height / 2
  const d = (r: Rect) => ((r.x0 + r.x1) / 2 - cx) ** 2 + ((r.y0 + r.y1) / 2 - cy) ** 2
  return out.sort((p, q) => d(p) - d(q))
}
