import { clamp, len2, rng } from './math'
import { Spider } from './spider'

export type Rect = { x: number; y: number; w: number; h: number }
export type LinkRect = Rect & { id: string; href: string; text: string }
export type Fly = { id: number; x: number; y: number; t0: number; claimedBy: number | null; eatenAt: number | null }
export type Web = { id: number; cx: number; cy: number; r: number; t0: number; dur: number; seed: number; spokes: number }
export type Scan = { linkId: string; spiderId: number; progress: number; done: number | null }
export type Toast = { id: number; text: string; x: number; y: number; t0: number }

export const FLEE_RADIUS = 80

export function domainOf(href: string) {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}

/** All crawler state in doc (page) pixels. Pure logic: no GPUIX imports, so it is unit-testable. */
export class Sim {
  t = 0
  spiders: Spider[] = []
  flies: Fly[] = []
  webs: Web[] = []
  scans = new Map<string, Scan>()
  toasts: Toast[] = []
  indexed = new Set<string>()
  lines: Rect[] = []
  links: LinkRect[] = []
  page = { w: 1200, h: 2000 }
  view = { scrollY: 0, w: 1200, h: 800 }
  cursor: { x: number; y: number } | null = null
  follow = false
  chaos = false
  still = false
  stats = { eaten: 0, hatched: 0 }
  onFollowLink: ((link: LinkRect) => void) | null = null
  private nextId = 1
  private acc = 0
  private rand: () => number
  private claimed = new Map<string, number>()

  constructor(seed = 7) {
    this.rand = rng(seed)
  }

  setSurface(lines: Rect[], links: LinkRect[], page: { w: number; h: number }) {
    this.lines = lines
    this.links = links
    this.page = page
  }

  /** A new spider lowers itself from the top of the viewport on a silk thread. */
  dropSpider(x?: number, opts: { k?: number; landY?: number } = {}) {
    const ax = x ?? 80 + this.rand() * Math.max(100, this.view.w - 160)
    const top = this.view.scrollY - 30
    const s = new Spider(this.nextId++, ax, top, { k: opts.k ?? 0.9 + this.rand() * 0.2, heading: Math.PI / 2, hue: this.rand() })
    s.state = 'drop'
    s.anchor = { x: ax, y: top }
    s.threadLen = 0
    s.dropTo = opts.landY ?? this.view.scrollY + 140 + this.rand() * Math.max(80, this.view.h * 0.45)
    s.swing = (this.rand() - 0.5) * 0.5
    s.curl = s.curlTarget = 0.55
    this.spiders.push(s)
    return s
  }

  hatch(parent: Spider) {
    const s = new Spider(this.nextId++, parent.x - parent.fwd.x * 30, parent.y - parent.fwd.y * 30, {
      k: 0.5, heading: parent.heading + Math.PI, hue: this.rand(),
    })
    s.growTo = 0.85
    this.spiders.push(s)
    this.stats.hatched++
    this.toast('a spiderling hatched', s.x, s.y - 30)
    return s
  }

  addFly(x: number, y: number) {
    const f: Fly = { id: this.nextId++, x, y, t0: this.t, claimedBy: null, eatenAt: null }
    this.flies.push(f)
    return f
  }

  feed(n: number) {
    for (let i = 0; i < n; i++) {
      const x = 60 + this.rand() * Math.max(100, this.view.w - 120)
      const y = this.view.scrollY + 80 + this.rand() * Math.max(100, this.view.h - 160)
      this.addFly(x, y)
    }
  }

  /** Click: a spider under the point plays dead. Returns the spider or null. */
  poke(x: number, y: number) {
    for (let i = this.spiders.length - 1; i >= 0; i--) {
      const s = this.spiders[i]!
      if (s.state !== 'drop' && s.hitTest(x, y)) {
        this.release(s)
        this.setState(s, 'dead')
        s.curlTarget = 1
        return s
      }
    }
    return null
  }

