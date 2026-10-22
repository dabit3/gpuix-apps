// The game app: a live <img> fed by the CPU raycaster, with HUD, title card, end screen and a texture lab
// drawn as GPUIX elements on top (pointerEvents:'none' so the image keeps the mouse).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWindowSize, type ImgInstance } from '@gpuix/react'
import { Renderer } from './engine/raycast'
import { MATERIALS } from './gen/materials'
import { Audio } from './audio/synth'
import { boot, type Boot } from './boot'
import { scene } from './game/scene'
import type { Sprite } from './engine/raycast'
import { WEAPONS, type Input } from './game/world'
import { writeLive } from './live'
import { MONO, T } from './theme'


export interface Opts { seed: number; mute: boolean; god: boolean; scale: number; size?: { bytes: number; gzip: number; packed: number } }
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
  // A click buffers one shot for 400 ms so quick taps during cooldown or between frames still fire.
  const shot = useRef(0)
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
        inp.fire = k.has('f') || k.has('enter') || k.has('mouse') || shot.current > now
        inp.jump = k.has('space'); inp.crouch = k.has('c')
        w.p.sway = Math.max(-1, Math.min(1, w.p.sway - look.current.dx * 0.008 - inp.turn * dt * 3))
        w.p.angle += look.current.dx * 0.006
        w.p.pitch = Math.max(-0.35, Math.min(0.35, w.p.pitch + look.current.dy * 0.0016))
        look.current.dx = look.current.dy = 0
        const a = w.p.ammo + w.p.rockets + w.p.shells
        w.step(dt, inp)
        if (w.p.ammo + w.p.rockets + w.p.shells !== a) shot.current = 0
        for (const ev of w.events) audio.current.play(ev)
      } else if (m === 'title') {
        w.p.angle += dt * 0.18
      }
      const ren = r.current
      const S = sz.current, sc = scaleRef.current
      ren.resize(Math.floor(S.width / sc), Math.floor(S.height / sc))
      const sc2 = scene(w, g.current.sprites, t)
      ren.render(w.level, g.current.mats, sc2.cam, sc2.sprites, sc2.dyn, m === 'play' ? sc2.vm : null, m === 'title' ? [10, 12, 16, 0.35] : sc2.tint, m === 'play' ? sc2.tr : [])
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
    const w = g.current.world
    if (modeRef.current === 'title') { if (n === 'enter' || n === 'space') start(); else if (n === 't') setMode('lab'); return }
    if (modeRef.current === 'lab') { if (n === 't' || n === 'escape' || n === 'enter') setMode('play'); return }
    if (w.state !== 'play') { if (n === 'enter' || n === 'r') restart(); else if (n === 'n') restart((w.level.seed * 48271) % 2147483647); return }
    if (n === '1') w.swap(0)
    else if (n === '2') w.swap(1)
    else if (n === '3') w.swap(2)
    else if (n === 'tab' || n === 'x') w.swap()
    else if (n === 'r') setScale((s) => (s === 2 ? 3 : s === 3 ? 4 : 2))
    else if (n === 'm') audio.current.toggleMusic()
    else if (n === 'p') setPerf((v) => !v)
    else if (n === 'b') r.current.bloom = !r.current.bloom
    else if (n === 't') setMode('lab')
    else if (n === 'escape') setMode('title')
    held.current.add(n)
  }
  const onKeyUp = (e: any) => {
    held.current.delete(keyName(e))
  }
  const onMouseDown = (e: any) => {
    if (modeRef.current === 'title') { start(); return }
    if (modeRef.current === 'lab') return
    if (g.current.world.state !== 'play') { restart(); return }
    drag.current = { x: e.x, y: e.y, moved: 0 }
    shot.current = performance.now() + 400
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
      {mode === 'play' && <Hud hud={hud} faces={g.current.sprites.faces} W={W} H={H} fs={fs} small={small} perf={perf} />}
      {mode === 'title' && <Title hud={hud} W={W} H={H} small={small} opts={opts} audioMs={audio.current.ms} audioOn={audio.current.enabled} />}
      {mode === 'lab' && <Lab boot={g.current} W={W} H={H} small={small} />}
    </div>
  )
}

