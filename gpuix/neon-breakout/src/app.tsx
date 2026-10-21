import { writeFileSync } from 'node:fs'
import { useLayoutEffect, useRef, useState } from 'react'
import { render, useGpuixRequired } from '@gpuix/react'
import { Controller, type KeyLike } from './controller'
import { pilotTarget } from './sim/autopilot'
import { STEP_HZ } from './sim/constants'
import { Field } from './ui/Field'
import { Overlay } from './ui/Overlays'
import { Sidebar } from './ui/Sidebar'
import { COLORS, FIELD_H, FIELD_W, FIELD_X, FIELD_Y, glow, ICONS, INK, SIDE_X, WIN_H, WIN_W } from './ui/theme'

interface PerfStats { fps: number; frameMs: number; p95Ms: number; drawMs: number | null; drawP90: number | null; steps: number; rss: number; nodes: number }

class PerfMeter {
  private stamps: number[] = []
  private steps: number[] = []
  stats: PerfStats = { fps: 0, frameMs: 0, p95Ms: 0, drawMs: null, drawP90: null, steps: 0, rss: 0, nodes: 0 }
  private lastPublish = 0
  sample(now: number, steps: number, draw: { currentMs?: number; p90Ms?: number } | null | undefined) {
    this.stamps.push(now)
    this.steps.push(steps)
    while (this.stamps.length > 2 && now - this.stamps[0]! > 1000) { this.stamps.shift(); this.steps.shift() }
    if (now - this.lastPublish < 250 || this.stamps.length < 3) return
    this.lastPublish = now
    const gaps = this.stamps.slice(1).map((t, i) => t - this.stamps[i]!)
    const span = this.stamps[this.stamps.length - 1]! - this.stamps[0]!
    const sorted = gaps.slice().sort((a, b) => a - b)
    this.stats = {
      fps: (gaps.length * 1000) / span,
      frameMs: span / gaps.length,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      drawMs: draw?.currentMs ?? null,
      drawP90: draw?.p90Ms ?? null,
      steps: Math.round((this.steps.slice(1).reduce((s, n) => s + n, 0) * 1000) / span),
      rss: process.memoryUsage().rss / 1e6,
      nodes: 0,
    }
  }
}

