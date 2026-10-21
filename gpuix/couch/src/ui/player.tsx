import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ImgInstance } from '@gpuix/react'
import { useApp, T } from './kit.tsx'
import type { View } from '../controller.ts'
import { fmtClock } from '../library/model.ts'
import { loadTrickplay, trickFrame, TRICK_H, TRICK_W, type Trickplay } from '../library/art.ts'
import { alpha } from '../theme.ts'

export function Player({ view, width, height }: { view: View; width: number; height: number }) {
  const { ctl, theme } = useApp()
  const pv = view.player!
  const it = ctl.item(pv.id)!
  const show = it.kind === 'episode' ? ctl.item(it.showId) : undefined
  const video = useRef<ImgInstance>(null)
  const preview = useRef<ImgInstance>(null)
  const trick = useRef<Trickplay | undefined>(undefined)
  const [hover, setHover] = useState<number | null>(null)
  const drag = useRef(false)
  const barRef = useRef({ x: 0, w: 1 })

  useLayoutEffect(() => {
    ctl.setFrameSink((frame, size) => video.current?.setImagePixels(size.w, size.h, frame, { format: 'bgra' }))
    return () => ctl.setFrameSink(undefined)
  }, [ctl])

  useEffect(() => {
    let alive = true
    trick.current = undefined
    loadTrickplay(it).then((t) => { if (alive) { trick.current = t; ctl.touched() } })
    return () => { alive = false }
  }, [it.id])

  const scrubSec = pv.scrub ?? hover
  useLayoutEffect(() => {
    if (scrubSec === null || !trick.current || !preview.current) return
    preview.current.setImagePixels(TRICK_W, TRICK_H, trickFrame(trick.current, scrubSec), { format: 'bgra' })
  })

  const pad = width < 900 ? 24 : 48
  const barW = width - pad * 2
  const dur = pv.dur || 1
  const shown = pv.scrub ?? pv.pos
  const frac = Math.max(0, Math.min(1, shown / dur))
  const posFrac = Math.max(0, Math.min(1, pv.pos / dur))
  const tipFrac = scrubSec !== null ? Math.max(0, Math.min(1, scrubSec / dur)) : frac
  const pw = width < 900 ? 160 : 224
  const ph = Math.round(pw * 9 / 16)
  const tipX = Math.max(0, Math.min(barW - pw, tipFrac * barW - pw / 2))
  const osd = pv.osd || pv.scrub !== null || hover !== null || !pv.playing
  const secAt = (x: number) => Math.max(0, Math.min(dur, ((x - barRef.current.x) / barRef.current.w) * dur))

  return (
    <div style={{ position: 'relative', width, height, backgroundColor: '#000000', overflow: 'hidden' }}>
      <img ref={video} objectFit="contain" style={{ position: 'absolute', left: 0, top: 0, width, height }} />
      <div onClick={() => ctl.togglePlay()} style={{ position: 'absolute', left: 0, top: 0, width, height: height - 120 }} />
      {!pv.playing && pv.scrub === null ? (
        <div style={{ position: 'absolute', left: width / 2 - 44, top: height / 2 - 44, width: 88, height: 88, borderRadius: 44, backgroundColor: alpha('#000000', 0.55), display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <T color="#ffffff" size={34} weight={700}>{pv.ended ? '↺' : '❚❚'}</T>
        </div>
      ) : null}
      {osd ? (
        <>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 110, pointerEvents: 'none', background: { type: 'linear-gradient', angle: 180, stops: [{ color: alpha('#000000', 0.75), position: 0 }, { color: alpha('#000000', 0), position: 1 }] } }} />
          <div style={{ position: 'absolute', left: pad, top: 22, display: 'flex', flexDirection: 'column', gap: 2, pointerEvents: 'none' }}>
            <T color="#ffffff" size={20} weight={700}>{show ? show.title : it.title}</T>
            <T color={alpha('#ffffff', 0.7)} size={14}>{show ? `S${it.season} · E${it.episode}  ${it.title}` : [it.year, it.studio].filter(Boolean).join('  ·  ')}</T>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 170, pointerEvents: 'none', background: { type: 'linear-gradient', angle: 0, stops: [{ color: alpha('#000000', 0.85), position: 0 }, { color: alpha('#000000', 0), position: 1 }] } }} />
          {scrubSec !== null && trick.current ? (
            <div style={{ position: 'absolute', left: pad + tipX, bottom: 76, width: pw, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
              <div style={{ width: pw, height: ph, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: '#ffffff', backgroundColor: '#000000' }}>
                <img ref={preview} objectFit="cover" style={{ width: pw - 4, height: ph - 4 }} />
              </div>
              <T color="#ffffff" size={15} weight={700} mono>{fmtClock(scrubSec)}</T>
            </div>
          ) : null}
          <div
            onLayout={(e) => { barRef.current = { x: e.x ?? pad, w: e.width ?? barW } }}
            onMouseMove={(e) => {
              const s = secAt(e.x ?? 0)
              if (drag.current) ctl.scrubTo(s, -1)
              setHover(s)
            }}
            onMouseLeave={() => { if (!drag.current) setHover(null) }}
            onMouseDown={(e) => { drag.current = true; ctl.scrubTo(secAt(e.x ?? 0), -1) }}
            onMouseUp={() => { drag.current = false; ctl.commitScrub(); setHover(null) }}
            style={{ position: 'absolute', left: pad, width: barW, bottom: 44, height: 26, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          >
            <div style={{ position: 'relative', width: barW, height: 6, borderRadius: 3, backgroundColor: alpha('#ffffff', 0.25) }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: 6, width: Math.round(posFrac * barW), borderRadius: 3, backgroundColor: alpha('#ffffff', 0.55) }} />
              <div style={{ position: 'absolute', left: 0, top: 0, height: 6, width: Math.round(frac * barW), borderRadius: 3, backgroundColor: theme.focus }} />
              <div style={{ position: 'absolute', left: Math.round(frac * barW) - 8, top: -5, width: 16, height: 16, borderRadius: 8, backgroundColor: '#ffffff', pointerEvents: 'none' }} />
            </div>
          </div>
          <div style={{ position: 'absolute', left: pad, right: pad, bottom: 16, display: 'flex', flexDirection: 'row', alignItems: 'center', pointerEvents: 'none' }}>
            <T color="#ffffff" size={14} weight={600} mono>{fmtClock(shown)}</T>
            <div style={{ flexGrow: 1, display: 'flex', justifyContent: 'center' }}>
              <T color={alpha('#ffffff', 0.6)} size={13}>{width > 760 ? 'space  play/pause     ← →  scrub 10s     [ ]  30s     esc  back' : '␣ play   ← → scrub   esc back'}</T>
            </div>
            <T color="#ffffff" size={14} weight={600} mono>{`-${fmtClock(Math.max(0, dur - shown))}`}</T>
          </div>
        </>
      ) : null}
    </div>
  )
}
