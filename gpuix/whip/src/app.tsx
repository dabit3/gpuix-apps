import { useCallback, useEffect, useRef, useState } from 'react'
import { useGpuixRequired, useWindowSize, type ImgInstance, type PublicInstance, type KeyEvent } from '@gpuix/react'
import { STEP, Whip, type Crack } from './physics'
import { WhipCanvas, hex, makeFlash, type Flash } from './raster'
import { MessagePicker, RateLimiter } from './messages'
import { AgentLink, type AgentInfo, type LogEntry } from './link'
import { playCrack } from './sound'
import { loadSettings, saveSettings, type Settings } from './settings'
import { MONO, T } from './theme'

export interface AppProps {
  armed?: boolean
  polite?: boolean
  sound?: boolean
  length?: number
  intro?: boolean
  targets?: string[]
  link?: AgentLink
  persist?: boolean
  loop?: boolean
}

interface Popup {
  id: number
  x: number
  y: number
  text: string
  color: string
}

const WHITE = hex('#f0f3f6')
const OUTLINE = hex('#010409', 0.95)
const GRIP = hex('#9ea7b3')
const SHADOW = hex('#000000', 0.35)
const FLASH = hex('#ffffff', 0.95)

export function effectiveLength(setting: number, w: number, h: number) {
  return Math.round(Math.min(setting, Math.max(120, 0.62 * Math.min(w, h))))
}

export function keyName(e: KeyEvent): string {
  const ch = e.keyChar && e.keyChar.length === 1 && e.keyChar !== ' ' ? e.keyChar.toLowerCase() : ''
  return ch || (e.key ?? '').toLowerCase()
}

