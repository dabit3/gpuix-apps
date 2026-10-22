import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWindowSize } from '@gpuix/react'
import {
  BODY_PARTS, STAT_POOL, DEFAULT_STATS, buy, carryMax, carryWeight, chooseOption, closePanel, cycleTarget, endTurn, engagedEnemies, fire,
  geiger, hitChance, interactAt, liveActors, maxAp, maxHp, newGame, openTarget, questList, receiveBroadcast, regionName, repairItem,
  selectPart, sell, buyPrice, sellPrice, skills, spendPoint, startCombat, step, takeFromContainer, useItem, visibleOptions, weaponDef,
  armorRating, xpForLevel, objective, type GameState, type Stack,
} from '../engine/game'
import { ITEMS, NPCS, PERKS, RADIO_STATIONS, STATS, STAT_INFO, type Stat } from '../engine/content'
import { districtMap, dogPortrait, mkArt, portrait, radioArt, weaponArt, type MapMarker } from '../render/art2d'
import { drawText, textWidth } from '../render/font'
import { HUE_GREEN } from '../render/palette'
import { ArtImg, LiveArt } from './ArtImg'
import { WorldView, type WorldHandle } from './WorldView'
import { C, MONO } from './theme'

export interface AppIO {
  save?: (s: GameState) => void
  load?: () => GameState | null
  log?: (lines: string[]) => void
  pollBroadcasts?: () => string[]
}
type Tab = 'status' | 'items' | 'map' | 'quests' | 'radio'
const TABS: Tab[] = ['status', 'items', 'map', 'quests', 'radio']

function T({ c = C.text, s = 13, w, children, testId }: { c?: string; s?: number; w?: number; children: React.ReactNode; testId?: string }) {
  return <text testId={testId} style={{ color: c, fontSize: s, fontWeight: w, fontFamily: MONO }}>{children}</text>
}
function Btn({ label, onClick, c = C.green, testId, active }: { label: string; onClick: () => void; c?: string; testId?: string; active?: boolean }) {
  return (
    <div testId={testId} onClick={onClick} style={{ display: 'flex', paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderWidth: 1, borderColor: active ? c : C.border, backgroundColor: active ? C.sel : C.panel2, borderRadius: 3, cursor: 'pointer', hover: { borderColor: c, backgroundColor: C.sel } }}>
      <T c={c} s={12}>{label}</T>
    </div>
  )
}
function Bar({ v, max, c, w = 120 }: { v: number; max: number; c: string; w?: number }) {
  const f = Math.max(0, Math.min(1, v / Math.max(1, max)))
  return <div style={{ display: 'flex', width: w, height: 8, backgroundColor: '#13241a', borderRadius: 2 }}><div style={{ display: 'flex', width: Math.round(w * f), height: 8, backgroundColor: c, borderRadius: 2 }} /></div>
}
const Row = ({ children, gap = 8, testId }: { children: React.ReactNode; gap?: number; testId?: string }) => <div testId={testId} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap }}>{children}</div>
const Col = ({ children, gap = 6, grow }: { children: React.ReactNode; gap?: number; grow?: boolean }) => <div style={{ display: 'flex', flexDirection: 'column', gap, flexGrow: grow ? 1 : 0, minHeight: 0 }}>{children}</div>

function titleArt() {
  const t = 'WASTELAND: NEW YORK'
  const a = mkArt(textWidth(t) + 8, 13)
  drawText(a.lum, a.hue, a.w, a.h, t, 4, 3, 255, HUE_GREEN)
  return a
}

const TITLE_ART = titleArt()

/** Normalises GPUIX key events: terminal mode may send letters as key "space" + keyChar. */
export function keyName(e: { key?: string; keyChar?: string | null }): string {
  const k = (e.key ?? '').toLowerCase()
  const ch = e.keyChar ?? ''
  if (k.length === 1) return k
  if (ch && ch.length === 1 && ch !== ' ' && (k === 'space' || !k)) return ch.toLowerCase()
  return k
}

