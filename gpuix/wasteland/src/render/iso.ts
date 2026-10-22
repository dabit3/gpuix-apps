import { MAP_H, MAP_W, tileAt, type TileKind } from '../engine/world'
import { hash2, valueNoise } from '../engine/rng'
import { drawText, textWidth } from './font'
import { HUE_AMBER, HUE_CYAN, HUE_GREEN, HUE_RED, HUE_RUST, HUE_TOXIC } from './palette'

export const TW = 32, TH = 16
const TOP = 130
export const SW = (MAP_W + MAP_H) * 16 + 32
export const SH = (MAP_W + MAP_H) * 8 + 16 + TOP
const OX = MAP_H * 16 + 16

/** Top vertex of a tile's ground diamond, in static-art pixels. */
export function tileTop(tx: number, ty: number): [number, number] { return [(tx - ty) * 16 + OX, (tx + ty) * 8 + TOP] }
/** Center of a tile (where sprite feet go). Accepts fractional coords for smooth motion. */
export function tileCenter(tx: number, ty: number): [number, number] { return [(tx - ty) * 16 + OX, (tx + ty) * 8 + TOP + 8] }
export function artToTile(ax: number, ay: number): [number, number] {
  const X = ax - OX, Y = ay - TOP
  return [Math.floor((X / 16 + Y / 8) / 2), Math.floor((Y / 8 - X / 16) / 2)]
}

export interface Light { x: number; y: number; r: number; i: number; hue: number; kind: 'fire' | 'rad' | 'neon' | 'lamp' | 'beacon' }
export interface StaticLayer { lum: Uint8Array; hue: Uint8Array; depth: Int16Array; rad: Uint8Array; empty: Uint8Array; lights: Light[] }
let cached: StaticLayer | null = null

export function buildStatic(): StaticLayer {
  if (cached) return cached
  const n = SW * SH
  const L: StaticLayer = { lum: new Uint8Array(n), hue: new Uint8Array(n), depth: new Int16Array(n).fill(-1), rad: new Uint8Array(n), empty: new Uint8Array(n).fill(1), lights: [] }
  const put = (x: number, y: number, l: number, h: number, d: number) => {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= SW || y >= SH) return
    const i = y * SW + x
    L.lum[i] = l < 0 ? 0 : l > 255 ? 255 : l; L.hue[i] = h; L.depth[i] = d; L.rad[i] = 0; L.empty[i] = 0
  }
  // ground pass
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const kind = tileAt(tx, ty)!
    const [sx, sy] = tileTop(tx, ty)
    const vert = tileAt(tx, ty - 1) === kind || tileAt(tx, ty + 1) === kind
    for (let y = 0; y < 16; y++) for (let x = -16; x < 16; x++) {
      const a = (x + 0.5) / 16, b = (y + 0.5) / 8
      const u = (b + a) / 2, v = (b - a) / 2
      if (u < 0 || v < 0 || u > 1 || v > 1) continue
      const gx = tx + u, gy = ty + v
      const [l, h] = groundPixel(kind, gx, gy, u, v, vert, tx, ty)
      put(sx + x, sy + y, l, h, -1)
      if (kind === 'radpool') L.rad[((sy + y) | 0) * SW + ((sx + x) | 0)] = 1
    }
  }
  // object pass, painter's order
  for (let d = 0; d < MAP_W + MAP_H; d++) for (let tx = 0; tx < MAP_W; tx++) {
    const ty = d - tx
    if (ty < 0 || ty >= MAP_H) continue
    drawObject(L, put, tileAt(tx, ty)!, tx, ty, d)
  }
  // landmark signs (pixel font, drawn on top)
  const sign = (text: string, tx: number, ty: number, up: number, hue: number) => {
    const [cx, cy] = tileCenter(tx, ty)
    const w = textWidth(text)
    const x0 = cx - w / 2 - 3, y0 = cy - up - 5
    for (let y = -1; y < 10; y++) for (let x = -1; x < w + 7; x++) {
      const edge = y === -1 || y === 9 || x === -1 || x === w + 6
      put(x0 + x, y0 + y, edge ? 150 : 14, hue, 999)
    }
    drawText(L.lum, L.hue, SW, SH, text, x0 + 3, y0 + 1, 235, hue)
    for (let i = 0; i < 2; i++) for (let y = 10; y < 10 + up - 8; y++) put(cx - w / 2 + 2 + i * (w - 4), y0 + y, 60, hue, 999)
  }
  sign('BODEGA', 4, 15, 46, HUE_AMBER)
  sign('ST. BRIGID', 19, 3, 70, HUE_GREEN)
  sign('BLEECKER ST', 18, 14, 34, HUE_GREEN)
  sign('WKNY 88.1', 37, 15, 120, HUE_RED)
  sign('SHELTER 34', 5, 27, 22, HUE_CYAN)
  const signs: [number, number, number, number][] = [[4, 15, 46, HUE_AMBER], [19, 3, 70, HUE_GREEN], [18, 14, 34, HUE_GREEN], [37, 15, 120, HUE_RED], [5, 27, 22, HUE_CYAN]]
  for (const [tx, ty, up, hu] of signs) { const [cx, cy] = tileCenter(tx, ty); L.lights.push({ x: cx, y: cy - up, r: 46, i: 70, hue: hu, kind: 'neon' }) }
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const k = tileAt(tx, ty)
    const [cx, cy] = tileCenter(tx, ty)
    if (k === 'barrel') L.lights.push({ x: cx, y: cy - 14, r: 56, i: 120, hue: HUE_RUST, kind: 'fire' })
    else if (k === 'radpool' && hash2(tx, ty, 77) > 0.55) L.lights.push({ x: cx, y: cy, r: 54, i: 70, hue: HUE_TOXIC, kind: 'rad' })
    else if (k === 'kiosk') L.lights.push({ x: cx, y: cy - 20, r: 40, i: 80, hue: HUE_GREEN, kind: 'lamp' })
  }
  { const [cx, cy] = tileCenter(5.5, 26.5); L.lights.push({ x: cx, y: cy - 4, r: 70, i: 70, hue: HUE_CYAN, kind: 'lamp' }) }
  { const [bx, by] = tileCenter(38, 14); L.lights.push({ x: bx, y: by - 132, r: 50, i: 120, hue: HUE_RED, kind: 'beacon' }) }
  cached = L
  return L
}