export function App(props: AppProps) {
  const renderer = useGpuixRequired()
  const size = useWindowSize()
  const W = Math.max(200, Math.floor(size.width))
  const H = Math.max(160, Math.floor(size.height))

  const [settings, setSettings] = useState<Settings>(() => {
    const s = props.persist === false ? loadDefaults() : loadSettings()
    return {
      ...s,
      polite: props.polite ?? s.polite,
      sound: props.sound ?? s.sound,
      length: props.length ?? s.length,
    }
  })
  const [armed, setArmed] = useState(!!props.armed)
  const [intro, setIntro] = useState(() => !!props.intro || !settings.seenIntro)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [showLog, setShowLog] = useState(true)
  const [popups, setPopups] = useState<Popup[]>([])
  const [stats, setStats] = useState({ cracks: 0, tip: 0, best: 0, injected: 0 })

  const rootRef = useRef<PublicInstance>(null)
  const imgRef = useRef<ImgInstance>(null)
  const s = useRef({ settings, armed, intro, selected, agents, W, H })
  s.current = { settings, armed, intro, selected, agents, W, H }

  const linkRef = useRef<AgentLink | null>(null)
  if (!linkRef.current) linkRef.current = props.link ?? new AgentLink(undefined, props.targets ?? [])
  const link = linkRef.current

  const sim = useRef<{
    whip: Whip
    canvas: WhipCanvas
    flashes: Flash[]
    shake: number
    cracks: number
    best: number
    picker: MessagePicker
    limiter: RateLimiter
    popupId: number
    dirty: boolean
  } | null>(null)
  if (!sim.current) {
    const len = effectiveLength(settings.length, W, H)
    sim.current = {
      whip: new Whip(W * 0.5, H * 0.3, { length: len, crackSpeed: 8.3 * len }),
      canvas: new WhipCanvas(),
      flashes: [],
      shake: 0,
      cracks: 0,
      best: 0,
      picker: new MessagePicker(),
      limiter: new RateLimiter(2000),
      popupId: 1,
      dirty: true,
    }
  }

  const persist = useCallback(
    (next: Settings) => {
      setSettings(next)
      if (props.persist !== false) saveSettings(next)
    },
    [props.persist],
  )

  const popup = useCallback((x: number, y: number, text: string, color: string) => {
    const st = sim.current!
    const id = st.popupId++
    setPopups((p) => [...p.slice(-3), { id, x, y, text, color }])
    setTimeout(() => setPopups((p) => p.filter((q) => q.id !== id)), 1100)
  }, [])

  const onCrack = useCallback(
    (c: Crack) => {
      const st = sim.current!
      const { settings, armed, selected, agents } = s.current
      st.cracks++
      st.best = Math.max(st.best, c.speed)
      st.flashes.push(makeFlash(c.x, c.y, performance.now()))
      st.shake = 2
      if (settings.sound) playCrack()
      if (!armed) {
        link.log('crack', `crack ${Math.round(c.speed)} px/s · disarmed · 0 events`)
        popup(c.x, c.y, 'crack', T.fg)
        return
      }
      const target = agents.find((a) => a.key === selected) ?? agents.find((a) => a.key === link.preferred()) ?? agents[0]
      if (!target) {
        link.log('blocked', 'crack · no agent on a leash')
        popup(c.x, c.y, 'crack', T.fg)
        return
      }
      if (!st.limiter.take(performance.now())) {
        link.log('rate', 'crack · rate limited (1 per 2 s)')
        popup(c.x, c.y, 'easy…', T.dim)
        return
      }
      const msg = st.picker.pick(settings.polite ? settings.messages.polite : settings.messages.spicy)
      link.nudge(target.key, msg)
      popup(c.x, c.y, `→ ${msg}`, settings.polite ? T.green : T.red)
    },
    [link, popup],
  )

  useEffect(() => {
    link.onChange = () => {
      setAgents(link.list())
      setStats((v) => ({ ...v, injected: link.injected }))
    }
    link.onLog = (e) => setLog((l) => [...l.slice(-7), e])
    link.start()
    return () => link.stop()
  }, [link])

  useEffect(() => {
    const st = sim.current!
    const len = effectiveLength(settings.length, W, H)
    st.whip.setLength(len)
    st.whip.opts.crackSpeed = 8.3 * len
    if (st.whip.targetX > W - 20 || st.whip.targetY > H - 20) st.whip.pointTo(Math.min(st.whip.targetX, W * 0.45), Math.min(st.whip.targetY, H * 0.3))
    st.dirty = true
  }, [settings.length, W, H])

  useEffect(() => {
    if (props.loop === false) return
    const st = sim.current!
    let last = performance.now()
    let acc = 0
    let lastPaint = 0
    const timer = setInterval(() => {
      const now = performance.now()
      acc += Math.min(0.1, (now - last) / 1000)
      last = now
      let crack: Crack | null = null
      while (acc >= STEP) {
        crack = st.whip.step(STEP) ?? crack
        acc -= STEP
      }
      if (crack) onCrack(crack)
      if (now - lastPaint < 15) return
      st.flashes = st.flashes.filter((f) => now - f.born < f.life)
      const moving = st.whip.motion() > 0.05
      if (!moving && st.flashes.length === 0 && !st.dirty && st.shake === 0) return
      lastPaint = now
      st.dirty = false
      const { W, H } = s.current
      st.canvas.resize(W, H)
      st.canvas.begin()
      let ox = 0
      let oy = 0
      if (st.shake > 0) {
        ox = (Math.random() - 0.5) * 8
        oy = (Math.random() - 0.5) * 8
        st.shake--
      }
      st.canvas.whip(st.whip.x, st.whip.y, { thick: 5.5, thin: 0.9, fill: WHITE, outline: OUTLINE, grip: GRIP, shadow: SHADOW, ox, oy })
      for (const f of st.flashes) st.canvas.flash(f, now, FLASH)
      st.canvas.end()
      imgRef.current?.setImagePixels(st.canvas.width, st.canvas.height, st.canvas.pixels)
    }, 8)
    const statsTimer = setInterval(() => {
      setStats((v) => {
        const tip = Math.round(st.whip.tipSpeed / 10) * 10
        const best = Math.round(st.best)
        if (v.tip === tip && v.best === best && v.cracks === st.cracks) return v
        return { ...v, tip, best, cracks: st.cracks }
      })
    }, 120)
    return () => {
      clearInterval(timer)
      clearInterval(statsTimer)
    }
  }, [onCrack, props.loop])

  const refocus = useCallback(() => {
    if (rootRef.current) renderer.focusElement?.(rootRef.current.id)
  }, [renderer])

  const dismissIntro = useCallback(() => {
    setIntro(false)
    persist({ ...s.current.settings, seenIntro: true })
  }, [persist])

  const toggleArm = useCallback(() => {
    setArmed((a) => {
      link.log(a ? 'blocked' : 'link', a ? 'disarmed · whip is visual only' : 'armed · cracks nudge the target')
      return !a
    })
  }, [link])

  const cycleTarget = useCallback(() => {
    const list = s.current.agents
    if (list.length === 0) return
    const i = list.findIndex((a) => a.key === s.current.selected)
    setSelected(list[(i + 1) % list.length].key)
  }, [])

  const lastKey = useRef({ k: '', t: 0 })
  const onKey = useCallback(
    (e: KeyEvent) => {
      const k = keyName(e)
      const now = performance.now()
      if (lastKey.current.k === k && now - lastKey.current.t < 40) return
      lastKey.current = { k, t: now }
      const st = s.current
      if (st.intro) {
        if (k === 'enter' || k === 'escape' || k === 'return' || k === 'space' || k === ' ') dismissIntro()
        return
      }
      if (k === 'w' && e.modifiers?.ctrl && e.modifiers?.alt) return toggleArm()
      if (e.modifiers?.ctrl || e.modifiers?.cmd) return
      if (k === 'a') toggleArm()
      else if (k === 'p') persist({ ...st.settings, polite: !st.settings.polite })
      else if (k === 's') persist({ ...st.settings, sound: !st.settings.sound })
      else if (k === '[') persist({ ...st.settings, length: Math.max(120, st.settings.length - 40) })
      else if (k === ']') persist({ ...st.settings, length: Math.min(900, st.settings.length + 40) })
      else if (k === 'l') setShowLog((v) => !v)
      else if (k === 't' || k === 'tab') cycleTarget()
      else if (k === '?') setIntro(true)
    },
    [dismissIntro, toggleArm, persist, cycleTarget],
  )
  useEffect(() => {
    ;(globalThis as any).__whipKey = onKey
  }, [onKey])

  const len = effectiveLength(settings.length, W, H)
  const target = agents.find((a) => a.key === selected) ?? agents.find((a) => a.key === link.preferred()) ?? agents[0]
  const narrow = W < 760

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      autoFocus
      onKeyDown={onKey}
      onMouseMove={(e) => {
        if (e.x != null && e.y != null) sim.current!.whip.pointTo(e.x, e.y)
      }}
      onMouseDown={(e) => {
        if (e.x != null && e.y != null) sim.current!.whip.pointTo(e.x, e.y)
        refocus()
      }}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: T.bg, position: 'relative', overflow: 'hidden' }}
    >
      <TopBar
        armed={armed}
        polite={settings.polite}
        sound={settings.sound}
        length={len}
        narrow={narrow}
        onArm={toggleArm}
        onPolite={() => persist({ ...settings, polite: !settings.polite })}
        onSound={() => persist({ ...settings, sound: !settings.sound })}
      />
      <div style={{ display: 'flex', flexGrow: 1, position: 'relative', minHeight: 0 }}>
        <div style={{ position: 'absolute', top: 14, right: 16, display: 'flex', flexDirection: 'column', gap: 10, width: narrow ? Math.min(300, W - 32) : 300 }}>
          {agents.length === 0 ? (
            <EmptyAgent />
          ) : (
            agents.map((a) => (
              <AgentCard key={a.key} agent={a} selected={target?.key === a.key} armed={armed} onSelect={() => setSelected(a.key)} />
            ))
          )}
        </div>
        {stats.cracks === 0 && !intro && !narrow && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 28, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <text style={{ color: T.faint, fontSize: 13 }}>move the mouse · flick it hard to crack</text>
          </div>
        )}
        {showLog && <EventLog log={log} injected={stats.injected} narrow={narrow} />}
      </div>
      <BottomBar stats={stats} narrow={narrow} />
      <img
        ref={imgRef}
        testId="whip-canvas"
        objectFit="fill"
        style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, pointerEvents: 'none' }}
      />
      {popups.map((p) => (
        <div
          key={p.id}
          style={{ position: 'absolute', left: Math.min(W - 260, Math.max(8, p.x + 14)), top: Math.min(H - 120, Math.max(96, p.y - 30)), pointerEvents: 'none', display: 'flex' }}
        >
          <text style={{ color: p.color, fontSize: 15, fontWeight: 600 }}>{p.text}</text>
        </div>
      ))}
      {intro && <Intro onClose={dismissIntro} />}
      <text testId="readout" style={{ position: 'absolute', left: -2000, top: 0, color: T.bg, fontSize: 1 }}>
        {`armed=${armed} polite=${settings.polite} sound=${settings.sound} len=${len} agents=${agents.length} cracks=${stats.cracks} injected=${stats.injected} intro=${intro}`}
      </text>
    </div>
  )
}

