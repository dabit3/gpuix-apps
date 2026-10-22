import { ENEMIES, ITEMS, NPCS, PERKS, QUESTS, STATS, WORLD, type DialogueOption, type Stat } from './content'
import { nextRandom } from './rng'
import { MAP_H, MAP_W, findPath, givesCover, isSolidTile, lightAt, lineOfSight, regionAt, tileAt } from './world'

export type Mode = 'explore' | 'dialogue' | 'combat' | 'target' | 'loot' | 'barter' | 'dead' | 'ending'
export type BodyPart = 'head' | 'torso' | 'arms' | 'legs'
export const BODY_PARTS: BodyPart[] = ['head', 'torso', 'arms', 'legs']
const PART_MOD: Record<BodyPart, number> = { head: -30, torso: 0, arms: -15, legs: -10 }

export interface Stack { uid: number; id: string; qty: number; cond: number }
export interface Actor {
  id: string; type: string; name: string; x: number; y: number; hp: number; maxHp: number; ap: number
  group: string; hostile: boolean; dead: boolean; removed: boolean; npc?: string
  crippled: { legs: boolean; arms: boolean }; engaged: boolean
}
export interface NpcState { id: string; x: number; y: number; following: boolean; removed: boolean }
export interface Container { id: string; name: string; x: number; y: number; items: Stack[]; caps: number; opened: boolean; locked: boolean }
export interface ShotFx { t: number; fromX: number; fromY: number; toX: number; toY: number; hit: boolean; crit: boolean; part: BodyPart; dmg: number; byPlayer: boolean; melee: boolean; target: string }
export interface Player {
  name: string; x: number; y: number; hp: number; ap: number; xp: number; level: number; points: number
  stats: Record<Stat, number>; perks: string[]; rads: number; caps: number
  weapon: number | null; armor: number | null; inv: Stack[]; facing: number
}
export interface GameState {
  version: 1; seed: number; rng: number; turn: number; mode: Mode; nextUid: number
  player: Player; actors: Actor[]; npcs: NpcState[]; containers: Container[]
  quests: Record<string, string>; flags: Record<string, boolean>; rep: Record<string, number>
  log: { turn: number; text: string; kind: LogKind }[]
  dialogue: { npc: string; node: string; result: string | null } | null
  combat: { round: number } | null
  target: { actor: string; part: BodyPart } | null
  loot: string | null
  barter: { stock: Stack[]; caps: number }
  path: [number, number][]
  shots: ShotFx[]
  radio: string
  broadcasts: string[]
  ending: string | null
}
export type LogKind = 'info' | 'quest' | 'combat' | 'loot' | 'system' | 'radio'

export interface NewGameOptions { name?: string; stats?: Partial<Record<Stat, number>>; perks?: string[]; seed?: number }
export const STAT_POOL = 35
export const DEFAULT_STATS: Record<Stat, number> = { grit: 5, wits: 6, reflex: 5, charm: 6, stamina: 4, perception: 5, fortune: 4 }

export function newGame(opts: NewGameOptions = {}): GameState {
  const seed = opts.seed ?? 34
  const stats = { ...DEFAULT_STATS, ...opts.stats }
  const s: GameState = {
    version: 1, seed, rng: seed, turn: 0, mode: 'explore', nextUid: 1,
    player: { name: opts.name ?? 'Ren', x: WORLD.start.x, y: WORLD.start.y, hp: 0, ap: 0, xp: 0, level: 1, points: 0, stats, perks: (opts.perks ?? ['deadeye', 'smooth_talker']).slice(0, 2), rads: 0, caps: 40, weapon: null, armor: null, inv: [], facing: 0 },
    actors: WORLD.enemies.map((e) => {
      const d = ENEMIES[e.type]!
      return { id: e.id, type: e.type, name: e.name ?? d.name, x: e.x, y: e.y, hp: d.hp, maxHp: d.hp, ap: d.ap, group: e.group, hostile: !e.neutral, dead: false, removed: false, npc: e.npc, crippled: { legs: false, arms: false }, engaged: false }
    }),
    npcs: WORLD.npcs.filter((n) => !WORLD.enemies.some((e) => e.npc === n.id)).map((n) => ({ id: n.id, x: n.x, y: n.y, following: false, removed: false })),
    containers: [], quests: {}, flags: {}, rep: { union: 0, congregation: 0 }, log: [],
    dialogue: null, combat: null, target: null, loot: null, barter: { stock: [], caps: WORLD.trader.caps }, path: [], shots: [], radio: 'shelter', broadcasts: [], ending: null,
  }
  s.containers = WORLD.containers.map((c) => ({ id: c.id, name: c.name, x: c.x, y: c.y, items: c.items.map(([id, q]) => mkStack(s, id, q)), caps: c.caps, opened: false, locked: !!c.lock }))
  s.barter.stock = WORLD.trader.stock.map(([id, q]) => mkStack(s, id, q))
  const pistol = addItem(s, 'pipe_pistol', 1, 85), suit = addItem(s, 'shelter_jumpsuit', 1, 90)
  addItem(s, 'knife', 1, 70); addItem(s, 'patch_kit', 2); addItem(s, 'clean_water', 1)
  s.player.weapon = pistol; s.player.armor = suit
  s.player.hp = maxHp(s); s.player.ap = maxAp(s)
  log(s, `${s.player.name} wakes in Shelter 34. The WRIST-LINK on your arm blinks: OVERSEER WANTS YOU.`, 'system')
  return s
}