function groundPixel(kind: TileKind, gx: number, gy: number, u: number, v: number, vert: boolean, tx: number, ty: number): [number, number] {
  const n = valueNoise(gx * 6, gy * 6, 3), fine = hash2((gx * 32) | 0, (gy * 32) | 0, 7)
  const crack = Math.abs(valueNoise(gx * 2.2, gy * 2.2, 11) - 0.5) < 0.018
  switch (kind) {
    case 'asphalt': case 'car': case 'barrel': return [crack ? 18 : 34 + n * 14 + fine * 6, HUE_GREEN]
    case 'lane': {
      const along = vert ? v : u, across = vert ? u : v
      const dash = Math.abs(across - 0.5) < 0.05 && along % 1 < 0.6
      return dash ? [150 + fine * 40, HUE_AMBER] : [crack ? 18 : 36 + n * 12, HUE_GREEN]
    }
    case 'crossing': {
      const across = tileAt(tx, ty - 1) === 'lane' || tileAt(tx, ty + 1) === 'lane' ? u : v
      return [((across * 5) | 0) % 2 === 0 ? 120 + fine * 30 : 34 + n * 10, HUE_GREEN]
    }
    case 'sidewalk': case 'lowwall': case 'kiosk': case 'shack': case 'mast': case 'brownstone': case 'bodega': {
      const seam = (u * 2) % 1 < 0.05 || (v * 2) % 1 < 0.05
      return [crack ? 30 : seam ? 44 : 70 + n * 16 + fine * 6, HUE_GREEN]
    }
    case 'dirt': case 'overpass': case 'fence': return [44 + n * 22 + (fine > 0.93 ? 30 : 0), HUE_GREEN]
    case 'grass': case 'tree': case 'tombstone': case 'church': case 'steeple': case 'hatch':
      return [38 + n * 18 + (fine > 0.86 ? 40 + fine * 30 : 0), HUE_GREEN]
    case 'rubble': return [40 + n * 26 + (fine > 0.8 ? 26 : 0), HUE_GREEN]
    case 'radpool': return [60 + n * 40, HUE_GREEN]
    case 'platform': {
      const edgeY = tileAt(tx, ty - 1) !== 'platform' && v < 0.12, edgeX = tileAt(tx - 1, ty) !== 'platform' && u < 0.12
      if (edgeX || edgeY) return [170, HUE_AMBER]
      return [((u * 3) % 1 < 0.06 || (v * 3) % 1 < 0.06) ? 18 : 30 + n * 10, HUE_GREEN]
    }
    case 'pillar': return [30, HUE_GREEN]
  }
}

