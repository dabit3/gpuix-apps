import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { stateDir } from './fs'

export interface Exif {
  camera?: string
  lens?: string
  aperture?: string
  shutter?: string
  iso?: string
  focal?: string
  taken?: string
}

/** Minimal EXIF reader: walks the JPEG APP1 TIFF block for the handful of tags a photographer cares about. */
export function readExif(path: string): Exif | null {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const head = Buffer.alloc(128 * 1024)
    const n = readSync(fd, head, 0, head.length, 0)
    const b = head.subarray(0, n)
    if (b[0] !== 0xff || b[1] !== 0xd8) return null
    let i = 2
    while (i + 4 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]!
      const len = b.readUInt16BE(i + 2)
      if (marker === 0xe1 && b.toString('ascii', i + 4, i + 8) === 'Exif') return parseTiff(b.subarray(i + 10, i + 2 + len))
      if (marker === 0xda) return null
      i += 2 + len
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function parseTiff(t: Buffer): Exif | null {
  const le = t.toString('ascii', 0, 2) === 'II'
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o))
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o))
  const tags: Record<number, string | number> = {}
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
  const readIfd = (off: number, depth = 0) => {
    if (off <= 0 || off + 2 > t.length || depth > 2) return
    const count = u16(off)
    for (let k = 0; k < count; k++) {
      const e = off + 2 + k * 12
      if (e + 12 > t.length) return
      const tag = u16(e)
      const type = u16(e + 2)
      const num = u32(e + 4)
      const bytes = (sizes[type] ?? 1) * num
      const at = bytes > 4 ? u32(e + 8) : e + 8
      if (at + bytes > t.length) continue
      if (tag === 0x8769) readIfd(u32(e + 8), depth + 1)
      else if (type === 2) tags[tag] = t.toString('utf8', at, at + num).replace(/\0+$/, '').trim()
      else if (type === 3) tags[tag] = u16(at)
      else if (type === 4) tags[tag] = u32(at)
      else if (type === 5 || type === 10) {
        const den = u32(at + 4)
        tags[tag] = den ? u32(at) / den : 0
        if (tag === 0x829a) tags[-1] = `${u32(at)}/${den}`
      }
    }
  }
  readIfd(u32(4))
  const s = (k: number) => (typeof tags[k] === 'string' ? (tags[k] as string) : undefined)
  const num = (k: number) => (typeof tags[k] === 'number' ? (tags[k] as number) : undefined)
  const make = s(0x010f)
  const model = s(0x0110)
  const camera = model ? (make && !model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]!) ? `${titleMake(make)} ${model}` : model) : undefined
  const exposure = num(0x829a)
  const f = num(0x829d)
  const iso = num(0x8827)
  const focal = num(0x920a)
  const out: Exif = {
    camera,
    lens: s(0xa434),
    aperture: f ? `ƒ/${trim(f)}` : undefined,
    shutter: exposure ? (exposure >= 1 ? `${trim(exposure)} s` : `1/${Math.round(1 / exposure)} s`) : undefined,
    iso: iso ? `ISO ${iso}` : undefined,
    focal: focal ? `${trim(focal)} mm` : undefined,
    taken: s(0x9003) ? formatTaken(s(0x9003)!) : undefined,
  }
  return Object.values(out).some(Boolean) ? out : null
}

const trim = (n: number) => (Math.round(n * 10) / 10).toString()
const titleMake = (m: string) => (m === m.toUpperCase() && m.length > 3 ? m[0] + m.slice(1).toLowerCase() : m)
function formatTaken(v: string) {
  const m = v.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/)
  if (!m) return v
  const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Thumbnails and palettes come from `sips` once, then live in ~/.cache/yard/thumbs keyed by path + mtime.
const thumbDir = () => join(stateDir(), 'thumbs')
const keyFor = (path: string) => {
  const st = statSync(path)
  return createHash('sha1').update(`${path}:${st.mtimeMs}:${st.size}`).digest('hex').slice(0, 16)
}

const pending = new Map<string, Promise<string | null>>()
const queue: (() => void)[] = []
let running = 0
const limit = <R>(job: () => Promise<R>) =>
  new Promise<R>((resolve) => {
    const run = () => {
      running++
      job().then((r) => {
        running--
        queue.shift()?.()
        resolve(r)
      })
    }
    running < 3 ? run() : queue.push(run)
  })

