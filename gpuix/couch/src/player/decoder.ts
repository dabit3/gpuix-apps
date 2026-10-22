import type { Subprocess } from 'bun'

export interface FrameSize { w: number; h: number }

/** Fit the source into a decode budget, keeping even dimensions for ffmpeg. */
export function decodeSize(srcW: number, srcH: number, maxW = 960, maxH = 540): FrameSize {
  if (!srcW || !srcH) return { w: maxW, h: maxH }
  const s = Math.min(maxW / srcW, maxH / srcH, 1)
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { w: even(srcW * s), h: even(srcH * s) }
}

export function videoArgs(path: string, start: number, size: FrameSize, opts: { realtime?: boolean; url?: boolean } = {}): string[] {
  return [
    'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
    ...(opts.realtime === false ? [] : ['-re']),
    '-ss', start.toFixed(3), '-i', path,
    '-map', '0:v:0', '-an', '-sn',
    '-vf', `scale=${size.w}:${size.h}:flags=bilinear`,
    '-f', 'rawvideo', '-pix_fmt', 'bgra', 'pipe:1',
  ]
}

export function audioArgs(path: string, start: number): string[] {
  return ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-re', '-ss', start.toFixed(3), '-i', path, '-vn', '-f', 'audiotoolbox', '-']
}

/** Splits an arbitrary chunked byte stream into fixed-size frames, keeping only whole frames. */
export class FrameAssembler {
  private buf: Uint8Array
  private fill = 0
  constructor(readonly frameBytes: number) { this.buf = new Uint8Array(frameBytes) }
  push(chunk: Uint8Array, emit: (frame: Uint8Array) => void) {
    let off = 0
    while (off < chunk.length) {
      const n = Math.min(this.frameBytes - this.fill, chunk.length - off)
      this.buf.set(chunk.subarray(off, off + n), this.fill)
      this.fill += n
      off += n
      if (this.fill === this.frameBytes) {
        emit(this.buf)
        this.buf = new Uint8Array(this.frameBytes)
        this.fill = 0
      }
    }
  }
}

export interface DecoderEvents {
  onFrame: (frame: Uint8Array, size: FrameSize, pos: number) => void
  onEnd: () => void
  onAudio?: (ok: boolean) => void
}

/**
 * Streams BGRA frames from an ffmpeg child (paced by `-re`) and runs audio in a separate ffmpeg
 * so a machine without an audio device still plays video. Pause = stop the children; resume = restart at the last frame.
 */
export class Decoder {
  private video?: Subprocess<'ignore', 'pipe', 'ignore'>
  private audio?: Subprocess
  private gen = 0
  frames = 0
  spawns = 0
  pos = 0
  private startedAt = 0

  constructor(readonly path: string, readonly size: FrameSize, readonly fps: number, readonly duration: number, private ev: DecoderEvents, private mute = false) {}

  get running() { return !!this.video }

  /** Decoded frames per second since the last start. */
  get rate() {
    const s = (performance.now() - this.startedAt) / 1000
    return s > 0.5 ? this.frames / s : 0
  }

  start(at: number) {
    this.stop()
    const gen = ++this.gen
    this.pos = Math.max(0, Math.min(at, Math.max(0, this.duration - 0.05)))
    this.frames = 0
    this.startedAt = performance.now()
    const t0 = this.pos
    const fps = this.fps || 24
    this.spawns++
    const proc = Bun.spawn(videoArgs(this.path, t0, this.size), { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
    this.video = proc
    if (!this.mute && !/^https?:/.test(this.path)) {
      try {
        const a = Bun.spawn(audioArgs(this.path, t0), { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
        this.audio = a
        a.exited.then((code) => { if (gen === this.gen && code !== 0) this.ev.onAudio?.(false) })
      } catch { this.ev.onAudio?.(false) }
    }
    const asm = new FrameAssembler(this.size.w * this.size.h * 4)
    const reader = proc.stdout.getReader()
    const pump = async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done || gen !== this.gen) break
          asm.push(value, (frame) => {
            if (gen !== this.gen) return
            this.frames++
            this.pos = t0 + this.frames / fps
            this.ev.onFrame(frame, this.size, this.pos)
          })
        }
      } catch {}
      if (gen === this.gen) {
        this.video = undefined
        this.killAudio()
        this.ev.onEnd()
      }
    }
    pump()
  }

  private killAudio() {
    try { this.audio?.kill(9) } catch {}
    this.audio = undefined
  }

  stop() {
    this.gen++
    try { this.video?.kill(9) } catch {}
    this.video = undefined
    this.killAudio()
  }
}

/** Grab one frame (for paused scrubbing and the first paint) without starting playback. */
export async function grabFrame(path: string, at: number, size: FrameSize): Promise<Uint8Array | undefined> {
  const args = videoArgs(path, at, size, { realtime: false })
  args.splice(args.indexOf('-f'), 0, '-frames:v', '1')
  const p = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
  const buf = new Uint8Array(await new Response(p.stdout).arrayBuffer())
  await p.exited
  return buf.length >= size.w * size.h * 4 ? buf.subarray(0, size.w * size.h * 4) : undefined
}
