import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { render, useWindowSize } from '@gpuix/react'
import type { Controller } from './controller.ts'
import type { Theme } from './theme.ts'
import { alpha } from './theme.ts'
import type { ArtQueue } from './library/art.ts'
import { keyToAction, keyToTab } from './keys.ts'
import { AppCtx, T } from './ui/kit.tsx'
import { Profiles } from './ui/profiles.tsx'
import { Grid, Home, TopBar } from './ui/browse.tsx'
import { Details } from './ui/details.tsx'
import { Player } from './ui/player.tsx'
import { Hud, type Metrics } from './ui/hud.tsx'

export interface AppProps { ctl: Controller; theme: Theme; art: ArtQueue; metrics: Metrics; size?: { width: number; height: number }; onFirstPaint?: () => void }

export function App({ ctl, theme, art, metrics, size, onFirstPaint }: AppProps) {
  const view = useSyncExternalStore(ctl.subscribe, ctl.getView)
  const win = useWindowSize()
  const width = size?.width ?? win.width
  const height = size?.height ?? win.height
  const [artVersion, setArtVersion] = useState(0)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    art.onChange = () => { if (!t) t = setTimeout(() => { t = undefined; setArtVersion((v) => v + 1) }, 120) }
    return () => { art.onChange = undefined; clearTimeout(t) }
  }, [art])
  useLayoutEffect(() => { onFirstPaint?.() }, [])
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!view.toast) return
    const id = setTimeout(() => setNow((n) => n + 1), 2600)
    return () => clearTimeout(id)
  }, [view.toast])
  const ctx = useMemo(() => ({ ctl, theme, art, artVersion }), [ctl, theme, art, artVersion])
  const showToast = view.toast && Date.now() - view.toast.at < 2500
  const bodyH = height - 56
  return (
    <AppCtx.Provider value={ctx}>
      <div
        tabIndex={-1}
        autoFocus
        onKeyDown={(e) => {
          if (process.env.COUCH_KEYLOG) process.stderr.write(JSON.stringify({ key: e.key, keyChar: e.keyChar, held: e.isHeld }) + '\n')
          const tab = keyToTab(e)
          if (tab && ctl.view.screen === 'browse') { ctl.setPointer(false); ctl.setTab(tab); return }
          const a = keyToAction(e)
          if (a) { ctl.setPointer(false); ctl.dispatch(a) }
        }}
        onMouseMove={() => ctl.setPointer(true)}
        style={{ position: 'relative', width, height, backgroundColor: view.screen === 'player' ? '#000000' : theme.bg, overflow: 'hidden' }}
      >
        {view.screen === 'profiles' ? <Profiles view={view} width={width} height={height} /> : null}
        {view.screen === 'browse' ? (
          <div style={{ display: 'flex', flexDirection: 'column', width, height }}>
            <div style={{ position: 'absolute', left: 0, top: 56, width, height: bodyH }}>
              {view.tab === 'home' ? <Home view={view} width={width} height={bodyH} /> : <Grid view={view} width={width} height={bodyH} />}
            </div>
            <div style={{ position: 'absolute', left: 0, top: 0, width, background: { type: 'linear-gradient', angle: 180, stops: [{ color: alpha(theme.bg, 0.92), position: 0 }, { color: alpha(theme.bg, 0), position: 1 }] } }}>
              <TopBar view={view} width={width} />
            </div>
          </div>
        ) : null}
        {view.screen === 'details' ? (
          <>
            <Details view={view} width={width} height={height} />
            <div style={{ position: 'absolute', left: 0, top: 0, width }}><TopBar view={view} width={width} /></div>
          </>
        ) : null}
        {view.screen === 'player' && view.player ? <Player view={view} width={width} height={height} /> : null}
        {showToast ? (
          <div style={{ position: 'absolute', left: Math.round(width / 2 - 170), width: 340, bottom: 28, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ paddingLeft: 18, paddingRight: 18, height: 38, borderRadius: 19, backgroundColor: theme.fg, display: 'flex', alignItems: 'center' }}>
              <T color={theme.bg} size={14} weight={600}>{view.toast!.text}</T>
            </div>
          </div>
        ) : null}
        {view.hud ? <Hud metrics={metrics} width={width} /> : null}
      </div>
    </AppCtx.Provider>
  )
}

export function start(props: AppProps, opts: { terminal: boolean }) {
  return render(<App {...props} />, { terminal: opts.terminal, title: 'couch', width: 1440, height: 900, backgroundColor: props.theme.bg } as any)
}
