// assets: generate a weapon sprite that matches the game's art style. The resolution and the
// outline/wood/gold colours are sampled from the game's own sprites.json; the blade is shaded
// from the chosen colour and then quantized to a 6-colour palette, like the base sprites.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodePng } from './png'

export interface SpriteDef { rows: string[]; keys: Record<string, string> }
export interface StyleSample { size: number; palette: Record<string, string>; outline: string; wood: string; gold: string }

export function sampleStyle(gameDir: string): StyleSample {
  const s = JSON.parse(readFileSync(join(gameDir, 'assets', 'sprites.json'), 'utf8'))
  const p: Record<string, string> = s.palette
  const first = Object.values(s.sprites ?? s)[0] as { rows?: string[] } | undefined
  const size = s.resolution ?? first?.rows?.length ?? 12
  const pick = (re: RegExp, d: string) => Object.entries(p).find(([k]) => re.test(k))?.[1] ?? d
  return { size, palette: p, outline: pick(/outline/, '#141821'), wood: pick(/wood|handle|bark/, '#8a5a2b'), gold: pick(/gold|petal/, '#f0b72f') }
}

const toRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
const toHex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
export const shade = (h: string, k: number) => toHex(toRgb(h).map((v) => (k >= 0 ? v + (255 - v) * k : v * (1 + k))))

// Diagonal blade from bottom-left hilt to top-right tip on an N×N grid.
export function generateSword(style: StyleSample, blade: string): SpriteDef {
  const n = style.size
  const g = Array.from({ length: n }, () => Array<string>(n).fill('.'))
  const put = (x: number, y: number, c: string) => { if (x >= 0 && y >= 0 && x < n && y < n) g[y]![x] = c }
  const tip = n - 2
  for (let i = 3; i <= tip; i++) { put(i, n - 1 - i, 'b'); put(i + 1, n - 1 - i, 'l'); put(i, n - i, 'd') }
  put(tip + 1, 0, 'l')
  put(1, n - 4, 'g'); put(2, n - 3, 'g'); put(3, n - 2, 'g'); put(4, n - 1, 'g')   // crossguard
  put(2, n - 2, 'h'); put(1, n - 1, 'h')                                        // handle
  put(0, n - 1, 'o')                                                             // pommel
  // outline every empty cell next to a filled one
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && g[y]![x] !== '.' && g[y]![x] !== 'o'
  const out = g.map((r) => [...r])
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y]![x] === '.' && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) out[y]![x] = 'o'
  return { rows: out.map((r) => r.join('')), keys: { o: style.outline, b: blade, l: shade(blade, 0.55), d: shade(blade, -0.35), g: style.gold, h: style.wood } }
}

export function spritePng(s: SpriteDef, scale = 8): Uint8Array {
  const n = s.rows.length, w = s.rows[0]!.length
  const px = new Uint8Array(w * scale * n * scale * 4)
  for (let y = 0; y < n * scale; y++) for (let x = 0; x < w * scale; x++) {
    const ch = s.rows[Math.floor(y / scale)]![Math.floor(x / scale)]!
    const c = s.keys[ch]
    if (!c) continue
    const [r, g, b] = toRgb(c)
    px.set([r, g, b, 255], (y * w * scale + x) * 4)
  }
  return encodePng(w * scale, n * scale, px)
}
