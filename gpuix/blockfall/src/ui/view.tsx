import type { ReactNode } from 'react'
import { cleanInitials } from '../scores'
import type { Controller } from '../controller'
import { CLEAR_TIME, COLS, HIDDEN, ROWS, type Game } from '../sim/game'
import { SHAPES, type PieceType } from '../sim/pieces'
import { alpha, mix, type Theme } from '../theme'
import type { Layout } from './layout'

type Shadow = { offsetX: number; offsetY: number; blurRadius: number; spreadRadius: number; color: string }
const glow = (color: string, blur: number, a = 0.5, spread = 0): Shadow => ({ offsetX: 0, offsetY: 0, blurRadius: blur, spreadRadius: spread, color: alpha(color, a) })
const vgrad = (top: string, bottom: string) => ({ type: 'linear-gradient' as const, angle: 180, stops: [{ color: top, position: 0 }, { color: bottom, position: 1 }] as [{ color: string; position: number }, { color: string; position: number }] })
export const fmt = (n: number) => n.toLocaleString('en-US')

export interface ViewProps { c: Controller; t: Theme; L: Layout }

// ---------- blocks ----------
type BlockKind = 'locked' | 'active' | 'ghost'
function Block({ x, y, s, color, kind, fade = 1 }: { x: number; y: number; s: number; color: string; kind: BlockKind; fade?: number }) {
  const inset = Math.max(1, Math.round(s * 0.05))
  const size = s - inset * 2
  const r = Math.max(2, s * 0.16)
  if (kind === 'ghost') {
    return <div style={{ position: 'absolute', left: x + inset, top: y + inset, width: size, height: size, borderRadius: r, backgroundColor: alpha(color, 0.1), borderWidth: Math.max(1, s * 0.05), borderColor: alpha(color, 0.5) }} />
  }
  return (
    <div
      style={{
        position: 'absolute', left: x + inset, top: y + inset, width: size, height: size, borderRadius: r, opacity: fade,
        background: vgrad(mix(color, '#ffffff', kind === 'active' ? 0.3 : 0.18), mix(color, '#000000', kind === 'active' ? 0.05 : 0.2)),
        borderWidth: 1, borderColor: mix(color, '#ffffff', 0.4),
        boxShadow: kind === 'active' ? [glow(color, s * 0.55, 0.55)] : [],
      } as never}
    >
      <div style={{ position: 'absolute', left: size * 0.14, top: size * 0.1, width: size * 0.5, height: Math.max(1, size * 0.12), borderRadius: size * 0.06, backgroundColor: '#ffffff55' }} />
    </div>
  )
}

