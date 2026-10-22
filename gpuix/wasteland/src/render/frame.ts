import type { GameState, ShotFx } from '../engine/game'
import { ENEMIES, NPCS } from '../engine/content'
import { liveActors, hitChance, weaponDef } from '../engine/game'
import { buildStatic, SH, SW, tileCenter } from './iso'
import { drawText, textWidth } from './font'
import { HUE_AMBER, HUE_BONE, HUE_CYAN, HUE_GREEN, HUE_RED, HUE_RUST, HUE_SKY, HUE_TOXIC, LUT } from './palette'
import { hash2 } from '../engine/rng'

export interface ShotAnim { fx: ShotFx; start: number; dur: number }
export interface View {
  width: number; height: number; time: number
  cam: [number, number] // static-art pixel at viewport center
  zoom: number
  hover: [number, number] | null
  anim: Map<string, { x: number; y: number; moving: number }>
  shots: ShotAnim[]
  flicker?: boolean
  cine?: number
  objective?: [number, number] | null
}
export interface FrameBuffers { art: { lum: Uint8Array; hue: Uint8Array; depth: Int16Array; emp: Uint8Array; w: number; h: number }; out: Uint8Array; out32: Uint32Array; w: number; h: number }

const lutCache = new Map<string, { idx: Int32Array; shade: Uint8Array; aw: number; ah: number }>()
function outLut(w: number, h: number, zoom: number) {
  const key = `${w}x${h}x${zoom}`
  let e = lutCache.get(key)
  if (e) return e
  const aw = Math.ceil(w / zoom), ah = Math.ceil(h / zoom)
  const idx = new Int32Array(w * h), shade = new Uint8Array(w * h)
  const k = 0.028
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x / w) * 2 - 1, ny = (y / h) * 2 - 1
    const d = nx * nx + ny * ny
    const cx = nx * (1 + k * d), cy = ny * (1 + k * d * 1.3)
    const i = y * w + x
    if (Math.abs(cx) > 1 || Math.abs(cy) > 1) { idx[i] = -1; shade[i] = 0; continue }
    const ax = Math.min(aw - 1, (((cx + 1) / 2) * w / zoom) | 0), ay = Math.min(ah - 1, (((cy + 1) / 2) * h / zoom) | 0)
    idx[i] = ay * aw + ax
    const scan = (y % zoom) === zoom - 1 ? 0.74 : 1
    const vig = 1 - 0.38 * Math.pow(d / 2, 1.4)
    const edge = Math.min(1, (1 - Math.abs(cx)) * 60, (1 - Math.abs(cy)) * 60)
    shade[i] = Math.max(0, Math.min(255, 255 * scan * vig * edge)) | 0
  }
  e = { idx, shade, aw, ah }
  if (lutCache.size > 8) lutCache.clear()
  lutCache.set(key, e)
  return e
}

export function createBuffers(w: number, h: number): FrameBuffers {
  const out = new Uint8Array(w * h * 4)
  return { art: { lum: new Uint8Array(0), hue: new Uint8Array(0), depth: new Int16Array(0), emp: new Uint8Array(0), w: 0, h: 0 }, out, out32: new Uint32Array(out.buffer), w, h }
}

/** Art-space pixel (static coords) under an output pixel; null outside the curved screen. */
export function pickArt(view: View, mx: number, my: number): [number, number] | null {
  const e = outLut(view.width, view.height, view.zoom)
  const i = e.idx[(my | 0) * view.width + (mx | 0)]
  if (i === undefined || i < 0) return null
  const ox = Math.round(view.cam[0] - e.aw / 2), oy = Math.round(view.cam[1] - e.ah / 2)
  return [ox + (i % e.aw), oy + ((i / e.aw) | 0)]
}

