// Local engine discovery, probing, and preview rendering. Every command runs on this machine; nothing touches the network.
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Engine, Engines, Settings, Source } from './formats'
import { fitDims, plan, TARGETS } from './formats'

const ALL: Engine[] = ['ffmpeg', 'ffprobe', 'sips', 'cwebp', 'textutil', 'pandoc', 'typst']

export interface EngineInfo {
  engines: Engines
  videotoolbox: boolean
}

export function detectEngines(): EngineInfo {
  const engines: Engines = {}
  const path = [process.env.PATH ?? '', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/usr/sbin'].join(':')
  for (const e of ALL) {
    const p = Bun.which(e, { PATH: path })
    if (p) engines[e] = p
  }
  let videotoolbox = false
  if (engines.ffmpeg) {
    const r = Bun.spawnSync([engines.ffmpeg, '-hide_banner', '-encoders'], { stdout: 'pipe', stderr: 'ignore' })
    videotoolbox = r.stdout.toString().includes('h264_videotoolbox')
  }
  return { engines, videotoolbox }
}

export interface RunResult { code: number; stdout: string; stderr: string }

export async function run(cmd: string[], opts: { stdoutTo?: string; signal?: AbortSignal; onStdout?: (s: string) => void } = {}): Promise<RunResult> {
  const proc = Bun.spawn(cmd, { stdin: 'ignore', stdout: opts.stdoutTo ? Bun.file(opts.stdoutTo) : 'pipe', stderr: 'pipe' })
  const abort = () => proc.kill('SIGKILL')
  opts.signal?.addEventListener('abort', abort, { once: true })
  let stdout = ''
  const readOut = async () => {
    if (opts.stdoutTo || !proc.stdout || typeof proc.stdout === 'number') return
    const dec = new TextDecoder()
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      const s = dec.decode(chunk, { stream: true })
      stdout += s.length + stdout.length < 1 << 20 ? s : ''
      opts.onStdout?.(s)
    }
  }
  const [, stderr, code] = await Promise.all([readOut(), new Response(proc.stderr as ReadableStream).text(), proc.exited])
  opts.signal?.removeEventListener('abort', abort)
  return { code, stdout, stderr }
}

/** Dimensions, duration and audio presence. */
export async function probe(src: Source, engines: Engines): Promise<Partial<Source> & { codec?: string; fps?: number; channels?: number; sampleRate?: number; pages?: number }> {
  if ((src.kind === 'video' || src.kind === 'audio') && engines.ffprobe) {
    const r = await run([engines.ffprobe, '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', src.path])
    try {
      const j = JSON.parse(r.stdout) as { streams?: Record<string, unknown>[]; format?: { duration?: string } }
      const v = j.streams?.find((s) => s.codec_type === 'video' && !(s.disposition as Record<string, number> | undefined)?.attached_pic)
      const a = j.streams?.find((s) => s.codec_type === 'audio')
      const [n, d] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number)
      return {
        width: v ? Number(v.width) : undefined,
        height: v ? Number(v.height) : undefined,
        duration: Number(j.format?.duration ?? 0) || undefined,
        hasAudio: !!a,
        codec: String((v ?? a)?.codec_name ?? ''),
        fps: d ? Math.round((n! / d) * 100) / 100 : undefined,
        channels: a ? Number(a.channels) : undefined,
        sampleRate: a ? Number(a.sample_rate) : undefined,
      }
    } catch { return {} }
  }
  if ((src.kind === 'image' || src.kind === 'pdf') && engines.sips) {
    const r = await run([engines.sips, '-g', 'pixelWidth', '-g', 'pixelHeight', src.path])
    const w = /pixelWidth: (\d+)/.exec(r.stdout), h = /pixelHeight: (\d+)/.exec(r.stdout)
    return { width: w ? Number(w[1]) : undefined, height: h ? Number(h[1]) : undefined }
  }
  return {}
}

const DISPLAYABLE = ['png', 'jpeg', 'jpg', 'webp', 'gif', 'bmp', 'tiff', 'ico']

let seq = 0
const key = (p: string) => `${(seq++).toString(36)}-${basename(p).replace(/[^\w.-]/g, '_')}`

