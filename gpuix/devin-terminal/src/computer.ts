import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ApiAttachment } from './api'

export type Shot = ApiAttachment & { kind: 'image' | 'video' }

/** Screenshots and recordings Devin posted, oldest first (the API's order). */
export function shotsFrom(list: ApiAttachment[]): Shot[] {
  const out: Shot[] = []
  for (const a of list) {
    if (a.source !== 'devin') continue
    const type = a.content_type ?? ''
    const kind = type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name) ? 'image' : type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(a.name) ? 'video' : null
    if (kind) out.push({ ...a, kind })
  }
  return out
}

export type PreviewDeps = {
  resolve: (a: ApiAttachment) => Promise<string>
  dir?: string
  fetch?: typeof fetch
  /** Grabs one frame of a video into `out`; resolves false when it can't. */
  poster?: (url: string, out: string) => Promise<boolean>
}

export const CACHE_DIR = join(homedir(), '.cache', 'devin-tui', 'attachments')

const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(-80)

async function ffmpegPoster(url: string, out: string): Promise<boolean> {
  for (const at of ['1', '0']) {
    try {
      const p = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-y', '-ss', at, '-i', url, '-frames:v', '1', '-vf', 'scale=1280:-2', out], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
      if ((await p.exited) === 0 && existsSync(out)) return true
    } catch {
      return false
    }
  }
  return false
}

const inflight = new Map<string, Promise<string | null>>()

/** Local file for an attachment preview: the image itself, or a poster frame for a video. Cached on disk. */
export function previewPath(a: Shot, deps: PreviewDeps): Promise<string | null> {
  const dir = deps.dir ?? CACHE_DIR
  const file = join(dir, a.kind === 'image' ? `${a.attachment_id}-${safe(a.name)}` : `${a.attachment_id}-poster.jpg`)
  if (existsSync(file)) return Promise.resolve(file)
  const hit = inflight.get(file)
  if (hit) return hit
  const job = (async () => {
    try {
      mkdirSync(dir, { recursive: true })
      const url = await deps.resolve(a)
      if (a.kind === 'video') return (await (deps.poster ?? ffmpegPoster)(url, file)) ? file : null
      const res = await (deps.fetch ?? fetch)(url)
      if (!res.ok) return null
      writeFileSync(file, new Uint8Array(await res.arrayBuffer()))
      return file
    } catch {
      return null
    } finally {
      inflight.delete(file)
    }
  })()
  inflight.set(file, job)
  return job
}

/** Downloads the full attachment (e.g. the whole recording) so it can be opened in a local viewer. */
export function originalPath(a: Shot, deps: PreviewDeps): Promise<string | null> {
  const dir = deps.dir ?? CACHE_DIR
  const file = join(dir, `${a.attachment_id}-${safe(a.name)}`)
  if (existsSync(file)) return Promise.resolve(file)
  const hit = inflight.get(file)
  if (hit) return hit
  const job = (async () => {
    try {
      mkdirSync(dir, { recursive: true })
      const res = await (deps.fetch ?? fetch)(await deps.resolve(a))
      if (!res.ok) return null
      writeFileSync(file, new Uint8Array(await res.arrayBuffer()))
      return file
    } catch {
      return null
    } finally {
      inflight.delete(file)
    }
  })()
  inflight.set(file, job)
  return job
}
