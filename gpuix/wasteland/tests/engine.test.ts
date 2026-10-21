import { describe, expect, it } from 'bun:test'
import {
  BODY_PARTS, chooseOption, deserialize, endTurn, engagedEnemies, fire, hitChance, liveActors, newGame, openContainer, openTarget,
  questStage, repairItem, serialize, startCombat, step, takeFromContainer, talkTo, useItem, visibleOptions, addItem, buy, sell, buyPrice,
  type GameState,
} from '../src/engine/game'
import { ITEMS, NPCS, WORLD, type DialogueOption } from '../src/engine/content'
import { findPath, isSolidTile, tileAt } from '../src/engine/world'

function talk(s: GameState, id: string) {
  const n = s.npcs.find((n) => n.id === id) ?? s.actors.find((a) => a.npc === id)!
  s.player.x = n.x + 1; s.player.y = n.y
  if (isSolidTile(s.player.x, s.player.y)) s.player.x = n.x - 1
  talkTo(s, id)
  expect(s.mode).toBe('dialogue')
}
function pick(s: GameState, pred: (o: DialogueOption) => boolean) {
  const i = visibleOptions(s).findIndex(pred)
  expect(i).toBeGreaterThanOrEqual(0)
  chooseOption(s, i)
}
const has = (e: string) => (o: DialogueOption) => !!o.effects?.includes(e) || !!o.req?.includes(e)
const leave = (s: GameState) => { while (s.mode === 'dialogue') chooseOption(s, visibleOptions(s).length - 1) }

describe('content', () => {
  it('ships the v1 content counts', () => {
    expect(WORLD.npcs.length).toBeGreaterThanOrEqual(12)
    const gear = Object.values(ITEMS).filter((i) => i.kind === 'weapon' || i.kind === 'armor')
    expect(gear.length).toBeGreaterThanOrEqual(15)
    expect(new Set(WORLD.enemies.map((e) => e.type)).size).toBeGreaterThanOrEqual(3)
  })
  it('every dialogue edge points at a real node', () => {
    for (const n of Object.values(NPCS)) for (const node of Object.values(n.dialogue.nodes)) for (const o of node.options) {
      for (const k of [o.next, o.fail]) if (k) expect(n.dialogue.nodes[k]).toBeDefined()
    }
  })
  it('every NPC and container is reachable from the shelter', () => {
    const s = newGame()
    for (const t of [...WORLD.npcs, ...WORLD.containers]) expect(findPath(s.player.x, s.player.y, t.x, t.y, (x, y) => isSolidTile(x, y), true, 2000)).not.toBeNull()
  })
})

describe('playthrough', () => {
  it('completes both main quests via the peaceful ending, with a save/load mid-quest', () => {
    let s = newGame()
    talk(s, 'ada'); pick(s, has('q:clean_water=active')); leave(s)
    expect(questStage(s, 'clean_water')).toBe('active')
    talk(s, 'marcus'); pick(s, has('q:clean_water=union')); pick(s, (o) => o.check?.stat === 'wits'); leave(s)
    expect(questStage(s, 'clean_water')).toBe('got')

    // save mid-quest, reload, and keep playing from the restored state
    const json = serialize(s)
    s = deserialize(json)
    expect(questStage(s, 'clean_water')).toBe('got')
    expect(s.player.inv.some((i) => i.id === 'filter_cartridge')).toBe(true)

    talk(s, 'ada'); pick(s, has('q:clean_water=done')); leave(s)
    expect(questStage(s, 'overpass')).toBe('active')
    talk(s, 'rosa'); pick(s, has('q:parcel=active')); leave(s)
    talk(s, 'tom'); pick(s, has('q:parcel=done')); leave(s)
    expect(s.flags.tunnel_tip).toBe(true)
    talk(s, 'dutch'); pick(s, has('flag:tunnel_tip')); pick(s, has('q:overpass=resolved')); leave(s)
    expect(questStage(s, 'overpass')).toBe('resolved')
    expect(liveActors(s).filter((a) => a.group === 'camp').length).toBe(0)
    talk(s, 'ada'); pick(s, has('ending'))
    expect(s.mode).toBe('ending')
    expect(s.ending).toContain('talked Dutch Malloy')
    expect(questStage(s, 'clean_water')).toBe('done')
    expect(questStage(s, 'overpass')).toBe('done')
  })

  it('a failed skill check takes the fail branch', () => {
    const s = newGame({ stats: { wits: 2 } })
    talk(s, 'ada'); pick(s, (o) => o.check?.stat === 'wits')
    expect(s.dialogue?.result).toContain('FAILED')
  })
})

