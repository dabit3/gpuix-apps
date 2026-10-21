import type { GameState, ShotFx } from '../engine/game'
import { ENEMIES, NPCS } from '../engine/content'
import { liveActors, hitChance, weaponDef } from '../engine/game'
import { buildStatic, SH, SW, tileCenter } from './iso'
import { drawText, textWidth } from './font'
import { HUE_AMBER, HUE_CYAN, HUE_GREEN, HUE_RED, LUT } from './palette'
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
}
export interface FrameBuffers { art: { lum: Uint8Array; hue: Uint8Array; depth: Int16Array; w: number; h: number }; out: Uint8Array; out32: Uint32Array; w: number; h: number }

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
  return { art: { lum: new Uint8Array(0), hue: new Uint8Array(0), depth: new Int16Array(0), w: 0, h: 0 }, out, out32: new Uint32Array(out.buffer), w, h }
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
  if (art.w !== aw || art.h !== ah) { art.lum = new Uint8Array(n); art.hue = new Uint8Array(n); art.depth = new Int16Array(n); art.w = aw; art.h = ah }
  const { lum, hue, depth } = art
  const ox = Math.round(view.cam[0] - aw / 2), oy = Math.round(view.cam[1] - ah / 2)
  const t = view.time
  // 1. blit static layer
  for (let y = 0; y < ah; y++) {
    const sy = y + oy, row = y * aw
    if (sy < 0 || sy >= SH) { lum.fill(0, row, row + aw); depth.fill(-1, row, row + aw); continue }
    const x0 = Math.max(0, -ox), x1 = Math.min(aw, SW - ox)
    if (x0 > 0) { lum.fill(0, row, row + x0); depth.fill(-1, row, row + x0) }
    if (x1 < aw) { lum.fill(0, row + Math.max(0, x1), row + aw); depth.fill(-1, row + Math.max(0, x1), row + aw) }
    if (x1 <= x0) continue
    const si = sy * SW + ox
    lum.set(st.lum.subarray(si + x0, si + x1), row + x0)
    hue.set(st.hue.subarray(si + x0, si + x1), row + x0)
    depth.set(st.depth.subarray(si + x0, si + x1), row + x0)
    // animated radiation pools
    for (let x = x0; x < x1; x++) if (st.rad[si + x]) {
      const wv = Math.sin(t * 0.004 + (x + ox) * 0.21 + Math.sin((sy + t * 0.01) * 0.17) * 2)
      lum[row + x] = Math.min(255, st.lum[si + x]! + 60 + wv * 50) | 0
    }
  }
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
    sprites.push({ d: Math.floor(x + y + 0.01), draw: () => {
      const [cx, cy] = tc(x, y)
      creature(put, a.type === 'dutch' ? 'boss' : ENEMIES[a.type]!.sprite, cx, cy, Math.round(x + y), t, mv, a.dead, hu, isTarget ? 255 : 190, a.x < s.player.x ? 1 : -1, a.id)
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

  // 4. hover label
  if (view.hover && !inCombat) {
    const [hx, hy] = view.hover
    const a = liveActors(s).find((q) => q.x === hx && q.y === hy)
    const npc = s.npcs.find((q) => !q.removed && q.x === hx && q.y === hy)
    const c = s.containers.find((q) => q.x === hx && q.y === hy)
    const label = a ? a.name : npc ? NPCS[npc.id]!.name : c ? c.name + (c.opened && !c.items.length && !c.caps ? ' (EMPTY)' : '') : null
    if (label) {
      const [cx, cy] = tc(hx, hy)
      const w = textWidth(label)
      box2d(lum, hue, aw, ah, cx - w / 2 - 3 - ox, cy - 52 - oy, w + 6, 11, a?.hostile ? HUE_RED : HUE_GREEN)
      drawText(lum, hue, aw, ah, label, cx - w / 2 - ox, cy - 50 - oy, 240, a?.hostile ? HUE_RED : HUE_GREEN)
    }
  }
  // 5. targeting
  if (s.mode === 'target' && s.target) {
    for (let i = 0; i < n; i++) lum[i] = (lum[i]! * 0.42) | 0
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
  const flick = view.flicker === false ? 256 : 250 + ((hash2((t / 50) | 0, 0, 3) * 8) | 0)
  for (let y = 0; y < H; y++) {
    const bd = Math.abs(y - band)
    const rowBoost = bd < 40 ? 1 + (1 - bd / 40) * 0.08 : 1
    const rowMul = (flick * rowBoost) | 0
    const row = y * W
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
