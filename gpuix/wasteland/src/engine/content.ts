import itemsJson from '../data/items.json'
import questsJson from '../data/quests.json'
import enemiesJson from '../data/enemies.json'
import worldJson from '../data/world.json'

export type Stat = 'grit' | 'wits' | 'reflex' | 'charm' | 'stamina' | 'perception' | 'fortune'
export const STATS: Stat[] = ['grit', 'wits', 'reflex', 'charm', 'stamina', 'perception', 'fortune']
export const STAT_INFO: Record<Stat, string> = {
  grit: 'Melee damage and carry weight',
  wits: 'Repairs, locks and clever dialogue',
  reflex: 'Action points in T.A.R.G.E.T.',
  charm: 'Barter prices and persuasion',
  stamina: 'Hit points and radiation tolerance',
  perception: 'Gun accuracy and spotting',
  fortune: 'Critical hits and loot',
}

export interface ItemDef {
  name: string
  kind: 'weapon' | 'armor' | 'aid' | 'tool' | 'quest'
  class?: 'gun' | 'melee'
  dmg?: number
  ap?: number
  range?: number
  armor?: number
  radResist?: number
  heal?: number
  rads?: number
  repair?: number
  weight: number
  value: number
  parts?: Record<string, number>
}
export interface QuestDef { title: string; main: boolean; stages: Record<string, string> }
export interface EnemyDef { name: string; hp: number; armor: number; ap: number; dmg: [number, number]; hit: number; range: number; xp: number; aggro: number; sprite: string }

export interface DialogueOption {
  text: string
  req?: string[]
  check?: { stat: Stat; dc: number }
  effects?: string[]
  next?: string
  fail?: string
  end?: boolean
}
export interface DialogueNode { text: string; options: DialogueOption[] }
export interface Look { hair?: string; skin?: number; age?: number; glasses?: number; beard?: number; scar?: number; earring?: number; goggles?: number; kid?: number; hat?: number; mask?: number; headset?: number }
export interface NpcDef {
  id: string; name: string; x: number; y: number; faction: string; sprite?: string; look: Look
  dialogue: { starts: { req?: string[]; node: string }[]; nodes: Record<string, DialogueNode> }
}

export const ITEMS = itemsJson as unknown as Record<string, ItemDef>
export const QUESTS = questsJson as unknown as Record<string, QuestDef>
export const ENEMIES = enemiesJson as unknown as Record<string, EnemyDef>
export const WORLD = worldJson as unknown as {
  start: { x: number; y: number }
  enemies: { id: string; type: string; x: number; y: number; group: string; name?: string; neutral?: boolean; npc?: string }[]
  containers: { id: string; name: string; x: number; y: number; items: [string, number][]; caps: number; lock?: { stat: Stat; dc: number } }[]
  trader: { npc: string; caps: number; stock: [string, number][] }
  npcs: NpcDef[]
}
export const NPCS: Record<string, NpcDef> = Object.fromEntries(WORLD.npcs.map((n) => [n.id, n]))

export const PERKS: Record<string, { name: string; desc: string }> = {
  deadeye: { name: 'Deadeye', desc: '+12% hit chance in T.A.R.G.E.T.' },
  smooth_talker: { name: 'Smooth Talker', desc: '+1 Charm on dialogue checks' },
  lead_belly: { name: 'Lead Belly', desc: 'Take half radiation' },
  scrounger: { name: 'Scrounger', desc: 'Find 50% more caps' },
  tinkerer: { name: 'Tinkerer', desc: 'Repairs restore 50% more' },
  toughness: { name: 'Toughness', desc: '+2 armor rating' },
}

export const RADIO_STATIONS = [
  { id: 'shelter', freq: '76.4', name: 'Shelter 34 PA', unlock: null as string | null },
  { id: 'union', freq: '93.7', name: 'Union Tunnel Net', unlock: null as string | null },
  { id: 'brass', freq: '88.1', name: 'WKNY: Brass & Ash', unlock: 'radio:brass' as string | null },
]