export function App({ initial, io = {}, startScreen }: { initial?: GameState | null; io?: AppIO; startScreen?: 'title' | 'game' }) {
  const win = useWindowSize()
  const game = useRef<GameState>(initial ?? newGame())
  const [, setV] = useState(0)
  const [screen, setScreen] = useState<'title' | 'game'>(startScreen ?? (initial ? 'game' : 'title'))
  const [tab, setTab] = useState<Tab>('status')
  const [panelOpen, setPanelOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const [toasts, setToasts] = useState<{ id: number; text: string; c: string }[]>([])
  const [banner, setBanner] = useState<{ text: string; sub: string; c: string; id: number } | null>(null)
  const [help, setHelp] = useState(false)
  const titleHandle = useRef<WorldHandle>({ zoom: 3, cineUntil: 0, cineTarget: null, fps: 0 })
  const onFresh = useRef<(lines: GameState['log']) => void>(() => {})
  const prevCombat = useRef<{ on: boolean; round: number }>({ on: !!game.current.combat, round: game.current.combat?.round ?? 0 })
  const handle = useRef<WorldHandle>({ zoom: 3, cineUntil: 0, cineTarget: null, fps: 0 })
  const flushed = useRef<GameState["log"][number] | null>(game.current.log[game.current.log.length - 1] ?? null)
  const lastMove = useRef(0)
  const [create, setCreate] = useState({ stats: { ...DEFAULT_STATS } as Record<Stat, number>, perks: ['deadeye', 'tinkerer'], row: 0 })

  const refresh = useCallback(() => {
    const s = game.current
    const i = flushed.current ? s.log.lastIndexOf(flushed.current) : -1
    const fresh = s.log.slice(i + 1)
    if (fresh.length) { onFresh.current(fresh); io.log?.(fresh.map((l) => `[T${String(l.turn).padStart(4, '0')}] ${l.kind.toUpperCase().padEnd(6)} ${l.text}`)); flushed.current = s.log[s.log.length - 1] ?? null }
    setV((v) => v + 1)
  }, [io])
  const act = useCallback((fn: (s: GameState) => void) => { fn(game.current); refresh() }, [refresh])
  const flash = (text: string, c: string = C.green) => {
    const id = Math.random()
    setToasts((ts) => [...ts.slice(-2), { id, text, c }])
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 2600)
  }
  const showBanner = (text: string, sub: string, c: string, ms = 1400) => {
    const id = Math.random()
    setBanner({ text, sub, c, id })
    setTimeout(() => setBanner((b) => (b?.id === id ? null : b)), ms)
  }
  onFresh.current = (lines) => {
    for (const l of lines) {
      if (l.kind === 'quest') flash(l.text, C.amber)
      else if (l.text.startsWith('LEVEL UP')) showBanner('LEVEL UP', `LEVEL ${game.current.player.level}  -  +1 ATTRIBUTE POINT`, C.green, 2200)
      else if (l.kind === 'loot' && /^(Took|Bought|Received|Got)/i.test(l.text)) flash(l.text, C.cyan)
    }
  }
  useEffect(() => {
    const c = game.current.combat
    const p = prevCombat.current
    if (c && !p.on) showBanner('COMBAT', `${engagedEnemies(game.current).length} HOSTILE${engagedEnemies(game.current).length === 1 ? '' : 'S'} ENGAGED  -  T TO TARGET`, C.red)
    else if (c && c.round !== p.round) showBanner(`ROUND ${c.round}`, 'YOUR TURN', C.cyan, 1000)
    else if (!c && p.on && game.current.mode !== 'dead') showBanner('ALL CLEAR', 'COMBAT OVER', C.green, 1300)
    prevCombat.current = { on: !!c, round: c?.round ?? 0 }
  })

  useEffect(() => {
    if (!io.pollBroadcasts) return
    const id = setInterval(() => { const lines = io.pollBroadcasts!(); if (lines.length) act((s) => lines.forEach((l) => receiveBroadcast(s, l))) }, 400)
    return () => clearInterval(id)
  }, [io, act])

  const doSave = () => { io.save?.(game.current); flash('GAME SAVED  ~/.wasteland/save.json') }
  const doLoad = () => { const g = io.load?.(); if (g) { game.current = g; flushed.current = g.log[g.log.length - 1] ?? null; handle.current.cineUntil = 0; refresh(); flash('SAVE LOADED') } else flash('NO SAVE FOUND') }
  const startNew = () => { game.current = newGame({ stats: create.stats, perks: create.perks }); flushed.current = null; refresh(); setScreen('game') }

  const doFire = () => act((s) => {
    const fx = fire(s, performance.now())
    if (fx) {
      handle.current.cineUntil = performance.now() + 1300; handle.current.cineTarget = [fx.toX, fx.toY]
      const victim = s.actors.find((a) => a.id === fx.target)
      const msg: [string, string, string] | null = victim?.dead ? ['TARGET DOWN', `${victim.name.toUpperCase()}  -  ${fx.dmg} DMG`, C.amber] : fx.crit ? ['CRITICAL', `${fx.part.toUpperCase()}  -  ${fx.dmg} DMG`, C.red] : null
      if (msg) setTimeout(() => showBanner(...msg, 1100), 640)
    }
  })
  const doEndTurn = () => act((s) => { if (s.mode === 'target') closePanel(s); endTurn(s, performance.now()) })
  const doTarget = () => act((s) => {
    if (s.mode === 'explore') startCombat(s)
    if (s.mode === 'combat') { const e = engagedEnemies(s)[0]; if (e) openTarget(s, e.id) }
  })

  const s = game.current
  const compact = (win?.width ?? 1400) < 980
  const showPanel = !compact || panelOpen

  const onKey = (e: { key?: string; keyChar?: string | null; modifiers?: { ctrl?: boolean; control?: boolean; shift?: boolean } }) => {
    const k = keyName(e)
    const ctrl = !!(e.modifiers?.ctrl || e.modifiers?.control)
    if (screen === 'title') {
      const row = create.row
      if (k === 'enter') startNew()
      else if (k === 'c' && io.load) { doLoad(); if (io.load()) setScreen('game') }
      else if (k === 'up') setCreate({ ...create, row: Math.max(0, row - 1) })
      else if (k === 'down') setCreate({ ...create, row: Math.min(STATS.length - 1, row + 1) })
      else if (k === 'left' || k === 'right') adjustStat(STATS[row]!, k === 'right' ? 1 : -1)
      return
    }
    if (help) { if (k === 'escape' || k === 'h' || k === '?' || k === 'enter') setHelp(false); return }
    if (k === 'h' || k === '?' || k === 'f1') return setHelp(true)
    if (ctrl && k === 's') return doSave()
    if (ctrl && k === 'l') return doLoad()
    if (k === 'f5') return doSave()
    if (k === 'f9') return doLoad()
    if (k === 'tab') { if (compact) setPanelOpen(!panelOpen); else setTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length]!); return }
    const mode = s.mode
    if (mode === 'dialogue') {
      const n = Number(k)
      if (n >= 1 && n <= 9) act((g) => chooseOption(g, n - 1))
      else if (k === 'escape') act(closePanel)
      return
    }
    if (mode === 'loot') { if (k === 'a' || k === 'enter') act((g) => { takeFromContainer(g, 'all'); closePanel(g) }); else if (k === 'escape') act(closePanel); return }
    if (mode === 'barter') { if (k === 'escape') act(closePanel); return }
    if (mode === 'target') {
      const parts = BODY_PARTS, i = parts.indexOf(s.target!.part)
      if (k === 'up' || k === 'w') act((g) => selectPart(g, parts[(i + 3) % 4]!))
      else if (k === 'down' || k === 's') act((g) => selectPart(g, parts[(i + 1) % 4]!))
      else if (k === 'left' || k === 'a') act((g) => cycleTarget(g, -1))
      else if (k === 'right' || k === 'd') act((g) => cycleTarget(g, 1))
      else if (k === 'enter' || k === 'f' || k === 'space') doFire()
      else if (k === 'e') doEndTurn()
      else if (k === 'escape') act(closePanel)
      return
    }
    if (mode === 'dead' || mode === 'ending') { if (k === 'enter') { if (mode === 'dead') doLoad(); else act((g) => { g.mode = 'explore' }) } return }
    const dirs: Record<string, [number, number]> = { up: [-1, -1], w: [-1, -1], down: [1, 1], s: [1, 1], left: [-1, 1], a: [-1, 1], right: [1, -1], d: [1, -1] }
    const d = dirs[k]
    if (d) {
      const now = performance.now()
      if (now - lastMove.current < 85) return
      lastMove.current = now
      act((g) => { g.path = []; if (!step(g, d[0], d[1])) { if (g.mode === 'explore' || g.mode === 'combat') { if (!step(g, d[0], 0)) step(g, 0, d[1]) } } })
      return
    }
    if (k === 't' || k === 'v') return doTarget()
    if (k === 'e' && mode === 'combat') return doEndTurn()
    if (k === 'escape' && compact && panelOpen) return setPanelOpen(false)
    const n = Number(k)
    if (n >= 1 && n <= 5) { setTab(TABS[n - 1]!); if (compact) setPanelOpen(true); return }
    if (k === 'i') { setTab('items'); if (compact) setPanelOpen(true) }
    else if (k === 'm') { setTab('map'); if (compact) setPanelOpen(true) }
    else if (k === 'q') { setTab('quests'); if (compact) setPanelOpen(true) }
    else if (k === 'r') { setTab('radio'); if (compact) setPanelOpen(true) }
    else if (k === 'z') handle.current.zoom = handle.current.zoom >= 4 ? 2 : handle.current.zoom + 1
  }

  const adjustStat = (st: Stat, d: number) => {
    const total = STATS.reduce((a, k) => a + create.stats[k], 0)
    const v = create.stats[st] + d
    if (v < 1 || v > 10 || (d > 0 && total >= STAT_POOL)) return
    setCreate({ ...create, stats: { ...create.stats, [st]: v } })
  }

  const root = (body: React.ReactNode) => (
    <div testId="root" tabIndex={-1} autoFocus onKeyDown={onKey} style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: C.bg }}>{body}</div>
  )

  if (screen === 'title') {
    const used = STATS.reduce((a, k) => a + create.stats[k], 0)
    const narrow = (win?.width ?? 1400) < 760
    return root(
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, position: 'relative' }}>
      <WorldView game={game} onChange={() => {}} handle={titleHandle} onTileClick={() => {}} attract />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, gap: 16, padding: 24, backgroundColor: '#0a0c1066' }}>
        <ArtImg art={TITLE_ART} scale={narrow ? 3 : 5} width={(textWidth('WASTELAND: NEW YORK') + 8) * (narrow ? 3 : 5)} height={13 * (narrow ? 3 : 5)} testId="title" />
        <T c={C.text} s={13}>SHELTER 34  /  LOWER MANHATTAN  /  2097   -   WRIST-LINK v3.4 ONLINE</T>
        <div testId="creator" style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 28, padding: 18, borderWidth: 1, borderColor: C.borderHi, backgroundColor: '#0b130eec', borderRadius: 8 }}>
          <Col gap={5}>
            <Row><T c={C.green} w={700}>ATTRIBUTES</T><T c={used >= STAT_POOL ? C.dim : C.amber}>{`${STAT_POOL - used} pts left`}</T></Row>
            {STATS.map((st, i) => (
              <Row key={st} testId={`stat-${st}`}>
                <div style={{ display: 'flex', width: 110 }}><T c={i === create.row ? C.green : C.text} w={i === create.row ? 700 : 400}>{`${i === create.row ? '> ' : '  '}${st.toUpperCase()}`}</T></div>
                <Btn label="-" onClick={() => adjustStat(st, -1)} testId={`dec-${st}`} />
                <div style={{ display: 'flex', width: 26, justifyContent: 'center' }}><T c={C.green} w={700}>{String(create.stats[st])}</T></div>
                <Btn label="+" onClick={() => adjustStat(st, 1)} testId={`inc-${st}`} />
                {!narrow && <T c={C.dim} s={11}>{STAT_INFO[st]}</T>}
              </Row>
            ))}
          </Col>
          <Col gap={5}>
            <Row gap={14}>
              <T c={C.dim} s={11}>DERIVED</T>
              <T c={C.green} s={12} testId="derived">{`HP ${50 + create.stats.stamina * 8}`}</T>
              <T c={C.cyan} s={12}>{`AP ${6 + Math.floor(create.stats.reflex / 2)}`}</T>
              <T c={C.amber} s={12}>{`CARRY ${80 + create.stats.grit * 12} lb`}</T>
            </Row>
            <T c={C.green} w={700}>PERKS (pick 2)</T>
            {Object.entries(PERKS).map(([id, p]) => {
              const on = create.perks.includes(id)
              return (
                <div key={id} testId={`perk-${id}`} onClick={() => setCreate({ ...create, perks: on ? create.perks.filter((x) => x !== id) : [...create.perks, id].slice(-2) })} style={{ display: 'flex', flexDirection: 'row', gap: 8, cursor: 'pointer', padding: 3, borderRadius: 3, backgroundColor: on ? C.sel : C.panel, hover: { backgroundColor: C.sel } }}>
                  <T c={on ? C.green : C.faint}>{on ? '[x]' : '[ ]'}</T><T c={on ? C.text : C.dim}>{p.name}</T>{!narrow && <T c={C.dim} s={11}>{p.desc}</T>}
                </div>
              )
            })}
          </Col>
        </div>
        <Row gap={12}>
          <Btn label="ENTER  LEAVE THE SHELTER" onClick={startNew} testId="start" active />
          {io.load && <Btn label="C  CONTINUE SAVE" onClick={() => { doLoad(); if (io.load?.()) setScreen('game') }} testId="continue" />}
        </Row>
        <T c={C.dim} s={11}>arrows: pick and adjust  -  click to toggle perks  -  ctrl-c quits</T>
      </div>
      </div>,
    )
  }

  const hp = s.player.hp, mhp = maxHp(s), ap = s.player.ap, map = maxAp(s)
  const g = geiger(s)
  const header = (
    <div testId="hud" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 12, paddingRight: 12, height: 30, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.panel }}>
      <T c={C.green} w={700}>WRIST-LINK</T>
      <Row gap={6}><T c={C.dim} s={11}>HP</T><Bar v={hp} max={mhp} c={hp < mhp * 0.3 ? C.red : C.green} w={compact ? 60 : 90} /><T s={11} testId="hp">{`${hp}/${mhp}`}</T></Row>
      <Row gap={6}><T c={C.dim} s={11}>AP</T><Bar v={s.combat ? ap : map} max={map} c={C.cyan} w={compact ? 40 : 60} /></Row>
      <Row gap={6}><T c={C.dim} s={11}>RAD</T><T c={s.player.rads > 60 ? C.red : s.player.rads ? C.amber : C.dim} s={11} testId="rads">{String(s.player.rads)}</T>{g > 0 && <T c={C.amber} s={11}>{'|'.repeat(1 + Math.round(g * 6))}</T>}</Row>
      {!compact && <T c={C.amber} s={11}>{`${s.player.caps} caps`}</T>}
      {!compact && <Row gap={6}><T c={C.text} s={11} w={700}>{`LV ${s.player.level}`}</T><Bar v={s.player.xp - xpForLevel(s.player.level)} max={xpForLevel(s.player.level + 1) - xpForLevel(s.player.level)} c={C.amber} w={50} /></Row>}
      <div style={{ display: 'flex', flexGrow: 1 }} />
      <T c={C.dim} s={11} testId="region">{regionName(s).toUpperCase()}</T>
      {!compact && <T c={C.faint} s={11}>H help</T>}
      {compact && <Btn label={panelOpen ? 'TAB close' : 'TAB menu'} onClick={() => setPanelOpen(!panelOpen)} testId="toggle-panel" />}
    </div>
  )

  const logLines = s.log.slice(-(compact ? 3 : 4))
  const kindColor = (k: string) => (k === 'combat' ? C.red : k === 'quest' ? C.amber : k === 'loot' ? C.cyan : k === 'radio' ? C.cyan : k === 'system' ? C.green : C.text)
  const combatBar = s.combat && (
    <div testId="combat-bar" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12, paddingRight: 12, height: 32, backgroundColor: '#1a0f0e', borderTopWidth: 1, borderColor: '#5a2420' }}>
      <T c={C.red} w={700}>{`COMBAT  R${s.combat.round}`}</T>
      <T c={C.cyan} testId="ap">{`AP ${'●'.repeat(Math.max(0, ap))}${'○'.repeat(Math.max(0, map - ap))}`}</T>
      <div style={{ display: 'flex', flexGrow: 1 }} />
      <Btn label="T  T.A.R.G.E.T." onClick={doTarget} c={C.red} testId="btn-target" active={s.mode === 'target'} />
      <Btn label="E  END TURN" onClick={doEndTurn} c={C.amber} testId="btn-endturn" />
    </div>
  )
  const logStrip = (
    <div testId="log" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 74, flexShrink: 0, overflow: 'hidden', paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4, gap: 1, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.panel }}>
      {logLines.map((l, i) => <T key={i} c={i >= logLines.length - 2 ? kindColor(l.kind) : C.faint} s={12}>{`${i === logLines.length - 1 ? '>' : ' '} ${l.text}`}</T>)}
    </div>
  )

  const world = (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, position: 'relative' }}>
        <WorldView game={game} onChange={refresh} handle={handle} onTileClick={(x, y) => act((g2) => interactAt(g2, x, y))} />
        {s.mode === 'dialogue' && <Dialogue s={s} act={act} compact={compact} />}
        {s.mode === 'loot' && <Loot s={s} act={act} />}
        {s.mode === 'barter' && <Barter s={s} act={act} />}
        {s.mode === 'target' && <Target s={s} act={act} onFire={doFire} />}
        {(s.mode === 'dead' || s.mode === 'ending') && <EndCard s={s} onLoad={doLoad} onContinue={() => act((g2) => { g2.mode = 'explore' })} onNew={() => setScreen('title')} />}
        {s.mode !== 'dialogue' && s.mode !== 'dead' && s.mode !== 'ending' && <Tracker s={s} compact={compact} />}
        {toasts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'absolute', top: 14, left: 0, right: 0, pointerEvents: 'none' }}>
            {toasts.map((t, i) => (
              <div key={t.id} style={{ display: 'flex', flexDirection: 'row', gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, backgroundColor: '#0b130ef0', borderWidth: 1, borderColor: t.c, borderRadius: 4 }}>
                <T c={t.c} w={700}>{'+'}</T><T c={t.c} testId={i === toasts.length - 1 ? 'toast' : undefined}>{t.text}</T>
              </div>
            ))}
          </div>
        )}
        {banner && (
          <div testId="banner" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'absolute', top: Math.round((win?.height ?? 800) * 0.24), left: 0, right: 0, paddingTop: 12, paddingBottom: 12, backgroundColor: '#0a0c10cc', borderTopWidth: 1, borderBottomWidth: 1, borderColor: banner.c, pointerEvents: 'none' }}>
            <T c={banner.c} s={compact ? 24 : 34} w={700}>{banner.text}</T>
            {banner.sub ? <T c={C.text} s={13}>{banner.sub}</T> : null}
          </div>
        )}
        {help && <Help />}
      </div>
      {combatBar}
      {logStrip}
    </div>
  )

  return root(
    <>
      {header}
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        {world}
        {showPanel && <Panel s={s} tab={tab} setTab={setTab} act={act} sel={sel} setSel={setSel} onSave={doSave} onLoad={doLoad} width={compact ? Math.min(360, (win?.width ?? 700) - 40) : 380} overlay={compact} />}
      </div>
    </>,
  )
}