function mkStack(s: GameState, id: string, qty = 1, cond = 100): Stack {
  if (!ITEMS[id]) throw new Error(`unknown item ${id}`)
  return { uid: s.nextUid++, id, qty, cond }
}
const stackable = (id: string) => { const k = ITEMS[id]!.kind; return k === 'aid' || k === 'tool' }

export function addItem(s: GameState, id: string, qty = 1, cond = 100): number {
  if (stackable(id)) {
    const ex = s.player.inv.find((i) => i.id === id)
    if (ex) { ex.qty += qty; return ex.uid }
  }
  let uid = 0
  const n = stackable(id) ? 1 : qty
  for (let k = 0; k < n; k++) { const st = mkStack(s, id, stackable(id) ? qty : 1, cond); s.player.inv.push(st); uid = st.uid }
  return uid
}
export function countItem(s: GameState, id: string) { return s.player.inv.filter((i) => i.id === id).reduce((a, i) => a + i.qty, 0) }
export function removeItem(s: GameState, id: string, qty = 1): boolean {
  if (countItem(s, id) < qty) return false
  for (const st of [...s.player.inv]) {
    if (st.id !== id || qty <= 0) continue
    const take = Math.min(qty, st.qty)
    st.qty -= take; qty -= take
    if (st.qty <= 0) dropStack(s, st.uid)
  }
  return true
}
function dropStack(s: GameState, uid: number) {
  s.player.inv = s.player.inv.filter((i) => i.uid !== uid)
  if (s.player.weapon === uid) s.player.weapon = null
  if (s.player.armor === uid) s.player.armor = null
}

// ---------- derived stats ----------
export const statOf = (s: GameState, st: Stat) => s.player.stats[st]
export function maxHp(s: GameState) { return 50 + statOf(s, 'stamina') * 8 + (s.player.level - 1) * 12 - Math.floor(s.player.rads / 20) }
export function maxAp(s: GameState) { return 6 + Math.floor(statOf(s, 'reflex') / 2) }
export function carryMax(s: GameState) { return 80 + statOf(s, 'grit') * 12 }
export function carryWeight(s: GameState) { return Math.round(s.player.inv.reduce((a, i) => a + ITEMS[i.id]!.weight * i.qty, 0) * 10) / 10 }
export function xpForLevel(level: number) { return 100 * (level * (level - 1)) / 2 + 0 }
export function weaponStack(s: GameState): Stack | null { return s.player.inv.find((i) => i.uid === s.player.weapon) ?? null }
export function armorRating(s: GameState) {
  const a = s.player.inv.find((i) => i.uid === s.player.armor)
  return (a ? Math.round(ITEMS[a.id]!.armor! * (0.5 + a.cond / 200)) : 0) + (s.player.perks.includes('toughness') ? 2 : 0)
}
export function skills(s: GameState) {
  const st = s.player.stats
  return {
    guns: 10 + st.perception * 5 + st.reflex * 2,
    melee: 15 + st.grit * 5 + st.reflex * 2,
    repair: 5 + st.wits * 6,
    speech: 5 + st.charm * 6,
    barter: 5 + st.charm * 4 + st.wits * 2,
    survival: 5 + st.stamina * 4 + st.perception * 2,
  }
}

export function log(s: GameState, text: string, kind: LogKind = 'info') {
  s.log.push({ turn: s.turn, text, kind })
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400)
}
const rand = (s: GameState) => nextRandom(s)
const dist = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))

// ---------- occupancy ----------
export function liveActors(s: GameState) { return s.actors.filter((a) => !a.dead && !a.removed) }
export function actorAt(s: GameState, x: number, y: number) { return liveActors(s).find((a) => a.x === x && a.y === y) ?? null }
export function npcAt(s: GameState, x: number, y: number) { return s.npcs.find((n) => !n.removed && n.x === x && n.y === y) ?? null }
export function containerAt(s: GameState, x: number, y: number) { return s.containers.find((c) => c.x === x && c.y === y) ?? null }
/** Characters are drawn taller than their tile, so a click on a head/torso lands on a tile "behind" them; snap it forward. */
export function snapToEntity(s: GameState, x: number, y: number): [number, number] {
  for (const [dx, dy] of [[0, 0], [1, 1], [1, 0], [0, 1], [2, 2], [2, 1], [1, 2]] as const) {
    const tx = x + dx, ty = y + dy
    if (actorAt(s, tx, ty) || npcAt(s, tx, ty)) return [tx, ty]
  }
  return [x, y]
}
export function blocked(s: GameState, x: number, y: number) {
  return isSolidTile(x, y) || !!actorAt(s, x, y) || !!npcAt(s, x, y) || !!containerAt(s, x, y) || (s.player.x === x && s.player.y === y)
}

