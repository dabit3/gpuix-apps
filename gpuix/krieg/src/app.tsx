// The game app: a live <img> fed by the CPU raycaster, with HUD, title card, end screen and a texture lab
// drawn as GPUIX elements on top (pointerEvents:'none' so the image keeps the mouse).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWindowSize, type ImgInstance } from '@gpuix/react'
import { Renderer } from './engine/raycast'
import { MATERIALS } from './gen/materials'
import { Audio } from './audio/synth'
import { boot, type Boot } from './boot'
import { scene } from './game/scene'
import { WEAPONS, type Input } from './game/world'
import { writeLive } from './live'
import { MONO, T } from './theme'
import { appendFileSync } from 'node:fs'

const DEBUG = process.env.KRIEG_DEBUG

export interface Opts { seed: number; mute: boolean; god: boolean; scale: number; size?: { bytes: number; gzip: number } }
type Mode = 'title' | 'play' | 'lab'

export function keyName(e: { key?: string; keyChar?: string }) {
  const c = e.keyChar
  if (c && /^[\x21-\x7e]$/.test(c)) return c.toLowerCase()
  return (e.key ?? '').toLowerCase()
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function App({ opts, game }: { opts: Opts; game?: Boot }) {
  const size = useWindowSize()
  const img = useRef<ImgInstance>(null)
  const g = useRef<Boot>(null as unknown as Boot)
  if (!g.current) g.current = game ?? boot(opts.seed)
  const audio = useRef<Audio>(null as unknown as Audio)
  if (!audio.current) audio.current = new Audio(!opts.mute)
  const [mode, setMode] = useState<Mode>('title')
  const modeRef = useRef(mode); modeRef.current = mode
  const [hud, setHud] = useState(() => snap(g.current, 0, 0))
  const [perf, setPerf] = useState(false)
  const [scale, setScale] = useState(opts.scale)
  const held = useRef(new Set<string>())
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null)
  const look = useRef({ dx: 0, dy: 0 })
  const sz = useRef(size); sz.current = size
  const scaleRef = useRef(scale); scaleRef.current = scale
  const r = useRef(new Renderer())
  g.current.world.god = opts.god

  useLayoutEffect(() => {
    let alive = true, last = performance.now(), frames = 0, fpsT = last, fps = 0, hudT = 0, liveT = 0, t = 0
    const tick = () => {
      if (!alive) return
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt
      const w = g.current.world
      const m = modeRef.current
      const k = held.current
      const inp: Input = { fwd: 0, strafe: 0, turn: 0, look: 0, fire: false, jump: false, crouch: false }
      if (m === 'play') {
        inp.fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0)
        inp.strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0)
        inp.turn = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0) + (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0)
        inp.look = (k.has('up') ? -1 : 0) + (k.has('down') ? 1 : 0)
        inp.fire = k.has('f') || k.has('enter') || k.has('mouse')
        inp.jump = k.has('space'); inp.crouch = k.has('c')
        w.p.angle += look.current.dx * 0.006
        w.p.pitch = Math.max(-0.35, Math.min(0.35, w.p.pitch + look.current.dy * 0.0016))
        look.current.dx = look.current.dy = 0
        w.step(dt, inp)
        for (const ev of w.events) audio.current.play(ev)
      } else if (m === 'title') {
        w.p.angle += dt * 0.18
      }
      const ren = r.current
      const S = sz.current, sc = scaleRef.current
      ren.resize(Math.floor(S.width / sc), Math.floor(S.height / sc))
      const sc2 = scene(w, g.current.sprites, t)
      ren.render(w.level, g.current.mats, sc2.cam, sc2.sprites, sc2.dyn, m === 'play' ? sc2.vm : null, m === 'title' ? [10, 12, 16, 0.35] : sc2.tint)
      img.current?.setImagePixels(ren.W, ren.H, ren.buf, { format: 'bgra' })
      frames++
      if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now }
      if (now - hudT > 100) { hudT = now; setHud(snap(g.current, fps, ren.stats.ms, ren.W, ren.H)) }
      if (now - liveT > 100) { liveT = now; writeLive(w) }
      setTimeout(tick, 1)
    }
    tick()
    return () => { alive = false }
  }, [])
  useEffect(() => () => audio.current.stop(), [])

  const start = () => { setMode('play'); audio.current.startMusic() }
  const restart = (seed = g.current.world.level.seed) => { g.current = { ...g.current, ...boot(seed) }; setMode('play') }

  const onKeyDown = (e: any) => {
    const n = keyName(e)
    if (DEBUG) appendFileSync(DEBUG, `down ${JSON.stringify({ key: e.key, keyChar: e.keyChar })} -> ${n}\n`)
    const w = g.current.world
    if (modeRef.current === 'title') { if (n === 'enter' || n === 'space') start(); else if (n === 't') setMode('lab'); return }
    if (modeRef.current === 'lab') { if (n === 't' || n === 'escape' || n === 'enter') setMode('play'); return }
    if (w.state !== 'play') { if (n === 'enter' || n === 'r') restart(); else if (n === 'n') restart((w.level.seed * 48271) % 2147483647); return }
    if (n === '1') w.swap(0)
    else if (n === '2') w.swap(1)
    else if (n === 'tab' || n === 'x') w.swap()
    else if (n === 'r') setScale((s) => (s === 2 ? 3 : s === 3 ? 4 : 2))
    else if (n === 'm') audio.current.toggleMusic()
    else if (n === 'p') setPerf((v) => !v)
    else if (n === 'b') r.current.bloom = !r.current.bloom
    else if (n === 't') setMode('lab')
    else if (n === 'escape') setMode('title')
    held.current.add(n)
  }
  const onKeyUp = (e: any) => held.current.delete(keyName(e))
  const onMouseDown = (e: any) => {
    if (modeRef.current === 'title') { start(); return }
    if (modeRef.current === 'lab') return
    if (g.current.world.state !== 'play') { restart(); return }
    drag.current = { x: e.x, y: e.y, moved: 0 }
    held.current.add('mouse')
  }
  const onMouseMove = (e: any) => {
    const d = drag.current
    if (!d) return
    look.current.dx += e.x - d.x; look.current.dy += e.y - d.y
    d.moved += Math.abs(e.x - d.x) + Math.abs(e.y - d.y)
    d.x = e.x; d.y = e.y
    if (d.moved > 8) held.current.delete('mouse')
  }
  const onMouseUp = () => { drag.current = null; held.current.delete('mouse') }
  const onScroll = (e: any) => { if (modeRef.current === 'play' && Math.abs(e.deltaY) > 0.5) g.current.world.swap() }

  const W = size.width, H = size.height
  const small = W < 760
  const fs = small ? 12 : 14
  return (
    <div testId="krieg" tabIndex={-1} autoFocus onKeyDown={onKeyDown} onKeyUp={onKeyUp} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onScroll={onScroll}
      style={{ width: W, height: H, backgroundColor: T.bg, position: 'relative', fontFamily: MONO, userSelect: 'none' }}>
      <img ref={img} objectFit="fill" style={{ width: W, height: H }} />
      {mode === 'play' && <Hud hud={hud} W={W} H={H} fs={fs} small={small} perf={perf} />}
      {mode === 'title' && <Title hud={hud} W={W} H={H} small={small} opts={opts} audioMs={audio.current.ms} audioOn={audio.current.enabled} />}
      {mode === 'lab' && <Lab boot={g.current} W={W} H={H} small={small} />}
    </div>
  )
}

