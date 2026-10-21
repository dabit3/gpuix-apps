import mapData from '../data/map.json'

export type TileKind =
  | 'asphalt' | 'lane' | 'crossing' | 'sidewalk' | 'dirt' | 'grass' | 'rubble' | 'radpool' | 'platform'
  | 'brownstone' | 'bodega' | 'church' | 'steeple' | 'kiosk' | 'lowwall' | 'pillar' | 'overpass'
  | 'fence' | 'barrel' | 'car' | 'tree' | 'tombstone' | 'hatch' | 'shack' | 'mast'

export const MAP_W: number = mapData.width
export const MAP_H: number = mapData.height
const legend = mapData.legend as Record<string, TileKind>
export const TILES: TileKind[] = mapData.rows.join('').split('').map((c) => legend[c] ?? 'asphalt')
export const REGIONS = mapData.regions

const SOLID = new Set<TileKind>(['brownstone', 'bodega', 'church', 'steeple', 'kiosk', 'lowwall', 'pillar', 'overpass', 'fence', 'barrel', 'car', 'tree', 'tombstone', 'hatch', 'shack', 'mast'])
const COVER = new Set<TileKind>(['rubble', 'lowwall', 'pillar', 'car', 'barrel', 'tombstone', 'fence'])

export function tileAt(x: number, y: number): TileKind | null {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return null
  return TILES[y * MAP_W + x]!
}
export function isSolidTile(x: number, y: number): boolean {
  const t = tileAt(x, y)
  return t === null || SOLID.has(t)
}
export function givesCover(x: number, y: number): boolean {
  const t = tileAt(x, y)
  return t === null || COVER.has(t) || SOLID.has(t)
}
export function regionAt(x: number, y: number): string {
  for (const r of REGIONS) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r.name
  return y === 11 || y === 22 ? 'Houston St' : x === 13 || x === 27 ? 'Lafayette Ave' : 'Lower Manhattan'
}
/** 0..1 light level used by hit chance: the station platform is dark. */
export function lightAt(x: number, y: number): number {
  const t = tileAt(x, y)
  return t === 'platform' ? 0.35 : 1
}

export function lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx - dy, x = x0, y = y0
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
    if (x === x1 && y === y1) break
    const t = tileAt(x, y)
    if (t && SOLID.has(t) && t !== 'lowwall' && t !== 'car' && t !== 'barrel' && t !== 'tombstone' && t !== 'fence') return false
  }
  return true
}

export const DIRS8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]

/** BFS path (8-way, no corner cutting). Returns steps excluding start, or null. */
export function findPath(
  sx: number, sy: number, tx: number, ty: number,
  blocked: (x: number, y: number) => boolean, allowTargetBlocked = false, maxLen = 400,
): [number, number][] | null {
  if (sx === tx && sy === ty) return []
  const prev = new Int32Array(MAP_W * MAP_H).fill(-1)
  const start = sy * MAP_W + sx
  prev[start] = start
  const q = [start]
  for (let qi = 0; qi < q.length && qi < 4000; qi++) {
    const cur = q[qi]!
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx, ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue
      const ni = ny * MAP_W + nx
      if (prev[ni] !== -1) continue
      const isTarget = nx === tx && ny === ty
      if (blocked(nx, ny) && !(isTarget && allowTargetBlocked)) continue
      if (dx !== 0 && dy !== 0 && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) continue
      prev[ni] = cur
      if (isTarget) {
        const path: [number, number][] = []
        let p = ni
        while (p !== start) { path.push([p % MAP_W, (p / MAP_W) | 0]); p = prev[p]! }
        path.reverse()
        return path.length <= maxLen ? path : null
      }
      q.push(ni)
    }
  }
  return null
}
