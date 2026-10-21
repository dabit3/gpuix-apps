import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGpuix, useWindowSize } from '@gpuix/react'
import type { EventPayload, ImgInstance } from '@gpuix/react'
import type { ReactElement } from 'react'
type Instance = { id: number }
import { basename, dirname, extname, join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  COLOR_KEYS, PALETTE, SpatialIndex, type Binding, type Camera, type ColorKey, type Guide, type Rect, type Shape, type Tool,
  clamp, deserialize, imageSize, layoutArrows, newId, normRect, penShape, remap, serialize, snapBox, stressShapes,
  toScreen, toWorld, topHit, translate, unionRect, zoomAt, arrowEnds, intersects, contains, MIN_Z, MAX_Z,
} from './model'
import { BoardView, CANVAS_BG, FONT, ShapeNode, TileCache, cull, viewportRect } from './board'
import { minimap as rasterMinimap, minimapTransform } from './raster'
import { ICONS, type IconName } from './icons'

const ACCENT = '#0a84ff'
const INK = '#1d1d1f'
const MUTED = '#86868b'
const PANEL = { backgroundColor: '#ffffffee', borderRadius: 12, borderWidth: 1, borderColor: '#00000014', boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 24, spreadRadius: 0, color: '#0000001a' } }
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const MINI_W = 232, MINI_H = 148
const STICKY = 200

const TOOLS: { tool: Tool; icon: IconName; key: string; label: string }[] = [
  { tool: 'select', icon: 'select', key: 'V', label: 'Select' },
  { tool: 'hand', icon: 'hand', key: 'H', label: 'Hand' },
  { tool: 'rect', icon: 'rect', key: 'R', label: 'Rectangle' },
  { tool: 'ellipse', icon: 'ellipse', key: 'O', label: 'Ellipse' },
  { tool: 'arrow', icon: 'arrow', key: 'A', label: 'Arrow' },
  { tool: 'pen', icon: 'pen', key: 'P', label: 'Pen' },
  { tool: 'sticky', icon: 'sticky', key: 'N', label: 'Sticky note' },
  { tool: 'text', icon: 'text', key: 'T', label: 'Text' },
]
const KEY_TOOL: Record<string, Tool> = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', a: 'arrow', p: 'pen', n: 'sticky', t: 'text' }

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cam: Camera }
  | { kind: 'move'; wx: number; wy: number; start: Shape[]; ids: Set<string>; moved: boolean }
  | { kind: 'resize'; handle: number; box: Rect; start: Shape[]; ids: Set<string> }
  | { kind: 'marquee'; wx: number; wy: number; base: string[] }
  | { kind: 'create'; type: 'rect' | 'ellipse'; wx: number; wy: number }
  | { kind: 'arrow'; from: Binding }
  | { kind: 'pen'; points: number[] }

export interface AppProps {
  initialBoard?: string
  savePath?: string
  /** Called after each committed render with live stats (tests, perf). */
  onStats?: (s: { total: number; painted: number; mode: string; zoom: number }) => void
}

function textBox(text: string, type: 'text' | 'sticky') {
  if (type === 'sticky') return { w: STICKY, h: STICKY }
  const lines = (text || ' ').split('\n')
  return { w: Math.max(40, Math.max(...lines.map((l) => l.length)) * 13.5 + 8), h: lines.length * 30 + 4 }
}