  buildWeb(spider?: Spider) {
    const s = spider ?? this.spiders.find((p) => this.free(p)) ?? null
    if (!s) return null
    const corners = [
      { x: 150, y: this.view.scrollY + 150 },
      { x: this.view.w - 150, y: this.view.scrollY + 150 },
      { x: 150, y: this.view.scrollY + this.view.h - 150 },
      { x: this.view.w - 150, y: this.view.scrollY + this.view.h - 150 },
    ]
    corners.sort((a, b) => len2(a.x - s.x, a.y - s.y) - len2(b.x - s.x, b.y - s.y))
    const taken = (c: { x: number; y: number }) => this.webs.some((w) => len2(w.cx - c.x, w.cy - c.y) < 120)
    const c = corners.find((p) => !taken(p)) ?? corners[0]!
    const w: Web = { id: this.nextId++, cx: c.x, cy: c.y, r: 120, t0: -1, dur: 2.2, seed: Math.floor(this.rand() * 1e9), spokes: 14 }
    this.webs.push(w)
    if (this.webs.length > 3) this.webs.shift()
    this.release(s)
    s.webId = w.id
    this.setState(s, 'toWeb')
    s.target = { x: c.x, y: c.y }
    return w
  }

  toast(text: string, x: number, y: number) {
    this.toasts.push({ id: this.nextId++, text, x, y, t0: this.t })
  }

  step(dt: number) {
    this.acc += Math.min(dt, 0.1)
    const h = 1 / 120
    while (this.acc >= h) {
      this.acc -= h
      this.fixed(h)
    }
    this.toasts = this.toasts.filter((t) => this.t - t.t0 < 1.8)
    for (const [id, sc] of this.scans) if (sc.done !== null && this.t - sc.done > 1.2) this.scans.delete(id)
    this.flies = this.flies.filter((f) => f.eatenAt === null || this.t - f.eatenAt < 0.5)
  }

  private free(s: Spider) {
    return s.state === 'wander' || s.state === 'idle' || s.state === 'follow'
  }

  private setState(s: Spider, st: Spider['state']) {
    s.state = st
    s.stateT = 0
  }

  private release(s: Spider) {
    if (s.linkId) {
      this.claimed.delete(s.linkId)
      const sc = this.scans.get(s.linkId)
      if (sc && sc.done === null) this.scans.delete(s.linkId)
    }
    s.linkId = null
    if (s.flyId !== null) {
      const f = this.flies.find((q) => q.id === s.flyId)
      if (f && f.eatenAt === null) f.claimedBy = null
    }
    s.flyId = null
    s.path = []
    s.target = null
    s.curlTarget = 0
  }

  private visibleLines(s: Spider) {
    const top = this.view.scrollY + 30, bot = this.view.scrollY + this.view.h - 30
    return this.lines.filter((l) => l.y > top && l.y + l.h < bot && Math.abs(l.y - s.y) < 420)
  }

  private pickWander(s: Spider) {
    const lines = this.visibleLines(s)
    if (lines.length && this.rand() < 0.7) {
      const l = lines[Math.floor(this.rand() * lines.length)]!
      const cy = l.y + l.h / 2
      const a = { x: l.x + 4, y: cy }, b = { x: l.x + l.w - 4, y: cy }
      s.path = len2(a.x - s.x, a.y - s.y) < len2(b.x - s.x, b.y - s.y) ? [a, b] : [b, a]
    } else {
      s.path = [{
        x: 60 + this.rand() * Math.max(60, this.view.w - 120),
        y: this.view.scrollY + 60 + this.rand() * Math.max(60, this.view.h - 120),
      }]
    }
    s.speed = 55 + this.rand() * 35
  }

  private nearestLink(s: Spider) {
    let best: LinkRect | null = null, bd = 520
    for (const l of this.links) {
      if (this.indexed.has(l.id) || this.claimed.has(l.id)) continue
      if (l.y < this.view.scrollY || l.y > this.view.scrollY + this.view.h - 20) continue
      const d = len2(l.x - s.x, l.y + l.h / 2 - s.y)
      if (d < bd) { bd = d; best = l }
    }
    return best
  }