export function renderFrame(s: GameState, view: View, fb: FrameBuffers) {
  const st = buildStatic()
  const W = view.width, H = view.height
  const e = outLut(W, H, view.zoom)
  const aw = e.aw, ah = e.ah, n = aw * ah
  const art = fb.art
  if (art.w !== aw || art.h !== ah) { art.lum = new Uint8Array(n); art.hue = new Uint8Array(n); art.depth = new Int16Array(n); art.emp = new Uint8Array(n); art.w = aw; art.h = ah }
  const { lum, hue, depth, emp } = art
  const t = view.time
  // impacts: hit flash + screen shake
  const flashed = new Set<string>()
  let shake = 0
  for (const sa of view.shots) {
    const age = t - (sa.start + sa.dur)
    if (!sa.fx.hit || age < 0) continue
    if (age < 150) flashed.add(sa.fx.target)
    if (age < 240) shake = Math.max(shake, (sa.fx.crit ? 5 : sa.fx.byPlayer ? 2.5 : 3.5) * (1 - age / 240))
  }
  const shx = shake ? Math.round((hash2((t / 16) | 0, 1, 9) - 0.5) * 2 * shake) : 0
  const shy = shake ? Math.round((hash2((t / 16) | 0, 2, 9) - 0.5) * 2 * shake) : 0
  const ox = Math.round(view.cam[0] - aw / 2) + shx, oy = Math.round(view.cam[1] - ah / 2) + shy
  // 1. blit static layer
  for (let y = 0; y < ah; y++) {
    const sy = y + oy, row = y * aw
    if (sy < 0 || sy >= SH) { lum.fill(0, row, row + aw); depth.fill(-1, row, row + aw); emp.fill(1, row, row + aw); continue }
    const x0 = Math.max(0, -ox), x1 = Math.min(aw, SW - ox)
    if (x0 > 0) { lum.fill(0, row, row + x0); depth.fill(-1, row, row + x0); emp.fill(1, row, row + x0) }
    if (x1 < aw) { lum.fill(0, row + Math.max(0, x1), row + aw); depth.fill(-1, row + Math.max(0, x1), row + aw); emp.fill(1, row + Math.max(0, x1), row + aw) }
    if (x1 <= x0) continue
    const si = sy * SW + ox
    lum.set(st.lum.subarray(si + x0, si + x1), row + x0)
    hue.set(st.hue.subarray(si + x0, si + x1), row + x0)
    depth.set(st.depth.subarray(si + x0, si + x1), row + x0)
    emp.set(st.empty.subarray(si + x0, si + x1), row + x0)
    // animated radiation pools
    for (let x = x0; x < x1; x++) if (st.rad[si + x]) {
      const wv = Math.sin(t * 0.004 + (x + ox) * 0.21 + Math.sin((sy + t * 0.01) * 0.17) * 2)
      lum[row + x] = Math.min(255, st.lum[si + x]! + 60 + wv * 50) | 0
    }
  }
  backdrop(lum, hue, emp, aw, ah, ox, oy, t)
  const put = (x: number, y: number, l: number, h: number, d = 9999) => {
    x = (x - ox) | 0; y = (y - oy) | 0
    if (x < 0 || y < 0 || x >= aw || y >= ah) return
    const i = y * aw + x
    if (depth[i]! > d) return
    lum[i] = l; hue[i] = h
  }
  const tc = (tx: number, ty: number) => tileCenter(tx, ty)
  const diamond = (tx: number, ty: number, l: number, h: number, dotted = false) => {
    const [cx, cy] = tc(tx, ty)
    for (let i = 0; i <= 16; i++) {
      if (dotted && i % 3) continue
      put(cx - 16 + i, cy - i / 2, l, h, -1); put(cx + i, cy - 8 + i / 2, l, h, -1)
      put(cx - 16 + i, cy + i / 2, l, h, -1); put(cx + i, cy + 8 - i / 2, l, h, -1)
    }
  }
  const inCombat = s.mode === 'combat' || s.mode === 'target'
  // 2. ground overlays
  if (s.mode === 'combat') {
    const reach = s.player.ap
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === reach && reach > 0) diamond(s.player.x + dx, s.player.y + dy, 70, HUE_GREEN, true)
    }
  }
  for (const [px, py] of s.path) { const [cx, cy] = tc(px, py); for (let k = -1; k <= 1; k++) { put(cx + k, cy, 200, HUE_GREEN, -1); put(cx, cy + k, 200, HUE_GREEN, -1) } }
  if (view.hover) diamond(view.hover[0], view.hover[1], 150 + Math.sin(t * 0.01) * 60, HUE_GREEN)

  // 3. sprites in depth order
  type Spr = { d: number; draw: () => void }
  const sprites: Spr[] = []
  const pos = (id: string, x: number, y: number) => { const a = view.anim.get(id); return a ? [a.x, a.y, a.moving] as const : [x, y, 0] as const }
  const targetId = s.mode === 'target' ? s.target?.actor : null
  for (const c of s.containers) {
    const empty = c.opened && !c.items.length && !c.caps
    sprites.push({ d: c.x + c.y, draw: () => crate(put, tc(c.x, c.y), c.x + c.y, empty, c.id.startsWith('body_')) })
  }
  for (const a of s.actors) {
    if (a.removed) continue
    const [x, y, mv] = pos(a.id, a.x, a.y)
    const hu = a.dead ? HUE_GREEN : a.hostile ? (a.type === 'wrecker' || a.type === 'dutch' ? HUE_RED : HUE_AMBER) : HUE_AMBER
    const isTarget = a.id === targetId
    const flash = flashed.has(a.id)
    if (a.dead) sprites.push({ d: Math.floor(x + y) - 0.5, draw: () => splat(put, tc(x, y), a.type === 'hound' || a.type === 'rat' ? HUE_TOXIC : HUE_RED, a.id) })
    sprites.push({ d: Math.floor(x + y + 0.01), draw: () => {
      const [cx, cy] = tc(x, y)
      creature(put, a.type === 'dutch' ? 'boss' : ENEMIES[a.type]!.sprite, cx, cy, Math.round(x + y), t, mv, a.dead, flash ? HUE_BONE : hu, flash ? 255 : isTarget ? 255 : 200, a.x < s.player.x ? 1 : -1, a.id)
      if (!a.dead && inCombat && a.engaged) bar(put, cx, cy - (a.type === 'rat' ? 14 : 30), a.hp / a.maxHp, hu)
    } })
  }
  for (const nState of s.npcs) {
    if (nState.removed) continue
    const def = NPCS[nState.id]!
    const [x, y, mv] = pos(nState.id, nState.x, nState.y)
    sprites.push({ d: Math.floor(x + y + 0.01), draw: () => {
      const [cx, cy] = tc(x, y)
      if (def.sprite === 'dog') creature(put, 'dog', cx, cy, Math.round(x + y), t, mv, false, HUE_GREEN, 200, nState.x < s.player.x ? 1 : -1, def.id)
      else human(put, cx, cy, Math.round(x + y), t, mv, HUE_CYAN, 185, def.look.hair ?? 'buzz', nState.x < s.player.x ? 1 : -1, false, def.look.kid ? 0.75 : 1)
      if (!s.flags[`talked_${nState.id}`] && !inCombat) {
        const by = cy - (def.look.kid ? 30 : 36) + Math.sin(t * 0.006) * 2
        drawText(lum, hue, aw, ah, '!', cx - 2 - ox, by - oy, 255, HUE_AMBER)
      }
    } })
  }
  {
    const [x, y, mv] = pos('player', s.player.x, s.player.y)
    const face = [1, 1, 0, -1, -1, -1, 0, 1][s.player.facing] ?? 1
    sprites.push({ d: Math.floor(x + y + 0.01), draw: () => {
      const [cx, cy] = tc(x, y)
      human(put, cx, cy, Math.round(x + y), t, mv, HUE_GREEN, s.mode === 'dead' ? 90 : 240, 'player', face || 1, weaponDef(s).class === 'gun', 1, s.mode === 'dead')
    } })
  }
  sprites.sort((a, b) => a.d - b.d)
  for (const sp of sprites) sp.draw()

  // 3b. lighting + particles
  const lights = st.lights.slice()
  {
    const [px, py] = tc(...(pos('player', s.player.x, s.player.y).slice(0, 2) as [number, number]))
    lights.push({ x: px, y: py - 10, r: 46, i: 46, hue: HUE_GREEN, kind: 'lamp' })
    for (const sa of view.shots) {
      const p = (t - sa.start) / sa.dur
      if (p >= 0 && p < 0.18 && !sa.fx.melee) { const [fx0, fy0] = tc(sa.fx.fromX, sa.fx.fromY); lights.push({ x: fx0, y: fy0 - 14, r: 90, i: 200 * (1 - p / 0.18), hue: HUE_AMBER, kind: 'fire' }) }
      const ip = (t - sa.start - sa.dur) / 200
      if (sa.fx.hit && ip >= 0 && ip < 1) { const [fx1, fy1] = tc(sa.fx.toX, sa.fx.toY); lights.push({ x: fx1, y: fy1 - 12, r: 60, i: 160 * (1 - ip), hue: HUE_RUST, kind: 'fire' }) }
    }
  }
  for (const L of lights) {
    const lx = L.x - ox, ly = L.y - oy
    if (lx < -L.r || ly < -L.r || lx > aw + L.r || ly > ah + L.r) continue
    let I = L.i
    if (L.kind === 'fire') I *= 0.82 + 0.12 * Math.sin(t * 0.021 + L.x) + 0.08 * Math.sin(t * 0.057 + L.y)
    else if (L.kind === 'neon') I *= hash2((t / 90) | 0, L.x | 0, 5) > 0.04 ? 1 : 0.2
    else if (L.kind === 'beacon') I *= ((t / 600) | 0) % 2 ? 1 : 0.15
    else if (L.kind === 'rad') I *= 0.8 + 0.2 * Math.sin(t * 0.004 + L.x * 0.1)
    const r2 = L.r * L.r
    const y0 = Math.max(0, (ly - L.r) | 0), y1 = Math.min(ah - 1, (ly + L.r) | 0)
    const x0 = Math.max(0, (lx - L.r) | 0), x1 = Math.min(aw - 1, (lx + L.r) | 0)
    for (let y = y0; y <= y1; y++) {
      const dy = (y - ly) * 1.6, row = y * aw
      for (let x = x0; x <= x1; x++) {
        const dx = x - lx, d2 = dx * dx + dy * dy
        if (d2 >= r2) continue
        const i = row + x
        const f = 1 - d2 / r2
        const base = lum[i]!
        const add = I * f * f * (emp[i] ? 0.22 : 0.3 + base / 150)
        if (add > base * 0.85 && add > 14) hue[i] = L.hue
        const v = base + add
        lum[i] = v > 255 ? 255 : v
      }
    }
  }
  for (const L of st.lights) if (L.kind === 'fire') {
    const lx = L.x - ox, ly = L.y - oy
    if (lx < -20 || ly < -60 || lx > aw + 20 || ly > ah + 20) continue
    for (let k = 0; k < 22; k++) {
      const life = ((t * 0.0011 + hash2(k, L.x | 0, 3)) % 1)
      const fxp = lx + (hash2(k, 7, L.y | 0) - 0.5) * 9 * (1 - life) + Math.sin(t * 0.01 + k) * 1.5
      const fyp = ly + 2 - life * 16
      const l = 255 * (1 - life)
      setPx(lum, hue, aw, ah, fxp, fyp, l, life < 0.35 ? HUE_AMBER : HUE_RUST)
      setPx(lum, hue, aw, ah, fxp, fyp - 1, l * 0.8, life < 0.35 ? HUE_AMBER : HUE_RUST)
    }
    for (let k = 0; k < 6; k++) {
      const life = ((t * 0.00035 + hash2(k, L.x | 0, 11)) % 1)
      setPx(lum, hue, aw, ah, lx + Math.sin(life * 9 + k) * 6, ly - 14 - life * 70, 230 * (1 - life), HUE_RUST)
    }
  }
  for (let k = 0; k < 150; k++) {
    const sp = 0.5 + hash2(k, 2, 4)
    const ax = ((hash2(k, 1, 4) * aw * 3 + t * 0.006 * sp - ox * 0.2) % aw + aw) % aw
    const ay = ((hash2(k, 3, 4) * ah * 3 + t * 0.011 * sp - oy * 0.2) % ah + ah) % ah
    const l = 50 + hash2(k, 5, 4) * 90
    const i = (ay | 0) * aw + (ax | 0)
    if (lum[i]! < l) { lum[i] = l; hue[i] = HUE_BONE }
  }

  // 4. hover label
  if (view.hover && !inCombat) {
    const [hx, hy] = view.hover
    const a = liveActors(s).find((q) => q.x === hx && q.y === hy)
    const npc = s.npcs.find((q) => !q.removed && q.x === hx && q.y === hy)
    const c = s.containers.find((q) => q.x === hx && q.y === hy)
    const label = a ? (a.hostile ? `ATTACK  ${a.name}  ${a.hp}/${a.maxHp}` : a.name) : npc ? `TALK  ${NPCS[npc.id]!.name}` : c ? (c.opened && !c.items.length && !c.caps ? `${c.name}  (EMPTY)` : `LOOT  ${c.name}`) : null
    if (label) {
      const [cx, cy] = tc(hx, hy)
      const w = textWidth(label)
      const lx = Math.max(6, Math.min(aw - w - 6, cx - w / 2 - ox)), ly = Math.max(6, cy - 52 - oy)
      box2d(lum, hue, aw, ah, lx - 3, ly, w + 6, 11, a?.hostile ? HUE_RED : HUE_GREEN)
      drawText(lum, hue, aw, ah, label, lx, ly + 2, 240, a?.hostile ? HUE_RED : HUE_GREEN)
    }
  }
  // 4b. objective waypoint
  if (view.objective && view.objective[0] >= 0 && !inCombat) {
    const [gx, gy] = tc(...(pos('obj', view.objective[0], view.objective[1]).slice(0, 2) as [number, number]))
    const sx = gx - ox, sy = gy - oy
    const bob = Math.sin(t * 0.006) * 3
    if (sx > 8 && sy > 30 && sx < aw - 8 && sy < ah - 4) {
      const top = sy - 62 + bob
      for (let r = 0; r < 6; r++) for (let k = -r; k <= r; k++) setPx(lum, hue, aw, ah, sx + k, top + 6 - r, r === 5 || Math.abs(k) === r ? 255 : 170, HUE_AMBER)
      const pr = 14 + ((t * 0.02) % 10)
      for (let k = 0; k < 40; k++) { const ang = (k / 40) * Math.PI * 2; setPx(lum, hue, aw, ah, sx + Math.cos(ang) * pr, sy + Math.sin(ang) * pr * 0.5, 230 * (1 - (pr - 14) / 10), HUE_AMBER) }
    } else {
      const cx = aw / 2, cy = ah / 2
      const dx = sx - cx, dy = sy - 20 - cy
      const k = Math.min((aw / 2 - 16) / Math.max(1, Math.abs(dx)), (ah / 2 - 16) / Math.max(1, Math.abs(dy)))
      const ex = cx + dx * k, ey = cy + dy * k
      const ang = Math.atan2(dy, dx)
      for (let i = 0; i < 9; i++) for (let w = -i * 0.6; w <= i * 0.6; w++) {
        setPx(lum, hue, aw, ah, ex + Math.cos(ang) * (i - 9) - Math.sin(ang) * w + Math.cos(ang) * bob, ey + Math.sin(ang) * (i - 9) + Math.cos(ang) * w + Math.sin(ang) * bob, 255, HUE_AMBER)
      }
    }
  }
  // 5. targeting
  if (s.mode === 'target' && s.target) {
    for (let i = 0; i < n; i++) lum[i] = (lum[i]! * 0.62) | 0
    const a = liveActors(s).find((q) => q.id === s.target!.actor)
    if (a) {
      const [ax, ay] = tc(...(pos(a.id, a.x, a.y).slice(0, 2) as [number, number]))
      const [px, py] = tc(...(pos('player', s.player.x, s.player.y).slice(0, 2) as [number, number]))
      const steps = Math.max(1, Math.hypot(ax - px, ay - py) | 0)
      for (let i = 0; i < steps; i++) if (((i + (t / 40) | 0) % 6) < 3) put(px + ((ax - px) * i) / steps, py - 12 + ((ay - py) * i) / steps, 200, HUE_GREEN)
      const sz = a.type === 'rat' ? 10 : 18, blink = 180 + Math.sin(t * 0.012) * 70
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) for (let k = 0; k < 6; k++) {
        put(ax + sx * (sz - k), ay - sz + sy * sz, blink, HUE_RED); put(ax + sx * sz, ay - sz + sy * (sz - k), blink, HUE_RED)
      }
      const label = `${hitChance(s, a, s.target.part)}%`
      drawText(lum, hue, aw, ah, label, ax + sz + 4 - ox, ay - sz - 4 - oy, 255, HUE_RED, 2)
    }
  }
  // 6. shots: tracer, flash, floaters
  for (const sa of view.shots) {
    const p = (t - sa.start) / sa.dur
    if (p < 0 || p > 1.8) continue
    const fx = sa.fx
    const [x0, y0] = tc(fx.fromX, fx.fromY), [x1, y1] = tc(fx.toX, fx.toY)
    const hy0 = y0 - 14, hy1 = y1 - (fx.byPlayer ? 12 : 14)
    const hu = fx.byPlayer ? HUE_GREEN : HUE_RED
    if (p < 0.12) for (let r = 0; r < 5; r++) for (let k = 0; k < 8; k++) put(x0 + Math.cos(k) * r, hy0 + Math.sin(k) * r, 255, HUE_AMBER)
    if (!fx.melee && p <= 1) {
      const tip = Math.min(1, p * 1.05), tail = Math.max(0, tip - 0.25)
      const L = Math.hypot(x1 - x0, hy1 - hy0) | 0
      for (let i = (tail * L) | 0; i < tip * L; i++) put(x0 + ((x1 - x0) * i) / L, hy0 + ((hy1 - hy0) * i) / L, 255, hu)
    }
    if (p > 1 && p < 1.3 && fx.hit) for (let k = 0; k < 14; k++) { const ang = k * 0.45 + p * 3, r = (p - 1) * 40; put(x1 + Math.cos(ang) * r, hy1 + Math.sin(ang) * r * 0.6, 255, HUE_AMBER) }
    if (p > 0.9) {
      const txt = fx.hit ? `${fx.crit ? 'CRIT ' : ''}-${fx.dmg}` : 'MISS'
      const sc = fx.crit ? 2 : 1
      drawText(lum, hue, aw, ah, txt, x1 - textWidth(txt, sc) / 2 - ox, hy1 - 22 - (p - 0.9) * 26 - oy, 255, fx.hit ? HUE_AMBER : HUE_GREEN, sc)
    }
  }
  // 7. mast beacon
  { const [bx, by] = tc(38, 14); if (((t / 600) | 0) % 2) for (let k = -1; k <= 1; k++) { put(bx + k, by - 132, 255, HUE_RED); put(bx, by - 132 + k, 255, HUE_RED) } }

  // 8. CRT output
  const out = fb.out32, idx = e.idx, shade = e.shade
  const band = ((t * 0.12) % (H * 1.6)) - H * 0.3
  const bars = Math.round((view.cine ?? 0) * H * 0.085)
  const flick = view.flicker === false ? 256 : 250 + ((hash2((t / 50) | 0, 0, 3) * 8) | 0)
  for (let y = 0; y < H; y++) {
    const bd = Math.abs(y - band)
    const rowBoost = bd < 40 ? 1 + (1 - bd / 40) * 0.08 : 1
    const rowMul = (flick * rowBoost) | 0
    const row = y * W
    if (bars > 0 && (y < bars || y >= H - bars)) { out.fill(LUT[0]!, row, row + W); continue }
    for (let x = 0; x < W; x++) {
      const i = row + x, ai = idx[i]!
      if (ai < 0) { out[i] = LUT[0]!; continue }
      let l = (lum[ai]! * shade[i]! * rowMul) >> 16
      if (l > 255) l = 255
      out[i] = LUT[(hue[ai]! << 8) | l]!
    }
  }
}