export function MiniPiece({ type, s, t, dim = false, testId }: { type: PieceType | null; s: number; t: Theme; dim?: boolean; testId?: string }) {
  const box = { width: s * 4, height: s * 2.4 }
  if (!type) return <div testId={testId} style={box} />
  const cells = SHAPES[type][0]!
  const xs = cells.map(([x]) => x), ys = cells.map(([, y]) => y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const ox = (4 - (maxX - minX + 1)) / 2 - minX, oy = (2.4 - (maxY - minY + 1)) / 2 - minY
  const color = dim ? mix(t.pieces[type], t.bg, 0.6) : t.pieces[type]
  return (
    <div testId={testId} style={{ ...box, position: 'relative' }}>
      {cells.map(([x, y], i) => <Block key={i} x={(x + ox) * s} y={(y + oy) * s} s={s} color={color} kind="locked" />)}
    </div>
  )
}

// ---------- well ----------
export function Well({ c, t, L }: ViewProps) {
  const g = c.game
  const s = L.c
  const children: ReactNode[] = []
  for (let x = 1; x < COLS; x++) children.push(<div key={`gx${x}`} style={{ position: 'absolute', left: x * s, top: 0, width: 1, height: L.bh, backgroundColor: alpha(t.fg, 0.035) }} />)
  for (let y = 1; y < 20; y++) children.push(<div key={`gy${y}`} style={{ position: 'absolute', left: 0, top: y * s, width: L.bw, height: 1, backgroundColor: alpha(t.fg, 0.035) }} />)
  const clearing = g.phase === 'clearing' ? g.clearingRows : []
  const k = g.phase === 'clearing' ? g.clearTimer / CLEAR_TIME : 0
  for (let y = HIDDEN; y < ROWS; y++) {
    const row = g.board[y]!
    const isClear = clearing.includes(y)
    for (let x = 0; x < COLS; x++) {
      const type = row[x]
      if (type) children.push(<Block key={`b${x}_${y}`} x={x * s} y={(y - HIDDEN) * s} s={s} color={t.pieces[type]} kind="locked" fade={isClear ? 1 - k : 1} />)
    }
    if (isClear) children.push(<div key={`f${y}`} style={{ position: 'absolute', left: 0, top: (y - HIDDEN) * s, width: L.bw, height: s, backgroundColor: alpha('#ffffff', 0.85 * (1 - k)), boxShadow: [glow('#ffffff', s, 0.6 * (1 - k))] } as never} />)
  }
  if (g.active && g.phase === 'play') {
    const ghost = g.ghost()!
    const color = t.pieces[g.active.type]
    if (ghost.y !== g.active.y) for (const [x, y] of g.cells(ghost)) if (y >= HIDDEN) children.push(<Block key={`g${x}_${y}`} x={x * s} y={(y - HIDDEN) * s} s={s} color={color} kind="ghost" />)
    for (const [x, y] of g.cells()) if (y >= HIDDEN) children.push(<Block key={`a${x}_${y}`} x={x * s} y={(y - HIDDEN) * s} s={s} color={color} kind="active" />)
  }
  if (g.lockFlash) {
    const a = 1 - g.lockFlash.age / 0.25
    for (const [x, y] of g.lockFlash.cells) if (y >= HIDDEN) children.push(<div key={`l${x}_${y}`} style={{ position: 'absolute', left: x * s, top: (y - HIDDEN) * s, width: s, height: s, borderRadius: s * 0.16, backgroundColor: alpha('#ffffff', 0.35 * a) }} />)
  }
  return (
    <div
      testId="well"
      style={{
        position: 'absolute', left: L.bx, top: L.by, width: L.bw, height: L.bh, borderRadius: Math.max(4, s * 0.25), overflow: 'hidden',
        backgroundColor: t.well, borderWidth: 1, borderColor: g.b2b && c.mode === 'playing' ? alpha(t.warn, 0.55) : t.line,
        boxShadow: [glow(t.accent, s * 1.2, 0.07), { offsetX: 0, offsetY: s * 0.4, blurRadius: s * 1.4, spreadRadius: 0, color: '#00000099' }],
      } as never}
    >
      {children}
    </div>
  )
}

export function Particles({ c, t, L, ox, oy }: ViewProps & { ox: number; oy: number }) {
  const s = L.c
  return (
    <>
      {c.game.particles.map((p, i) => {
        const a = 1 - p.life / p.max
        const size = Math.max(2, p.size * s * (0.6 + a * 0.4))
        return <div key={i} style={{ position: 'absolute', left: L.bx + ox + p.x * s - size / 2, top: L.by + oy + p.y * s - size / 2, width: size, height: size, borderRadius: size * 0.25, backgroundColor: alpha(t.pieces[p.type], a), boxShadow: [glow(t.pieces[p.type], size * 2, a * 0.6)] } as never} />
      })}
    </>
  )
}

export function Popups({ c, t, L, ox, oy }: ViewProps & { ox: number; oy: number }) {
  const s = L.c
  const g = c.game
  return (
    <>
      {g.popups.map((p, i) => {
        const a = p.age < 1 ? 1 : 1 - (p.age - 1) / 0.4
        const rise = p.age * s * 1.4
        const color = p.kind === 'level' ? t.good : p.kind === 'tspin' ? t.pieces.T : p.text === 'Quad' ? t.pieces.I : t.fg
        const top = L.by + oy + L.bh * (p.kind === 'level' ? 0.22 : 0.36) - rise + i * s * 0.2
        return (
          <div key={`${i}-${p.text}`} style={{ position: 'absolute', left: L.bx + ox, top, width: L.bw, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s * 0.1, opacity: Math.max(0, a) }}>
            <text style={{ fontSize: Math.max(14, s * 0.95), fontWeight: 800, color }}>{p.text}</text>
            {p.sub ? <text style={{ fontSize: Math.max(10, s * 0.42), fontWeight: 700, color: t.warn }}>{p.sub}</text> : null}
            {p.points ? <text style={{ fontSize: Math.max(10, s * 0.45), fontWeight: 600, color: t.dim }}>{`+${fmt(p.points)}`}</text> : null}
          </div>
        )
      })}
    </>
  )
}

// ---------- side panels ----------
const Label = ({ t, s, children }: { t: Theme; s: number; children: string }) => (
  <text style={{ fontSize: Math.max(9, s * 0.32), fontWeight: 700, color: t.faint, letterSpacing: 1.2 } as never}>{children}</text>
)

function Card({ t, s, children, testId, grow }: { t: Theme; s: number; children: ReactNode; testId?: string; grow?: boolean }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', gap: s * 0.25, padding: s * 0.4, borderRadius: s * 0.3, backgroundColor: t.panel, borderWidth: 1, borderColor: t.line, flexGrow: grow ? 1 : 0 }}>
      {children}
    </div>
  )
}

