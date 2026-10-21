// The game publishes a small live snapshot so `krieg map` in another Ghostty pane can follow along.
import { renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { World } from './game/world'

export const LIVE = process.env.KRIEG_LIVE ?? join(tmpdir(), 'krieg-live.json')

export interface Live {
  seed: number; t: number; state: string; kills: number; hp: number; key: boolean
  p: [number, number, number]
  e: [number, number, string, string, number][] // x, y, kind, ai state, hp ratio
  d: number[] // door openness
  k: boolean[] // pickups taken
  q: [number, number, string][]
}

export function liveOf(w: World): Live {
  const r = (v: number) => Math.round(v * 100) / 100
  return {
    seed: w.level.seed, t: Date.now(), state: w.state, kills: w.kills, hp: Math.ceil(w.p.hp), key: w.p.hasKey,
    p: [r(w.p.x), r(w.p.y), r(w.p.angle)],
    e: w.enemies.map((e) => [r(e.x), r(e.y), e.kind, e.state, r(Math.max(0, e.hp / e.maxHp))]),
    d: w.level.doors.map((d) => r(d.open)),
    k: w.pickups.map((k) => k.taken),
    q: w.projs.map((q) => [r(q.x), r(q.y), q.kind]),
  }
}

export function writeLive(w: World) {
  try { writeFileSync(LIVE + '.tmp', JSON.stringify(liveOf(w))); renameSync(LIVE + '.tmp', LIVE) } catch {}
}
