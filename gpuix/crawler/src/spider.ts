import {
  type V3, GAIT_GROUPS, add3, clamp, easeOut, len2, lerp, lerp3, scale3, solveTwoBone, springAngle, wrapAngle,
} from './math'

// Body-frame layout, in px at scale 1. Index i = 0 front … 3 back.
const HIP_FWD = [5, 2, -1.5, -4.5]
const HIP_SIDE = [4.5, 5.5, 5.5, 4.5]
const REST_ANGLE = [38, 78, 112, 150].map((d) => (d * Math.PI) / 180)
const REST_DIST = [60, 54, 54, 62]
export const FEMUR = 30
export const TIBIA = 34
export const TARSUS = 13
export const BODY_H = 14
export const CEPH_R = { a: 12, b: 10 }
export const ABD_R = { a: 17, b: 13.5 }

export type SpiderState =
  | 'drop' | 'wander' | 'toLink' | 'scan' | 'hunt' | 'eat' | 'flee' | 'freeze' | 'dead' | 'toWeb' | 'web' | 'follow' | 'idle'

export type LegPose = { hip: V3; knee: V3; ankle: V3; foot: V3 }

export class Leg {
  stepping = false
  stepT = 0
  stepDur = 0.12
  from: V3 = { x: 0, y: 0, z: 0 }
  to: V3 = { x: 0, y: 0, z: 0 }
  foot: V3 = { x: 0, y: 0, z: 0 }
  constructor(public index: number) {}
  get side() { return this.index < 4 ? -1 : 1 }
  get i() { return this.index % 4 }
}

export class Spider {
  x: number
  y: number
  heading: number
  headingVel = 0
  vx = 0
  vy = 0
  k: number
  growTo: number
  legs: Leg[] = []
  state: SpiderState = 'wander'
  stateT = 0
  target: { x: number; y: number } | null = null
  path: { x: number; y: number }[] = []
  speed = 70
  gaitPhase = 0
  curl = 0
  curlTarget = 0
  fat = 1
  eaten = 0
  blink = 0
  // drop-on-silk state
  anchor: { x: number; y: number } | null = null
  threadLen = 0
  dropTo = 0
  swing = 0
  threadFade = 0
  linkId: string | null = null
  flyId: number | null = null
  webId: number | null = null
  nextThink = 0
  hue: number

  constructor(public id: number, x: number, y: number, opts: { k?: number; heading?: number; hue?: number } = {}) {
    this.x = x
    this.y = y
    this.k = opts.k ?? 1
    this.growTo = this.k
    this.heading = opts.heading ?? Math.PI / 2
    this.hue = opts.hue ?? 0
    for (let i = 0; i < 8; i++) this.legs.push(new Leg(i))
    this.plantAll()
  }

  get fwd() { return { x: Math.cos(this.heading), y: Math.sin(this.heading) } }
  get right() { return { x: -Math.sin(this.heading), y: Math.cos(this.heading) } }
  get reach() { return 56 * this.k }
  get bodyHeight() { return BODY_H * this.k * (1 - 0.55 * this.curl) }

  hip(leg: Leg): V3 {
    const f = this.fwd, r = this.right, k = this.k
    const a = HIP_FWD[leg.i]! * k, s = HIP_SIDE[leg.i]! * k * leg.side
    return { x: this.x + f.x * a + r.x * s, y: this.y + f.y * a + r.y * s, z: this.bodyHeight }
  }

  rest(leg: Leg, heading = this.heading, x = this.x, y = this.y): V3 {
    const ang = REST_ANGLE[leg.i]!, d = REST_DIST[leg.i]! * this.k
    const f = { x: Math.cos(heading), y: Math.sin(heading) }
    const r = { x: -Math.sin(heading), y: Math.cos(heading) }
    const c = Math.cos(ang) * d, s = Math.sin(ang) * d * leg.side
    return { x: x + f.x * c + r.x * s, y: y + f.y * c + r.y * s, z: 0 }
  }

  plantAll() {
    for (const l of this.legs) {
      l.foot = this.rest(l)
      l.stepping = false
    }
  }

