import { describe, expect, test } from 'bun:test'
import { fmtDuration, parseEpisode, parseTitle, resolutionLabel } from '../src/library/model'
import { buildLibrary, parseProbe, scanLibrary, walk } from '../src/library/scan'
import { buildRows, gridMove } from '../src/rows'
import { keyToAction, keyToTab } from '../src/keys'
import { FrameAssembler, decodeSize, videoArgs } from '../src/player/decoder'
import { progressOf, recordPosition } from '../src/state'
import { alpha, mix, parseGhostty } from '../src/theme'
import { loadPlexLibrary } from '../src/library/plex'
import { Controller } from '../src/controller'
import { artFilter, artTime } from '../src/library/art'
import { fakeDecoder, makeLibraryDir } from './fixtures'

const root = makeLibraryDir()
const probe = (duration: number) => ({ duration, width: 1280, height: 720, fps: 24, vcodec: 'h264', acodec: 'aac', channels: 2, container: 'mov' })
function lib() {
  const l = scanLibrary(root)
  for (const it of Object.values(l.items)) if (it.path) it.probe = probe(600)
  return l
}
const profiles = [{ name: 'Nader', color: 4 }, { name: 'Kids', color: 2, kids: true }]

describe('library', () => {
  test('parses Plex-style names', () => {
    expect(parseTitle('Sintel (2010) - Trailer.mp4')).toEqual({ title: 'Sintel', year: 2010 })
    expect(parseTitle('Spring.2019.1080p.mp4')).toEqual({ title: 'Spring', year: 2019 })
    expect(parseEpisode('Caminandes - S01E02 - Gran Dillama.mp4')).toEqual({ season: 1, episode: 2, title: 'Gran Dillama' })
    expect(parseEpisode('Big Buck Bunny.mp4')).toBeNull()
    expect(fmtDuration(5400)).toContain('1')
    expect(resolutionLabel(probe(1))).toBe('720p')
  })

  test('walks only finished video files and skips app-managed bundles', () => {
    const files = walk(root).map((f) => f.path.slice(root.length))
    expect(files.some((f) => f.includes('Sintel'))).toBe(false)
    expect(files.some((f) => f.includes('tvlibrary'))).toBe(false)
    expect(files.some((f) => f.endsWith('.txt'))).toBe(false)
    expect(files.length).toBe(5)
  })

  test('groups episodes into shows with sorted seasons and sidecar metadata', () => {
    const l = lib()
    expect(l.movies.map((id) => l.items[id]!.title)).toEqual(['Spring', 'Tears of Steel'])
    const show = l.items[l.shows[0]!]!
    expect(show.title).toBe('Caminandes')
    expect(show.rating).toBe('G')
    expect(show.episodes!.map((id) => `${l.items[id]!.season}x${l.items[id]!.episode}`)).toEqual(['1x1', '1x2', '2x1'])
    expect(show.artSource).toContain('S01E01')
    expect(buildLibrary(root, []).movies).toEqual([])
  })

  test('maps ffprobe json', () => {
    const p = parseProbe({ format: { duration: '52.2', format_name: 'mov,mp4', bit_rate: '1000' }, streams: [
      { codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, avg_frame_rate: '24000/1001' },
      { codec_type: 'audio', codec_name: 'eac3', channels: 6 },
    ] })!
    expect(p.vcodec).toBe('hevc')
    expect(p.fps).toBeCloseTo(23.976, 2)
    expect(p.container).toBe('mov')
    expect(p.channels).toBe(6)
  })

  test('artwork times clamp into the file and crop letterbox bars', () => {
    const l = lib()
    const it = l.items[l.movies[1]!]!
    it.posterAt = 9999
    expect(artTime(it, 'poster')).toBe(599)
    expect(artFilter('poster', '1216:544:32:88')).toStartWith('crop=1216:544:32:88,scale=320:480')
  })
})

