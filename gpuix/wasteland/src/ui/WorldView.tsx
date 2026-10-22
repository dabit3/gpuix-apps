import { useLayoutEffect, useRef, useState } from 'react'
import type { ImgInstance } from '@gpuix/react'
import type { GameState } from '../engine/game'
import { objective, snapToEntity, tickPath } from '../engine/game'
import { createBuffers, pickArt, renderFrame, type FrameBuffers, type View } from '../render/frame'
import { artToTile, tileCenter } from '../render/iso'
import { C } from './theme'

export interface WorldHandle { zoom: number; cineUntil: number; cineTarget: [number, number] | null; fps: number }

export function WorldView({ game, onChange, onTileClick, handle, attract }: {
  game: { current: GameState }
  onChange: () => void
  onTileClick: (x: number, y: number) => void
  handle: { current: WorldHandle }
  attract?: boolean
}) {
  const img = useRef<ImgInstance>(null)
  const layout = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const hover = useRef<[number, number] | null>(null)
  const mouse = useRef<[number, number] | null>(null)

  useLayoutEffect(() => {
    if (!size.w || !size.h) return
    const W = Math.max(64, Math.round(size.w)), H = Math.max(64, Math.round(size.h))
    const fb: FrameBuffers = createBuffers(W, H)
    const anim = new Map<string, { x: number; y: number; moving: number }>()
    const s0 = game.current
    let cam: [number, number] = tileCenter(s0.player.x, s0.player.y)
    let lastStep = 0, frames = 0, fpsT = performance.now(), cine = 0
    const view: View = { width: W, height: H, time: 0, cam, zoom: 3, hover: null, anim, shots: [] }
    const tick = () => {
      const s = game.current
      const now = performance.now()
      if (s.path.length && now - lastStep > 105) { lastStep = now; tickPath(s); onChange() }
      const ease = (id: string, x: number, y: number) => {
        let a = anim.get(id)
        if (!a || Math.abs(a.x - x) + Math.abs(a.y - y) > 4) { a = { x, y, moving: 0 }; anim.set(id, a) }
        const dx = x - a.x, dy = y - a.y
        a.x += dx * 0.28; a.y += dy * 0.28
        a.moving = Math.abs(dx) + Math.abs(dy) > 0.04 ? 1 : 0
      }
      ease('player', s.player.x, s.player.y)
      for (const a of s.actors) if (!a.removed) ease(a.id, a.x, a.y)
      for (const n of s.npcs) ease(n.id, n.x, n.y)
      const h = handle.current
      const p = anim.get('player')!
      let target = tileCenter(p.x, p.y)
      if (attract) target = [target[0] + Math.sin(now / 6000) * 220 + 120, target[1] + Math.cos(now / 8000) * 90 - 120]
      let zoom = h.zoom
      const inCine = now < h.cineUntil && !!h.cineTarget
      if (inCine) {
        const [tx, ty] = tileCenter(h.cineTarget![0], h.cineTarget![1])
        target = [(target[0] + tx) / 2, (target[1] + ty) / 2 - 10]
        zoom = Math.min(4, h.zoom + 1)
      }
      cine += ((inCine ? 1 : 0) - cine) * 0.2
      view.cine = cine < 0.02 ? 0 : cine
      const o = objective(s)
      view.objective = o && o.x >= 0 && !attract ? [o.x, o.y] : null
      cam = [cam[0] + (target[0] - cam[0]) * 0.18, cam[1] + (target[1] - cam[1]) * 0.18]
      view.cam = cam; view.zoom = zoom; view.time = now
      if (mouse.current) {
        const art = pickArt(view, mouse.current[0], mouse.current[1])
        if (art) { const t = artToTile(art[0], art[1]); hover.current = snapToEntity(s, t[0], t[1]) } else hover.current = null
      }
      view.hover = hover.current
      view.shots = s.shots.filter((f) => now - f.t < 2600).map((fx) => ({ fx, start: fx.t, dur: fx.byPlayer ? 720 : 260 }))
      renderFrame(s, view, fb)
      img.current?.setImagePixels(W, H, fb.out)
      frames++
      if (now - fpsT > 1000) { h.fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now }
    }
    tick()
    const id = setInterval(tick, 16)
    return () => clearInterval(id)
  }, [size.w, size.h])

  const local = (e: { x?: number; y?: number }): [number, number] => [(e.x ?? 0) - layout.current.x, (e.y ?? 0) - layout.current.y]
  return (
    <div
      testId="world"
      style={{ display: 'flex', flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, backgroundColor: C.bg, overflow: 'hidden', cursor: 'pointer' }}
      onLayout={(e) => {
        layout.current = { x: e.x ?? 0, y: e.y ?? 0, w: e.width ?? 0, h: e.height ?? 0 }
        if (Math.round(e.width ?? 0) !== size.w || Math.round(e.height ?? 0) !== size.h) setSize({ w: Math.round(e.width ?? 0), h: Math.round(e.height ?? 0) })
      }}
      onMouseMove={(e) => { mouse.current = local(e) }}
      onMouseLeave={() => { mouse.current = null; hover.current = null }}
      onClick={(e) => {
        mouse.current = local(e)
        const h = hover.current
        if (h && !attract) onTileClick(h[0], h[1])
      }}
      onScroll={(e) => {
        const dy = e.deltaY ?? 0
        if (Math.abs(dy) < 0.5) return
        handle.current.zoom = Math.max(2, Math.min(4, handle.current.zoom + (dy > 0 ? 1 : -1)))
      }}
    >
      {size.w > 0 && <img ref={img} testId="world-img" objectFit="fill" style={{ width: size.w, height: size.h, pointerEvents: 'none' }} />}
    </div>
  )
}
