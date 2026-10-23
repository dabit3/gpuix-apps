// Conversion matrix and command planning. Pure: no processes are spawned here, so it is unit-tested directly.
import { basename, dirname, extname, join } from 'node:path'
import type { Kind } from './sniff'

export type Engine = 'ffmpeg' | 'ffprobe' | 'sips' | 'cwebp' | 'textutil' | 'pandoc' | 'typst'
export type Engines = Partial<Record<Engine, string>>

export interface Target {
  id: string
  label: string
  ext: string
  engine: Engine
  /** Short note for the UI, e.g. 'page 1'. */
  note?: string
  lossy?: boolean
}

export const TARGETS: Record<Kind, Target[]> = {
  image: [
    { id: 'webp', label: 'WebP', ext: 'webp', engine: 'cwebp', lossy: true },
    { id: 'jpg', label: 'JPEG', ext: 'jpg', engine: 'ffmpeg', lossy: true },
    { id: 'avif', label: 'AVIF', ext: 'avif', engine: 'sips', lossy: true },
    { id: 'heic', label: 'HEIC', ext: 'heic', engine: 'sips', lossy: true },
    { id: 'png', label: 'PNG', ext: 'png', engine: 'ffmpeg' },
    { id: 'tiff', label: 'TIFF', ext: 'tiff', engine: 'sips' },
    { id: 'gif', label: 'GIF', ext: 'gif', engine: 'ffmpeg' },
    { id: 'ico', label: 'ICO', ext: 'ico', engine: 'ffmpeg', note: '256 px' },
    { id: 'pdf', label: 'PDF', ext: 'pdf', engine: 'sips' },
  ],
  video: [
    { id: 'mp4', label: 'MP4 H.264', ext: 'mp4', engine: 'ffmpeg', lossy: true },
    { id: 'hevc', label: 'MP4 HEVC', ext: 'mp4', engine: 'ffmpeg', lossy: true },
    { id: 'webm', label: 'WebM VP9', ext: 'webm', engine: 'ffmpeg', lossy: true },
    { id: 'av1', label: 'WebM AV1', ext: 'webm', engine: 'ffmpeg', lossy: true },
    { id: 'mov', label: 'MOV', ext: 'mov', engine: 'ffmpeg', lossy: true },
    { id: 'gif', label: 'GIF', ext: 'gif', engine: 'ffmpeg', lossy: true },
    { id: 'm4a', label: 'Audio M4A', ext: 'm4a', engine: 'ffmpeg', note: 'extract', lossy: true },
    { id: 'mp3', label: 'Audio MP3', ext: 'mp3', engine: 'ffmpeg', note: 'extract', lossy: true },
  ],
  audio: [
    { id: 'mp3', label: 'MP3', ext: 'mp3', engine: 'ffmpeg', lossy: true },
    { id: 'm4a', label: 'AAC', ext: 'm4a', engine: 'ffmpeg', lossy: true },
    { id: 'opus', label: 'Opus', ext: 'opus', engine: 'ffmpeg', lossy: true },
    { id: 'ogg', label: 'OGG', ext: 'ogg', engine: 'ffmpeg', lossy: true },
    { id: 'flac', label: 'FLAC', ext: 'flac', engine: 'ffmpeg' },
    { id: 'wav', label: 'WAV', ext: 'wav', engine: 'ffmpeg' },
  ],
  pdf: [
    { id: 'png', label: 'PNG', ext: 'png', engine: 'sips', note: 'page 1' },
    { id: 'jpg', label: 'JPEG', ext: 'jpg', engine: 'sips', note: 'page 1', lossy: true },
    { id: 'tiff', label: 'TIFF', ext: 'tiff', engine: 'sips', note: 'page 1' },
  ],
  doc: [
    { id: 'pdf', label: 'PDF', ext: 'pdf', engine: 'typst' },
    { id: 'docx', label: 'Word', ext: 'docx', engine: 'textutil' },
    { id: 'html', label: 'HTML', ext: 'html', engine: 'textutil' },
    { id: 'md', label: 'Markdown', ext: 'md', engine: 'pandoc' },
    { id: 'rtf', label: 'RTF', ext: 'rtf', engine: 'textutil' },
    { id: 'txt', label: 'Text', ext: 'txt', engine: 'textutil' },
  ],
}

