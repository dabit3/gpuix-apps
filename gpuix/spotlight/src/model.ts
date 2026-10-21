/** Pure result model: turns (query, sources) into ranked, sectioned items. */
import { calculate, type CalcResult } from './calc'
import { parseColor, shades, toHex, toHslString, toOklch, toRgbString, type Rgb } from './color'
import { fuzzyMatch } from './fuzzy'
import type { GlyphName } from './icons'
import type { ClipEntry } from './store'
import type { AppEntry, FileHit } from './system'

export type ItemKind = 'app' | 'file' | 'command' | 'extension' | 'calc' | 'color' | 'clip'

export interface Item {
  id: string
  kind: ItemKind
  title: string
  subtitle?: string
  accessory?: string
  icon?: string
  glyph?: GlyphName
  tint?: string
  matches: number[]
  score: number
  path?: string
  calc?: CalcResult
  color?: { rgb: Rgb; hex: string; rgbText: string; hsl: string; oklch: string; shades: string[] }
  clip?: ClipEntry
  command?: CommandId
}

export type CommandId = 'lock' | 'sleep' | 'darkmode' | 'trash' | 'clipboard' | 'colors'

export interface CommandDef {
  id: CommandId
  title: string
  subtitle: string
  glyph: GlyphName
  tint: string
  keywords: string[]
  kind: 'command' | 'extension'
}

export const COMMANDS: CommandDef[] = [
  { id: 'clipboard', title: 'Clipboard History', subtitle: 'Browse everything you copied', glyph: 'clipboard', tint: '#34C759', keywords: ['paste', 'copy', 'clip'], kind: 'extension' },
  { id: 'darkmode', title: 'Toggle Dark Mode', subtitle: 'System appearance', glyph: 'moon', tint: '#3A3A3C', keywords: ['appearance', 'light', 'theme', 'night'], kind: 'command' },
  { id: 'lock', title: 'Lock Screen', subtitle: 'System', glyph: 'lock', tint: '#8E8E93', keywords: ['logout', 'away'], kind: 'command' },
  { id: 'sleep', title: 'Sleep Display', subtitle: 'System', glyph: 'display', tint: '#0A84FF', keywords: ['screen', 'off', 'monitor'], kind: 'command' },
  { id: 'trash', title: 'Empty Trash', subtitle: 'Finder', glyph: 'trash', tint: '#FF453A', keywords: ['bin', 'delete', 'clean'], kind: 'command' },
  { id: 'colors', title: 'Color Converter', subtitle: 'Type #hex, rgb() or hsl()', glyph: 'palette', tint: '#FF9F0A', keywords: ['hex', 'rgb', 'hsl', 'picker'], kind: 'extension' },
]

export interface Sources {
  apps: AppEntry[]
  files: FileHit[]
  fileIcons: Partial<Record<FileHit['kind'], string>>
  clips: ClipEntry[]
  boost: (id: string) => number
}

export interface Section {
  title: string
  items: Item[]
}

const SUGGESTED = ['Finder', 'Calculator', 'TextEdit', 'Safari', 'Notes', 'System Settings']

export const appItem = (a: AppEntry, matches: number[] = [], score = 0): Item => ({
  id: `app:${a.path}`, kind: 'app', title: a.name, subtitle: a.path.startsWith('/System') ? 'System Application' : undefined,
  accessory: 'Application', icon: a.icon, matches, score, path: a.path,
})

const commandItem = (c: CommandDef, matches: number[] = [], score = 0): Item => ({
  id: `cmd:${c.id}`, kind: c.kind, title: c.title, subtitle: c.subtitle, glyph: c.glyph, tint: c.tint,
  accessory: c.kind === 'command' ? 'Command' : 'Extension', matches, score, command: c.id,
})

export function colorItem(rgb: Rgb, query: string): Item {
  const hex = toHex(rgb)
  return {
    id: `color:${hex}`, kind: 'color', title: hex, subtitle: query, matches: [], score: 1e6,
    color: { rgb, hex, rgbText: toRgbString(rgb), hsl: toHslString(rgb), oklch: toOklch(rgb), shades: shades(rgb) },
  }
}

export function buildRoot(query: string, src: Sources): Section[] {
  const q = query.trim()
  if (!q) {
    const used = [...src.apps]
      .map((a) => ({ a, b: src.boost(`app:${a.path}`) }))
      .filter((x) => x.b > 0)
      .sort((x, y) => y.b - x.b)
      .slice(0, 5)
      .map((x) => appItem(x.a))
    const fill = SUGGESTED.map((n) => src.apps.find((a) => a.name === n))
      .filter((a): a is AppEntry => !!a && !used.some((u) => u.path === a.path))
      .slice(0, Math.max(0, 5 - used.length))
      .map((a) => appItem(a))
    return [
      { title: used.length ? 'Recent' : 'Suggestions', items: [...used, ...fill] },
      { title: 'Commands', items: COMMANDS.map((c) => commandItem(c)) },
    ]
  }

  const sections: Section[] = []
  const calc = calculate(q)
  const color = parseColor(q)
  if (calc) sections.push({ title: 'Calculator', items: [{ id: 'calc', kind: 'calc', title: calc.value, calc, matches: [], score: 1e6 }] })
  else if (color) sections.push({ title: 'Color', items: [colorItem(color, q)] })

  const results: Item[] = []
  for (const a of src.apps) {
    const m = fuzzyMatch(q, a.name)
    if (m) results.push(appItem(a, m.indices, m.score + src.boost(`app:${a.path}`)))
  }
  for (const c of COMMANDS) {
    const m = fuzzyMatch(q, c.title)
    const kw = c.keywords.some((k) => k.startsWith(q.toLowerCase()))
    if (m || kw) results.push(commandItem(c, m?.indices ?? [], (m?.score ?? 80) - 4 + src.boost(`cmd:${c.id}`)))
  }
  results.sort((x, y) => y.score - x.score || x.title.localeCompare(y.title))
  if (results.length) sections.push({ title: 'Results', items: results.slice(0, 8) })

  if (src.files.length) {
    sections.push({
      title: 'Files',
      items: src.files.map((f) => {
        const m = fuzzyMatch(q, f.name)
        return {
          id: `file:${f.path}`, kind: 'file' as const, title: f.name, subtitle: f.dir, accessory: f.kind === 'folder' ? 'Folder' : 'File',
          icon: src.fileIcons[f.kind] ?? src.fileIcons.doc, matches: m?.indices ?? [], score: (m?.score ?? 0) + src.boost(`file:${f.path}`), path: f.path,
        }
      }).sort((x, y) => y.score - x.score),
    })
  }
  return sections
}

export function buildClipboard(query: string, clips: ClipEntry[]): Section[] {
  const q = query.trim()
  const items: Item[] = []
  clips.forEach((c, i) => {
    const line = c.text.replace(/\s+/g, ' ').trim()
    const m = q ? fuzzyMatch(q, line) : { score: -i, indices: [] }
    if (!m) return
    items.push({
      id: `clip:${c.at}:${i}`, kind: 'clip', title: line.length > 64 ? `${line.slice(0, 63)}…` : line,
      matches: m.indices.filter((x) => x < 63), score: q ? m.score : -i, clip: c, glyph: 'clipboard', tint: '#34C759',
    })
  })
  if (q) items.sort((a, b) => b.score - a.score)
  return [{ title: q ? 'Matches' : 'Today', items }]
}

export const flatItems = (sections: Section[]) => sections.flatMap((s) => s.items)
