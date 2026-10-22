/** Screencast frame helpers: header sniffing (no full decode) and a latest-wins gate. */

export interface FrameSize { width: number; height: number; format: 'jpeg' | 'png' }

/** Reads width/height from a JPEG SOF marker or a PNG IHDR chunk. */
export function imageSize(b: Uint8Array): FrameSize | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { width: dv.getUint32(16), height: dv.getUint32(20), format: 'png' }
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]!
    if (marker === 0xff) { i++; continue }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    const len = (b[i + 2]! << 8) | b[i + 3]!
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]!, format: 'jpeg' }
    }
    i += 2 + len
  }
  return null
}

export function decodeBase64(data: string): Uint8Array { return Buffer.from(data, 'base64') }

/**
 * Holds at most one pending frame. A frame that arrives before the previous one was painted replaces it
 * (the stale one is counted as dropped), so the view never lags behind Chrome.
 */
export class LatestFrame<T> {
  private pending: T | null = null
  dropped = 0
  painted = 0
  /** Queues `f` and returns the stale frame it replaced, if any. */
  push(f: T): T | null { const old = this.pending; if (old) this.dropped++; this.pending = f; return old }
  take(): T | null { const f = this.pending; this.pending = null; if (f) this.painted++; return f }
  get hasPending() { return this.pending != null }
}

/** Rolling frames-per-second over a 1 s window. */
export class RateMeter {
  private times: number[] = []
  tick(now = performance.now()) { this.times.push(now); this.trim(now) }
  rate(now = performance.now()) { this.trim(now); return this.times.length }
  private trim(now: number) { while (this.times.length && now - this.times[0]! > 1000) this.times.shift() }
}
