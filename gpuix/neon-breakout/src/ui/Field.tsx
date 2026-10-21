import { memo } from 'react'
import type { Controller } from '../controller'
import * as C from '../sim/constants'
import type { Brick, Game } from '../sim/sim'
import { PALETTE_POWER } from '../sim/sim'
import { COLORS, FIELD_H, FIELD_W, glow, INK, shade, vgrad } from './theme'

const GridLines = memo(function GridLines() {
  const lines = []
  for (let x = 40; x < FIELD_W; x += 40) lines.push(<div key={`v${x}`} style={{ position: 'absolute', left: x, top: 0, width: 1, height: FIELD_H, backgroundColor: '#2ee6d608' }} />)
  for (let y = 40; y < FIELD_H; y += 40) lines.push(<div key={`h${y}`} style={{ position: 'absolute', left: 0, top: y, width: FIELD_W, height: 1, backgroundColor: '#2ee6d608' }} />)
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width: FIELD_W, height: FIELD_H, background: vgrad('#0b1324', '#04060b') }} />
      {lines}
    </>
  )
})

function BrickView({ b }: { b: Brick }) {
  if (b.kind === 'steel') {
    return (
      <div style={{ position: 'absolute', left: b.x, top: b.y, width: C.BRICK_W, height: C.BRICK_H, borderRadius: 5, background: vgrad('#d9e2ee', '#53606f'), borderWidth: 1, borderColor: '#ffffff66', boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, spreadRadius: 0, color: '#00000088' }] }}>
        <div style={{ position: 'absolute', left: 6, top: 9, width: 40, height: 2, borderRadius: 1, backgroundColor: '#ffffff55' }} />
      </div>
    )
  }
  const damaged = b.maxHp > 1 ? b.hp / b.maxHp : 1
  const base = damaged < 1 ? shade(b.color, -0.35 * (1 - damaged)) : b.color
  return (
    <div
      style={{
        position: 'absolute', left: b.x, top: b.y, width: C.BRICK_W, height: C.BRICK_H, borderRadius: 5,
        background: vgrad(shade(base, 0.25), shade(base, -0.35)),
        borderWidth: b.maxHp > 1 ? 1 : 0, borderColor: b.maxHp > 2 ? '#ffffffaa' : '#ffffff55',
        boxShadow: [glow(b.color, 14, '55'), { offsetX: 0, offsetY: 1, blurRadius: 0, spreadRadius: 0, color: '#ffffff30', inset: true }],
      }}
    >
      <div style={{ position: 'absolute', left: 5, top: 3, width: C.BRICK_W - 10, height: 4, borderRadius: 2, backgroundColor: '#ffffff40' }} />
      {b.maxHp > 1 ? (
        <div style={{ position: 'absolute', left: 0, top: 11, width: C.BRICK_W, height: 6, display: 'flex', flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
          {Array.from({ length: b.hp }, (_, i) => <div key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#0a0f1acc' }} />)}
        </div>
      ) : null}
    </div>
  )
}

const BrickWall = memo(function BrickWall({ bricks }: { bricks: Brick[]; version: number }) {
  return <>{bricks.map((b) => (b.alive ? <BrickView key={b.id} b={b} /> : null))}</>
})

function Flashes({ g }: { g: Game }) {
  const out = []
  for (const b of g.bricks) {
    const age = g.time - b.hitAt
    if (b.hitAt < 0 || age > 0.14) continue
    out.push(<div key={b.id} style={{ position: 'absolute', left: b.x - 2, top: b.y - 2, width: C.BRICK_W + 4, height: C.BRICK_H + 4, borderRadius: 6, backgroundColor: '#ffffff', opacity: (1 - age / 0.14) * 0.85, boxShadow: [glow(b.color, 22, 'cc')] }} />)
  }
  return <>{out}</>
}

function Paddle({ g }: { g: Game }) {
  const w = g.paddleW
  const laser = g.laserTimer > 0
  const accent = g.wideTimer > 0 ? COLORS.sky : COLORS.teal
  return (
    <div style={{ position: 'absolute', left: g.paddleX - w / 2, top: C.PADDLE_Y, width: w, height: C.PADDLE_H, borderRadius: 7, background: vgrad(shade(accent, 0.3), shade(accent, -0.3)), boxShadow: [glow(accent, 18, '88'), glow(accent, 40, '33', 2)] }}>
      <div style={{ position: 'absolute', left: 10, top: 2, width: w - 20, height: 3, borderRadius: 2, backgroundColor: '#ffffffa0' }} />
      {laser ? (
        <>
          <div style={{ position: 'absolute', left: 6, top: -7, width: 8, height: 10, borderRadius: 2, background: vgrad('#fff3d6', COLORS.amber), boxShadow: [glow(COLORS.amber, 10, 'aa')] }} />
          <div style={{ position: 'absolute', left: w - 14, top: -7, width: 8, height: 10, borderRadius: 2, background: vgrad('#fff3d6', COLORS.amber), boxShadow: [glow(COLORS.amber, 10, 'aa')] }} />
        </>
      ) : null}
    </div>
  )
}

function Balls({ g }: { g: Game }) {
  const R = C.BALL_R
  const color = g.slowTimer > 0 ? COLORS.mint : COLORS.teal
  return (
    <>
      {g.balls.map((b) => (
        <div key={b.id}>
          {b.trail.map((t, i) => {
            const r = R * (1 - (i + 1) / 8)
            return <div key={i} style={{ position: 'absolute', left: t.x - r, top: t.y - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: color, opacity: 0.32 * (1 - i / 6) }} />
          })}
          <div style={{ position: 'absolute', left: b.x - R, top: b.y - R, width: R * 2, height: R * 2, borderRadius: R, backgroundColor: '#ffffff', boxShadow: [glow(color, 10, 'dd', 1), glow(color, 26, '55', 3)] }} />
        </div>
      ))}
    </>
  )
}

function Capsules({ g }: { g: Game }) {
  return (
    <>
      {g.capsules.map((c) => {
        const p = PALETTE_POWER[c.kind]
        return (
          <div key={c.id} style={{ position: 'absolute', left: c.x - C.CAPSULE_W / 2, top: c.y - C.CAPSULE_H / 2, width: C.CAPSULE_W, height: C.CAPSULE_H, borderRadius: 8, background: vgrad(shade(p.color, 0.4), shade(p.color, -0.3)), boxShadow: [glow(p.color, 14, '99')], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <text style={{ fontSize: 11, fontWeight: 800, color: '#06121a' }}>{p.label}</text>
          </div>
        )
      })}
      {g.bolts.map((b) => (
        <div key={b.id} style={{ position: 'absolute', left: b.x - 1.5, top: b.y - 14, width: 3, height: 16, borderRadius: 2, backgroundColor: '#fff1c9', boxShadow: [glow(COLORS.amber, 8, 'ee', 1)] }} />
      ))}
    </>
  )
}

function Particles({ g }: { g: Game }) {
  return (
    <>
      {g.particles.map((p, i) => {
        const k = p.life / p.max
        const s = p.size * (0.4 + 0.6 * k)
        return <div key={i} style={{ position: 'absolute', left: p.x - s / 2, top: p.y - s / 2, width: s, height: s, borderRadius: 1, backgroundColor: p.color, opacity: Math.min(1, k * 1.6) }} />
      })}
    </>
  )
}

function Popups({ g }: { g: Game }) {
  return (
    <>
      {g.popups.map((p) => {
        const age = g.time - p.born
        const big = p.text.startsWith('LEVEL')
        const w = big ? 420 : 160
        return (
          <div key={p.id} style={{ position: 'absolute', left: p.x - w / 2, top: p.y - age * (big ? 10 : 46) - 10, width: w, display: 'flex', justifyContent: 'center', opacity: Math.max(0, 1 - Math.max(0, age - 0.45) / 0.45) }}>
            <text style={{ fontSize: big ? 30 : 14, fontWeight: 800, color: p.color }}>{p.text}</text>
          </div>
        )
      })}
    </>
  )
}

function ServeBanner({ g, title }: { g: Game; title: boolean }) {
  if (title || g.phase !== 'serve') return null
  return (
    <div style={{ position: 'absolute', left: 0, top: 400, width: FIELD_W, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <text style={{ fontSize: 13, fontWeight: 700, color: COLORS.amber }}>{`LEVEL ${g.levelNumber}`}</text>
      <text style={{ fontSize: 34, fontWeight: 800, color: INK.text }}>{g.level.name}</text>
      <text style={{ fontSize: 13, color: INK.dim }}>Click or press Space to launch</text>
    </div>
  )
}

export function Field({ c }: { c: Controller }) {
  const g = c.game
  const shake = g.shake()
  const title = c.mode === 'title'
  return (
    <div style={{ position: 'absolute', left: shake.x, top: shake.y, width: FIELD_W, height: FIELD_H }}>
      <GridLines />
      <BrickWall bricks={g.bricks} version={g.brickVersion} />
      <Flashes g={g} />
      <Particles g={g} />
      <Capsules g={g} />
      <Paddle g={g} />
      <Balls g={g} />
      <Popups g={g} />
      <ServeBanner g={g} title={title} />
    </div>
  )
}
