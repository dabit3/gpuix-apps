import { join } from 'node:path'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isTerminal, render, useWindowSize } from '@gpuix/react'
import type { EngineStats, FromEngine } from './protocol'
import type { ProbeSpec } from './probe'
import { DEFAULT_SETTINGS, MASS_MAX, MASS_MIN, QUALITY, SCENES, SCENE_NAMES, TILT_MAX, fmtMass, sceneSettings, type Hud, type SceneName, type Settings } from './scene'
import { rsKm, rsOverC } from './physics'
import { dilation } from './dive'
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
  /** Called with probes this pane dropped, so the CLI can share them with other panes. */
  onProbes?: (p: ProbeSpec[]) => void
  peers?: () => number
  shotDir?: string
}

export interface Controls {
  settings: Settings
  set(p: Partial<Settings>): void
  key(e: KeyLike): boolean
}

const BLANK: EngineStats = { fps: 0, traceMs: 0, tableMs: 0, postMs: 0, w: 0, h: 0, workers: 0, rays: 0 }
const BLANK_HUD: Hud = { r: 30, yaw: 0, pitch: 0, dive: null, probes: 0, probe: null }
const MONO = 'SF Mono'

/** Seconds → a compact human duration. */
export function fmtTime(s: number) {
  if (!Number.isFinite(s)) return '∞'
  const a = Math.abs(s)
  if (a < 1) return `${(s * 1000).toFixed(0)} ms`
  if (a < 120) return `${s.toFixed(1)} s`
  if (a < 7200) return `${(s / 60).toFixed(1)} min`
  if (a < 172800) return `${(s / 3600).toFixed(1)} h`
  if (a < 3.15e7 * 2) return `${(s / 86400).toFixed(1)} d`
  return `${(s / 3.156e7).toFixed(1)} yr`
}
export const fmtKm = (km: number) => (km >= 1e6 ? `${(km / 1.496e8).toFixed(km >= 1.496e9 ? 0 : 2)} AU` : `${(km / 1e3).toFixed(0)}k km`)

