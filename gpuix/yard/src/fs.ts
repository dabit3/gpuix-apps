import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { readdir, lstat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, relative, sep } from 'node:path'

export type Kind = 'dir' | 'image' | 'code' | 'markdown' | 'json' | 'text' | 'archive' | 'other'

export interface Entry {
  name: string
  path: string
  isDir: boolean
  size: number
  mtime: number
  mode: number
  kind: Kind
  hidden: boolean
  children?: number
}

const EXT: Record<string, Kind> = {}
const add = (kind: Kind, exts: string) => exts.split(' ').forEach((e) => (EXT[e] = kind))
add('image', 'png jpg jpeg gif webp bmp tiff tif ico svg')
add('code', 'ts tsx js jsx mjs cjs rs py go c h cpp hpp swift kt java rb php sh bash zsh toml yaml yml css html lua zig')
add('markdown', 'md markdown mdx')
add('json', 'json jsonc')
add('text', 'txt csv log env example gitignore conf ini lock')
add('archive', 'zip tar gz tgz bz2 xz 7z dmg')

export const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  rs: 'rust', py: 'python', go: 'go', json: 'json', jsonc: 'json', sh: 'bash', bash: 'bash', zsh: 'bash',
  toml: 'toml', yaml: 'yaml', yml: 'yaml', md: 'markdown', html: 'html', css: 'css', c: 'c', h: 'c',
}

export function kindOf(name: string, isDir: boolean): Kind {
  if (isDir) return 'dir'
  const ext = extname(name).slice(1).toLowerCase() || (name.startsWith('.') ? name.slice(1).toLowerCase() : '')
  return EXT[ext] ?? 'other'
}

export const extOf = (name: string) => extname(name).slice(1).toLowerCase()

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function statEntry(path: string): Entry | null {
  try {
    const st = statSync(path)
    const name = basename(path)
    const isDir = st.isDirectory()
    let children: number | undefined
    if (isDir) {
      try {
        children = readdirSync(path).filter((n) => !n.startsWith('.')).length
      } catch {
        children = undefined
      }
    }
    return { name, path, isDir, size: st.size, mtime: st.mtimeMs, mode: st.mode, kind: kindOf(name, isDir), hidden: name.startsWith('.'), children }
  } catch {
    return null
  }
}

/** Directory listing: folders first, then natural name order. */
export function listDir(dir: string, showHidden: boolean): Entry[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: Entry[] = []
  for (const name of names) {
    if (!showHidden && name.startsWith('.')) continue
    if (name === '.DS_Store') continue
    const e = statEntry(join(dir, name))
    if (e) out.push(e)
  }
  return out.sort((a, b) => (a.isDir === b.isDir ? collator.compare(a.name, b.name) : a.isDir ? -1 : 1))
}

export interface DirSize {
  bytes: number
  files: number
  dirs: number
  truncated: boolean
}