function Stat({ t, s, label, value, testId, color, big }: { t: Theme; s: number; label: string; value: string; testId?: string; color?: string; big?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: s * 0.04 }}>
      <Label t={t} s={s}>{label}</Label>
      <text testId={testId} style={{ fontSize: Math.max(12, s * (big ? 0.78 : 0.56)), fontWeight: 800, color: color ?? t.fg }}>{value}</text>
    </div>
  )
}

export function HoldCard({ c, t, L }: ViewProps) {
  const s = L.c
  return (
    <Card t={t} s={s}>
      <Label t={t} s={s}>HOLD</Label>
      <MiniPiece testId="hold-piece" type={c.game.hold} s={s * 0.85} t={t} dim={c.game.holdUsed} />
    </Card>
  )
}

export function NextCard({ c, t, L, count }: ViewProps & { count: number }) {
  const s = L.c
  return (
    <Card t={t} s={s} testId="next-queue">
      <Label t={t} s={s}>NEXT</Label>
      {c.game.queue.slice(0, count).map((type, i) => <MiniPiece key={i} type={type} s={s * (i === 0 ? 0.85 : 0.62)} t={t} />)}
    </Card>
  )
}

export function StatsCard({ c, t, L, compact }: ViewProps & { compact?: boolean }) {
  const s = L.c
  const g = c.game
  const pps = g.time > 1 ? g.pieces / g.time : 0
  return (
    <Card t={t} s={s}>
      <Stat t={t} s={s} label="SCORE" value={fmt(g.score)} testId="score" big />
      <div style={{ display: 'flex', flexDirection: 'row', gap: s * 0.6 }}>
        <Stat t={t} s={s} label="LEVEL" value={String(g.level)} testId="level" color={t.accent} />
        <Stat t={t} s={s} label="LINES" value={String(g.lines)} testId="lines" />
      </div>
      {compact ? null : <Stat t={t} s={s} label="BEST" value={fmt(c.best)} color={t.dim} />}
      {compact ? null : <Stat t={t} s={s} label="PIECES / SEC" value={pps.toFixed(2)} color={t.dim} />}
      <div style={{ display: 'flex', flexDirection: 'row', gap: s * 0.2, flexWrap: 'wrap' }}>
        <Chip t={t} s={s} on={g.b2b} color={t.warn} label="B2B" />
        <Chip t={t} s={s} on={g.combo > 0} color={t.good} label={g.combo > 0 ? `${g.combo} COMBO` : 'COMBO'} />
      </div>
    </Card>
  )
}

