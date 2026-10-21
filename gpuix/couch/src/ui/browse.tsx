import { useRef } from 'react'
import { motion } from '@gpuix/react'
import { useApp, T, useArt, ProgressBar, Scrims, metaLine } from './kit.tsx'
import { TABS, type View, type Tab } from '../controller.ts'
import type { Item } from '../library/model.ts'
import { progressOf } from '../state.ts'
import { alpha } from '../theme.ts'

const TAB_LABEL: Record<Tab, string> = { home: 'Home', movies: 'Movies', shows: 'TV Shows' }

export function sizes(width: number, height: number) {
  const pad = width < 900 ? 24 : 44
  const posterW = Math.round(Math.max(92, Math.min(148, width / 9.2, (height - 240) / 3.4)))
  const gap = Math.round(posterW * 0.14)
  return { pad, posterW, posterH: Math.round(posterW * 1.5), landW: Math.round(posterW * 1.9), landH: Math.round(posterW * 1.9 * 9 / 16), gap }
}

export function TopBar({ view, width }: { view: View; width: number }) {
  const { ctl, theme } = useApp()
  const pad = sizes(width, 800).pad
  const now = new Date()
  const clock = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const color = theme.palette[view.profile?.color ?? 4] ?? theme.accent
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 56, paddingLeft: pad, paddingRight: pad, gap: 26 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: theme.focus }} />
        <T color={theme.fg} size={19} weight={700}>couch</T>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
        {TABS.map((t) => {
          const active = view.tab === t
          const focused = active && view.navFocus && view.screen === 'browse'
          return (
            <div key={t} onClick={() => ctl.setTab(t)} style={{
              paddingLeft: 12, paddingRight: 12, height: 30, borderRadius: 15, display: 'flex', alignItems: 'center', cursor: 'pointer',
              backgroundColor: focused ? theme.fg : active ? alpha(theme.fg, 0.12) : 'transparent',
              hover: { backgroundColor: focused ? theme.fg : alpha(theme.fg, 0.08) },
            }}>
              <T color={focused ? theme.bg : active ? theme.fg : theme.dim} size={14} weight={active ? 600 : 500}>{TAB_LABEL[t]}</T>
            </div>
          )
        })}
      </div>
      <div style={{ flexGrow: 1 }} />
      {width > 760 ? <T color={theme.faint} size={13}>{ctl.lib.source === 'plex' ? 'Plex' : ctl.lib.root.replace(process.env.HOME ?? '~', '~')}</T> : null}
      <T color={theme.dim} size={14}>{clock}</T>
      <div onClick={() => ctl.dispatch('back') } style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <T color={theme.bg} size={14} weight={700}>{view.profile?.name.slice(0, 1) ?? '?'}</T>
      </div>
    </div>
  )
}

/** Shrinks the poster title so its longest word never breaks mid-word. */
export function posterTitleSize(title: string, w: number): number {
  const longest = Math.max(...title.toUpperCase().split(/\s+/).map((x) => x.length))
  return Math.max(9, Math.min(Math.round(w / 9.5), Math.floor((w - 22) / (longest * 0.72))))
}

export function Tile(props: { item: Item; shape: 'poster' | 'landscape'; w: number; h: number; focused: boolean; progress?: number; watched?: boolean; caption?: string; sub?: string; onHover?: () => void; onClick?: () => void }) {
  const { theme, ctl } = useApp()
  const { item, shape, w, h, focused } = props
  const artItem = shape === 'poster' && item.kind === 'episode' ? ctl.item(item.showId) ?? item : item
  const src = useArt(artItem, shape === 'poster' ? 'poster' : item.kind === 'episode' ? 'thumb' : 'backdrop')
  const r = Math.round(w * 0.06)
  return (
    <div onMouseEnter={props.onHover} onClick={props.onClick} style={{ display: 'flex', flexDirection: 'column', width: w, gap: 8, cursor: 'pointer', flexShrink: 0 }}>
      <div style={{
        position: 'relative', width: w, height: h, borderRadius: r, backgroundColor: theme.panel, overflow: 'hidden',
        borderWidth: 3, borderColor: focused ? theme.focus : 'transparent',
        boxShadow: focused ? { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: alpha(theme.focus, 0.28) } : undefined,
      }}>
        {src ? <img src={src} objectFit="cover" style={{ position: 'absolute', left: 0, top: 0, width: w - 6, height: h - 6, borderRadius: r - 3 }} /> : (
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}>
            <T color={theme.faint} size={13} weight={600}>{artItem.title}</T>
          </div>
        )}
        {shape === 'poster' ? <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.round(h * 0.4), pointerEvents: 'none', background: { type: 'linear-gradient', angle: 0, stops: [{ color: alpha('#000000', 0.78), position: 0 }, { color: alpha('#000000', 0), position: 1 }] } }} /> : null}
        {shape === 'poster' ? (
          <div style={{ position: 'absolute', left: 9, right: 9, bottom: 8, pointerEvents: 'none' }}>
            <T color="#ffffff" size={posterTitleSize(artItem.title, w)} weight={700} lines={2}>{artItem.title.toUpperCase()}</T>
          </div>
        ) : null}
        {props.watched ? (
          <div style={{ position: 'absolute', right: 7, top: 7, width: 20, height: 20, borderRadius: 10, backgroundColor: theme.good, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <T color={theme.bg} size={12} weight={800}>✓</T>
          </div>
        ) : null}
        {props.progress ? (
          <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, pointerEvents: 'none' }}>
            <ProgressBar value={props.progress} theme={theme} />
          </div>
        ) : null}
      </div>
      {props.caption ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, height: props.sub ? 38 : 20, overflow: 'hidden' }}>
          <T color={focused ? theme.fg : theme.dim} size={13} weight={focused ? 600 : 500} lines={1}>{props.caption}</T>
          {props.sub ? <T color={theme.faint} size={12} lines={1}>{props.sub}</T> : null}
        </div>
      ) : null}
    </div>
  )
}