describe('systems', () => {
  it('loots containers into the pack', () => {
    const s = newGame()
    const c = s.containers.find((c) => c.id === 'locker')!
    s.player.x = c.x + 1; s.player.y = c.y
    openContainer(s, c.id)
    expect(s.mode).toBe('loot')
    const before = s.player.inv.length, caps = s.player.caps
    takeFromContainer(s, 'all')
    expect(s.player.inv.length).toBeGreaterThan(before)
    expect(s.player.caps).toBe(caps + 10)
  })
  it('repairs a worn weapon with a kit and heals with aid', () => {
    const s = newGame()
    const w = s.player.inv.find((i) => i.uid === s.player.weapon)!
    w.cond = 30
    addItem(s, 'repair_kit')
    expect(repairItem(s, w.uid)).toBe(true)
    expect(w.cond).toBeGreaterThan(30)
    s.player.hp = 10
    const aid = s.player.inv.find((i) => ITEMS[i.id]!.heal)!
    useItem(s, aid.uid)
    expect(s.player.hp).toBeGreaterThan(10)
  })
  it('barters with caps', () => {
    const s = newGame()
    s.player.caps = 500
    const st = s.barter.stock[0]!
    const price = buyPrice(s, st.id)
    expect(buy(s, st.uid)).toBe(true)
    expect(s.player.caps).toBe(500 - price)
    const mine = s.player.inv.find((i) => i.id === st.id)!
    expect(sell(s, mine.uid)).toBe(true)
    expect(s.player.caps).toBeGreaterThan(500 - price)
  })
  it('radiation pools irradiate the player', () => {
    const s = newGame()
    for (const a of s.actors) a.removed = true
    let found = false
    for (let y = 1; y < 31 && !found; y++) for (let x = 1; x < 39 && !found; x++) {
      if (tileAt(x + 1, y) === 'radpool' && !isSolidTile(x, y)) { s.player.x = x; s.player.y = y; expect(step(s, 1, 0)).toBe(true); found = true }
    }
    expect(found).toBe(true)
    expect(s.player.rads).toBeGreaterThan(0)
  })
  it('T.A.R.G.E.T. combat: hit chances, AP spend, enemy turns, kills', () => {
    const s = newGame({ seed: 7 })
    const rat = s.actors.find((a) => a.id === 'rat1')!
    s.player.x = rat.x - 3; s.player.y = rat.y
    startCombat(s)
    expect(s.mode).toBe('combat')
    openTarget(s, engagedEnemies(s)[0]!.id)
    expect(s.mode).toBe('target')
    for (const p of BODY_PARTS) { const h = hitChance(s, rat, p); expect(h).toBeGreaterThanOrEqual(5); expect(h).toBeLessThanOrEqual(95) }
    expect(hitChance(s, rat, 'torso')).toBeGreaterThan(hitChance(s, rat, 'head'))
    let shots = 0
    for (let round = 0; round < 40 && s.combat; round++) {
      while (s.mode === 'target' && s.combat) { const ap = s.player.ap; const fx = fire(s); if (!fx) break; shots++; if (s.combat) expect(s.player.ap).toBeLessThan(ap) }
      if (!s.combat) break
      if (s.mode === 'dead') break
      endTurn(s)
      const e = engagedEnemies(s)[0]
      if (e && s.mode === 'combat') openTarget(s, e.id)
    }
    expect(shots).toBeGreaterThan(0)
    expect(s.mode === 'explore' || s.mode === 'dead').toBe(true)
    if (s.mode === 'explore') expect(engagedEnemies(s).length).toBe(0)
  })
})
