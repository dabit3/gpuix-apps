// Level generator: a 4x3 macro grid of rooms joined by a random spanning tree (+ a couple of loops), then
// detailed with pillars, crates, wall panels, lights, enemies and pickups. Same seed → same level.
import { M } from './materials'
import { mulberry, type Rng } from './rng'

export const GX = 4, GY = 3, CS = 10
export const MW = GX * CS + 1, MH = GY * CS + 1
export const EMPTY = 255
export const LMR = 4 // lightmap samples per cell

export interface Room { i: number; j: number; x0: number; y0: number; x1: number; y1: number; theme: number; kind: 'start' | 'key' | 'exit' | 'room' }
export interface Door { x: number; y: number; vertical: boolean; locked: boolean; open: number; timer: number }
export interface Light { x: number; y: number; r: number; g: number; b: number; radius: number }
export type EnemyKind = 'spider' | 'sentry'
export type PickupKind = 'health' | 'ammo' | 'rockets' | 'key'
export interface Spawn<K> { kind: K; x: number; y: number; room: number }

export interface Level {
  seed: number
  cells: Uint8Array // material id or EMPTY
  doorAt: Int16Array // door index or -1
  doors: Door[]
  rooms: Room[]
  edges: [number, number][]
  lights: Light[]
  enemies: Spawn<EnemyKind>[]
  pickups: Spawn<PickupKind>[]
  start: { x: number; y: number; angle: number }
  exit: { x: number; y: number }
  lightmap: Float32Array // (MW*LMR) x (MH*LMR) x rgb
}

const THEMES = [M.wall, M.tech, M.concrete]
const LIGHT_COLORS = [0xff9a40, 0x5aa8ff, 0xc8d4e0]