// ---------- conditions & effects ----------
export function questStage(s: GameState, id: string) { return s.quests[id] ?? 'none' }
export function checkReq(s: GameState, r: string): boolean {
  let m: RegExpMatchArray | null
  if ((m = r.match(/^q:(\w+)=(\w+)$/))) return questStage(s, m[1]!) === m[2]
  if ((m = r.match(/^has:(\w+)$/))) return countItem(s, m[1]!) > 0
  if ((m = r.match(/^caps>=(\d+)$/))) return s.player.caps >= Number(m[1])
  if ((m = r.match(/^flag:(\w+)$/))) return !!s.flags[m[1]!]
  if ((m = r.match(/^dead:(\w+)$/))) return s.actors.filter((a) => a.group === m![1]).every((a) => a.dead || a.removed)
  throw new Error(`bad req ${r}`)
}
export function setQuest(s: GameState, id: string, stage: string) {
  const q = QUESTS[id]
  if (!q || s.quests[id] === stage) return
  const isNew = !s.quests[id]
  s.quests[id] = stage
  log(s, `${isNew ? 'NEW QUEST' : stage === 'done' ? 'QUEST COMPLETE' : 'QUEST UPDATED'}: ${q.title}`, 'quest')
}
export function gainXp(s: GameState, n: number) {
  s.player.xp += n
  while (s.player.xp >= xpForLevel(s.player.level + 1)) {
    s.player.level++
    s.player.points++
    s.player.hp = maxHp(s)
    log(s, `LEVEL UP: level ${s.player.level}. +1 attribute point (WRIST-LINK > STATUS).`, 'system')
  }
}
export function applyEffect(s: GameState, e: string) {
  let m: RegExpMatchArray | null
  if ((m = e.match(/^q:(\w+)=(\w+)$/))) setQuest(s, m[1]!, m[2]!)
  else if ((m = e.match(/^give:(\w+)$/))) { addItem(s, m[1]!); log(s, `Received ${ITEMS[m[1]!]!.name}.`, 'loot') }
  else if ((m = e.match(/^take:(\w+)$/))) { removeItem(s, m[1]!); log(s, `Handed over ${ITEMS[m[1]!]!.name}.`, 'loot') }
  else if ((m = e.match(/^caps:([+-]\d+)$/))) { s.player.caps += Number(m[1]); log(s, `${Number(m[1]) > 0 ? '+' : ''}${m[1]!.replace('+', '')} caps.`, 'loot') }
  else if ((m = e.match(/^xp:(\d+)$/))) gainXp(s, Number(m[1]))
  else if ((m = e.match(/^rep:(\w+):([+-]\d+)$/))) { s.rep[m[1]!] = (s.rep[m[1]!] ?? 0) + Number(m[2]); log(s, `Reputation (${m[1]}) ${m[2]}.`, 'info') }
  else if ((m = e.match(/^flag:(\w+)$/))) s.flags[m[1]!] = true
  else if (e === 'heal') { s.player.hp = maxHp(s); s.player.rads = Math.max(0, s.player.rads - 50) }
  else if (e === 'barter') { s.mode = 'barter' }
  else if ((m = e.match(/^log:(.+)$/))) log(s, m[1]!)
  else if ((m = e.match(/^hostile:(\w+)$/))) { for (const a of s.actors) if (a.group === m[1]) a.hostile = true; s.flags.dutch_hostile = true; log(s, 'The Wreckers draw their weapons!', 'combat') }
  else if ((m = e.match(/^remove:(\w+)$/))) for (const a of s.actors) { if (a.group === m[1]) a.removed = true }
  else if ((m = e.match(/^follow:(\w+)$/))) { const n = s.npcs.find((n) => n.id === m![1]); if (n) n.following = true }
  else if ((m = e.match(/^radio:(\w+)$/))) { s.flags[`radio_${m[1]}`] = true; s.radio = m[1]! }
  else if (e === 'ending') finishGame(s)
  else throw new Error(`bad effect ${e}`)
}

function syncWorld(s: GameState) {
  if (questStage(s, 'bell') === 'active' && countItem(s, 'bell_clapper')) setQuest(s, 'bell', 'got')
  if (questStage(s, 'static') === 'active' && countItem(s, 'signal_valve')) setQuest(s, 'static', 'got')
  if (questStage(s, 'overpass') === 'active' && checkReq(s, 'dead:camp')) { setQuest(s, 'overpass', 'resolved'); s.flags.end_war = true }
  if (s.flags.rusty_home) {
    const r = s.npcs.find((n) => n.id === 'rusty'), milo = s.npcs.find((n) => n.id === 'milo')
    if (r && milo && r.following) { r.following = false; r.x = milo.x + 1; r.y = milo.y }
  }
}

export function finishGame(s: GameState) {
  s.mode = 'ending'
  const how = s.flags.end_peace ? 'You talked Dutch Malloy out of Manhattan without firing a shot. The overpass is open, and water runs north for free.'
    : s.flags.end_deal ? 'You took Dutch\'s caps. The tolls continue, quieter now, and Shelter 34 never quite trusts you again.'
    : 'The Wreckers are gone, buried under the overpass they held. The road is open, paid for in blood.'
  const side = ['rusty', 'bell', 'parcel', 'static'].filter((q) => questStage(s, q) === 'done').length
  s.ending = `${how} ${side}/4 side quests finished. Level ${s.player.level}.`
  log(s, 'THE END. ' + s.ending, 'system')
}