type Act = (fn: (s: GameState) => void) => void

function Dialogue({ s, act, compact }: { s: GameState; act: Act; compact: boolean }) {
  const d = s.dialogue!
  const npc = NPCS[d.npc]!
  const node = npc.dialogue.nodes[d.node]!
  const opts = visibleOptions(s)
  const art = useMemo(() => (npc.sprite === 'dog' ? dogPortrait() : portrait(npc.look, npc.id)), [npc.id])
  const [shown, setShown] = useState(0)
  useEffect(() => {
    setShown(0)
    const id = setInterval(() => setShown((n) => { if (n >= node.text.length) { clearInterval(id); return n } return n + 3 }), 16)
    return () => clearInterval(id)
  }, [node.text])
  const stats = s.player.stats as Record<string, number>
  return (
    <div testId="dialogue" style={{ display: 'flex', flexDirection: 'row', gap: 14, position: 'absolute', left: 12, right: 12, bottom: 12, padding: 14, backgroundColor: '#0b130ef2', borderWidth: 1, borderColor: C.borderHi, borderRadius: 6 }}>
      {!compact && <div style={{ display: 'flex', borderWidth: 1, borderColor: C.border }}><ArtImg art={art} scale={4} width={192} height={192} testId="portrait" /></div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <Row><T c={C.green} w={700} testId="npc-name">{npc.name.toUpperCase()}</T><T c={C.dim} s={11}>{npc.faction}</T></Row>
        <T c={C.text} testId="npc-line">{node.text.slice(0, Math.max(shown, 1)) + (shown < node.text.length ? '_' : '')}</T>
        {d.result && <T c={d.result.endsWith('SUCCESS') ? C.green : C.red} s={12}>{`[${d.result}]`}</T>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
          {opts.map((o, i) => (
            <div key={i} testId={`opt-${i + 1}`} onClick={() => act((g) => chooseOption(g, i))} style={{ display: 'flex', flexDirection: 'row', gap: 8, paddingLeft: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 3, cursor: 'pointer', hover: { backgroundColor: C.sel } }}>
              <T c={C.amber}>{`${i + 1}.`}</T>
              {o.check && <T c={(stats[o.check.stat] ?? 0) >= o.check.dc ? C.green : C.red}>{`[${o.check.stat.toUpperCase()} ${stats[o.check.stat] ?? '?'}/${o.check.dc}]`}</T>}
              <T c={C.text}>{o.text}</T>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ItemLine({ st, right, onClick, testId, active }: { st: Stack; right: string; onClick: () => void; testId?: string; active?: boolean }) {
  const d = ITEMS[st.id]!
  return (
    <div testId={testId} onClick={onClick} style={{ display: 'flex', flexDirection: 'row', gap: 8, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 3, cursor: 'pointer', backgroundColor: active ? C.sel : undefined, hover: { backgroundColor: C.sel } }}>
      <div style={{ display: 'flex', flexGrow: 1 }}><T c={d.kind === 'quest' ? C.amber : C.text} s={12}>{`${d.name}${st.qty > 1 ? ` x${st.qty}` : ''}`}</T></div>
      <T c={C.dim} s={12}>{right}</T>
    </div>
  )
}

function Loot({ s, act }: { s: GameState; act: Act }) {
  const c = s.containers.find((c) => c.id === s.loot)!
  return (
    <div testId="loot" style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'absolute', top: 40, left: 40, width: 330, padding: 14, backgroundColor: '#0b130ef2', borderWidth: 1, borderColor: C.borderHi, borderRadius: 6 }}>
      <T c={C.green} w={700}>{c.name.toUpperCase()}</T>
      {c.caps > 0 && <T c={C.amber} s={12}>{`${c.caps} caps`}</T>}
      {c.items.length === 0 && c.caps === 0 && <T c={C.dim} s={12}>Empty.</T>}
      {c.items.map((st) => <ItemLine key={st.uid} st={st} right={`${ITEMS[st.id]!.weight} lb`} onClick={() => act((g) => takeFromContainer(g, st.uid))} testId={`loot-${st.id}`} />)}
      <Row><Btn label="A  TAKE ALL" onClick={() => act((g) => { takeFromContainer(g, 'all'); closePanel(g) })} testId="take-all" active /><Btn label="ESC  CLOSE" onClick={() => act(closePanel)} /></Row>
    </div>
  )
}

function Barter({ s, act }: { s: GameState; act: Act }) {
  return (
    <div testId="barter" style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'absolute', top: 30, left: 30, right: 30, padding: 14, backgroundColor: '#0b130ef2', borderWidth: 1, borderColor: C.borderHi, borderRadius: 6 }}>
      <Row><T c={C.green} w={700}>BARTER  -  ROSA'S BODEGA</T><div style={{ display: 'flex', flexGrow: 1 }} /><T c={C.amber} testId="barter-caps">{`You: ${s.player.caps} caps   Rosa: ${s.barter.caps} caps`}</T></Row>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, gap: 1 }}>
          <T c={C.dim} s={11}>FOR SALE (click to buy)</T>
          {s.barter.stock.map((st) => <ItemLine key={st.uid} st={st} right={`${buyPrice(s, st.id)}c`} onClick={() => act((g) => { buy(g, st.uid) })} testId={`buy-${st.id}`} />)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, gap: 1 }}>
          <T c={C.dim} s={11}>YOUR PACK (click to sell)</T>
          {s.player.inv.filter((st) => ITEMS[st.id]!.kind !== 'quest' && st.uid !== s.player.weapon && st.uid !== s.player.armor).map((st) => <ItemLine key={st.uid} st={st} right={`${sellPrice(s, st)}c`} onClick={() => act((g) => { sell(g, st.uid) })} testId={`sell-${st.id}`} />)}
        </div>
      </div>
      <Row><Btn label="ESC  DONE" onClick={() => act(closePanel)} testId="barter-done" /></Row>
    </div>
  )
}

function Target({ s, act, onFire }: { s: GameState; act: Act; onFire: () => void }) {
  const a = liveActors(s).find((x) => x.id === s.target!.actor)
  if (!a) return null
  const w = weaponDef(s)
  const cost = w.ap ?? 3
  return (
    <div testId="target" style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'absolute', top: 12, right: 12, width: 270, padding: 12, backgroundColor: '#140b0af0', borderWidth: 1, borderColor: C.red, borderRadius: 6 }}>
      <Row><T c={C.red} w={700}>T.A.R.G.E.T.</T><div style={{ display: 'flex', flexGrow: 1 }} /><T c={C.dim} s={11}>{'< > target'}</T></Row>
      <Row><T c={C.text} w={700} testId="target-name">{a.name}</T><Bar v={a.hp} max={a.maxHp} c={C.red} w={80} /><T c={C.dim} s={11}>{`${a.hp}/${a.maxHp}`}</T></Row>
      {BODY_PARTS.map((p) => {
        const on = s.target!.part === p
        const ch = hitChance(s, a, p)
        return (
          <div key={p} testId={`part-${p}`} onClick={() => act((g) => selectPart(g, p))} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: 3, cursor: 'pointer', backgroundColor: on ? '#3a1512' : undefined, hover: { backgroundColor: '#2a1210' } }}>
            <div style={{ display: 'flex', width: 60 }}><T c={on ? C.red : C.text} w={on ? 700 : 400}>{p.toUpperCase()}</T></div>
            <Bar v={ch} max={100} c={on ? C.red : '#7a3a34'} w={110} />
            <T c={on ? C.red : C.dim} testId={`chance-${p}`}>{`${ch}%`}</T>
          </div>
        )
      })}
      <Row gap={10}><T c={C.red} s={30} w={700} testId="target-chance">{`${hitChance(s, a, s.target!.part)}%`}</T><Col gap={1}><T c={C.text} s={11}>{`${s.target!.part.toUpperCase()} SHOT`}</T><T c={C.dim} s={11}>{s.target!.part === 'head' ? 'crit x2  -  hard to land' : s.target!.part === 'legs' ? 'cripple: slows' : s.target!.part === 'arms' ? 'cripple: weakens aim' : 'reliable damage'}</T></Col></Row>
      <T c={C.dim} s={11}>{`${w.name}  -  ${cost} AP per ${w.class === 'melee' ? 'swing' : 'shot'}  -  AP ${s.player.ap}`}</T>
      <Row><Btn label="ENTER  FIRE" onClick={onFire} c={C.red} testId="fire" active /><Btn label="ESC" onClick={() => act(closePanel)} c={C.dim} /></Row>
    </div>
  )
}

