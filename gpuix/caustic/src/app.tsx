import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isTerminal, render, useWindowSize } from '@gpuix/react'
import type { EngineStats, FromEngine, Ripple } from './protocol'
import { QUALITY } from './quality'
import { DEFAULT_SETTINGS, type PickKind, type Settings } from './scene'
import type { Source } from './source'
import { alpha, type Theme } from './theme'

export interface KeyLike { key?: string; keyChar?: string | null; modifiers?: { control?: boolean; platform?: boolean; alt?: boolean; shift?: boolean } }

/** Terminal letters can arrive as key "space" with the real character in keyChar; normalize both shapes. */
export function keyName(e: KeyLike) {
  const c = e.keyChar
  if (c && c.length === 1 && c !== ' ') return c.toLowerCase()
  return (e.key ?? '').toLowerCase()
}

export interface AppProps {
  source: Source
  theme: Theme
  initial?: Partial<Settings>
  size?: { width: number; height: number }
  /** Called with ripples this instance drew, so the CLI can share them with other panes. */
  onRipples?: (r: Ripple[]) => void
  peers?: () => number
  shotDir?: string
}

export interface Controls {
  settings: Settings
  set(p: Partial<Settings>): void
  key(e: KeyLike): boolean
}

const BLANK: EngineStats = { fps: 0, simMs: 0, causticsMs: 0, renderMs: 0, frameMs: 0, w: 0, h: 0, sim: 0, photons: 0, caustics: 0, workers: 0, steps: 0, peak: 0 }

