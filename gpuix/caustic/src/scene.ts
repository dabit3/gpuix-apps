import { Caustics, type Ball, type Light } from './caustics'
import { QUALITY, type Quality, type QualityName } from './quality'
import { Water } from './water'

export const WATER_LEVEL = -0.14
export const BALL_R = 0.19
export const DECK = 1.32

export interface Camera { yaw: number; pitch: number; dist: number }
export interface Basis {
  ex: number; ey: number; ez: number
  fx: number; fy: number; fz: number
  rx: number; ry: number; rz: number
  ux: number; uy: number; uz: number
  tanX: number; tanY: number
}

export type PickKind = 'ball' | 'water' | 'none'
export interface Pick { kind: PickKind; x: number; z: number }

export interface Settings {
  quality: QualityName
  rain: boolean
  ball: boolean
  shafts: boolean
  paused: boolean
  /** Sun elevation in degrees above the horizon. */
  sunElev: number
  sunAz: number
  depth: number
  /** Faint wind ripples so the caustics never go still. */
  breeze: boolean
}

export const DEFAULT_SETTINGS: Settings = { quality: 'lite', rain: false, ball: true, shafts: true, paused: false, sunElev: 64, sunAz: 28, depth: 1, breeze: true }

/** Everything the simulation owns: water, ball, light, camera, caustics. Rendering reads it (see render.ts). */
export class Scene {
  q: Quality
  water: Water
  caustics: Caustics
  settings: Settings
  cam: Camera = { yaw: 0.62, pitch: 0.82, dist: 3.55 }
  light: Light = { x: 0, y: -1, z: 0 }
  ball: Ball & { vx: number; vz: number; spin: number; held: boolean; tx: number; tz: number } = { on: true, x: 0.42, y: WATER_LEVEL, z: 0.28, r: BALL_R, vx: 0, vz: 0, spin: 0, held: false, tx: 0, tz: 0 }
  time = 0
  private acc = 0
  private rainAcc = 0
  private breezeAcc = 0
  private rng: () => number
  /** Ripples dropped this frame, so linked instances can mirror them. */
  outbox: { x: number; z: number; r: number; s: number }[] = []