function EndCard({ s, onLoad, onContinue, onNew }: { s: GameState; onLoad: () => void; onContinue: () => void; onNew: () => void }) {
  const dead = s.mode === 'dead'
  return (
    <div testId="endcard" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', position: 'absolute', top: 60, left: 60, right: 60, padding: 24, backgroundColor: '#0b130ef6', borderWidth: 1, borderColor: dead ? C.red : C.green, borderRadius: 6 }}>
      <T c={dead ? C.red : C.green} s={18} w={700}>{dead ? 'SIGNAL LOST' : 'THE CITY REMEMBERS'}</T>
      <T c={C.text}>{s.ending ?? s.log[s.log.length - 1]?.text ?? ''}</T>
      <Row>{dead ? <Btn label="ENTER  LOAD SAVE" onClick={onLoad} active /> : <Btn label="ENTER  KEEP EXPLORING" onClick={onContinue} active />}<Btn label="NEW GAME" onClick={onNew} /></Row>
    </div>
  )
}

function Panel({ s, tab, setTab, act, sel, setSel, onSave, onLoad, width, overlay }: {
  s: GameState; tab: Tab; setTab: (t: Tab) => void; act: Act; sel: number; setSel: (n: number) => void; onSave: () => void; onLoad: () => void; width: number; overlay: boolean
}) {
  return (
    <div testId="wristlink" style={{ display: 'flex', flexDirection: 'column', width, flexShrink: 0, borderLeftWidth: 1, borderColor: C.borderHi, backgroundColor: C.panel, ...(overlay ? { position: 'absolute', right: 0, top: 0, bottom: 0 } : {}) }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 2, padding: 6, borderBottomWidth: 1, borderColor: C.border }}>
        {TABS.map((t, i) => (
          <div key={t} testId={`tab-${t}`} onClick={() => setTab(t)} style={{ display: 'flex', flexGrow: 1, justifyContent: 'center', paddingTop: 4, paddingBottom: 4, borderRadius: 3, cursor: 'pointer', backgroundColor: tab === t ? C.sel : undefined, borderBottomWidth: 2, borderColor: tab === t ? C.green : C.panel, hover: { backgroundColor: C.sel } }}>
            <T c={tab === t ? C.green : C.dim} s={11} w={tab === t ? 700 : 400}>{`${i + 1} ${t.toUpperCase()}`}</T>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, padding: 12, gap: 8, overflowY: 'scroll' }} testId="panel-body">
        {tab === 'status' && <Status s={s} act={act} />}
        {tab === 'items' && <Items s={s} act={act} sel={sel} setSel={setSel} />}
        {tab === 'map' && <MapTab s={s} width={width - 24} />}
        {tab === 'quests' && <Quests s={s} />}
        {tab === 'radio' && <Radio s={s} act={act} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 6, padding: 8, borderTopWidth: 1, borderColor: C.border }}>
        <Btn label="SAVE ^S" onClick={onSave} testId="save" /><Btn label="LOAD ^L" onClick={onLoad} testId="load" />
        <div style={{ display: 'flex', flexGrow: 1 }} />
        <T c={C.faint} s={11}>{`T${s.turn}`}</T>
      </div>
    </div>
  )
}