function loadDefaults(): Settings {
  return { polite: true, sound: false, length: 420, messages: { polite: ["Please continue, you're doing great", 'Keep going'], spicy: ['FASTER', 'Work FASTER', 'faster clanker', 'speed it up', 'go go go'] }, seenIntro: true }
}

function Pill(props: { label: string; color: string; bg?: string; border?: string; onClick?: () => void; testId?: string; dot?: boolean }) {
  return (
    <div
      testId={props.testId}
      onClick={props.onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        paddingLeft: 11,
        paddingRight: 11,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: props.border ?? T.line,
        backgroundColor: props.bg ?? 'transparent',
        cursor: 'pointer',
        hover: { borderColor: T.lineHi },
      }}
    >
      {props.dot && <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: props.color }} />}
      <text style={{ color: props.color, fontSize: 12, fontWeight: 600 }}>{props.label}</text>
    </div>
  )
}

function TopBar(p: { armed: boolean; polite: boolean; sound: boolean; length: number; narrow: boolean; onArm: () => void; onPolite: () => void; onSound: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, paddingLeft: 18, paddingRight: 16, borderBottomWidth: 1, borderColor: T.line, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <text style={{ color: T.fg, fontSize: 17, fontWeight: 700 }}>whip</text>
        {!p.narrow && <text style={{ color: T.faint, fontSize: 13 }}>a toy for terminal agents</text>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Pill testId="pill-arm" dot label={p.armed ? 'ARMED' : 'DISARMED'} color={p.armed ? T.red : T.dim} border={p.armed ? T.red : T.line} bg={p.armed ? '#ff949218' : undefined} onClick={p.onArm} />
        <Pill testId="pill-mode" label={p.polite ? 'polite' : 'spicy'} color={p.polite ? T.green : T.yellow} onClick={p.onPolite} />
        {!p.narrow && <Pill testId="pill-sound" label={p.sound ? 'sound on' : 'muted'} color={p.sound ? T.fg : T.faint} onClick={p.onSound} />}
        {!p.narrow && <Pill label={`${p.length} px`} color={T.dim} />}
      </div>
    </div>
  )
}

function EmptyAgent() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: T.line, borderStyle: 'dashed', backgroundColor: T.panel }}>
      <text style={{ color: T.dim, fontSize: 13, fontWeight: 600 }}>No agent on a leash</text>
      <text style={{ color: T.faint, fontSize: 12 }}>In another split, run your agent through whip:</text>
      <div style={{ display: 'flex', paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: T.raised }}>
        <text style={{ color: T.blue, fontSize: 12, fontFamily: MONO }}>whip -- claude</text>
      </div>
    </div>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const n = 40
  const pad = Array(Math.max(0, n - values.length)).fill(0).concat(values.slice(-n))
  const max = Math.max(400, ...pad)
  return (
    <div style={{ display: 'flex', alignItems: 'end', gap: 2, height: 28 }}>
      {pad.map((v, i) => (
        <div key={i} style={{ width: 4, height: Math.max(2, Math.round((v / max) * 28)), borderRadius: 1, backgroundColor: v > 0 ? color : T.line }} />
      ))}
    </div>
  )
}