  constructor(settings: Partial<Settings> = {}, seed = 7) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
    this.q = QUALITY[this.settings.quality]
    this.water = new Water(this.q.sim)
    this.caustics = new Caustics(this.q.caustics, this.q.photons, this.q.dispersion)
    this.ball.on = this.settings.ball
    let s = seed >>> 0 || 1
    this.rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    this.updateLight()
  }

  setQuality(name: QualityName) {
    if (name === this.q.name) return
    const old = this.water
    this.settings.quality = name
    this.q = QUALITY[name]
    this.water = new Water(this.q.sim)
    this.water.resampleFrom(old)
    this.caustics = new Caustics(this.q.caustics, this.q.photons, this.q.dispersion)
  }

  updateLight() {
    const e = (this.settings.sunElev * Math.PI) / 180, a = (this.settings.sunAz * Math.PI) / 180
    this.light = { x: -Math.cos(e) * Math.sin(a), y: -Math.sin(e), z: -Math.cos(e) * Math.cos(a) }
  }

  drop(x: number, z: number, r = 0.06, s = 0.012, echo = true) {
    this.water.drop(x, z, r, s)
    if (echo) this.outbox.push({ x, z, r, s })
  }

  /** Advance by dt seconds: fixed-rate sim steps, rain, ball. Returns the number of sim steps taken. */
  advance(dt: number) {
    if (this.settings.paused) return 0
    dt = Math.min(dt, 0.1)
    this.time += dt
    const w = this.water
    if (this.settings.rain) {
      this.rainAcc += dt * 26
      while (this.rainAcc >= 1) {
        this.rainAcc -= 1
        this.drop(this.rng() * 1.9 - 0.95, this.rng() * 1.9 - 0.95, 0.025 + this.rng() * 0.02, (this.rng() < 0.5 ? -1 : 1) * 0.006, false)
      }
    }
    if (this.settings.breeze) {
      this.breezeAcc += dt * 7
      while (this.breezeAcc >= 1) {
        this.breezeAcc -= 1
        this.drop(this.rng() * 2 - 1, this.rng() * 2 - 1, 0.09 + this.rng() * 0.06, (this.rng() < 0.5 ? -1 : 1) * 0.0045, false)
      }
    }
    this.acc += dt * w.stepsPerSecond
    let steps = 0
    while (this.acc >= 1 && steps < 8) {
      this.acc -= 1
      this.stepBall(1 / w.stepsPerSecond)
      w.step()
      steps++
    }
    if (steps === 8) this.acc = 0
    w.updateNormals()
    return steps
  }

  private stepBall(dt: number) {
    const b = this.ball
    b.on = this.settings.ball
    if (!b.on) return
    const w = this.water
    const ox = b.x, oz = b.z
    if (b.held) {
      b.vx += ((b.tx - b.x) * 260 - b.vx * 22) * dt
      b.vz += ((b.tz - b.z) * 260 - b.vz * 22) * dt
    } else {
      // The ball slides downhill on the waves and slowly coasts to rest.
      const sx = sample(w.gx, w.n, b.x, b.z), sz = sample(w.gz, w.n, b.x, b.z)
      b.vx += (-sx * 5.5 - b.vx * 0.9) * dt
      b.vz += (-sz * 5.5 - b.vz * 0.9) * dt
    }
    b.x += b.vx * dt
    b.z += b.vz * dt
    const lim = 1 - b.r
    if (b.x < -lim) { b.x = -lim; b.vx = Math.abs(b.vx) * 0.5 }
    if (b.x > lim) { b.x = lim; b.vx = -Math.abs(b.vx) * 0.5 }
    if (b.z < -lim) { b.z = -lim; b.vz = Math.abs(b.vz) * 0.5 }
    if (b.z > lim) { b.z = lim; b.vz = -Math.abs(b.vz) * 0.5 }
    b.spin += Math.hypot(b.x - ox, b.z - oz) / b.r * Math.sign(b.x - ox || 1)
    b.y = WATER_LEVEL + sample(w.h, w.n, b.x, b.z) + b.r * 0.12
    // Displacement: the water under the ball's old footprint rises back, the new footprint sinks.
    const moved = Math.hypot(b.x - ox, b.z - oz)
    if (moved > 1e-5) displace(w, ox, oz, b.r, 0.05, b.x, b.z)
  }

  /** Camera basis for an aspect ratio. Narrow panes pull the camera back so the pool still fits. */
  basis(aspect: number): Basis {
    const { yaw, pitch } = this.cam
    const dist = this.cam.dist * Math.max(1, 1.5 / aspect)
    const tx = 0, ty = -0.32, tz = 0
    const ex = tx + dist * Math.cos(pitch) * Math.sin(yaw), ey = ty + dist * Math.sin(pitch), ez = tz + dist * Math.cos(pitch) * Math.cos(yaw)
    let fx = tx - ex, fy = ty - ey, fz = tz - ez
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl
    // right = f × up(0,1,0)
    let rx = -fz, ry = 0, rz = fx
    const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx
    const tanY = Math.tan((40 * Math.PI) / 180 / 2)
    return { ex, ey, ez, fx, fy, fz, rx, ry, rz, ux, uy, uz, tanX: tanY * aspect, tanY }
  }

  /** What a pointer at normalized device coords (u right, v up, both -1..1) is over. */
  pick(u: number, v: number, aspect: number): Pick {
    const B = this.basis(aspect)
    let dx = B.fx + B.rx * u * B.tanX + B.ux * v * B.tanY
    let dy = B.fy + B.ry * u * B.tanX + B.uy * v * B.tanY
    let dz = B.fz + B.rz * u * B.tanX + B.uz * v * B.tanY
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l
    const b = this.ball
    if (b.on) {
      const ox = B.ex - b.x, oy = B.ey - b.y, oz = B.ez - b.z
      const bb = ox * dx + oy * dy + oz * dz, cc = ox * ox + oy * oy + oz * oz - (b.r * 1.15) ** 2
      if (bb * bb - cc > 0 && -bb > 0) return { kind: 'ball', x: b.x, z: b.z }
    }
    if (dy >= -1e-4) return { kind: 'none', x: 0, z: 0 }
    const t = (WATER_LEVEL - B.ey) / dy
    const x = B.ex + dx * t, z = B.ez + dz * t
    // The near deck hides the water right behind its edge: test where the ray crosses y = 0 too.
    const t0 = -B.ey / dy
    const x0 = B.ex + dx * t0, z0 = B.ez + dz * t0
    if (Math.abs(x0) > 1 || Math.abs(z0) > 1) return { kind: 'none', x: x0, z: z0 }
    if (Math.abs(x) >= 1 || Math.abs(z) >= 1) return { kind: 'none', x, z }
    return { kind: 'water', x, z }
  }

  orbit(dyaw: number, dpitch: number) {
    this.cam.yaw += dyaw
    this.cam.pitch = Math.max(0.42, Math.min(1.5, this.cam.pitch + dpitch))
  }
  zoom(f: number) { this.cam.dist = Math.max(2.4, Math.min(6, this.cam.dist * f)) }

  stats() {
    return { sim: this.water.n, photons: this.caustics.p, caustics: this.caustics.c, landed: this.caustics.landed, mean: this.caustics.mean(), max: this.caustics.max() }
  }
}

function sample(f: Float32Array, n: number, x: number, z: number) {
  let fx = ((x + 1) / 2) * n - 0.5, fz = ((z + 1) / 2) * n - 0.5
  fx = Math.max(0, Math.min(n - 1.001, fx)); fz = Math.max(0, Math.min(n - 1.001, fz))
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * n + i
  const a = f[k]! + (f[k + 1]! - f[k]!) * tx, b = f[k + n]! + (f[k + n + 1]! - f[k + n]!) * tx
  return a + (b - a) * tz
}

/** Column-depth of a sphere footprint: add back the old one, take away the new one. */
function displace(w: Water, ox: number, oz: number, r: number, k: number, nx: number, nz: number) {
  const n = w.n, h = w.h
  const minx = Math.min(ox, nx) - r, maxx = Math.max(ox, nx) + r, minz = Math.min(oz, nz) - r, maxz = Math.max(oz, nz) + r
  const i0 = Math.max(0, Math.floor(((minx + 1) / 2) * n)), i1 = Math.min(n - 1, Math.ceil(((maxx + 1) / 2) * n))
  const j0 = Math.max(0, Math.floor(((minz + 1) / 2) * n)), j1 = Math.min(n - 1, Math.ceil(((maxz + 1) / 2) * n))
  const r2 = r * r
  for (let j = j0; j <= j1; j++) {
    const z = -1 + ((j + 0.5) * 2) / n
    for (let i = i0; i <= i1; i++) {
      const x = -1 + ((i + 0.5) * 2) / n
      const a = r2 - ((x - ox) ** 2 + (z - oz) ** 2), b = r2 - ((x - nx) ** 2 + (z - nz) ** 2)
      h[j * n + i]! += k * ((a > 0 ? Math.sqrt(a) : 0) - (b > 0 ? Math.sqrt(b) : 0))
    }
  }
}