function box2d(lum: Uint8Array, hue: Uint8Array, w: number, h: number, x0: number, y0: number, bw: number, bh: number, hu: number) {
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const px = (x0 + x) | 0, py = (y0 + y) | 0
    if (px < 0 || py < 0 || px >= w || py >= h) continue
    const edge = y === 0 || y === bh - 1 || x === 0 || x === bw - 1
    lum[py * w + px] = edge ? 120 : 10; hue[py * w + px] = hu
  }
}

type PutFn = (x: number, y: number, l: number, h: number, d?: number) => void
function bar(put: PutFn, cx: number, y: number, f: number, hu: number) {
  for (let x = -8; x <= 8; x++) { put(cx + x, y, x <= -8 + 16 * f ? 230 : 40, hu); put(cx + x, y + 1, x <= -8 + 16 * f ? 160 : 30, hu) }
}

function crate(put: PutFn, [cx, cy]: [number, number], d: number, empty: boolean, body: boolean) {
  if (body) { for (let x = -6; x <= 6; x++) for (let y = -2; y <= 1; y++) put(cx + x, cy + y, empty ? 50 : 110, HUE_GREEN, d); return }
  const l = empty ? 0.45 : 1
  for (let x = -7; x <= 7; x++) {
    const sp = 3.5 - Math.abs(x) / 2
    for (let y = -sp; y <= sp; y++) put(cx + x, cy - 8 + y, 170 * l, HUE_AMBER, d)
    const yb = cy - Math.abs(x) / 2 + 3.5
    for (let y = yb - 7; y < yb; y++) put(cx + x, y, (x < 0 ? 130 : 90) * l * ((y | 0) % 3 === 0 ? 0.7 : 1), HUE_AMBER, d)
  }
  if (!empty) put(cx, cy - 4, 255, HUE_AMBER, d)
}

