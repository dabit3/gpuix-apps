/** Real macOS integrations: app index + icons, mdfind, clipboard, appearance, commands. */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { cacheDir } from './store'

export interface AppEntry {
  name: string
  path: string
  bundleId?: string
  icon?: string
}

const HOME = homedir()
const APP_DIRS = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  join(HOME, 'Applications'),
]
const EXTRA_APPS = ['/System/Library/CoreServices/Finder.app']
const CORE = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources'

async function run(cmd: string[], input?: string): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { stdin: input !== undefined ? new TextEncoder().encode(input) : 'ignore', stdout: 'pipe', stderr: 'ignore' })
  const out = await new Response(p.stdout).text()
  return { code: await p.exited, out }
}

async function readPlist(path: string): Promise<Record<string, unknown> | null> {
  const { code, out } = await run(['plutil', '-convert', 'json', '-o', '-', path])
  if (code !== 0) return null
  try {
    return JSON.parse(out) as Record<string, unknown>
  } catch {
    return null
  }
}

function findIcns(app: string, plist: Record<string, unknown> | null): string | undefined {
  const res = join(app, 'Contents', 'Resources')
  const named = plist?.CFBundleIconFile as string | undefined
  const candidates = [named, named && !named.endsWith('.icns') ? `${named}.icns` : undefined, 'AppIcon.icns']
  for (const c of candidates) if (c && existsSync(join(res, c))) return join(res, c)
  try {
    const any = readdirSync(res).find((f) => f.endsWith('.icns'))
    if (any) return join(res, any)
  } catch {}
  return undefined
}

/** Converts an .icns (or any image sips reads) to a 64px PNG, once. */
async function iconPng(src: string, key: string): Promise<string | undefined> {
  const dir = join(cacheDir(), 'icons')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${key.replace(/[^a-z0-9]+/gi, '_')}.png`)
  if (existsSync(out)) return out
  const { code } = await run(['sips', '-s', 'format', 'png', '-Z', '64', src, '--out', out])
  return code === 0 && existsSync(out) ? out : undefined
}

export const genericIcon = (name: string) => iconPng(join(CORE, `${name}.icns`), `core_${name}`)

/** Scans the app folders. The index is cached by folder mtimes so warm starts skip plutil. */
export async function scanApps(): Promise<AppEntry[]> {
  const stamp = APP_DIRS.map((d) => (existsSync(d) ? statSync(d).mtimeMs : 0)).join(',')
  const indexFile = join(cacheDir(), 'apps.json')
  try {
    const cached = JSON.parse(readFileSync(indexFile, 'utf8')) as { stamp: string; apps: AppEntry[] }
    if (cached.stamp === stamp && cached.apps.every((a) => !a.icon || existsSync(a.icon))) return cached.apps
  } catch {}

  const paths = new Set<string>(EXTRA_APPS.filter(existsSync))
  for (const dir of APP_DIRS) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith('.app')) paths.add(join(dir, f))
    } catch {}
  }
  const fallback = await genericIcon('GenericApplicationIcon')
  const apps = await Promise.all(
    [...paths].map(async (path): Promise<AppEntry> => {
      const plist = await readPlist(join(path, 'Contents', 'Info.plist'))
      const name = basename(path, '.app')
      const bundleId = plist?.CFBundleIdentifier as string | undefined
      const icns = findIcns(path, plist)
      const icon = (icns && (await iconPng(icns, bundleId ?? name))) || fallback
      return { name, path, bundleId, icon }
    }),
  )
  apps.sort((a, b) => a.name.localeCompare(b.name))
  mkdirSync(cacheDir(), { recursive: true })
  writeFileSync(indexFile, JSON.stringify({ stamp, apps }))
  return apps
}

// ── Files ────────────────────────────────────────────────────────────────────
export interface FileHit {
  path: string
  name: string
  dir: string
  kind: 'folder' | 'image' | 'text' | 'pdf' | 'code' | 'doc'
}

const KIND_BY_EXT: Record<string, FileHit['kind']> = {
  png: 'image', jpg: 'image', jpeg: 'image', heic: 'image', gif: 'image', webp: 'image',
  txt: 'text', md: 'text', rtf: 'text', csv: 'text', log: 'text', pdf: 'pdf',
  ts: 'code', tsx: 'code', js: 'code', json: 'code', py: 'code', swift: 'code', rs: 'code', sh: 'code', html: 'code', css: 'code',
}
const NOISE = /\/(Library|node_modules|\.git|\.Trash|\.cache|\.bun|\.npm|\.cargo|\.rustup|\.local)\//

let activeSearch: ReturnType<typeof Bun.spawn> | null = null

/** Spotlight file search under ~ by name. Kills the previous query so fast typing never stacks processes. */
export async function searchFiles(query: string, limit = 8): Promise<FileHit[]> {
  activeSearch?.kill()
  const q = query.trim().replace(/["\\*]/g, '')
  if (q.length < 2) return []
  const p = Bun.spawn(['mdfind', '-onlyin', HOME, `kMDItemFSName == "*${q}*"cd`], { stdout: 'pipe', stderr: 'ignore' })
  activeSearch = p
  const out = await new Response(p.stdout).text()
  if (activeSearch === p) activeSearch = null
  const hits: FileHit[] = []
  for (const path of out.split('\n')) {
    if (!path || NOISE.test(path.slice(HOME.length)) || path.includes('/.') || path.endsWith('.app')) continue
    const name = basename(path)
    let kind: FileHit['kind'] = KIND_BY_EXT[extname(name).slice(1).toLowerCase()] ?? 'doc'
    try {
      if (statSync(path).isDirectory()) kind = 'folder'
    } catch {
      continue
    }
    hits.push({ path, name, dir: path.slice(0, path.length - name.length - 1).replace(HOME, '~'), kind })
    if (hits.length >= limit * 3) break
  }
  // Shallow, short paths first: what you usually mean.
  const pref = (h: FileHit) => (/^~\/(Documents|Desktop|Downloads)(\/|$)/.test(h.dir) ? 0 : 1)
  hits.sort((a, b) => pref(a) - pref(b) || a.path.split('/').length - b.path.split('/').length || a.name.length - b.name.length)
  return hits.slice(0, limit)
}

// ── Clipboard / appearance / commands ────────────────────────────────────────
export const readClipboard = async () => (await run(['pbpaste'])).out
export const writeClipboard = async (text: string) => void (await run(['pbcopy'], text))

export async function isDarkMode(): Promise<boolean> {
  const { out } = await run(['defaults', 'read', '-g', 'AppleInterfaceStyle'])
  return out.trim() === 'Dark'
}

const osa = (script: string) => run(['osascript', '-e', script])

export const openPath = (path: string) => run(['open', path])
export const revealInFinder = (path: string) => run(['open', '-R', path])
export const openWith = (app: string, path: string) => run(['open', '-a', app, path])
export const quickLook = (path: string) => run(['qlmanage', '-p', path])
export const quitApp = (name: string) => osa(`tell application "${name.replace(/"/g, '')}" to quit`)

export const systemCommands = {
  toggleDarkMode: () => osa('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode'),
  lockScreen: () => osa('tell application "System Events" to keystroke "q" using {control down, command down}'),
  sleepDisplay: () => run(['pmset', 'displaysleepnow']),
  emptyTrash: () => osa('tell application "Finder" to empty trash'),
  trashCount: async () => {
    try {
      return readdirSync(join(HOME, '.Trash')).filter((f) => f !== '.DS_Store').length
    } catch {
      const { out } = await osa('tell application "Finder" to count items of trash')
      return Number.parseInt(out, 10) || 0
    }
  },
}