export const PRESETS = {
  small: { label: 'Small for sharing', quality: 40, maxDim: 1280 },
  hq: { label: 'High quality', quality: 88, maxDim: 0 },
  x: { label: 'X ready', quality: 65, maxDim: 1280 },
} as const
export type PresetId = keyof typeof PRESETS
export const MAX_DIMS = [0, 3840, 2048, 1280, 640] as const

export interface Settings {
  target: string
  quality: number
  maxDim: number
  strip: boolean
  preset: PresetId | null
  hw: boolean
}

export const DEFAULTS: Record<Kind, Settings> = {
  image: { target: 'webp', quality: 80, maxDim: 0, strip: true, preset: null, hw: false },
  video: { target: 'mp4', quality: 40, maxDim: 1280, strip: true, preset: 'small', hw: false },
  audio: { target: 'mp3', quality: 70, maxDim: 0, strip: false, preset: null, hw: false },
  pdf: { target: 'png', quality: 85, maxDim: 2048, strip: false, preset: null, hw: false },
  doc: { target: 'pdf', quality: 100, maxDim: 0, strip: false, preset: null, hw: false },
}

/** Formats whose source the given engine cannot read directly (they go through a sips PNG first). */
const NEEDS_PNG: Record<string, string[]> = {
  cwebp: ['heic', 'avif', 'gif', 'bmp', 'ico'],
  ffmpeg: ['heic', 'avif', 'ico'],
}
const TEXTUTIL_IN = ['docx', 'odt', 'rtf', 'html', 'txt']
const PANDOC_IN = ['md', 'docx', 'odt', 'html', 'epub', 'rtf', 'txt']
const TYPST_SAFE = join(import.meta.dir, 'typst-safe.lua')

export interface Source {
  path: string
  kind: Kind
  format: string
  width?: number
  height?: number
  duration?: number
  hasAudio?: boolean
}

export function targetsFor(src: Pick<Source, 'kind' | 'format' | 'hasAudio'>, engines: Engines): (Target & { available: boolean; reason?: string })[] {
  return TARGETS[src.kind]
    .filter((t) => !(t.ext === src.format || (t.id === 'jpg' && src.format === 'jpeg')) || src.kind === 'video')
    .filter((t) => !(src.kind === 'doc' && t.id === src.format))
    .filter((t) => !(src.kind === 'video' && t.id === src.format && t.id !== 'mp4'))
    .map((t) => {
      const missing = engineFor(src, t).filter((e) => !engines[e])
      if (missing.length) return { ...t, available: false, reason: `needs ${missing.join(' + ')}` }
      if (src.kind === 'video' && (t.id === 'm4a' || t.id === 'mp3') && src.hasAudio === false) return { ...t, available: false, reason: 'no audio track' }
      return { ...t, available: true }
    })
}

/** Every engine a conversion touches (for availability). */
export function engineFor(src: Pick<Source, 'kind' | 'format'>, t: Target): Engine[] {
  const pre: Engine[] = (NEEDS_PNG[t.engine] ?? []).includes(src.format) ? ['sips'] : []
  if (src.kind === 'doc') {
    if (t.id === 'pdf') return ['pandoc', 'typst']
    if (t.id === 'md') return ['pandoc']
    return TEXTUTIL_IN.includes(src.format) ? ['textutil'] : ['pandoc']
  }
  return [...pre, t.engine]
}

/** `name.converted.ext`, then `name.converted-2.ext`, ... Never an existing path. */
export function outputPath(input: string, ext: string, exists: (p: string) => boolean, outDir?: string): string {
  const dir = outDir ?? dirname(input)
  const stem = basename(input, extname(input))
  for (let n = 1; ; n++) {
    const p = join(dir, `${stem}.converted${n === 1 ? '' : `-${n}`}.${ext}`)
    if (!exists(p)) return p
  }
}

export const isConverted = (path: string) => /\.converted(-\d+)?\.[a-z0-9]+$/i.test(path)

export interface Step {
  cmd: string[]
  /** ffmpeg steps report `-progress` on stdout; the job turns out_time into a fraction. */
  progress?: boolean
  /** Write stdout to this file instead of piping it. */
  stdoutTo?: string
}