/** Procedural humanoid (feet at cx,cy). */
function human(put: PutFn, cx: number, cy: number, d: number, t: number, moving: number, hu: number, L: number, hair: string, face: number, gun: boolean, scale = 1, dead = false) {
  const pts: [number, number, number][] = []
  const px = (x: number, y: number, l: number) => pts.push([x, y, l])
  const rect = (x0: number, y0: number, w: number, h: number, l: number) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x0 + x, y0 + y, l) }
  const ph = moving ? Math.sin(t * 0.02) : 0
  const bob = moving ? Math.abs(ph) : Math.sin(t * 0.003) * 0.4
  const H = Math.round(22 * scale)
  const leg = Math.round(7 * scale), torso = Math.round(8 * scale), head = Math.round(5 * scale)
  // legs
  rect(-3, -leg, 2, leg - (ph > 0.3 ? 1 : 0), L * 0.62)
  rect(1, -leg, 2, leg - (ph < -0.3 ? 1 : 0), L * 0.55)
  const ty = -leg - torso - Math.round(bob)
  rect(-3, ty, 6, torso, L * 0.8)
  px(-1, ty + 2, L); px(0, ty + 3, L) // strap / detail
  // arms
  rect(-4, ty + 1, 1, torso - 2 + (ph > 0 ? 1 : 0), L * 0.7)
  rect(3, ty + 1, 1, torso - 2 + (ph < 0 ? 1 : 0), L * 0.7)
  // head
  const hy = ty - head - 1
  rect(-2, hy, 5, head, L * 0.95)
  px(face > 0 ? 1 : -1, hy + 2, L * 0.3)
  // hair styles
  if (hair === 'player') rect(-2, hy - 1, 5, 2, L * 0.6)
  else if (hair === 'bun') { rect(-2, hy - 1, 5, 1, L * 0.5); rect(-1, hy - 3, 3, 2, L * 0.5) }
  else if (hair === 'long') { rect(-3, hy - 1, 7, 2, L * 0.5); rect(-3, hy + 1, 1, 5, L * 0.5); rect(3, hy + 1, 1, 5, L * 0.5) }
  else if (hair === 'mohawk') rect(0, hy - 3, 1, 3, L)
  else if (hair === 'afro') rect(-3, hy - 3, 7, 4, L * 0.5)
  else if (hair === 'veil' || hair === 'hood') { rect(-3, hy - 1, 7, 2, L * 0.45); rect(-3, hy, 1, head + 3, L * 0.45); rect(3, hy, 1, head + 3, L * 0.45) }
  else if (hair === 'messy') { rect(-2, hy - 1, 5, 1, L * 0.6); px(-2, hy - 2, L * 0.6); px(2, hy - 2, L * 0.6) }
  else if (hair !== 'bald') rect(-2, hy - 1, 5, 1, L * 0.5)
  // wrist-link glow on player
  if (hair === 'player') px(face > 0 ? 3 : -4, ty + torso - 2, 255)
  if (gun) { const gx = face > 0 ? 4 : -9; rect(gx, ty + 3, 6, 1, L); px(face > 0 ? 4 : 1, ty + 4, L) }
  void H
  blit(put, pts, cx, cy, d, hu, dead)
}

