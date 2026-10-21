import { writeFileSync } from 'node:fs'
import { useLayoutEffect, useRef, useState } from 'react'
import { isTerminal, render, useGpuixRequired, useWindowSize } from '@gpuix/react'
import { Controller, type KeyLike } from './controller'
import { STEP_HZ } from './sim/game'
import { alpha, type Theme } from './theme'
import { computeLayout } from './ui/layout'
import { Overlay, Particles, Popups, shakeOffset, SidePanels, Well } from './ui/view'

interface PerfStats { fps: number; frameMs: number; drawMs: number | null; steps: number; rss: number }

class PerfMeter {
  private stamps: number[] = []
  private steps: number[] = []
  private last = 0
  stats: PerfStats = { fps: 0, frameMs: 0, drawMs: null, steps: 0, rss: 0 }
  sample(now: number, steps: number, drawMs: number | null) {
    this.stamps.push(now)
    this.steps.push(steps)
    while (this.stamps.length > 2 && now - this.stamps[0]! > 1000) { this.stamps.shift(); this.steps.shift() }
    if (now - this.last < 250 || this.stamps.length < 3) return
    this.last = now
    const span = this.stamps[this.stamps.length - 1]! - this.stamps[0]!
    const n = this.stamps.length - 1
    this.stats = { fps: (n * 1000) / span, frameMs: span / n, drawMs, steps: Math.round((this.steps.slice(1).reduce((a, b) => a + b, 0) * 1000) / span), rss: process.memoryUsage().rss / 1e6 }
  }
}

function PerfHud({ s, t, size, cell }: { s: PerfStats; t: Theme; size: { width: number; height: number }; cell: number }) {
  const row = (k: string, v: string, color = t.fg) => (
    <div key={k} style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
      <text style={{ fontSize: 11, color: t.dim }}>{k}</text>
      <text style={{ fontSize: 11, fontWeight: 700, color }}>{v}</text>
    </div>
  )
  return (
    <div testId="perf-hud" style={{ position: 'absolute', right: 10, top: 10, width: 190, padding: 10, borderRadius: 8, backgroundColor: alpha(t.bg, 0.9), borderWidth: 1, borderColor: t.line, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <text style={{ fontSize: 10, fontWeight: 800, color: t.accent }}>{isTerminal() ? 'PERF · KITTY GRAPHICS' : 'PERF · METAL WINDOW'}</text>
      {row('fps', s.fps.toFixed(1), s.fps >= 50 ? t.good : s.fps >= 35 ? t.warn : t.bad)}
      {row('frame', `${s.frameMs.toFixed(1)} ms`)}
      {row('gpui draw', s.drawMs == null ? 'n/a' : `${s.drawMs.toFixed(1)} ms`)}
      {row('sim steps/s', `${s.steps} / ${STEP_HZ}`)}
      {row('pane', `${Math.round(size.width)}×${Math.round(size.height)}`)}
      {row('cell', `${cell} px`)}
      {row('rss', `${s.rss.toFixed(0)} MB`)}
    </div>
  )
}

export function App({ controller, theme, autoTick = true, size: fixed }: { controller: Controller; theme: Theme; autoTick?: boolean; size?: { width: number; height: number } }) {
  const c = controller
  const t = theme
  const live = useWindowSize()
  const size = fixed ?? live
  const [, setFrame] = useState(0)
  const renderer = useGpuixRequired() as { getDebugFrameOverlayStats?: () => { currentMs?: number } | null }
  const meter = useRef(new PerfMeter())

  useLayoutEffect(() => {
    if (!autoTick) return
    let prev = performance.now()
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (!alive) return
      const now = performance.now()
      const steps = c.advance(Math.min(0.1, (now - prev) / 1000))
      prev = now
      c.frame++
      if (telemetry) writeTelemetry(c)
      meter.current.sample(now, steps, c.showPerf ? renderer.getDebugFrameOverlayStats?.()?.currentMs ?? null : null)
      setFrame(c.frame)
      timer = setTimeout(tick, Math.max(1, 16.667 - (performance.now() - now)))
    }
    timer = setTimeout(tick, 16)
    return () => { alive = false; clearTimeout(timer) }
  }, [c, autoTick])

  paneSize = size
  const L = computeLayout(size.width, size.height)
  const { ox, oy } = shakeOffset(c.game, L.c)
  const shaken = { ...L, bx: L.bx + ox, by: L.by + oy }
  return (
    <div testId="app-root" style={{ width: size.width, height: size.height, backgroundColor: t.bg, position: 'relative', overflow: 'hidden' }}>
      <SidePanels c={c} t={t} L={L} />
      <Well c={c} t={t} L={shaken} />
      <Particles c={c} t={t} L={L} ox={ox} oy={oy} />
      {c.mode === "title" ? null : <Popups c={c} t={t} L={L} ox={ox} oy={oy} />}
      <Overlay c={c} t={t} L={L} />
      {c.showPerf ? <PerfHud s={meter.current.stats} t={t} size={size} cell={L.c} /> : null}
    </div>
  )
}

export function keyHandlers(c: Controller) {
  return {
    onKeyDown: (e: KeyLike) => { c.keyDown(e) },
    onKeyUp: (e: KeyLike) => { c.keyUp(e) },
  }
}

// Demo capture only: the recorder's key driver reads the piece and where a good player would put it.
const telemetry = process.env.BLOCKFALL_TELEMETRY
let paneSize = { width: 0, height: 0 }
function writeTelemetry(c: Controller) {
  const g = c.game
  const a = g.active
  const plan = c.hint()
  writeFileSync(telemetry!, JSON.stringify({ mode: c.mode, phase: g.phase, pieces: g.pieces, holdUsed: g.holdUsed, active: a, plan, score: g.score, lines: g.lines, frame: c.frame, w: paneSize.width, h: paneSize.height }) + '\n')
}

export function start(c: Controller, theme: Theme, opts: { terminal: boolean }) {
  render(<App controller={c} theme={theme} />, { terminal: opts.terminal, title: 'blockfall', width: 1100, height: 820, ...keyHandlers(c) } as never)
}