// ---------- dialogue ----------
export function talkTo(s: GameState, npcId: string) {
  const def = NPCS[npcId]
  if (!def) return
  const start = def.dialogue.starts.find((st) => (st.req ?? []).every((r) => checkReq(s, r)))
  if (!start) return
  s.mode = 'dialogue'
  s.flags[`talked_${npcId}`] = true
  s.dialogue = { npc: npcId, node: start.node, result: null }
  s.path = []
}
export function checkValue(s: GameState, stat: Stat) { return statOf(s, stat) + (stat === 'charm' && s.player.perks.includes('smooth_talker') ? 1 : 0) }
export function visibleOptions(s: GameState): DialogueOption[] {
  if (!s.dialogue) return []
  const node = NPCS[s.dialogue.npc]!.dialogue.nodes[s.dialogue.node]!
  return node.options.filter((o) => (o.req ?? []).every((r) => checkReq(s, r)))
}
export function chooseOption(s: GameState, index: number) {
  const d = s.dialogue
  if (!d || s.mode !== 'dialogue') return
  const opt = visibleOptions(s)[index]
  if (!opt) return
  let next = opt.next
  let ok = true
  if (opt.check) {
    ok = checkValue(s, opt.check.stat) >= opt.check.dc
    d.result = `${opt.check.stat.toUpperCase()} ${checkValue(s, opt.check.stat)}/${opt.check.dc}: ${ok ? 'SUCCESS' : 'FAILED'}`
    log(s, `[${d.result}]`, 'info')
    if (!ok) next = opt.fail
  } else d.result = null
  if (ok) for (const e of opt.effects ?? []) applyEffect(s, e)
  syncWorld(s)
  if (s.mode !== 'dialogue') { s.dialogue = null; return }
  if (opt.end || !next) { s.dialogue = null; s.mode = 'explore'; maybeAggro(s); return }
  d.node = next
}
export function endDialogue(s: GameState) { if (s.mode === 'dialogue') { s.dialogue = null; s.mode = 'explore' } }

// ---------- movement & interaction ----------
const DIR_FACING: Record<string, number> = { '1,0': 0, '1,1': 1, '0,1': 2, '-1,1': 3, '-1,0': 4, '-1,-1': 5, '0,-1': 6, '1,-1': 7 }

export function step(s: GameState, dx: number, dy: number): boolean {
  if (s.mode !== 'explore' && s.mode !== 'combat') return false
  const nx = s.player.x + dx, ny = s.player.y + dy
  s.player.facing = DIR_FACING[`${dx},${dy}`] ?? s.player.facing
  const a = actorAt(s, nx, ny)
  if (a) { interactActor(s, a); return false }
  const n = npcAt(s, nx, ny)
  if (n) { if (s.mode === 'explore') talkTo(s, n.id); return false }
  const c = containerAt(s, nx, ny)
  if (c) { if (s.mode === 'explore') openContainer(s, c.id); return false }
  if (isSolidTile(nx, ny)) return false
  if (dx && dy && isSolidTile(s.player.x + dx, s.player.y) && isSolidTile(s.player.x, s.player.y + dy)) return false
  if (s.mode === 'combat') {
    const cost = 1
    if (s.player.ap < cost) { log(s, 'Not enough AP to move. End your turn [E].', 'combat'); return false }
    s.player.ap -= cost
  }
  const px = s.player.x, py = s.player.y
  s.player.x = nx; s.player.y = ny
  s.turn++
  for (const f of s.npcs) if (f.following && !f.removed && dist(f.x, f.y, nx, ny) > 1 && !blocked(s, px, py)) { f.x = px; f.y = py }
  exposure(s)
  if (s.mode === 'explore') maybeAggro(s)
  return true
}

function exposure(s: GameState) {
  const t = tileAt(s.player.x, s.player.y)
  let rads = t === 'radpool' ? 14 : 0
  if (!rads) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(s.player.x + dx, s.player.y + dy) === 'radpool') rads = 4
  if (!rads) return
  const armor = s.player.inv.find((i) => i.uid === s.player.armor)
  rads *= 1 - (armor ? ITEMS[armor.id]!.radResist ?? 0 : 0)
  if (s.player.perks.includes('lead_belly')) rads /= 2
  rads *= 1 - statOf(s, 'stamina') * 0.04
  s.player.rads += Math.max(1, Math.round(rads))
  s.player.hp = Math.min(s.player.hp, maxHp(s))
  if (s.player.hp <= 0) die(s, 'Radiation poisoning.')
}
/** Geiger click rate 0..1 for the HUD meter. */
export function geiger(s: GameState) {
  let best = 0
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (tileAt(s.player.x + dx, s.player.y + dy) === 'radpool') best = Math.max(best, 1 - Math.max(Math.abs(dx), Math.abs(dy)) / 4)
  return best
}