export function generateLevel(seed = 1337): Level {
  const r = mulberry(seed)
  const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))
  const cells = new Uint8Array(MW * MH).fill(M.concrete)
  const doorAt = new Int16Array(MW * MH).fill(-1)
  const set = (x: number, y: number, v: number) => { cells[y * MW + x] = v }
  const rooms: Room[] = []
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const cx = i * CS + 5, cy = j * CS + 5
    rooms.push({ i, j, x0: cx - ri(2, 4), x1: cx + ri(2, 3), y0: cy - ri(2, 4), y1: cy + ri(2, 3), theme: THEMES[ri(0, 2)]!, kind: 'room' })
  }
  const id = (i: number, j: number) => j * GX + i
  // Spanning tree by randomized DFS from the start room (left column, middle row).
  const startRoom = id(0, 1)
  const seen = new Set([startRoom])
  const tree: [number, number][] = []
  const stack = [startRoom]
  while (stack.length) {
    const a = stack[stack.length - 1]!
    const ra = rooms[a]!
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => [ra.i + dx!, ra.j + dy!] as const)
      .filter(([i, j]) => i >= 0 && j >= 0 && i < GX && j < GY && !seen.has(id(i, j)))
    if (!nb.length) { stack.pop(); continue }
    const [i, j] = nb[Math.floor(r() * nb.length)]!
    const b = id(i, j)
    seen.add(b); tree.push([a, b]); stack.push(b)
  }
  const adj = (edges: [number, number][]) => {
    const g: number[][] = rooms.map(() => [])
    for (const [a, b] of edges) { g[a]!.push(b); g[b]!.push(a) }
    return g
  }
  const depth = (g: number[][], from: number) => {
    const d = rooms.map(() => -1); d[from] = 0
    const q = [from]
    while (q.length) { const a = q.shift()!; for (const b of g[a]!) if (d[b]! < 0) { d[b] = d[a]! + 1; q.push(b) } }
    return d
  }
  const g0 = adj(tree)
  const d0 = depth(g0, startRoom)
  const leaves = rooms.map((_, k) => k).filter((k) => k !== startRoom && g0[k]!.length === 1)
  const exitRoom = leaves.reduce((a, b) => (d0[b]! > d0[a]! ? b : a))
  // Two extra loops for flanking routes, never into the exit room.
  const edges = tree.slice()
  for (let t = 0; t < 12 && edges.length < tree.length + 2; t++) {
    const a = ri(0, rooms.length - 1)
    const ra = rooms[a]!
    const [dx, dy] = r() < 0.5 ? [1, 0] : [0, 1]
    if (ra.i + dx >= GX || ra.j + dy >= GY) continue
    const b = id(ra.i + dx, ra.j + dy)
    if (a === exitRoom || b === exitRoom || edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) continue
    edges.push([a, b])
  }
  const exitEdge = edges.find(([a, b]) => a === exitRoom || b === exitRoom)!
  const gateRoom = exitEdge[0] === exitRoom ? exitEdge[1] : exitEdge[0]
  // Key goes to the farthest room from start that isn't the exit (and preferably not the gate room).
  const d1 = depth(adj(edges), startRoom)
  let keyRoom = -1
  for (let k = 0; k < rooms.length; k++) {
    if (k === exitRoom || k === startRoom) continue
    const score = d1[k]! * 2 - (k === gateRoom ? 3 : 0)
    if (keyRoom < 0 || score > d1[keyRoom]! * 2 - (keyRoom === gateRoom ? 3 : 0)) keyRoom = k
  }
  rooms[startRoom]!.kind = 'start'; rooms[exitRoom]!.kind = 'exit'; rooms[keyRoom]!.kind = 'key'
  rooms[exitRoom]!.theme = M.wall
  rooms[startRoom]!.theme = M.tech

  // Carve rooms.
  for (const rm of rooms) for (let y = rm.y0; y <= rm.y1; y++) for (let x = rm.x0; x <= rm.x1; x++) set(x, y, EMPTY)
  // Room walls take the room's theme.
  for (const rm of rooms) for (let y = rm.y0 - 1; y <= rm.y1 + 1; y++) for (let x = rm.x0 - 1; x <= rm.x1 + 1; x++) {
    if (cells[y * MW + x] !== EMPTY) set(x, y, rm.theme === M.tech ? (r() < 0.5 ? M.tech : M.concrete) : rm.theme === M.wall && r() < 0.12 ? M.tech : rm.theme)
  }
  if (rooms[exitRoom]) {
    const e = rooms[exitRoom]!
    for (let x = e.x0; x <= e.x1; x += 2) { set(x, e.y0 - 1, M.exit); set(x, e.y1 + 1, M.exit) }
  }
  // Corridors (straight, guaranteed by rooms spanning their macro cell centre) with optional doors.
  const doors: Door[] = []
  for (const [a, b] of edges) {
    const A = rooms[Math.min(a, b)]!, B = rooms[Math.max(a, b)]!
    const locked = a === exitRoom || b === exitRoom
    const hasDoor = locked || r() < 0.45
    if (A.j === B.j) {
      const y = Math.max(A.y0, B.y0, A.j * CS + 4) + (r() < 0.5 ? 0 : 1)
      const xs = A.x1 + 1, xe = B.x0 - 1
      for (let x = xs; x <= xe; x++) set(x, y, EMPTY)
      if (hasDoor) {
        const dx = locked ? (b === exitRoom || a === exitRoom ? (rooms[exitRoom] === B ? xe : xs) : xs) : Math.floor((xs + xe) / 2)
        doorAt[y * MW + dx] = doors.length
        set(dx, y, locked ? M.keyDoor : M.door)
        doors.push({ x: dx, y, vertical: true, locked, open: 0, timer: 0 })
      }
    } else {
      const x = Math.max(A.x0, B.x0, A.i * CS + 4) + (r() < 0.5 ? 0 : 1)
      const ys = A.y1 + 1, ye = B.y0 - 1
      for (let y = ys; y <= ye; y++) set(x, y, EMPTY)
      if (hasDoor) {
        const dy = locked ? (rooms[exitRoom] === B ? ye : ys) : Math.floor((ys + ye) / 2)
        doorAt[dy * MW + x] = doors.length
        set(x, dy, locked ? M.keyDoor : M.door)
        doors.push({ x, y: dy, vertical: false, locked, open: 0, timer: 0 })
      }
    }
  }
  // Openings: any room-edge cell next to a corridor must stay clear.
  const isOpen = (x: number, y: number) => cells[y * MW + x] === EMPTY || doorAt[y * MW + x]! >= 0
  const nearOpening = (rm: Room, x: number, y: number) => {
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
      const outside = xx < rm.x0 || xx > rm.x1 || yy < rm.y0 || yy > rm.y1
      if (outside && isOpen(xx, yy)) return true
    }
    return false
  }
  // Pillars and crates.
  for (const rm of rooms) {
    const w = rm.x1 - rm.x0 + 1, h = rm.y1 - rm.y0 + 1
    if (rm.kind === 'exit') continue
    if (w >= 7 && h >= 7 && r() < 0.7) {
      for (const [px, py] of [[rm.x0 + 2, rm.y0 + 2], [rm.x1 - 2, rm.y0 + 2], [rm.x0 + 2, rm.y1 - 2], [rm.x1 - 2, rm.y1 - 2]]) set(px!, py!, M.pillar)
    }
    const crates = ri(1, 3)
    for (let c = 0; c < crates; c++) {
      const cx = r() < 0.5 ? rm.x0 : rm.x1, cy = r() < 0.5 ? rm.y0 : rm.y1
      if (!nearOpening(rm, cx, cy) && rm.kind !== 'start') set(cx, cy, M.crate)
    }
  }
  // Lights: one per room (themed), plus corridor lights while budget allows (max 16).
  const lights: Light[] = []
  const addLight = (x: number, y: number, hex: number, radius: number) => {
    if (lights.length >= 16) return
    lights.push({ x, y, r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255, radius })
  }
  for (const rm of rooms) {
    const hex = rm.kind === 'exit' ? 0x4ae168 : rm.kind === 'key' ? 0xf7c843 : LIGHT_COLORS[THEMES.indexOf(rm.theme as never)]!
    addLight((rm.x0 + rm.x1 + 1) / 2 + (r() - 0.5), (rm.y0 + rm.y1 + 1) / 2 + (r() - 0.5), hex, 8.5)
  }
  for (const d of doors) addLight(d.x + 0.5, d.y + 0.5, d.locked ? 0xf0b72f : 0x39c5cf, 3.5)

  // Entities.
  const free = (rm: Room) => {
    for (let t = 0; t < 40; t++) {
      const x = ri(rm.x0, rm.x1), y = ri(rm.y0, rm.y1)
      if (cells[y * MW + x] === EMPTY) return { x: x + 0.5, y: y + 0.5 }
    }
    return { x: (rm.x0 + rm.x1 + 1) / 2, y: (rm.y0 + rm.y1 + 1) / 2 }
  }
  const enemies: Spawn<EnemyKind>[] = []
  const pickups: Spawn<PickupKind>[] = []
  rooms.forEach((rm, k) => {
    if (rm.kind === 'start') return
    const n = rm.kind === 'exit' ? 2 : d1[k]! >= 2 ? 2 : 1
    for (let e = 0; e < n; e++) enemies.push({ kind: (e + k) % 2 ? 'sentry' : 'spider', ...free(rm), room: k })
    if (rm.kind === 'key') pickups.push({ kind: 'key', x: (rm.x0 + rm.x1 + 1) / 2, y: (rm.y0 + rm.y1 + 1) / 2, room: k })
    else if (rm.kind !== 'exit') pickups.push({ kind: (['health', 'ammo', 'rockets'] as const)[k % 3]!, ...free(rm), room: k })
  })
  const s = rooms[startRoom]!
  // Stand in line with the nearest doorway out of the start room and face it, so W walks straight out.
  const cx0 = (s.x0 + s.x1 + 1) / 2, cy0 = (s.y0 + s.y1 + 1) / 2
  const own = doors.filter((d) => !d.locked && d.x >= s.x0 - 1 && d.x <= s.x1 + 1 && d.y >= s.y0 - 1 && d.y <= s.y1 + 1 &&
    ((d.x >= s.x0 && d.x <= s.x1) || (d.y >= s.y0 && d.y <= s.y1)))
  const dr = (own.length ? own : doors).reduce((a, d) => (Math.hypot(d.x + 0.5 - cx0, d.y + 0.5 - cy0) < Math.hypot(a.x + 0.5 - cx0, a.y + 0.5 - cy0) ? d : a))
  const ddx = dr.x + 0.5 - cx0, ddy = dr.y + 0.5 - cy0
  let start = Math.abs(ddx) > Math.abs(ddy)
    ? { x: Math.floor(cx0) + 0.5, y: dr.y + 0.5, angle: ddx > 0 ? 0 : Math.PI }
    : { x: dr.x + 0.5, y: Math.floor(cy0) + 0.5, angle: ddy > 0 ? Math.PI / 2 : -Math.PI / 2 }
  if (cells[Math.floor(start.y) * MW + Math.floor(start.x)] !== EMPTY)
    start = { x: Math.floor(cx0) + 0.5, y: Math.floor(cy0) + 0.5, angle: Math.atan2(ddy, ddx) }
  const er = rooms[exitRoom]!
  const exit = { x: (er.x0 + er.x1 + 1) / 2, y: (er.y0 + er.y1 + 1) / 2 }
  const lvl: Level = { seed, cells, doorAt, doors, rooms, edges, lights, enemies, pickups, start, exit, lightmap: new Float32Array(0) }
  lvl.lightmap = bakeLightmap(lvl)
  return lvl
}

