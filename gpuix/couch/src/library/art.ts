import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseCrop, parseSeconds, type Item } from './model.ts'
import { cacheDir } from './scan.ts'

export type ArtKind = 'poster' | 'backdrop' | 'thumb'

export const ART_SIZE: Record<ArtKind, [number, number]> = {
  poster: [320, 480],
  backdrop: [1280, 720],
  thumb: [480, 270],
}

/** Seconds into the file to grab a frame from. */
export function artTime(item: Item, kind: ArtKind): number {
  const d = item.probe?.duration ?? item.artDur ?? 60
  const want = parseSeconds(kind === 'poster' ? item.posterAt : kind === 'backdrop' ? item.backdropAt : undefined)
  const t = want ?? d * (kind === 'poster' ? 0.22 : kind === 'backdrop' ? 0.4 : 0.3)
  return Math.max(0, Math.min(t, Math.max(0, d - 1)))
}

export function artPath(item: Item, kind: ArtKind): string {
  return join(cacheDir(), 'art', `${item.id}.${kind}.${Math.round(artTime(item, kind) * 10)}.jpg`)
}

export function artFilter(kind: ArtKind, crop?: string): string {
  const [w, h] = ART_SIZE[kind]
  const box = parseCrop(crop)
  return `${box ? `crop=${box},` : ''}scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},eq=saturation=1.08`
}

/** Generates poster/backdrop/thumb frames with ffmpeg, a few at a time, and reports each finished file. */
export class ArtQueue {
  private queue: { item: Item; kind: ArtKind }[] = []
  private running = 0
  private seen = new Set<string>()
  generated = 0
  onChange?: () => void

  constructor(private onReady?: (item: Item, kind: ArtKind, path: string) => void, private concurrency = 3) {}

  get pending() { return this.queue.length + this.running }

  /** Returns the cached path if present, otherwise queues generation and returns undefined. */
  request(item: Item, kind: ArtKind, front = false): string | undefined {
    if (item.remote) return kind === 'poster' ? item.remote.poster : kind === 'backdrop' ? item.remote.backdrop ?? item.remote.thumb : item.remote.thumb
    if (!item.path && !item.artSource) return undefined
    const out = artPath(item, kind)
    if (existsSync(out)) return out
    const key = out
    if (!this.seen.has(key)) {
      this.seen.add(key)
      front ? this.queue.unshift({ item, kind }) : this.queue.push({ item, kind })
      this.pump()
    }
    return undefined
  }

  private pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!
      this.running++
      this.run(job.item, job.kind).finally(() => { this.running--; this.pump() })
    }
  }

  private async run(item: Item, kind: ArtKind) {
    const out = artPath(item, kind)
    mkdirSync(join(cacheDir(), 'art'), { recursive: true })
    const tmp = out + '.tmp.jpg'
    const p = Bun.spawn([
      'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', artTime(item, kind).toFixed(2), '-i', (item.path ?? item.artSource)!, '-frames:v', '1',
      '-vf', artFilter(kind, item.crop), '-q:v', '3', tmp,
    ], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
    await p.exited
    if (p.exitCode === 0 && existsSync(tmp) && statSync(tmp).size > 0) {
      renameSync(tmp, out)
      this.generated++
      this.onReady?.(item, kind, out)
      this.onChange?.()
    }
  }
}

export const TRICK_W = 192
export const TRICK_H = 108

export interface Trickplay { interval: number; count: number; data: Uint8Array }

export function trickInterval(duration: number): number {
  return duration <= 120 ? 2 : duration <= 900 ? 5 : 10
}

/** Keyframe-only thumbnail strip (BGRA, TRICK_W×TRICK_H each) used for the scrub preview. */
export async function loadTrickplay(item: Item): Promise<Trickplay | undefined> {
  if (!item.path || !item.probe) return undefined
  const interval = trickInterval(item.probe.duration)
  const dir = join(cacheDir(), 'trick')
  const out = join(dir, `${item.id}.${interval}.bgra`)
  const frame = TRICK_W * TRICK_H * 4
  if (!existsSync(out)) {
    mkdirSync(dir, { recursive: true })
    const tmp = out + '.tmp'
    const p = Bun.spawn([
      'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-skip_frame', 'nokey', '-i', item.path,
      '-vf', `fps=1/${interval},scale=${TRICK_W}:${TRICK_H}:force_original_aspect_ratio=decrease,pad=${TRICK_W}:${TRICK_H}:(ow-iw)/2:(oh-ih)/2:color=black`,
      '-an', '-f', 'rawvideo', '-pix_fmt', 'bgra', tmp,
    ], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
    await p.exited
    if (p.exitCode !== 0 || !existsSync(tmp)) return undefined
    renameSync(tmp, out)
  }
  const data = new Uint8Array(readFileSync(out))
  const count = Math.floor(data.length / frame)
  return count ? { interval, count, data } : undefined
}

export function trickFrame(t: Trickplay, sec: number): Uint8Array {
  const frame = TRICK_W * TRICK_H * 4
  const i = Math.max(0, Math.min(t.count - 1, Math.round(sec / t.interval)))
  return t.data.subarray(i * frame, (i + 1) * frame)
}