function creature(put: PutFn, kind: string, cx: number, cy: number, d: number, t: number, moving: number, dead: boolean, hu: number, L: number, face: number, id: string) {
  if (kind === 'human' || kind === 'boss') {
    human(put, cx, cy, d, t, moving, hu, L, kind === 'boss' ? 'mohawk' : (hash2(id.length, id.charCodeAt(id.length - 1), 1) > 0.5 ? 'mohawk' : 'buzz'), face, true, kind === 'boss' ? 1.15 : 1, dead)
    return
  }
  const pts: [number, number, number][] = []
  const px = (x: number, y: number, l: number) => pts.push([face < 0 ? -x : x, y, l])
  const rect = (x0: number, y0: number, w: number, h: number, l: number) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x0 + x, y0 + y, l) }
  const ph = moving ? Math.sin(t * 0.03) : Math.sin(t * 0.004) * 0.3
  if (kind === 'rat') {
    rect(-5, -5, 9, 4, L * 0.8); rect(3, -6, 3, 3, L * 0.9); px(6, -5, L)
    px(5, -6, 255)
    for (let i = 0; i < 6; i++) px(-6 - i, -3 + Math.round(Math.sin(i * 0.9 + t * 0.01)), L * 0.6)
    rect(-4, -1, 1, 1, L * 0.6); rect(2, -1, 1, 1, L * 0.6)
  } else {
    const big = kind === 'hound' ? 1 : 0.8
    const bw = Math.round(11 * big), lh = Math.round(5 * big)
    rect(-6, -lh - 5, bw, 5, L * 0.78)
    for (const [lx, o] of [[-5, ph], [-3, -ph], [bw - 8, -ph], [bw - 7, ph]] as const) rect(lx, -lh, 1, lh - (o > 0.3 ? 1 : 0), L * 0.6)
    const hx = bw - 6
    rect(hx, -lh - 8, 4, 4, L * 0.9); rect(hx + 3, -lh - 6, 2, 2, L * 0.85)
    px(hx + 2, -lh - 7, kind === 'hound' ? 255 : L * 0.3)
    px(hx, -lh - 9, L); if (kind !== 'dog') px(hx + 2, -lh - 9, L)
    for (let i = 0; i < 4; i++) px(-7 - i, -lh - 5 - i + (kind === 'dog' ? Math.round(Math.sin(t * 0.03 + i)) : 0), L * 0.65)
  }
  blit(put, pts, cx, cy, d, hu, dead)
}

