import { writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { allocTable, type Table } from './geodesic'
import { SKY_H, SKY_W } from './sky'
import { DISK_NA, DISK_NR } from './disk'
import { blur, downRows, type Frame } from './render'
import type { Job, TableBufs } from './render-worker'
import { encodePng } from './png'
import { images, toCamera, cross, norm } from './lensing'
import { eject, startDive, stepDive, type Dive } from './dive'
import { integrate, makeSpec, position, sample, tidal, type Path, type ProbeSpec } from './probe'
import { blackbody } from './physics'
import type { EngineStats, FromEngine, ToEngine } from './protocol'
import { DEFAULT_SETTINGS, DISK_RATE, DIST_MAX, DIST_MIN, PROBE_RATE, QUALITY, SCENES, diskTemp, type Hud, type Settings } from './scene'

type V3 = [number, number, number]
const f32 = (n: number) => new SharedArrayBuffer(n * 4)

/**
 * Owns the simulation (camera, dive, probes) and runs the frame loop off the UI thread: lens table (when the camera
 * radius changes) → parallel trace into an HDR buffer → probe splats → bloom → parallel tone map into BGRA.
 */
export class Engine {
  settings: Settings
  private send: (m: FromEngine) => void
  private workers: Worker[] = []
  private jobId = 0
  private paneW = 0
  private paneH = 0
  private running = true
  // Camera: yaw/pitch in radians, distance in rs, with fling velocities.
  yaw = 0.0
  pitch = 0.09
  dist = 30
  private vyaw = 0
  private vpitch = 0
  private vzoom = 0
  private drag: { u: number; v: number; t: number } | null = null
  private lastMove = 0
  dive: Dive | null = null
  private diveDir: V3 = [0, 0, 1]
  /** Probe paths; `at0` is the spec's wall-clock start shifted onto this pane's pause-adjusted clock. */
  paths: (Path & { at0: number })[] = []
  private pausedMs = 0
  private pauseAt = 0
  private table: Table | null = null
  private tableBufs: TableBufs | null = null
  private sky = f32(SKY_W * SKY_H * 3)
  private disk = f32(DISK_NR * DISK_NA)
  private ready: Promise<void>
  private bufs: SharedArrayBuffer[] = []
  private hdr: SharedArrayBuffer | null = null
  private bloom: Float32Array | null = null
  private bloomTmp: Float32Array | null = null
  private bloomBuf: SharedArrayBuffer | null = null
  private frameNo = 0
  private stamps: number[] = []
  private acc = { trace: 0, table: 0, post: 0, n: 0 }
  private lastStats = 0
  private last = performance.now()
  private scale = 0.5

  constructor(settings: Partial<Settings>, send: (m: FromEngine) => void, workers = Math.max(2, Math.min(8, availableParallelism() - 3)), camera: { pitch?: number; dist?: number } = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
    const sc = SCENES[this.settings.scene]
    this.pitch = ((camera.pitch ?? sc.pitch) * Math.PI) / 180
    this.dist = camera.dist ?? sc.dist
    this.send = send
    for (let i = 0; i < workers; i++) this.workers.push(new Worker(new URL('./render-worker.ts', import.meta.url).href))
    this.ready = (async () => {
      await this.split(SKY_H, (y0, y1) => ({ kind: 'sky', sky: this.sky, y0, y1 }), 4)
      await this.split(DISK_NR, (i0, i1) => ({ kind: 'disk', disk: this.disk, i0, i1 }), 2)
    })()
  }

  /** Run a job over [0, n) split into bands across the workers. */
  private split(n: number, make: (a: number, b: number) => Omit<Job, 'id'>, perWorker = 3) {
    const k = this.workers.length
    const bands = Math.min(n, k * perWorker)
    const per = Math.ceil(n / bands)
    let pending = 0
    return new Promise<void>((resolve) => {
      const id = ++this.jobId
      const done = (e: MessageEvent<{ id: number }>) => { if (e.data.id === id && --pending === 0) { for (const w of this.workers) w.removeEventListener('message', done as never); resolve() } }
      for (const w of this.workers) w.addEventListener('message', done as never)
      for (let b = 0; b < bands; b++) {
        const a = b * per, c = Math.min(n, a + per)
        if (a >= c) continue
        pending++
        this.workers[b % k]!.postMessage({ ...make(a, c), id })
      }
      if (pending === 0) { for (const w of this.workers) w.removeEventListener('message', done as never); resolve() }
    })
  }

  handle(m: ToEngine) {
    switch (m.type) {
      case 'size': this.paneW = Math.max(1, m.w); this.paneH = Math.max(1, m.h); break
      case 'set': {
        const was = this.settings.paused
        this.settings = { ...this.settings, ...m.settings }
        if (m.settings.scene) {
          const sc = SCENES[m.settings.scene]
          this.pitch = (sc.pitch * Math.PI) / 180; this.dist = sc.dist; this.vyaw = 0.25; this.vpitch = 0; this.vzoom = 0
        }
        if (!was && this.settings.paused) this.pauseAt = Date.now()
        if (was && !this.settings.paused) this.pausedMs += Date.now() - this.pauseAt
        break
      }
      case 'orbit': this.vyaw += m.dyaw * 4; this.vpitch += m.dpitch * 4; this.lastMove = performance.now(); break
      case 'zoom': this.vzoom += Math.log(m.f) * 6; this.lastMove = performance.now(); break
      case 'camera':
        if (m.yaw != null) this.yaw = m.yaw
        if (m.pitch != null) this.pitch = (m.pitch * Math.PI) / 180
        if (m.dist != null) this.dist = clamp(m.dist, DIST_MIN, DIST_MAX)
        this.vyaw = this.vpitch = this.vzoom = 0
        break
      case 'pointer': this.pointer(m.phase, m.u, m.v); break
      case 'drop': {
        if (m.specs) for (const s of m.specs) this.addProbe(s)
        else {
          const now = Date.now()
          const specs = Array.from({ length: Math.max(1, m.n ?? 1) }, (_, i) => makeSpec(now + i * 350))
          for (const s of specs) this.addProbe(s)
          this.send({ type: 'probes', specs })
        }
        break
      }
      case 'dive':
        if (!this.dive) { this.dive = startDive(Math.max(8, this.dist)); this.diveDir = this.camPos(1); this.send({ type: 'dive', phase: 'start' }) }
        break
      case 'eject': if (this.dive) { const d = eject(this.dive); if (d) { this.dive = d; this.send({ type: 'dive', phase: 'eject' }) } } break
      case 'screenshot': void this.screenshot(m.path); break
      case 'stop': this.running = false; for (const w of this.workers) w.terminate(); break
    }
  }

  /** Shared wall clock (ms) minus time spent paused: probes started in any pane line up in every pane. */
  private now() { return (this.settings.paused ? this.pauseAt : Date.now()) - this.pausedMs }

  addProbe(spec: ProbeSpec) {
    if (this.paths.some((p) => p.spec.id === spec.id)) return
    this.paths.push({ ...integrate(spec), at0: spec.at - this.pausedMs - (this.settings.paused ? Date.now() - this.pauseAt : 0) })
    if (this.paths.length > 24) this.paths.shift()
  }

  private pointer(phase: 'down' | 'move' | 'up', u: number, v: number) {
    const t = performance.now()
    if (phase === 'down') { this.drag = { u, v, t }; this.vyaw = this.vpitch = 0; return }
    if (phase === 'up') { this.drag = null; return }
    const d = this.drag
    if (!d) return
    const dt = Math.max(1, t - d.t) / 1000
    const dy = (u - d.u) * -2.0, dp = (v - d.v) * -1.3
    this.yaw += dy; this.pitch = clamp(this.pitch + dp, -1.45, 1.45)
    // Fling velocity: smoothed recent drag speed.
    this.vyaw = this.vyaw * 0.5 + (dy / dt) * 0.5
    this.vpitch = this.vpitch * 0.5 + (dp / dt) * 0.5
    this.lastMove = t
    d.u = u; d.v = v; d.t = t
  }

  private camPos(r: number): V3 {
    const cp = Math.cos(this.pitch)
    return [r * cp * Math.sin(this.yaw), r * Math.sin(this.pitch), r * cp * Math.cos(this.yaw)]
  }

  private step(dt: number) {
    if (!this.drag) {
      this.yaw += this.vyaw * dt
      this.pitch = clamp(this.pitch + this.vpitch * dt, -1.45, 1.45)
      const k = Math.exp(-dt * 2.6)
      this.vyaw *= k; this.vpitch *= k
    }
    if (Math.abs(this.vzoom) > 1e-4) {
      this.dist = clamp(this.dist * Math.exp(this.vzoom * dt), DIST_MIN, DIST_MAX)
      this.vzoom *= Math.exp(-dt * 5)
    }
    if (this.dive && !this.settings.paused) {
      const was = this.dive.phase
      const next = stepDive(this.dive, dt)
      if (!next) { this.dive = null; this.send({ type: 'dive', phase: 'end' }); this.lastMove = performance.now() }
      else {
        if (was === 'fall' && next.phase === 'inside') this.send({ type: 'dive', phase: 'horizon' })
        this.dive = next
      }
    }
    const now = this.now()
    this.paths = this.paths.filter((p) => (now - p.at0) / 1000 * PROBE_RATE < p.tEnd + 2)
  }

  private moving() {
    return !!this.drag || Math.abs(this.vyaw) + Math.abs(this.vpitch) > 0.02 || Math.abs(this.vzoom) > 0.02 || !!this.dive || performance.now() - this.lastMove < 250
  }

  /** The camera for this frame: position, basis, radius, fall speed. */
  frame(aspect: number, orders: number): Frame {
    const s = this.settings, sc = SCENES[s.scene]
    let cam: V3, fwd: V3, up: V3, right: V3, v = 0, inside = 0, tanY = Math.tan((38 / 2) * Math.PI / 180)
    const d = this.dive
    if (d) {
      const dir = this.diveDir
      const r = d.phase === 'inside' || d.phase === 'flash' ? 1.02 : Math.max(1.02, d.r)
      cam = [dir[0] * r, dir[1] * r, dir[2] * r]
      const inward: V3 = [-dir[0], -dir[1], -dir[2]]
      // Turn from facing the hole to facing back out as the horizon nears; pitch slightly so the disk stays in shot.
      const a = d.turn * Math.PI * 0.92
      const side = norm(cross(inward, [0, 1, 0]))
      const upv = norm(cross(side, inward))
      fwd = norm([inward[0] * Math.cos(a) + upv[0] * Math.sin(a), inward[1] * Math.cos(a) + upv[1] * Math.sin(a), inward[2] * Math.cos(a) + upv[2] * Math.sin(a)])
      right = norm(cross(fwd, upv))
      up = norm(cross(right, fwd))
      v = d.phase === 'fall' ? Math.min(0.995, d.v) : d.phase === 'eject' ? d.v : 0.995
      inside = d.phase === 'inside' ? Math.max(0.02, d.inside) : d.phase === 'flash' ? 1 : 0
      tanY = Math.tan(((38 + 37 * Math.min(1, d.turn + (1 - Math.min(1, d.r / 8)))) / 2) * Math.PI / 180)
    } else {
      cam = this.camPos(this.dist)
      fwd = norm([-cam[0], -cam[1], -cam[2]])
      right = norm(cross(fwd, [0, 1, 0]))
      up = cross(right, fwd)
    }
    const tl = (s.tilt * Math.PI) / 180
    const n: V3 = [0, Math.cos(tl), Math.sin(tl)]
    const d1: V3 = [1, 0, 0]
    const d2 = cross(n, d1)
    const r0 = Math.hypot(cam[0], cam[1], cam[2])
    return {
      cam, fwd, right, up, tanY, aspect, r0, v, inside,
      lens: s.lens, disk: s.disk, look: s.look === 'interstellar' ? 1 : 0, n, d1, d2,
      t: (this.now() / 1000) * DISK_RATE % 1e6,
      temp: s.look === 'interstellar' ? 6500 : diskTemp(s.scene, s.mass),
      // Beaming spans ~g⁴ ≈ 50× across the disk; expose for the bright side so the receding side reads dim.
      gain: sc.gain * (s.look === 'physical' ? 0.2 : 1), opacity: 1.6, orders, sky: 1, starGain: 1,
    }
  }

  private async ensureTable(r0: number, rays: number) {
    const t = this.table
    if (t && t.na === rays && Math.abs(t.r0 - r0) < 1e-6 * r0) return 0
    const t0 = performance.now()
    if (!t || t.na !== rays) {
      this.table = allocTable(rays)
      const T = this.table
      this.tableBufs = { na: rays, r0, u: T.u.buffer as SharedArrayBuffer, end: T.end.buffer as SharedArrayBuffer, cap: T.cap.buffer as SharedArrayBuffer, ex: T.ex.buffer as SharedArrayBuffer, ey: T.ey.buffer as SharedArrayBuffer }
    }
    const tb = { ...this.tableBufs!, r0 }
    this.tableBufs = tb
    await this.split(rays, (i0, i1) => ({ kind: 'table', tb, i0, i1 }), 4)
    const { alphaCrit } = await import('./geodesic')
    this.table!.r0 = r0; this.table!.ac = alphaCrit(r0)
    return performance.now() - t0
  }

  private async draw(w: number, h: number, out: SharedArrayBuffer, rays: number, orders: number) {
    const fr = this.frame(w / h, orders)
    const tTable = await this.ensureTable(fr.r0, rays)
    if (!this.hdr || this.hdr.byteLength < w * h * 12) this.hdr = new SharedArrayBuffer(w * h * 12)
    const t0 = performance.now()
    const tb = this.tableBufs!, hdr = this.hdr
    await this.split(h, (y0, y1) => ({ kind: 'trace', frame: fr, tb, sky: this.sky, disk: this.disk, hdr, w, h, y0, y1 }), 3)
    const t1 = performance.now()
    const H = new Float32Array(hdr, 0, w * h * 3)
    this.splatProbes(fr, H, w, h)
    const bw = Math.max(8, Math.ceil(w / 4)), bh = Math.max(6, Math.ceil(h / 4))
    if (!this.bloomBuf || this.bloomBuf.byteLength < bw * bh * 12) { this.bloomBuf = new SharedArrayBuffer(bw * bh * 12); this.bloomTmp = new Float32Array(bw * bh * 3) }
    this.bloom = new Float32Array(this.bloomBuf, 0, bw * bh * 3)
    downRows(H, w, h, this.bloom, bw, bh, 0, bh, 0.9)
    blur(this.bloom, this.bloomTmp!, bw, bh, Math.max(3, Math.round(bw / 36)))
    const d = this.dive
    const flash = d?.phase === 'flash' ? Math.max(0, 1 - d.clock / 1.4) * 2.5 : d?.phase === 'inside' && d.inside > 0.9 ? (d.inside - 0.9) * 25 : 0
    const sc = SCENES[this.settings.scene]
    const bloomBuf = this.bloomBuf
    await this.split(h, (y0, y1) => ({ kind: 'post', hdr, bloom: bloomBuf, bw, bh, out, w, h, y0, y1, exposure: sc.exposure, bloomGain: this.settings.look === 'physical' ? 1.2 : 0.75, flash }), 2)
    return { trace: t1 - t0, table: tTable, post: performance.now() - t1 }
  }

  /** Probes: each visible image of the probe (primary and the secondary round the far side) as a stretched glow. */
  private splatProbes(fr: Frame, H: Float32Array, w: number, h: number) {
    if (!this.paths.length || fr.inside > 0) return
    const T = this.table!
    const now = this.now()
    const tanX = fr.tanY * fr.aspect
    const cl = fr.r0
    const inward: V3 = [-fr.cam[0] / cl, -fr.cam[1] / cl, -fr.cam[2] / cl]
    const project = (P: V3) => {
      const out: { x: number; y: number; order: number }[] = []
      const dirs = fr.lens ? images(T, fr.cam, P) : [{ d: norm([P[0] - fr.cam[0], P[1] - fr.cam[1], P[2] - fr.cam[2]]), order: 0, a: 0 }]
      for (const im of dirs) {
        const d = toCamera(im.d, inward, fr.v)
        const z = d[0] * fr.fwd[0] + d[1] * fr.fwd[1] + d[2] * fr.fwd[2]
        if (z <= 0.05) continue
        const x = (d[0] * fr.right[0] + d[1] * fr.right[1] + d[2] * fr.right[2]) / z / tanX
        const y = (d[0] * fr.up[0] + d[1] * fr.up[1] + d[2] * fr.up[2]) / z / fr.tanY
        out.push({ x: (x * 0.5 + 0.5) * w, y: (0.5 - y * 0.5) * h, order: im.order })
      }
      return out
    }
    const px = h / 540
    for (const p of this.paths) {
      const tNow = ((now - p.at0) / 1000) * PROBE_RATE
      const st = sample(p, tNow)
      if (!st) continue
      const hue = blackbody(5200 + p.spec.hue * 9000)
      // Orbit trail: dim, thin, the last ~70 rs/c.
      for (let k = 1; k <= 90; k++) {
        const s2 = sample(p, tNow - k * 0.8)
        if (!s2) break
        const P = position(p.spec, s2.r, s2.phi)
        const fade = (1 - k / 90) * 0.05 * s2.g * s2.g
        for (const im of project(P)) splat(H, w, h, im.x, im.y, 1.1 * px, fade * (im.order ? 0.3 : 1), hue)
      }
      // The body, smeared along its orbit by tides: longer and dimmer (redshifted) as it nears the horizon.
      const stretch = tidal(st.r)
      const seg = 0.15 + stretch * 0.55
      const n = Math.min(40, 6 + Math.round(stretch * 3))
      const g = st.g
      const red = blackbody(Math.max(1200, (5200 + p.spec.hue * 9000) * g))
      for (let k = 0; k < n; k++) {
        const s2 = sample(p, tNow - (k / n) * seg) ?? st
        const P = position(p.spec, s2.r, s2.phi)
        const e = (2.2 * g * g * g * (1 - (k / n) * 0.6)) / Math.sqrt(n / 6)
        for (const im of project(P)) splat(H, w, h, im.x, im.y, (2.2 - Math.min(1.2, stretch * 0.05)) * px, e * (im.order ? 0.35 : 1), red)
      }
    }
  }

  private renderSize() {
    const q = QUALITY[this.settings.quality]
    const target = this.moving() ? q.moving : q.still
    this.scale += (target - this.scale) * (target < this.scale ? 1 : 0.25)
    const k = Math.abs(this.scale - target) < 0.01 ? target : this.scale
    return { w: Math.max(32, Math.round(this.paneW * k)), h: Math.max(24, Math.round(this.paneH * k)) }
  }

  async run() {
    await this.ready
    let k = 0
    while (this.running) {
      const t0 = performance.now()
      if (this.paneW <= 1) { await sleep(16); continue }
      const dt = Math.min(0.1, (t0 - this.last) / 1000)
      this.last = t0
      this.step(dt)
      const { w, h } = this.renderSize()
      const need = w * h * 4
      if (!this.bufs[0] || this.bufs[0].byteLength < need) this.bufs = [new SharedArrayBuffer(need), new SharedArrayBuffer(need)]
      const out = this.bufs[k & 1]!
      const q = QUALITY[this.settings.quality]
      const rays = this.dive ? Math.min(q.rays, 512) : q.rays
      const t = await this.draw(w, h, out, rays, q.orders)
      k++
      this.frameNo++
      this.send({ type: 'frame', buf: out, w, h, n: this.frameNo })
      const a = this.acc
      a.trace += t.trace; a.table += t.table; a.post += t.post; a.n++
      const now = performance.now()
      this.stamps.push(now)
      while (this.stamps.length > 2 && now - this.stamps[0]! > 1000) this.stamps.shift()
      if (now - this.lastStats > 100) this.stats(w, h, now, rays)
      await sleep(Math.max(0, 15 - (performance.now() - t0)))
    }
  }

  hud(): Hud {
    const d = this.dive
    const now = this.now()
    let probe: Hud['probe'] = null
    for (const p of this.paths) {
      const st = sample(p, ((now - p.at0) / 1000) * PROBE_RATE)
      if (st && (!probe || st.r < probe.r)) probe = { r: st.r, g: st.g, stretch: tidal(st.r) }
    }
    return {
      r: d ? d.r : this.dist, yaw: this.yaw, pitch: this.pitch,
      dive: d ? { phase: d.phase, r: d.r, v: d.v, tau: d.tau, t: d.t, inside: d.inside } : null,
      probes: this.paths.filter((p) => sample(p, ((now - p.at0) / 1000) * PROBE_RATE)).length, probe,
    }
  }

  private stats(w: number, h: number, now: number, rays: number) {
    const a = this.acc
    const span = this.stamps[this.stamps.length - 1]! - this.stamps[0]!
    const n = Math.max(1, a.n)
    const stats: EngineStats = { fps: this.stamps.length > 1 ? ((this.stamps.length - 1) * 1000) / span : 0, traceMs: a.trace / n, tableMs: a.table / n, postMs: a.post / n, w, h, workers: this.workers.length, rays }
    this.acc = { trace: 0, table: 0, post: 0, n: 0 }
    this.lastStats = now
    this.send({ type: 'stats', stats, hud: this.hud() })
  }

  /** Full pane resolution, FULL-quality table and orders, written as a PNG. */
  private async screenshot(path: string) {
    const w = this.paneW, h = this.paneH
    const out = new SharedArrayBuffer(w * h * 4)
    await this.ready
    await this.draw(w, h, out, QUALITY.full.rays, QUALITY.full.orders)
    writeFileSync(path, encodePng(new Uint8Array(out), w, h))
    this.send({ type: 'saved', path })
  }
}

function splat(H: Float32Array, w: number, h: number, x: number, y: number, rad: number, e: number, c: readonly number[]) {
  const R = Math.ceil(rad * 3)
  const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(w - 1, Math.ceil(x + R))
  const y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(h - 1, Math.ceil(y + R))
  const inv = 1 / (2 * rad * rad)
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const d2 = (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2
    const k = e * (Math.exp(-d2 * inv) + 0.15 * Math.exp(-d2 * inv * 0.12))
    if (k < 1e-4) continue
    const o = (yy * w + xx) * 3
    H[o] += k * c[0]!; H[o + 1] += k * c[1]!; H[o + 2] += k * c[2]!
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