function Status({ s, act }: { s: GameState; act: Act }) {
  const sk = skills(s)
  const next = xpForLevel(s.player.level + 1)
  const art = useMemo(() => portrait({ hair: 'messy', skin: 0.45, age: 0.3, scar: 1 }, 'player'), [])
  return (
    <>
      <Row gap={12}>
        <div style={{ display: 'flex', borderWidth: 1, borderColor: C.border }}><ArtImg art={art} scale={2} width={96} height={96} /></div>
        <Col gap={3}>
          <T c={C.green} w={700} s={15}>{s.player.name.toUpperCase()}</T>
          <T c={C.dim} s={12}>{`Level ${s.player.level}   XP ${s.player.xp}/${next}`}</T>
          <Bar v={s.player.xp - xpForLevel(s.player.level)} max={next - xpForLevel(s.player.level)} c={C.green} w={150} />
          <T c={C.dim} s={12}>{`Armor ${armorRating(s)}   Carry ${carryWeight(s)}/${carryMax(s)} lb`}</T>
          <T c={C.dim} s={12}>{`Union ${s.rep.union ?? 0}   Ironbacks ${s.rep.ironbacks ?? 0}`}</T>
        </Col>
      </Row>
      {s.player.points > 0 && <T c={C.amber} s={12}>{`${s.player.points} attribute point(s) to spend: click +`}</T>}
      {STATS.map((st) => (
        <Row key={st}>
          <div style={{ display: 'flex', width: 96 }}><T c={C.text} s={12}>{st.toUpperCase()}</T></div>
          <Bar v={s.player.stats[st]} max={10} c={C.green} w={120} />
          <T c={C.green} s={12}>{String(s.player.stats[st])}</T>
          {s.player.points > 0 && <Btn label="+" onClick={() => act((g) => { spendPoint(g, st) })} testId={`spend-${st}`} />}
        </Row>
      ))}
      <T c={C.dim} s={11}>SKILLS</T>
      <T c={C.text} s={12}>{Object.entries(sk).map(([k, v]) => `${k} ${v}`).join('   ')}</T>
      <T c={C.dim} s={11}>PERKS</T>
      {s.player.perks.map((p) => <T key={p} c={C.text} s={12}>{`${PERKS[p]!.name}: ${PERKS[p]!.desc}`}</T>)}
    </>
  )
}