function AgentCard(p: { agent: AgentInfo; selected: boolean; armed: boolean; onSelect: () => void }) {
  const a = p.agent
  const live = a.activity.slice(-4).some((v) => v > 0)
  return (
    <div
      testId={`agent-${a.name}`}
      onClick={p.onSelect}
      style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: p.selected ? (p.armed ? T.red : T.blue) : T.line, backgroundColor: T.panel, cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live ? T.green : T.faint }} />
          <text style={{ color: T.fg, fontSize: 14, fontWeight: 700 }}>{a.name}</text>
        </div>
        <text style={{ color: a.nudges ? T.yellow : T.faint, fontSize: 12 }}>{`${a.nudges} nudge${a.nudges === 1 ? '' : 's'}`}</text>
      </div>
      <text style={{ color: T.faint, fontSize: 11, fontFamily: MONO }}>{a.kind === 'file' ? `hook → ${a.tty}` : `pid ${a.pid} · ${a.tty || 'pty'}`}</text>
      {a.kind === 'leash' && <Sparkline values={a.activity} color={live ? T.green : T.faint} />}
    </div>
  )
}

const KIND: Record<string, { tag: string; color: string }> = {
  esc: { tag: 'ESC', color: T.red },
  text: { tag: 'TYPE', color: T.yellow },
  enter: { tag: 'ENTER', color: T.green },
  hook: { tag: 'HOOK', color: T.yellow },
  crack: { tag: 'CRACK', color: T.dim },
  blocked: { tag: 'SAFE', color: T.dim },
  rate: { tag: 'WAIT', color: T.dim },
  link: { tag: 'LINK', color: T.blue },
  unlink: { tag: 'LEFT', color: T.faint },
}

