export interface Probe {
  duration: number
  width: number
  height: number
  fps: number
  vcodec: string
  acodec?: string
  channels?: number
  container: string
  bitrate?: number
}

export type Kind = 'movie' | 'show' | 'episode'

export interface Item {
  id: string
  kind: Kind
  title: string
  year?: number
  summary: string
  genres: string[]
  cast: string[]
  director?: string
  studio?: string
  rating?: string
  license?: string
  posterAt?: number
  /** ffmpeg crop (w:h:x:y) that removes letterbox bars before artwork is cut. */
  crop?: string
  /** For shows: the episode file artwork is grabbed from, and its duration. */
  artSource?: string
  artDur?: number
  backdropAt?: number
  /** Folder that holds the media and sidecars. */
  dir: string
  /** Media file (movies and episodes). */
  path?: string
  size?: number
  addedAt: number
  probe?: Probe
  /** Episodes only. */
  showId?: string
  season?: number
  episode?: number
  /** Shows only: episode ids sorted by season/episode. */
  episodes?: string[]
  /** Remote source (Plex): stream URL and image URLs. */
  remote?: { stream: string; poster?: string; backdrop?: string; thumb?: string; ratingKey: string }
}

export interface Library {
  root: string
  items: Record<string, Item>
  movies: string[]
  shows: string[]
  scanMs: number
  fromCache: boolean
  source: 'local' | 'plex'
}

export const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.ogv', '.ts', '.wmv', '.mpg'])

export function emptyLibrary(root: string): Library {
  return { root, items: {}, movies: [], shows: [], scanMs: 0, fromCache: false, source: 'local' }
}

export function fmtDuration(sec: number | undefined): string {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.round(sec / 60)
  if (m < 60) return `${Math.max(1, m)} min`
  return `${Math.floor(m / 60)} hr ${m % 60} min`
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`
}

export function resolutionLabel(p?: Probe): string {
  if (!p) return ''
  const h = Math.min(p.height, Math.round(p.width * 9 / 16))
  if (p.width >= 3800) return '4K'
  if (h >= 1000 || p.width >= 1900) return '1080p'
  if (h >= 700 || p.width >= 1270) return '720p'
  if (h >= 470) return '480p'
  return `${p.height}p`
}

const CODECS: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', theora: 'Theora', mpeg4: 'MPEG-4', prores: 'ProRes', aac: 'AAC', ac3: 'AC3', eac3: 'E-AC-3', opus: 'Opus', vorbis: 'Vorbis', mp3: 'MP3', flac: 'FLAC', dts: 'DTS', pcm_s16le: 'PCM' }
export const codecLabel = (c?: string) => (c ? CODECS[c] ?? c.toUpperCase() : '')
export function channelLabel(n?: number): string {
  if (!n) return ''
  return n === 1 ? 'Mono' : n === 2 ? 'Stereo' : n === 6 ? '5.1' : n === 8 ? '7.1' : `${n}ch`
}

/** "Tears of Steel (2012)" → { title, year }. Dots and underscores become spaces. */
export function parseTitle(name: string): { title: string; year?: number } {
  let s = name.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]+/g, ' ').trim()
  s = s.replace(/\s+-\s+(trailer|sample|featurette)$/i, '')
  const m = /^(.*?)[\s(\[]*((?:19|20)\d{2})[)\]]?(?:\s.*)?$/.exec(s)
  if (m && m[1]!.trim()) return { title: m[1]!.trim().replace(/\s+-$/, ''), year: Number(m[2]) }
  return { title: s }
}

/** "Show - S01E02 - Title.mp4" → season/episode/title. */
export function parseEpisode(name: string): { season: number; episode: number; title?: string } | null {
  const m = /s(\d{1,2})\s*e(\d{1,3})(?:\s*-\s*(.+?))?(?:\.[a-z0-9]{2,4})?$/i.exec(name)
  if (!m) return null
  return { season: Number(m[1]), episode: Number(m[2]), title: m[3]?.trim() }
}

/** Sidecar `crop` as a strict w:h:x:y of plain integers; anything else is dropped so it can't reach an ffmpeg filtergraph. */
export function parseCrop(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const m = /^(\d{1,5}):(\d{1,5}):(\d{1,5}):(\d{1,5})$/.exec(v)
  return m ? m.slice(1, 5).map(Number).join(':') : undefined
}

/** Sidecar time in seconds: finite, non-negative numbers only. */
export function parseSeconds(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
