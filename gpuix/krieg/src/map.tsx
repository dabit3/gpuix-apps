// `krieg map`: a second GPUIX app for a split pane. It regenerates the same level from the seed and follows
// the running game through the live snapshot: player, view cone, enemy AI states and line of sight.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWindowSize, type ImgInstance } from '@gpuix/react'
import { existsSync, readFileSync } from 'node:fs'
import { EMPTY, MH, MW, generateLevel, lineOfSight, type Level } from './gen/level'
import { buildMaterials } from './gen/materials'
import type { Texture } from './gen/texops'
import { LIVE, type Live } from './live'
import { MONO, T } from './theme'

const STATE_COLOR: Record<string, number> = { idle: 0x7a828e, patrol: 0x71b7ff, chase: 0xf0b72f, attack: 0xff6a5a }
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

export function MapApp({ seed }: { seed: number }) {
  const size = useWindowSize()
  const img = useRef<ImgInstance>(null)
  const [live, setLive] = useState<Live | null>(null)
  const lv = useRef<{ seed: number; level: Level; mats: Texture[] } | null>(null)
  const [sel, setSel] = useState(-1)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const id = setInterval(() => {
      try { if (existsSync(LIVE)) setLive(JSON.parse(readFileSync(LIVE, 'utf8'))) } catch {}
    }, 100)
    return () => clearInterval(id)
  }, [])

  const s = live?.seed ?? seed
  if (!lv.current || lv.current.seed !== s) lv.current = { seed: s, level: generateLevel(s), mats: lv.current?.mats ?? buildMaterials(32) }
  const panel = size.width > 620 ? 250 : 0
  const mw = size.width - panel, mh = size.height
  const cell = Math.max(2, Math.floor(Math.min(mw / MW, mh / MH) * zoom))

  useLayoutEffect(() => {
    const { level: L, mats } = lv.current!
    const W = MW * cell, H = MH * cell
    const u = new Uint32Array(W * H)
    const put = (x: number, y: number, c: number) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < W && y < H) u[y * W + x] = 0xff000000 | c }
    const disc = (cx: number, cy: number, r: number, c: number) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) put(cx + x, cy + y, c) }
    const line = (x0: number, y0: number, x1: number, y1: number, c: number) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= n; i++) put(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c) }
    u.fill(0xff0a0c10)
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = y * MW + x, v = L.cells[i]!, d = L.doorAt[i]!
      let c = 0x12161c
      if (d >= 0) { const door = L.doors[d]!, o = live?.d[d] ?? 0; c = door.locked ? (o > 0.5 ? 0x5a4410 : 0xf0b72f) : o > 0.5 ? 0x1c3a2a : 0x26cd4d }
      else if (v !== EMPTY) { const a = mats[v]!.avg; c = ((((a >> 16) & 255) * 0.55) << 16) | ((((a >> 8) & 255) * 0.55) << 8) | ((a & 255) * 0.55) }
      for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) {
        const edge = v === EMPTY && d < 0 && (xx === 0 || yy === 0) && cell > 5
        put(x * cell + xx, y * cell + yy, edge ? 0x161b22 : c)
      }
    }
    L.pickups.forEach((k, i) => { if (!live?.k[i]) disc(k.x * cell, k.y * cell, Math.max(1, cell / 5), k.kind === 'key' ? 0xf0b72f : k.kind === 'health' ? 0xff9492 : 0x39c5cf) })
    disc(L.exit.x * cell, L.exit.y * cell, Math.max(2, cell / 2.5), 0x26cd4d)
    if (live) {
      const [px, py, pa] = live.p
      for (let k = -20; k <= 20; k++) { const a = pa + (k / 20) * 0.52; line(px * cell, py * cell, (px + Math.cos(a) * 5) * cell, (py + Math.sin(a) * 5) * cell, 0x1f3a5c) }
      live.e.forEach(([x, y, , st], i) => {
        if (st === 'dead') return
        if ((st === 'chase' || st === 'attack') && lineOfSight(L, x, y, px, py)) line(x * cell, y * cell, px * cell, py * cell, i === sel ? 0xffffff : 0x6a2a24)
      })
      live.q.forEach(([x, y, k]) => disc(x * cell, y * cell, Math.max(1, cell / 6), k === 'ebolt' ? 0xff6a5a : 0xffb757))
      live.e.forEach(([x, y, kind, st], i) => {
        if (st === 'dead') { put(x * cell, y * cell, 0x3a3f46); return }
        const r = Math.max(2, Math.round(cell / (kind === 'sentry' ? 2.6 : 3.2)))
        disc(x * cell, y * cell, r + (i === sel ? 2 : 0), i === sel ? 0xffffff : 0x0a0c10)
        disc(x * cell, y * cell, r, STATE_COLOR[st] ?? 0xffffff)
      })
      disc(px * cell, py * cell, Math.max(2, cell / 2.5), 0xf0f3f6)
      line(px * cell, py * cell, (px + Math.cos(pa) * 1.2) * cell, (py + Math.sin(pa) * 1.2) * cell, 0xf0f3f6)
    }
    img.current?.setImagePixels(W, H, new Uint8Array(u.buffer), { format: 'bgra' })
  }, [live, cell, sel, s])

  const counts: Record<string, number> = { idle: 0, patrol: 0, chase: 0, attack: 0, dead: 0 }
  live?.e.forEach((e) => { counts[e[3]] = (counts[e[3]] ?? 0) + 1 })
  const stale = !live || Date.now() - live.t > 2000
  const onMouseDown = (e: any) => {
    if (!live) return
    const ox = (mw - MW * cell) / 2, oy = (mh - MH * cell) / 2
    const wx = (e.x - ox) / cell, wy = (e.y - oy) / cell
    let best = -1, bd = 1.2
    live.e.forEach(([x, y, , st], i) => { const d = Math.hypot(x - wx, y - wy); if (st !== 'dead' && d < bd) { bd = d; best = i } })
    setSel(best)
  }
  const se = live && sel >= 0 ? live.e[sel] : null
  return (
    <div tabIndex={-1} autoFocus onKeyDown={(e: any) => { const k = (e.keyChar || e.key || '').toLowerCase(); if (k === '+' || k === '=') setZoom((z) => Math.min(2, z + 0.25)); if (k === '-') setZoom((z) => Math.max(0.5, z - 0.25)) }}
      onScroll={(e: any) => setZoom((z) => Math.max(0.5, Math.min(2, z - Math.sign(e.deltaY) * 0.1)))}
      style={{ width: size.width, height: size.height, backgroundColor: T.bg, display: 'flex', fontFamily: MONO, userSelect: 'none' }}>
      <div onMouseDown={onMouseDown} style={{ width: mw, height: mh, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <img ref={img} objectFit="fill" style={{ width: MW * cell, height: MH * cell }} />
      </div>
      {panel > 0 && (
        <div style={{ width: panel, height: mh, display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderLeftWidth: 1, borderColor: T.line, backgroundColor: '#0d1117' }}>
          <text style={{ color: T.fg, fontSize: 16, fontWeight: 700 }}>{`krieg map`}</text>
          <text style={{ color: stale ? T.mute : T.green, fontSize: 12 }}>{stale ? `waiting for krieg…` : `● live  seed ${s}`}</text>
          {live && <text style={{ color: T.dim, fontSize: 12 }}>{`hp ${live.hp}  kills ${live.kills}  ${live.key ? 'key ■' : 'key □'}`}</text>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
            <text style={{ color: T.mute, fontSize: 11 }}>{`ENEMY AI`}</text>
            {(['idle', 'patrol', 'chase', 'attack', 'dead'] as const).map((k) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: k === 'dead' ? '#3a3f46' : hex(STATE_COLOR[k]!) }} />
                <text style={{ color: T.fg, fontSize: 13, width: 70 }}>{k}</text>
                <text style={{ color: T.dim, fontSize: 13 }}>{`${counts[k] ?? 0}`}</text>
              </div>
            ))}
          </div>
          {se && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8 }}>
              <text style={{ color: T.mute, fontSize: 11 }}>{`SELECTED #${sel}`}</text>
              <text style={{ color: T.fg, fontSize: 13 }}>{`${se[2]} · ${se[3]}`}</text>
              <text style={{ color: T.dim, fontSize: 12 }}>{`hp ${Math.round(se[4] * 100)}%  at ${se[0].toFixed(1)}, ${se[1].toFixed(1)}`}</text>
            </div>
          )}
          <text style={{ color: T.mute, fontSize: 11, paddingTop: 8 }}>{`click enemy to inspect · scroll zoom`}</text>
        </div>
      )}
    </div>
  )
}