  private nearestFly(s: Spider) {
    let best: Fly | null = null, bd = 900
    for (const f of this.flies) {
      if (f.eatenAt !== null || (f.claimedBy !== null && f.claimedBy !== s.id)) continue
      const d = len2(f.x - s.x, f.y - s.y)
      if (d < bd) { bd = d; best = f }
    }
    return best
  }

  private fixed(dt: number) {
    this.t += dt
    for (const s of this.spiders) this.think(s, dt)
    // separation so spiders don't stack
    for (let i = 0; i < this.spiders.length; i++) {
      for (let j = i + 1; j < this.spiders.length; j++) {
        const a = this.spiders[i]!, b = this.spiders[j]!
        if (a.state === 'drop' || b.state === 'drop' || a.state === 'dead' || b.state === 'dead') continue
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy)
        const min = 46 * (a.k + b.k) / 2
        if (d > 0.01 && d < min) {
          const p = ((min - d) / d) * 0.5 * Math.min(1, dt * 8)
          a.x -= dx * p; a.y -= dy * p; b.x += dx * p; b.y += dy * p
        }
      }
    }
    for (const s of this.spiders) {
      s.x = clamp(s.x, 20, Math.max(40, this.page.w - 20))
      s.y = clamp(s.y, -200, Math.max(200, this.page.h + 40))
    }
  }

  private think(s: Spider, dt: number) {
    s.stateT += dt
    s.blink = Math.max(0, s.blink - dt)
    if (s.blink === 0 && this.rand() < dt * 0.4) s.blink = 0.15
    if (s.threadFade > 0) s.threadFade = Math.max(0, s.threadFade - dt * 1.5)

    if (s.state === 'drop') {
      const a = s.anchor!
      s.threadLen = Math.min(s.dropTo - a.y, s.threadLen + dt * 190)
      const ang = s.swing * Math.cos(this.t * 3.1) * Math.exp(-s.stateT * 0.6)
      s.x = a.x + Math.sin(ang) * s.threadLen
      s.y = a.y + Math.cos(ang) * s.threadLen
      s.heading = Math.PI / 2 + ang
      if (s.threadLen >= s.dropTo - a.y - 0.5) {
        s.threadFade = 1
        s.curlTarget = 0
        s.plantAll()
        this.setState(s, 'wander')
      }
      s.integrate(0)
      s.curl += (s.curlTarget - s.curl) * Math.min(1, dt * 3)
      return
    }

    if (this.still) {
      s.brake(dt)
      s.integrate(dt)
      s.updateLegs(dt)
      return
    }

    // the cursor scares spiders unless follow mode is on
    const c = this.cursor
    if (c && !this.follow && s.state !== 'dead' && s.state !== 'flee' && s.state !== 'freeze' && s.state !== 'eat') {
      if (len2(c.x - s.x, c.y - s.y) < FLEE_RADIUS + 10 * s.k) {
        this.release(s)
        this.setState(s, 'flee')
      }
    }

    switch (s.state) {
      case 'dead': {
        s.brake(dt)
        if (s.stateT > 2) { s.curlTarget = 0 }
        if (s.stateT > 2.5) this.setState(s, 'wander')
        break
      }
      case 'flee': {
        if (c) {
          const dx = s.x - c.x, dy = s.y - c.y, d = Math.hypot(dx, dy) || 1
          s.steer(dt, s.x + (dx / d) * 120, s.y + (dy / d) * 120, 300, 18)
          if (d > FLEE_RADIUS * 2.2 || s.stateT > 0.9) this.setState(s, 'freeze')
        } else this.setState(s, 'freeze')
        break
      }
      case 'freeze': {
        s.brake(dt)
        if (s.stateT > 0.7) this.setState(s, 'wander')
        break
      }
      case 'eat': {
        s.brake(dt)
        if (s.stateT > 0.6) {
          s.eaten++
          s.fat = Math.min(1.3, s.fat + 0.07)
          this.stats.eaten++
          s.flyId = null
          this.setState(s, 'wander')
          if (s.eaten % 3 === 0 && this.spiders.length < 10) this.hatch(s)
        }
        break
      }
      case 'hunt': {
        const f = this.flies.find((q) => q.id === s.flyId)
        if (!f || f.eatenAt !== null) { this.release(s); this.setState(s, 'wander'); break }
        const d = s.steer(dt, f.x, f.y, 170, 12)
        if (d < 14 * s.k) {
          f.eatenAt = this.t
          this.setState(s, 'eat')
        }
        break
      }
      case 'toLink': {
        const l = this.links.find((q) => q.id === s.linkId)
        if (!l) { this.release(s); this.setState(s, 'wander'); break }
        const d = s.steer(dt, l.x, l.y + l.h / 2, 120)
        if (d < 8) {
          this.setState(s, 'scan')
          this.scans.set(l.id, { linkId: l.id, spiderId: s.id, progress: 0, done: null })
        }
        break
      }
      case 'scan': {
        const l = this.links.find((q) => q.id === s.linkId)
        const sc = l && this.scans.get(l.id)
        if (!l || !sc) { this.release(s); this.setState(s, 'wander'); break }
        s.steer(dt, l.x + l.w, l.y + l.h / 2, 75)
        sc.progress = clamp((s.x - l.x) / Math.max(1, l.w), sc.progress, 1)
        if (sc.progress > 0.97 || s.stateT > 8) {
          sc.progress = 1
          sc.done = this.t
          this.indexed.add(l.id)
          this.claimed.delete(l.id)
          s.linkId = null
          this.toast(`indexed: ${domainOf(l.href)}`, l.x + l.w, l.y - 6)
          this.setState(s, 'wander')
          s.nextThink = this.t + 1.5
          if (this.chaos && this.onFollowLink) {
            const cb = this.onFollowLink
            setTimeout(() => cb(l), 700)
          }
        }
        break
      }
      case 'toWeb': {
        const w = this.webs.find((q) => q.id === s.webId)
        if (!w) { this.setState(s, 'wander'); break }
        const d = s.steer(dt, w.cx, w.cy, 140)
        if (d < 6) { w.t0 = this.t; this.setState(s, 'web') }
        break
      }
      case 'web': {
        s.brake(dt)
        const w = this.webs.find((q) => q.id === s.webId)
        s.heading += dt * 2.4
        if (!w || s.stateT > w.dur + 0.2) { s.webId = null; this.setState(s, 'wander'); s.nextThink = this.t + 4 }
        break
      }
      case 'follow':
      case 'wander':
      case 'idle': {
        // priorities: flies > follow cursor > links > wander
        const fly = this.nearestFly(s)
        if (fly) {
          fly.claimedBy = s.id
          s.flyId = fly.id
          s.path = []
          this.setState(s, 'hunt')
          break
        }
        if (this.follow && c) {
          s.state = 'follow'
          if (len2(c.x - s.x, c.y - s.y) > 60) s.steer(dt, c.x, c.y, 160, 10)
          else s.brake(dt)
          break
        }
        if (s.state === 'follow') s.state = 'wander'
        if (this.t > s.nextThink) {
          s.nextThink = this.t + 1.2 + this.rand() * 1.5
          const link = this.nearestLink(s)
          if (link && this.rand() < 0.75) {
            this.claimed.set(link.id, s.id)
            s.linkId = link.id
            s.path = []
            this.setState(s, 'toLink')
            break
          }
          if (this.webs.length < 2 && this.rand() < 0.03) { this.buildWeb(s); break }
        }
        if (s.path.length === 0) {
          if (s.state === 'idle') {
            s.brake(dt)
            if (s.stateT > 0.8 + this.rand() * 2) { this.pickWander(s); s.state = 'wander' }
            break
          }
          this.pickWander(s)
        }
        const p = s.path[0]!
        const d = s.steer(dt, p.x, p.y, s.speed)
        if (d < 6) {
          s.path.shift()
          if (s.path.length === 0 && this.rand() < 0.4) this.setState(s, 'idle')
        }
        break
      }
    }
    s.integrate(dt)
    s.updateLegs(dt)
  }
}