const sips = (args: string[]) =>
  new Promise<boolean>((resolve) => {
    const p = spawn('sips', args, { stdio: 'ignore' })
    p.on('error', () => resolve(false))
    p.on('close', (code) => resolve(code === 0))
  })

/** Cached thumbnail path (or null when sips is unavailable). Resolves immediately when already cached. */
export function thumbnail(path: string, size = 320): Promise<string | null> {
  let key: string
  try {
    key = `${keyFor(path)}-${size}`
  } catch {
    return Promise.resolve(null)
  }
  const out = join(thumbDir(), `${key}.jpg`)
  if (existsSync(out)) return Promise.resolve(out)
  const hit = pending.get(out)
  if (hit) return hit
  if (process.platform !== 'darwin') return Promise.resolve(null)
  mkdirSync(thumbDir(), { recursive: true })
  const job = limit(async () => ((await sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', String(size), path, '--out', out])) ? out : null))
  pending.set(out, job)
  return job
}

export function cachedThumbnail(path: string, size = 320): string | null {
  try {
    const out = join(thumbDir(), `${keyFor(path)}-${size}.jpg`)
    return existsSync(out) ? out : null
  } catch {
    return null
  }
}

const palettes = new Map<string, string[]>()

/** Five dominant colours, from a tiny BMP that sips renders once. */
export async function palette(path: string): Promise<string[]> {
  const memo = palettes.get(path)
  if (memo) return memo
  let key: string
  try {
    key = keyFor(path)
  } catch {
    return []
  }
  const bmp = join(thumbDir(), `${key}-pal.bmp`)
  if (!existsSync(bmp)) {
    if (process.platform !== 'darwin') return []
    mkdirSync(thumbDir(), { recursive: true })
    const ok = await limit(() => sips(['-s', 'format', 'bmp', '-z', '24', '36', path, '--out', bmp]))
    if (!ok) return []
  }
  const colors = dominant(decodeBmp(readFileSync(bmp)))
  palettes.set(path, colors)
  return colors
}

function decodeBmp(b: Buffer): number[][] {
  if (b.toString('ascii', 0, 2) !== 'BM') return []
  const off = b.readUInt32LE(10)
  const w = b.readInt32LE(18)
  const h = Math.abs(b.readInt32LE(22))
  const bpp = b.readUInt16LE(28)
  const step = bpp / 8
  if (step < 3) return []
  const stride = Math.ceil((w * step) / 4) * 4
  const px: number[][] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = off + y * stride + x * step
      if (o + 2 < b.length) px.push([b[o + 2]!, b[o + 1]!, b[o]!])
    }
  return px
}

/** Median-cut into 5 boxes, ordered by population, skipping near-duplicates. */
export function dominant(px: number[][], count = 5): string[] {
  if (!px.length) return []
  let boxes: number[][][] = [px]
  while (boxes.length < count * 2) {
    let bi = -1
    let best = -1
    let axis = 0
    boxes.forEach((box, k) => {
      if (box.length < 2) return
      for (let a = 0; a < 3; a++) {
        let lo = 255
        let hi = 0
        for (const p of box) {
          lo = Math.min(lo, p[a]!)
          hi = Math.max(hi, p[a]!)
        }
        if (hi - lo > best) {
          best = hi - lo
          bi = k
          axis = a
        }
      }
    })
    if (bi < 0) break
    const box = boxes[bi]!.slice().sort((p, q) => p[axis]! - q[axis]!)
    const mid = box.length >> 1
    boxes = [...boxes.slice(0, bi), box.slice(0, mid), box.slice(mid), ...boxes.slice(bi + 1)]
  }
  const avg = boxes
    .map((box) => ({ n: box.length, c: [0, 1, 2].map((a) => Math.round(box.reduce((s, p) => s + p[a]!, 0) / box.length)) }))
    .sort((p, q) => q.n - p.n)
  const out: number[][] = []
  for (const { c } of avg) {
    if (out.some((o) => Math.hypot(o[0]! - c[0]!, o[1]! - c[1]!, o[2]! - c[2]!) < 28)) continue
    out.push(c)
    if (out.length === count) break
  }
  return out.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''))
}
