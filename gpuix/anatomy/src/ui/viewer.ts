import { writeFileSync } from 'node:fs'
import { add, cross, norm, scale } from '../math'
import type { Vec3 } from '../spec/types'
import { encodePng } from '../png'
import { FOV, ISO_PITCH, ISO_YAW, Renderer, type Camera, type Palette } from '../render/renderer'
import { Scene, type PartState } from '../scene'
import { slugify } from '../designers/kit'
import type { MachineSpec } from '../spec/types'

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4]
const MAX_PIXELS = 1_150_000

export interface Toast { text: string; kind: 'ok' | 'err' | 'info'; at: number }

/** Everything the UI shows, independent of React: clock, camera, explode, selection, and the CPU renderer. */
export class Viewer {
  scene: Scene
  renderer = new Renderer()
  t = 0
  playing = true
  speed = 1
  explode = 0
  explodeTarget = 0
  cam: Camera
  hover = -1
  selected = -1
  effects = true
  panel = true
  toast: Toast | null = null
  reloads = 0
  fps = 0
  private dirty = true
  private frames: number[] = []
  private listeners = new Set<() => void>()

  constructor(public spec: MachineSpec, public palette: Palette, public source?: string) {
    this.scene = new Scene(spec)
    this.cam = this.homeCamera()
  }