function Hero({ item, width, height }: { item: Item | undefined; width: number; height: number }) {
  const { theme, ctl } = useApp()
  const top = item?.kind === 'episode' ? ctl.item(item.showId) ?? item : item
  const backdrop = useArt(top, 'backdrop', true)
  const { pad } = sizes(width, height)
  const prog = item ? progressOf(ctl.prof, item.id) : 0
  const ep = item?.kind === 'episode' ? `S${item.season} · E${item.episode}  ${item.title}` : undefined
  const bw = Math.round(width * 0.68)
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
      {backdrop ? <img src={backdrop} objectFit="cover" style={{ position: 'absolute', right: 0, top: 0, width: bw, height }} /> : null}
      {backdrop ? (
        <div style={{ position: 'absolute', right: 0, top: 0, width: bw, height }}>
          <Scrims theme={theme} side={0.75} />
        </div>
      ) : null}
      {top ? (
        <div style={{ position: 'absolute', left: pad, top: Math.round(height * 0.12), width: Math.min(560, Math.round(width * 0.5)), display: 'flex', flexDirection: 'column', gap: 10 }}>
          <T color={theme.fg} size={Math.round(Math.max(24, Math.min(44, width / 30)))} weight={700} lines={2}>{top.title}</T>
          <T color={theme.dim} size={14} weight={500}>{metaLine(ctl, top)}</T>
          {ep ? <T color={theme.fg} size={14} weight={600}>{ep}</T> : null}
          {height > 230 ? <T color={theme.dim} size={14} lines={height > 300 ? 3 : 2}>{(item?.kind === 'episode' && item.summary) || top.summary}</T> : null}
          {prog ? <div style={{ width: 220, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}><div style={{ width: 160 }}><ProgressBar value={prog} theme={theme} /></div><T color={theme.dim} size={12}>{Math.round((1 - prog) * (item!.probe?.duration ?? 0) / 60)} min left</T></div> : null}
        </div>
      ) : null}
    </div>
  )
}