export function App({ source, theme: t, initial, size: fixed, onProbes, peers, shotDir = process.cwd() }: AppProps) {
  const live = useWindowSize()
  const size = fixed ?? live
  const img = useRef<{ setImagePixels(w: number, h: number, px: Uint8Array, o?: { format?: 'rgba' | 'bgra' }): void } | null>(null)
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, ...initial })
  const [stats, setStats] = useState<EngineStats>(BLANK)
  const [hud, setHud] = useState<Hud>(BLANK_HUD)
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null)
  const [perf, setPerf] = useState(false)
  const [help, setHelp] = useState(false)
  const [linked, setLinked] = useState(0)
  const [horizon, setHorizon] = useState(0)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const hudRef = useRef(hud)
  hudRef.current = hud

  const say = (text: string) => setToast({ text, at: Date.now() })
  const set = (p: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...p }
    settingsRef.current = next
    setSettings(next)
    source.post({ type: 'set', settings: p })
  }

  useLayoutEffect(() => source.subscribe((m: FromEngine) => {
    if (m.type === 'frame') img.current?.setImagePixels(m.w, m.h, new Uint8Array(m.buf, 0, m.w * m.h * 4), { format: 'bgra' })
    else if (m.type === 'stats') { setStats(m.stats); setHud(m.hud); if (peers) setLinked(peers()) }
    else if (m.type === 'probes') onProbes?.(m.specs)
    else if (m.type === 'dive') { if (m.phase === 'horizon') setHorizon(Date.now()); if (m.phase === 'eject') say('Thrusters · climbing back out') }
    else if (m.type === 'saved') say(`Saved ${m.path.split('/').pop()}`)
    else if (m.type === 'error') say(m.message.split('\n')[0]!)
  }), [source])

  useLayoutEffect(() => { source.post({ type: 'size', w: Math.round(size.width), h: Math.round(size.height) }) }, [source, size.width, size.height])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2200); return () => clearTimeout(id) }, [toast])
  useEffect(() => { if (!horizon) return; const id = setTimeout(() => setHorizon(0), 3200); return () => clearTimeout(id) }, [horizon])

  const uv = (e: { x?: number; y?: number }) => ({ u: ((e.x ?? 0) / size.width) * 2 - 1, v: 1 - ((e.y ?? 0) / size.height) * 2 })
  const pointer = (phase: 'down' | 'move' | 'up') => (e: { x?: number; y?: number; button?: number | null }) => {
    if (phase === 'down' && e.button != null && e.button !== 0) return
    source.post({ type: 'pointer', phase, ...uv(e) })
  }

  const scene = (name: SceneName) => { set(sceneSettings(name)); say(`${SCENES[name].label} · ${SCENES[name].blurb}`) }
  const nextScene = (d: number) => scene(SCENE_NAMES[(SCENE_NAMES.indexOf(settingsRef.current.scene) + d + SCENE_NAMES.length) % SCENE_NAMES.length]!)
  const screenshot = () => source.post({ type: 'screenshot', path: join(shotDir, `gargantua-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`) })
  const toggle = (k: 'lens' | 'disk' | 'paused') => {
    const on = !settingsRef.current[k]
    set({ [k]: on })
    if (k === 'lens') say(on ? 'Lensing on · curved spacetime' : 'Lensing off · flat space, straight rays')
    if (k === 'disk') say(on ? 'Accretion disk on' : 'Disk off · shadow, photon ring and lensed sky')
  }
  const look = () => { const l = settingsRef.current.look === 'physical' ? 'interstellar' : 'physical'; set({ look: l }); say(l === 'physical' ? 'Physical · Doppler beaming + gravitational redshift' : 'Interstellar look · symmetric warm disk, no Doppler colour') }
  const quality = (q: Settings['quality']) => { if (q !== settingsRef.current.quality) { set({ quality: q }); say(q === 'full' ? `FULL · ${QUALITY.full.rays} rays · ${QUALITY.full.orders} image orders` : `LITE · ${QUALITY.lite.rays} rays · ${QUALITY.lite.orders} image orders`) } }
  const mass = (d: number) => { const m = Math.max(MASS_MIN, Math.min(MASS_MAX, +(settingsRef.current.mass + d).toFixed(2))); set({ mass: m }); say(`Mass ${fmtMass(m)}`) }
  const tilt = (d: number) => { const v = Math.max(-TILT_MAX, Math.min(TILT_MAX, settingsRef.current.tilt + d)); set({ tilt: v }); say(`Disk tilt ${v}°`) }
  const drop = () => { source.post({ type: 'drop' }); say('Probe released') }
  const dive = () => { if (hudRef.current.dive) { source.post({ type: 'eject' }); return } source.post({ type: 'dive' }); say('Dive · radial free fall from rest') }
  const reset = () => { const sc = SCENES[settingsRef.current.scene]; source.post({ type: 'camera', yaw: 0, pitch: sc.pitch, dist: sc.dist }); say('Camera reset') }

  controls.current = {
    settings,
    set,
    key(e: KeyLike) {
      const k = keyName(e)
      switch (k) {
        case 'l': toggle('lens'); return true
        case 'k': toggle('disk'); return true
        case 'i': look(); return true
        case '1': quality('lite'); return true
        case '2': quality('full'); return true
        case 'q': quality(settingsRef.current.quality === 'lite' ? 'full' : 'lite'); return true
        case '3': scene('gargantua'); return true
        case '4': scene('m87'); return true
        case '5': scene('sgr-a'); return true
        case '6': scene('quasar'); return true
        case 'n': nextScene(1); return true
        case 'b': drop(); return true
        case 'd': dive(); return true
        case 'e': source.post({ type: 'eject' }); return true
        case 'space': case ' ': case 'p': toggle('paused'); return true
        case 's': screenshot(); return true
        case 'r': reset(); return true
        case 'g': setPerf((x) => !x); return true
        case 'h': case '?': setHelp((x) => !x); return true
        case '[': tilt(-5); return true
        case ']': tilt(5); return true
        case '-': mass(-0.5); return true
        case '=': case '+': mass(0.5); return true
        case 'left': source.post({ type: 'orbit', dyaw: -0.12, dpitch: 0 }); return true
        case 'right': source.post({ type: 'orbit', dyaw: 0.12, dpitch: 0 }); return true
        case 'up': source.post({ type: 'orbit', dyaw: 0, dpitch: 0.06 }); return true
        case 'down': source.post({ type: 'orbit', dyaw: 0, dpitch: -0.06 }); return true
        case 'escape': setHelp(false); return true
      }
      return false
    },
  }

  const W = size.width, H = size.height
  const narrow = W < 900
  const tiny = W < 600
  const sc = SCENES[settings.scene]
  const fpsColor = stats.fps >= 30 ? t.good : stats.fps >= 20 ? t.warn : t.bad
  const panel = { backgroundColor: alpha(t.bg, 0.72), borderWidth: 1, borderColor: alpha(t.fg, 0.12), borderRadius: 10 }
  const sec = rsOverC(Math.pow(10, settings.mass))
  const d = hud.dive
  const showHorizon = horizon > 0

  return (
    <div testId="app-root" tabIndex={-1} autoFocus onKeyDown={(e: KeyLike & { stopPropagation?: () => void }) => { if (controls.current?.key(e)) e.stopPropagation?.() }} style={{ width: W, height: H, backgroundColor: '#000000', position: 'relative', overflow: 'hidden', display: 'flex' }}>
      <div
        testId="view"
        onMouseDown={pointer('down')}
        onMouseMove={pointer('move')}
        onMouseUp={pointer('up')}
        onScroll={(e: { deltaY?: number }) => source.post({ type: 'zoom', f: Math.exp((e.deltaY ?? 0) * 0.004) })}
        style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, cursor: 'move', display: 'flex' }}
      >
        <img ref={img as never} objectFit="fill" style={{ width: W, height: H }} />
      </div>

      <div style={{ position: 'absolute', left: 18, top: 14, display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
          <text style={{ fontSize: 15, fontWeight: 700, color: t.fg, pointerEvents: 'none' }}>GARGANTUA</text>
          <text style={{ fontSize: 15, fontWeight: 300, color: t.accent, pointerEvents: 'none' }}>//</text>
          <text testId="scene-name" style={{ fontSize: 15, fontWeight: 600, color: t.dim, pointerEvents: 'none' }}>{settings.scene === 'gargantua' ? (settings.look === 'physical' ? 'PHYSICAL' : 'INTERSTELLAR') : sc.label.toUpperCase()}</text>
        </div>
        <text testId="subtitle" style={{ fontSize: 11, color: t.dim, pointerEvents: 'none' }}>
          {`${settings.lens ? 'Schwarzschild geodesics' : 'flat space'} · ${settings.look === 'physical' ? 'Physical' : 'Interstellar look'} · ${settings.quality.toUpperCase()}`}
        </text>
        {linked > 0 ? <text testId="linked" style={{ fontSize: 11, color: t.accent, pointerEvents: 'none' }}>{`linked · same hole in ${linked + 1} panes`}</text> : null}
      </div>

      <div style={{ position: 'absolute', right: 14, top: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, maxWidth: Math.max(260, Math.min(760, W - 230)) }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ ...panel, display: 'flex', flexDirection: 'row', padding: 3, gap: 2 }}>
            {(['lite', 'full'] as const).map((name) => (
              <div key={name} testId={`q-${name}`} onClick={() => quality(name)} style={{ display: 'flex', paddingLeft: 11, paddingRight: 11, paddingTop: 5, paddingBottom: 5, borderRadius: 7, cursor: 'pointer', backgroundColor: settings.quality === name ? alpha(t.accent, 0.22) : alpha(t.bg, 0), hover: { backgroundColor: settings.quality === name ? alpha(t.accent, 0.28) : alpha(t.fg, 0.08) } }}>
                <text style={{ fontSize: 12, fontWeight: 700, color: settings.quality === name ? t.accent : t.dim }}>{name.toUpperCase()}</text>
              </div>
            ))}
          </div>
          <Pill t={t} id="lens" on={settings.lens} label="Lensing" k="L" onClick={() => toggle('lens')} />
          <Pill t={t} id="disk" on={settings.disk} label="Disk" k="K" onClick={() => toggle('disk')} />
          <Pill t={t} id="look" on={settings.look === 'physical'} label={settings.look === 'physical' ? 'Physical' : 'Interstellar'} k="I" onClick={look} />
          <Pill t={t} id="drop" on={false} label="Drop" k="B" onClick={drop} />
          <Pill t={t} id="dive" on={!!d} label={d ? (d.phase === 'fall' ? 'Eject' : 'Diving') : 'Dive'} k={d ? 'E' : 'D'} onClick={dive} />
          {!tiny ? <Pill t={t} id="pause" on={settings.paused} label={settings.paused ? 'Paused' : 'Pause'} k="␣" onClick={() => toggle('paused')} /> : null}
          {!tiny ? <Pill t={t} id="snap" on={false} label="Snap" k="S" onClick={screenshot} /> : null}
          <Pill t={t} id="help" on={help} label="Help" k="H" onClick={() => setHelp((x) => !x)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div testId="scenes" style={{ ...panel, display: 'flex', flexDirection: 'row', padding: 3, gap: 2 }}>
            {SCENE_NAMES.map((name, i) => (
              <div key={name} testId={`scene-${name}`} onClick={() => scene(name)} style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 7, cursor: 'pointer', backgroundColor: settings.scene === name ? alpha(t.accent, 0.22) : alpha(t.bg, 0), hover: { backgroundColor: settings.scene === name ? alpha(t.accent, 0.28) : alpha(t.fg, 0.08) } }}>
                <text style={{ fontSize: 12, fontWeight: 600, color: settings.scene === name ? t.accent : t.dim }}>{SCENES[name].label}</text>
                {!narrow ? <text style={{ fontSize: 10, color: t.faint, fontFamily: MONO }}>{String(i + 3)}</text> : null}
              </div>
            ))}
          </div>
          <Stepper t={t} id="mass" label="Mass" value={fmtMass(settings.mass)} keys="- =" onDec={() => mass(-0.5)} onInc={() => mass(0.5)} panel={panel} />
          <Stepper t={t} id="tilt" label="Tilt" value={`${settings.tilt}°`} keys="[ ]" onDec={() => tilt(-5)} onInc={() => tilt(5)} panel={panel} />
        </div>
      </div>

      <div testId="hud" style={{ ...panel, position: 'absolute', right: 14, bottom: 14, padding: 12, paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 4, minWidth: tiny ? 190 : 236, pointerEvents: 'none', borderColor: d ? alpha(t.accent, 0.55) : alpha(t.fg, 0.12) }}>
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, pointerEvents: 'none' }}>
          <text style={{ fontSize: 10, fontWeight: 700, color: d ? t.accent : t.dim, pointerEvents: 'none' }}>{d ? (d.phase === 'fall' ? 'FREE FALL' : d.phase === 'eject' ? 'EJECT' : 'INSIDE HORIZON') : 'ORBIT'}</text>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 4, pointerEvents: 'none' }}>
            <text testId="hud-r" style={{ fontSize: 24, fontWeight: 600, color: t.fg, fontFamily: MONO, pointerEvents: 'none' }}>{(d ? d.r : hud.r).toFixed(d && d.r < 10 ? 3 : 1)}</text>
            <text style={{ fontSize: 11, color: t.dim, paddingBottom: 4, pointerEvents: 'none' }}>r / rs</text>
          </div>
        </div>
        {d ? (
          <>
            <Row t={t} k="velocity" v={`${d.v.toFixed(3)} c`} hi={d.v > 0.5} />
            <Row t={t} k="proper time τ" v={fmtTime(d.tau * sec)} />
            <Row t={t} k="far-away clock t" v={fmtTime(d.t * sec)} hi={!Number.isFinite(d.t)} />
            <Row t={t} k="dt / dτ" v={d.r > 1 ? `${dilation(Math.max(8, hud.r), Math.max(1.0001, d.r)).toFixed(2)}×` : '—'} />
            {d.phase === 'fall' ? <text style={{ fontSize: 10, color: t.faint, pointerEvents: 'none' }}>E · fire thrusters before the horizon</text> : null}
          </>
        ) : (
          <>
            <Row t={t} k="mass" v={fmtMass(settings.mass)} />
            <Row t={t} k="rs" v={fmtKm(rsKm(Math.pow(10, settings.mass)))} />
            {!tiny ? <Row t={t} k="photon ring" v={`r = 1.5 rs · b = 2.598 rs`} /> : null}
            {hud.probe ? <Row t={t} k="probe" v={`r ${hud.probe.r.toFixed(2)} · z ${(1 / Math.max(1e-3, hud.probe.g) - 1).toFixed(2)}`} hi /> : <Row t={t} k="disk" v={settings.disk ? `ISCO 3 rs → 20 rs` : 'off'} />}
          </>
        )}
      </div>

      {perf ? (
        <div testId="perf" style={{ ...panel, position: 'absolute', left: 14, bottom: 14, padding: 12, paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 210, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 6, pointerEvents: 'none' }}>
            <text testId="fps" style={{ fontSize: 24, fontWeight: 600, color: fpsColor, fontFamily: MONO, pointerEvents: 'none' }}>{stats.fps.toFixed(0)}</text>
            <text style={{ fontSize: 11, color: t.dim, paddingBottom: 4, pointerEvents: 'none' }}>{isTerminal() ? 'fps · kitty graphics' : 'fps · Metal window'}</text>
          </div>
          <Row t={t} k="geodesics" v={`${stats.traceMs.toFixed(1)} ms · ${stats.workers} workers`} />
          <Row t={t} k="ray table" v={`${stats.rays} rays · ${stats.tableMs.toFixed(1)} ms`} />
          <Row t={t} k="bloom + tone" v={`${stats.postMs.toFixed(1)} ms`} />
          <Row t={t} k="pixels" v={`${stats.w}×${stats.h} → ${Math.round(W)}×${Math.round(H)}`} />
        </div>
      ) : !narrow ? (
        <div style={{ position: 'absolute', left: 18, bottom: 16, display: 'flex', flexDirection: 'row', gap: 14, pointerEvents: 'none' }}>
          {[['drag', 'orbit'], ['scroll', 'distance'], ['L', 'lensing'], ['D', 'dive'], ['B', 'drop'], ['H', 'keys']].map(([a, b]) => (
            <div key={a} style={{ display: 'flex', flexDirection: 'row', gap: 5, pointerEvents: 'none' }}>
              <text style={{ fontSize: 11, fontWeight: 600, color: t.fg, pointerEvents: 'none' }}>{a!}</text>
              <text style={{ fontSize: 11, color: t.faint, pointerEvents: 'none' }}>{b!}</text>
            </div>
          ))}
        </div>
      ) : null}

      {showHorizon ? (
        <div testId="horizon" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, pointerEvents: 'none' }}>
          <text style={{ fontSize: tiny ? 18 : 26, fontWeight: 700, color: t.fg, pointerEvents: 'none' }}>EVENT HORIZON</text>
          <text style={{ fontSize: 12, color: t.dim, pointerEvents: 'none' }}>r = rs · no way back · the outside universe shrinks behind you</text>
        </div>
      ) : null}

      {toast ? (
        <div testId="toast" style={{ position: 'absolute', top: narrow ? 120 : 92, left: 0, width: W, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ ...panel, display: 'flex', paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderColor: alpha(t.accent, 0.5), pointerEvents: 'none' }}>
            <text style={{ fontSize: 12, fontWeight: 600, color: t.fg, pointerEvents: 'none' }}>{toast.text}</text>
          </div>
        </div>
      ) : null}

      {help ? <Help t={t} W={W} H={H} panel={panel} /> : null}
    </div>
  )
}

