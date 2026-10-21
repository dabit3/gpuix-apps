/**
 * The explorer engine: owns the camera, the worker pool and the pixel
 * buffers, and pushes finished frames into GPUIX `<img>` elements with
 * `setImagePixels(..., { format: 'bgra' })`.
 *
 * Rendering strategy, per frame:
 *  - Pure pans (drag, whole-pixel moves) shift the existing buffer in place
 *    and only render the newly exposed strips.
 *  - Any other camera change renders a low-res preview sized to fit a ~30 ms
 *    budget (estimated from the cost of the last pass), uploads it, and then,
 *    once the camera settles, refines to full resolution tile by tile,
 *    centre first, uploading progress at ~30 Hz.
 *  - Flights and wheel zoom are time-based animations stepped by this loop,
 *    so slow frames drop resolution, not speed.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { ImgInstance } from '@gpuix/react'
import { type Bookmark, type Camera, type CameraPath, easeInOutCubic, easePath, homeFor, zoomPath } from './camera'
import type { PaletteId, TileJob } from './fractal'
import { encodePng } from './png'
import { type Rect, SLOT_JULIA, SLOT_MAIN, SLOT_THUMB, WorkerPool, tiles } from './pool'

export type Phase = 'idle' | 'preview' | 'refine' | 'pan' | 'flight'

export interface Stats {
  cam: Camera
  maxIter: number
  palette: PaletteId
  phase: Phase
  /** Last full-resolution pass, ms. */
  renderMs: number
  /** Last preview pass, ms. */
  previewMs: number
  /** Preview downscale factor of the last preview (1 = full res). */
  scale: number
  /** Frames pushed to the main image during the last second. */
  fps: number
  /** Millions of iterations per second, last full pass. */
  mips: number
  threads: number
  julia: { re: number; im: number }
  juliaMs: number
  cursor: { re: number; im: number } | null
  flightTo: string | null
  frames: number
  viewW: number
  viewH: number
}

const DENSITY = 0.42
const FULL_TILE = 64
const PREVIEW_BUDGET_MS = 26
const JULIA_VIEW_W = 3.4

const sameCam = (a: Camera | null, b: Camera) => !!a && a.re === b.re && a.im === b.im && a.w === b.w

export class Explorer {
  readonly pool: WorkerPool
  cam: Camera = homeFor(1140, 860)
  maxIter = 600
  palette: PaletteId = 'classic'
  W = 0
  H = 0
  julia = { re: -0.7269, im: 0.1889 }
  cursor: { re: number; im: number } | null = null

  private buf: SharedArrayBuffer | null = null
  private prev: SharedArrayBuffer | null = null
  private bufCam: Camera | null = null
  private bufKey = ''
  private bufComplete = false
  private previewCam: Camera | null = null
  private previewF = 1
  private mainImg: ImgInstance | null = null
  private juliaImg: ImgInstance | null = null
  private dirty = false
  private running = false
  private refining = false
  private path: { fn: CameraPath; start: number; label: string | null; onDone?: () => void } | null = null
  private wheel: { ax: number; ay: number; remaining: number } | null = null
  private lastStep = 0
  private lastIter = 0
  private msPerPx = 4e-5
  private frameTimes: number[] = []
  private frames = 0
  private renderMs = 0
  private previewMs = 0
  private mips = 0
  private phase: Phase = 'idle'
  private copyPixels: boolean | null = null

  private JW = 0
  private JH = 0
  private juliaBuf: SharedArrayBuffer | null = null
  private juliaDirty = false
  private juliaRunning = false
  private juliaMs = 0

  private listeners = new Set<(s: Stats) => void>()
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  private ticker: ReturnType<typeof setInterval>

  constructor(threads?: number) {
    this.pool = new WorkerPool(threads)
    // Keep the fps readout honest after motion stops (it decays to 0).
    this.ticker = setInterval(() => {
      if (this.frameTimes.length) this.emit()
    }, 250)
  }

  // ---------------------------------------------------------------- wiring