export function App({ source, theme: t, initial, size: fixed, onRipples, peers, shotDir = process.cwd() }: AppProps) {
  const live = useWindowSize()
  const size = fixed ?? live
  const img = useRef<{ setImagePixels(w: number, h: number, px: Uint8Array, o?: { format?: 'rgba' | 'bgra' }): void } | null>(null)
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, ...initial })
  const [stats, setStats] = useState<EngineStats>(BLANK)
  const [hover, setHover] = useState<{ hover: PickKind; drag: PickKind | null }>({ hover: 'none', drag: null })
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null)
  const [perf, setPerf] = useState(true)
  const [help, setHelp] = useState(false)
  const [linked, setLinked] = useState(0)
  const frames = useRef(0)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const say = (text: string) => setToast({ text, at: Date.now() })
  const set = (p: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...p }
    settingsRef.current = next
    setSettings(next)
    source.post({ type: 'set', settings: p })
  }

  useLayoutEffect(() => source.subscribe((m: FromEngine) => {
    if (m.type === 'frame') {
      frames.current++
      img.current?.setImagePixels(m.w, m.h, new Uint8Array(m.buf, 0, m.w * m.h * 4), { format: 'bgra' })
    } else if (m.type === 'stats') {
      setStats(m.stats)
      setHover({ hover: m.hover, drag: m.drag })
      if (peers) setLinked(peers())
    } else if (m.type === 'ripples') onRipples?.(m.ripples)
    else if (m.type === 'saved') say(`Saved ${m.path.split('/').pop()}`)
    else if (m.type === 'error') say(m.message.split('\n')[0]!)
  }), [source])

  useLayoutEffect(() => { source.post({ type: 'size', w: Math.round(size.width), h: Math.round(size.height) }) }, [source, size.width, size.height])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2200); return () => clearTimeout(id) }, [toast])

  const uv = (e: { x?: number; y?: number }) => ({ u: ((e.x ?? 0) / size.width) * 2 - 1, v: 1 - ((e.y ?? 0) / size.height) * 2 })
  const pointer = (phase: 'down' | 'move' | 'up') => (e: { x?: number; y?: number; button?: number | null }) => {
    if (phase === 'down' && e.button != null && e.button !== 0) return
    source.post({ type: 'pointer', phase, ...uv(e) })
  }

  const screenshot = () => source.post({ type: 'screenshot', path: join(shotDir, `caustic-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`) })
  const toggle = (k: 'rain' | 'ball' | 'shafts' | 'paused') => set({ [k]: !settingsRef.current[k] })
  const quality = (q: Settings['quality']) => { if (q !== settingsRef.current.quality) { set({ quality: q }); say(q === 'full' ? 'FULL · dispersion + light shafts' : 'LITE · fast path') } }

  controls.current = {
    settings,
    set,
    key(e: KeyLike) {
      const k = keyName(e)
      if (process.env.CAUSTIC_KEYLOG) appendFileSync(process.env.CAUSTIC_KEYLOG, JSON.stringify({ key: e.key, keyChar: e.keyChar, k }) + '\n')
      const s = settingsRef.current
      switch (k) {
        case '1': case 'l': quality('lite'); return true
        case '2': case 'f': quality('full'); return true
        case 'q': quality(s.quality === 'lite' ? 'full' : 'lite'); return true
        case 'r': toggle('rain'); return true
        case 'b': toggle('ball'); return true
        case 'v': toggle('shafts'); return true
        case 'space': case ' ': case 'p': toggle('paused'); return true
        case 's': screenshot(); return true
        case 'c': source.post({ type: 'clear' }); say('Water calmed'); return true
        case 'g': setPerf((x) => !x); return true
        case 'h': case '?': setHelp((x) => !x); return true
        case '[': set({ sunElev: Math.max(30, s.sunElev - 4) }); return true
        case ']': set({ sunElev: Math.min(88, s.sunElev + 4) }); return true
        case ',': set({ sunAz: s.sunAz - 8 }); return true
        case '.': set({ sunAz: s.sunAz + 8 }); return true
        case '-': set({ depth: Math.max(0.45, +(s.depth - 0.1).toFixed(2)) }); say(`Depth ${(settingsRef.current.depth).toFixed(1)} m`); return true
        case '=': case '+': set({ depth: Math.min(1.6, +(s.depth + 0.1).toFixed(2)) }); say(`Depth ${(settingsRef.current.depth).toFixed(1)} m`); return true
        case 'left': source.post({ type: 'orbit', dyaw: 0.12, dpitch: 0 }); return true
        case 'right': source.post({ type: 'orbit', dyaw: -0.12, dpitch: 0 }); return true
        case 'up': source.post({ type: 'orbit', dyaw: 0, dpitch: 0.06 }); return true
        case 'down': source.post({ type: 'orbit', dyaw: 0, dpitch: -0.06 }); return true
        case 'escape': setHelp(false); return true
      }
      return false
    },
  }

  const W = size.width, H = size.height
  const narrow = W < 900
  const tiny = W < 560
  const q = QUALITY[settings.quality]
  const cursor = hover.drag === 'ball' ? 'grabbing' : hover.hover === 'ball' ? 'grab' : hover.hover === 'water' ? 'crosshair' : 'move'
  const fpsColor = stats.fps >= 50 ? t.good : stats.fps >= 30 ? t.warn : t.bad
  const panel = { backgroundColor: alpha(t.bg, 0.78), borderWidth: 1, borderColor: alpha(t.fg, 0.12), borderRadius: 10 }
  const mono = 'Menlo'

  return (
    <div testId="app-root" tabIndex={-1} autoFocus onKeyDown={(e: KeyLike & { stopPropagation?: () => void }) => { if (controls.current?.key(e)) e.stopPropagation?.() }} style={{ width: W, height: H, backgroundColor: t.bg, position: 'relative', overflow: 'hidden', display: 'flex' }}>
      <div
        testId="pool"
        onMouseDown={pointer('down')}
        onMouseMove={pointer('move')}
        onMouseUp={pointer('up')}
        onScroll={(e: { deltaY?: number }) => source.post({ type: 'zoom', f: Math.exp(-(e.deltaY ?? 0) * 0.0025) })}
        style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, cursor, display: 'flex' }}
      >
        <img ref={img as never} objectFit="fill" style={{ width: W, height: H }} />
      </div>

      <div style={{ position: 'absolute', left: 18, top: 14, display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <text style={{ fontSize: 15, fontWeight: 700, color: t.fg }}>CAUSTIC</text>
          <text style={{ fontSize: 15, fontWeight: 300, color: t.accent }}>//</text>
          <text style={{ fontSize: 15, fontWeight: 700, color: t.fg }}>VOLUME</text>
        </div>
        <text testId="subtitle" style={{ fontSize: 11, color: t.dim }}>
          {tiny ? `${q.name.toUpperCase()} · ${q.sim}² sim` : `${q.name.toUpperCase()} · ${q.sim}² wave sim · ${Math.round((q.photons * q.photons * (q.dispersion ? 3 : 1)) / 1000)}k photons · ${q.caustics}² caustics`}
        </text>
        {linked > 0 ? <text testId="linked" style={{ fontSize: 11, color: t.good }}>{`linked · ripples shared with ${linked} other pane${linked > 1 ? 's' : ''}`}</text> : null}
      </div>

      <div style={{ position: 'absolute', right: 14, top: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, maxWidth: narrow ? 300 : 700 }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ ...panel, display: 'flex', flexDirection: 'row', padding: 3, gap: 2 }}>
            {(['lite', 'full'] as const).map((name) => (
              <div key={name} testId={`q-${name}`} onClick={() => quality(name)} style={{ display: 'flex', paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 7, cursor: 'pointer', backgroundColor: settings.quality === name ? alpha(t.accent, 0.22) : alpha(t.bg, 0), hover: { backgroundColor: settings.quality === name ? alpha(t.accent, 0.28) : alpha(t.fg, 0.08) } }}>
                <text style={{ fontSize: 12, fontWeight: 700, color: settings.quality === name ? t.accent : t.dim }}>{name.toUpperCase()}</text>
              </div>
            ))}
          </div>
          {!tiny ? (
            <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Pill t={t} id="rain" on={settings.rain} label="Rain" k="R" onClick={() => toggle('rain')} />
              <Pill t={t} id="ball" on={settings.ball} label="Ball" k="B" onClick={() => toggle('ball')} />
              <Pill t={t} id="shafts" on={settings.shafts && q.shafts} dim={!q.shafts} label="Shafts" k="V" onClick={() => toggle('shafts')} />
              <Pill t={t} id="pause" on={settings.paused} label={settings.paused ? 'Paused' : 'Pause'} k="␣" onClick={() => toggle('paused')} />
              <Pill t={t} id="snap" on={false} label="Snap" k="S" onClick={screenshot} />
            </div>
          ) : null}
        </div>
      </div>

      {perf ? (
        <div testId="perf" style={{ ...panel, position: 'absolute', left: 14, bottom: 14, padding: 12, paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 210, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
            <text testId="fps" style={{ fontSize: 26, fontWeight: 700, color: fpsColor, fontFamily: mono }}>{stats.fps.toFixed(0)}</text>
            <text style={{ fontSize: 11, color: t.dim, paddingBottom: 5 }}>{isTerminal() ? 'fps · kitty graphics · paravirtual Metal' : 'fps · Metal window · paravirtual'}</text>
          </div>
          <Row t={t} k="ray trace" v={`${stats.renderMs.toFixed(1)} ms · ${stats.workers} workers`} />
          <Row t={t} k="caustics" v={`${stats.causticsMs.toFixed(1)} ms · peak ${stats.peak.toFixed(1)}×`} />
          <Row t={t} k="wave sim" v={`${stats.simMs.toFixed(2)} ms · ${stats.steps} steps/s`} />
          <Row t={t} k="pixels" v={`${stats.w}×${stats.h} → ${Math.round(W)}×${Math.round(H)}`} />
          {!narrow ? <Row t={t} k="sun · depth" v={`${settings.sunElev}° · ${settings.depth.toFixed(1)} m`} /> : null}
        </div>
      ) : null}

      {!narrow ? (
        <div style={{ position: 'absolute', right: 16, bottom: 16, display: 'flex', flexDirection: 'row', gap: 14, pointerEvents: 'none' }}>
          {[['drag water', 'ripples'], ['drag ball', 'push'], ['drag deck', 'orbit'], ['scroll', 'zoom'], ['H', 'keys']].map(([a, b]) => (
            <div key={a} style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
              <text style={{ fontSize: 11, fontWeight: 600, color: t.fg }}>{a!}</text>
              <text style={{ fontSize: 11, color: t.faint }}>{b!}</text>
            </div>
          ))}
        </div>
      ) : null}

      {toast ? (
        <div testId="toast" style={{ position: 'absolute', top: 16, left: 0, width: W, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ ...panel, display: 'flex', paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderColor: alpha(t.accent, 0.5), marginTop: narrow ? 70 : 0 }}>
            <text style={{ fontSize: 12, fontWeight: 600, color: t.fg }}>{toast.text}</text>
          </div>
        </div>
      ) : null}

      {help ? <Help t={t} W={W} H={H} panel={panel} /> : null}
    </div>
  )
}

function Pill({ t, id, on, label, k, onClick, dim }: { t: Theme; id: string; on: boolean; label: string; k: string; onClick: () => void; dim?: boolean }) {
  return (
    <div testId={`pill-${id}`} onClick={onClick} style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 999, borderWidth: 1, cursor: 'pointer', borderColor: on ? alpha(t.accent, 0.7) : alpha(t.fg, 0.14), backgroundColor: on ? alpha(t.accent, 0.16) : alpha(t.bg, 0.72), hover: { borderColor: alpha(t.fg, 0.4) } }}>
      <text style={{ fontSize: 12, fontWeight: 600, color: on ? t.accent : dim ? t.faint : t.fg }}>{label}</text>
      <text style={{ fontSize: 10, color: t.faint, fontFamily: 'Menlo' }}>{k}</text>
    </div>
  )
}

