import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useLayoutEffect, useRef, useState } from 'react'
import { render, useWindowSize, type ImgInstance } from '@gpuix/react'
import { normKey, type KeyLike } from '../src/keys'
import { alpha, type Theme } from '../src/theme'
import { Game, type Input } from './engine'
import { FB, H, W, upscale } from './fb'
import { ModLoader } from './modloader'

export interface GameOpts { profile: string | null; seed?: number; autopilot?: boolean; give?: string; spawn?: string; logName?: string }

export class GameController {
  game: Game
  loader: ModLoader
  held = new Set<string>()
  autopilot: boolean
  fps = 0
  constructor(public opts: GameOpts) {
    this.game = new Game(opts.seed)
    this.loader = new ModLoader(this.game, opts.profile, { logName: opts.logName })
    this.autopilot = !!opts.autopilot
  }
  async boot() {
    this.game.log('game', `grovekeep 0.3.0 · pid ${process.pid} · profile ${this.opts.profile ?? '(none)'}`)
    await this.loader.loadAll()
    if (this.opts.give) this.game.give(this.opts.give)
    if (this.opts.spawn) this.game.spawn(this.opts.spawn, 4)
  }
  input(): Input {
    if (this.autopilot) return this.game.autopilot()
    const k = this.held
    return { left: k.has('left') || k.has('a'), right: k.has('right') || k.has('d'), up: k.has('up') || k.has('w'), down: k.has('down') || k.has('s'), attack: k.has('space') || k.has('j') || k.has('x') }
  }
  keyDown(e: KeyLike) {
    const k = normKey(e)
    if (!this.held.has(k)) {
      if (k === 'q' || k === 'tab') this.game.cycleWeapon()
      else if (k === 'e') this.game.spawn(this.game.newestEnemy(), 3)
      else if (k === 'p') { this.autopilot = !this.autopilot; this.held.clear() }
      else if (k === 'r') void this.loader.loadAll('reload')
      this.game.key(k)
    }
    this.held.add(k)
  }
  keyUp(e: KeyLike) { this.held.delete(normKey(e)) }
}

const HEART = '♥'

export function GameApp({ c, theme: t, autoTick = true }: { c: GameController; theme: Theme; autoTick?: boolean }) {
  const size = useWindowSize()
  const img = useRef<ImgInstance>(null)
  const fb = useRef(new FB())
  const [, setTick] = useState(0)
  const barH = 30
  const fit = Math.max(1, Math.min((size.width - 8) / W, (size.height - barH - 8) / H))
  const scale = Math.min(5, Math.ceil(fit))
  const dw = Math.floor(W * fit), dh = Math.floor(H * fit)
  const buf = useRef<{ s: number; px: Uint32Array; bytes: Uint8Array } | null>(null)

  useLayoutEffect(() => {
    if (!autoTick) return
    let alive = true, prev = performance.now(), lastPoll = 0, frames = 0, fpsT = prev
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (!alive) return
      const now = performance.now()
      const dt = Math.min(0.05, (now - prev) / 1000)
      prev = now
      c.game.update(dt, c.input())
      if (now - lastPoll > 350) { lastPoll = now; void c.loader.poll() }
      c.game.render(fb.current)
      const s = scaleRef.current
      if (!buf.current || buf.current.s !== s) {
        const bytes = new Uint8Array(W * s * H * s * 4)
        buf.current = { s, bytes, px: new Uint32Array(bytes.buffer) }
      }
      upscale(fb.current, s, buf.current.px)
      img.current?.setImagePixels(W * s, H * s, buf.current.bytes)
      frames++
      if (now - fpsT > 1000) { c.fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now }
      setTick((n) => (n + 1) % 1e6)
      timer = setTimeout(tick, Math.max(1, 16.6 - (performance.now() - now)))
    }
    timer = setTimeout(tick, 16)
    return () => { alive = false; clearTimeout(timer) }
  }, [c, autoTick])
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  const g = c.game
  const weapon = g.weapons.get(g.hero.weapon)?.name ?? g.hero.weapon
  const hudLines = Object.entries(g.hud).flatMap(([, lines]) => lines)
  const mods = c.loader.mods.map((m) => m.manifest.id)
  return (
    <div style={{ width: size.width, height: size.height, backgroundColor: t.bg, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ height: barH, width: dw, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <text style={{ color: t.good, fontSize: 13, fontWeight: 800 }}>GROVEKEEP</text>
        <text testId="hearts" style={{ color: t.bad, fontSize: 14 }}>{HEART.repeat(Math.max(0, g.hero.hp))}<text style={{ color: t.line, fontSize: 14 }}>{HEART.repeat(Math.max(0, 5 - g.hero.hp))}</text></text>
        <text testId="kills" style={{ color: t.fg, fontSize: 13 }}>{`${g.kills} slain`}</text>
        <text testId="weapon" style={{ color: t.warn, fontSize: 13 }}>{weapon}</text>
        <div style={{ flexGrow: 1 }} />
        {c.autopilot ? <text style={{ color: t.cyan, fontSize: 12 }}>autopilot</text> : null}
        <text testId="mods" style={{ color: mods.length ? t.accent : t.faint, fontSize: 12 }}>{mods.length ? `mods: ${mods.join(', ')}` : 'no mods'}</text>
      </div>
      <div style={{ position: 'relative', width: dw, height: dh }}>
        <img ref={img} objectFit="fill" style={{ width: dw, height: dh, borderRadius: 6 }} />
        {hudLines.length ? (
          <div testId="mod-hud" style={{ position: 'absolute', right: 10, top: 10, padding: 10, borderRadius: 8, backgroundColor: alpha(t.bg, 0.82), borderWidth: 1, borderColor: alpha(t.accent, 0.5), display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
            {hudLines.map((l, i) => <text key={i} style={{ color: i === 0 ? t.accent : t.fg, fontSize: 12, fontWeight: i === 0 ? 700 : 400 }}>{l}</text>)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export async function startGame(opts: GameOpts, theme: Theme, terminal: boolean) {
  const c = new GameController(opts)
  await c.boot()
  const pidFile = opts.profile ? join(opts.profile, 'game.json') : null
  if (pidFile) writeFileSync(pidFile, JSON.stringify({ pid: process.pid, started: Date.now() }))
  process.on('exit', () => { if (pidFile && existsSync(pidFile)) rmSync(pidFile) })
  render(
    <div tabIndex={-1} autoFocus onKeyDown={(e: KeyLike) => c.keyDown(e)} onKeyUp={(e: KeyLike) => c.keyUp(e)} style={{ width: '100%', height: '100%' }}>
      <GameApp c={c} theme={theme} />
    </div>,
    { terminal, title: 'Grovekeep', width: 1280, height: 780 } as never,
  )
  return c
}