  attachMain(img: ImgInstance | null) {
    this.mainImg = img
    if (img && this.buf && this.bufCam) this.upload(img, this.buf, this.W, this.H, true)
  }

  attachJulia(img: ImgInstance | null, width: number, height: number) {
    this.juliaImg = img
    if (width !== this.JW || height !== this.JH) {
      this.JW = width
      this.JH = height
      this.juliaBuf = new SharedArrayBuffer(width * height * 4)
    }
    this.scheduleJulia()
  }

  setView(width: number, height: number) {
    width = Math.max(64, Math.round(width))
    height = Math.max(64, Math.round(height))
    if (width === this.W && height === this.H) return
    const first = this.W === 0
    if (!first) {
      // Keep the same horizontal extent per pixel so a resize reveals more, not stretches.
      this.cam = { ...this.cam, w: (this.cam.w / this.W) * width }
    }
    this.W = width
    this.H = height
    this.buf = new SharedArrayBuffer(width * height * 4)
    this.prev = new SharedArrayBuffer(width * height * 4)
    this.bufCam = null
    this.previewCam = null
    if (first) this.cam = homeFor(width, height)
    this.schedule()
  }

  subscribe(fn: (s: Stats) => void): () => void {
    this.listeners.add(fn)
    fn(this.stats())
    return () => this.listeners.delete(fn)
  }

  dispose() {
    this.disposed = true
    clearInterval(this.ticker)
    this.pool.terminate()
  }

  // ---------------------------------------------------------------- controls

  setPalette(id: PaletteId) {
    if (id === this.palette) return
    this.palette = id
    this.schedule()
    this.scheduleJulia()
  }

  setMaxIter(n: number) {
    n = Math.round(Math.min(10000, Math.max(50, n)))
    if (n === this.maxIter) return
    this.maxIter = n
    this.schedule()
    this.scheduleJulia()
  }

  /** Drag pan by whole screen pixels. */
  panPixels(dx: number, dy: number) {
    if (!this.W) return
    this.cancelMotion()
    const ps = this.cam.w / this.W
    this.cam = { re: this.cam.re - dx * ps, im: this.cam.im + dy * ps, w: this.cam.w }
    this.schedule()
  }

  /** Wheel zoom anchored under the pointer. `log2` > 0 zooms in. Smoothed over ~120 ms. */
  wheelZoom(x: number, y: number, log2: number) {
    if (this.path) this.path = null
    const remaining = (this.wheel?.remaining ?? 0) + log2
    this.wheel = { ax: x, ay: y, remaining: Math.max(-6, Math.min(6, remaining)) }
    this.schedule()
  }

  /** Eased zoom to `factor`× around a view pixel (double-click, +/-). */
  zoomAt(x: number, y: number, factor: number, recentre: boolean, duration = 0.42) {
    if (!this.W) return
    const c = this.pixelToComplex(x, y)
    const w = this.cam.w / factor
    let to: Camera
    if (recentre) to = { re: c.re, im: c.im, w }
    else {
      const ps = w / this.W
      to = { re: c.re - (x - this.W / 2) * ps, im: c.im + (y - this.H / 2) * ps, w }
    }
    this.animateTo(easePath(this.cam, to, duration), null)
  }

  /** Eased pan by a fraction of the view (arrow keys). */
  nudge(fx: number, fy: number) {
    const base = this.path ? this.path.fn(1) : this.cam
    const to = { re: base.re + fx * base.w, im: base.im + fy * base.w, w: base.w }
    this.animateTo(easePath(this.cam, to, 0.28), null)
  }

  zoomBy(factor: number) {
    const base = this.path ? this.path.fn(1) : this.cam
    this.animateTo(easePath(this.cam, { ...base, w: base.w / factor }, 0.32), null)
  }

  reset() {
    this.flyTo(homeFor(this.W, this.H), 'Home', 1.6)
  }

  flyToBookmark(b: Bookmark) {
    this.setMaxIter(b.maxIter)
    this.flyTo(b.cam, b.name)
  }