type Put = (x: number, y: number, l: number, h: number, d: number) => void
type Deco = (face: 0 | 1 | 2, u: number, v: number, x: number, y: number) => number | null

/** Extruded iso box. face 0=top 1=left 2=right; deco returns lum or null to skip pixel. */
function box(put: Put, tx: number, ty: number, h: number, inset: number, d: number, lt: number, ll: number, lr: number, hue: number, deco?: Deco, base = 0, ox = 0, oy = 0) {
  const [cx0, sy] = tileTop(tx + ox, ty + oy)
  const cx = cx0, cy = sy + 8 - base
  const hw = 16 * (1 - inset * 2), hh = hw / 2
  for (let x = Math.ceil(cx - hw); x < cx; x++) {
    const yb = cy + (x - cx + hw) / 2
    for (let y = Math.floor(yb - h); y < yb; y++) {
      const u = (x - cx + hw) / hw, v = (yb - y) / h
      const l = deco ? deco(1, u, v * h, x, y) : ll
      if (l !== null) put(x, y, l, hue, d)
    }
  }
  for (let x = Math.floor(cx); x < cx + hw; x++) {
    const yb = cy + hh - (x - cx) / 2
    for (let y = Math.floor(yb - h); y < yb; y++) {
      const u = (x - cx) / hw, v = (yb - y) / h
      const l = deco ? deco(2, u, v * h, x, y) : lr
      if (l !== null) put(x, y, l, hue, d)
    }
  }
  for (let x = Math.ceil(cx - hw); x <= cx + hw; x++) {
    const span = hh - Math.abs(x - cx) / 2
    for (let y = Math.floor(cy - h - span); y <= cy - h + span; y++) {
      const l = deco ? deco(0, (x - cx + hw) / (2 * hw), (y - (cy - h - hh)) / (2 * hh), x, y) : lt
      if (l !== null) put(x, y, l, hue, d)
    }
  }
}

function line(put: Put, x0: number, y0: number, x1: number, y1: number, l: number, h: number, d: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  for (let i = 0; i <= n; i++) put(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, l, h, d)
}

