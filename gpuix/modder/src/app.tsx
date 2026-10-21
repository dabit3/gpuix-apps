import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useWindowSize, type ImgInstance } from '@gpuix/react'
import { GameController } from '../game/app'
import { FB, H as GH, W as GW, upscale } from '../game/fb'
import { normKey, type KeyLike } from './keys'
import type { Recon } from './recon'
import { COLORS, TEMPLATES, type TemplateId } from './templates'
import { alpha, type Theme } from './theme'
import { Workbench } from './workbench'

export const TABS = ['Recon', 'Hooks', 'Mod', 'Build', 'Play'] as const
export type Tab = (typeof TABS)[number]
const MONO = 'Menlo'

export interface AppProps { targets: string[]; theme: Theme; workspace?: (dir: string) => string | undefined; yes?: boolean; live?: boolean; initialTab?: Tab }

const riskColor = (t: Theme, r: Recon['risk']) => (r === 'ok' ? t.good : r === 'refuse' ? t.bad : t.warn)
const riskLabel = (r: Recon['risk']) => (r === 'ok' ? 'moddable' : r === 'refuse' ? 'refused' : 'plan only')

function Btn({ t, label, onClick, primary, disabled, testId, small }: { t: Theme; label: string; onClick?: () => void; primary?: boolean; disabled?: boolean; testId?: string; small?: boolean }) {
  const bg = disabled ? t.panel : primary ? t.accent : t.panel2
  return (
    <div testId={testId} onClick={disabled ? undefined : onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: small ? 26 : 32, paddingLeft: small ? 10 : 14, paddingRight: small ? 10 : 14, borderRadius: 7, backgroundColor: bg, borderWidth: 1, borderColor: primary ? t.accent : t.line, cursor: disabled ? 'default' : 'pointer', hover: disabled ? undefined : { backgroundColor: primary ? alpha(t.accent, 0.85) : t.line } }}>
      <text style={{ color: disabled ? t.faint : primary ? t.bg : t.fg, fontSize: small ? 12 : 13, fontWeight: 600 }}>{label}</text>
    </div>
  )
}

function Card({ t, title, right, children, grow, testId, minH }: { t: Theme; title: string; right?: ReactNode; children: ReactNode; grow?: boolean; testId?: string; minH?: number }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', backgroundColor: t.panel, borderRadius: 10, borderWidth: 1, borderColor: t.line, padding: 14, gap: 10, flexGrow: grow ? 1 : 0, flexShrink: grow ? 1 : 0, minWidth: 0, minHeight: minH ?? 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <text style={{ color: t.dim, fontSize: 11, fontWeight: 700 }}>{title.toUpperCase()}</text>
        <div style={{ flexGrow: 1 }} />
        {right}
      </div>
      {children}
    </div>
  )
}

function Row({ t, k, v, color, mono }: { t: Theme; k: string; v: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 12, minWidth: 0 }}>
      <text style={{ color: t.faint, fontSize: 13, width: 92, flexShrink: 0 }}>{k}</text>
      <text style={{ color: color ?? t.fg, fontSize: 13, fontFamily: mono ? MONO : undefined, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{v}</text>
    </div>
  )
}

function Pixels({ rgba, w, h, dw, dh, testId }: { rgba: Uint8Array | null; w: number; h: number; dw: number; dh: number; testId?: string }) {
  const ref = useRef<ImgInstance>(null)
  useEffect(() => {
    if (!rgba) return
    // the native node can lag one commit behind a fresh <img>; retry on the next tick
    const push = () => { try { ref.current?.setImagePixels(w, h, rgba); return true } catch { return false } }
    if (push()) return
    const id = setTimeout(push, 16)
    return () => clearTimeout(id)
  }, [rgba, w, h])
  return <img testId={testId} ref={ref} objectFit="contain" style={{ width: dw, height: dh, borderRadius: 6 }} />
}

function spriteRgba(rows: string[], keys: Record<string, string>) {
  const n = rows.length, w = rows[0]!.length
  const px = new Uint8Array(w * n * 4)
  rows.forEach((r, y) => [...r].forEach((ch, x) => { const c = keys[ch]; if (c) px.set([parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255], (y * w + x) * 4) }))
  return { px, w, h: n }
}