export interface Plan {
  steps: Step[]
  temps: string[]
  output: string
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Fit (w, h) inside maxDim without upscaling. */
export function fitDims(w: number, h: number, maxDim: number): [number, number] {
  if (!maxDim || (w <= maxDim && h <= maxDim)) return [w, h]
  const s = maxDim / Math.max(w, h)
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]
}

export const crfFor = (q: number) => Math.round(clamp(34 - q * 0.18, 14, 34))
export const audioKbps = (q: number, lo: number, hi: number) => Math.round((lo + (hi - lo) * clamp(q, 0, 100) / 100) / 8) * 8

const FF = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file,pipe']

export function plan(src: Source, s: Settings, engines: Engines, output: string, tmp: string): Plan {
  const t = TARGETS[src.kind].find((x) => x.id === s.target)
  if (!t) throw new Error(`no ${s.target} target for ${src.kind}`)
  const bin = (e: Engine) => engines[e] ?? e
  const temps: string[] = []
  const steps: Step[] = []
  const q = clamp(Math.round(s.quality), 1, 100)

  if (src.kind === 'image' || src.kind === 'pdf') {
    let input = src.path
    if ((NEEDS_PNG[t.engine] ?? []).includes(src.format)) {
      input = join(tmp, `${basename(src.path)}.decoded.png`)
      temps.push(input)
      steps.push({ cmd: [bin('sips'), '-s', 'format', 'png', src.path, '--out', input] })
    }
    const [w, h] = src.width && src.height ? fitDims(src.width, src.height, s.maxDim) : [0, 0]
    const resized = !!src.width && (w !== src.width || h !== src.height)
    if (t.engine === 'cwebp') {
      steps.push({ cmd: [bin('cwebp'), '-quiet', '-q', String(q), ...(resized ? ['-resize', String(w), String(h)] : []), '-metadata', s.strip ? 'none' : 'all', input, '-o', output] })
    } else if (t.engine === 'ffmpeg') {
      const vf = resized ? ['-vf', `scale=${w}:${h}:flags=lanczos`] : []
      if (t.id === 'ico') vf.splice(0, 2, '-vf', `scale=${Math.min(256, w || 256)}:${Math.min(256, h || 256)}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba`)
      const codec = t.id === 'jpg' ? ['-q:v', String(Math.round(clamp(31 - (q / 100) * 29, 2, 31))), '-pix_fmt', 'yuvj444p'] : t.id === 'png' ? ['-compression_level', '9'] : []
      steps.push({ cmd: [bin('ffmpeg'), ...FF, '-i', input, ...vf, ...(s.strip ? ['-map_metadata', '-1'] : []), ...codec, '-frames:v', '1', '-update', '1', output] })
    } else {
      const fmt = ({ jpg: 'jpeg', tiff: 'tiff', avif: 'avif', heic: 'heic', pdf: 'pdf', png: 'png' } as Record<string, string>)[t.id]!
      const maxDim = src.kind === 'pdf' ? s.maxDim || 2048 : resized ? Math.max(w, h) : 0
      steps.push({ cmd: [bin('sips'), '-s', 'format', fmt, ...(t.lossy ? ['-s', 'formatOptions', String(q)] : []), ...(maxDim ? ['-Z', String(maxDim)] : []), input, '--out', output] })
    }
    return { steps, temps, output }
  }

  if (src.kind === 'video' || src.kind === 'audio') {
    const vf: string[] = []
    if (src.kind === 'video' && s.maxDim) vf.push(`scale='min(${s.maxDim},iw)':'min(${s.maxDim},ih)':force_original_aspect_ratio=decrease`, `scale=trunc(iw/2)*2:trunc(ih/2)*2`)
    const meta = s.strip ? ['-map_metadata', '-1'] : []
    const head = [bin('ffmpeg'), ...FF, '-progress', 'pipe:1', '-nostats', '-i', src.path]
    const crf = crfFor(q)
    const aac = (lo: number, hi: number) => ['-c:a', 'aac', '-b:a', `${audioKbps(q, lo, hi)}k`]
    let args: string[]
    const xReady = s.preset === 'x'
    if (src.kind === 'audio' || t.id === 'm4a' || t.id === 'mp3') {
      const a: Record<string, string[]> = {
        mp3: ['-c:a', 'libmp3lame', '-b:a', `${audioKbps(q, 64, 320)}k`],
        m4a: aac(64, 256),
        opus: ['-c:a', 'libopus', '-b:a', `${audioKbps(q, 32, 192)}k`],
        ogg: ['-c:a', 'vorbis', '-strict', '-2', '-ac', '2', '-q:a', String(Math.round(q / 10))],
        flac: ['-c:a', 'flac', '-compression_level', '8'],
        wav: ['-c:a', 'pcm_s16le'],
      }
      args = ['-vn', ...a[t.id]!]
    } else if (t.id === 'gif') {
      const fps = 15
      const scale = `scale='min(${s.maxDim || 640},iw)':-2:flags=lanczos`
      args = ['-an', '-filter_complex', `[0:v]fps=${fps},${scale},split[a][b];[a]palettegen=max_colors=${q > 60 ? 256 : 128}[p];[b][p]paletteuse=dither=sierra2_4a`]
      vf.length = 0
    } else if (t.id === 'webm') {
      args = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(clamp(crf + 8, 15, 50)), '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', `${audioKbps(q, 48, 160)}k`]
    } else if (t.id === 'av1') {
      args = ['-c:v', 'libsvtav1', '-preset', '10', '-crf', String(clamp(crf + 10, 20, 55)), '-svtav1-params', 'verbosity=0', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', `${audioKbps(q, 48, 160)}k`]
    } else if (t.id === 'hevc') {
      args = s.hw
        ? ['-c:v', 'hevc_videotoolbox', '-q:v', String(clamp(q, 20, 90)), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', ...aac(64, 256), '-movflags', '+faststart']
        : ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', String(crf + 2), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error', ...aac(64, 256), '-movflags', '+faststart']
    } else {
      const v = s.hw ? ['-c:v', 'h264_videotoolbox', '-q:v', String(clamp(q, 20, 90))] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf)]
      args = [...v, ...(xReady ? ['-profile:v', 'high', '-r', '30'] : []), '-pix_fmt', 'yuv420p', ...aac(64, 256), ...(t.id === 'mp4' ? ['-movflags', '+faststart'] : [])]
    }
    steps.push({ cmd: [...head, ...(vf.length && !(src.kind === 'audio' || t.id === 'm4a' || t.id === 'mp3') ? ['-vf', vf.join(',')] : []), ...args, ...meta, output], progress: true })
    return { steps, temps, output }
  }

  // Documents.
  const textutilFmt = (id: string) => id
  // Documents are untrusted: --sandbox stops pandoc from fetching URLs or reading files the document
  // references. typst runs separately with --root on an empty dir and on filtered source (TYPST_SAFE).
  const pandoc = [bin('pandoc'), '--sandbox', src.path]
  if (t.id === 'pdf') {
    const root = join(tmp, `${basename(src.path)}.${Bun.hash(src.path).toString(36)}.typst`)
    const typ = join(root, 'doc.typ')
    temps.push(root)
    steps.push({ cmd: ['mkdir', '-p', root] })
    steps.push({ cmd: [...pandoc, '-L', TYPST_SAFE, '-s', '-t', 'typst', '-V', 'mainfont=Helvetica Neue', '-o', typ] })
    steps.push({ cmd: [bin('typst'), 'compile', '--root', root, typ, output] })
  } else if (t.id === 'md') {
    steps.push({ cmd: [...pandoc, '-t', 'gfm', '-o', output] })
  } else if (TEXTUTIL_IN.includes(src.format)) {
    steps.push({ cmd: [bin('textutil'), '-convert', textutilFmt(t.id), src.path, '-output', output] })
  } else if (PANDOC_IN.includes(src.format)) {
    const to: Record<string, string[]> = { html: ['-s', '--metadata', `pagetitle=${basename(src.path)}`], docx: [], rtf: ['-s', '-t', 'rtf'], txt: ['-t', 'plain'] }
    steps.push({ cmd: [...pandoc, ...(to[t.id] ?? []), '-o', output] })
  } else throw new Error(`can't convert ${src.format} documents`)
  return { steps, temps, output }
}

/** Parse ffmpeg `-progress` key=value lines; returns seconds encoded so far, or null. */
export function parseProgress(chunk: string): { seconds: number | null; end: boolean } {
  let seconds: number | null = null
  let end = false
  for (const line of chunk.split('\n')) {
    const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim())
    if (m) seconds = Number(m[1]) / 1e6
    if (line.trim() === 'progress=end') end = true
  }
  return { seconds, end }
}
