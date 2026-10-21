import type { Look } from '../engine/content'
import { ITEMS } from '../engine/content'
import { hash2 } from '../engine/rng'
import { MAP_H, MAP_W, REGIONS, tileAt } from '../engine/world'
import { drawText, textWidth } from './font'
import { HUE_AMBER, HUE_CYAN, HUE_GREEN, HUE_RED, LUT } from './palette'

export interface Art { w: number; h: number; lum: Uint8Array; hue: Uint8Array }
export const mkArt = (w: number, h: number): Art => ({ w, h, lum: new Uint8Array(w * h), hue: new Uint8Array(w * h) })
const set = (a: Art, x: number, y: number, l: number, h = HUE_GREEN) => {
  x |= 0; y |= 0
  if (x < 0 || y < 0 || x >= a.w || y >= a.h) return
  a.lum[y * a.w + x] = Math.max(0, Math.min(255, l)); a.hue[y * a.w + x] = h
}
const rect = (a: Art, x: number, y: number, w: number, h: number, l: number, hu = HUE_GREEN) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(a, x + i, y + j, l, hu) }

/** Integer upscale to RGBA with scanlines (CRT look). */
export function toRgba(a: Art, scale: number, dim = 1): { w: number; h: number; data: Uint8Array } {
  const W = a.w * scale, H = a.h * scale
  const data = new Uint8Array(W * H * 4), o32 = new Uint32Array(data.buffer)
  for (let y = 0; y < H; y++) {
    const scan = scale > 1 && y % scale === scale - 1 ? 0.7 : 1
    for (let x = 0; x < W; x++) {
      const si = ((y / scale) | 0) * a.w + ((x / scale) | 0)
      o32[y * W + x] = LUT[(a.hue[si]! << 8) | ((a.lum[si]! * scan * dim) | 0)]!
    }
  }
  return { w: W, h: H, data }
}