function PerfHud({ s, c }: { s: PerfStats; c: Controller }) {
  const g = c.game
  const nodes = g.bricks.filter((b) => b.alive).length * 3 + g.particles.length + g.balls.length * 7 + 140
  const row = (k: string, v: string, color: string = INK.text) => (
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
      <text style={{ fontSize: 11, color: INK.dim }}>{k}</text>
      <text style={{ fontSize: 11, fontWeight: 700, color }}>{v}</text>
    </div>
  )
  return (
    <div testId="perf-hud" style={{ position: 'absolute', left: FIELD_X + FIELD_W - 214, top: FIELD_Y + 360, width: 200, padding: 12, borderRadius: 12, backgroundColor: '#05070dcc', borderWidth: 1, borderColor: COLORS.teal + '55', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <text style={{ fontSize: 10, fontWeight: 800, color: COLORS.teal }}>PERF · PARAVIRTUAL METAL</text>
      {row('fps', s.fps.toFixed(1), s.fps >= 55 ? COLORS.mint : s.fps >= 40 ? COLORS.amber : COLORS.pink)}
      {row('frame', `${s.frameMs.toFixed(1)} ms`)}
      {row('frame p95', `${s.p95Ms.toFixed(1)} ms`)}
      {row('gpui draw', s.drawMs == null ? 'n/a' : `${s.drawMs.toFixed(1)} ms`)}
      {row('draw p90', s.drawP90 == null ? 'n/a' : `${s.drawP90.toFixed(1)} ms`)}
      {row('sim steps/s', `${s.steps} / ${STEP_HZ}`)}
      {row('elements', `~${nodes}`)}
      {row('particles', `${g.particles.length}`)}
      {row('rss', `${s.rss.toFixed(0)} MB`)}
    </div>
  )
}

export function App({ controller, autoTick = true }: { controller: Controller; autoTick?: boolean }) {
  const c = controller
  const [, setFrame] = useState(0)
  const renderer = useGpuixRequired() as { getDebugFrameOverlayStats?: () => { currentMs?: number; p90Ms?: number } | null }
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
      if (telemetry) {
        const g = c.game
        writeFileSync(telemetry, `${c.mode} ${g.phase} ${pilotTarget(g).toFixed(1)} ${g.paddleX.toFixed(1)} ${g.laserTimer > 0 ? 1 : 0} ${g.lives} ${c.frame}\n`)
      }
      if (c.frame === 2 && process.env.NEON_COLD_START === '1') {
        console.log(`first-frame ${performance.now().toFixed(0)} ms after process start`)
        process.exit(0)
      }
      meter.current.sample(now, steps, c.showPerf ? renderer.getDebugFrameOverlayStats?.() : null)
      setFrame(c.frame)
      // Aim each frame at the next 60 Hz boundary instead of a fixed delay.
      timer = setTimeout(tick, Math.max(1, 16.667 - (performance.now() - now)))
    }
    timer = setTimeout(tick, 16)
    return () => { alive = false; clearTimeout(timer) }
  }, [c, autoTick])

  const playing = c.mode === 'playing'
  return (
    <div
      testId="app-root"
      style={{ width: WIN_W, height: WIN_H, backgroundColor: INK.bg, position: 'relative', cursor: playing ? 'none' : 'default' } as never}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, width: WIN_W, height: 46, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 92, paddingRight: 24, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.teal, boxShadow: [glow(COLORS.teal, 8, 'cc')] }} />
          <text style={{ fontSize: 13, fontWeight: 700, color: INK.text }}>Neon Breakout</text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <text style={{ fontSize: 11, color: INK.faint }}>{c.autopilot ? 'AUTOPILOT · ' : ''}120 Hz fixed-step · GPUIX 0.11 · Metal</text>
          <div testId="sound-toggle" onClick={() => c.toggleSound()} style={{ cursor: 'pointer', padding: 4, borderRadius: 6 }}>
            <svg source={c.audio.muted ? ICONS.mute : ICONS.sound} style={{ width: 15, height: 15, color: c.audio.muted ? INK.faint : COLORS.teal }} />
          </div>
        </div>
      </div>
      <div
        testId="field"
        style={{ position: 'absolute', left: FIELD_X, top: FIELD_Y, width: FIELD_W, height: FIELD_H, borderRadius: 18, overflow: 'hidden', backgroundColor: '#04060b', borderWidth: 1, borderColor: '#2ee6d626', boxShadow: [glow(COLORS.teal, 40, '14'), { offsetX: 0, offsetY: 20, blurRadius: 50, spreadRadius: 0, color: '#000000aa' }] }}
      >
        <Field c={c} />
        {/* Topmost unfilled layer: positioned, painted children would eat the field's pointer events. Down + move together arm window-level capture. */}
        <div
          testId="pointer-pad"
          onMouseDown={() => c.primary()}
          onMouseMove={(e) => { if (process.env.NEON_DEBUG_MOUSE) console.log('move', e.x, e.y); c.pointer((e.x ?? 0) - FIELD_X) }}
          onMouseUp={() => {}}
          style={{ position: 'absolute', left: 0, top: 0, width: FIELD_W, height: FIELD_H }}
        />
        <Overlay c={c} />
      </div>
      <div style={{ position: 'absolute', left: SIDE_X, top: FIELD_Y, height: FIELD_H }}>
        <Sidebar c={c} />
      </div>
      {c.showPerf && c.mode === 'playing' ? <PerfHud s={meter.current.stats} c={c} /> : null}
    </div>
  )
}

export function keyHandlers(c: Controller) {
  return {
    onKeyDown: (e: KeyLike) => { if (process.env.NEON_DEBUG_KEYS) console.log('key', JSON.stringify(e.key)); c.keyDown(e) },
    onKeyUp: (e: KeyLike) => { c.keyUp(e) },
  }
}

// Demo capture only: the recorder's input driver reads where a good player would aim.
const telemetry = process.env.NEON_TELEMETRY

const isEntryPoint = typeof Bun !== 'undefined' && (Bun.isStandaloneExecutable || Bun.main === import.meta.path)

if (isEntryPoint) {
  const controller = new Controller({ muted: process.env.NEON_MUTE === '1', autopilot: process.env.NEON_AUTOPILOT === '1' })
  if (process.env.NEON_PERF === '1') controller.showPerf = true
  render(<App controller={controller} />, {
    title: 'Neon Breakout',
    appName: 'Neon Breakout',
    width: WIN_W,
    height: WIN_H,
    resizable: false,
    titlebarTransparent: true,
    trafficLightX: 18,
    trafficLightY: 16,
    focus: process.env.GPUIX_BACKGROUND !== '1',
    debugFrameOverlay: process.env.NEON_OVERLAY === '1' ? 'full' : undefined,
    ...keyHandlers(controller),
  })
}