  /** Advance legs: tetrapod gait, a group steps only when the other group is planted. */
  updateLegs(dt: number) {
    const speed = len2(this.vx, this.vy)
    const thresh = this.reach * 0.4
    for (const l of this.legs) {
      if (!l.stepping) continue
      l.stepT += dt / l.stepDur
      if (l.stepT >= 1) {
        l.stepping = false
        l.foot = { ...l.to, z: 0 }
      }
    }
    if (this.state === 'drop' || this.curl > 0.05) return
    const busy = [0, 1].map((g) => GAIT_GROUPS[g]!.some((i) => this.legs[i]!.stepping))
    if (busy[0] || busy[1]) return
    // pick the group with the largest error
    let best = -1, bestErr = 0
    for (let g = 0; g < 2; g++) {
      for (const i of GAIT_GROUPS[g]!) {
        const l = this.legs[i]!
        const r = this.rest(l)
        const e = len2(l.foot.x - r.x, l.foot.y - r.y)
        if (e > thresh && e > bestErr) { bestErr = e; best = g }
      }
    }
    if (best < 0) return
    const dur = clamp(0.13 - speed * 0.00025, 0.07, 0.13)
    const lead = dur * 1.6
    const fh = this.heading + this.headingVel * lead * 0.5
    for (const i of GAIT_GROUPS[best]!) {
      const l = this.legs[i]!
      const r = this.rest(l, fh, this.x + this.vx * lead, this.y + this.vy * lead)
      const e = len2(l.foot.x - r.x, l.foot.y - r.y)
      if (e < thresh * 0.25) continue
      l.stepping = true
      l.stepT = 0
      l.stepDur = dur
      l.from = { ...l.foot }
      l.to = r
    }
  }

  /** Current foot position including the step arc. */
  footPos(l: Leg): V3 {
    if (!l.stepping) return l.foot
    const t = easeOut(clamp(l.stepT, 0, 1))
    const p = lerp3(l.from, l.to, t)
    p.z = Math.sin(Math.PI * clamp(l.stepT, 0, 1)) * 10 * this.k
    return p
  }

  pose(l: Leg): LegPose {
    const hip = this.hip(l)
    let foot = this.footPos(l)
    if (this.curl > 0) {
      const f = this.fwd, r = this.right
      const out = { x: r.x * l.side, y: r.y * l.side }
      const along = (1.5 - l.i) * 6 * this.k
      const tuck: V3 = {
        x: hip.x + out.x * 14 * this.k + f.x * along,
        y: hip.y + out.y * 14 * this.k + f.y * along,
        z: hip.z + 6 * this.k,
      }
      foot = lerp3(foot, tuck, this.curl)
    }
    // tarsus stays near the surface normal: ankle sits above the foot, a little inward
    const ix = hip.x - foot.x, iy = hip.y - foot.y
    const il = Math.hypot(ix, iy) || 1
    const tz = TARSUS * this.k * lerp(0.85, 0.3, this.curl)
    const ankle0: V3 = { x: foot.x + (ix / il) * TARSUS * this.k * 0.35, y: foot.y + (iy / il) * TARSUS * this.k * 0.35, z: foot.z + tz }
    const outward: V3 = { x: -ix / il, y: -iy / il, z: 0 }
    const hint = add3({ x: 0, y: 0, z: 1 }, scale3(outward, 0.6))
    const { knee, end } = solveTwoBone(hip, ankle0, FEMUR * this.k, TIBIA * this.k, hint)
    return { hip, knee, ankle: end, foot }
  }

  /** Steer toward target and update heading with a critically damped spring. */
  steer(dt: number, tx: number, ty: number, maxSpeed: number, omega = 9) {
    const dx = tx - this.x, dy = ty - this.y
    const d = Math.hypot(dx, dy)
    const want = d > 0.5 ? Math.atan2(dy, dx) : this.heading
    ;[this.heading, this.headingVel] = springAngle(this.heading, this.headingVel, want, omega, dt)
    const align = clamp(Math.cos(wrapAngle(want - this.heading)), 0, 1)
    const sp = Math.min(maxSpeed, d * 3) * (0.15 + 0.85 * align * align)
    const f = this.fwd
    const ax = f.x * sp - this.vx, ay = f.y * sp - this.vy
    const acc = Math.min(1, dt * 10)
    this.vx += ax * acc
    this.vy += ay * acc
    return d
  }

  brake(dt: number) {
    const acc = Math.min(1, dt * 12)
    this.vx -= this.vx * acc
    this.vy -= this.vy * acc
  }

  integrate(dt: number) {
    this.x += this.vx * dt
    this.y += this.vy * dt
    this.gaitPhase += (len2(this.vx, this.vy) * dt) / (8 * this.k)
    if (this.k < this.growTo) this.k = Math.min(this.growTo, this.k + dt * 0.012)
    this.curl += (this.curlTarget - this.curl) * Math.min(1, dt * (this.curlTarget > this.curl ? 14 : 5))
  }

  hitTest(x: number, y: number) {
    const f = this.fwd
    const ax = this.x - f.x * 26 * this.k, ay = this.y - f.y * 26 * this.k
    return Math.hypot(x - this.x, y - this.y) < 18 * this.k || Math.hypot(x - ax, y - ay) < 20 * this.k
  }
}