function snap(b: Boot, fps: number, ms: number, rw = 0, rh = 0) {
  const w = b.world, p = w.p
  return {
    fps, ms, rw, rh, hp: Math.ceil(p.hp), ammo: p.ammo, rockets: p.rockets, weapon: p.weapon, key: p.hasKey, kills: w.kills, total: w.enemies.length,
    time: w.time, state: w.state, toast: w.toast.t > 0 ? w.toast.text : '', seed: w.level.seed, timings: b.timings,
    alerted: w.enemies.filter((e) => e.state === 'chase' || e.state === 'attack').length,
  }
}
type HudState = ReturnType<typeof snap>

const ov = { position: 'absolute', pointerEvents: 'none' } as const
const txt = (color: string, fontSize: number, extra: object = {}) => ({ color, fontSize, fontFamily: MONO, ...extra })

function Bar({ v, max, color, w }: { v: number; max: number; color: string; w: number }) {
  return (
    <div style={{ width: w, height: 6, backgroundColor: '#ffffff1a', borderRadius: 3, display: 'flex' }}>
      <div style={{ width: Math.max(0, Math.min(1, v / max)) * w, height: 6, backgroundColor: color, borderRadius: 3 }} />
    </div>
  )
}

function Hud({ hud, W, H, fs, small, perf }: { hud: HudState; W: number; H: number; fs: number; small: boolean; perf: boolean }) {
  const pad = small ? 10 : 18
  const hpColor = hud.hp > 50 ? T.green : hud.hp > 25 ? T.amber : T.red
  return (
    <>
      <div style={{ ...ov, left: W / 2 - 9, top: H / 2 - 9, width: 18, height: 18 }}>
        <div style={{ position: 'absolute', left: 8, top: 0, width: 2, height: 6, backgroundColor: T.fg }} />
        <div style={{ position: 'absolute', left: 8, top: 12, width: 2, height: 6, backgroundColor: T.fg }} />
        <div style={{ position: 'absolute', left: 0, top: 8, width: 6, height: 2, backgroundColor: T.fg }} />
        <div style={{ position: 'absolute', left: 12, top: 8, width: 6, height: 2, backgroundColor: T.fg }} />
      </div>
      <div style={{ ...ov, left: pad, top: pad, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <text style={txt(T.fg, fs + 2, { fontWeight: 700 })}>{`KRIEG`}</text>
        <text style={txt(T.dim, fs - 1)}>{`seed ${hud.seed}  ${fmt(hud.time)}`}</text>
      </div>
      <div style={{ ...ov, right: pad, top: pad, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <text style={txt(T.fg, fs)}>{`KILLS ${hud.kills}/${hud.total}`}</text>
        {hud.alerted > 0 ? <text style={txt(T.red, fs - 1)}>{`${hud.alerted} HOSTILE${hud.alerted > 1 ? 'S' : ''} ALERTED`}</text> : <text style={txt(T.mute, fs - 1)}>{`undetected`}</text>}
        <text style={txt(hud.key ? T.amber : T.mute, fs - 1)}>{hud.key ? `■ ACCESS KEY` : `□ access key`}</text>
      </div>
      <div style={{ ...ov, left: pad, bottom: pad, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <text style={txt(hpColor, fs + 6, { fontWeight: 700 })}>{`${hud.hp}`}</text>
        <Bar v={hud.hp} max={100} color={hpColor} w={small ? 90 : 150} />
        <text style={txt(T.dim, fs - 2)}>{`HEALTH`}</text>
      </div>
      <div style={{ ...ov, right: pad, bottom: pad, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <text style={txt(hud.weapon === 0 ? T.blue : T.amber, fs + 6, { fontWeight: 700 })}>{`${hud.weapon === 0 ? hud.ammo : hud.rockets}`}</text>
        <text style={txt(T.fg, fs - 1)}>{WEAPONS[hud.weapon]!.name}</text>
        <text style={txt(T.mute, fs - 2)}>{`1 rifle ${hud.ammo}  ·  2 launcher ${hud.rockets}`}</text>
      </div>
      {hud.toast !== '' && (
        <div style={{ ...ov, left: 0, top: H * 0.22, width: W, display: 'flex', justifyContent: 'center' }}>
          <text style={txt(T.amber, fs + 2, { fontWeight: 700 })}>{hud.toast}</text>
        </div>
      )}
      {perf && (
        <div style={{ ...ov, left: pad, top: pad + 52, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <text style={txt(T.cyan, fs - 2)}>{`${hud.fps.toFixed(0)} fps · frame ${hud.ms.toFixed(1)} ms`}</text>
          <text style={txt(T.cyan, fs - 2)}>{`internal ${hud.rw}×${hud.rh} → pane ${W}×${H}`}</text>
        </div>
      )}
      {hud.state !== 'play' && <End hud={hud} W={W} H={H} small={small} />}
    </>
  )
}

function End({ hud, W, H, small }: { hud: HudState; W: number; H: number; small: boolean }) {
  const won = hud.state === 'won'
  return (
    <div style={{ ...ov, left: 0, top: 0, width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#0a0c10b0' }}>
      <text style={txt(won ? T.green : T.red, small ? 28 : 44, { fontWeight: 700 })}>{won ? 'LEVEL CLEARED' : 'YOU DIED'}</text>
      <div style={{ display: 'flex', gap: small ? 18 : 36 }}>
        {[['TIME', fmt(hud.time)], ['KILLS', `${hud.kills}/${hud.total}`], ['SEED', `${hud.seed}`]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <text style={txt(T.fg, small ? 18 : 24, { fontWeight: 700 })}>{v!}</text>
            <text style={txt(T.mute, 12)}>{k!}</text>
          </div>
        ))}
      </div>
      <text style={txt(T.dim, 13)}>{`enter / click  replay    n  new seed`}</text>
    </div>
  )
}

function Title({ hud, W, H, small, opts, audioMs, audioOn }: { hud: HudState; W: number; H: number; small: boolean; opts: Opts; audioMs: number; audioOn: boolean }) {
  const t = hud.timings
  const rows: [string, string][] = [
    ['textures', `${MATERIALS.length} op graphs · ${t.textures.toFixed(0)} ms`],
    ['level', `seed ${hud.seed} · ${t.level.toFixed(0)} ms`],
    ['sprites', `2 enemies · 2 weapons · ${t.sprites.toFixed(0)} ms`],
    ['audio', audioOn ? `synth → wav · ${audioMs.toFixed(0)} ms` : 'muted'],
    ['assets', '0 files'],
  ]
  if (opts.size) rows.push(['bundle', `${(opts.size.bytes / 1024).toFixed(1)} KB min · ${(opts.size.gzip / 1024).toFixed(1)} KB gz`])
  return (
    <div style={{ ...ov, left: 0, top: 0, width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: small ? 12 : 20 }}>
      <text style={txt(T.fg, small ? 40 : 72, { fontWeight: 700 })}>{`KRIEG`}</text>
      <text style={txt(T.dim, small ? 12 : 15)}>{`a procedural shooter generated entirely in code`}</text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 14, backgroundColor: '#0d1117d0', borderRadius: 8, borderWidth: 1, borderColor: T.line }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 14 }}>
            <text style={txt(T.cyan, 13, { width: 70 })}>{k}</text>
            <text style={txt(T.fg, 13)}>{v}</text>
          </div>
        ))}
      </div>
      <text style={txt(T.amber, small ? 13 : 15, { fontWeight: 700 })}>{`click or press enter`}</text>
      {!small && <text style={txt(T.mute, 12)}>{`WASD move · drag look · click fire · space jump · c crouch · 1/2 weapon · t texture lab · r quality`}</text>}
    </div>
  )
}

function Lab({ boot: b, W, H, small }: { boot: Boot; W: number; H: number; small: boolean }) {
  const cols = small ? 3 : 4
  const cell = Math.floor(Math.min((W - 40) / cols - 16, (H - 90) / Math.ceil(b.mats.length / cols) - 40))
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: T.bg, display: 'flex', flexDirection: 'column', padding: 20, gap: 12 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
        <text style={txt(T.fg, 18, { fontWeight: 700 })}>{`Texture lab`}</text>
        <text style={txt(T.mute, 13)}>{`every surface is a short op list run at boot · t to return`}</text>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {b.mats.map((tex, i) => <Swatch key={i} i={i} tex={tex} size={Math.max(48, cell)} />)}
      </div>
    </div>
  )
}

function Swatch({ i, tex, size }: { i: number; tex: Boot['mats'][number]; size: number }) {
  const ref = useRef<ImgInstance>(null)
  useLayoutEffect(() => {
    const n = tex.size, out = new Uint8Array(n * n * 4)
    const u = new Uint32Array(out.buffer)
    for (let k = 0; k < n * n; k++) {
      const p = tex.px[k]!, e = tex.emis[k]! / 255
      const r = Math.min(255, ((p >> 16) & 255) * (1 + e * 0.5)), g = Math.min(255, ((p >> 8) & 255) * (1 + e * 0.5)), bb = Math.min(255, (p & 255) * (1 + e * 0.5))
      u[k] = 0xff000000 | (r << 16) | (g << 8) | bb
    }
    ref.current?.setImagePixels(n, n, out, { format: 'bgra' })
  }, [tex])
  const m = MATERIALS[i]!
  const ops = m.ops.map((o) => o[0]).join(' → ')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: size }}>
      <img ref={ref} objectFit="fill" style={{ width: size, height: size, borderRadius: 4 }} />
      <text style={txt(T.fg, 12, { fontWeight: 700 })}>{m.name}</text>
      <text style={txt(T.mute, 10, { lineClamp: 2 })}>{ops}</text>
    </div>
  )
}
