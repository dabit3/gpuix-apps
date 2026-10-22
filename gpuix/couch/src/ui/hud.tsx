import { useEffect, useState } from 'react'
import { useGpuix } from '@gpuix/react'
import { useApp, T } from './kit.tsx'
import { alpha } from '../theme.ts'

export interface Metrics { coldStartMs?: number; probeSpawns: number; source: string }

export function Hud({ metrics, width }: { metrics: Metrics; width: number }) {
  const { ctl, theme, art } = useApp()
  const { renderer } = useGpuix()
  const [, tick] = useState(0)
  useEffect(() => {
    try { (renderer as any)?.resetDebugFrameOverlayStats?.() } catch {}
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [renderer])
  let stats: { currentMs?: number; p90Ms?: number; frames?: number } = {}
  try { stats = (renderer as any)?.getDebugFrameOverlayStats?.() ?? {} } catch {}
  const pv = ctl.view.player
  const it = ctl.item(pv?.id)
  const rss = process.memoryUsage().rss / 1048576
  const items = ctl.lib.movies.length + ctl.lib.shows.length
  const eps = Object.values(ctl.lib.items).filter((i) => i.kind === 'episode').length
  const lines: [string, string, string?][] = [
    ['cold start', metrics.coldStartMs ? `${Math.round(metrics.coldStartMs)} ms` : '…', metrics.coldStartMs && metrics.coldStartMs < 3000 ? theme.good : undefined],
    ['library', `${items} titles · ${eps} eps`],
    ['scan', `${ctl.lib.scanMs.toFixed(1)} ms · ffprobe ${metrics.probeSpawns}`],
    ['artwork', `${art.generated} new · ${art.pending} queued`],
    ['paint', stats.currentMs != null ? `${stats.currentMs.toFixed(1)} ms · p90 ${stats.p90Ms?.toFixed(1) ?? '–'}` : '–'],
    ['frames', String(stats.frames ?? 0)],
    ['decode', pv?.playing ? `${ctl.decodeRate.toFixed(1)} / ${(it?.probe?.fps ?? 24).toFixed(0)} fps · ${pv.size.w}×${pv.size.h}` : 'idle'],
    ['ffmpeg', `${ctl.decoderSpawns} plays`],
    ['audio', pv ? pv.audio === 'none' ? 'no output device' : pv.audio : '–'],
    ['memory', `${rss.toFixed(0)} MB rss`],
    ['renderer', metrics.source],
  ]
  return (
    <div style={{ position: 'absolute', right: 16, top: 64, width: Math.min(340, width - 32), padding: 14, borderRadius: 10, backgroundColor: alpha(theme.bg, 0.88), borderWidth: 1, borderColor: theme.line, display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
      <T color={theme.focus} size={12} weight={700} mono>PERF HUD</T>
      {lines.map(([k, v, c]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
          <div style={{ width: 86 }}><T color={theme.faint} size={12} mono>{k}</T></div>
          <T color={c ?? theme.fg} size={12} mono>{v}</T>
        </div>
      ))}
    </div>
  )
}
