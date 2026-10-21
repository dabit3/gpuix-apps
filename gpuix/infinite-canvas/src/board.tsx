import { memo, useLayoutEffect, useRef } from 'react'
import { PALETTE, PEN_WIDTH, STROKE, type Camera, type Rect, type Shape, type SpatialIndex, arrowEnds, smoothPath } from './model'
import { LOD_Z, TILE_PX, rasterize, tileLevel, tileWorld } from './raster'

export const FONT = 'SF Pro Text'
export const CANVAS_BG = '#f8f8f7'
/** Zoomed out past LOD_Z with more than this many shapes on screen, draw raster tiles instead. */
export const MAX_NODES = 1500

export function viewportRect(cam: Camera, width: number, height: number, marginPx = 0): Rect {
  const m = marginPx / cam.z
  return { x: cam.x - m, y: cam.y - m, w: width / cam.z + 2 * m, h: height / cam.z + 2 * m }
}

export interface CullResult {
  mode: 'nodes' | 'tiles'
  /** shape indices drawn as native nodes */
  visible: number[]
  /** raster tiles covering the viewport (tiles mode) */
  tiles: { key: string; level: number; tx: number; ty: number }[]
  painted: number
}

export function cull(index: SpatialIndex, cam: Camera, width: number, height: number): CullResult {
  const visible = index.query(viewportRect(cam, width, height, 24))
  if (cam.z >= LOD_Z || visible.length <= MAX_NODES) return { mode: 'nodes', visible, tiles: [], painted: visible.length }
  const level = tileLevel(cam.z)
  const tw = tileWorld(level)
  const vr = viewportRect(cam, width, height)
  const tx0 = Math.floor(vr.x / tw), ty0 = Math.floor(vr.y / tw)
  const tx1 = Math.floor((vr.x + vr.w) / tw), ty1 = Math.floor((vr.y + vr.h) / tw)
  const tiles: CullResult['tiles'] = []
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push({ key: `${level}:${tx}:${ty}`, level, tx, ty })
  const painted = index.query(vr).length
  return { mode: 'tiles', visible: [], tiles, painted }
}

// ── Dot grid ───────────────────────────────────────────────────────────────

const gridCache = new Map<string, string>()
function gridTileSrc(p: number, n: number, major: number): string {
  const key = `${p}:${n}:${major}`
  let src = gridCache.get(key)
  if (src) return src
  const size = p * n
  let dots = ''
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const isMajor = major > 0 && i % major === 0 && j % major === 0
      dots += `<circle cx="${(i + 0.5) * p}" cy="${(j + 0.5) * p}" r="${isMajor ? 1.4 : 1.05}" fill="${isMajor ? '#aeaeb3' : '#cacace'}"/>`
    }
  src = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${dots}</svg>`)}`
  gridCache.set(key, src)
  return src
}

export const DotGrid = memo(function DotGrid({ cam, width, height }: { cam: Camera; width: number; height: number }) {
  let worldPitch = 24
  while (worldPitch * cam.z < 14) worldPitch *= 4
  while (worldPitch * cam.z >= 56 && worldPitch > 24) worldPitch /= 4
  const p = Math.max(4, Math.round(worldPitch * cam.z * 4) / 4)
  const scale = p / (worldPitch * cam.z)
  const major = 4
  const n = major * Math.max(1, Math.ceil(240 / (p * major)))
  const T = p * n
  const src = gridTileSrc(p, n, major)
  // world point at multiples of worldPitch*n sit at tile origins (shifted by half a pitch)
  const originX = (-cam.x * cam.z * scale) % T
  const originY = (-cam.y * cam.z * scale) % T
  const startX = (originX > 0 ? originX - T : originX) - p / 2
  const startY = (originY > 0 ? originY - T : originY) - p / 2
  const cols = Math.ceil((width - startX) / T)
  const rows = Math.ceil((height - startY) / T)
  const tiles = []
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      tiles.push(<img key={`${i}:${j}`} src={src} objectFit="fill" style={{ position: 'absolute', left: startX + i * T, top: startY + j * T, width: T, height: T, pointerEvents: 'none' }} />)
  return <div style={{ position: 'absolute', left: 0, top: 0, width, height, backgroundColor: CANVAS_BG, overflow: 'hidden', pointerEvents: 'none' }}>{tiles}</div>
})