function Chip({ t, s, on, color, label }: { t: Theme; s: number; on: boolean; color: string; label: string }) {
  return (
    <div style={{ paddingLeft: s * 0.2, paddingRight: s * 0.2, height: Math.max(14, s * 0.5), borderRadius: s * 0.12, display: 'flex', alignItems: 'center', backgroundColor: on ? alpha(color, 0.18) : 'transparent', borderWidth: 1, borderColor: on ? alpha(color, 0.6) : t.line }}>
      <text style={{ fontSize: Math.max(8, s * 0.28), fontWeight: 800, color: on ? color : t.faint }}>{label}</text>
    </div>
  )
}

function Keys({ t, s, rows }: { t: Theme; s: number; rows: [string, string][] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: s * 0.12 }}>
      {rows.map(([k, label]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: s * 0.2 }}>
          <div style={{ minWidth: s * 1.3, paddingLeft: s * 0.12, paddingRight: s * 0.12, height: Math.max(14, s * 0.48), borderRadius: s * 0.1, backgroundColor: alpha(t.fg, 0.06), borderWidth: 1, borderColor: t.line, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <text style={{ fontSize: Math.max(8, s * 0.27), fontWeight: 700, color: t.fg }}>{k}</text>
          </div>
          <text style={{ fontSize: Math.max(8, s * 0.28), color: t.dim }}>{label}</text>
        </div>
      ))}
    </div>
  )
}

export const CONTROLS: [string, string][] = [['← →', 'move'], ['↓', 'soft drop'], ['↑ X', 'rotate'], ['Z', 'rotate left'], ['space', 'hard drop'], ['C', 'hold'], ['P', 'pause'], ['^C', 'quit']]

export function Brand({ t, s }: { t: Theme; s: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: s * 0.25 }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 2 }}>
        {(['I', 'T', 'S'] as PieceType[]).map((p) => <div key={p} style={{ width: s * 0.28, height: s * 0.28, borderRadius: s * 0.06, backgroundColor: t.pieces[p], boxShadow: [glow(t.pieces[p], s * 0.3, 0.6)] } as never} />)}
      </div>
      <text style={{ fontSize: Math.max(11, s * 0.46), fontWeight: 800, color: t.fg }}>blockfall</text>
    </div>
  )
}

export function SidePanels(p: ViewProps) {
  const { L, t } = p
  const s = L.c
  if (L.kind === 'wide') {
    return (
      <>
        <div style={{ position: 'absolute', left: L.leftX, top: L.by, width: L.sideW, height: L.bh, display: 'flex', flexDirection: 'column', gap: s * 0.35 }}>
          <Brand t={t} s={s} />
          <HoldCard {...p} />
          <StatsCard {...p} />
          <div style={{ flexGrow: 1 }} />
          {L.bh > 520 ? <Keys t={t} s={s} rows={CONTROLS} /> : null}
        </div>
        <div style={{ position: 'absolute', left: L.rightX, top: L.by, width: L.sideW, height: L.bh, display: 'flex', flexDirection: 'column', gap: s * 0.35 }}>
          <NextCard {...p} count={5} />
        </div>
      </>
    )
  }
  return (
    <div style={{ position: 'absolute', left: L.rightX, top: L.by, width: L.sideW, height: L.bh, display: 'flex', flexDirection: 'column', gap: s * 0.3 }}>
      <Brand t={t} s={s} />
      <HoldCard {...p} />
      <NextCard {...p} count={3} />
      <StatsCard {...p} compact />
    </div>
  )
}