describe('rows and navigation', () => {
  test('home shelves, kids filter and continue watching', () => {
    const l = lib()
    const prof = { resume: {} as Record<string, any>, watched: {} }
    let rows = buildRows(l, prof)
    expect(rows.map((r) => r.title)).toEqual(['Recently Added', 'Movies', 'TV Shows', 'Animation'].filter((t) => rows.some((r) => r.title === t)))
    expect(rows[0]!.title).toBe('Recently Added')
    recordPosition(prof, l.movies[1]!, 120, 600)
    rows = buildRows(l, prof)
    expect(rows[0]!.title).toBe('Continue Watching')
    expect(progressOf(prof, l.movies[1]!)).toBeCloseTo(0.2)
    const kids = buildRows(l, prof, true).flatMap((r) => r.ids).map((id) => l.items[id]!.title)
    expect(kids).not.toContain('Tears of Steel')
    expect(kids).toContain('Caminandes')
  })

  test('finishing a title marks it watched', () => {
    const p = { resume: {}, watched: {} as Record<string, number> }
    recordPosition(p, 'a', 590, 600)
    expect(p.watched.a).toBeGreaterThan(0)
    expect(progressOf(p, 'a')).toBe(0)
  })

  test('grid moves clamp to the poster grid', () => {
    expect(gridMove(0, 10, 4, 'right')).toBe(1)
    expect(gridMove(1, 10, 4, 'down')).toBe(5)
    expect(gridMove(8, 10, 4, 'down')).toBe(8)
    expect(gridMove(5, 10, 4, 'up')).toBe(1)
    expect(gridMove(0, 10, 4, 'left')).toBe(0)
  })

  test('keys map to remote actions, including terminal keyChar events', () => {
    expect(keyToAction({ key: 'enter', keyChar: '\n' })).toBe('ok')
    expect(keyToAction({ key: 'space', keyChar: 'h' })).toBe('hud')
    expect(keyToAction({ key: 'space', keyChar: ' ' })).toBe('play')
    expect(keyToAction({ key: 'escape' })).toBe('back')
    expect(keyToAction({ key: 'c', keyChar: 'c', modifiers: { control: true } })).toBeNull()
    expect(keyToTab({ key: '2', keyChar: '2' })).toBe('movies')
  })
})

describe('player plumbing', () => {
  test('decode sizes are even and fit the box', () => {
    expect(decodeSize(1920, 1080)).toEqual({ w: 960, h: 540 })
    const s = decodeSize(1280, 544)
    expect(s.w % 2 + s.h % 2).toBe(0)
    expect(s.w).toBeLessThanOrEqual(960)
    expect(videoArgs('/a.mp4', 12.5, { w: 640, h: 360 })).toEqual(expect.arrayContaining(['-ss', '12.500', 'bgra', 'scale=640:360:flags=bilinear']))
  })

  test('frame assembler re-chunks the raw stream into whole frames', () => {
    const fa = new FrameAssembler(8)
    const out: number[][] = []
    fa.push(new Uint8Array([1, 2, 3]), (f) => out.push([...f]))
    fa.push(new Uint8Array([4, 5, 6, 7, 8, 9, 10]), (f) => out.push([...f]))
    fa.push(new Uint8Array([11, 12, 13, 14, 15, 16, 17, 18, 19]), (f) => out.push([...f]))
    expect(out).toEqual([[1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15, 16]])
  })
})