function Pill({ t, id, on, label, k, onClick }: { t: Theme; id: string; on: boolean; label: string; k: string; onClick: () => void }) {
  return (
    <div testId={`pill-${id}`} onClick={onClick} style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 999, borderWidth: 1, cursor: 'pointer', borderColor: on ? alpha(t.accent, 0.7) : alpha(t.fg, 0.14), backgroundColor: on ? alpha(t.accent, 0.16) : alpha(t.bg, 0.72), hover: { borderColor: alpha(t.fg, 0.4) } }}>
      <text style={{ fontSize: 12, fontWeight: 600, color: on ? t.accent : t.fg }}>{label}</text>
      <text style={{ fontSize: 10, color: t.faint, fontFamily: MONO }}>{k}</text>
    </div>
  )
}

function Stepper({ t, id, label, value, keys, onDec, onInc, panel }: { t: Theme; id: string; label: string; value: string; keys: string; onDec: () => void; onInc: () => void; panel: Record<string, unknown> }) {
  const btn = (sid: string, ch: string, fn: () => void) => (
    <div testId={`${id}-${sid}`} onClick={fn} style={{ display: 'flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6, cursor: 'pointer', backgroundColor: alpha(t.fg, 0.06), hover: { backgroundColor: alpha(t.fg, 0.16) } }}>
      <text style={{ fontSize: 13, fontWeight: 700, color: t.fg }}>{ch}</text>
    </div>
  )
  return (
    <div testId={`stepper-${id}`} style={{ ...panel, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, padding: 3, paddingLeft: 9 }}>
      <text style={{ fontSize: 11, color: t.dim }}>{label}</text>
      {btn('dec', '−', onDec)}
      <text testId={`${id}-value`} style={{ fontSize: 12, fontWeight: 600, color: t.fg, fontFamily: MONO }}>{value}</text>
      {btn('inc', '+', onInc)}
      <text style={{ fontSize: 10, color: t.faint, fontFamily: MONO, paddingRight: 5 }}>{keys}</text>
    </div>
  )
}

function Row({ t, k, v, hi }: { t: Theme; k: string; v: string; hi?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 14, pointerEvents: 'none' }}>
      <text style={{ fontSize: 11, color: t.dim, pointerEvents: 'none' }}>{k}</text>
      <text style={{ fontSize: 11, color: hi ? t.accent : t.fg, fontFamily: MONO, pointerEvents: 'none' }}>{v}</text>
    </div>
  )
}

