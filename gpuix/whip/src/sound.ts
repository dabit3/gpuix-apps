import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { whipHome } from './protocol'

/** A < 30 ms band-passed noise burst, as 16-bit mono WAV bytes. */
export function crackWav(sampleRate = 44100, ms = 26, seed = 7): Uint8Array {
  const n = Math.floor((sampleRate * ms) / 1000)
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  // RBJ band-pass biquad around 2.6 kHz.
  const f0 = 2600
  const q = 0.9
  const w0 = (2 * Math.PI * f0) / sampleRate
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  const b0 = alpha / a0
  const b2 = -alpha / a0
  const a1 = (-2 * Math.cos(w0)) / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / n
    const env = Math.min(1, i / 12) * Math.exp(-t * 7)
    const x = rnd() * env
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    pcm[i] = Math.max(-32767, Math.min(32767, y * 3.2 * 32767))
  }
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * 2, true)
  new Int16Array(buf, 44).set(pcm)
  return new Uint8Array(buf)
}

let path: string | null = null

export function playCrack() {
  if (process.platform !== 'darwin') return
  try {
    if (!path) {
      const dir = whipHome()
      mkdirSync(dir, { recursive: true })
      path = join(dir, 'crack.wav')
      if (!existsSync(path)) writeFileSync(path, crackWav())
    }
    Bun.spawn(['afplay', '-v', '0.8', path], { stdio: ['ignore', 'ignore', 'ignore'] })
  } catch {}
}