function snap(b: Boot, fps: number, ms: number, rw = 0, rh = 0) {
  const w = b.world, p = w.p
  return {
    fps, ms, rw, rh, hp: Math.ceil(p.hp), ammo: p.ammo, shells: p.shells, rockets: p.rockets, weapon: p.weapon, key: p.hasKey, kills: w.kills, total: w.monsters,
    face: (p.hp <= 50 ? 6 : 0) + (w.state === 'dead' ? 5 : p.hurt > 0.45 ? 3 : p.killT > 0.3 ? 4 : [0, 1, 0, 2][Math.floor(w.time / 1.3) % 4]!),
    time: w.time, state: w.state, toast: w.toast.t > 0 ? w.toast.text : '', seed: w.level.seed, timings: b.timings,
    hit: p.hitT, kill: p.killT,
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

function Hud({ hud, faces, W, H, fs, small, perf }: { hud: HudState; faces: Sprite[]; W: number; H: number; fs: number; small: boolean; perf: boolean }) {
  const pad = small ? 10 : 18
  const hpColor = hud.hp > 50 ? T.green : hud.hp > 25 ? T.amber : T.red
  // Hit marker: the crosshair opens up and turns amber on a hit, red on a kill.
  const sp = Math.round(Math.max(hud.hit, hud.kill) * 4), xc = hud.kill > 0.05 ? T.red : hud.hit > 0.05 ? T.amber : T.fg
  return (
    <>
      <div style={{ ...ov, left: W / 2 - 13, top: H / 2 - 13, width: 26, height: 26 }}>
        {[[12, 4 - sp, 2, 6], [12, 16 + sp, 2, 6], [4 - sp, 12, 6, 2], [16 + sp, 12, 6, 2]].map(([l, t, w, h], i) => (
          <div key={i} style={{ ...ov, left: l, top: t, width: w, height: h, backgroundColor: xc }} />
        ))}
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
      <StatusBar hud={hud} faces={faces} W={W} small={small} hpColor={hpColor} />
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

const AMMO = [['SHELLS', 'shells'], ['BULLETS', 'ammo'], ['ROCKETS', 'rockets']] as const

// Doom-style status bar: ammo, health, arms, the reacting face, key and kills.
function StatusBar({ hud, faces, W, small, hpColor }: { hud: HudState; faces: Sprite[]; W: number; small: boolean; hpColor: string }) {
  const bh = small ? 58 : 76, big = small ? 22 : 30, lab = small ? 9 : 11, wc = [T.amber, T.blue, T.green][hud.weapon]!
  const cell = (label: string, body: any, w: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, width: w }}>
      {body}
      <text style={txt(T.mute, lab)}>{label}</text>
    </div>
  )
  return (
    <div style={{ ...ov, left: 0, bottom: 0, width: W, height: bh, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: small ? 8 : 22, backgroundColor: '#0a0c10e0', borderTopWidth: 1, borderColor: T.line }}>
      {cell(WEAPONS[hud.weapon]!.name, <text style={txt(wc, big, { fontWeight: 700 })}>{`${hud[AMMO[hud.weapon]![1]]}`}</text>, small ? 70 : 130)}
      {cell('HEALTH', <text style={txt(hpColor, big, { fontWeight: 700 })}>{`${hud.hp}%`}</text>, small ? 56 : 90)}
      {!small && cell('ARMS', <div style={{ display: 'flex', gap: 4 }}>{[1, 2, 3].map((n) => (
        <div key={n} style={{ width: 20, height: 20, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: hud.weapon === n - 1 ? '#ffffff1f' : '#00000000', borderWidth: 1, borderColor: hud.weapon === n - 1 ? wc : T.line }}>
          <text style={txt(hud.weapon === n - 1 ? wc : T.dim, 12, { fontWeight: 700 })}>{`${n}`}</text>
        </div>))}</div>, 80)}
      <div style={{ display: 'flex', width: bh - 8, height: bh - 6, borderRadius: 4, backgroundColor: '#161b22', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: hud.face % 6 === 3 ? T.red : T.line }}>
        <Face img={faces[hud.face]!} size={bh - 16} />
      </div>
      {cell('KILLS', <text style={txt(T.fg, small ? 16 : 20, { fontWeight: 700 })}>{`${hud.kills}/${hud.total}`}</text>, small ? 50 : 80)}
      {cell('KEY', <div style={{ width: small ? 12 : 16, height: small ? 12 : 16, borderRadius: 3, backgroundColor: hud.key ? T.amber : '#00000000', borderWidth: 2, borderColor: hud.key ? T.amber : T.line }} />, small ? 30 : 50)}
      {!small && <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 110 }}>
        {AMMO.map(([n, k], i) => (
          <div key={n} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <text style={txt(hud.weapon === i ? wc : T.mute, 11)}>{n}</text>
            <text style={txt(hud.weapon === i ? wc : T.dim, 11, { fontWeight: 700 })}>{`${hud[k]}`}</text>
          </div>))}
      </div>}
    </div>
  )
}

function Face({ img, size }: { img: Sprite; size: number }) {
  const ref = useRef<ImgInstance>(null)
  useLayoutEffect(() => { ref.current?.setImagePixels(img.w, img.h, new Uint8Array(img.px.buffer, img.px.byteOffset, img.px.byteLength), { format: 'bgra' }) }, [img])
  return <img ref={ref} objectFit="fill" style={{ width: Math.round(size * img.w / img.h), height: size }} />
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
    ['sprites', `3 monsters · 3 weapons · ${t.sprites.toFixed(0)} ms`],
    ['audio', audioOn ? `synth → wav · ${audioMs.toFixed(0)} ms` : 'muted'],
    ['assets', '0 files'],
  ]
  if (opts.size) rows.push(['bundle', `${(opts.size.packed / 1024).toFixed(1)} KB packed · ${(opts.size.bytes / 1024).toFixed(1)} KB min`])
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
      {!small && <text style={txt(T.mute, 12)}>{`WASD move · drag look · click fire · space jump · c crouch · 1/2/3 weapon · t texture lab · r quality`}</text>}
    </div>
  )
}

function Lab({ boot: b, W, H, small }: { boot: Boot; W: number; H: number; small: boolean }) {
  // Pick the column count that gives the biggest swatch while every label row still fits the pane.
  const n = b.mats.length, GAP = 16, LABEL = 58
  let cols = 3, cell = 0
  for (let c = small ? 2 : 3; c <= 8; c++) {
    const rows = Math.ceil(n / c)
    const s = Math.floor(Math.min((W - 40 - GAP * (c - 1)) / c, (H - 40 - 36 - GAP * (rows - 1)) / rows - LABEL))
    if (s > cell) { cell = s; cols = c }
  }
  cell = Math.max(32, cell)
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: T.bg, display: 'flex', flexDirection: 'column', padding: 20, gap: 12 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
        <text style={txt(T.fg, 18, { fontWeight: 700 })}>{`Texture lab`}</text>
        <text style={txt(T.mute, 13)}>{`every surface is a short op list run at boot · t to return`}</text>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: GAP, width: cols * cell + GAP * (cols - 1) }}>
        {b.mats.map((tex, i) => <Swatch key={i} i={i} tex={tex} size={cell} />)}
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