/** A PNG/JPEG that `<img>` can paint: images and PDF page 1 via sips, video as a 4-frame strip, audio as a waveform. */
export async function thumbnail(src: Source, engines: Engines, cache: string, color: string): Promise<string | null> {
  mkdirSync(cache, { recursive: true })
  const out = join(cache, `${key(src.path)}.thumb.png`)
  if (src.kind === 'image' || src.kind === 'pdf') {
    if (!engines.sips) return DISPLAYABLE.includes(src.format) ? src.path : null
    const r = await run([engines.sips, '-s', 'format', 'png', '-Z', '1100', src.path, '--out', out])
    return r.code === 0 && existsSync(out) ? out : null
  }
  if (src.kind === 'video' && engines.ffmpeg) {
    const at = Math.max(0, (src.duration ?? 0) * 0.4)
    const r = await run([engines.ffmpeg, '-nostdin', '-v', 'error', '-y', '-ss', at.toFixed(2), '-i', src.path, '-vf', 'scale=1100:-2:flags=lanczos', '-frames:v', '1', '-update', '1', out])
    return r.code === 0 && existsSync(out) ? out : null
  }
  if (src.kind === 'audio' && engines.ffmpeg) {
    const r = await run([engines.ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', src.path, '-filter_complex', `aformat=channel_layouts=mono,showwavespic=s=1100x300:scale=sqrt:colors=${color.replace('#', '0x')}@0.7:split_channels=0`, '-frames:v', '1', '-update', '1', out])
    return r.code === 0 && existsSync(out) ? out : null
  }
  return null
}

/** First lines of a document as plain text, via textutil or pandoc. */
export async function excerpt(src: Source, engines: Engines): Promise<string> {
  let text = ''
  if (src.format === 'md' || src.format === 'txt') text = await Bun.file(src.path).slice(0, 4000).text()
  else if (engines.textutil && ['docx', 'odt', 'rtf', 'html'].includes(src.format)) text = (await run([engines.textutil, '-convert', 'txt', '-stdout', src.path])).stdout
  else if (engines.pandoc) text = (await run([engines.pandoc, '--sandbox', src.path, '-t', 'plain'])).stdout
  return text.split('\n').slice(0, 24).join('\n').slice(0, 1400)
}

export interface Preview {
  original: string
  encoded: string
  /** Bytes of the encoded crop, scaled to the full output size. */
  estimate: number
  cropBytes: number
}

/** 1:1 center crop of an image (decoded once), so quality changes can be previewed at real pixel size. */
export async function previewCrop(src: Source, engines: Engines, cache: string, w = 520, h = 360): Promise<{ path: string; w: number; h: number } | null> {
  if (!engines.ffmpeg || src.kind !== 'image') return null
  mkdirSync(cache, { recursive: true })
  let input = src.path
  if (!['png', 'jpeg', 'webp', 'bmp', 'tiff', 'gif'].includes(src.format)) {
    if (!engines.sips) return null
    input = join(cache, `${key(src.path)}.full.png`)
    if ((await run([engines.sips, '-s', 'format', 'png', src.path, '--out', input])).code !== 0) return null
  }
  const cw = Math.min(w, src.width ?? w), ch = Math.min(h, src.height ?? h)
  const out = join(cache, `${key(src.path)}.crop.png`)
  // Bias the crop slightly toward the upper third, where landscapes and faces usually put the detail.
  const r = await run([engines.ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', input, '-vf', `crop=${cw}:${ch}:(iw-${cw})/2:(ih-${ch})*0.42`, '-frames:v', '1', '-update', '1', out])
  return r.code === 0 && existsSync(out) ? { path: out, w: cw, h: ch } : null
}

/** Encodes the crop with the exact settings the real conversion uses, then decodes it for display. */
export async function previewEncode(src: Source, crop: { path: string; w: number; h: number }, s: Settings, engines: Engines, cache: string, signal?: AbortSignal): Promise<Preview | null> {
  const t = TARGETS.image.find((x) => x.id === s.target)
  if (!t) return null
  const id = key(src.path)
  const enc = join(cache, `${id}.preview.${t.ext}`)
  const p = plan({ path: crop.path, kind: 'image', format: 'png', width: crop.w, height: crop.h }, { ...s, maxDim: 0 }, engines, enc, cache)
  for (const step of p.steps) {
    const r = await run(step.cmd, { signal, stdoutTo: step.stdoutTo })
    if (r.code !== 0 || signal?.aborted) return null
  }
  if (!existsSync(enc)) return null
  let shown = enc
  if (!['jpg', 'png', 'webp', 'gif', 'tiff'].includes(t.id)) {
    shown = join(cache, `${id}.preview.png`)
    const r = await run([engines.sips!, '-s', 'format', 'png', enc, '--out', shown], { signal })
    if (r.code !== 0) return null
  }
  const cropBytes = statSync(enc).size
  const [fw, fh] = src.width && src.height ? fitDims(src.width, src.height, s.maxDim) : [crop.w, crop.h]
  return { original: crop.path, encoded: shown, cropBytes, estimate: Math.round(cropBytes * ((fw * fh) / (crop.w * crop.h))) }
}
