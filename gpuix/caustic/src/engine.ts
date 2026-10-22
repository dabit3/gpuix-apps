import { writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { encodePng } from './png'
import type { EngineStats, FromEngine, Ripple, ToEngine } from './protocol'
import { frameOf, type Frame } from './render'
import { Caustics } from './caustics'
import { f32 } from './shared'
import { Scene, WATER_LEVEL, type PickKind, type Settings } from './scene'

/**
 * Owns the Scene and runs the frame loop off the UI thread: sim steps, caustics, then a parallel ray trace
 * across render workers into a double-buffered SharedArrayBuffer that the UI uploads with setImagePixels.
 */
export class Engine {
  scene: Scene
  private send: (m: FromEngine) => void
  private workers: Worker[] = []
  private paneW = 0
  private paneH = 0
  private bufs: SharedArrayBuffer[] = []
  private slot = 0
  private frameNo = 0
  private running = true
  private drag: { kind: PickKind; u: number; v: number } | null = null
  private hover: PickKind = 'none'
  private last = performance.now()
  private stamps: number[] = []
  private acc = { sim: 0, caustics: 0, render: 0, frame: 0, steps: 0, n: 0 }
  private lastStats = 0
  private lastDrop: { x: number; z: number } | null = null
  private bg: [number, number, number]

  constructor(settings: Partial<Settings>, bg: [number, number, number], send: (m: FromEngine) => void, workers = Math.max(2, Math.min(6, Math.floor(availableParallelism() / 2)))) {
    this.scene = new Scene(settings)
    this.send = send
    this.bg = bg
    for (let i = 0; i < workers; i++) this.workers.push(new Worker(new URL('./render-worker.ts', import.meta.url).href))
  }

  handle(m: ToEngine) {
    const s = this.scene
    switch (m.type) {
      case 'size': this.paneW = Math.max(1, m.w); this.paneH = Math.max(1, m.h); break
      case 'set': {
        const next = { ...s.settings, ...m.settings }
        if (next.quality !== s.settings.quality) s.setQuality(next.quality)
        s.settings = { ...next }
        s.updateLight()
        s.applyWater()
        break
      }
      case 'orbit': s.orbit(m.dyaw, m.dpitch); break
      case 'zoom': s.zoom(m.f); break
      case 'clear': s.water.clear(); break
      case 'drops': for (const r of m.ripples) s.drop(r.x, r.z, r.r, r.s, false); break
      case 'pointer': this.pointer(m.phase, m.u, m.v); break
      case 'screenshot': void this.screenshot(m.path); break
      case 'stop': this.running = false; for (const w of this.workers) w.terminate(); break
    }
  }

  private get aspect() { return this.paneW / Math.max(1, this.paneH) }

  private pointer(phase: 'down' | 'move' | 'up', u: number, v: number) {
    const s = this.scene
    const p = s.pick(u, v, this.aspect)
    if (phase === 'down') {
      this.drag = { kind: p.kind, u, v }
      if (p.kind === 'ball') { s.ball.held = true; s.ball.tx = s.ball.x; s.ball.tz = s.ball.z }
      if (p.kind === 'water') { s.drop(p.x, p.z, 0.07, 0.03); this.lastDrop = { x: p.x, z: p.z } }
      return
    }
    if (phase === 'up') {
      if (this.drag?.kind === 'ball') s.ball.held = false
      this.drag = null
      this.lastDrop = null
      return
    }
    this.hover = p.kind
    const d = this.drag
    if (!d) return
    if (d.kind === 'ball') {
      // Follow the pointer across the water plane, even past the pool edge (clamped by the walls).
      const w = this.waterPoint(u, v)
      if (w) { s.ball.tx = Math.max(-0.95, Math.min(0.95, w.x)); s.ball.tz = Math.max(-0.95, Math.min(0.95, w.z)) }
    } else if (d.kind === 'water') {
      if (p.kind === 'water') {
        // Drop ripples along the stroke, spaced so a fast drag still draws a continuous wake.
        const from = this.lastDrop ?? p
        const dist = Math.hypot(p.x - from.x, p.z - from.z)
        const steps = Math.min(12, Math.max(1, Math.floor(dist / 0.03)))
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          s.drop(from.x + (p.x - from.x) * t, from.z + (p.z - from.z) * t, 0.05, 0.012)
        }
        this.lastDrop = { x: p.x, z: p.z }
      }
    } else {
      s.orbit((u - d.u) * -2.2, (v - d.v) * 1.4)
    }
    d.u = u; d.v = v
  }

  private waterPoint(u: number, v: number) {
    const B = this.scene.basis(this.aspect)
    const dx = B.fx + B.rx * u * B.tanX + B.ux * v * B.tanY, dy = B.fy + B.ry * u * B.tanX + B.uy * v * B.tanY, dz = B.fz + B.rz * u * B.tanX + B.uz * v * B.tanY
    if (dy >= 0) return null
    const t = (WATER_LEVEL - B.ey) / dy
    return { x: B.ex + dx * t, z: B.ez + dz * t }
  }

  private renderSize() {
    const k = this.scene.q.scale
    return { w: Math.max(32, Math.round(this.paneW * k)), h: Math.max(24, Math.round(this.paneH * k)) }
  }

  private trace(frame: Frame, out: SharedArrayBuffer, w: number, h: number) {
    const n = this.workers.length
    // Interleave bands so the expensive water rows spread across workers.
    const bands = n * 3
    const per = Math.ceil(h / bands)
    let pending = 0
    return new Promise<void>((resolve) => {
      const id = ++this.frameNo
      const done = (e: MessageEvent<{ id: number }>) => { if (e.data.id === id && --pending === 0) { for (const wk of this.workers) wk.removeEventListener('message', done as never); resolve() } }
      for (const wk of this.workers) wk.addEventListener('message', done as never)
      for (let b = 0; b < bands; b++) {
        const y0 = b * per, y1 = Math.min(h, y0 + per)
        if (y0 >= y1) continue
        pending++
        this.workers[b % n]!.postMessage({ id, frame, out, w, h, y0, y1 })
      }
      if (pending === 0) resolve()
    })
  }

  /**
   * Pipelined: while the workers trace frame k, this thread steps the sim and casts caustics for frame k+1 into the
   * other half of a double buffer (water snapshot + caustics), so a frame costs max(sim+caustics, trace), not the sum.
   */
  async run() {
    let inflight: { done: Promise<number>; out: SharedArrayBuffer; w: number; h: number } | null = null
    let k = 0
    while (this.running) {
      const t0 = performance.now()
      if (this.paneW <= 1) { await sleep(16); continue }
      const s = this.scene
      const dt = (t0 - this.last) / 1000
      this.last = t0
      const steps = s.advance(dt)
      const t1 = performance.now()
      // Swap in the idle caustics buffer (the other one may still be read by the workers).
      const q = s.q
      let spare = this.spare
      if (!spare || spare.c !== q.caustics || spare.p !== q.photons || spare.dispersion !== q.dispersion) spare = new Caustics(q.caustics, q.photons, q.dispersion)
      this.spare = s.caustics
      s.caustics = spare
      s.caustics.compute(s.water, WATER_LEVEL, s.settings.depth, s.light, s.ball, s.settings.ior)
      const t2 = performance.now()
      const frame = frameOf(s, this.aspect, this.bg)
      const snap = this.snapshot(k & 1, s)
      frame.h = snap.h; frame.gx = snap.gx; frame.gz = snap.gz
      const { w, h } = this.renderSize()
      const need = w * h * 4
      if (!this.bufs[0] || this.bufs[0].byteLength < need) {
        if (inflight) { await inflight.done; inflight = null }
        this.bufs = [new SharedArrayBuffer(need), new SharedArrayBuffer(need)]
      }
      if (inflight) {
        const traced = await inflight.done
        this.emit(inflight.out, inflight.w, inflight.h, traced)
      }
      const out = this.bufs[k & 1]!
      const ts = performance.now()
      inflight = { done: this.trace(frame, out, w, h).then(() => performance.now() - ts), out, w, h }
      k++
      const a = this.acc
      a.sim += t1 - t0; a.caustics += t2 - t1; a.steps += steps
      if (s.outbox.length) this.send({ type: 'ripples', ripples: s.outbox.splice(0) as Ripple[] })
      const spent = performance.now() - t0
      await sleep(Math.max(0, 16.2 - spent))
    }
  }

  private spare: Caustics | null = null
  private snaps: { n: number; h: Float32Array; gx: Float32Array; gz: Float32Array }[] = []
  private snapshot(i: number, s: Scene) {
    const n = s.water.n
    let b = this.snaps[i]
    if (!b || b.n !== n) b = this.snaps[i] = { n, h: f32(n * n), gx: f32(n * n), gz: f32(n * n) }
    b.h.set(s.water.h); b.gx.set(s.water.gx); b.gz.set(s.water.gz)
    return b
  }

  private emit(out: SharedArrayBuffer, w: number, h: number, traced: number) {
    this.send({ type: 'frame', buf: out, w, h, n: this.frameNo })
    const now = performance.now()
    const a = this.acc
    a.render += traced; a.n++
    this.stamps.push(now)
    while (this.stamps.length > 2 && now - this.stamps[0]! > 1000) this.stamps.shift()
    if (a.frame) a.frame += now - this.lastEmit
    else a.frame = 0.0001
    this.lastEmit = now
    if (now - this.lastStats > 250) this.stats(w, h, now)
  }
  private lastEmit = 0

  private stats(w: number, h: number, now: number) {
    const a = this.acc, s = this.scene
    const span = this.stamps[this.stamps.length - 1]! - this.stamps[0]!
    const stats: EngineStats = {
      fps: this.stamps.length > 1 ? ((this.stamps.length - 1) * 1000) / span : 0,
      simMs: a.sim / Math.max(1, a.n), causticsMs: a.caustics / Math.max(1, a.n), renderMs: a.render / Math.max(1, a.n), frameMs: span / Math.max(1, this.stamps.length - 1),
      w, h, sim: s.water.n, photons: s.caustics.p * s.caustics.p * (s.caustics.dispersion ? 3 : 1), caustics: s.caustics.c,
      workers: this.workers.length, steps: Math.round((a.steps * 1000) / Math.max(1, now - this.lastStats)), peak: s.caustics.max(),
    }
    this.acc = { sim: 0, caustics: 0, render: 0, frame: 0, steps: 0, n: 0 }
    this.lastStats = now
    this.send({ type: 'stats', stats, settings: { ...s.settings }, hover: this.hover, drag: this.drag?.kind ?? null })
  }

  /** Full pane resolution render (not the scaled live one), written as a PNG. */
  private async screenshot(path: string) {
    const w = this.paneW, h = this.paneH
    const out = new SharedArrayBuffer(w * h * 4)
    await this.trace(frameOf(this.scene, this.aspect, this.bg), out, w, h)
    writeFileSync(path, encodePng(new Uint8Array(out), w, h))
    this.send({ type: 'saved', path })
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
