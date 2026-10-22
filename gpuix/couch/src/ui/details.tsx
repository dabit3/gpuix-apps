import { useApp, T, useArt, Pill, ProgressBar, Scrims, metaLine } from './kit.tsx'
import type { View } from '../controller.ts'
import { codecLabel, channelLabel, fmtDuration, resolutionLabel, type Item } from '../library/model.ts'
import { seasonsOf } from '../rows.ts'
import { progressOf } from '../state.ts'
import { alpha } from '../theme.ts'
import { sizes } from './browse.tsx'

function EpisodeRow({ ep, idx, focused, width }: { ep: Item; idx: number; focused: boolean; width: number }) {
  const { ctl, theme } = useApp()
  const thumb = useArt(ep, 'thumb')
  const tw = width < 700 ? 128 : 160
  const prog = progressOf(ctl.prof, ep.id)
  const watched = !!ctl.prof?.watched[ep.id]
  return (
    <div
      onMouseEnter={() => ctl.hoverEpisode(idx)}
      onClick={() => ctl.play(ep.id)}
      style={{ display: 'flex', flexDirection: 'row', gap: 16, padding: 8, borderRadius: 10, cursor: 'pointer', backgroundColor: focused ? alpha(theme.fg, 0.08) : 'transparent', borderWidth: 2, borderColor: focused ? theme.focus : 'transparent' }}
    >
      <div style={{ position: 'relative', width: tw, height: Math.round(tw * 9 / 16), borderRadius: 7, overflow: 'hidden', backgroundColor: theme.panel, flexShrink: 0, pointerEvents: 'none' }}>
        {thumb ? <img src={thumb} objectFit="cover" style={{ width: tw, height: Math.round(tw * 9 / 16), pointerEvents: 'none' }} /> : null}
        {prog ? <div style={{ position: 'absolute', left: 6, right: 6, bottom: 6, pointerEvents: 'none' }}><ProgressBar value={prog} theme={theme} height={3} /></div> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <T color={focused ? theme.fg : theme.dim} size={15} weight={600} lines={1}>{`${ep.episode}. ${ep.title}`}</T>
          {watched ? <T color={theme.good} size={13} weight={700}>✓</T> : null}
        </div>
        <T color={theme.faint} size={13}>{[fmtDuration(ep.probe?.duration), ep.year].filter(Boolean).join('  ·  ')}</T>
        {width > 640 ? <T color={theme.dim} size={13} lines={2}>{ep.summary}</T> : null}
      </div>
    </div>
  )
}

export function Details({ view, width, height }: { view: View; width: number; height: number }) {
  const { ctl, theme } = useApp()
  const it = ctl.item(view.detailsId)
  const backdrop = useArt(it, 'backdrop', true)
  const poster = useArt(it, 'poster', true)
  if (!it) return null
  const { pad } = sizes(width, height)
  const narrow = width < 860
  const pw = narrow ? 0 : Math.round(Math.max(150, Math.min(230, height * 0.3)))
  const isShow = it.kind === 'show'
  const actions = ctl.detailsActions()
  const target = isShow ? undefined : it
  const prog = target ? progressOf(ctl.prof, target.id) : 0
  const p = target?.probe
  const badges = p ? [resolutionLabel(p), codecLabel(p.vcodec), [codecLabel(p.acodec), channelLabel(p.channels)].filter(Boolean).join(' '), p.container.toUpperCase().replace('MOV', 'MOV')].filter(Boolean) : []
  const seasons = isShow ? seasonsOf(ctl.lib, it) : []
  const eps = ctl.episodesInSeason()
  const epH = (width < 700 ? 72 : 90) + 20
  const listTop = Math.max(0, view.episodeIdx - 1)
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
      {backdrop ? <img src={backdrop} objectFit="cover" style={{ position: 'absolute', left: 0, top: 0, width, height }} /> : null}
      <div style={{ position: 'absolute', left: 0, top: 0, width, height, backgroundColor: alpha(theme.bg, 0.72), pointerEvents: 'none' }} />
      <Scrims theme={theme} side={0.85} />
      <div style={{ position: 'absolute', left: pad, right: pad, top: 64, bottom: 20, display: 'flex', flexDirection: 'row', gap: 34 }}>
        {pw ? (
          <div style={{ width: pw, height: pw * 1.5, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.panel, flexShrink: 0, boxShadow: { offsetX: 0, offsetY: 16, blurRadius: 40, spreadRadius: 0, color: alpha('#000000', 0.6) } }}>
            {poster ? <img src={poster} objectFit="cover" style={{ width: pw, height: pw * 1.5 }} /> : null}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexGrow: 1, minWidth: 0, maxWidth: isShow ? 900 : 680 }}>
          <T color={theme.fg} size={narrow ? 28 : 40} weight={700} lines={2}>{it.title}</T>
          <T color={theme.dim} size={15} weight={500}>{metaLine(ctl, it)}</T>
          {badges.length ? <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{badges.map((b) => <Pill key={b} color={theme.fg} border={alpha(theme.fg, 0.35)}>{b}</Pill>)}</div> : null}
          {prog ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}><div style={{ width: 200 }}><ProgressBar value={prog} theme={theme} /></div><T color={theme.dim} size={13}>{`${Math.max(1, Math.round((1 - prog) * (p?.duration ?? 0) / 60))} min left`}</T></div> : null}
          <div style={{ display: 'flex', flexDirection: 'row', gap: 10, marginTop: 4 }}>
            {actions.map((a, i) => {
              const f = view.detailsZone === 'actions' && view.actionIdx === i
              const primary = i === 0
              return (
                <div key={a} onMouseEnter={() => ctl.hoverAction(i)} onClick={() => ctl.runAction(a)} style={{
                  display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 18, paddingRight: 20, borderRadius: 8, cursor: 'pointer',
                  backgroundColor: f ? theme.focus : primary ? alpha(theme.fg, 0.16) : alpha(theme.fg, 0.08),
                }}>
                  <T color={f ? theme.bg : theme.fg} size={15} weight={700}>{a === 'Watched' ? '✓' : a === 'Restart' ? '↺' : '▶'}</T>
                  <T color={f ? theme.bg : theme.fg} size={15} weight={600}>{a === 'Watched' && isShow ? 'Mark watched' : a === 'Watched' ? 'Watched' : a}</T>
                </div>
              )
            })}
          </div>
          {!isShow || height > 640 ? <T color={theme.dim} size={15} lines={isShow ? 2 : 5}>{it.summary}</T> : null}
          {!isShow ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {it.director ? <T color={theme.faint} size={13}>{`Directed by  ${it.director}`}</T> : null}
              {it.cast.length ? <T color={theme.faint} size={13} lines={1}>{`Starring  ${it.cast.join(', ')}`}</T> : null}
              {it.studio ? <T color={theme.faint} size={13}>{`Studio  ${it.studio}`}</T> : null}
              {it.license ? <T color={theme.faint} size={12}>{it.license}</T> : null}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexGrow: 1, minHeight: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'row', gap: 6, marginTop: 6 }}>
                {seasons.map((s, i) => (
                  <div key={s} onClick={() => ctl.setSeason(i)} style={{ paddingLeft: 12, paddingRight: 12, height: 28, borderRadius: 14, display: 'flex', alignItems: 'center', cursor: 'pointer', backgroundColor: i === view.season ? alpha(theme.fg, 0.16) : 'transparent' }}>
                    <T color={i === view.season ? theme.fg : theme.dim} size={14} weight={600}>{`Season ${s}`}</T>
                  </div>
                ))}
                <div style={{ flexGrow: 1 }} />
                {seasons.length > 1 ? <T color={theme.faint} size={12}>← → season</T> : null}
              </div>
              <div style={{ position: 'relative', flexGrow: 1, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: -listTop * epH, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {eps.map((e, i) => <EpisodeRow key={e} ep={ctl.lib.items[e]!} idx={i} width={width} focused={view.detailsZone === 'episodes' && view.episodeIdx === i} />)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