export function solidAt(l: Level, x: number, y: number): boolean {
  const cx = Math.floor(x), cy = Math.floor(y)
  if (cx < 0 || cy < 0 || cx >= MW || cy >= MH) return true
  const i = cy * MW + cx
  const d = l.doorAt[i]!
  if (d >= 0) return l.doors[d]!.open < 0.85
  return l.cells[i] !== EMPTY
}

// Grid line-of-sight (DDA). Doors block when mostly closed.
export function lineOfSight(l: Level, x0: number, y0: number, x1: number, y1: number, doorsBlock = true): boolean {
  const dx = x1 - x0, dy = y1 - y0
  let cx = Math.floor(x0), cy = Math.floor(y0)
  const ex = Math.floor(x1), ey = Math.floor(y1)
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1
  const tdx = dx === 0 ? 1e9 : Math.abs(1 / dx), tdy = dy === 0 ? 1e9 : Math.abs(1 / dy)
  let tx = dx === 0 ? 1e9 : (dx > 0 ? cx + 1 - x0 : x0 - cx) * tdx
  let ty = dy === 0 ? 1e9 : (dy > 0 ? cy + 1 - y0 : y0 - cy) * tdy
  for (let n = 0; n < 128; n++) {
    if (cx === ex && cy === ey) return true
    if (tx < ty) { tx += tdx; cx += sx } else { ty += tdy; cy += sy }
    if (cx === ex && cy === ey) return true
    const i = cy * MW + cx
    if (cx < 0 || cy < 0 || cx >= MW || cy >= MH) return false
    const d = l.doorAt[i]!
    if (d >= 0) { if (doorsBlock && l.doors[d]!.open < 0.6) return false; continue }
    if (l.cells[i] !== EMPTY) return false
  }
  return false
}