describe('controller', () => {
  test('profile → home → details → play → scrub → back records resume', () => {
    const dec = fakeDecoder()
    const saves: unknown[] = []
    const c = new Controller(lib(), { profiles: {} }, { profiles, save: (s) => saves.push(s), decoder: () => dec, scrubCommitMs: 0 })
    expect(c.view.screen).toBe('profiles')
    c.dispatch('ok')
    expect(c.view.screen).toBe('browse')
    c.dispatch('down')
    c.dispatch('right')
    c.dispatch('ok')
    expect(c.view.screen).toBe('details')
    expect(c.item(c.view.detailsId)!.title).toBe('Tears of Steel')
    c.dispatch('ok')
    expect(c.view.screen).toBe('player')
    expect(dec.calls).toEqual([0])
    c.scrubBy(60)
    expect(c.view.player!.scrub).toBe(60)
    c.commitScrub()
    expect(dec.calls.at(-1)).toBe(60)
    expect(c.view.player!.pos).toBe(60)
    dec.pos = 75
    c.dispatch('back')
    expect(c.view.screen).toBe('details')
    expect(c.prof!.resume[c.view.detailsId!]!.pos).toBeGreaterThanOrEqual(60)
    expect(saves.length).toBeGreaterThan(0)
    c.dispose()
  })

  test('kids profile hides PG-13, tabs and back to the navbar', () => {
    const c = new Controller(lib(), { profiles: {} }, { profiles, decoder: () => fakeDecoder() })
    c.dispatch('right')
    c.dispatch('ok')
    expect(c.view.profile!.kids).toBe(true)
    expect(c.rows.flatMap((r) => r.ids).some((id) => c.item(id)!.title === 'Tears of Steel')).toBe(false)
    c.setTab('shows')
    c.dispatch('ok')
    expect(c.view.screen).toBe('details')
    expect(c.item(c.view.detailsId)!.kind).toBe('show')
    c.dispatch('back')
    c.dispatch('back')
    expect(c.view.navFocus).toBe(true)
    c.dispose()
  })
})

describe('plex adapter', () => {
  test('maps sections, shows and episodes from the documented JSON API', async () => {
    const seen: string[] = []
    const json = (o: unknown) => new Response(JSON.stringify({ MediaContainer: o }))
    const fetcher = (async (url: string) => {
      const u = new URL(url)
      seen.push(u.pathname)
      expect(u.searchParams.get('X-Plex-Token')).toBe('tok')
      if (u.pathname === '/library/sections') return json({ Directory: [{ key: '1', type: 'movie' }, { key: '2', type: 'show' }, { key: '3', type: 'artist' }] })
      if (u.pathname === '/library/sections/1/all') return json({ Metadata: [{ ratingKey: 10, title: 'Sintel', year: 2010, duration: 888000, thumb: '/t', Media: [{ width: 3840, height: 1608, videoCodec: 'hevc', audioCodec: 'eac3', audioChannels: 8, container: 'mkv', Part: [{ key: '/library/parts/10/file.mkv' }] }], Genre: [{ tag: 'Fantasy' }] }] })
      if (u.pathname === '/library/sections/2/all') return json({ Metadata: [{ ratingKey: 20, title: 'Show' }] })
      if (u.pathname === '/library/metadata/20/allLeaves') return json({ Metadata: [{ ratingKey: 21, title: 'Pilot', parentIndex: 1, index: 1, Media: [{ Part: [{ key: '/p/21' }] }] }] })
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch
    const l = await loadPlexLibrary('http://plex.local:32400/', 'tok', fetcher)
    expect(l.source).toBe('plex')
    const m = l.items[l.movies[0]!]!
    expect(m.probe!.vcodec).toBe('hevc')
    expect(m.probe!.duration).toBe(888)
    expect(m.remote!.stream).toStartWith('http://plex.local:32400/library/parts/10/file.mkv?X-Plex-Token=tok')
    expect(m.remote!.poster).toContain('/photo/:/transcode')
    const ep = l.items[l.items[l.shows[0]!]!.episodes![0]!]!
    expect([ep.season, ep.episode, ep.title]).toEqual([1, 1, 'Pilot'])
    expect(seen).not.toContain('/library/sections/3/all')
  })
})

describe('theme', () => {
  test('parses a ghostty theme file and mixes colors', () => {
    const raw = parseGhostty('background = #0a0c10\nforeground = f0f3f6\npalette = 4=#71b7ff\n# comment\n')
    expect(raw.bg).toBe('#0a0c10')
    expect(raw.palette[4]).toBe('#71b7ff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(alpha('#ffffff', 0.5)).toMatch(/^#ffffff(80|7f)$/i)
  })
})