  flyTo(cam: Camera, label: string | null, speed = 1) {
    const fn = zoomPath(this.cam, cam, speed)
    const eased = ((t: number) => fn(easeInOutCubic(t))) as CameraPath
    eased.duration = fn.duration
    this.animateTo(eased, label)
  }

  isAnimating() {
    return !!this.path || !!this.wheel
  }

  /** Hover: map a view pixel to c and push it to the Julia inset. */
  setCursor(x: number, y: number) {
    if (!this.W) return
    const c = this.pixelToComplex(x, y)
    this.cursor = c
    this.julia = c
    this.scheduleJulia()
    this.emitSoon()
  }

  pixelToComplex(x: number, y: number) {
    const ps = this.cam.w / this.W
    return { re: this.cam.re + (x - this.W / 2) * ps, im: this.cam.im - (y - this.H / 2) * ps }
  }

  /** Render the current view at full resolution and write a PNG. Returns the path. */
  async savePng(dir = join(homedir(), 'Desktop')): Promise<string> {
    const W = this.W
    const H = this.H
    const cam = { ...this.cam }
    const sab = new SharedArrayBuffer(W * H * 4)
    await this.pool.run(SLOT_THUMB, sab, this.job(cam, W, H, 1), this.palette, tiles(W, H, FULL_TILE, FULL_TILE), {
      priority: 2,
      cancelPrevious: false,
    })
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const path = join(dir, `Fractal ${stamp}.png`)
    writeFileSync(path, encodePng(new Uint8Array(sab), W, H))
    return path
  }

  /** A small preview of a bookmark, as BGRA bytes. */
  async thumbnail(b: Bookmark, width: number, height: number, palette: PaletteId): Promise<Uint8Array> {
    const sab = new SharedArrayBuffer(width * height * 4)
    const cam = { ...b.cam, w: b.cam.w * 1.15 }
    const job: Omit<TileJob, 'x0' | 'y0' | 'x1' | 'y1'> = {
      ...this.jobFor(cam, width, height, Math.min(b.maxIter, 3000)),
    }
    await this.pool.run(SLOT_THUMB, sab, job, palette, tiles(width, height, width, Math.ceil(height / 2)), {
      priority: 3,
      cancelPrevious: false,
    })
    return new Uint8Array(sab)
  }

  stats(): Stats {
    const now = performance.now()
    while (this.frameTimes.length && now - this.frameTimes[0]! > 1000) this.frameTimes.shift()
    return {
      cam: { ...this.cam },
      maxIter: this.maxIter,
      palette: this.palette,
      phase: this.phase,
      renderMs: this.renderMs,
      previewMs: this.previewMs,
      scale: this.previewF,
      fps: this.frameTimes.length,
      mips: this.mips,
      threads: this.pool.size,
      julia: { ...this.julia },
      juliaMs: this.juliaMs,
      cursor: this.cursor ? { ...this.cursor } : null,
      flightTo: this.path?.label ?? null,
      frames: this.frames,
      viewW: this.W,
      viewH: this.H,
    }
  }

  /** True once the camera is still and the main view is fully refined. */
  isIdle() {
    return this.W > 0 && !this.running && !this.dirty && !this.isAnimating() && this.bufComplete
  }

