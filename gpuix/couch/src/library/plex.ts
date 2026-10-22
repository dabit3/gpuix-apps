import type { Item, Library, Probe } from './model.ts'
import { emptyLibrary } from './model.ts'

/** Minimal client for a Plex Media Server's documented HTTP API (JSON), mapped onto couch's library model. */
export class PlexClient {
  requests = 0
  constructor(readonly base: string, readonly token: string, private fetcher: typeof fetch = fetch) {
    this.base = base.replace(/\/+$/, '')
  }
  url(path: string, params: Record<string, string | number> = {}) {
    const u = new URL(this.base + path)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
    u.searchParams.set('X-Plex-Token', this.token)
    return u.toString()
  }
  async get(path: string, params: Record<string, string | number> = {}): Promise<any> {
    this.requests++
    const r = await this.fetcher(this.url(path, params), { headers: { Accept: 'application/json', 'X-Plex-Product': 'couch', 'X-Plex-Client-Identifier': 'couch-terminal' } })
    if (!r.ok) throw new Error(`plex ${path}: ${r.status}`)
    return ((await r.json()) as any).MediaContainer ?? {}
  }
  /** Server-side resize to the exact tile size (/photo/:/transcode). */
  image(path: string | undefined, w: number, h: number) {
    return path ? this.url('/photo/:/transcode', { width: w, height: h, minSize: 1, upscale: 1, url: path }) : undefined
  }
}

function probeOf(m: any): Probe | undefined {
  const media = m.Media?.[0]
  if (!media) return undefined
  return {
    duration: (m.duration ?? media.duration ?? 0) / 1000, width: media.width ?? 0, height: media.height ?? 0,
    fps: parseFloat(String(media.videoFrameRate ?? '24').replace(/[^0-9.]/g, '')) || 24,
    vcodec: media.videoCodec ?? '', acodec: media.audioCodec, channels: media.audioChannels, container: media.container ?? '', bitrate: media.bitrate ? media.bitrate * 1000 : undefined,
  }
}

function base(c: PlexClient, m: any, kind: Item['kind']): Item {
  const part = m.Media?.[0]?.Part?.[0]
  return {
    id: `plex-${m.ratingKey}`, kind, title: m.title ?? '', year: m.year, summary: m.summary ?? '',
    genres: (m.Genre ?? []).map((g: any) => g.tag), cast: (m.Role ?? []).slice(0, 4).map((r: any) => r.tag),
    director: m.Director?.[0]?.tag, studio: m.studio, rating: m.contentRating, dir: '', addedAt: (m.addedAt ?? 0) * 1000,
    probe: probeOf(m),
    remote: { ratingKey: String(m.ratingKey), stream: part ? c.url(part.key) : '', poster: c.image(m.thumb, 320, 480), backdrop: c.image(m.art, 1280, 720), thumb: c.image(kind === 'episode' ? m.thumb : m.art, 480, 270) },
  }
}

export async function loadPlexLibrary(url: string, token: string, fetcher?: typeof fetch): Promise<Library> {
  const t0 = performance.now()
  const c = new PlexClient(url, token, fetcher)
  const lib = emptyLibrary(url)
  lib.source = 'plex'
  const sections = (await c.get('/library/sections')).Directory ?? []
  for (const s of sections) {
    if (s.type !== 'movie' && s.type !== 'show') continue
    const all = (await c.get(`/library/sections/${s.key}/all`, { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 200 })).Metadata ?? []
    for (const m of all) {
      if (s.type === 'movie') {
        const it = base(c, m, 'movie')
        lib.items[it.id] = it
        lib.movies.push(it.id)
        continue
      }
      const show = base(c, m, 'show')
      show.episodes = []
      lib.items[show.id] = show
      lib.shows.push(show.id)
      const eps = (await c.get(`/library/metadata/${m.ratingKey}/allLeaves`)).Metadata ?? []
      for (const e of eps) {
        const ep = base(c, e, 'episode')
        Object.assign(ep, { showId: show.id, season: e.parentIndex ?? 1, episode: e.index ?? 0, genres: show.genres })
        lib.items[ep.id] = ep
        show.episodes.push(ep.id)
      }
    }
  }
  lib.scanMs = performance.now() - t0
  return lib
}