// ── Shape nodes ────────────────────────────────────────────────────────────

const ellipseSrc = (w: number, h: number, fill: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0.5, w / 2 - STROKE / 2)}" ry="${Math.max(0.5, h / 2 - STROKE / 2)}" ${fill ? 'fill="#000"' : `fill="none" stroke="#000" stroke-width="${STROKE}"`}/></svg>`

const PEN_PAD = 6
const penSrc = (s: Shape) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PEN_PAD} ${-PEN_PAD} ${s.w + PEN_PAD * 2} ${s.h + PEN_PAD * 2}"><path d="${smoothPath(s.points ?? [], 0, 0)}" fill="none" stroke="#000" stroke-width="${PEN_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/></svg>`

export const ARROW_PAD = 16
export function arrowSvg(p0: { x: number; y: number }, p1: { x: number; y: number }): { src: string; box: Rect } {
  const x0 = Math.min(p0.x, p1.x) - ARROW_PAD, y0 = Math.min(p0.y, p1.y) - ARROW_PAD
  const w = Math.abs(p1.x - p0.x) + ARROW_PAD * 2, h = Math.abs(p1.y - p0.y) + ARROW_PAD * 2
  const ax = p0.x - x0, ay = p0.y - y0, bx = p1.x - x0, by = p1.y - y0
  const ang = Math.atan2(by - ay, bx - ax)
  const head = 13, spread = 0.45
  const hx1 = bx - head * Math.cos(ang - spread), hy1 = by - head * Math.sin(ang - spread)
  const hx2 = bx - head * Math.cos(ang + spread), hy2 = by - head * Math.sin(ang + spread)
  const lx = bx - head * 0.8 * Math.cos(ang), ly = by - head * 0.8 * Math.sin(ang)
  const f = (v: number) => v.toFixed(1)
  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}"><path d="M${f(ax)} ${f(ay)}L${f(lx)} ${f(ly)}" stroke="#000" stroke-width="${STROKE}" stroke-linecap="round" fill="none"/><path d="M${f(bx)} ${f(by)}L${f(hx1)} ${f(hy1)}L${f(hx2)} ${f(hy2)}Z" fill="#000" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>`
  return { src, box: { x: x0, y: y0, w, h } }
}

interface NodeProps {
  s: Shape
  cam: Camera
  hidden?: boolean
  ends?: { p0: { x: number; y: number }; p1: { x: number; y: number } }
}