// The game itself, running inside the workbench against the mod profile (test-in-game, live).
function LivePreview({ t, profile, w, h, live, ctrlRef }: { t: Theme; profile: string; w: number; h: number; live: boolean; ctrlRef: { current: GameController | null } }) {
  const ref = useRef<ImgInstance>(null)
  const [hud, setHud] = useState({ kills: 0, mods: '', fps: 0, lines: [] as string[], auto: true })
  const fit = Math.max(1, Math.min(w / GW, (h - 26) / GH))
  const scale = Math.max(1, Math.min(4, Math.ceil(fit)))
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  useEffect(() => {
    const c = new GameController({ profile, autopilot: true, seed: 11, logName: 'preview' })
    ctrlRef.current = c
    let alive = true, prev = performance.now(), lastPoll = 0, lastHud = 0, frames = 0, fpsT = prev
    const fb = new FB()
    let buf: { s: number; px: Uint32Array; bytes: Uint8Array } | null = null
    let timer: ReturnType<typeof setTimeout>
    void c.boot()
    const tick = () => {
      if (!alive) return
      const now = performance.now()
      c.game.update(Math.min(0.05, (now - prev) / 1000), c.input())
      prev = now
      if (now - lastPoll > 300) { lastPoll = now; void c.loader.poll() }
      c.game.render(fb)
      const s = scaleRef.current
      if (!buf || buf.s !== s) { const bytes = new Uint8Array(GW * s * GH * s * 4); buf = { s, bytes, px: new Uint32Array(bytes.buffer) } }
      upscale(fb, s, buf.px)
      try { ref.current?.setImagePixels(GW * s, GH * s, buf.bytes) } catch {}
      frames++
      if (now - fpsT > 1000) { c.fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now }
      if (now - lastHud > 200) { lastHud = now; setHud({ kills: c.game.kills, mods: c.loader.mods.map((m) => m.manifest.id).join(', '), fps: c.fps, lines: Object.values(c.game.hud).flat(), auto: c.autopilot }) }
      if (live) timer = setTimeout(tick, Math.max(1, 33 - (performance.now() - now)))
    }
    timer = setTimeout(tick, 1)
    return () => { alive = false; clearTimeout(timer); ctrlRef.current = null }
  }, [profile, live])
  const dw = Math.floor(GW * fit), dh = Math.floor(GH * fit)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ position: 'relative', width: dw, height: dh }}>
        <img testId="live-preview" ref={ref} objectFit="fill" style={{ width: dw, height: dh, borderRadius: 8 }} />
        {hud.lines.length ? (
          <div style={{ position: 'absolute', right: 8, top: 8, padding: 8, borderRadius: 7, backgroundColor: alpha(t.bg, 0.82), borderWidth: 1, borderColor: alpha(t.accent, 0.5), display: 'flex', flexDirection: 'column', gap: 2, pointerEvents: 'none' }}>
            {hud.lines.map((l, i) => <text key={i} style={{ color: i === 0 ? t.accent : t.fg, fontSize: 11, fontWeight: i === 0 ? 700 : 400 }}>{l}</text>)}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 14 }}>
        <text testId="preview-stats" style={{ color: t.fg, fontSize: 12 }}>{`${hud.kills} slain`}</text>
        <text style={{ color: hud.mods ? t.accent : t.faint, fontSize: 12 }}>{hud.mods ? `mods: ${hud.mods}` : 'no mods built yet'}</text>
        <text style={{ color: t.faint, fontSize: 12 }}>{`${hud.auto ? 'autopilot' : 'you play: WASD + space'} · ${hud.fps.toFixed(0)} fps`}</text>
      </div>
    </div>
  )
}

function tailFile(f: string, n: number) {
  try { return readFileSync(f, 'utf8').trimEnd().split('\n').slice(-n) } catch { return [] }
}

function pidAlive(pid: number) { try { process.kill(pid, 0); return true } catch { return false } }

