import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { emptyLibrary, parseEpisode, parseTitle, slug, VIDEO_EXT, type Item, type Library, type Probe } from './model.ts'

export const cacheDir = () => process.env.COUCH_CACHE ?? join(homedir(), 'Library/Caches/couch')

/** App-managed bundles (Apple TV, Photos, iMovie…) aren't user media and trip macOS privacy prompts. */
const SKIP_DIR = /\.(tvlibrary|photoslibrary|musiclibrary|imovielibrary|fcpbundle|localized|theater)$/i

interface Found { path: string; size: number; mtimeMs: number; birth: number }

export function walk(root: string, depth = 5, out: Found[] = []): Found[] {
  let names: string[]
  try { names = readdirSync(root) } catch { return out }
  for (const n of names) {
    if (n.startsWith('.') || SKIP_DIR.test(n)) continue
    const p = join(root, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) { if (depth > 0) walk(p, depth - 1, out) }
    else if (VIDEO_EXT.has(extname(n).toLowerCase()) && st.size > 0 && !existsSync(p + '.part')) {
      out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs, birth: st.birthtimeMs || st.mtimeMs })
    }
  }
  return out
}

function readJson(p: string): Record<string, any> | undefined {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return undefined }
}

/** Loose files in these folders are titled by file name, not folder name. */
const CATEGORY_DIR = /^(movies|films?|videos?|downloads|media|library|couch)$/i
const SEASON_DIR = /^(season|series|s)\s*\d+$/i

/** Turns a list of media files into movies, shows and episodes (Plex-style naming, sidecar info.json/show.json). */
export function buildLibrary(root: string, files: Found[]): Library {
  const lib = emptyLibrary(root)
  const showDirs = new Map<string, Item>()
  for (const f of files) {
    const name = basename(f.path)
    const dir = dirname(f.path)
    const ep = parseEpisode(name)
    if (ep) {
      const showDir = SEASON_DIR.test(basename(dir)) ? dirname(dir) : dir
      let show = showDirs.get(showDir)
      if (!show) {
        const meta = readJson(join(showDir, 'show.json')) ?? {}
        const parsed = parseTitle(basename(showDir))
        show = {
          id: 'show-' + slug(meta.title ?? parsed.title),
          kind: 'show', dir: showDir, addedAt: 0, episodes: [],
          title: meta.title ?? parsed.title, year: meta.year ?? parsed.year,
          summary: meta.summary ?? '', genres: meta.genres ?? [], cast: meta.cast ?? [],
          director: meta.director, studio: meta.studio, rating: meta.rating, license: meta.license,
          posterAt: meta.posterAt, backdropAt: meta.backdropAt,
        }
        showDirs.set(showDir, show)
        lib.items[show.id] = show
        lib.shows.push(show.id)
      }
      const id = `${show.id}-s${String(ep.season).padStart(2, '0')}e${String(ep.episode).padStart(2, '0')}`
      const meta = readJson(f.path.replace(/\.[^.]+$/, '.json')) ?? {}
      lib.items[id] = {
        id, kind: 'episode', dir, path: f.path, size: f.size, addedAt: f.birth,
        title: meta.title ?? ep.title ?? `Episode ${ep.episode}`, year: meta.year ?? show.year,
        summary: meta.summary ?? '', genres: show.genres, cast: [], studio: show.studio, license: show.license,
        showId: show.id, season: ep.season, episode: ep.episode, posterAt: meta.posterAt, backdropAt: meta.backdropAt,
      }
      show.episodes!.push(id)
      show.addedAt = Math.max(show.addedAt, f.birth)
      continue
    }
    const meta = readJson(join(dir, 'info.json')) ?? {}
    const parsed = parseTitle(dir === root || CATEGORY_DIR.test(basename(dir)) ? name : basename(dir))
    const title = meta.title ?? parsed.title
    let id = 'movie-' + slug(title + (meta.year ?? parsed.year ?? ''))
    if (lib.items[id]) id += '-' + lib.movies.length
    lib.items[id] = {
      id, kind: 'movie', dir, path: f.path, size: f.size, addedAt: f.birth,
      title, year: meta.year ?? parsed.year, summary: meta.summary ?? '', genres: meta.genres ?? [], cast: meta.cast ?? [],
      director: meta.director, studio: meta.studio, rating: meta.rating, license: meta.license,
      posterAt: meta.posterAt, backdropAt: meta.backdropAt, crop: meta.crop,
    }
    lib.movies.push(id)
  }
  for (const s of showDirs.values()) {
    s.episodes!.sort((a, b) => {
      const x = lib.items[a]!, y = lib.items[b]!
      return (x.season! - y.season!) || (x.episode! - y.episode!)
    })
    s.artSource = lib.items[s.episodes![0]!]?.path
  }
  lib.movies.sort((a, b) => lib.items[a]!.title.localeCompare(lib.items[b]!.title))
  lib.shows.sort((a, b) => lib.items[a]!.title.localeCompare(lib.items[b]!.title))
  return lib
}

export function parseProbe(json: any): Probe | undefined {
  const v = json?.streams?.find((s: any) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  if (!v) return undefined
  const a = json.streams.find((s: any) => s.codec_type === 'audio')
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number)
  return {
    duration: Number(json.format?.duration ?? v.duration ?? 0),
    width: v.width, height: v.height, fps: d ? n! / d : 0,
    vcodec: v.codec_name, acodec: a?.codec_name, channels: a?.channels,
    container: String(json.format?.format_name ?? '').split(',')[0]!,
    bitrate: json.format?.bit_rate ? Number(json.format.bit_rate) : undefined,
  }
}

async function ffprobe(path: string): Promise<Probe | undefined> {
  const p = Bun.spawn(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' })
  const text = await new Response(p.stdout).text()
  await p.exited
  try { return parseProbe(JSON.parse(text)) } catch { return undefined }
}

type ProbeCache = Record<string, { key: string; probe: Probe }>

/** Probes every file (6 at a time) with a size+mtime keyed cache, so warm starts never spawn ffprobe. */
export async function probeAll(lib: Library, onProgress?: () => void): Promise<number> {
  const file = join(cacheDir(), 'probe.json')
  const cache: ProbeCache = readJson(file) as ProbeCache ?? {}
  const todo: Item[] = []
  for (const it of Object.values(lib.items)) {
    if (!it.path) continue
    const key = `${it.size}:${Math.round(statSync(it.path).mtimeMs)}`
    const hit = cache[it.path]
    if (hit && hit.key === key) it.probe = hit.probe
    else todo.push(it)
  }
  let spawned = 0
  const worker = async () => {
    for (let it = todo.shift(); it; it = todo.shift()) {
      spawned++
      const probe = await ffprobe(it.path!)
      if (probe) {
        it.probe = probe
        cache[it.path!] = { key: `${it.size}:${Math.round(statSync(it.path!).mtimeMs)}`, probe }
      }
      onProgress?.()
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  for (const id of lib.shows) {
    const show = lib.items[id]!
    show.artDur = lib.items[show.episodes?.[0] ?? '']?.probe?.duration
  }
  if (spawned) {
    mkdirSync(cacheDir(), { recursive: true })
    writeFileSync(file, JSON.stringify(cache))
  }
  return spawned
}

export function scanLibrary(root: string): Library {
  const t0 = performance.now()
  const lib = buildLibrary(root, walk(root))
  lib.scanMs = performance.now() - t0
  return lib
}
