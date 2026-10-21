import { memo, type ReactNode } from 'react'
import type { Controller } from '../controller'
import { LASER_TIME, MAX_LIVES, SLOW_TIME, WIDE_TIME } from '../sim/constants'
import { PALETTE_POWER } from '../sim/sim'
import type { ScoreEntry } from '../scores'
import { COLORS, fmt, glow, ICONS, INK, SIDE_W, vgrad } from './theme'

export function Panel({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, padding: 16, borderRadius: 16, background: vgrad('#0e1626', '#090e18'), borderWidth: 1, borderColor: INK.panelBorder, boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 30, spreadRadius: 0, color: '#00000066' }] }}>
      {children}
    </div>
  )
}

export function Label({ children, color = INK.faint }: { children: string; color?: string }) {
  return <text style={{ fontSize: 11, fontWeight: 700, color }}>{children}</text>
}

const ScorePanel = memo(function ScorePanel({ score, hi, level, levelName, lives }: { score: number; hi: number; level: number; levelName: string; lives: number }) {
  return (
    <Panel gap={14}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Label>SCORE</Label>
        <text testId="score" style={{ fontSize: 36, fontWeight: 800, color: INK.text }}>{fmt(score)}</text>
        <text style={{ fontSize: 12, fontWeight: 600, color: COLORS.amber }}>{`HIGH ${fmt(hi)}`}</text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Label>LEVEL</Label>
          <text testId="level" style={{ fontSize: 15, fontWeight: 700, color: INK.text }}>{`${level} · ${levelName}`}</text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'end' }}>
          <Label>LIVES</Label>
          <div testId="lives" style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
            {Array.from({ length: MAX_LIVES }, (_, i) => (
              <svg key={i} source={ICONS.heart} style={{ width: 15, height: 15, color: i < lives ? COLORS.pink : '#ffffff14' }} />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  )
})

function ComboPanel({ combo, best }: { combo: number; best: number }) {
  const mult = Math.min(combo, 8)
  const color = mult >= 5 ? COLORS.pink : mult >= 2 ? COLORS.amber : INK.dim
  return (
    <Panel gap={8}>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Label>COMBO</Label>
        <text style={{ fontSize: 11, color: INK.faint }}>{`best ${best}`}</text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <text testId="combo" style={{ fontSize: 26, fontWeight: 800, color }}>{`x${Math.max(1, mult)}`}</text>
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'row', gap: 4 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ flexGrow: 1, height: 8, borderRadius: 4, backgroundColor: i < mult ? (i >= 4 ? COLORS.pink : COLORS.amber) : '#ffffff10', boxShadow: i < mult ? [glow(i >= 4 ? COLORS.pink : COLORS.amber, 8, '77')] : [] }} />
          ))}
        </div>
      </div>
    </Panel>
  )
}

function PowerRow({ kind, value, active }: { kind: 'multi' | 'wide' | 'laser' | 'slow'; value: number; active: boolean }) {
  const p = PALETTE_POWER[kind]
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, opacity: active ? 1 : 0.38 }}>
      <div style={{ width: 26, height: 14, borderRadius: 7, background: vgrad(p.color, p.color + '88'), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: active ? [glow(p.color, 10, '88')] : [] }}>
        <text style={{ fontSize: 9, fontWeight: 800, color: '#06121a' }}>{p.label}</text>
      </div>
      <text style={{ width: 84, fontSize: 12, fontWeight: 600, color: INK.text }}>{p.name}</text>
      <div style={{ flexGrow: 1, height: 4, borderRadius: 2, backgroundColor: '#ffffff10' }}>
        <div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, height: 4, borderRadius: 2, backgroundColor: p.color }} />
      </div>
    </div>
  )
}

function PowersPanel({ c, idle }: { c: Controller; idle: boolean }) {
  const g = c.game
  const balls = idle ? 1 : g.balls.length
  return (
    <Panel gap={9}>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
        <Label>POWER-UPS</Label>
        <text testId="ball-count" style={{ fontSize: 11, color: INK.faint }}>{`${balls} ball${balls === 1 ? '' : 's'}`}</text>
      </div>
      <PowerRow kind="multi" value={Math.min(1, (balls - 1) / 4)} active={balls > 1} />
      <PowerRow kind="wide" value={g.wideTimer / WIDE_TIME} active={!idle && g.wideTimer > 0} />
      <PowerRow kind="laser" value={g.laserTimer / LASER_TIME} active={!idle && g.laserTimer > 0} />
      <PowerRow kind="slow" value={g.slowTimer / SLOW_TIME} active={!idle && g.slowTimer > 0} />
    </Panel>
  )
}

export const ScoreTable = memo(function ScoreTable({ scores, highlight, rows = 5, testId }: { scores: ScoreEntry[]; highlight: number | null; rows?: number; testId?: string }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {scores.slice(0, rows).map((s, i) => {
        const hot = highlight === i + 1
        const color = hot ? COLORS.teal : i === 0 ? COLORS.amber : INK.text
        return (
          <div key={`${s.initials}-${s.score}-${i}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: 7, backgroundColor: hot ? '#2ee6d61f' : '#00000000' }}>
            <text style={{ width: 18, fontSize: 12, fontWeight: 700, color: INK.faint }}>{`${i + 1}`}</text>
            <text style={{ width: 44, fontSize: 13, fontWeight: 800, color }}>{s.initials}</text>
            <text style={{ flexGrow: 1, fontSize: 11, color: INK.faint }}>{`L${s.level}`}</text>
            <text style={{ fontSize: 13, fontWeight: 700, color }}>{fmt(s.score)}</text>
          </div>
        )
      })}
    </div>
  )
})

export function Sidebar({ c }: { c: Controller }) {
  const g = c.game
  const title = c.mode === 'title'
  return (
    <div style={{ width: SIDE_W, height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ScorePanel score={title ? 0 : g.score} hi={c.highScore} level={title ? 1 : g.levelNumber} levelName={title ? 'Neon Grid' : g.level.name} lives={title ? 3 : Math.max(0, g.lives)} />
      <ComboPanel combo={title ? 0 : g.combo} best={title ? 0 : g.bestCombo} />
      <PowersPanel c={c} idle={title} />
      <Panel gap={8}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <svg source={ICONS.trophy} style={{ width: 12, height: 12, color: COLORS.amber }} />
          <Label>HIGH SCORES</Label>
        </div>
        <ScoreTable scores={c.scores} highlight={c.savedRank} rows={4} testId="sidebar-scores" />
      </Panel>
    </div>
  )
}