/** Procedural portrait from look parameters: 48x48 art. */
export function portrait(look: Look, seed: string, hu = HUE_GREEN): Art {
  const a = mkArt(48, 48)
  const sd = [...seed].reduce((s, c) => s * 31 + c.charCodeAt(0), 7)
  const r = (k: number) => hash2(sd, k, 13)
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) set(a, x, y, (x + y) % 4 === 0 ? 22 : 12, hu)
  const kid = look.kid ? 0.85 : 1
  const cx = 24, cy = 22 + (look.kid ? 3 : 0), rx = (9 + r(1) * 2) * kid, ry = 12 * kid
  const skin = 120 + (look.skin ?? 0.5) * 90
  // shoulders
  for (let y = 36; y < 48; y++) for (let x = 0; x < 48; x++) { const w = 12 + (y - 36) * 1.4; if (Math.abs(x - cx) < w) set(a, x, y, (Math.abs(x - cx) < 3 && y < 42 ? skin * 0.8 : 80 + (x % 5 === 0 ? 15 : 0)), hu) }
  for (let y = 31; y < 38; y++) for (let x = cx - 4; x <= cx + 4; x++) set(a, x, y, skin * 0.8, hu)
  // head with jaw shading
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const jaw = y > 2 ? 1 - (y - 2) / (ry * 2.2) : 1
    if ((x * x) / (rx * rx * jaw * jaw) + (y * y) / (ry * ry) > 1) continue
    set(a, cx + x, cy + y, skin - (x > rx * 0.4 ? 30 : 0) - (y > ry * 0.6 ? 20 : 0), hu)
  }
  const age = look.age ?? 0.4
  if (age > 0.6) for (let i = 0; i < 3; i++) for (let x = -5; x <= 5; x++) set(a, cx + x, cy - 7 + i * 2, skin - 26, hu)
  // eyes
  const ey = cy - 2, es = 4 + Math.round(r(2))
  for (const s of [-1, 1]) {
    rect(a, cx + s * es - 2, ey, 4, 2, 245, hu); set(a, cx + s * es - (s < 0 ? 0 : 1), ey, 10, hu); set(a, cx + s * es - (s < 0 ? 0 : 1), ey + 1, 10, hu)
    for (let x = -2; x < 2; x++) set(a, cx + s * es + x, ey - 2 - (r(3) > 0.5 && x === 0 ? 1 : 0), 40, hu)
  }
  if (look.glasses) for (const s of [-1, 1]) for (let t = 0; t < 20; t++) { const ang = (t / 20) * Math.PI * 2; set(a, cx + s * es - 0.5 + Math.cos(ang) * 3.5, ey + 1 + Math.sin(ang) * 2.8, 230, hu) }
  if (look.goggles) { rect(a, cx - rx, ey - 6, rx * 2 + 1, 2, 60, hu); for (const s of [-1, 1]) rect(a, cx + s * es - 3, ey - 8, 6, 4, 200, HUE_AMBER) }
  // nose & mouth
  const nl = 4 + Math.round(r(4) * 3)
  for (let y = 0; y < nl; y++) set(a, cx + (y === nl - 1 ? 1 : 0), ey + 3 + y, skin - 40, hu)
  set(a, cx - 1, ey + 3 + nl, skin - 45, hu); set(a, cx + 2, ey + 3 + nl, skin - 45, hu)
  const mw = 3 + Math.round(r(5) * 2), my = cy + 7, smile = r(6) > 0.5 ? 1 : 0
  for (let x = -mw; x <= mw; x++) set(a, cx + x, my + (Math.abs(x) === mw ? -smile : 0), 40, hu)
  if (look.mask) { rect(a, cx - rx + 1, my - 3, rx * 2 - 1, 7, 70, hu); for (let x = -rx + 2; x < rx; x += 3) rect(a, cx + x, my - 1, 1, 3, 30, hu) }
  if (look.beard) for (let y = my - 2; y < cy + ry + 2; y++) for (let x = -rx + 1; x < rx; x++) { if (y > my - 1 && Math.abs(x) < 2.5 && y < my + 1) continue; if (hash2(x, y, sd) > 0.35 && (x * x) / (rx * rx) + ((y - cy) ** 2) / ((ry + 2) ** 2) < 1) set(a, cx + x, y, 60 + hash2(x, y, 3) * 30, hu) }
  if (look.scar) for (let i = 0; i < 9; i++) set(a, cx + es - 3 + i * 0.6, ey - 5 + i, 255, HUE_RED)
  if (look.earring) set(a, cx + rx, cy + 3, 255, HUE_AMBER)
  // hair
  const hl = 55 + r(7) * 40
  const hair = look.hair ?? 'buzz'
  const cap = (thick: number) => { for (let y = -ry - 2; y < -ry + thick; y++) for (let x = -rx - 1; x <= rx + 1; x++) if ((x * x) / ((rx + 1.5) ** 2) + (y * y) / ((ry + 2) ** 2) <= 1) set(a, cx + x, cy + y, hl + hash2(x, y, sd) * 20, hu) }
  if (hair === 'buzz') cap(5)
  else if (hair === 'messy') { cap(7); for (let i = 0; i < 8; i++) set(a, cx - rx + i * 2.5, cy - ry - 2 - (i % 2) * 2, hl, hu) }
  else if (hair === 'long') { cap(8); rect(a, cx - rx - 2, cy - 6, 4, 22, hl, hu); rect(a, cx + rx - 1, cy - 6, 4, 22, hl, hu) }
  else if (hair === 'bun') { cap(6); for (let y = -4; y <= 4; y++) for (let x = -5; x <= 5; x++) if (x * x + y * y < 22) set(a, cx + x, cy - ry - 5 + y, hl, hu) }
  else if (hair === 'mohawk') rect(a, cx - 2, cy - ry - 7, 5, 12, hl + 30, hu)
  else if (hair === 'afro') for (let y = -18; y < 2; y++) for (let x = -16; x <= 16; x++) { if ((x * x) / 256 + ((y + 6) ** 2) / 144 < 1 && !((x * x) / (rx * rx) + ((y + 2) ** 2) / (ry * ry) < 0.75 && y > -8)) set(a, cx + x, cy + y - 6, hl + hash2(x, y, 9) * 25, hu) }
  else if (hair === 'veil' || hair === 'hood') { for (let y = -ry - 4; y < 26; y++) for (let x = -rx - 5; x <= rx + 5; x++) { const inner = (x * x) / (rx * rx) + (y * y) / (ry * ry) < 1 && y > -ry + 3; if (!inner && (x * x) / ((rx + 5) ** 2) + (y * y) / ((ry + 5) ** 2) < 1.25) set(a, cx + x, cy + y, hair === 'veil' ? 210 : 70, hu) } }
  if (look.hat) { rect(a, cx - rx - 5, cy - ry + 1, rx * 2 + 11, 2, 90, hu); rect(a, cx - rx + 1, cy - ry - 6, rx * 2 - 1, 7, 80, hu) }
  if (look.headset) { for (let t = 0; t < 30; t++) { const ang = Math.PI + (t / 30) * Math.PI; set(a, cx + Math.cos(ang) * (rx + 2), cy - 2 + Math.sin(ang) * (ry + 1), 220, hu) }; rect(a, cx - rx - 3, cy - 3, 3, 6, 200, hu); rect(a, cx + rx + 1, cy - 3, 3, 6, 200, hu) }
  return a
}