function EventLog({ log, injected, narrow }: { log: LogEntry[]; injected: number; narrow: boolean }) {
  return (
    <div style={{ position: 'absolute', right: 16, bottom: 14, width: narrow ? 300 : 380, display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: T.line, backgroundColor: T.panel, pointerEvents: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <text style={{ color: T.faint, fontSize: 11, fontWeight: 700 }}>INJECTED EVENTS</text>
        <text testId="injected-count" style={{ color: injected ? T.fg : T.faint, fontSize: 11, fontFamily: MONO }}>{String(injected)}</text>
      </div>
      {log.length === 0 && <text style={{ color: T.faint, fontSize: 12, fontFamily: MONO }}>nothing sent</text>}
      {log.slice(narrow ? -5 : -7).map((e) => {
        const k = KIND[e.kind] ?? KIND.crack
        return (
          <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <text style={{ color: T.faint, fontSize: 11, fontFamily: MONO }}>{new Date(e.at).toTimeString().slice(0, 8)}</text>
            <div style={{ display: 'flex', width: 44 }}>
              <text style={{ color: k.color, fontSize: 11, fontWeight: 700, fontFamily: MONO }}>{k.tag}</text>
            </div>
            <text style={{ color: T.dim, fontSize: 11, fontFamily: MONO }}>{clip(e.text, narrow ? 24 : 34)}</text>
          </div>
        )
      })}
    </div>
  )
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function Key({ k, label }: { k: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', paddingLeft: 6, paddingRight: 6, height: 18, alignItems: 'center', borderRadius: 4, borderWidth: 1, borderColor: T.line }}>
        <text style={{ color: T.dim, fontSize: 11, fontFamily: MONO }}>{k}</text>
      </div>
      <text style={{ color: T.faint, fontSize: 12 }}>{label}</text>
    </div>
  )
}

function BottomBar({ stats, narrow }: { stats: { cracks: number; tip: number; best: number; injected: number }; narrow: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 40, paddingLeft: 18, paddingRight: 16, borderTopWidth: 1, borderColor: T.line, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 14 }}>
        <Key k="a" label="arm" />
        <Key k="p" label="mode" />
        {!narrow && <Key k="s" label="sound" />}
        {!narrow && <Key k="[ ]" label="length" />}
        {!narrow && <Key k="l" label="log" />}
        <Key k="^C" label="quit" />
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <text testId="cracks" style={{ color: T.dim, fontSize: 12, fontFamily: MONO }}>{`cracks ${stats.cracks}`}</text>
        {!narrow && <text style={{ color: T.dim, fontSize: 12, fontFamily: MONO }}>{`tip ${stats.tip.toLocaleString('en-US')} px/s`}</text>}
        <text style={{ color: T.fg, fontSize: 12, fontFamily: MONO }}>{`best ${stats.best.toLocaleString('en-US')}`}</text>
      </div>
    </div>
  )
}

function Intro({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0c10e6' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 470, padding: 24, borderRadius: 16, borderWidth: 1, borderColor: T.line, backgroundColor: T.panel }}>
        <text style={{ color: T.fg, fontSize: 18, fontWeight: 700 }}>whip sends keystrokes</text>
        <text style={{ color: T.dim, fontSize: 13 }}>It's a toy. When armed, each crack sends exactly three things to an agent you started with whip: Esc, one message, Enter.</text>
        <div style={{ display: 'flex', paddingLeft: 10, paddingTop: 7, paddingBottom: 7, borderRadius: 6, backgroundColor: T.raised }}>
          <text style={{ color: T.blue, fontSize: 12, fontFamily: MONO }}>whip -- claude</text>
        </div>
        <text style={{ color: T.dim, fontSize: 13 }}>It starts disarmed, sends at most one nudge every 2 seconds, never touches other windows, and has no network access.</text>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div testId="intro-ok" onClick={onClose} style={{ display: 'flex', paddingLeft: 16, paddingRight: 16, height: 32, alignItems: 'center', borderRadius: 8, backgroundColor: T.fg, cursor: 'pointer' }}>
            <text style={{ color: T.bg, fontSize: 13, fontWeight: 700 }}>Got it</text>
          </div>
        </div>
      </div>
    </div>
  )
}