  homeCamera(): Camera {
    const c = this.spec.meta.camera ?? {}
    return { view: c.view ?? 'iso', yaw: ISO_YAW + (c.yaw ?? 0), pitch: c.pitch ?? ISO_PITCH, dist: (this.scene.radius * 1.8) / (c.zoom ?? 1), target: [...this.scene.center] as Vec3 }
  }

  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f) } }
  emit() { this.dirty = true; for (const f of this.listeners) f() }
  say(text: string, kind: Toast['kind'] = 'info') { this.toast = { text, kind, at: Date.now() }; this.emit() }

  /** Swap in a new spec (hot reload). Same machine keeps camera, clock and selection; a new machine reframes. */
  load(spec: MachineSpec, note?: string) {
    const same = spec.meta.name === this.spec.meta.name
    const selId = this.selected >= 0 ? this.scene.parts[this.selected]?.part.id : undefined
    this.spec = spec
    this.scene = new Scene(spec)
    if (!same) this.cam = this.homeCamera()
    this.selected = selId !== undefined ? (this.scene.byId.get(selId) ?? -1) : -1
    this.hover = -1
    this.reloads++
    if (note) this.say(note, 'ok')
    else this.emit()
  }

  /** Advance the master clock and the explode spring. */
  tick(dt: number) {
    if (this.playing) { this.t += dt * this.speed; this.dirty = true }
    const d = this.explodeTarget - this.explode
    if (Math.abs(d) > 1e-4) { this.explode += d * Math.min(1, dt * 7); this.dirty = true } else this.explode = this.explodeTarget
    if (this.toast && Date.now() - this.toast.at > 3500 && this.toast.kind !== 'err') { this.toast = null; this.emit() }
  }

  /** Render into the CPU buffer if anything changed. Returns null when the previous frame is still valid. */
  frame(w: number, h: number): { w: number; h: number; rgba: Uint8Array } | null {
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)))
    const rw = Math.max(16, Math.round(w * k)), rh = Math.max(16, Math.round(h * k))
    const r = this.renderer
    if (!this.dirty && r.w === rw && r.h === rh) return null
    this.dirty = false
    r.resize(rw, rh)
    this.scene.pose(this.t, this.explode)
    r.render({ scene: this.scene, camera: { ...this.cam, dist: this.cam.dist * (1 + 0.55 * this.explode) * Math.max(1, h / w / 0.8) }, time: this.t, hover: this.hover, selected: this.selected, palette: this.palette, effects: this.effects })
    const now = performance.now()
    this.frames.push(now)
    while (this.frames.length && now - this.frames[0]! > 1000) this.frames.shift()
    this.fps = this.frames.length
    return { w: rw, h: rh, rgba: r.rgba }
  }

  /** Viewport (layout px) → part index under the cursor. */
  pick(x: number, y: number, vw: number, vh: number): number {
    const r = this.renderer
    if (!r.w || vw <= 0 || vh <= 0) return -1
    return r.pickAt(Math.floor((x / vw) * r.w), Math.floor((y / vh) * r.h))
  }

  setHover(i: number) { if (i !== this.hover) { this.hover = i; this.emit() } }
  select(i: number) { this.selected = i; this.emit() }

  orbit(dx: number, dy: number) {
    this.cam = { ...this.cam, yaw: this.cam.yaw - dx * 0.008, pitch: Math.max(-1.45, Math.min(1.45, this.cam.pitch + dy * 0.008)) }
    this.emit()
  }

  /** Screen-space pan by (dx, dy) layout pixels in a viewport of height vh. */
  pan(dx: number, dy: number, vh: number) {
    const c = this.cam
    const D: Vec3 = [Math.cos(c.pitch) * Math.sin(c.yaw), Math.sin(c.pitch), Math.cos(c.pitch) * Math.cos(c.yaw)]
    const R = norm(cross([0, 1, 0], D)), U = cross(D, R)
    const perPx = (c.dist * Math.tan(FOV / 2) * 2) / Math.max(1, vh)
    this.cam = { ...c, target: add(c.target, add(scale(R, -dx * perPx), scale(U, dy * perPx))) }
    this.emit()
  }

  zoom(f: number) {
    const r = this.scene.radius
    this.cam = { ...this.cam, dist: Math.max(r * 0.08, Math.min(r * 8, this.cam.dist * f)) }
    this.emit()
  }

  focus(i: number) {
    if (i < 0) return
    this.selected = i
    this.cam = { ...this.cam, target: this.scene.partCenter(i), dist: Math.max(this.scene.partRadius(i) * 3.2, this.scene.radius * 0.3) }
    this.emit()
  }

  resetCamera() { this.cam = this.homeCamera(); this.emit() }
  toggleView() { this.cam = { ...this.cam, view: this.cam.view === 'iso' ? 'perspective' : 'iso' }; this.emit() }
  togglePlay() { this.playing = !this.playing; this.emit() }
  step(dir: number) { this.playing = false; this.t = Math.max(0, this.t + dir / 60); this.emit() }
  setSpeed(dir: number) {
    const i = SPEEDS.findIndex((s) => s >= this.speed - 1e-6)
    this.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.length - 1 : i) + dir))]!
    this.emit()
  }
  setExplode(v: number) { this.explodeTarget = Math.max(0, Math.min(1, v)); this.emit() }

  /** Move the selection through the part tree order. */
  walk(dir: number) {
    const n = this.scene.parts.length
    this.select(this.selected < 0 ? (dir > 0 ? 0 : n - 1) : (this.selected + dir + n) % n)
  }

  partState(i: number): PartState { return this.scene.state(i, this.t) }

  snapshot(dir = process.cwd()): string {
    const r = this.renderer
    const file = `${dir}/anatomy-${slugify(this.spec.meta.name)}-${Math.round(this.t * 1000)}.png`
    writeFileSync(file, encodePng(r.w, r.h, r.rgba))
    this.say(`saved ${file.replace(`${process.cwd()}/`, '')}`, 'ok')
    return file
  }

  /** Keyboard map shared by the app and the tests. Returns true when handled. */
  key(k: string, shift = false): boolean {
    switch (k) {
      case ' ': case 'space': this.togglePlay(); return true
      case '.': this.step(1); return true
      case ',': this.step(-1); return true
      case ']': this.setSpeed(1); return true
      case '[': this.setSpeed(-1); return true
      case 'e': this.setExplode(this.explodeTarget > 0.5 ? 0 : 1); return true
      case '=': case '+': this.setExplode(this.explodeTarget + 0.1); return true
      case '-': this.setExplode(this.explodeTarget - 0.1); return true
      case 'v': this.toggleView(); return true
      case 'f': this.effects = !this.effects; this.emit(); return true
      case 'i': case 't': this.panel = !this.panel; this.emit(); return true
      case 'r': this.resetCamera(); return true
      case 'p': this.snapshot(); return true
      case 'z': this.focus(this.selected); return true
      case 'down': case 'j': this.walk(1); return true
      case 'up': case 'k': this.walk(-1); return true
      case 'left': if (shift) this.pan(40, 0, 600); else this.orbit(-30, 0); return true
      case 'right': if (shift) this.pan(-40, 0, 600); else this.orbit(30, 0); return true
      case 'pageup': this.orbit(0, -30); return true
      case 'pagedown': this.orbit(0, 30); return true
      case 'escape': if (this.selected >= 0) this.select(-1); else this.resetCamera(); return true
      case 'enter': this.focus(this.selected); return true
    }
    return false
  }
}