/** Draw point list with a 1px dark outline; dead = rotated flat and dim. */
function blit(put: PutFn, pts: [number, number, number][], cx: number, cy: number, d: number, hu: number, dead: boolean) {
  const P = dead ? pts.map(([x, y, l]) => [-y - 8, Math.round(x / 2) - 1, l * 0.45] as [number, number, number]) : pts
  const set = new Set(P.map(([x, y]) => `${x},${y}`))
  for (const [x, y] of P) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (!set.has(`${x + dx},${y + dy}`)) put(cx + x + dx, cy + y + dy, 4, hu, d)
  }
  for (const [x, y, l] of P) put(cx + x, cy + y, Math.min(255, l), hu, d)
}

function setPx(lum: Uint8Array, hue: Uint8Array, w: number, h: number, x: number, y: number, l: number, hu: number) {
  x |= 0; y |= 0
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const i = y * w + x
  if (lum[i]! < l) { lum[i] = l > 255 ? 255 : l; hue[i] = hu }
}

function splat(put: PutFn, [cx, cy]: [number, number], hu: number, id: string) {
  const sd = id.length * 7 + id.charCodeAt(id.length - 1)
  for (let y = -5; y <= 5; y++) for (let x = -12; x <= 12; x++) {
    const r = (x * x) / 144 + (y * y) / 25 + (hash2(x, y, sd) - 0.5) * 0.5
    if (r < 1) put(cx + x, cy + y, 60 + (r < 0.3 ? 30 : 0), hu, -1)
  }
}