function Row({ t, k, v }: { t: Theme; k: string; v: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 14 }}>
      <text style={{ fontSize: 11, color: t.dim }}>{k}</text>
      <text style={{ fontSize: 11, color: t.fg, fontFamily: 'Menlo' }}>{v}</text>
    </div>
  )
}

const HELP: [string, string][] = [
  ['drag on water', 'drop a trail of ripples'], ['drag the ball', 'push it through the water'], ['drag the deck · arrows', 'orbit the camera'], ['scroll', 'zoom'],
  ['1 / 2 · L / F · Q', 'LITE / FULL quality'], ['R', 'rain'], ['B', 'ball on / off'], ['V', 'light shafts (FULL)'], ['space · P', 'pause the water'],
  ['[  ]', 'sun height'], [',  .', 'sun direction'], ['-  =', 'water depth'], ['C', 'calm the water'], ['S', 'save a full-res PNG'], ['G', 'perf overlay'], ['Ctrl-C', 'quit'],
]

function Help({ t, W, H, panel }: { t: Theme; W: number; H: number; panel: Record<string, unknown> }) {
  return (
    <div testId="help" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ ...panel, backgroundColor: alpha(t.bg, 0.92), padding: 18, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 340 }}>
        <text style={{ fontSize: 13, fontWeight: 700, color: t.fg, paddingBottom: 4 }}>Controls</text>
        {HELP.map(([a, b]) => (
          <div key={a} style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 24 }}>
            <text style={{ fontSize: 12, fontWeight: 600, color: t.accent }}>{a}</text>
            <text style={{ fontSize: 12, color: t.dim }}>{b}</text>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The mounted App's controls, so the window-level key handler and tests reach them. */
export const controls: { current: Controls | null } = { current: null }

export function start(props: AppProps, opts: { terminal: boolean }) {
  render(<App {...props} />, {
    terminal: opts.terminal,
    title: 'caustic',
    width: 1280,
    height: 800,
    onKeyDown: (e: KeyLike) => { controls.current?.key(e) },
  } as never)
}
