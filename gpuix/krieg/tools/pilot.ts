// Demo/test driver: plays a running `krieg` with REAL OS keyboard events (via tools/input.swift), steering
// from the live snapshot the game publishes for `krieg map`. Nothing is injected into the game process.
//   bun tools/pilot.ts [--secs 30] [--goal kills|key|exit] [--kills n]
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { EMPTY, MW, MH, generateLevel, lineOfSight } from '../src/gen/level'
import { LIVE, type Live } from '../src/live'

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1]! : d }
const SECS = Number(arg('--secs', '30')), GOAL = arg('--goal', 'exit'), KILLS = Number(arg('--kills', '99'))
const INPUT = `${homedir()}/bin/input`
const CODE: Record<string, number> = { w: 13, s: 1, a: 0, d: 2, f: 3, left: 123, right: 124 }

const run = (...a: string[]) => Bun.spawnSync([INPUT, ...a])
const held = new Set<string>()
function want(keys: Set<string>) {
  for (const k of [...held]) if (!keys.has(k)) { run('--ku', String(CODE[k])); held.delete(k) }
  for (const k of keys) if (!held.has(k)) { run('--kd', String(CODE[k]), k.length === 1 ? k : ''); held.add(k) }
}
const release = () => want(new Set())
process.on('SIGINT', () => { release(); process.exit(0) })

function front() {
  const asn = Bun.spawnSync(['lsappinfo', 'front']).stdout.toString().trim()
  return /ghostty/i.test(Bun.spawnSync(['lsappinfo', 'info', '-only', 'name', asn]).stdout.toString())
}
const read = (): Live | null => { try { return JSON.parse(readFileSync(LIVE, 'utf8')) } catch { return null } }

let live = read()
if (!live) throw new Error(`no live snapshot at ${LIVE}; start krieg first`)
const level = generateLevel(live.seed)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

function path(sx: number, sy: number, goal: (i: number) => boolean, key: boolean): number[] | null {
  const prev = new Int32Array(MW * MH).fill(-2), s = Math.floor(sy) * MW + Math.floor(sx), q = [s]
  prev[s] = -1
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!
    if (goal(i)) { const out = []; for (let c = i; c >= 0; c = prev[c]!) out.unshift(c); return out }
    for (const o of [1, -1, MW, -MW]) {
      const n = i + o, d = level.doorAt[n]!
      if (prev[n] !== -2 || (d >= 0 ? level.doors[d]!.locked && !key : level.cells[n] !== EMPTY)) continue
      prev[n] = i; q.push(n)
    }
  }
  return null
}

const t0 = Date.now()
let lastFront = 0, stuck = 0, lastPos = [0, 0]
while (Date.now() - t0 < SECS * 1000) {
  if (Date.now() - lastFront > 2000) { if (!front()) { release(); console.error('ghostty not frontmost, stopping'); process.exit(1) } lastFront = Date.now() }
  live = read() ?? live
  if (live.state !== 'play') break
  if (GOAL === 'key' && live.key) break
  if (live.kills >= KILLS) break
  live.d.forEach((o, i) => { level.doors[i]!.open = o })
  const [px, py, pa] = live.p
  const keys = new Set<string>()
  const foes = live.e.map(([x, y, , st], i) => ({ x, y, st, i, d: Math.hypot(x - px, y - py) }))
    .filter((e) => e.st !== 'dead' && e.d < 9 && lineOfSight(level, px, py, e.x, e.y)).sort((a, b) => a.d - b.d)
  let aim: number
  if (foes.length) {
    const f = foes[0]!
    aim = Math.atan2(f.y - py, f.x - px)
    const err = wrap(aim - pa)
    if (Math.abs(err) < 0.09) keys.add('f')
    if (f.d > 3.2 && Math.abs(err) < 0.4) keys.add('w')
    if (f.d < 1.6) keys.add('s')
  } else {
    const alive = live.e.filter(([, , , st]) => st !== 'dead')
    let goal: (i: number) => boolean
    const near = (x: number, y: number) => (i: number) => i === Math.floor(y) * MW + Math.floor(x)
    const key = level.pickups.find((k) => k.kind === 'key')!
    if (GOAL === 'kills' && alive.length) goal = (i) => alive.some(([x, y]) => near(x, y)(i))
    else if (!live.key) goal = near(key.x, key.y)
    else goal = near(level.exit.x, level.exit.y)
    const p = path(px, py, goal, live.key)
    if (!p || p.length < 2) { aim = pa; keys.add('w') } else {
      const c = p[Math.min(2, p.length - 1)]!
      aim = Math.atan2(Math.floor(c / MW) + 0.5 - py, (c % MW) + 0.5 - px)
      if (Math.abs(wrap(aim - pa)) < 0.6) keys.add('w')
    }
    if (Math.hypot(px - lastPos[0]!, py - lastPos[1]!) < 0.01 && keys.has('w')) { if (++stuck > 20) { keys.add(stuck % 40 < 20 ? 'a' : 'd') } } else stuck = 0
    lastPos = [px, py]
  }
  const err = wrap(aim - pa)
  if (err > 0.06) keys.add('right'); else if (err < -0.06) keys.add('left')
  want(keys)
  await Bun.sleep(30)
}
release()
console.log(JSON.stringify({ state: live.state, kills: live.kills, hp: live.hp, key: live.key }))