const HELP: [string, string][] = [
  ['drag · arrows', 'orbit the camera (fling it)'], ['scroll', 'distance (log scale)'], ['R', 'reset the camera'],
  ['L', 'lensing on / off (curved vs flat space)'], ['K', 'accretion disk on / off'], ['I', 'Physical / Interstellar look'],
  ['1 / 2 · Q', 'LITE / FULL quality'], ['3 4 5 6 · N', 'Gargantua, M87*, Sgr A*, quasar'], ['-  =', 'mass'], ['[  ]', 'disk tilt'],
  ['B', 'drop a probe (gargantua drop from any shell)'], ['D', 'dive: free fall through the horizon'], ['E', 'eject (before the horizon)'],
  ['space · P', 'pause'], ['S', 'save a full-res PNG'], ['G', 'perf overlay'], ['Ctrl-C', 'quit'],
]

function Help({ t, W, H, panel }: { t: Theme; W: number; H: number; panel: Record<string, unknown> }) {
  return (
    <div testId="help" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ ...panel, backgroundColor: alpha(t.bg, 0.9), padding: 18, display: 'flex', flexDirection: 'column', gap: 6, minWidth: Math.min(380, W - 40), pointerEvents: 'none' }}>
        <text style={{ fontSize: 13, fontWeight: 700, color: t.fg, paddingBottom: 4, pointerEvents: 'none' }}>Controls</text>
        {HELP.map(([a, b]) => (
          <div key={a} style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 24, pointerEvents: 'none' }}>
            <text style={{ fontSize: 12, fontWeight: 600, color: t.accent, pointerEvents: 'none' }}>{a}</text>
            <text style={{ fontSize: 12, color: t.dim, pointerEvents: 'none' }}>{b}</text>
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
    title: 'gargantua',
    width: 1280,
    height: 800,
    onKeyDown: (e: KeyLike) => { controls.current?.key(e) },
  } as never)
}
