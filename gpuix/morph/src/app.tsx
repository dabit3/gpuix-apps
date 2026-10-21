import { useLayoutEffect, useRef, useState } from 'react'
import { render, useGpuixRequired, useWindowSize } from '@gpuix/react'
import { Controller, timecode, type KeyLike } from './controller'
import { registerGeist } from './fonts'
import { icon } from './icons'
import { computeLayout } from './layout'
import { FRAMES_PER_BEAT, LAST_FRAME, STATE_LABEL, TOTAL_BEATS, TOTAL_FRAMES, segments } from './lib/beats'
import { mixColor, withAlpha } from './lib/color'
import { makePalette, type Palette } from './lib/palette'
import { sceneAt } from './scene'
import { FONT, Stage } from './stage'
import type { TerminalTheme } from './theme'

const SEGS = segments()
const SHORT: Record<string, string> = { button: 'Button', loader: 'Load', check: 'Done', island: 'Island', player: 'Player', scrubber: 'Scrub', volume: 'Volume', toggle: 'Toggle', tabs: 'Tabs', chart: 'Chart', palette: 'Palette' }

interface Chrome { bg: string; fg: string; dim: string; faint: string; line: string; panel: string; accent: string }
const chromeFor = (t: TerminalTheme): Chrome => ({
  bg: t.bg, fg: t.fg, dim: mixColor(t.bg, t.fg, 0.58), faint: mixColor(t.bg, t.fg, 0.3), line: mixColor(t.bg, t.fg, 0.14), panel: mixColor(t.bg, t.fg, 0.05), accent: '#ff4d00',
})

function Txt({ c, size = 13, weight = 400, children, testId }: { c: string; size?: number; weight?: number; children: React.ReactNode; testId?: string }) {
  return <text testId={testId} style={{ color: c, fontSize: size, fontWeight: weight, fontFamily: FONT, whiteSpace: 'nowrap' }}>{children}</text>
}

function Chip({ label, k, ch, onClick, testId, active = false }: { label: string; k: string; ch: Chrome; onClick: () => void; testId: string; active?: boolean }) {
  return (
    <div testId={testId} onClick={onClick} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingLeft: 10, paddingRight: 8, borderRadius: 8, backgroundColor: active ? withAlpha(ch.accent, 0.16) : ch.panel, borderWidth: 1, borderColor: active ? withAlpha(ch.accent, 0.5) : ch.line, cursor: 'pointer', hover: { backgroundColor: mixColor(ch.bg, ch.fg, 0.1) } }}>
      <Txt c={active ? ch.fg : ch.fg} size={12} weight={500}>{label}</Txt>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 18, minWidth: 18, paddingLeft: 4, paddingRight: 4, borderRadius: 4, backgroundColor: ch.line }}>
        <Txt c={ch.dim} size={10} weight={600}>{k}</Txt>
      </div>
    </div>
  )
}