export const ShapeNode = memo(function ShapeNode({ s, cam, hidden, ends }: NodeProps) {
  const z = cam.z
  const left = (s.x - cam.x) * z, top = (s.y - cam.y) * z
  const width = s.w * z, height = s.h * z
  const pal = PALETTE[s.color]
  const base = { position: 'absolute' as const, left, top, width, height, pointerEvents: 'none' as const }
  switch (s.type) {
    case 'rect':
      return <div style={{ ...base, backgroundColor: pal.fill, borderWidth: Math.max(1, STROKE * z), borderColor: pal.stroke, borderRadius: 8 * z }} />
    case 'ellipse':
      return (
        <div style={base}>
          <svg source={ellipseSrc(s.w, s.h, true)} style={{ position: 'absolute', left: 0, top: 0, width, height, color: pal.fill }} />
          <svg source={ellipseSrc(s.w, s.h, false)} style={{ position: 'absolute', left: 0, top: 0, width, height, color: pal.stroke }} />
        </div>
      )
    case 'sticky':
      return (
        <div style={{ ...base, backgroundColor: pal.sticky, borderRadius: 6 * z, boxShadow: z > 0.35 ? { offsetX: 0, offsetY: 3 * z, blurRadius: 10 * z, spreadRadius: 0, color: '#0000001f' } : undefined, padding: 14 * z }}>
          {!hidden && s.text ? <text style={{ color: '#2b2b2b', fontSize: 17 * z, lineHeight: 23 * z, fontFamily: FONT }}>{s.text}</text> : null}
        </div>
      )
    case 'text':
      return <div style={base}>{!hidden ? <text style={{ color: pal.stroke, fontSize: 24 * z, lineHeight: 30 * z, fontWeight: 600, fontFamily: FONT }}>{s.text || ' '}</text> : null}</div>
    case 'image':
      return <img src={s.src} objectFit="cover" style={{ ...base, borderRadius: 6 * z }} />
    case 'pen':
      return <svg source={penSrc(s)} style={{ position: 'absolute', left: left - PEN_PAD * z, top: top - PEN_PAD * z, width: width + PEN_PAD * 2 * z, height: height + PEN_PAD * 2 * z, color: pal.stroke, pointerEvents: 'none' }} />
    case 'arrow': {
      if (!ends) return null
      const { src, box } = arrowSvg(ends.p0, ends.p1)
      return <svg source={src} style={{ position: 'absolute', left: (box.x - cam.x) * z, top: (box.y - cam.y) * z, width: box.w * z, height: box.h * z, color: pal.stroke, pointerEvents: 'none' }} />
    }
  }
})

// ── Raster tiles (zoomed-out LOD) ──────────────────────────────────────────

type PixelHost = { setImagePixels(width: number, height: number, pixels: Buffer): void }

export class TileCache {
  cache = new Map<string, Uint8Array>()
  version = -1
  get(key: string, level: number, tx: number, ty: number, index: SpatialIndex, byId: Map<string, Shape>, version: number) {
    if (version !== this.version) { this.cache.clear(); this.version = version }
    let px = this.cache.get(key)
    if (!px) {
      const tw = tileWorld(level)
      px = rasterize(index, byId, { x: tx * tw, y: ty * tw, w: tw, h: tw }, TILE_PX, TILE_PX)
      this.cache.set(key, px)
      if (this.cache.size > 600) this.cache.delete(this.cache.keys().next().value!)
    }
    return px
  }
}

const Tile = memo(function Tile({ pixels, left, top, size }: { pixels: Uint8Array; left: number; top: number; size: number }) {
  const ref = useRef<PixelHost | null>(null)
  useLayoutEffect(() => {
    ref.current?.setImagePixels(TILE_PX, TILE_PX, Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))
  }, [pixels])
  return <img ref={ref as never} objectFit="fill" style={{ position: 'absolute', left, top, width: size, height: size, pointerEvents: 'none' }} />
})

// ── Board view (used by the app and the PNG exporter) ─────────────────────

export interface BoardViewProps {
  shapes: Shape[]
  index: SpatialIndex
  byId: Map<string, Shape>
  culled: CullResult
  cam: Camera
  width: number
  height: number
  version: number
  tiles: TileCache
  editingId?: string | null
}

export function BoardView({ shapes, index, byId, culled, cam, width, height, version, tiles, editingId }: BoardViewProps) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden', pointerEvents: 'none' }}>
      <DotGrid cam={cam} width={width} height={height} />
      {culled.mode === 'nodes'
        ? culled.visible.map((i) => {
            const s = shapes[i]!
            return <ShapeNode key={s.id} s={s} cam={cam} hidden={s.id === editingId} ends={s.type === 'arrow' ? arrowEnds(s, byId) : undefined} />
          })
        : culled.tiles.map((t) => {
            const tw = tileWorld(t.level)
            const size = tw * cam.z
            return <Tile key={t.key} pixels={tiles.get(t.key, t.level, t.tx, t.ty, index, byId, version)} left={(t.tx * tw - cam.x) * cam.z} top={(t.ty * tw - cam.y) * cam.z} size={size} />
          })}
    </div>
  )
}