export function walkTo(s: GameState, x: number, y: number) {
  if (s.mode !== 'explore') return
  const occ = actorAt(s, x, y) || npcAt(s, x, y) || containerAt(s, x, y)
  const p = findPath(s.player.x, s.player.y, x, y, (bx, by) => blocked(s, bx, by), !!occ)
  s.path = p ?? []
}
/** Advance one queued path step; returns true while still walking. */
export function tickPath(s: GameState): boolean {
  const nxt = s.path.shift()
  if (!nxt) return false
  const moved = step(s, nxt[0] - s.player.x, nxt[1] - s.player.y)
  if (!moved || s.mode !== 'explore') s.path = []
  return s.path.length > 0
}
export function interactActor(s: GameState, a: Actor) {
  if (a.hostile) {
    if (s.mode === 'explore') startCombat(s)
    if (s.mode === 'combat') openTarget(s, a.id)
  } else if (a.npc && s.mode === 'explore') talkTo(s, a.npc)
}
export function interactAt(s: GameState, x: number, y: number) {
  const a = actorAt(s, x, y)
  if (a && (a.hostile || dist(x, y, s.player.x, s.player.y) <= 1)) return interactActor(s, a)
  if (s.mode !== 'explore') return
  if (dist(x, y, s.player.x, s.player.y) <= 1) {
    const n = npcAt(s, x, y); if (n) return talkTo(s, n.id)
    const c = containerAt(s, x, y); if (c) return openContainer(s, c.id)
  }
  walkTo(s, x, y)
}

// ---------- containers & barter ----------
export function openContainer(s: GameState, id: string) {
  const c = s.containers.find((c) => c.id === id)
  if (!c) return
  const lock = WORLD.containers.find((w) => w.id === id)?.lock
  if (c.locked && lock) {
    if (checkValue(s, lock.stat) >= lock.dc) { c.locked = false; log(s, `[${lock.stat.toUpperCase()} ${checkValue(s, lock.stat)}/${lock.dc}] You crack the lock on the ${c.name}.`, 'loot'); gainXp(s, 15) }
    else { log(s, `[${lock.stat.toUpperCase()} ${checkValue(s, lock.stat)}/${lock.dc}] The ${c.name} won't budge.`, 'loot'); return }
  }
  if (!c.opened) { c.opened = true; if (s.player.perks.includes('scrounger')) c.caps = Math.round(c.caps * 1.5) }
  s.mode = 'loot'; s.loot = id; s.path = []
}
export function takeFromContainer(s: GameState, uid: number | 'caps' | 'all') {
  const c = s.containers.find((c) => c.id === s.loot)
  if (!c) return
  if (uid === 'caps' || uid === 'all') { if (c.caps) { s.player.caps += c.caps; log(s, `+${c.caps} caps.`, 'loot'); c.caps = 0 } }
  const take = uid === 'all' ? [...c.items] : c.items.filter((i) => i.uid === uid)
  for (const st of take) {
    c.items = c.items.filter((i) => i !== st)
    addItem(s, st.id, st.qty, st.cond)
    log(s, `Took ${ITEMS[st.id]!.name}${st.qty > 1 ? ` x${st.qty}` : ''}.`, 'loot')
  }
  syncWorld(s)
}
export function closePanel(s: GameState) {
  if (s.mode === 'loot' || s.mode === 'barter') { s.mode = s.combat ? 'combat' : 'explore'; s.loot = null }
  else if (s.mode === 'target') { s.mode = 'combat'; s.target = null }
  else if (s.mode === 'dialogue') endDialogue(s)
}
export function buyPrice(s: GameState, id: string) { return Math.max(1, Math.round(ITEMS[id]!.value * (1.6 - skills(s).barter / 150))) }
export function sellPrice(s: GameState, st: Stack) { return Math.max(1, Math.round(ITEMS[st.id]!.value * (st.cond / 100) * (0.35 + skills(s).barter / 300))) }
export function buy(s: GameState, uid: number): boolean {
  const st = s.barter.stock.find((i) => i.uid === uid)
  if (!st) return false
  const price = buyPrice(s, st.id)
  if (s.player.caps < price) { log(s, `Rosa: "That's ${price} caps, hon. Come back richer."`, 'info'); return false }
  s.player.caps -= price; s.barter.caps += price
  st.qty--
  if (st.qty <= 0) s.barter.stock = s.barter.stock.filter((i) => i !== st)
  addItem(s, st.id, 1, st.cond)
  log(s, `Bought ${ITEMS[st.id]!.name} for ${price} caps.`, 'loot')
  return true
}
export function sell(s: GameState, uid: number): boolean {
  const st = s.player.inv.find((i) => i.uid === uid)
  if (!st || ITEMS[st.id]!.kind === 'quest' || uid === s.player.weapon || uid === s.player.armor) return false
  const price = sellPrice(s, st)
  if (s.barter.caps < price) return false
  s.barter.caps -= price; s.player.caps += price
  const ex = stackable(st.id) ? s.barter.stock.find((i) => i.id === st.id) : null
  if (ex) ex.qty++
  else s.barter.stock.push({ uid: s.nextUid++, id: st.id, qty: 1, cond: st.cond })
  st.qty--
  if (st.qty <= 0) dropStack(s, st.uid)
  log(s, `Sold ${ITEMS[st.id]!.name} for ${price} caps.`, 'loot')
  return true
}