// ---------- overlays ----------
export function Button({ t, s, label, testId, onClick, primary = false }: { t: Theme; s: number; label: string; testId: string; onClick: () => void; primary?: boolean }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        width: Math.max(110, s * 5.2), height: Math.max(30, s * 1.05), borderRadius: s * 0.25, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        backgroundColor: primary ? t.accent : alpha(t.fg, 0.06), borderWidth: 1, borderColor: primary ? mix(t.accent, '#ffffff', 0.3) : t.line,
        boxShadow: primary ? [glow(t.accent, s * 0.6, 0.35)] : [],
        hover: primary ? { backgroundColor: mix(t.accent, '#ffffff', 0.15) } : { backgroundColor: alpha(t.fg, 0.12) },
      } as never}
    >
      <text style={{ fontSize: Math.max(11, s * 0.42), fontWeight: 700, color: primary ? t.bg : t.fg }}>{label}</text>
    </div>
  )
}

function Sheet({ L, t, children, testId, a = 0.86 }: { L: Layout; t: Theme; children: ReactNode; testId: string; a?: number }) {
  return (
    <div testId={testId} style={{ position: 'absolute', left: L.bx, top: L.by, width: L.bw, height: L.bh, borderRadius: Math.max(4, L.c * 0.25), backgroundColor: alpha(t.bg, a), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: L.c * 0.4, padding: L.c * 0.5 }}>
      {children}
    </div>
  )
}

export function Overlay({ c, t, L }: ViewProps) {
  const s = L.c
  const title = (text: string, color = t.fg) => <text style={{ fontSize: Math.max(18, s * 1.1), fontWeight: 800, color }}>{text}</text>
  const small = (text: string, color = t.dim) => <text style={{ fontSize: Math.max(10, s * 0.36), color }}>{text}</text>
  if (c.mode === 'title') {
    return (
      <Sheet L={L} t={t} testId="title-screen" a={0.8}>
        <Brand t={t} s={s * 2} />
        {small('Falling blocks for your terminal split')}
        <div style={{ height: s * 0.2 }} />
        <Button t={t} s={s} label="Play" testId="play-button" primary onClick={() => c.start()} />
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: s * 0.3 }}>
          <div testId="level-down" onClick={() => { c.startLevel = Math.max(1, c.startLevel - 1) }} style={{ cursor: 'pointer', padding: s * 0.15 }}><text style={{ fontSize: Math.max(12, s * 0.5), color: t.dim }}>‹</text></div>
          <text testId="start-level" style={{ fontSize: Math.max(11, s * 0.4), fontWeight: 700, color: t.fg }}>{`Level ${c.startLevel}`}</text>
          <div testId="level-up" onClick={() => { c.startLevel = Math.min(15, c.startLevel + 1) }} style={{ cursor: 'pointer', padding: s * 0.15 }}><text style={{ fontSize: Math.max(12, s * 0.5), color: t.dim }}>›</text></div>
        </div>
        {c.scores.length ? <ScoreTable c={c} t={t} s={s} rows={5} /> : small('No high scores yet', t.faint)}
        {small('Enter to play  ·  ← → level  ·  ^C quit', t.faint)}
      </Sheet>
    )
  }
  if (c.mode === 'paused') {
    return (
      <Sheet L={L} t={t} testId="pause-screen">
        {title('Paused')}
        {small(`${fmt(c.game.score)} points · level ${c.game.level}`)}
        <Button t={t} s={s} label="Resume" testId="resume-button" primary onClick={() => c.resume()} />
        <Button t={t} s={s} label="Restart" testId="restart-button" onClick={() => c.restart()} />
        <Button t={t} s={s} label="Menu" testId="menu-button" onClick={() => c.toTitle()} />
      </Sheet>
    )
  }
  if (c.mode === 'gameover') return <GameOver c={c} t={t} L={L} />
  return null
}