/** Night sky, skyline silhouette, moon and Hudson water behind the district (only where the map left pixels empty). */
function backdrop(lum: Uint8Array, hue: Uint8Array, emp: Uint8Array, aw: number, ah: number, ox: number, oy: number, t: number) {
  const base = 300 - oy
  const mx = aw * 0.8, my = Math.max(18, base - 190 + ah * 0.05)
  for (let y = 0; y < ah; y++) {
    const row = y * aw
    const sky = y < base
    const hz = sky ? Math.max(0, 1 - (base - y) / 160) : 0
    for (let x = 0; x < aw; x++) {
      const i = row + x
      if (!emp[i]) { lum[i] = (lum[i]! * 0.84) | 0; continue }
      if (sky) {
        const px = x + ox * 0.55
        const seg = Math.floor(px / 13)
        const hr = hash2(seg, 0, 21)
        const bh = 18 + hr * 64 + (hr > 0.93 ? 70 : 0)
        const inB = base - y < bh
        const spire = hr > 0.93 && Math.abs((px % 13) - 6.5) < 0.8 && base - y < bh + 22
        if (inB || spire) {
          const lx = Math.floor(px) % 13, ly = Math.floor(base - y)
          const win = !spire && lx % 3 === 1 && ly % 5 === 2 && lx > 0 && lx < 12 && hash2(seg * 31 + lx, ly, 22) > 0.8
          lum[i] = win ? 110 + hash2(seg, ly, 3) * 60 : 12 + hz * 6; hue[i] = win ? HUE_AMBER : HUE_SKY
          continue
        }
        const md = Math.hypot(x - mx, (y - my) * 1.1)
        if (md < 9) { lum[i] = 210 - (hash2(x, y, 4) > 0.8 ? 40 : 0); hue[i] = HUE_BONE; continue }
        const star = hash2(x + ox, y, 31) > 0.997 && hz < 0.6
        const glow = md < 46 ? (46 - md) * (46 - md) * 0.035 : 0
        lum[i] = star ? 120 : 8 + hz * 30 + glow
        hue[i] = star || md < 22 ? HUE_BONE : hz > 0.42 + (hash2(x, y, 6) - 0.5) * 0.3 ? HUE_RUST : HUE_SKY
      } else {
        const d = y - base
        const ripple = Math.sin(x * 0.21 + t * 0.0021 + d * 0.9) + Math.sin(x * 0.05 - t * 0.0013 + d * 0.4)
        const refl = Math.abs(x - mx) < 8 - Math.min(6, d * 0.05) && ripple > 0.9
        lum[i] = refl ? 70 : ripple > 1.6 ? 34 : 8 + Math.max(0, 14 - d * 0.2)
        hue[i] = refl ? HUE_BONE : HUE_SKY
      }
    }
  }
}