// ---------- inventory actions ----------
export function useItem(s: GameState, uid: number): boolean {
  const st = s.player.inv.find((i) => i.uid === uid)
  if (!st) return false
  const def = ITEMS[st.id]!
  if (def.kind === 'weapon') { s.player.weapon = s.player.weapon === uid ? null : uid; log(s, `${s.player.weapon ? 'Equipped' : 'Holstered'} ${def.name}.`); return true }
  if (def.kind === 'armor') { s.player.armor = s.player.armor === uid ? null : uid; log(s, `${s.player.armor ? 'Wearing' : 'Removed'} ${def.name}.`); return true }
  if (def.kind === 'aid') {
    if (s.mode === 'combat') { if (s.player.ap < 2) return false; s.player.ap -= 2 }
    if (def.rads) s.player.rads = Math.max(0, s.player.rads + def.rads)
    if (def.heal) s.player.hp = Math.min(maxHp(s), s.player.hp + def.heal)
    log(s, `Used ${def.name}.${def.heal ? ` +${def.heal} HP.` : ''}${def.rads ? ` ${def.rads} RAD.` : ''}`)
    removeItem(s, st.id)
    return true
  }
  return false
}
export function repairItem(s: GameState, uid: number): boolean {
  const st = s.player.inv.find((i) => i.uid === uid)
  if (!st || (ITEMS[st.id]!.kind !== 'weapon' && ITEMS[st.id]!.kind !== 'armor') || st.cond >= 100) return false
  if (!removeItem(s, 'repair_kit')) { log(s, 'You need a Repair Kit.'); return false }
  const amt = Math.round((ITEMS.repair_kit!.repair! + skills(s).repair / 4) * (s.player.perks.includes('tinkerer') ? 1.5 : 1))
  st.cond = Math.min(100, st.cond + amt)
  log(s, `Repaired ${ITEMS[st.id]!.name} to ${st.cond}%.`)
  return true
}
export function dropItem(s: GameState, uid: number): boolean {
  const st = s.player.inv.find((i) => i.uid === uid)
  if (!st || ITEMS[st.id]!.kind === 'quest') return false
  dropStack(s, uid); log(s, `Dropped ${ITEMS[st.id]!.name}.`)
  return true
}
export function spendPoint(s: GameState, stat: Stat): boolean {
  if (s.player.points <= 0 || s.player.stats[stat] >= 10) return false
  s.player.points--; s.player.stats[stat]++
  log(s, `${stat.toUpperCase()} raised to ${s.player.stats[stat]}.`, 'system')
  return true
}

// ---------- combat ----------
export function engagedEnemies(s: GameState) { return liveActors(s).filter((a) => a.hostile && a.engaged) }
function maybeAggro(s: GameState) {
  if (s.mode !== 'explore') return
  const spot = liveActors(s).filter((a) => a.hostile && dist(a.x, a.y, s.player.x, s.player.y) <= ENEMIES[a.type]!.aggro && lineOfSight(a.x, a.y, s.player.x, s.player.y))
  if (spot.length) startCombat(s)
}
export function startCombat(s: GameState) {
  if (s.combat) return
  const hostile = liveActors(s).filter((a) => a.hostile && dist(a.x, a.y, s.player.x, s.player.y) <= 10)
  const seen = hostile.filter((a) => dist(a.x, a.y, s.player.x, s.player.y) <= ENEMIES[a.type]!.aggro + 1 && lineOfSight(a.x, a.y, s.player.x, s.player.y))
  const near = seen.length ? seen : hostile
  if (!near.length) return
  const groups = new Set(near.map((a) => a.group))
  for (const a of liveActors(s)) if (a.hostile && groups.has(a.group)) a.engaged = true
  s.combat = { round: 1 }
  s.mode = 'combat'
  s.path = []
  s.player.ap = maxAp(s)
  log(s, `COMBAT: ${engagedEnemies(s).map((a) => a.name).join(', ')}. Your move.`, 'combat')
}
export function weaponDef(s: GameState) {
  const w = weaponStack(s)
  return w ? ITEMS[w.id]! : { name: 'Fists', kind: 'weapon', class: 'melee', dmg: 5, ap: 2, range: 1, weight: 0, value: 0 } as const
}
export function hitChance(s: GameState, a: Actor, part: BodyPart): number {
  const w = weaponDef(s)
  const d = dist(s.player.x, s.player.y, a.x, a.y)
  if (d > (w.range ?? 1) + (w.class === 'gun' ? 4 : 0)) return 0
  if (!lineOfSight(s.player.x, s.player.y, a.x, a.y)) return 0
  const sk = skills(s)
  let c = (w.class === 'gun' ? sk.guns : sk.melee) + 25
  c -= Math.max(0, d - (w.range ?? 1)) * 12
  c -= d * 2
  const sx = Math.sign(s.player.x - a.x), sy = Math.sign(s.player.y - a.y)
  if (d > 1 && givesCover(a.x + sx, a.y + sy)) c -= 20
  c -= Math.round((1 - lightAt(a.x, a.y)) * 30)
  c += PART_MOD[part]
  if (s.player.perks.includes('deadeye')) c += 12
  return Math.max(5, Math.min(95, Math.round(c)))
}
export function coverBetween(s: GameState, a: Actor) {
  const sx = Math.sign(s.player.x - a.x), sy = Math.sign(s.player.y - a.y)
  return dist(s.player.x, s.player.y, a.x, a.y) > 1 && givesCover(a.x + sx, a.y + sy)
}
export function openTarget(s: GameState, actorId: string) {
  if (s.mode !== 'combat') return
  const a = liveActors(s).find((x) => x.id === actorId)
  if (!a) return
  s.mode = 'target'
  s.target = { actor: actorId, part: s.target?.actor === actorId ? s.target.part : 'torso' }
}
export function cycleTarget(s: GameState, dir: 1 | -1) {
  const score = (a: Actor) => (hitChance(s, a, 'torso') > 0 ? 0 : 100) + dist(a.x, a.y, s.player.x, s.player.y)
  const list = engagedEnemies(s).sort((a, b) => score(a) - score(b))
  if (!list.length) return
  const i = list.findIndex((a) => a.id === s.target?.actor)
  const next = list[(i + dir + list.length) % list.length]!
  if (s.mode === 'combat') openTarget(s, next.id)
  else if (s.target) s.target.actor = next.id
}
export function selectPart(s: GameState, part: BodyPart) { if (s.target) s.target.part = part }