/** Dog portrait for Rusty. */
export function dogPortrait(): Art {
  const a = mkArt(48, 48)
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) set(a, x, y, (x + y) % 4 === 0 ? 22 : 12)
  for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) if (x * x / 144 + y * y / 144 < 1) set(a, 24 + x, 24 + y, 150 - (x > 4 ? 30 : 0), HUE_AMBER)
  for (let y = 0; y < 10; y++) for (let x = -6; x <= 6; x++) if (Math.abs(x) < 6 - y * 0.3) set(a, 24 + x, 30 + y, 170, HUE_AMBER)
  rect(a, 22, 31, 5, 3, 20); rect(a, 18, 20, 3, 3, 240); rect(a, 28, 20, 3, 3, 240); set(a, 19, 21, 10); set(a, 29, 21, 10)
  for (let y = 0; y < 12; y++) rect(a, 9 + y * 0.2, 6 + y, 5, 1, 120, HUE_AMBER)
  for (let y = 0; y < 8; y++) rect(a, 34 + y * 0.5, 14 + y, 6, 1, 120, HUE_AMBER)
  rect(a, 22, 42, 4, 3, 255, HUE_AMBER)
  return a
}

/** Side-view weapon assembled from its parts with procedural wear. */
export function weaponArt(id: string, cond: number): Art {
  const a = mkArt(96, 32)
  const d = ITEMS[id]!, p = d.parts ?? {}
  for (let y = 0; y < 32; y++) for (let x = 0; x < 96; x++) set(a, x, y, y % 4 === 0 ? 18 : 10)
  if (d.class === 'melee') {
    if (p.blade) { rect(a, 20, 15, 22, 5, 110); for (let x = 0; x < 34; x++) rect(a, 42 + x, 15 + x * 0.06, 1, 4 - x * 0.1, 220 - x) }
    else { rect(a, 12, 15, 72, 4, 150); for (let x = 12; x < 84; x += 5) set(a, x, 14, 190); rect(a, 12, 13, 14, 8, 90); rect(a, 72, 11, 12, 12, 170) }
  } else {
    const bl = 18 + (p.barrel ?? 10) * 2.5
    const rx = 22, ry = 11
    rect(a, rx, ry, 26, 9, 140)
    rect(a, rx + 2, ry + 2, 20, 1, 200)
    rect(a, rx + 26, ry + 1, bl, 4, 175)
    if (p.double) rect(a, rx + 26, ry + 5, bl, 3, 150)
    if (p.coil) for (let x = 0; x < bl; x += 4) rect(a, rx + 26 + x, ry - 1, 2, 7, 230, HUE_CYAN)
    rect(a, rx + 6, ry + 9, 6, 9, 120); rect(a, rx + 14, ry + 9, 5, 4, 70)
    if (p.mag) rect(a, rx + 14, ry + 9, 5, 8 + p.mag * 2, 130)
    if (p.stock) for (let x = 0; x < 20; x++) rect(a, rx - x, ry + 2 + x * 0.2, 1, 7 + (p.stock > 1 ? 1 : 0), 110 + x)
    if (p.scope) { rect(a, rx + 6, ry - 5, 18, 4, 190); rect(a, rx + 4, ry - 6, 3, 6, 160); rect(a, rx + 23, ry - 6, 3, 6, 160) }
  }
  const wear = (100 - cond) / 100
  for (let y = 0; y < 32; y++) for (let x = 0; x < 96; x++) {
    const i = y * 96 + x
    if (a.lum[i]! > 60 && hash2(x, y, id.length) < wear * 0.45) a.lum[i] = a.lum[i]! * 0.4
  }
  return a
}