function GameOver({ c, t, L }: ViewProps) {
  const s = L.c
  const g = c.game
  // GPUIX keeps showing a native edit when the cleaned value equals the previous prop, so echo the raw text once, then clean it.
  if (c.draft !== cleanInitials(c.draft)) queueMicrotask(() => { c.draft = cleanInitials(c.draft) })
  return (
    <Sheet L={L} t={t} testId="gameover-screen" a={0.9}>
      <text style={{ fontSize: Math.max(18, s * 1.1), fontWeight: 800, color: t.fg }}>Game over</text>
      <text testId="final-score" style={{ fontSize: Math.max(16, s * 0.9), fontWeight: 800, color: t.accent }}>{fmt(g.score)}</text>
      <text style={{ fontSize: Math.max(10, s * 0.36), color: t.dim }}>{`${g.lines} lines · level ${g.level} · ${g.quads} quads · best combo ${Math.max(0, g.maxCombo)}`}</text>
      {c.canEnterScore ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: s * 0.25 }}>
          <text style={{ fontSize: Math.max(10, s * 0.36), fontWeight: 700, color: t.warn }}>New high score · your initials</text>
          <div style={{ display: 'flex', flexDirection: 'row', gap: s * 0.2, alignItems: 'center' }}>
            <div style={{ width: s * 3, height: Math.max(30, s * 1.05), borderRadius: s * 0.2, backgroundColor: alpha(t.fg, 0.06), borderWidth: 1, borderColor: alpha(t.accent, 0.6), display: 'flex', alignItems: 'center', paddingLeft: s * 0.3 }}>
              <input
                testId="initials-input"
                autoFocus
                value={c.draft}
                placeholder="AAA"
                theme={{ caret: t.accent }}
                onChange={(e) => { c.draft = e.value ?? '' }}
                onSubmit={(e) => c.submitInitials(e.value ?? c.draft)}
                style={{ flexGrow: 1, minWidth: 0, fontSize: Math.max(14, s * 0.6), fontWeight: 800, color: t.fg }}
              />
            </div>
            <Button t={t} s={s * 0.7} label="Save" testId="save-score" primary onClick={() => c.submitInitials(c.draft)} />
          </div>
        </div>
      ) : c.savedRank >= 0 ? (
        <text testId="saved-note" style={{ fontSize: Math.max(10, s * 0.38), fontWeight: 700, color: t.good }}>{`Saved ${c.savedInitials} at #${c.savedRank + 1}`}</text>
      ) : null}
      {c.scores.length ? <ScoreTable c={c} t={t} s={s} rows={5} /> : null}
      {c.canEnterScore ? null : (
        <div style={{ display: 'flex', flexDirection: 'row', gap: s * 0.3 }}>
          <Button t={t} s={s * 0.8} label="Play again" testId="again-button" primary onClick={() => c.start()} />
          <Button t={t} s={s * 0.8} label="Menu" testId="menu-button" onClick={() => c.toTitle()} />
        </div>
      )}
    </Sheet>
  )
}

function ScoreTable({ c, t, s, rows }: { c: Controller; t: Theme; s: number; rows: number }) {
  const fs = Math.max(10, s * 0.36)
  return (
    <div testId="score-table" style={{ display: 'flex', flexDirection: 'column', gap: s * 0.08, width: s * 7 }}>
      {c.scores.slice(0, rows).map((e, i) => {
        const me = c.savedRank === i
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: s * 0.3 }}>
            <text style={{ fontSize: fs, color: t.faint, width: s * 0.6 }}>{`${i + 1}`}</text>
            <text style={{ fontSize: fs, fontWeight: 800, color: me ? t.good : t.fg, width: s * 1.6 }}>{e.name}</text>
            <div style={{ flexGrow: 1 }} />
            <text style={{ fontSize: fs, fontWeight: 700, color: me ? t.good : t.dim }}>{fmt(e.score)}</text>
          </div>
        )
      })}
    </div>
  )
}

export function shakeOffset(g: Game, s: number) {
  const k = g.trauma * g.trauma * s * 0.35
  return { ox: Math.sin(g.time * 91) * k, oy: Math.cos(g.time * 77) * k }
}