/** Recursive size, capped so a huge tree never stalls the preview. */
export async function dirSize(dir: string, limit = 25_000): Promise<DirSize> {
  const out: DirSize = { bytes: 0, files: 0, dirs: 0, truncated: false }
  const stack = [dir]
  let seen = 0
  while (stack.length) {
    const d = stack.pop()!
    let items
    try {
      items = await readdir(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const it of items) {
      if (++seen > limit) {
        out.truncated = true
        return out
      }
      const p = join(d, it.name)
      if (it.isDirectory()) {
        out.dirs++
        stack.push(p)
      } else if (it.isFile()) {
        out.files++
        try {
          out.bytes += (await lstat(p)).size
        } catch {}
      }
    }
  }
  return out
}

const SKIP = new Set(['node_modules', '.git', '.Trash', 'Library', '.cache'])

/** Paths under root (relative), breadth-first, for fuzzy jump. */
export function walk(root: string, showHidden: boolean, limit = 6000): string[] {
  const out: string[] = []
  const queue = [root]
  while (queue.length && out.length < limit) {
    const d = queue.shift()!
    let items
    try {
      items = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    items.sort((a, b) => collator.compare(a.name, b.name))
    for (const it of items) {
      if (!showHidden && it.name.startsWith('.')) continue
      if (it.name === '.DS_Store' || SKIP.has(it.name)) continue
      const p = join(d, it.name)
      out.push(relative(root, p))
      if (it.isDirectory()) queue.push(p)
      if (out.length >= limit) break
    }
  }
  return out
}

/** "photo.jpg" → "photo copy.jpg" → "photo copy 2.jpg" until free. */
export function uniqueDest(dir: string, name: string): string {
  let dest = join(dir, name)
  if (!existsSync(dest)) return dest
  const ext = extname(name)
  const stem = ext && !name.startsWith('.') ? name.slice(0, -ext.length) : name
  const tail = ext && !name.startsWith('.') ? ext : ''
  for (let i = 1; ; i++) {
    dest = join(dir, `${stem} copy${i > 1 ? ` ${i}` : ''}${tail}`)
    if (!existsSync(dest)) return dest
  }
}

const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep)

export function copyInto(paths: string[], dest: string): string[] {
  const done: string[] = []
  for (const p of paths) {
    if (!existsSync(p)) continue
    if (inside(dest, p)) throw new Error(`Can't copy ${basename(p)} into itself`)
    const target = uniqueDest(dest, basename(p))
    cpSync(p, target, { recursive: true, errorOnExist: true, preserveTimestamps: true })
    done.push(target)
  }
  return done
}

export function moveInto(paths: string[], dest: string): string[] {
  const done: string[] = []
  for (const p of paths) {
    if (!existsSync(p)) continue
    if (dirname(p) === dest) {
      done.push(p)
      continue
    }
    if (inside(dest, p)) throw new Error(`Can't move ${basename(p)} into itself`)
    const target = uniqueDest(dest, basename(p))
    try {
      renameSync(p, target)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      cpSync(p, target, { recursive: true, preserveTimestamps: true })
      rmSync(p, { recursive: true, force: true })
    }
    done.push(target)
  }
  return done
}

export function renameEntry(path: string, name: string): string {
  const clean = name.trim()
  if (!clean || clean === '.' || clean === '..' || clean.includes('/')) throw new Error('Invalid name')
  const target = join(dirname(path), clean)
  if (target === path) return path
  if (existsSync(target)) throw new Error(`${clean} already exists`)
  renameSync(path, target)
  return target
}

export function makeDir(parent: string, name: string): string {
  const clean = name.trim()
  if (!clean || clean.includes('/')) throw new Error('Invalid name')
  const target = join(parent, clean)
  if (existsSync(target)) throw new Error(`${clean} already exists`)
  mkdirSync(target)
  return target
}

/** Moves into the macOS Trash (Finder's "Put Back" works), or $YARD_TRASH when set. */
export function trash(paths: string[]): number {
  const custom = process.env.YARD_TRASH
  const existing = paths.filter((p) => existsSync(p))
  if (!existing.length) return 0
  if (custom) {
    mkdirSync(custom, { recursive: true })
    for (const p of existing) renameSync(p, uniqueDest(custom, basename(p)))
    return existing.length
  }
  const list = existing.map((p) => `POSIX file ${JSON.stringify(p)}`).join(', ')
  const res = spawnSync('osascript', ['-e', `tell application "Finder" to delete {${list}}`], { encoding: 'utf8' })
  if (res.status === 0) return existing.length
  const dir = join(homedir(), '.Trash')
  for (const p of existing) renameSync(p, uniqueDest(dir, basename(p)))
  return existing.length
}

export interface Clip {
  mode: 'copy' | 'cut'
  paths: string[]
  at: number
}

/** Shared clipboard file, so a yard in one Ghostty split can paste what another yanked. */
export const stateDir = () => process.env.YARD_STATE ?? join(homedir(), '.cache', 'yard')
const clipFile = () => join(stateDir(), 'clipboard.json')

export function readClip(): Clip | null {
  try {
    const c = JSON.parse(readFileSync(clipFile(), 'utf8')) as Clip
    return Array.isArray(c.paths) && c.paths.length ? c : null
  } catch {
    return null
  }
}

export function writeClip(clip: Clip | null) {
  mkdirSync(stateDir(), { recursive: true })
  writeFileSync(clipFile(), JSON.stringify(clip ?? { mode: 'copy', paths: [], at: Date.now() }))
}

export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = -1
  do {
    v /= 1000
    i++
  } while (v >= 1000 && i < units.length - 1)
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function formatDate(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (now - ms < 86_400_000 && new Date(now).getDate() === d.getDate()) return `Today ${time}`
  const sameYear = new Date(now).getFullYear() === d.getFullYear()
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : ` ${d.getFullYear()}`} ${time}`
}

export function formatMode(mode: number, isDir: boolean): string {
  const bits = 'rwxrwxrwx'
  let s = isDir ? 'd' : '-'
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-'
  return s
}

/** Pixel size from PNG / JPEG / GIF headers without decoding. */
export function imageSize(path: string): { width: number; height: number } | null {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(256 * 1024)
    const n = readSync(fd, buf, 0, buf.length, 0)
    const b = buf.subarray(0, n)
    if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    if (b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null
        const marker = b[i + 1]!
        const len = b.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
        i += 2 + len
      }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function readHead(path: string, bytes = 96 * 1024): string {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(bytes)
    const n = readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export const isBinary = (s: string) => s.slice(0, 4000).includes('\u0000')

export function tildify(p: string, home = homedir()): string {
  return p === home ? '~' : p.startsWith(home + sep) ? '~' + p.slice(home.length) : p
}