  /** Resolves once `isIdle()` (used by tests). */
  async settled(timeoutMs = 20000): Promise<void> {
    const start = performance.now()
    while (!this.isIdle()) {
      if (performance.now() - start > timeoutMs) throw new Error('explorer did not settle')
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  // ---------------------------------------------------------------- loop

  private animateTo(fn: CameraPath, label: string | null, onDone?: () => void) {
    this.wheel = null
    this.path = { fn, start: performance.now(), label, onDone }
    this.lastStep = performance.now()
    this.schedule()
  }

  private cancelMotion() {
    this.path = null
    this.wheel = null
  }

  schedule() {
    if (this.disposed) return
    this.dirty = true
    if (this.refining) this.pool.cancel(SLOT_MAIN)
    if (!this.running) void this.loop()
  }

  private step(now: number) {
    const dt = Math.min(100, now - (this.lastStep || now))
    this.lastStep = now
    if (this.path) {
      const t = Math.min(1, (now - this.path.start) / (this.path.fn.duration * 1000))
      this.cam = this.path.fn(t)
      if (t >= 1) {
        const done = this.path.onDone
        this.path = null
        done?.()
      }
    }
    if (this.wheel && this.W) {
      const take = this.wheel.remaining * (1 - Math.exp(-dt / 70))
      const done = Math.abs(this.wheel.remaining - take) < 0.004
      const amount = done ? this.wheel.remaining : take
      this.wheel.remaining -= amount
      const { ax, ay } = this.wheel
      const anchor = this.pixelToComplex(ax, ay)
      const w = Math.min(8, this.cam.w * 2 ** -amount)
      const ps = w / this.W
      this.cam = { re: anchor.re - (ax - this.W / 2) * ps, im: anchor.im + (ay - this.H / 2) * ps, w }
      if (done) this.wheel = null
    }
    if (!(Number.isFinite(this.cam.re) && Number.isFinite(this.cam.im) && this.cam.w > 0)) {
      this.cancelMotion()
      this.cam = homeFor(this.W, this.H)
    }
    if (this.isAnimating()) this.dirty = true
  }

  private key() {
    return `${this.palette}:${this.maxIter}:${this.W}x${this.H}`
  }

  private async loop() {
    this.running = true
    try {
      while (this.dirty && !this.disposed) {
        this.dirty = false
        if (!this.buf || !this.W) break
        // Pace animation frames and always yield so input events get through.
        const now = performance.now()
        const wait = this.isAnimating() ? Math.max(0, 14 - (now - this.lastIter)) : 0
        await new Promise((r) => (wait ? setTimeout(r, wait) : setImmediate(r)))
        this.lastIter = performance.now()
        this.step(this.lastIter)
        const cam = this.cam
        const key = this.key()

        const shift = this.shiftFor(cam, key)
        if (shift) {
          this.phase = 'pan'
          await this.shiftAndFill(cam, shift.dx, shift.dy)
          if (!this.dirty && !this.bufComplete) await this.refine(cam, false)
          continue
        }
        if (sameCam(this.bufCam, cam) && this.bufKey === key) {
          if (!this.bufComplete && !this.dirty) await this.refine(cam, false)
          continue
        }
        const est = this.msPerPx * this.W * this.H
        let f = 1
        if (est > PREVIEW_BUDGET_MS) f = Math.min(10, Math.ceil(Math.sqrt(est / PREVIEW_BUDGET_MS)))
        if (f > 1) {
          this.phase = this.path ? 'flight' : 'preview'
          await this.preview(cam, f)
          if (this.dirty) continue
          await this.refine(cam, true)
        } else {
          this.phase = this.path ? 'flight' : 'refine'
          this.previewF = 1
          await this.refine(cam, true)
        }
      }
    } finally {
      this.running = false
      if (!this.isAnimating()) this.phase = 'idle'
      this.emit()
    }
  }

  private job(cam: Camera, W: number, H: number, f: number): Omit<TileJob, 'x0' | 'y0' | 'x1' | 'y1'> {
    return this.jobFor(cam, W, H, this.maxIter, f)
  }

  private jobFor(cam: Camera, W: number, H: number, maxIter: number, f = 1): Omit<TileJob, 'x0' | 'y0' | 'x1' | 'y1'> {
    // W, H here are the *output* bitmap size; f is how many view pixels each output pixel covers.
    const ps = (cam.w / (W * f)) * f
    return {
      kind: 'mandelbrot',
      width: W,
      height: H,
      originRe: cam.re - (W / 2) * ps + ps / 2,
      originIm: cam.im + (H / 2) * ps - ps / 2,
      pixelSize: ps,
      maxIter,
      juliaRe: 0,
      juliaIm: 0,
      density: DENSITY,
    }
  }

  private async preview(cam: Camera, f: number) {
    const pw = Math.ceil(this.W / f)
    const ph = Math.ceil(this.H / f)
    const job = this.job({ ...cam, w: (cam.w / this.W) * pw * f }, pw, ph, 1)
    job.pixelSize = (cam.w / this.W) * f
    job.originRe = cam.re - (pw * f * (cam.w / this.W)) / 2 + job.pixelSize / 2
    job.originIm = cam.im + (ph * f * (cam.w / this.W)) / 2 - job.pixelSize / 2
    const tw = Math.max(16, Math.ceil(pw / 4))
    const th = Math.max(16, Math.ceil(ph / 3))
    const r = await this.pool.run(SLOT_MAIN, this.prev!, job, this.palette, tiles(pw, ph, tw, th), { priority: 1 })
    if (r.aborted) return
    this.previewMs = r.ms
    this.previewF = f
    this.msPerPx = 0.5 * this.msPerPx + 0.5 * (r.ms / (pw * ph))
    this.previewCam = { ...cam }
    if (this.mainImg) this.upload(this.mainImg, this.prev!, pw, ph, true)
    this.emitSoon()
  }

  /** Full-resolution pass into `buf`. `fresh` = the buffer holds another view. */
  private async refine(cam: Camera, fresh: boolean) {
    const W = this.W
    const H = this.H
    const buf = this.buf!
    if (fresh) {
      if (sameCam(this.previewCam, cam) && this.previewF > 1) this.upscalePreview()
      this.bufCam = { ...cam }
      this.bufKey = this.key()
      this.bufComplete = false
    }
    const slow = this.msPerPx * W * H > 45
    let tileDirty = false
    const timer = slow
      ? setInterval(() => {
          if (tileDirty && this.mainImg) {
            tileDirty = false
            this.upload(this.mainImg, buf, W, H, true)
          }
        }, 33)
      : null
    // Fast passes are not interruptible: they finish before the next input frame anyway.
    this.refining = slow
    if (slow && !this.path) this.phase = 'refine'
    const r = await this.pool.run(SLOT_MAIN, buf, this.job(cam, W, H, 1), this.palette, tiles(W, H, FULL_TILE, FULL_TILE), {
      priority: 1,
      onTile: slow ? () => (tileDirty = true) : undefined,
    })
    this.refining = false
    if (timer) clearInterval(timer)
    if (buf !== this.buf) return
    if (!r.aborted) {
      this.bufComplete = true
      this.renderMs = r.ms
      this.mips = r.ms > 0 ? r.iters / r.ms / 1000 : 0
      this.msPerPx = 0.5 * this.msPerPx + 0.5 * (r.ms / (W * H))
    }
    if (this.mainImg && (!r.aborted || tileDirty || !slow)) this.upload(this.mainImg, buf, W, H, true)
    if (!this.path && !this.dirty) this.previewF = 1
    this.emitSoon()
  }

  private upscalePreview() {
    const f = this.previewF
    const W = this.W
    const H = this.H
    const pw = Math.ceil(W / f)
    const src = new Uint32Array(this.prev!)
    const dst = new Uint32Array(this.buf!)
    for (let y = 0; y < H; y++) {
      const srow = ((y / f) | 0) * pw
      const drow = y * W
      for (let x = 0; x < W; x++) dst[drow + x] = src[srow + ((x / f) | 0)]!
    }
  }

  private shiftFor(cam: Camera, key: string): { dx: number; dy: number } | null {
    const b = this.bufCam
    if (!b || this.bufKey !== key || Math.abs(b.w - cam.w) > cam.w * 1e-12) return null
    const ps = cam.w / this.W
    const fx = (b.re - cam.re) / ps
    const fy = (cam.im - b.im) / ps
    const dx = Math.round(fx)
    const dy = Math.round(fy)
    if (dx === 0 && dy === 0) return null
    if (Math.abs(fx - dx) > 0.25 || Math.abs(fy - dy) > 0.25) return null
    if (Math.abs(dx) >= this.W || Math.abs(dy) >= this.H) return null
    return { dx, dy }
  }

  private async shiftAndFill(cam: Camera, dx: number, dy: number) {
    const W = this.W
    const H = this.H
    const px = new Uint32Array(this.buf!)
    const len = W - Math.abs(dx)
    const sx = Math.max(0, -dx)
    const tx = Math.max(0, dx)
    const rows = dy > 0 ? Array.from({ length: H - dy }, (_, i) => H - 1 - i) : Array.from({ length: H + Math.min(0, dy) }, (_, i) => i)
    for (const y of rows) {
      const src = (y - dy) * W + sx
      px.copyWithin(y * W + tx, src, src + len)
    }
    this.bufCam = { ...cam }
    const strips: Rect[] = []
    if (dy > 0) strips.push({ x0: 0, y0: 0, x1: W, y1: dy })
    if (dy < 0) strips.push({ x0: 0, y0: H + dy, x1: W, y1: H })
    const ya = Math.max(0, dy)
    const yb = H + Math.min(0, dy)
    if (dx > 0) strips.push({ x0: 0, y0: ya, x1: dx, y1: yb })
    if (dx < 0) strips.push({ x0: W + dx, y0: ya, x1: W, y1: yb })
    const rects = strips.flatMap((s) => tiles(W, H, FULL_TILE, FULL_TILE, s))
    const r = await this.pool.run(SLOT_MAIN, this.buf!, this.job(cam, W, H, 1), this.palette, rects, { priority: 1 })
    if (r.aborted) this.bufComplete = false
    if (this.mainImg) this.upload(this.mainImg, this.buf!, W, H, true)
    this.emitSoon()
  }

  // ---------------------------------------------------------------- julia

  private scheduleJulia() {
    if (this.disposed || !this.juliaBuf) return
    this.juliaDirty = true
    if (!this.juliaRunning) void this.juliaLoop()
  }

  private async juliaLoop() {
    this.juliaRunning = true
    try {
      while (this.juliaDirty && !this.disposed) {
        this.juliaDirty = false
        const W = this.JW
        const H = this.JH
        const sab = this.juliaBuf!
        const ps = JULIA_VIEW_W / W
        const job: Omit<TileJob, 'x0' | 'y0' | 'x1' | 'y1'> = {
          kind: 'julia',
          width: W,
          height: H,
          originRe: -(W / 2) * ps + ps / 2,
          originIm: (H / 2) * ps - ps / 2,
          pixelSize: ps,
          maxIter: Math.min(this.maxIter, 700),
          juliaRe: this.julia.re,
          juliaIm: this.julia.im,
          density: DENSITY * 1.4,
        }
        const r = await this.pool.run(SLOT_JULIA, sab, job, this.palette, tiles(W, H, Math.ceil(W / 4), Math.ceil(H / 3)), {
          priority: 0,
        })
        if (r.aborted || sab !== this.juliaBuf) continue
        this.juliaMs = r.ms
        if (this.juliaImg) this.upload(this.juliaImg, sab, W, H, false)
      }
    } finally {
      this.juliaRunning = false
    }
  }

  // ---------------------------------------------------------------- output

  private upload(img: ImgInstance, sab: SharedArrayBuffer, w: number, h: number, main: boolean) {
    const view = new Uint8Array(sab, 0, w * h * 4)
    if (this.copyPixels !== true) {
      try {
        img.setImagePixels(w, h, view, { format: 'bgra' })
        this.copyPixels = false
      } catch {
        this.copyPixels = true
      }
    }
    if (this.copyPixels) img.setImagePixels(w, h, new Uint8Array(view), { format: 'bgra' })
    if (main) {
      this.frames++
      this.frameTimes.push(performance.now())
    }
  }

  private emitSoon() {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emit()
    }, 60)
  }

  private emit() {
    if (this.disposed) return
    const s = this.stats()
    for (const fn of this.listeners) fn(s)
  }
}