function Items({ s, act, sel, setSel }: { s: GameState; act: Act; sel: number; setSel: (n: number) => void }) {
  const inv = s.player.inv
  const cur = inv.find((i) => i.uid === sel) ?? inv.find((i) => i.uid === s.player.weapon) ?? inv[0]
  const d = cur ? ITEMS[cur.id]! : null
  const art = useMemo(() => (cur && d?.kind === 'weapon' ? weaponArt(cur.id, cur.cond) : null), [cur?.id, cur?.cond])
  return (
    <>
      <Row><T c={C.dim} s={11}>{`${inv.length} items   ${carryWeight(s)}/${carryMax(s)} lb   ${s.player.caps} caps`}</T></Row>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {inv.map((st) => {
          const eq = st.uid === s.player.weapon || st.uid === s.player.armor
          const dd = ITEMS[st.id]!
          return <ItemLine key={st.uid} st={st} active={cur?.uid === st.uid} right={`${eq ? 'E ' : ''}${dd.kind === 'weapon' || dd.kind === 'armor' ? `${st.cond}%` : `${dd.weight}lb`}`} onClick={() => setSel(st.uid)} testId={`item-${st.id}`} />
        })}
      </div>
      {cur && d && (
        <div testId="item-detail" style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 8, borderWidth: 1, borderColor: C.border, borderRadius: 4 }}>
          {art && <ArtImg art={art} scale={3} width={288} height={96} testId="weapon-art" />}
          <T c={C.green} w={700}>{d.name}</T>
          <T c={C.dim} s={12}>{[d.dmg && `DMG ${d.dmg}`, d.ap && `AP ${d.ap}`, d.range && `RNG ${d.range}`, d.armor && `ARMOR ${d.armor}`, d.heal && `+${d.heal} HP`, d.rads && `${d.rads} RAD`, `${d.weight} lb`, `${d.value}c`].filter(Boolean).join('   ')}</T>
          {(d.kind === 'weapon' || d.kind === 'armor') && <Row><T c={C.dim} s={12}>CND</T><Bar v={cur.cond} max={100} c={cur.cond < 40 ? C.red : C.green} w={140} /><T c={C.text} s={12} testId="cond">{`${cur.cond}%`}</T></Row>}
          <Row>
            {(d.kind === 'weapon' || d.kind === 'armor') && <Btn label={cur.uid === s.player.weapon || cur.uid === s.player.armor ? 'UNEQUIP' : 'EQUIP'} onClick={() => act((g) => { useItem(g, cur.uid) })} testId="equip" />}
            {d.kind === 'aid' && <Btn label="USE" onClick={() => act((g) => { useItem(g, cur.uid) })} testId="use" />}
            {(d.kind === 'weapon' || d.kind === 'armor') && cur.cond < 100 && <Btn label="REPAIR (kit)" onClick={() => act((g) => { repairItem(g, cur.uid) })} testId="repair" />}
          </Row>
        </div>
      )}
    </>
  )
}