export function App({ initialBoard, savePath: initialSave, onStats }: AppProps) {
  const ctx = useGpuix()
  const win = useWindowSize()
  const W = win.width, H = win.height

  const initial = useMemo(() => {
    if (initialBoard && existsSync(initialBoard)) {
      try { return deserialize(readFileSync(initialBoard, 'utf8')) } catch {}
    }
    return null
  }, [initialBoard])

  const [shapes, setShapes] = useState<Shape[]>(() => initial?.shapes ?? [])
  const [cam, setCam] = useState<Camera>(() => initial?.camera ?? { x: -W / 2 + 200, y: -H / 2 + 120, z: 1 })
  const [tool, setToolState] = useState<Tool>('select')
  const toolRef = useRef<Tool>('select')
  const setTool = useCallback((t: Tool) => { toolRef.current = t; setToolState(t) }, [])
  const [color, setColor] = useState<ColorKey>('blue')
  const [selected, setSelectedState] = useState<string[]>([])
  const selectedRef = useRef<string[]>([])
  const setSelected = useCallback((v: string[] | ((s: string[]) => string[])) => {
    const next = typeof v === 'function' ? v(selectedRef.current) : v
    selectedRef.current = next
    setSelectedState(next)
  }, [])
  const [editing, setEditingState] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  const setEditing = useCallback((id: string | null) => { editingRef.current = id; setEditingState(id) }, [])
  const [draft, setDraftState] = useState('')
  const draftRef = useRef('')
  const setDraft = useCallback((t: string) => { draftRef.current = t; setDraftState(t) }, [])
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [ghost, setGhost] = useState<Shape | null>(null)
  const [bindHover, setBindHover] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [savePath, setSavePath] = useState<string | undefined>(initialSave ?? initialBoard)
  const [fps, setFps] = useState(0)

  const past = useRef<Shape[][]>([])
  const future = useRef<Shape[][]>([])
  const clip = useRef<Shape[]>([])
  const pasteCount = useRef(0)
  const drag = useRef<Drag | null>(null)
  const shapesRef = useRef(shapes); shapesRef.current = shapes
  const camRef = useRef(cam); camRef.current = cam
  const rootRef = useRef<Instance | null>(null)
  const tiles = useRef(new TileCache()).current
  const version = useRef({ shapes, n: 0 })
  if (version.current.shapes !== shapes) version.current = { shapes, n: version.current.n + 1 }
  const anim = useRef<ReturnType<typeof setInterval> | null>(null)
  const frameTimes = useRef<number[]>([])
  const mouse = useRef({ x: W / 2, y: H / 2 })

  const index = useMemo(() => new SpatialIndex(shapes), [shapes])
  const byId = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes])
  const culled = cull(index, cam, W, H)
  const selSet = useMemo(() => new Set(selected), [selected])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200)
  }, [])

  // ── history ──
  const commit = useCallback((next: Shape[], before?: Shape[]) => {
    past.current.push(before ?? shapesRef.current)
    if (past.current.length > 200) past.current.shift()
    future.current = []
    shapesRef.current = next
    setShapes(next)
  }, [])
  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(shapesRef.current)
    setShapes(prev); setSelected((s) => s.filter((id) => prev.some((p) => p.id === id)))
  }, [])
  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(shapesRef.current)
    setShapes(next)
  }, [])

  const focusRoot = useCallback(() => {
    if (rootRef.current) ctx.renderer?.focusElement?.(rootRef.current.id)
  }, [ctx.renderer])

  // ── camera ──
  const flyTo = useCallback((target: Camera, ms = 650) => {
    if (anim.current) clearInterval(anim.current)
    const from = camRef.current
    const t0 = performance.now()
    const lz0 = Math.log(from.z), lz1 = Math.log(target.z)
    // interpolate the viewport centre and log-zoom so the flight feels even
    const c0 = { x: from.x + W / 2 / from.z, y: from.y + H / 2 / from.z }
    const c1 = { x: target.x + W / 2 / target.z, y: target.y + H / 2 / target.z }
    anim.current = setInterval(() => {
      const t = Math.min(1, (performance.now() - t0) / ms)
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      const z = Math.exp(lz0 + (lz1 - lz0) * e)
      const cx = c0.x + (c1.x - c0.x) * e, cy = c0.y + (c1.y - c0.y) * e
      setCam({ x: cx - W / 2 / z, y: cy - H / 2 / z, z })
      if (t >= 1 && anim.current) { clearInterval(anim.current); anim.current = null }
    }, 1000 / 60)
  }, [W, H])

  const fitRect = useCallback((r: Rect | null, animate = true) => {
    if (!r) return
    const pad = 80
    const z = clamp(Math.min((W - pad * 2) / Math.max(r.w, 1), (H - pad * 2) / Math.max(r.h, 1)), MIN_Z, 2)
    const target = { x: r.x + r.w / 2 - W / 2 / z, y: r.y + r.h / 2 - H / 2 / z, z }
    animate ? flyTo(target) : setCam(target)
  }, [W, H, flyTo])

  const zoomBy = useCallback((f: number, sx = W / 2, sy = H / 2) => setCam((c) => zoomAt(c, c.z * f, sx, sy)), [W, H])

  // fps of committed camera frames over the last second
  useLayoutEffect(() => {
    const now = performance.now()
    const ft = frameTimes.current
    ft.push(now)
    while (ft.length && ft[0]! < now - 1000) ft.shift()
  }, [cam])
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now()
      const ft = frameTimes.current
      while (ft.length && ft[0]! < now - 1000) ft.shift()
      setFps(ft.length)
    }, 250)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { onStats?.({ total: shapes.length, painted: culled.painted, mode: culled.mode, zoom: cam.z }) })

  // ── editing ──
  const startEdit = useCallback((s: Shape) => {
    setEditing(s.id); setDraft(s.text ?? ''); setSelected([s.id])
  }, [])
  const finishEdit = useCallback(() => {
    const editing = editingRef.current, draft = draftRef.current
    if (!editing) return
    const s = shapesRef.current.find((x) => x.id === editing)
    setEditing(null)
    if (s) {
      if (s.type === 'text' && !draft.trim()) {
        commit(shapesRef.current.filter((x) => x.id !== s.id))
        setSelected([])
      } else if (draft !== (s.text ?? '')) {
        const size = textBox(draft, s.type as 'text' | 'sticky')
        commit(shapesRef.current.map((x) => (x.id === s.id ? { ...x, text: draft, ...(s.type === 'text' ? size : {}) } : x)))
      }
    }
    focusRoot()
  }, [commit, focusRoot, setEditing])

  // ── selection helpers ──
  const selection = useMemo(() => shapes.filter((s) => selSet.has(s.id)), [shapes, selSet])
  const selBox = useMemo(() => unionRect(selection), [selection])

  const deleteSelected = useCallback(() => {
    const selSet = new Set(selectedRef.current)
    if (!selSet.size) return
    const cur = shapesRef.current
    const map = new Map(cur.map((s) => [s.id, s]))
    const next = cur.filter((s) => !selSet.has(s.id)).map((s) => {
      if (s.type !== 'arrow') return s
      const free = (b: Binding | undefined, which: 'p0' | 'p1') => (b?.id && selSet.has(b.id) ? { x: arrowEnds(s, map)[which].x, y: arrowEnds(s, map)[which].y } : b)
      return { ...s, from: free(s.from, 'p0'), to: free(s.to, 'p1') }
    })
    commit(next); setSelected([])
  }, [commit, setSelected])

  const cloneShapes = useCallback((src: Shape[], off: number) => {
    const ids = new Map(src.map((s) => [s.id, newId()]))
    const map = new Map(shapesRef.current.map((s) => [s.id, s]))
    return src.map((s) => {
      const c: Shape = { ...translate(s, off, off), id: ids.get(s.id)!, stress: undefined }
      if (s.type === 'arrow') {
        const ends = arrowEnds(s, map)
        const rebind = (b: Binding | undefined, p: { x: number; y: number }): Binding | undefined =>
          b?.id && ids.has(b.id) ? { id: ids.get(b.id), x: 0, y: 0 } : { x: p.x + off, y: p.y + off }
        c.from = rebind(s.from, ends.p0); c.to = rebind(s.to, ends.p1)
      }
      return c
    })
  }, [])

  const paste = useCallback((src: Shape[]) => {
    if (!src.length) return
    pasteCount.current++
    const copies = cloneShapes(src, 24 * pasteCount.current)
    commit(layoutArrows([...shapesRef.current, ...copies]))
    setSelected(copies.map((c) => c.id))
  }, [cloneShapes, commit])

  const reorder = useCallback((front: boolean) => {
    const selSet = new Set(selectedRef.current)
    if (!selSet.size) return
    const cur = shapesRef.current
    const sel = cur.filter((s) => selSet.has(s.id)), rest = cur.filter((s) => !selSet.has(s.id))
    commit(front ? [...rest, ...sel] : [...sel, ...rest])
  }, [commit])

  const recolor = useCallback((c: ColorKey) => {
    setColor(c)
    const selSet = new Set(selectedRef.current)
    if (selSet.size) commit(shapesRef.current.map((s) => (selSet.has(s.id) ? { ...s, color: c } : s)))
  }, [commit])

  // ── stress, files ──
  const toggleStress = useCallback(() => {
    const cur = shapesRef.current
    if (cur.some((s) => s.stress)) {
      commit(cur.filter((s) => !s.stress)); flash('Removed stress field')
      return
    }
    const field = stressShapes(10_000)
    const t = performance.now()
    commit([...field, ...cur])
    flash(`Spawned 10,000 shapes in ${Math.round(performance.now() - t)} ms`)
    fitRect(unionRect([...field, ...cur]))
  }, [commit, flash, fitRect])

  const addImages = useCallback((paths: string[], at?: { x: number; y: number }) => {
    const imgs: Shape[] = []
    let ox = 0
    const c = at ?? toWorld(camRef.current, W / 2, H / 2)
    for (const p of paths) {
      if (!IMAGE_EXT.has(extname(p).toLowerCase())) continue
      const size = imageSize(readFileSync(p)) ?? { w: 400, h: 300 }
      const scale = Math.min(1, 360 / size.w)
      const w = size.w * scale, h = size.h * scale
      imgs.push({ id: newId(), type: 'image', x: c.x - w / 2 + ox, y: c.y - h / 2 + ox, w, h, color: 'gray', src: p })
      ox += 28
    }
    if (imgs.length) { commit([...shapesRef.current, ...imgs]); setSelected(imgs.map((i) => i.id)); setTool('select') }
    return imgs.length
  }, [commit, W, H])

  const loadBoard = useCallback((path: string) => {
    try {
      const b = deserialize(readFileSync(path, 'utf8'))
      commit(b.shapes); setCam(b.camera); setSelected([]); setSavePath(path)
      flash(`Opened ${basename(path)} · ${b.shapes.length.toLocaleString()} shapes`)
    } catch (e) { flash(`Could not open: ${(e as Error).message}`) }
  }, [commit, flash])

  const save = useCallback(async () => {
    let path = savePath
    if (!path) {
      const dirs = await ctx.renderer?.promptForPaths?.({ directories: true, files: false, prompt: 'Save Here' })
      if (!dirs?.[0]) return
      path = join(dirs[0], 'Untitled board.json')
    }
    writeFileSync(path, serialize(shapesRef.current, camRef.current))
    setSavePath(path)
    flash(`Saved ${basename(path)} · ${shapesRef.current.length.toLocaleString()} shapes`)
  }, [savePath, ctx.renderer, flash])

  const open = useCallback(async () => {
    const paths = await ctx.renderer?.promptForPaths?.({ files: true, multiple: true, prompt: 'Open' })
    if (!paths?.length) return
    const json = paths.find((p) => p.endsWith('.json'))
    if (json) loadBoard(json)
    else addImages(paths)
  }, [ctx.renderer, loadBoard, addImages])

  const pickImage = useCallback(async () => {
    const paths = await ctx.renderer?.promptForPaths?.({ files: true, multiple: true, prompt: 'Insert' })
    if (paths?.length) addImages(paths)
  }, [ctx.renderer, addImages])

  const exportPng = useCallback(async () => {
    const dir = savePath ? dirname(savePath) : join(homedir(), 'Desktop')
    const stem = savePath ? basename(savePath, '.json') : 'Untitled board'
    const json = join(dir, `.${stem}.export.json`)
    const out = join(dir, `${stem}.png`)
    writeFileSync(json, serialize(shapesRef.current, camRef.current))
    flash('Exporting PNG…')
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'export.tsx'), json, out], { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    try { (await import('node:fs')).unlinkSync(json) } catch {}
    flash(code === 0 ? `Exported ${basename(out)}` : `Export failed (${code})`)
  }, [savePath, flash])

  // ── keyboard ──
  const onKeyDown = (e: EventPayload) => {
    const key = (e.key ?? '').toLowerCase()
    const m = e.modifiers ?? { cmd: false, ctrl: false, shift: false, alt: false }
    const cmd = m.cmd || m.ctrl
    const selSet = new Set(selectedRef.current)
    const selection = shapesRef.current.filter((s) => selSet.has(s.id))
    const selBox = unionRect(selection)
    if (editingRef.current) {
      if (key === 'escape' || (key === 'enter' && cmd)) finishEdit()
      return
    }
    if (cmd) {
      if (key === 'z') m.shift ? redo() : undo()
      else if (key === 'y') redo()
      else if (key === 'd') paste(selection)
      else if (key === 'c') { clip.current = selection; pasteCount.current = 0; if (selection.length) flash(`Copied ${selection.length}`) }
      else if (key === 'x') { clip.current = selection; pasteCount.current = 0; deleteSelected() }
      else if (key === 'v') paste(clip.current)
      else if (key === 'a') setSelected(shapesRef.current.filter((s) => !s.stress).map((s) => s.id))
      else if (key === 's') void save()
      else if (key === 'o') void open()
      else if (key === 'e') void exportPng()
      else if (key === '0') setCam((c) => zoomAt(c, 1, W / 2, H / 2))
      else if (key === '=' || key === '+') zoomBy(1.25)
      else if (key === '-') zoomBy(0.8)
      return
    }
    if (key === 'backspace' || key === 'delete') deleteSelected()
    else if (key === 'escape') { setSelected([]); setTool('select') }
    else if (key === ']') reorder(true)
    else if (key === '[') reorder(false)
    else if (key === '1' && m.shift) fitRect(unionRect(shapesRef.current))
    else if (key === '2' && m.shift) fitRect(selBox)
    else if (key === 'enter' && selection.length === 1 && (selection[0]!.type === 'sticky' || selection[0]!.type === 'text')) startEdit(selection[0]!)
    else if (['left', 'right', 'up', 'down'].includes(key) && selSet.size) {
      const d = m.shift ? 10 : 1
      const dx = key === 'left' ? -d : key === 'right' ? d : 0, dy = key === 'up' ? -d : key === 'down' ? d : 0
      commit(layoutArrows(shapesRef.current.map((s) => (selSet.has(s.id) ? translate(s, dx, dy) : s))))
    } else if (KEY_TOOL[key]) { setTool(KEY_TOOL[key]!); if (KEY_TOOL[key] !== 'select') setSelected([]) }
  }

  // ── pointer ──
  const handleAt = (sx: number, sy: number): number => {
    if (!selBox || tool !== 'select') return -1
    const a = toScreen(cam, selBox.x, selBox.y)
    const w = selBox.w * cam.z, h = selBox.h * cam.z
    const pts = [[a.x, a.y], [a.x + w / 2, a.y], [a.x + w, a.y], [a.x + w, a.y + h / 2], [a.x + w, a.y + h], [a.x + w / 2, a.y + h], [a.x, a.y + h], [a.x, a.y + h / 2]]
    for (let i = 0; i < 8; i++) if (Math.abs(sx - pts[i]![0]!) <= 7 && Math.abs(sy - pts[i]![1]!) <= 7) return i
    return -1
  }

  const bindTarget = (wx: number, wy: number) => {
    const hit = topHit(index, wx, wy, 6 / cam.z, byId)
    return hit && hit.type !== 'arrow' && hit.type !== 'pen' ? hit : null
  }

  const refsFor = (ids: Set<string>) => {
    const vr = viewportRect(cam, W, H, 200)
    return index.query(vr).map((i) => shapes[i]!).filter((s) => !ids.has(s.id) && s.type !== 'arrow' && s.type !== 'pen').slice(0, 400)
  }

  const onMouseDown = (e: EventPayload) => {
    const tool = toolRef.current
    const editing = editingRef.current
    const sx = e.x ?? 0, sy = e.y ?? 0
    if (anim.current) { clearInterval(anim.current); anim.current = null }
    const w = toWorld(cam, sx, sy)
    if (editing) {
      const s = byId.get(editing)
      if (s && contains(s, { x: w.x, y: w.y, w: 0, h: 0 })) return
      finishEdit()
    } else focusRoot()
    if (e.button === 1 || e.button === 2 || tool === 'hand') { drag.current = { kind: 'pan', sx, sy, cam }; return }
    const shift = e.modifiers?.shift ?? false
    switch (tool) {
      case 'select': {
        const h = handleAt(sx, sy)
        if (h >= 0 && selBox) { drag.current = { kind: 'resize', handle: h, box: selBox, start: shapes, ids: selSet }; return }
        const hit = topHit(index, w.x, w.y, 4 / cam.z, byId)
        if (hit && (e.clickCount ?? 1) >= 2 && (hit.type === 'sticky' || hit.type === 'text')) { startEdit(hit); return }
        if (hit) {
          let ids = selected
          if (shift) ids = selSet.has(hit.id) ? selected.filter((i) => i !== hit.id) : [...selected, hit.id]
          else if (!selSet.has(hit.id)) ids = [hit.id]
          setSelected(ids)
          drag.current = { kind: 'move', wx: w.x, wy: w.y, start: shapes, ids: new Set(ids), moved: false }
        } else {
          if (!shift) setSelected([])
          drag.current = { kind: 'marquee', wx: w.x, wy: w.y, base: shift ? selected : [] }
        }
        return
      }
      case 'rect': case 'ellipse':
        drag.current = { kind: 'create', type: tool, wx: w.x, wy: w.y }
        return
      case 'sticky': {
        const s: Shape = { id: newId(), type: 'sticky', x: w.x - STICKY / 2, y: w.y - STICKY / 2, w: STICKY, h: STICKY, color: color === 'blue' ? 'yellow' : color, text: '' }
        commit([...shapes, s]); setTool('select'); startEdit(s)
        return
      }
      case 'text': {
        const s: Shape = { id: newId(), type: 'text', x: w.x, y: w.y - 15, w: 40, h: 34, color: color === 'blue' ? 'ink' : color, text: '' }
        commit([...shapes, s]); setTool('select'); startEdit(s)
        return
      }
      case 'arrow': {
        const t = bindTarget(w.x, w.y)
        drag.current = { kind: 'arrow', from: t ? { id: t.id, x: w.x, y: w.y } : { x: w.x, y: w.y } }
        return
      }
      case 'pen':
        drag.current = { kind: 'pen', points: [w.x, w.y] }
        return
    }
  }

  const onMouseMove = (e: EventPayload) => {
    const tool = toolRef.current
    const sx = e.x ?? 0, sy = e.y ?? 0
    mouse.current = { x: sx, y: sy }
    const d = drag.current
    if (!d) {
      if (tool === 'arrow') { const t = bindTarget(...(Object.values(toWorld(cam, sx, sy)) as [number, number])); setBindHover(t?.id ?? null) }
      return
    }
    const w = toWorld(cam, sx, sy)
    switch (d.kind) {
      case 'pan':
        setCam({ x: d.cam.x - (sx - d.sx) / d.cam.z, y: d.cam.y - (sy - d.sy) / d.cam.z, z: d.cam.z })
        return
      case 'move': {
        let dx = w.x - d.wx, dy = w.y - d.wy
        if (!d.moved && Math.hypot(dx, dy) * cam.z < 3) return
        d.moved = true
        const moving = d.start.filter((s) => d.ids.has(s.id))
        const box = unionRect(moving)!
        const snap = snapBox({ ...box, x: box.x + dx, y: box.y + dy }, refsFor(d.ids), 6 / cam.z)
        dx += snap.dx; dy += snap.dy
        setGuides(snap.guides)
        setShapes(layoutArrows(d.start.map((s) => (d.ids.has(s.id) ? translate(s, dx, dy) : s))))
        return
      }
      case 'resize': {
        const b = d.box
        let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h
        const snap = snapBox({ x: w.x, y: w.y, w: 0, h: 0 }, refsFor(d.ids), 6 / cam.z)
        const px = w.x + snap.dx, py = w.y + snap.dy
        if ([0, 6, 7].includes(d.handle)) x0 = Math.min(px, x1 - 8)
        if ([2, 3, 4].includes(d.handle)) x1 = Math.max(px, x0 + 8)
        if ([0, 1, 2].includes(d.handle)) y0 = Math.min(py, y1 - 8)
        if ([4, 5, 6].includes(d.handle)) y1 = Math.max(py, y0 + 8)
        setGuides(snap.guides.filter((g) => (g.axis === 'x' ? ![1, 5].includes(d.handle) : ![3, 7].includes(d.handle))))
        const nb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
        setShapes(layoutArrows(d.start.map((s) => (d.ids.has(s.id) ? remap(s, b, nb) : s))))
        return
      }
      case 'marquee': {
        const r = normRect(d.wx, d.wy, w.x, w.y)
        setMarquee(r)
        const hits = index.query(r).map((i) => shapes[i]!).filter((s) => intersects(s, r) && !s.stress).map((s) => s.id)
        setSelected([...new Set([...d.base, ...hits])])
        return
      }
      case 'create': {
        const r = normRect(d.wx, d.wy, w.x, w.y)
        setGhost({ id: 'ghost', type: d.type, ...r, color })
        return
      }
      case 'arrow': {
        const t = bindTarget(w.x, w.y)
        setBindHover(t && t.id !== d.from.id ? t.id : null)
        const to: Binding = t && t.id !== d.from.id ? { id: t.id, x: w.x, y: w.y } : { x: w.x, y: w.y }
        const a: Shape = { id: 'ghost', type: 'arrow', x: 0, y: 0, w: 0, h: 0, color: color === 'blue' ? 'ink' : color, from: d.from, to }
        setGhost(layoutArrows([...shapes, a]).at(-1)!)
        return
      }
      case 'pen': {
        const p = d.points
        const lx = p[p.length - 2]!, ly = p[p.length - 1]!
        if (Math.hypot(w.x - lx, w.y - ly) * cam.z < 1.5) return
        p.push(w.x, w.y)
        setGhost({ ...penShape(p, color, 1e6), id: 'ghost' })
        return
      }
    }
  }

  const onMouseUp = (e: EventPayload) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const w = toWorld(cam, e.x ?? 0, e.y ?? 0)
    setGuides([]); setGhost(null); setMarquee(null); setBindHover(null)
    switch (d.kind) {
      case 'move':
        if (d.moved) commit(shapesRef.current, d.start)
        return
      case 'resize':
        commit(shapesRef.current, d.start)
        return
      case 'create': {
        let r = normRect(d.wx, d.wy, w.x, w.y)
        if (r.w * cam.z < 6 && r.h * cam.z < 6) r = { x: d.wx - 80, y: d.wy - 50, w: 160, h: 100 }
        const s: Shape = { id: newId(), type: d.type, ...r, color }
        commit([...shapes, s]); setSelected([s.id]); setTool('select')
        return
      }
      case 'arrow': {
        const t = bindTarget(w.x, w.y)
        const to: Binding = t && t.id !== d.from.id ? { id: t.id, x: w.x, y: w.y } : { x: w.x, y: w.y }
        if (!to.id && !d.from.id && Math.hypot(w.x - d.from.x, w.y - d.from.y) * cam.z < 8) return
        if (to.id && to.id === d.from.id) return
        const a: Shape = { id: newId(), type: 'arrow', x: 0, y: 0, w: 0, h: 0, color: color === 'blue' ? 'ink' : color, from: d.from, to }
        const next = layoutArrows([...shapes, a])
        commit(next.at(-1)!.w === 0 && !to.id && !d.from.id ? next : next); setSelected([a.id])
        return
      }
      case 'pen': {
        const s = penShape(d.points, color, cam.z)
        commit([...shapes, s])
        return
      }
    }
  }

  const onScroll = (e: EventPayload) => {
    if (anim.current) { clearInterval(anim.current); anim.current = null }
    const ev = e as EventPayload & { deltaX?: number; deltaY?: number; precise?: boolean }
    const dx = (ev.deltaX ?? 0) * (ev.precise ? 1 : 24), dy = (ev.deltaY ?? 0) * (ev.precise ? 1 : 24)
    const m = e.modifiers
    const sx = e.x ?? mouse.current.x, sy = e.y ?? mouse.current.y
    if (m?.cmd || m?.ctrl) setCam((c) => zoomAt(c, c.z * Math.exp(dy * 0.006), sx, sy))
    else setCam((c) => ({ ...c, x: c.x - dx / c.z, y: c.y - dy / c.z }))
  }

  const onFileDrop = (e: EventPayload) => {
    const paths = (e as EventPayload & { paths?: string[] }).paths ?? []
    const json = paths.find((p) => p.endsWith('.json'))
    if (json) return loadBoard(json)
    addImages(paths, toWorld(cam, e.x ?? W / 2, e.y ?? H / 2))
  }

  // ── minimap ──
  const shapeBounds = useMemo(() => unionRect(shapes), [shapes])
  const u = unionRect([...(shapeBounds ? [shapeBounds] : []), viewportRect(cam, W, H)])!
  const step = 2 ** Math.ceil(Math.log2(Math.max(u.w, u.h) / 6))
  const qx0 = Math.floor((u.x - step / 4) / step) * step, qy0 = Math.floor((u.y - step / 4) / step) * step
  const qx1 = Math.ceil((u.x + u.w + step / 4) / step) * step, qy1 = Math.ceil((u.y + u.h + step / 4) / step) * step
  const world = useMemo(() => ({ x: qx0, y: qy0, w: qx1 - qx0, h: qy1 - qy0 }), [qx0, qy0, qx1, qy1])
  const miniPixels = useMemo(() => rasterMinimap(shapes, world, MINI_W, MINI_H), [shapes, world])
  const miniRef = useRef<ImgInstance | null>(null)
  useLayoutEffect(() => { miniRef.current?.setImagePixels(MINI_W, MINI_H, miniPixels) }, [miniPixels])
  const mt = minimapTransform(world, MINI_W, MINI_H)
  const miniDrag = useRef(false)
  const miniJump = (e: EventPayload, animate: boolean) => {
    const lx = (e.x ?? 0) - (W - MINI_W - 16), ly = (e.y ?? 0) - (H - MINI_H - 16 - 34)
    const wx = world.x + (lx - mt.ox) / mt.s, wy = world.y + (ly - mt.oy) / mt.s
    const z = camRef.current.z
    const target = { x: wx - W / 2 / z, y: wy - H / 2 / z, z }
    animate ? flyTo(target, 400) : setCam(target)
  }
  const vr = viewportRect(cam, W, H)
  const vrMini = { left: mt.ox + (vr.x - world.x) * mt.s, top: mt.oy + (vr.y - world.y) * mt.s, width: vr.w * mt.s, height: vr.h * mt.s }

  // ── overlays ──
  const overlays: ReactElement[] = []
  if (selection.length && selection.length <= 300 && !editing) {
    for (const s of selection) {
      if (s.type === 'arrow') continue
      const a = toScreen(cam, s.x, s.y)
      overlays.push(<div key={`o${s.id}`} style={{ position: 'absolute', left: a.x - 1, top: a.y - 1, width: s.w * cam.z + 2, height: s.h * cam.z + 2, borderWidth: 1, borderColor: ACCENT, pointerEvents: 'none', borderRadius: 2 }} />)
    }
    if (selBox && !(selection.length === 1 && selection[0]!.type === 'arrow')) {
      const a = toScreen(cam, selBox.x, selBox.y)
      const w = selBox.w * cam.z, h = selBox.h * cam.z
      overlays.push(<div key="selbox" style={{ position: 'absolute', left: a.x - 1, top: a.y - 1, width: w + 2, height: h + 2, borderWidth: 1.5, borderColor: ACCENT, pointerEvents: 'none' }} />)
      const pts = [[0, 0], [w / 2, 0], [w, 0], [w, h / 2], [w, h], [w / 2, h], [0, h], [0, h / 2]]
      pts.forEach(([hx, hy], i) => overlays.push(<div key={`h${i}`} style={{ position: 'absolute', left: a.x + hx! - 4.5, top: a.y + hy! - 4.5, width: 9, height: 9, backgroundColor: '#fff', borderWidth: 1.5, borderColor: ACCENT, borderRadius: 2, pointerEvents: 'none' }} />))
    }
    if (selection.length === 1 && selection[0]!.type === 'arrow') {
      const { p0, p1 } = arrowEnds(selection[0]!, byId)
      for (const [i, p] of [p0, p1].entries()) {
        const s = toScreen(cam, p.x, p.y)
        overlays.push(<div key={`ae${i}`} style={{ position: 'absolute', left: s.x - 5, top: s.y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff', borderWidth: 1.5, borderColor: ACCENT, pointerEvents: 'none' }} />)
      }
    }
  }
  if (bindHover && byId.get(bindHover)) {
    const s = byId.get(bindHover)!
    const a = toScreen(cam, s.x, s.y)
    overlays.push(<div key="bind" style={{ position: 'absolute', left: a.x - 4, top: a.y - 4, width: s.w * cam.z + 8, height: s.h * cam.z + 8, borderWidth: 2, borderColor: ACCENT, borderRadius: s.type === 'ellipse' ? Math.min(s.w, s.h) * cam.z : 10, pointerEvents: 'none', backgroundColor: '#0a84ff10' }} />)
  }
  for (const [i, g] of guides.entries()) {
    const a = g.axis === 'x' ? toScreen(cam, g.pos, g.from) : toScreen(cam, g.from, g.pos)
    const len = (g.to - g.from) * cam.z
    overlays.push(<div key={`g${i}`} style={{ position: 'absolute', left: a.x - (g.axis === 'x' ? 0.5 : 0), top: a.y - (g.axis === 'y' ? 0.5 : 0), width: g.axis === 'x' ? 1 : len, height: g.axis === 'y' ? 1 : len, backgroundColor: '#ff375f', pointerEvents: 'none' }} />)
  }
  if (marquee) {
    const a = toScreen(cam, marquee.x, marquee.y)
    overlays.push(<div key="marquee" style={{ position: 'absolute', left: a.x, top: a.y, width: marquee.w * cam.z, height: marquee.h * cam.z, backgroundColor: '#0a84ff14', borderWidth: 1, borderColor: ACCENT, pointerEvents: 'none' }} />)
  }

  let editor: ReactElement | null = null
  const editShape = editing ? byId.get(editing) : undefined
  if (editShape) {
    const a = toScreen(cam, editShape.x, editShape.y)
    const z = cam.z
    const sticky = editShape.type === 'sticky'
    editor = (
      <textarea
        autoFocus
        value={draft}
        placeholder={sticky ? 'Type a note' : 'Text'}
        onChange={(ev) => setDraft(ev.value ?? '')}
        style={{
          position: 'absolute', left: a.x + (sticky ? 14 * z : 0), top: a.y + (sticky ? 14 * z : 0),
          width: sticky ? (STICKY - 28) * z : Math.max(240, editShape.w * z + 120), height: sticky ? (STICKY - 28) * z : Math.max(40, editShape.h * z + 30),
          fontSize: (sticky ? 17 : 24) * z, lineHeight: (sticky ? 23 : 30) * z, fontWeight: sticky ? 400 : 600, fontFamily: FONT,
          color: sticky ? '#2b2b2b' : PALETTE[editShape.color].stroke, backgroundColor: '#00000000', borderWidth: 0,
        }}
      />
    )
  }

  const total = shapes.length
  const zoomPct = Math.round(cam.z * 100)
  const cursor = tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair'
  const hasStress = shapes.some((s) => s.stress)

  return (
    <div ref={rootRef as never} testId="app" tabIndex={-1} autoFocus onKeyDown={onKeyDown} style={{ position: 'relative', width: W, height: H, backgroundColor: CANVAS_BG, overflow: 'hidden' }}>
      <div
        testId="canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onScroll={onScroll}
        onFileDrop={onFileDrop}
        style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, cursor }}
      >
        <BoardView shapes={shapes} index={index} byId={byId} culled={culled} cam={cam} width={W} height={H} version={version.current.n} tiles={tiles} editingId={editing} />
        {ghost ? <ShapeNode s={ghost} cam={cam} ends={ghost.type === 'arrow' ? arrowEnds(ghost, byId) : undefined} /> : null}
        {overlays}
        {editor}
      </div>

      {/* title + file */}
      <div style={{ ...PANEL, position: 'absolute', left: 84, top: 10, height: 36, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 4, gap: 2 }}>
        <text style={{ color: INK, fontSize: 13, fontWeight: 600, fontFamily: FONT }}>{savePath ? basename(savePath, '.json') : 'Untitled board'}</text>
        <div style={{ width: 1, height: 18, backgroundColor: '#00000014', marginLeft: 8, marginRight: 4 }} />
        <IconButton icon="open" title="Open (⌘O)" onClick={open} testId="open" />
        <IconButton icon="save" title="Save (⌘S)" onClick={save} testId="save" />
        <IconButton icon="export" title="Export PNG (⌘E)" onClick={exportPng} testId="export" />
      </div>

      {/* tools */}
      <div style={{ position: 'absolute', left: 0, top: 10, width: W, display: 'flex', flexDirection: 'row', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ ...PANEL, display: 'flex', flexDirection: 'row', alignItems: 'center', padding: 5, gap: 2, pointerEvents: 'auto' }}>
          {TOOLS.map((t) => (
            <ToolButton key={t.tool} icon={t.icon} label={t.key} active={tool === t.tool} testId={`tool-${t.tool}`} onClick={() => { setTool(t.tool); if (t.tool !== 'select') setSelected([]); focusRoot() }} />
          ))}
          <div style={{ width: 1, height: 22, backgroundColor: '#00000014', marginLeft: 4, marginRight: 4 }} />
          <ToolButton icon="image" label="" active={false} testId="tool-image" onClick={pickImage} />
        </div>
      </div>

      {/* undo + stress */}
      <div style={{ ...PANEL, position: 'absolute', right: 12, top: 10, height: 36, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 4, paddingRight: 4, gap: 2 }}>
        <IconButton icon="undo" title="Undo (⌘Z)" onClick={undo} testId="undo" />
        <IconButton icon="redo" title="Redo (⇧⌘Z)" onClick={redo} testId="redo" />
        <div style={{ width: 1, height: 18, backgroundColor: '#00000014', marginLeft: 4, marginRight: 4 }} />
        <div testId="stress" onClick={toggleStress} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingLeft: 10, paddingRight: 12, borderRadius: 8, backgroundColor: hasStress ? '#fff1e6' : INK, cursor: 'pointer', hover: { opacity: 0.88 } }}>
          <svg source={ICONS.stress} style={{ width: 14, height: 14, color: hasStress ? '#f2760b' : '#ffffff' }} />
          <text style={{ color: hasStress ? '#c25e08' : '#ffffff', fontSize: 12.5, fontWeight: 600, fontFamily: FONT }}>{hasStress ? 'Clear 10k' : 'Stress 10k'}</text>
        </div>
      </div>

      {/* style panel */}
      {selection.length > 0 && !editing ? (
        <div style={{ ...PANEL, position: 'absolute', left: 12, top: 64, width: 148, display: 'flex', flexDirection: 'column', padding: 10, gap: 10 }}>
          <text style={{ color: MUTED, fontSize: 11, fontWeight: 600, fontFamily: FONT }}>{selection.length === 1 ? selection[0]!.type.toUpperCase() : `${selection.length} SELECTED`}</text>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {COLOR_KEYS.map((c) => (
              <div key={c} testId={`color-${c}`} onClick={() => recolor(c)} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: PALETTE[c].stroke, borderWidth: 2, borderColor: selection.every((s) => s.color === c) ? '#ffffff' : PALETTE[c].stroke, outlineWidth: selection.every((s) => s.color === c) ? 2 : 0, outlineColor: PALETTE[c].stroke, cursor: 'pointer' }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 2 }}>
            <IconButton icon="front" title="Bring to front (])" onClick={() => reorder(true)} testId="front" />
            <IconButton icon="back" title="Send to back ([)" onClick={() => reorder(false)} testId="back" />
            <IconButton icon="duplicate" title="Duplicate (⌘D)" onClick={() => paste(selection)} testId="duplicate" />
            <IconButton icon="trash" title="Delete" onClick={deleteSelected} testId="delete" />
          </div>
        </div>
      ) : null}

      {/* zoom */}
      <div style={{ ...PANEL, position: 'absolute', left: 12, bottom: 12, height: 36, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 4, paddingRight: 4, gap: 2 }}>
        <IconButton icon="minus" title="Zoom out" onClick={() => zoomBy(0.8)} testId="zoom-out" />
        <div testId="zoom-reset" onClick={() => setCam((c) => zoomAt(c, 1, W / 2, H / 2))} style={{ width: 52, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', hover: { backgroundColor: '#0000000a' } }}>
          <text testId="zoom-label" style={{ color: INK, fontSize: 12.5, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap' }}>{`${zoomPct}%`}</text>
        </div>
        <IconButton icon="plus" title="Zoom in" onClick={() => zoomBy(1.25)} testId="zoom-in" />
        <IconButton icon="fit" title="Zoom to fit (⇧1)" onClick={() => fitRect(unionRect(shapesRef.current))} testId="fit" />
      </div>

      {/* minimap + stats */}
      <div style={{ ...PANEL, position: 'absolute', right: 12, bottom: 12, width: MINI_W + 8, display: 'flex', flexDirection: 'column', padding: 4, gap: 0, overflow: 'hidden' }}>
        <div
          testId="minimap"
          onMouseDown={(e) => { miniDrag.current = true; miniJump(e, true) }}
          onMouseMove={(e) => { if (miniDrag.current) miniJump(e, false) }}
          onMouseUp={() => { miniDrag.current = false }}
          style={{ position: 'relative', width: MINI_W, height: MINI_H, borderRadius: 8, backgroundColor: '#f3f3f2', overflow: 'hidden', cursor: 'pointer' }}
        >
          <img ref={miniRef} objectFit="fill" style={{ position: 'absolute', left: 0, top: 0, width: MINI_W, height: MINI_H, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', ...vrMini, borderWidth: 1.5, borderColor: ACCENT, backgroundColor: '#0a84ff12', borderRadius: 2, pointerEvents: 'none' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 30, paddingLeft: 6, paddingRight: 6 }}>
          <text testId="stats" style={{ color: INK, fontSize: 11.5, fontWeight: 500, fontFamily: FONT }}>{`${total.toLocaleString()} total · ${culled.painted.toLocaleString()} painted`}</text>
          <text style={{ color: MUTED, fontSize: 11, fontFamily: FONT }}>{`${culled.mode === 'tiles' ? 'tiles' : 'nodes'} · ${fps} fps`}</text>
        </div>
      </div>

      {toast ? (
        <div style={{ position: 'absolute', left: 0, bottom: 64, width: W, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ backgroundColor: '#1d1d1fe6', borderRadius: 10, paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8 }}>
            <text testId="toast" style={{ color: '#ffffff', fontSize: 12.5, fontWeight: 500, fontFamily: FONT }}>{toast}</text>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ToolButton({ icon, label, active, onClick, testId }: { icon: IconName; label: string; active: boolean; onClick: () => void; testId: string }) {
  return (
    <div testId={testId} onClick={onClick} style={{ position: 'relative', width: 36, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: active ? ACCENT : '#00000000', cursor: 'pointer', hover: { backgroundColor: active ? ACCENT : '#0000000a' } }}>
      <svg source={ICONS[icon]} style={{ width: 18, height: 18, color: active ? '#ffffff' : INK }} />
      {label ? <text style={{ position: 'absolute', right: 3, bottom: 1, color: active ? '#ffffffb0' : '#86868b', fontSize: 8.5, fontWeight: 600, fontFamily: FONT }}>{label}</text> : null}
    </div>
  )
}

function IconButton({ icon, title, onClick, testId }: { icon: IconName; title: string; onClick: () => void; testId: string }) {
  return (
    <div testId={testId} onClick={onClick} style={{ width: 30, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', hover: { backgroundColor: '#0000000a' } }}>
      <svg source={ICONS[icon]} style={{ width: 16, height: 16, color: INK }} />
    </div>
  )
}

export { MAX_Z }