export function bakeLightmap(l: Level): Float32Array {
  const LW = MW * LMR, LH = MH * LMR
  const lm = new Float32Array(LW * LH * 3)
  const amb = [0.05, 0.055, 0.07]
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
    const cx = Math.floor(x / LMR), cy = Math.floor(y / LMR)
    const i = (y * LW + x) * 3
    lm[i] = amb[0]!; lm[i + 1] = amb[1]!; lm[i + 2] = amb[2]!
    if (l.cells[cy * MW + cx] !== EMPTY && l.doorAt[cy * MW + cx]! < 0) continue
    const wx = (x + 0.5) / LMR, wy = (y + 0.5) / LMR
    for (const L of l.lights) {
      const d = Math.hypot(wx - L.x, wy - L.y)
      if (d > L.radius) continue
      if (!lineOfSight(l, L.x, L.y, wx, wy, false)) continue
      const f = (1 - d / L.radius) ** 1.5 * 2.7
      lm[i] += L.r * f; lm[i + 1] += L.g * f; lm[i + 2] += L.b * f
    }
  }
  return lm
}

export function roomAt(l: Level, x: number, y: number): number {
  return l.rooms.findIndex((rm) => x >= rm.x0 && x < rm.x1 + 1 && y >= rm.y0 && y < rm.y1 + 1)
}

export type { Rng }