export function fire(s: GameState, now = 0): ShotFx | null {
  if (s.mode !== 'target' || !s.target) return null
  const a = liveActors(s).find((x) => x.id === s.target!.actor)
  if (!a) { s.mode = 'combat'; return null }
  const w = weaponDef(s), ws = weaponStack(s)
  const cost = w.ap ?? 2
  if (s.player.ap < cost) { log(s, `Need ${cost} AP. End turn [E].`, 'combat'); return null }
  const part = s.target.part
  const chance = hitChance(s, a, part)
  if (chance <= 0) { log(s, 'Out of range or no line of sight.', 'combat'); return null }
  s.player.ap -= cost
  const hit = rand(s) * 100 < chance
  const crit = hit && rand(s) * 100 < statOf(s, 'fortune') * 2 + (part === 'head' ? 10 : 0)
  let dmg = 0
  if (hit) {
    const cond = ws ? 0.5 + ws.cond / 200 : 1
    dmg = (w.dmg ?? 5) * cond * (0.85 + rand(s) * 0.3)
    if (w.class === 'melee') dmg += statOf(s, 'grit') * 1.5
    if (part === 'head') dmg *= 1.6
    if (part === 'arms' || part === 'legs') dmg *= 0.8
    if (crit) dmg *= 1.8
    dmg = Math.max(1, Math.round(dmg - ENEMIES[a.type]!.armor))
    a.hp -= dmg
    if (part === 'legs' && !a.crippled.legs && (crit || rand(s) < 0.5)) { a.crippled.legs = true; log(s, `${a.name}'s legs are crippled!`, 'combat') }
    if (part === 'arms' && !a.crippled.arms && (crit || rand(s) < 0.5)) { a.crippled.arms = true; log(s, `${a.name}'s arms are crippled!`, 'combat') }
  }
  if (ws) ws.cond = Math.max(0, ws.cond - (w.class === 'gun' ? 2 : 1))
  const fx: ShotFx = { t: now, fromX: s.player.x, fromY: s.player.y, toX: a.x, toY: a.y, hit, crit, part, dmg, byPlayer: true, melee: w.class === 'melee', target: a.id }
  s.shots.push(fx)
  if (s.shots.length > 20) s.shots.shift()
  log(s, hit ? `${crit ? 'CRITICAL! ' : ''}${w.name} hits ${a.name} in the ${part} for ${dmg}.` : `${w.name} misses ${a.name} (${chance}%).`, 'combat')
  if (a.hp <= 0) killActor(s, a)
  if (s.mode === 'target' && !liveActors(s).some((x) => x.id === a.id)) { s.target = null; s.mode = 'combat' }
  checkCombatEnd(s)
  return fx
}