export function Home({ view, width, height }: { view: View; width: number; height: number }) {
  const { ctl, theme } = useApp()
  const sz = sizes(width, height)
  const starts = useRef(new Map<string, number>())
  const wheel = useRef({ acc: 0, accX: 0 })
  const heroH = Math.round(Math.max(170, Math.min(380, height * 0.42)))
  const focused = ctl.focusedId()
  const rows = ctl.rows
  const rowH = (shape: 'poster' | 'landscape') => 32 + (shape === 'poster' ? sz.posterH : sz.landH) + (shape === 'poster' ? 28 : 46) + 14
  let offset = 0
  for (let i = 0; i < view.row && i < rows.length; i++) offset += rowH(rows[i]!.shape)
  const areaH = height - heroH
  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
      <Hero item={ctl.item(focused)} width={width} height={heroH + 40} />
      <div
        onScroll={(e) => {
          const w = wheel.current
          w.acc += e.deltaY ?? 0
          w.accX += e.deltaX ?? 0
          const unit = e.precise ? 60 : 1
          if (Math.abs(w.acc) >= unit) { ctl.setPointer(false); ctl.dispatch(w.acc > 0 ? 'up' : 'down', 'mouse'); w.acc = 0; ctl.setPointer(true) }
          if (Math.abs(w.accX) >= unit) { ctl.setPointer(false); ctl.dispatch(w.accX > 0 ? 'left' : 'right', 'mouse'); w.accX = 0; ctl.setPointer(true) }
        }}
        style={{ position: 'absolute', left: 0, top: heroH, width, height: areaH, overflow: 'hidden' }}
      >
        <motion.div initial={false} animate={{ top: -offset }} transition={{ duration: 0.22, ease: 'easeOut' }} style={{ position: 'absolute', left: 0, width, display: 'flex', flexDirection: 'column' }}>
          {rows.map((row, ri) => {
            const near = Math.abs(ri - view.row) <= 2
            const w = row.shape === 'poster' ? sz.posterW : sz.landW
            const h = row.shape === 'poster' ? sz.posterH : sz.landH
            const step = w + sz.gap
            const fit = Math.max(1, Math.floor((width - sz.pad * 2 + sz.gap) / step))
            const col = ctl.colOf(row)
            let start = starts.current.get(row.key) ?? 0
            if (col < start) start = col
            if (col >= start + fit) start = col - fit + 1
            start = Math.max(0, Math.min(start, Math.max(0, row.ids.length - fit)))
            starts.current.set(row.key, start)
            const active = ri === view.row && !view.navFocus
            return (
              <div key={row.key} style={{ display: 'flex', flexDirection: 'column', height: rowH(row.shape), opacity: ri < view.row ? 0 : 1 }}>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: sz.pad, height: 32 }}>
                  <T color={active ? theme.fg : theme.dim} size={17} weight={650}>{row.title}</T>
                  {active ? <T color={theme.faint} size={13}>{`${col + 1} / ${row.ids.length}`}</T> : null}
                </div>
                <div style={{ position: 'relative', height: h + 50, width, overflow: 'hidden' }}>
                  {near ? (
                    <motion.div initial={false} animate={{ left: sz.pad - start * step }} transition={{ duration: 0.2, ease: 'easeOut' }} style={{ position: 'absolute', top: 2, display: 'flex', flexDirection: 'row', gap: sz.gap }}>
                      {row.ids.map((id, ci) => {
                        if (ci < start - 2 || ci > start + fit + 2) return <div key={id} style={{ width: w, height: h, flexShrink: 0 }} />
                        const it = ctl.lib.items[id]!
                        const isEp = it.kind === 'episode'
                        const show = isEp ? ctl.item(it.showId) : undefined
                        return (
                          <Tile
                            key={id} item={it} shape={row.shape} w={w} h={h}
                            focused={active && ci === col}
                            progress={row.key === 'continue' ? progressOf(ctl.prof, id) : undefined}
                            watched={it.kind !== 'show' && !!ctl.prof?.watched[id]}
                            caption={row.shape === 'landscape' ? (show ? show.title : it.title) : it.title}
                            sub={row.shape === 'landscape' ? (isEp ? `S${it.season} · E${it.episode}  ${it.title}` : `${Math.round((1 - progressOf(ctl.prof, id)) * (it.probe?.duration ?? 0) / 60)} min left`) : undefined}
                            onHover={() => ctl.hoverRow(ri, ci)}
                            onClick={() => { ctl.hoverRow(ri, ci); ctl.dispatch('ok', 'mouse') }}
                          />
                        )
                      })}
                    </motion.div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}

export function Grid({ view, width, height }: { view: View; width: number; height: number }) {
  const { ctl, theme } = useApp()
  const sz = sizes(width, height)
  const ids = ctl.gridIds()
  const cols = Math.max(2, Math.floor((width - sz.pad * 2 + sz.gap) / (sz.posterW + sz.gap)))
  if (cols !== view.gridCols) queueMicrotask(() => ctl.setGridCols(cols))
  const idx = view.grid[view.tab]
  const cellH = sz.posterH + 28 + 18
  const visRows = Math.max(1, Math.floor((height - 60) / cellH))
  const row = Math.floor(idx / cols)
  const firstRow = Math.max(0, row - visRows + 1)
  const wheel = useRef(0)
  return (
    <div
      onScroll={(e) => {
        wheel.current += e.deltaY ?? 0
        const unit = e.precise ? 60 : 1
        if (Math.abs(wheel.current) >= unit) { ctl.setPointer(false); ctl.dispatch(wheel.current > 0 ? 'up' : 'down', 'mouse'); wheel.current = 0; ctl.setPointer(true) }
      }}
      style={{ position: 'relative', width, height, overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingLeft: sz.pad, height: 52, paddingTop: 10 }}>
        <T color={theme.fg} size={26} weight={700}>{view.tab === 'shows' ? 'TV Shows' : 'Movies'}</T>
        <T color={theme.faint} size={14}>{`${ids.length} titles`}</T>
      </div>
      <div style={{ position: 'absolute', top: 62, left: 0, width, height: height - 62, overflow: 'hidden' }}>
        <motion.div initial={false} animate={{ top: -firstRow * cellH }} transition={{ duration: 0.2, ease: 'easeOut' }} style={{ position: 'absolute', left: sz.pad, width: width - sz.pad * 2, display: 'flex', flexDirection: 'row', flexWrap: 'wrap', columnGap: sz.gap, rowGap: 18 }}>
          {ids.map((id, i) => {
            const it = ctl.lib.items[id]!
            const watched = it.kind === 'show' ? (it.episodes ?? []).every((e) => ctl.prof?.watched[e]) : !!ctl.prof?.watched[id]
            return (
              <Tile key={id} item={it} shape="poster" w={sz.posterW} h={sz.posterH} focused={!view.navFocus && i === idx}
                watched={watched} caption={it.year ? `${it.title} · ${it.year}` : it.title}
                onHover={() => ctl.hoverGrid(i)} onClick={() => ctl.open(id)} />
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}