export function ModderApp({ targets, theme: t, workspace, yes = false, live = true, initialTab = 'Recon' }: AppProps) {
  const size = useWindowSize()
  const benches = useRef(new Map<string, Workbench>())
  const bench = (dir: string) => { let b = benches.current.get(dir); if (!b) { b = new Workbench(dir, workspace?.(dir), yes); benches.current.set(dir, b) } return b }
  const [sel, setSel] = useState(0)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [hookSel, setHookSel] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [activity, setActivity] = useState<string[]>([])
  const [, bump] = useState(0)
  const [pane, setPane] = useState<{ pid: number | null; log: string[] }>({ pid: null, log: [] })
  const preview = useRef<GameController | null>(null)
  const wb = bench(targets[sel]!)
  const r = wb.recon
  const refresh = () => bump((n) => n + 1)
  const say = (m: string) => setActivity((a) => [...a.slice(-40), m])

  useEffect(() => { if (!wb.hooks.length && r.supported) wb.scan(); if (r.supported && !wb.sprite) wb.writeMod(); wb.writeRecon(); refresh() }, [sel])

  // The game started in a split pane writes <profile>/game.json and logs/latest.log; follow both.
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => {
      const gj = join(wb.profile, 'game.json')
      let pid: number | null = null
      if (existsSync(gj)) { try { const p = JSON.parse(readFileSync(gj, 'utf8')).pid; if (pidAlive(p)) pid = p } catch {} }
      const log = tailFile(join(wb.profile, 'logs', 'latest.log'), 8)
      setPane((old) => (old.pid === pid && old.log.join() === log.join() ? old : { pid, log }))
    }, 500)
    return () => clearInterval(id)
  }, [sel, live])

  const run = async (label: string, fn: () => unknown | Promise<unknown>) => {
    if (busy) return
    setBusy(label)
    try { await fn() } catch (e) { say(`✗ ${(e as Error).message}`) } finally { setBusy(null); refresh() }
  }
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, live ? ms : 0))

  const doRecon = () => run('recon', () => { wb.recon = wb.recon; wb.writeRecon(); say(`recon ${r.name}: ${r.engine} → ${r.framework}`); setTab('Recon') })
  const doHooks = () => run('hooks', () => { const res = wb.scan(); say(`hooks: ${res.note}`); setTab('Hooks') })
  const doGenerate = () => run('generate', () => { const m = wb.writeMod(); say(`write-mod: ${TEMPLATES[wb.template].title} → ${m.file.replace(process.cwd() + '/', '')}`); setTab('Mod') })
  const doBuild = () => run('build', async () => {
    wb.writeMod()
    const b = await wb.build()
    if (!b.ok) { say(`✗ build failed: ${b.error}`); setTab('Build'); return }
    say(`build ✓ ${wb.modId}/mod.js ${(b.bytes / 1024).toFixed(1)} KB in ${b.ms.toFixed(0)} ms`)
    setTab('Build')
    const tr = await wb.test()
    say(tr.ok ? `test-in-game ✓ ${tr.kills} slain, ${tr.projectiles} projectiles, log clean` : `✗ test-in-game: ${tr.errors[0] ?? 'mod did not load'}`)
  })
  const doAll = () => run('pipeline', async () => {
    setTab('Recon'); wb.writeRecon(); say(`recon ${r.name}: ${r.engine}`); refresh(); await sleep(700)
    if (!r.supported) { say(`plan only: ${r.plan[0] ?? 'no route'}`); return }
    setTab('Hooks'); say(`hooks: ${wb.scan().note}`); refresh(); await sleep(700)
    setTab('Mod'); wb.writeMod(); say(`write-mod: ${wb.knobs.name}`); refresh(); await sleep(800)
    setTab('Build'); const b = await wb.build(); say(b.ok ? `build ✓ ${(b.bytes / 1024).toFixed(1)} KB` : `✗ ${b.error}`); refresh()
    if (b.ok) { const tr = await wb.test(); say(tr.ok ? `test-in-game ✓ ${tr.kills} slain` : `✗ ${tr.errors[0]}`) }
  })
  const setColor = (c: string) => { wb.knobs.color = c; wb.sprite = null; if (wb.supported) wb.writeMod(); refresh() }
  const nudge = (k: 'count' | 'pierce' | 'speed', d: number) => {
    const lim = { count: [1, 9], pierce: [0, 6], speed: [80, 320] }[k]
    wb.knobs[k] = Math.max(lim[0]!, Math.min(lim[1]!, wb.knobs[k] + d))
    if (wb.supported) wb.writeMod()
    refresh()
  }
  const pickTemplate = (id: TemplateId) => { wb.setTemplate(id); if (wb.supported) wb.writeMod(); say(`template: ${TEMPLATES[id].title}`); refresh() }
  const pickTarget = (i: number) => { setSel(Math.max(0, Math.min(targets.length - 1, i))); setHookSel(0) }

  const onKeyDown = (e: KeyLike) => {
    const k = normKey(e)
    if (tab === 'Play' && preview.current && ['w', 'a', 's', 'd', 'space', 'up', 'down', 'p', 'q', 'e', 'h', 'j', 'x'].includes(k) && !(k === 'up' || k === 'down' ? preview.current.autopilot : false)) { preview.current.keyDown(e); return }
    const n = Number(k)
    if (n >= 1 && n <= 5) return setTab(TABS[n - 1]!)
    if (k === 'right') return setTab(TABS[(TABS.indexOf(tab) + 1) % 5]!)
    if (k === 'left') return setTab(TABS[(TABS.indexOf(tab) + 4) % 5]!)
    if (k === 'down' || k === 'j') return tab === 'Hooks' ? setHookSel((i) => Math.min(wb.hooks.length - 1, i + 1)) : pickTarget(sel + 1)
    if (k === 'up' || k === 'k') return tab === 'Hooks' ? setHookSel((i) => Math.max(0, i - 1)) : pickTarget(sel - 1)
    if (k === 'a') return void doAll()
    if (k === 'r') return void doRecon()
    if (k === 'h') return void doHooks()
    if (k === 'g' && wb.supported) return void doGenerate()
    if (k === 'b' && wb.supported) return void doBuild()
    if (k === 't' && wb.supported) { const ids = Object.keys(TEMPLATES) as TemplateId[]; return pickTemplate(ids[(ids.indexOf(wb.template) + 1) % ids.length]!) }
    if (k === 'c' && wb.supported) { const i = COLORS.findIndex(([, c]) => c === wb.knobs.color); return setColor(COLORS[(i + 1) % COLORS.length]![1]) }
    if ((k === '=' || k === '+') && wb.supported) return nudge('count', 1)
    if (k === '-' && wb.supported) return nudge('count', -1)
    if (k === ']' && wb.supported) return nudge('pierce', 1)
    if (k === '[' && wb.supported) return nudge('pierce', -1)
    if (k === 'enter') { const i = TABS.indexOf(tab); return void [doHooks, doGenerate, doBuild, () => setTab('Play'), () => {}][i]!() }
  }
  const onKeyUp = (e: KeyLike) => { if (tab === 'Play') preview.current?.keyUp(e) }

  const W = size.width, H = size.height
  const wide = W >= 1000
  const compact = W < 720
  const sideW = wide ? 250 : 0
  const pad = compact ? 10 : 16
  const mainW = W - sideW - pad * 2 - (wide ? 12 : 0)
  const headH = compact ? 78 : 50
  const footH = 30
  const bodyH = H - headH - footH - pad

  const header = (
    <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'flex-start' : 'center', gap: compact ? 8 : 14, height: headH, paddingLeft: pad, paddingRight: pad, flexShrink: 0, justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <text style={{ color: t.bg, fontSize: 13, fontWeight: 800 }}>m</text>
        </div>
        <text style={{ color: t.fg, fontSize: 15, fontWeight: 700 }}>modder</text>
        <text testId="target-name" style={{ color: t.dim, fontSize: 13 }}>{r.name}</text>
        <div style={{ display: 'flex', paddingLeft: 8, paddingRight: 8, height: 20, borderRadius: 10, alignItems: 'center', backgroundColor: alpha(riskColor(t, r.risk), 0.14) }}>
          <text testId="risk" style={{ color: riskColor(t, r.risk), fontSize: 11, fontWeight: 700 }}>{riskLabel(r.risk)}</text>
        </div>
      </div>
      {compact ? null : <div style={{ flexGrow: 1 }} />}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
        {TABS.map((name, i) => (
          <div key={name} testId={`tab-${name}`} onClick={() => setTab(name)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingLeft: compact ? 8 : 12, paddingRight: compact ? 8 : 12, borderRadius: 7, cursor: 'pointer', backgroundColor: tab === name ? t.panel2 : t.bg, borderWidth: 1, borderColor: tab === name ? t.line : t.bg, hover: { backgroundColor: t.panel2 } }}>
            <text style={{ color: tab === name ? t.accent : t.faint, fontSize: 11, fontFamily: MONO }}>{String(i + 1)}</text>
            <text style={{ color: tab === name ? t.fg : t.dim, fontSize: 13, fontWeight: tab === name ? 600 : 400 }}>{name}</text>
          </div>
        ))}
      </div>
      {compact ? null : <Btn t={t} testId="run-all" label={busy ? `${busy}…` : 'Run pipeline'} primary onClick={() => void doAll()} />}
    </div>
  )

  const sidebar = wide ? (
    <div style={{ width: sideW, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <text style={{ color: t.dim, fontSize: 11, fontWeight: 700, paddingLeft: 4 }}>{`TARGETS · ${targets.length}`}</text>
      <div testId="targets" style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'scroll', flexGrow: 1, scrollbarColor: t.line, scrollbarWidth: 4 }}>
        {targets.map((d, i) => {
          const b = bench(d)
          return (
            <div key={d} testId={`target-${i}`} onClick={() => pickTarget(i)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, paddingLeft: 10, borderRadius: 7, cursor: 'pointer', flexShrink: 0, backgroundColor: i === sel ? t.panel2 : t.bg, borderWidth: 1, borderColor: i === sel ? t.line : t.bg, hover: { backgroundColor: t.panel } }}>
              <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: riskColor(t, b.recon.risk), flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flexGrow: 1 }}>
                <text style={{ color: i === sel ? t.fg : t.dim, fontSize: 13, fontWeight: i === sel ? 600 : 400 }}>{b.recon.name}</text>
                <text style={{ color: t.faint, fontSize: 11 }}>{b.recon.engine}</text>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  ) : null

  const two = mainW >= 760
  const colW = two ? Math.floor((mainW - 12) / 2) : mainW

  let body: ReactNode
  if (tab === 'Recon') {
    body = (
      <div style={{ display: 'flex', flexDirection: two ? 'row' : 'column', gap: 12, flexGrow: 1, minHeight: 0, overflowY: two ? undefined : 'scroll' }}>
        <Card t={t} title="recon.json" testId="recon-card" grow right={<text style={{ color: t.faint, fontSize: 11, fontFamily: MONO }}>{`${r.evidence.length} signals`}</text>}>
          <Row t={t} k="engine" v={r.engine} color={t.fg} />
          <Row t={t} k="version" v={r.version ?? 'unknown'} />
          <Row t={t} k="runtime" v={r.runtime} />
          <Row t={t} k="framework" v={r.framework} color={t.accent} />
          <Row t={t} k="route" v={r.route} />
          <Row t={t} k="data" v={r.data.join(', ') || '-'} mono />
          <Row t={t} k="saves" v={r.saves.join(', ') || '-'} mono />
          <div style={{ height: 1, backgroundColor: t.line, flexShrink: 0 }} />
          {r.evidence.map((e, i) => <text key={i} style={{ color: t.dim, fontSize: 12, fontFamily: MONO }}>{e}</text>)}
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: two ? colW : undefined, flexShrink: 0 }}>
          <Card t={t} title="risk" right={<text style={{ color: riskColor(t, r.risk), fontSize: 12, fontWeight: 700 }}>{riskLabel(r.risk)}</text>}>
            {(r.notes.length ? r.notes : ['Single-player, official mod API, no network code.']).map((n, i) => <text key={i} style={{ color: r.risk === 'refuse' ? t.bad : t.fg, fontSize: 13 }}>{n}</text>)}
            <text style={{ color: t.faint, fontSize: 12 }}>{'Writes go to the workspace profile. The game folder is read-only without --yes.'}</text>
          </Card>
          <Card t={t} title="modding route" grow>
            {r.plan.map((p, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
                <text style={{ color: t.accent, fontSize: 12, fontFamily: MONO, width: 18, flexShrink: 0 }}>{String(i + 1)}</text>
                <text style={{ color: t.fg, fontSize: 13, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{p}</text>
              </div>
            ))}
            <div style={{ flexGrow: 1 }} />
            <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
              <Btn t={t} testId="btn-hooks" label="Scan hooks  ⏎" primary disabled={!r.supported} onClick={() => void doHooks()} />
            </div>
          </Card>
        </div>
      </div>
    )
  } else if (tab === 'Hooks') {
    const h = wb.hooks[Math.min(hookSel, wb.hooks.length - 1)]
    let snippet = ''
    if (h) { const lines = readFileSync(join(wb.gameDir, h.file), 'utf8').split('\n'); snippet = lines.slice(Math.max(0, h.line - 4), h.line + 5).join('\n') }
    const kc = (k: string) => (k === 'event' ? t.good : k === 'api' ? t.accent : t.warn)
    body = !wb.hooks.length ? (
      <Card t={t} title="explore-code" grow><text style={{ color: t.fg, fontSize: 14 }}>{wb.hooksNote || 'Press H to scan hook points.'}</text></Card>
    ) : (
      <div style={{ display: 'flex', flexDirection: two ? 'row' : 'column', gap: 12, flexGrow: 1, minHeight: 0 }}>
        <Card t={t} title="hook points" testId="hooks-card" grow right={<text style={{ color: t.faint, fontSize: 11 }}>{wb.hooksNote}</text>}>
          <div testId="hook-list" style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'scroll', flexGrow: 1, minHeight: 0, scrollbarColor: t.line, scrollbarWidth: 4 }}>
            {wb.hooks.map((x, i) => (
              <div key={i} testId={`hook-${i}`} onClick={() => setHookSel(i)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: 6, flexShrink: 0, cursor: 'pointer', backgroundColor: i === hookSel ? t.panel2 : t.panel, hover: { backgroundColor: t.panel2 } }}>
                <text style={{ color: kc(x.kind), fontSize: 10, fontWeight: 700, width: 50, flexShrink: 0 }}>{x.kind.toUpperCase()}</text>
                <text style={{ color: t.fg, fontSize: 13, fontFamily: MONO, width: two ? 150 : 130, flexShrink: 0 }}>{x.name}</text>
                <text style={{ color: t.dim, fontSize: 12, fontFamily: MONO, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{x.detail}</text>
              </div>
            ))}
          </div>
        </Card>
        {h ? (
          <Card t={t} title={`${h.file}:${h.line}`} testId="hook-source" grow={!two} right={<text style={{ color: t.faint, fontSize: 11 }}>read locally · never redistributed</text>}>
            <div style={{ display: 'flex', flexDirection: 'column', width: two ? colW - 30 : undefined, minWidth: 0 }}>
              <code code={snippet} language="ts" style={{ padding: 8, minWidth: 0, fontSize: 12 }} />
            </div>
            <div style={{ flexGrow: 1 }} />
            <Btn t={t} testId="btn-generate" label="Generate mod  ⏎" primary onClick={() => void doGenerate()} />
          </Card>
        ) : null}
      </div>
    )
  } else if (tab === 'Mod') {
    if (!r.supported) {
      body = <Card t={t} title="write-mod" grow><text style={{ color: t.fg, fontSize: 14 }}>{r.risk === 'refuse' ? 'Refused: anti-cheat present. modder only works on single-player, mod-friendly games.' : `${r.engine}: the ${r.framework} project would be scaffolded here. On this machine only Grovekeep runs end to end.`}</text>{r.plan.map((p, i) => <text key={i} style={{ color: t.dim, fontSize: 13 }}>{`${i + 1}. ${p}`}</text>)}</Card>
    } else {
      const src = existsSync(join(wb.srcDir, 'mod.ts')) ? readFileSync(join(wb.srcDir, 'mod.ts'), 'utf8') : ''
      const spr = wb.sprite ? spriteRgba(wb.sprite.rows, wb.sprite.keys) : null
      const k = wb.knobs
      const stepper = (label: string, key: 'count' | 'pierce' | 'speed', step: number, hint: string) => (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <text style={{ color: t.faint, fontSize: 12, width: 56 }}>{label}</text>
          <Btn t={t} small label="−" testId={`dec-${key}`} onClick={() => nudge(key, -step)} />
          <text testId={`val-${key}`} style={{ color: t.fg, fontSize: 14, fontFamily: MONO, width: 34 }}>{String(k[key])}</text>
          <Btn t={t} small label="+" testId={`inc-${key}`} onClick={() => nudge(key, step)} />
          <text style={{ color: t.faint, fontSize: 11, fontFamily: MONO }}>{hint}</text>
        </div>
      )
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexGrow: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 10, flexShrink: 0 }}>
            {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => (
              <div key={id} testId={`tpl-${id}`} onClick={() => pickTemplate(id)} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 10, borderRadius: 9, flexGrow: 1, flexBasis: 0, minWidth: 0, cursor: 'pointer', backgroundColor: wb.template === id ? t.panel2 : t.panel, borderWidth: 1, borderColor: wb.template === id ? t.accent : t.line, hover: { backgroundColor: t.panel2 } }}>
                <text style={{ color: wb.template === id ? t.fg : t.dim, fontSize: 13, fontWeight: 600 }}>{TEMPLATES[id].title}</text>
                {compact ? null : <text style={{ color: t.faint, fontSize: 11 }}>{TEMPLATES[id].walkthrough}</text>}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: two ? 'row' : 'column', gap: 12, flexGrow: 1, minHeight: 0 }}>
            <Card t={t} title={k.name} testId="knobs">
              <div style={{ display: 'flex', flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                {spr ? <Pixels testId="sprite" rgba={spr.px} w={spr.w} h={spr.h} dw={84} dh={84} /> : <div style={{ width: 84, height: 84, borderRadius: 8, backgroundColor: alpha(k.color, 0.25), display: 'flex', alignItems: 'center', justifyContent: 'center' }}><text style={{ color: k.color, fontSize: 22, fontWeight: 800 }}>{wb.template === 'hud' ? 'H' : '●'}</text></div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <text style={{ color: t.faint, fontSize: 11 }}>{wb.template === 'sword' ? 'sprite: 12×12, palette sampled from sprites.json' : wb.template === 'hud' ? 'hotkey H toggles the overlay' : 'joins the spawn table'}</text>
                  <div style={{ display: 'flex', flexDirection: 'row', gap: 7 }}>
                    {COLORS.map(([name, c]) => (
                      <div key={name} testId={`color-${name}`} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c, cursor: 'pointer', borderWidth: 2, borderColor: k.color === c ? t.fg : t.panel }} />
                    ))}
                  </div>
                </div>
              </div>
              {wb.template === 'sword' ? (<>{stepper('bolts', 'count', 1, '= / -')}{stepper('pierce', 'pierce', 1, '] / [')}{stepper('speed', 'speed', 20, 'px/s')}</>) : null}
              <div style={{ flexGrow: 1 }} />
              <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
                <Btn t={t} testId="btn-build" label={busy === 'build' ? 'Building…' : 'Build + test  B'} primary onClick={() => void doBuild()} />
              </div>
            </Card>
            <Card t={t} title={`${wb.modId}/mod.ts`} grow testId="mod-source" right={<text style={{ color: t.faint, fontSize: 11 }}>{`${src.split('\n').length} lines`}</text>}>
              <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'scroll', flexGrow: 1, minHeight: 0, scrollbarColor: t.line, scrollbarWidth: 4 }}>
                <code code={src} language="ts" style={{ padding: 6, minWidth: 0, fontSize: 12 }} />
              </div>
            </Card>
          </div>
        </div>
      )
    }
  } else if (tab === 'Build') {
    const b = wb.lastBuild, tr = wb.lastTest
    const check = (ok: boolean | null, label: string, id: string) => (
      <div style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <text testId={id} style={{ color: ok == null ? t.faint : ok ? t.good : t.bad, fontSize: 14, fontWeight: 700, width: 16 }}>{ok == null ? '·' : ok ? '✓' : '✗'}</text>
        <text style={{ color: ok == null ? t.faint : t.fg, fontSize: 13 }}>{label}</text>
      </div>
    )
    const shotW = two ? colW - 30 : mainW - 30
    body = (
      <div style={{ display: 'flex', flexDirection: two ? 'row' : 'column', gap: 12, flexGrow: 1, minHeight: 0, overflowY: two ? undefined : 'scroll' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: two ? colW : undefined, flexShrink: 0 }}>
          <Card t={t} title="build" testId="build-card" right={<Btn t={t} small testId="btn-rebuild" label={busy ? `${busy}…` : 'Rebuild'} onClick={() => void doBuild()} disabled={!r.supported} />}>
            {check(b ? b.ok : null, b ? (b.ok ? `bun build → ${wb.modId}/mod.js · ${(b.bytes / 1024).toFixed(1)} KB · ${b.ms.toFixed(0)} ms` : `build failed: ${b.error}`) : 'not built yet (press B)', 'chk-build')}
            {check(tr ? tr.log.some((l) => l.includes(`loaded ${wb.modId}`)) : null, 'mod loads through the official loader', 'chk-load')}
            {check(tr ? tr.errors.length === 0 : null, tr ? `log clean (${tr.log.length} lines, ${tr.errors.length} errors)` : 'log clean', 'chk-log')}
            {check(tr ? (wb.template === 'sword' ? tr.projectiles > 0 : tr.kills >= 0) : null, tr ? (wb.template === 'sword' ? `feature on screen: ${tr.projectiles} projectiles, ${tr.kills} slain in ${tr.seconds}s` : `${tr.seconds}s autopilot run, ${tr.kills} slain`) : 'feature visible in a screenshot', 'chk-feature')}
            {check(b ? !wb.ctx.written!.some((f) => f.startsWith(wb.gameDir + '/')) : null, 'game folder untouched (writes go to the profile)', 'chk-guard')}
          </Card>
          <Card t={t} title="test log" grow testId="test-log">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'scroll', flexGrow: 1, minHeight: 0 }}>
              {(tr?.log ?? []).slice(-14).map((l, i) => <text key={i} style={{ color: l.includes('fail') || l.includes('threw') ? t.bad : t.dim, fontSize: 12, fontFamily: MONO }}>{l}</text>)}
            </div>
          </Card>
        </div>
        <Card t={t} title="screenshot" grow testId="shot-card" right={<text style={{ color: t.faint, fontSize: 11, fontFamily: MONO }}>{tr ? tr.screenshot.split('/').slice(-2).join('/') : ''}</text>}>
          {tr ? <Pixels testId="screenshot" rgba={tr.rgba} w={tr.w} h={tr.h} dw={shotW} dh={Math.round((shotW * 9) / 16)} /> : <text style={{ color: t.faint, fontSize: 13 }}>Build + test captures a frame from the real engine running the mod.</text>}
          <div style={{ flexGrow: 1 }} />
          <Btn t={t} testId="btn-play" label="Play with mod  ⏎" primary disabled={!tr?.ok} onClick={() => setTab('Play')} />
        </Card>
      </div>
    )
  } else {
    const previewW = two ? mainW - 300 : mainW - 30
    body = (
      <div style={{ display: 'flex', flexDirection: two ? 'row' : 'column', gap: 12, flexGrow: 1, minHeight: 0 }}>
        <Card t={t} title="grovekeep · in-workbench" grow testId="play-card" right={<text style={{ color: t.faint, fontSize: 11 }}>P autopilot · Q weapon · E spawn</text>}>
          {r.supported ? <LivePreview t={t} profile={wb.profile} w={previewW} h={bodyH - 90} live={live} ctrlRef={preview} /> : <text style={{ color: t.faint, fontSize: 13 }}>Only Grovekeep can be launched here.</text>}
        </Card>
        <Card t={t} title="split pane" testId="pane-card" right={<text testId="pane-status" style={{ color: pane.pid ? t.good : t.faint, fontSize: 11, fontWeight: 700 }}>{pane.pid ? `live · pid ${pane.pid}` : 'not running'}</text>}>
          <div style={{ display: 'flex', flexDirection: 'column', width: two ? 260 : undefined, gap: 8 }}>
            <text style={{ color: t.dim, fontSize: 12 }}>Run the game with this profile in another pane. Rebuilds hot-reload into it.</text>
            <div style={{ backgroundColor: t.bg, borderRadius: 6, padding: 8 }}>
              <text style={{ color: t.good, fontSize: 12, fontFamily: MONO }}>{`❯ ${wb.launchCommand()}`}</text>
            </div>
            {pane.log.map((l, i) => <text key={i} style={{ color: l.includes('ERROR') || l.includes('error') ? t.bad : t.dim, fontSize: 11, fontFamily: MONO }}>{l.replace(/^\S+T(\d\d:\d\d:\d\d)\.\d+Z/, '$1')}</text>)}
          </div>
        </Card>
      </div>
    )
  }

  const last = activity[activity.length - 1]
  return (
    <div tabIndex={-1} autoFocus onKeyDown={onKeyDown} onKeyUp={onKeyUp} style={{ width: W, height: H, backgroundColor: t.bg, display: 'flex', flexDirection: 'column' }}>
      {header}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 12, paddingLeft: pad, paddingRight: pad, height: bodyH, minHeight: 0 }}>
        {sidebar}
        <div testId="main" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0 }}>{body}</div>
      </div>
      <div style={{ height: footH, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: pad, paddingRight: pad, flexShrink: 0, marginTop: pad - 6 }}>
        <text testId="activity" style={{ color: last?.startsWith('✗') ? t.bad : t.dim, fontSize: 12, fontFamily: MONO, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{busy ? `${busy}…` : last ?? `workspace ${wb.workspace.replace(process.cwd() + '/', '')}`}</text>
        {compact ? null : <text style={{ color: t.faint, fontSize: 11 }}>{'1-5 steps · ↑↓ select · A run all · G gen · B build · C color · ^C quit'}</text>}
      </div>
    </div>
  )
}