const DROPS: Record<string, () => [string, number][]> = {
  wrecker: () => [['patch_kit', 1]],
  dutch: () => [['wrecker_spikes', 1], ['ion_carbine', 1]],
}
function killActor(s: GameState, a: Actor) {
  a.dead = true; a.hp = 0
  const def = ENEMIES[a.type]!
  log(s, `${a.name} is dead. +${def.xp} XP.`, 'combat')
  gainXp(s, def.xp)
  const caps = a.type === 'wrecker' ? 8 + Math.floor(rand(s) * 15) : a.type === 'dutch' ? 90 : 0
  const items = (DROPS[a.type]?.() ?? []).map(([id, q]) => mkStack(s, id, q, 40 + Math.floor(rand(s) * 40)))
  if (caps || items.length) {
    if (!containerAt(s, a.x, a.y)) s.containers.push({ id: `body_${a.id}`, name: `${a.name}'s remains`, x: a.x, y: a.y, items, caps, opened: false, locked: false })
  }
  syncWorld(s)
}
function checkCombatEnd(s: GameState) {
  if (!s.combat) return
  if (engagedEnemies(s).length === 0) {
    s.combat = null; s.target = null
    if (s.mode === 'combat' || s.mode === 'target') s.mode = 'explore'
    s.player.ap = maxAp(s)
    log(s, 'Combat over.', 'combat')
    syncWorld(s)
  }
}
export function endTurn(s: GameState, now = 0) {
  if (!s.combat || (s.mode !== 'combat' && s.mode !== 'target')) return
  s.mode = 'combat'; s.target = null
  let k = 0
  for (const a of engagedEnemies(s)) {
    const def = ENEMIES[a.type]!
    let ap = a.crippled.legs ? Math.ceil(def.ap / 2) : def.ap
    while (ap > 0 && s.player.hp > 0) {
      const d = dist(a.x, a.y, s.player.x, s.player.y)
      if (d <= def.range && lineOfSight(a.x, a.y, s.player.x, s.player.y) && ap >= 3) {
        ap -= 3
        let hc = def.hit - (d > 1 && givesCover(s.player.x + Math.sign(a.x - s.player.x), s.player.y + Math.sign(a.y - s.player.y)) ? 15 : 0) - (a.crippled.arms ? 20 : 0) - statOf(s, 'reflex') * 2
        hc = Math.max(5, Math.min(95, hc))
        const hit = rand(s) * 100 < hc
        let dmg = 0
        if (hit) { dmg = Math.max(1, Math.round(def.dmg[0] + rand(s) * (def.dmg[1] - def.dmg[0]) - armorRating(s))); s.player.hp -= dmg }
        const armor = s.player.inv.find((i) => i.uid === s.player.armor)
        if (hit && armor) armor.cond = Math.max(0, armor.cond - 1)
        s.shots.push({ t: now + (k++) * 380, fromX: a.x, fromY: a.y, toX: s.player.x, toY: s.player.y, hit, crit: false, part: 'torso', dmg, byPlayer: false, melee: def.range <= 1, target: 'player' })
        log(s, hit ? `${a.name} hits you for ${dmg}.` : `${a.name} misses you.`, 'combat')
        if (s.player.hp <= 0) { die(s, `Killed by ${a.name}.`); return }
      } else if (d > (def.range <= 1 ? 1 : Math.min(def.range, 4))) {
        const p = findPath(a.x, a.y, s.player.x, s.player.y, (x, y) => blocked(s, x, y), true, 30)
        if (!p || p.length < 2) break
        a.x = p[0]![0]; a.y = p[0]![1]; ap -= 1
      } else break
    }
  }
  if (s.shots.length > 20) s.shots.splice(0, s.shots.length - 20)
  s.combat.round++
  s.player.ap = maxAp(s)
  if (engagedEnemies(s).every((a) => dist(a.x, a.y, s.player.x, s.player.y) > 14)) {
    for (const a of engagedEnemies(s)) a.engaged = false
    log(s, 'You slip away.', 'combat')
    checkCombatEnd(s)
  }
}
function die(s: GameState, why: string) {
  s.player.hp = 0; s.mode = 'dead'; s.combat = null; s.target = null
  log(s, `YOU DIED. ${why} Load a save with [L].`, 'system')
}

// ---------- persistence (pure) ----------
export function serialize(s: GameState): string { return JSON.stringify(s, null, 1) }
export function deserialize(json: string): GameState {
  const s = JSON.parse(json) as GameState
  if (s.version !== 1 || !s.player || !Array.isArray(s.actors)) throw new Error('not a WASTELAND save')
  s.path = []
  return s
}

export function regionName(s: GameState) { return regionAt(s.player.x, s.player.y) }
export function questList(s: GameState) {
  return Object.entries(s.quests).map(([id, stage]) => ({ id, title: QUESTS[id]!.title, main: QUESTS[id]!.main, stage, text: QUESTS[id]!.stages[stage] ?? '', done: stage === 'done' }))
    .sort((a, b) => Number(a.done) - Number(b.done) || Number(b.main) - Number(a.main))
}
/** Current objective: first unfinished quest (main first) with a world location for its stage, if any. */
export function objective(s: GameState): { id: string; title: string; text: string; main: boolean; x: number; y: number; label: string } | null {
  if (!Object.keys(s.quests).length && !s.flags.talked_ada) {
    const ada = s.npcs.find((n) => n.id === 'ada')
    if (ada) return { id: 'wake', title: 'Report to the Overseer', text: 'The WRIST-LINK blinks: OVERSEER WANTS YOU. Ada is waiting by the Shelter 34 hatch.', main: true, x: ada.x, y: ada.y, label: NPCS.ada?.name ?? 'Ada' }
  }
  for (const q of questList(s)) {
    if (q.done) continue
    const g = QUESTS[q.id]!.goals?.[q.stage]
    let pos: [number, number] | null = null, label = ''
    if (g) {
      const [kind, id] = g.split(':') as [string, string]
      if (kind === 'npc') {
        const n = s.npcs.find((n) => n.id === id && !n.removed) ?? s.actors.find((a) => a.npc === id && !a.removed && !a.dead)
        if (n) { pos = [n.x, n.y]; label = NPCS[id]?.name ?? id }
      } else if (kind === 'box') {
        const c = s.containers.find((c) => c.id === id)
        if (c) { pos = [c.x, c.y]; label = c.name }
      } else if (kind === 'group') {
        const a = liveActors(s).find((a) => a.group === id)
        if (a) { pos = [a.x, a.y]; label = a.name }
      }
    }
    return { id: q.id, title: q.title, text: q.text, main: q.main, x: pos?.[0] ?? -1, y: pos?.[1] ?? -1, label }
  }
  return null
}
export function receiveBroadcast(s: GameState, text: string) {
  const t = text.trim().slice(0, 140)
  if (!t) return
  s.broadcasts.push(t)
  if (s.broadcasts.length > 20) s.broadcasts.shift()
  log(s, `RADIO: "${t}"`, 'radio')
}
export { STATS, PERKS, MAP_W, MAP_H }