function drawObject(L: StaticLayer, put: Put, kind: TileKind, tx: number, ty: number, d: number) {
  const r = hash2(tx, ty, 1), r2 = hash2(tx, ty, 2)
  const [cx, cyTop] = tileTop(tx, ty)
  const cy = cyTop + 8
  switch (kind) {
    case 'brownstone': {
      const ruined = r < 0.22
      const h = 34 + Math.floor(r2 * 4) * 9 - (ruined ? 10 : 0)
      const brick: Deco = (f, u, v, x, y) => {
        const shade = f === 1 ? 92 : 64
        if (f === 0) return ruined ? (((x + y * 2) % 7 === 0) ? 70 : 22) : 108 + ((x * 3 + y) % 9 === 0 ? 14 : 0)
        const floor = Math.floor(v / 11), fv = v % 11
        if (v < 4) return shade - 22
        const hole = ruined && valueNoise(x / 6, y / 6, tx + ty) > 0.62
        if (hole) return 10
        const col = Math.floor(u * 3), fu = (u * 3) % 1
        if (fv > 3 && fv < 9 && fu > 0.28 && fu < 0.72) {
          const w = hash2(tx * 7 + col, ty * 5 + floor + f * 31, 9)
          return w > 0.93 ? 210 : w > 0.75 ? 6 : 26
        }
        if (f === 1 && fv < 1.2 && floor > 0) return 150
        if (f === 1 && floor > 0 && Math.abs(fu - 0.5 - (fv - 5) * 0.06) < 0.04 && col % 2 === 0) return 130
        const brk = ((y + ((Math.floor(x / 4) % 2) * 2)) % 4 === 0) ? -14 : 0
        return shade + brk + (hash2(x, y, 5) * 10 | 0)
      }
      box(put, tx, ty, h, 0, d, 108, 92, 64, HUE_GREEN, brick)
      return
    }
    case 'bodega': {
      box(put, tx, ty, 26, 0, d, 100, 86, 60, HUE_GREEN, (f, u, v) => {
        if (f === 0) return 96
        if (v > 15 && v < 19) return ((u * 8) | 0) % 2 ? 190 : 90
        if (v > 3 && v < 13 && u > 0.12 && u < 0.88) return r > 0.5 ? 26 : 140
        return f === 1 ? 86 : 60
      })
      return
    }
    case 'church': {
      box(put, tx, ty, 44, 0, d, 96, 104, 72, HUE_GREEN, (f, u, v) => {
        if (f === 0) return 84 + (((u * 10) | 0) % 2) * 10
        const fu = (u * 2) % 1
        if (v > 12 && v < 34 && Math.abs(fu - 0.5) < 0.12 && (v < 30 || Math.abs(fu - 0.5) < 0.12 - (v - 30) * 0.03)) return 170
        return (f === 1 ? 104 : 72) + ((v | 0) % 6 === 0 ? -16 : 0)
      })
      return
    }
    case 'steeple': {
      box(put, tx, ty, 78, 0.18, d, 110, 112, 76, HUE_GREEN, (f, u, v) => {
        if (f === 0) return 110
        if (v > 56 && v < 68 && u > 0.3 && u < 0.7) return 12
        return f === 1 ? 112 : 76
      })
      const hw = 16 * 0.64, top = cy - 78
      for (let x = Math.ceil(-hw); x <= hw; x++) {
        const hgt = 40 * (1 - Math.abs(x) / hw)
        for (let y = 0; y < hgt; y++) put(cx + x, top - y, x < 0 ? 120 : 82, HUE_GREEN, d)
      }
      line(put, cx, top - 40, cx, top - 50, 200, HUE_GREEN, d)
      line(put, cx - 4, top - 46, cx + 4, top - 46, 200, HUE_GREEN, d)
      return
    }
    case 'kiosk': {
      box(put, tx, ty, 14, 0.08, d, 120, 96, 70, HUE_GREEN, (f, u, v) => (f !== 0 && v > 9 ? 150 : f === 0 ? 120 : f === 1 ? 96 : 70))
      put(cx - 9, cy - 20, 255, HUE_GREEN, d); put(cx - 9, cy - 21, 230, HUE_GREEN, d); put(cx + 9, cy - 20, 255, HUE_GREEN, d)
      return
    }
    case 'lowwall': box(put, tx, ty, 7, 0.05, d, 120, 92, 66, HUE_GREEN, (f, u, v, x, y) => (f !== 0 && (x + y) % 5 === 0 ? 70 : f === 0 ? 120 : f === 1 ? 92 : 66)); return
    case 'pillar': box(put, tx, ty, 34, 0.32, d, 120, 100, 70, HUE_GREEN); return
    case 'overpass': {
      const pillarHere = tx % 3 === 0 && ty === 4
      if (pillarHere) box(put, tx, ty, 22, 0.34, d, 100, 88, 60, HUE_GREEN)
      const tilt = tileAt(tx - 1, ty) === 'rubble' || tileAt(tx + 1, ty) === 'rubble'
      box(put, tx, ty, 7, 0, d, 112, 80, 56, HUE_GREEN, (f, u, v, x) => {
        if (f === 0) return ty === 3 && u < 0.08 ? 160 : (x % 8 === 0 ? 92 : 112)
        return f === 1 ? 80 - (v < 2 ? 20 : 0) : 56
      }, tilt ? 14 : 22)
      if (ty === 3) for (let i = 0; i < 4; i++) line(put, cx - 16 + i * 8, cy - 30 - i * 4 - 8, cx - 16 + i * 8, cy - 30 - i * 4 - 2, 150, HUE_GREEN, d)
      return
    }
    case 'fence': box(put, tx, ty, 12, 0.02, d, 0, 0, 0, HUE_GREEN, (f, u, v, x, y) => {
      if (f === 0) return null
      if (u < 0.08 || v > 11) return 150
      return (x + y) % 4 === 0 || (x - y + 400) % 4 === 0 ? 96 : null
    }); return
    case 'barrel': box(put, tx, ty, 11, 0.3, d, 150, 110, 76, HUE_AMBER, (f, u, v) => (f === 0 ? 140 : v % 4 < 1 ? 160 : f === 1 ? 110 : 76)); return
    case 'car': {
      const dead = r > 0.5
      box(put, tx, ty, 7, 0.1, d, 104, 88, 60, HUE_GREEN, (f, u, v) => (f !== 0 && v < 2.5 && (u < 0.25 || u > 0.75) ? 20 : f === 0 ? 104 : f === 1 ? 88 : 60))
      box(put, tx, ty, 5, 0.24, d, dead ? 30 : 96, dead ? 50 : 30, dead ? 40 : 24, HUE_GREEN, undefined, 7)
      return
    }
    case 'tree': {
      box(put, tx, ty, 16, 0.44, d, 80, 70, 50, HUE_GREEN)
      const branch = (x: number, y: number, ang: number, len: number, depth: number) => {
        const x2 = x + Math.cos(ang) * len, y2 = y - Math.sin(ang) * len
        line(put, x, y, x2, y2, 96 + depth * 10, HUE_GREEN, d)
        if (depth > 0) for (const s of [-1, 1]) branch(x2, y2, ang + s * (0.45 + hash2(tx * depth, ty + s, 4) * 0.4), len * 0.68, depth - 1)
      }
      branch(cx, cy - 15, Math.PI / 2 + (r - 0.5) * 0.4, 9, 3)
      return
    }
    case 'tombstone': box(put, tx, ty, 8, 0.34, d, 160, 130, 90, HUE_GREEN, undefined, 0, (r - 0.5) * 0.3, (r2 - 0.5) * 0.3); return
    case 'hatch': {
      if (!(tx === 5 && ty === 26)) return
      const [hx, hy] = tileCenter(5.5, 26.5)
      for (let y = -18; y <= 18; y++) for (let x = -36; x <= 36; x++) {
        const ex = x / 2, rr = Math.hypot(ex, y)
        const ang = Math.atan2(y, ex)
        const tooth = 15 + (Math.cos(ang * 10) > 0.2 ? 3 : 0)
        if (rr > tooth) continue
        const l = rr > 13 ? 150 : rr > 11 ? 70 : rr < 4 ? 170 : (Math.abs(Math.sin(ang * 3)) < 0.12 ? 60 : 118)
        put(hx + x, hy + y - 2, l, HUE_GREEN, -1)
      }
      drawText(L.lum, L.hue, SW, SH, '34', hx - 5, hy - 22, 230, HUE_CYAN)
      return
    }
    case 'shack': box(put, tx, ty, 22, 0.02, d, 92, 100, 70, HUE_GREEN, (f, u, v, x) => (f === 0 ? 92 + (x % 3 === 0 ? 20 : 0) : ((x % 3) === 0 ? 120 : f === 1 ? 100 : 70))); return
    case 'mast': {
      box(put, tx, ty, 6, 0.2, d, 110, 90, 60, HUE_GREEN)
      const H = 120, top = cy - 6 - H
      line(put, cx - 10, cy - 6, cx - 1, top, 150, HUE_GREEN, d)
      line(put, cx + 10, cy - 6, cx + 1, top, 150, HUE_GREEN, d)
      for (let i = 0; i < 10; i++) {
        const y0 = cy - 6 - (i * H) / 10, y1 = cy - 6 - ((i + 1) * H) / 10
        const w0 = 10 - (i * 9) / 10, w1 = 10 - ((i + 1) * 9) / 10
        line(put, cx - w0, y0, cx + w1, y1, 96, HUE_GREEN, d)
        line(put, cx + w0, y0, cx - w1, y1, 96, HUE_GREEN, d)
      }
      return
    }
    case 'rubble': {
      const k = 2 + Math.floor(r * 3)
      for (let i = 0; i < k; i++) {
        const ox = (hash2(tx, ty, 20 + i) - 0.5) * 0.6, oy = (hash2(tx, ty, 40 + i) - 0.5) * 0.6
        box(put, tx, ty, 2 + hash2(tx, ty, 60 + i) * 6, 0.32 + hash2(tx, ty, 80 + i) * 0.1, d, 104, 80, 56, HUE_GREEN, undefined, 0, ox, oy)
      }
      return
    }
    default: return
  }
}