export function App({ controller, theme, autoTick = true, size: fixed }: { controller: Controller; theme: TerminalTheme; autoTick?: boolean; size?: { width: number; height: number } }) {
  const c = controller
  const live = useWindowSize()
  const size = fixed ?? live
  const [, bump] = useState(0)
  const renderer = useGpuixRequired()
  const fonts = useRef(false)
  if (!fonts.current) { registerGeist(renderer); fonts.current = true }
  c.onChange = () => bump((n) => n + 1)

  useLayoutEffect(() => {
    if (!autoTick) return
    let prev = performance.now(), alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (!alive) return
      const now = performance.now()
      const was = c.shown
      c.advance(Math.min(100, now - prev))
      prev = now
      if (c.shown !== was || c.exp.status === 'running') bump((n) => n + 1)
      timer = setTimeout(tick, Math.max(1, 16.667 - (performance.now() - now)))
    }
    timer = setTimeout(tick, 16)
    return () => { alive = false; clearTimeout(timer) }
  }, [c, autoTick])

  const ch = chromeFor(theme)
  const pal: Palette = makePalette(c.palette, theme.bg, theme.fg)
  const L = computeLayout(size.width, size.height, c.aspect)
  const f = c.shown
  const scene = sceneAt(f, pal)
  const { tl } = L
  const fx = (frame: number) => tl.trackX + (frame / LAST_FRAME) * tl.trackW
  const frameAtX = (x: number) => Math.round(((x - tl.trackX) / tl.trackW) * LAST_FRAME)
  const scrubTo = (x: number) => { c.seek(frameAtX(x)); bump((n) => n + 1) }
  const onWheel = (e: { deltaY?: number; deltaX?: number }) => {
    const d = (e.deltaY ?? 0) || (e.deltaX ?? 0)
    if (!d) return
    c.step(d > 0 ? 1 : -1)
    bump((n) => n + 1)
  }
  const exp = c.exp
  const expLabel = exp.status === 'running' ? `Exporting ${Math.round((exp.done / exp.total) * 100)}%` : exp.status === 'done' ? 'Exported' : exp.status === 'error' ? 'Export failed' : 'Export MP4'

  return (
    <div testId="app-root" style={{ position: 'relative', width: size.width, height: size.height, backgroundColor: ch.bg, overflow: 'hidden', userSelect: 'none' }}>
      {/* top bar */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: size.width, height: L.top.h, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: L.narrow ? 14 : 22, paddingRight: L.narrow ? 14 : 22 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 18, height: 12, borderRadius: 6, backgroundColor: ch.accent }} />
          <Txt c={ch.fg} size={15} weight={600}>morph</Txt>
          {L.narrow ? null : <Txt c={ch.dim} size={13}>one shape that never cuts</Txt>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Chip testId="chip-theme" ch={ch} k="T" label={c.palette === 'dark' ? (L.narrow ? 'Dark' : 'Terminal') : (L.narrow ? 'Light' : '#EDEBE8')} onClick={() => { c.togglePalette(); bump((n) => n + 1) }} />
          <Chip testId="chip-aspect" ch={ch} k="V" label={c.aspect === 'square' ? '1:1' : '4:5'} onClick={() => { c.toggleAspect(); bump((n) => n + 1) }} />
          <div testId="export-button" onClick={() => c.onExport?.()} style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 8, backgroundColor: exp.status === 'running' ? ch.panel : ch.fg, overflow: 'hidden', cursor: 'pointer' }}>
            {exp.status === 'running' ? <div style={{ position: 'absolute', left: 0, top: 0, width: `${(exp.done / exp.total) * 100}%`, height: 28, backgroundColor: withAlpha(ch.accent, 0.35), pointerEvents: 'none' }} /> : null}
            <svg source={icon('export', exp.status === 'running' ? ch.fg : ch.bg)} style={{ width: 15, height: 15, color: exp.status === 'running' ? ch.fg : ch.bg }} />
            <Txt testId="export-label" c={exp.status === 'running' ? ch.fg : ch.bg} size={12} weight={600}>{L.narrow && exp.status !== 'running' ? 'Export' : expLabel}</Txt>
          </div>
        </div>
      </div>

      {/* artboard */}
      <div testId="artboard" onClick={() => { c.toggle(); bump((n) => n + 1) }} onScroll={onWheel} style={{ position: 'absolute', left: L.art.x, top: L.art.y, width: L.art.w, height: L.art.h, borderRadius: 14, borderWidth: 1, borderColor: ch.line, overflow: 'hidden', cursor: 'pointer' }}>
        <Stage scene={scene} pal={pal} width={L.art.w} height={L.art.h} />
      </div>

      {/* timeline */}
      <div style={{ position: 'absolute', left: tl.x, top: tl.y, width: tl.w, height: tl.h, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: 0, top: tl.trackY - tl.y - 18, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <div testId="play-button" onClick={() => { c.toggle(); bump((n) => n + 1) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 18, backgroundColor: ch.fg, cursor: 'pointer', pointerEvents: 'auto' }}>
            <svg source={icon(c.playing ? 'pause' : 'play', ch.bg, !c.playing)} style={{ width: 16, height: 16, color: ch.bg }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Txt testId="timecode" c={ch.fg} size={14} weight={600}>{timecode(f)}</Txt>
            <Txt testId="frame-readout" c={ch.dim} size={11}>{`frame ${String(f).padStart(3, '0')} / ${LAST_FRAME}`}</Txt>
          </div>
        </div>
      </div>
      {/* segments: one block per state, labelled when wide */}
      {SEGS.map((s, i) => {
        const x0 = fx(s.start), x1 = fx(Math.min(LAST_FRAME, s.end))
        const on = f >= s.start && f < s.end
        return (
          <div key={i} style={{ position: 'absolute', left: x0 + 1, top: tl.trackY - (tl.labels ? 30 : 12), width: Math.max(1, x1 - x0 - 2), height: tl.labels ? 22 : 6, borderRadius: 5, backgroundColor: on ? withAlpha(ch.accent, 0.2) : ch.panel, borderWidth: 1, borderColor: on ? withAlpha(ch.accent, 0.6) : ch.line, overflow: 'hidden', display: 'flex', alignItems: 'center', paddingLeft: 6, pointerEvents: 'none' }}>
            {tl.labels && x1 - x0 > 34 ? <Txt c={on ? ch.fg : ch.dim} size={11} weight={on ? 600 : 400}>{SHORT[s.state]}</Txt> : null}
          </div>
        )
      })}
      {/* beat ticks */}
      {Array.from({ length: TOTAL_BEATS + 1 }, (_, b) => (
        <div key={`b${b}`} style={{ position: 'absolute', left: fx(Math.min(LAST_FRAME, b * FRAMES_PER_BEAT)), top: tl.trackY + 2, width: 1, height: b % 4 === 0 ? 14 : 8, backgroundColor: b <= Math.floor(f / FRAMES_PER_BEAT) ? ch.dim : ch.faint, pointerEvents: 'none' }} />
      ))}
      {c.hoverFrame != null && !c.scrubbing ? (
        <div style={{ position: 'absolute', left: fx(c.hoverFrame) - 26, top: tl.trackY + 20, width: 52, height: 18, borderRadius: 4, backgroundColor: ch.line, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Txt c={ch.fg} size={10} weight={500}>{`f ${c.hoverFrame}`}</Txt>
        </div>
      ) : null}
      {/* playhead */}
      <div testId="playhead" style={{ position: 'absolute', left: fx(f) - 1, top: tl.trackY - (tl.labels ? 36 : 18), width: 2, height: tl.labels ? 56 : 38, borderRadius: 1, backgroundColor: ch.accent, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: fx(f) - 6, top: tl.trackY - (tl.labels ? 40 : 22), width: 12, height: 12, borderRadius: 6, backgroundColor: ch.accent, pointerEvents: 'none' }} />
      {/* the scrub hit area: owns down+move+up so the drag captures the pointer */}
      <div
        testId="timeline"
        onMouseDown={(e) => { c.scrubbing = true; c.playing = false; scrubTo(e.x ?? 0) }}
        onMouseMove={(e) => {
          if (c.scrubbing && e.pressedButton != null) scrubTo(e.x ?? 0)
          else { const h = Math.min(LAST_FRAME, Math.max(0, frameAtX(e.x ?? 0))); if (h !== c.hoverFrame) { c.hoverFrame = h; bump((n) => n + 1) } }
        }}
        onMouseUp={() => { c.scrubbing = false; bump((n) => n + 1) }}
        onMouseLeave={() => { c.hoverFrame = null; bump((n) => n + 1) }}
        onScroll={onWheel}
        style={{ position: 'absolute', left: tl.trackX - 8, top: tl.trackY - (tl.labels ? 40 : 24), width: tl.trackW + 16, height: tl.labels ? 64 : 46, cursor: 'pointer' }}
      />
      {/* right readout */}
      {tl.labels ? (
        <div style={{ position: 'absolute', left: tl.trackX + tl.trackW + 24, top: tl.trackY - 22, display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
          <Txt testId="state-readout" c={ch.fg} size={13} weight={600}>{STATE_LABEL[scene.state]}</Txt>
          <Txt testId="beat-readout" c={ch.dim} size={11}>{`beat ${String(c.beat + 1).padStart(2, '0')}/${TOTAL_BEATS} · 120 BPM`}</Txt>
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: tl.x, top: size.height - 20, width: tl.w, display: 'flex', flexDirection: 'row', justifyContent: 'center', pointerEvents: 'none' }}>
        <Txt c={ch.faint} size={10}>{L.narrow ? 'space play · ←→ frame · ↑↓ beat' : 'space play/pause · ← → frame · ↑ ↓ beat · drag or scroll to scrub · T palette · V 4:5 · E export · ctrl-c quit'}</Txt>
      </div>
    </div>
  )
}

export function keyHandlers(c: Controller) {
  return { onKeyDown: (e: KeyLike) => { c.keyDown(e) } }
}

export function start(c: Controller, theme: TerminalTheme, opts: { terminal: boolean }) {
  render(<App controller={c} theme={theme} />, { terminal: opts.terminal, title: 'morph', width: 1280, height: 900, ...keyHandlers(c) } as never)
}
export { TOTAL_FRAMES }