function MapTab({ s, width }: { s: GameState; width: number }) {
  const markers: MapMarker[] = [
    ...s.npcs.filter((n) => !n.removed).map((n) => ({ x: n.x, y: n.y, kind: 'npc' as const })),
    ...liveActors(s).filter((a) => a.hostile).map((a) => ({ x: a.x, y: a.y, kind: 'enemy' as const })),
    ...s.containers.filter((c) => !c.opened).map((c) => ({ x: c.x, y: c.y, kind: 'loot' as const })),
    { x: s.player.x, y: s.player.y, kind: 'player' as const },
  ]
  const w = Math.max(200, Math.min(width, 400)), h = Math.round((w * 160) / 200)
  return (
    <>
      <T c={C.dim} s={11}>LOWER MANHATTAN  -  GREENWICH SECTOR</T>
      <LiveArt make={(t) => districtMap(markers, t)} scale={2} width={w} height={h} testId="map-img" />
      <Row><T c={C.green} s={11}>+ you</T><T c={C.cyan} s={11}>■ people</T><T c={C.red} s={11}>■ hostiles</T><T c={C.amber} s={11}>■ unlooted</T></Row>
    </>
  )
}

function Quests({ s }: { s: GameState }) {
  const qs = questList(s)
  if (!qs.length) return <T c={C.dim} s={12}>No quests yet. Talk to people in the shelter.</T>
  return (
    <>
      {qs.map((q) => (
        <div key={q.id} testId={`quest-${q.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 6, borderLeftWidth: 2, borderColor: q.done ? C.faint : q.main ? C.amber : C.green }}>
          <Row><T c={q.done ? C.dim : q.main ? C.amber : C.green} w={700} s={12}>{q.title.toUpperCase()}</T><T c={C.faint} s={10}>{q.done ? 'DONE' : q.main ? 'MAIN' : 'SIDE'}</T></Row>
          <T c={q.done ? C.dim : C.text} s={12}>{q.text}</T>
        </div>
      ))}
    </>
  )
}

function Radio({ s, act }: { s: GameState; act: Act }) {
  const st = RADIO_STATIONS.find((r) => r.id === s.radio)
  const unlocked = (r: (typeof RADIO_STATIONS)[number]) => !r.unlock || s.flags[r.unlock.replace('radio:', 'radio_')] || s.flags[r.unlock]
  return (
    <>
      <LiveArt make={(t) => radioArt(s.radio, t, !!st)} scale={2} width={320} height={96} fps={20} testId="radio-wave" />
      {RADIO_STATIONS.map((r) => (
        <div key={r.id} testId={`station-${r.id}`} onClick={() => unlocked(r) && act((g) => { g.radio = g.radio === r.id ? '' : r.id })} style={{ display: 'flex', flexDirection: 'row', gap: 10, padding: 4, borderRadius: 3, cursor: 'pointer', backgroundColor: s.radio === r.id ? C.sel : undefined, hover: { backgroundColor: C.sel } }}>
          <T c={unlocked(r) ? C.green : C.faint} s={12}>{r.freq}</T><T c={unlocked(r) ? C.text : C.faint} s={12}>{unlocked(r) ? r.name : '- no signal -'}</T>
        </div>
      ))}
      <T c={C.dim} s={11}>BROADCASTS  (from another pane: wasteland radio "...")</T>
      {s.broadcasts.length === 0 && <T c={C.faint} s={12}>static...</T>}
      {s.broadcasts.slice(-6).reverse().map((b, i) => <T key={i} c={i === 0 ? C.cyan : C.dim} s={12} testId={i === 0 ? 'broadcast-latest' : undefined}>{`» ${b}`}</T>)}
    </>
  )
}

const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
function Tracker({ s, compact }: { s: GameState; compact: boolean }) {
  if (s.combat) {
    const foes = engagedEnemies(s)
    return (
      <div testId="tracker" style={{ display: 'flex', flexDirection: 'column', gap: 3, position: 'absolute', top: 12, left: 12, paddingLeft: 10, paddingRight: 12, paddingTop: 6, paddingBottom: 6, backgroundColor: '#140b0ad8', borderLeftWidth: 2, borderColor: C.red, pointerEvents: 'none' }}>
        <T c={C.red} s={11} w={700}>{`COMBAT  -  ROUND ${s.combat.round}  -  YOUR TURN`}</T>
        {foes.slice(0, compact ? 2 : 4).map((a) => <T key={a.id} c={C.text} s={11}>{`${a.name.padEnd(13)} ${'#'.repeat(Math.ceil((a.hp / a.maxHp) * 8)).padEnd(8, '.')} ${a.hp}`}</T>)}
      </div>
    )
  }
  const o = objective(s)
  if (!o) return null
  const dx = o.x - s.player.x, dy = o.y - s.player.y
  const far = o.x >= 0 ? Math.max(Math.abs(dx), Math.abs(dy)) : -1
  const dir = DIRS[(Math.round(Math.atan2(dx + dy, (dx - dy) * 2) / (Math.PI / 4)) + 8) % 8]
  return (
    <div testId="tracker" style={{ display: 'flex', flexDirection: 'column', gap: 3, position: 'absolute', top: 12, left: 12, width: compact ? 240 : 320, paddingLeft: 10, paddingRight: 12, paddingTop: 6, paddingBottom: 7, backgroundColor: '#0a0c10d0', borderLeftWidth: 2, borderColor: C.amber, pointerEvents: 'none' }}>
      <T c={C.amber} s={10} w={700}>{o.main ? 'MAIN QUEST' : 'SIDE QUEST'}</T>
      <T c={C.text} s={13} w={700} testId="tracker-title">{o.title.toUpperCase()}</T>
      {!compact && <T c={C.dim} s={11}>{o.text}</T>}
      {far >= 0 && <T c={C.amber} s={11}>{far <= 1 ? `> ${o.label}  -  here` : `> ${o.label}  -  ${far * 10} m ${dir}`}</T>}
    </div>
  )
}

const HELP: [string, string][] = [
  ['click / WASD / arrows', 'walk, talk, loot, attack'], ['scroll  /  Z', 'zoom the city'], ['T', 'T.A.R.G.E.T. (pauses combat)'],
  ['arrows in T.A.R.G.E.T.', 'body part / next target'], ['ENTER  /  F', 'fire'], ['E', 'end turn'],
  ['1-5  /  I M Q R', 'WRIST-LINK tabs'], ['TAB', 'cycle tabs / open menu'], ['CTRL-S  /  CTRL-L', 'save / load'],
  ['wasteland radio "..."', 'broadcast from another pane'], ['CTRL-C', 'quit to the shell'],
]
function Help() {
  return (
    <div testId="help" style={{ display: 'flex', flexDirection: 'column', gap: 5, position: 'absolute', top: 50, left: 50, right: 50, padding: 20, backgroundColor: '#0b130ef4', borderWidth: 1, borderColor: C.borderHi, borderRadius: 8, pointerEvents: 'none' }}>
      <T c={C.green} s={15} w={700}>WRIST-LINK  /  FIELD MANUAL</T>
      {HELP.map(([k, v]) => <Row key={k} gap={14}><div style={{ display: 'flex', width: 220 }}><T c={C.amber} s={12}>{k}</T></div><T c={C.text} s={12}>{v}</T></Row>)}
      <T c={C.dim} s={11}>H or ESC to close</T>
    </div>
  )
}