export interface MapMarker { x: number; y: number; kind: 'player' | 'npc' | 'quest' | 'enemy' | 'loot' }
/** Top-down CRT map of the district: 5px per tile. */
export function districtMap(markers: MapMarker[], t: number): Art {
  const S = 5
  const a = mkArt(MAP_W * S, MAP_H * S)
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const k = tileAt(tx, ty)!
    const solid = ['brownstone', 'bodega', 'church', 'steeple', 'shack', 'overpass', 'kiosk', 'hatch', 'mast'].includes(k)
    const road = k === 'asphalt' || k === 'lane' || k === 'crossing'
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let l = solid ? (x === 0 || y === 0 ? 150 : 90) : road ? 20 : k === 'radpool' ? 150 + Math.sin(t * 0.005 + tx) * 40 : k === 'rubble' ? ((x + y) % 3 ? 30 : 60) : k === 'grass' ? ((x * 7 + y * 3 + tx) % 5 ? 30 : 60) : 40
      if (k === 'lane' && x === 2 && y % 2 === 0) l = 120
      set(a, tx * S + x, ty * S + y, l, k === 'radpool' ? HUE_GREEN : HUE_GREEN)
    }
  }
  for (const r of REGIONS) {
    const name = r.name.toUpperCase()
    const cx = ((r.x0 + r.x1 + 1) / 2) * S, cy = ((r.y0 + r.y1 + 1) / 2) * S
    const w = textWidth(name)
    if (w < (r.x1 - r.x0 + 4) * S) {
      for (let y = -2; y < 9; y++) for (let x = -2; x < w + 2; x++) set(a, cx - w / 2 + x, cy - 3 + y, 8)
      drawText(a.lum, a.hue, a.w, a.h, name, cx - w / 2, cy - 2, 210, HUE_GREEN)
    }
  }
  const blink = Math.floor(t / 400) % 2 === 0
  for (const m of markers) {
    const px = m.x * S + 2, py = m.y * S + 2
    if (m.kind === 'player') { for (let i = -3; i <= 3; i++) { set(a, px + i, py, 255); set(a, px, py + i, 255) }; if (blink) for (let k = 0; k < 16; k++) set(a, px + Math.cos(k / 2.5) * 6, py + Math.sin(k / 2.5) * 6, 200) }
    else if (m.kind === 'quest') { for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (Math.abs(x) + Math.abs(y) <= 3) set(a, px + x, py + y, Math.abs(x) + Math.abs(y) === 3 ? 255 : blink ? 200 : 120, HUE_AMBER) }
    else rect(a, px - 1, py - 1, 3, 3, 230, m.kind === 'enemy' ? HUE_RED : m.kind === 'loot' ? HUE_AMBER : HUE_CYAN)
  }
  return a
}

/** Radio spectrum/wave display. */
export function radioArt(station: string, t: number, live: boolean): Art {
  const a = mkArt(160, 48)
  for (let y = 0; y < 48; y++) for (let x = 0; x < 160; x++) set(a, x, y, y % 8 === 0 || x % 16 === 0 ? 24 : 10)
  for (let x = 0; x < 160; x++) {
    let v: number
    if (!live) v = (hash2(x, (t / 60) | 0, 1) - 0.5) * 18
    else {
      const beat = Math.sin(t * 0.0105) > 0.6 ? 1 : 0.6
      v = (Math.sin(x * 0.18 + t * 0.012) * 8 + Math.sin(x * 0.07 - t * 0.005) * 6 + Math.sin(x * 0.41 + t * 0.03) * 3) * beat
      if (station === 'brass') v *= 1.3
    }
    const y0 = 24, y1 = 24 + v
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) set(a, x, y, 120)
    set(a, x, y1, 250)
  }
  return a
}
