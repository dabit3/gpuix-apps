// Tiny synth: oscillators (saw/square/sine/noise), ADSR, one-pole filter and a feedback delay render SFX and
// a tracker-style loop to 16-bit WAVs at boot. Playback goes through macOS `afplay` (GPUIX has no audio API).
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mulberry } from '../gen/rng'

const SR = 22050
type Wave = 'saw' | 'square' | 'sine' | 'noise'
export interface Voice { wave: Wave; f0: number; f1?: number; a: number; d: number; s: number; r: number; len: number; cut?: number; vol?: number }

export function synth(v: Voice, out = new Float32Array(Math.ceil((v.len + v.r) * SR)), at = 0) {
  const rnd = mulberry(Math.round(v.f0 * 1000))
  let ph = 0, lp = 0
  const n = Math.ceil((v.len + v.r) * SR), cut = v.cut ?? 1, vol = v.vol ?? 0.5
  for (let i = 0; i < n && at + i < out.length; i++) {
    const t = i / SR
    const f = v.f1 === undefined ? v.f0 : v.f0 * Math.pow(v.f1 / v.f0, Math.min(1, t / v.len))
    ph = (ph + f / SR) % 1
    let s = v.wave === 'saw' ? ph * 2 - 1 : v.wave === 'square' ? (ph < 0.5 ? 1 : -1) : v.wave === 'sine' ? Math.sin(ph * 6.2832) : rnd() * 2 - 1
    lp += (s - lp) * cut; s = lp
    const env = t < v.a ? t / v.a : t < v.a + v.d ? 1 - (1 - v.s) * ((t - v.a) / v.d) : t < v.len ? v.s : v.s * Math.max(0, 1 - (t - v.len) / v.r)
    out[at + i] += s * env * vol
  }
  return out
}

function delay(buf: Float32Array, sec: number, fb: number) {
  const d = Math.round(sec * SR)
  for (let i = d; i < buf.length; i++) buf[i] += buf[i - d]! * fb
  return buf
}

function wav(buf: Float32Array) {
  const b = Buffer.alloc(44 + buf.length * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + buf.length * 2, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(buf.length * 2, 40)
  for (let i = 0; i < buf.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i]! * 32767))), 44 + i * 2)
  return b
}

const mix = (...vs: Voice[]) => { const len = Math.max(...vs.map((v) => v.len + v.r)); const o = new Float32Array(Math.ceil(len * SR)); for (const v of vs) synth(v, o); return o }

export const SFX: Record<string, () => Float32Array> = {
  shoot: () => mix({ wave: 'square', f0: 880, f1: 220, a: 0.002, d: 0.05, s: 0.2, r: 0.04, len: 0.07, cut: 0.5, vol: 0.35 }, { wave: 'noise', f0: 1, a: 0.001, d: 0.04, s: 0, r: 0.02, len: 0.04, cut: 0.6, vol: 0.3 }),
  launch: () => mix({ wave: 'noise', f0: 2, a: 0.01, d: 0.3, s: 0.1, r: 0.15, len: 0.35, cut: 0.15, vol: 0.7 }, { wave: 'saw', f0: 160, f1: 60, a: 0.005, d: 0.2, s: 0, r: 0.1, len: 0.25, cut: 0.2, vol: 0.4 }),
  boom: () => delay(mix({ wave: 'noise', f0: 3, a: 0.002, d: 0.6, s: 0, r: 0.3, len: 0.6, cut: 0.08, vol: 1 }, { wave: 'sine', f0: 90, f1: 30, a: 0.002, d: 0.5, s: 0, r: 0.2, len: 0.5, vol: 0.8 }), 0.09, 0.3),
  hit: () => mix({ wave: 'square', f0: 300, f1: 120, a: 0.001, d: 0.06, s: 0, r: 0.03, len: 0.06, cut: 0.3, vol: 0.35 }),
  die: () => delay(mix({ wave: 'saw', f0: 500, f1: 40, a: 0.005, d: 0.5, s: 0.2, r: 0.2, len: 0.5, cut: 0.25, vol: 0.45 }, { wave: 'noise', f0: 4, a: 0.01, d: 0.3, s: 0, r: 0.2, len: 0.3, cut: 0.2, vol: 0.3 }), 0.12, 0.35),
  pickup: () => mix({ wave: 'square', f0: 660, a: 0.002, d: 0.05, s: 0.6, r: 0.05, len: 0.07, cut: 0.4, vol: 0.25 }, { wave: 'square', f0: 990, a: 0.08, d: 0.05, s: 0.6, r: 0.08, len: 0.16, cut: 0.4, vol: 0.25 }),
  key: () => delay(mix({ wave: 'sine', f0: 523, a: 0.01, d: 0.1, s: 0.7, r: 0.3, len: 0.2, vol: 0.4 }, { wave: 'sine', f0: 784, a: 0.12, d: 0.1, s: 0.7, r: 0.4, len: 0.4, vol: 0.4 }), 0.15, 0.4),
  door: () => mix({ wave: 'saw', f0: 70, f1: 110, a: 0.05, d: 0.3, s: 0.6, r: 0.2, len: 0.5, cut: 0.05, vol: 0.5 }, { wave: 'noise', f0: 5, a: 0.05, d: 0.3, s: 0.5, r: 0.2, len: 0.5, cut: 0.04, vol: 0.4 }),
  hurt: () => mix({ wave: 'saw', f0: 200, f1: 90, a: 0.002, d: 0.15, s: 0, r: 0.05, len: 0.15, cut: 0.3, vol: 0.5 }),
  eshoot: () => mix({ wave: 'sine', f0: 1200, f1: 300, a: 0.002, d: 0.15, s: 0, r: 0.05, len: 0.15, vol: 0.3 }),
  step: () => mix({ wave: 'noise', f0: 6, a: 0.002, d: 0.05, s: 0, r: 0.02, len: 0.05, cut: 0.06, vol: 0.35 }),
  win: () => delay(mix(...[523, 659, 784, 1047].map((f, i) => ({ wave: 'square' as Wave, f0: f, a: 0.01 + i * 0.12, d: 0.1, s: 0.6, r: 0.3, len: 0.2 + i * 0.12, cut: 0.3, vol: 0.2 }))), 0.18, 0.4),
}

// Tracker loop: 4 patterns of 16 steps (bass, lead, drums) at 132 bpm, encoded as compact arrays.
const BASS = [[0, 0, 12, 0, 0, 0, 10, 0, 0, 0, 12, 0, 7, 0, 10, 0], [5, 5, 17, 5, 5, 5, 15, 5, 3, 3, 15, 3, 3, 3, 14, 3]]
const LEAD = [[24, -1, -1, 27, -1, 31, -1, 29, -1, -1, 27, -1, 26, -1, 24, -1], [29, -1, 31, -1, 32, -1, 31, -1, 27, -1, 26, -1, 24, -1, 22, -1]]
const DRUM = [1, 0, 3, 0, 2, 0, 3, 0, 1, 1, 3, 0, 2, 0, 3, 3] // 1 kick, 2 snare, 3 hat
const ORDER = [0, 0, 1, 0, 0, 1, 1, 0]
const KEYS = [0, 0, 5, -2] // one 8-bar section per key: 32 bars ≈ 58 s per loop

export function song(loops = 1) {
  const step = 60 / 132 / 4
  const out = new Float32Array(Math.ceil(KEYS.length * ORDER.length * 16 * step * loops * SR + SR))
  let n = 0
  for (let l = 0; l < loops; l++) for (const key of KEYS) for (const pi of ORDER) for (let s = 0; s < 16; s++, n++) {
    const at = Math.round(n * step * SR), hz = (k: number) => 55 * Math.pow(2, (k + key) / 12)
    synth({ wave: 'saw', f0: hz(BASS[pi]![s]!), a: 0.005, d: 0.08, s: 0.4, r: 0.05, len: step * 0.9, cut: 0.12, vol: 0.22 }, out, at)
    const ld = LEAD[pi]![s]!
    if (ld >= 0 && n >= 128) synth({ wave: 'square', f0: hz(ld), a: 0.01, d: 0.1, s: 0.5, r: 0.1, len: step * 1.8, cut: 0.18, vol: 0.09 }, out, at)
    const dr = DRUM[s]!
    if (dr === 1) synth({ wave: 'sine', f0: 140, f1: 40, a: 0.001, d: 0.12, s: 0, r: 0.02, len: 0.12, vol: 0.5 }, out, at)
    if (dr === 2) synth({ wave: 'noise', f0: 7, a: 0.001, d: 0.1, s: 0, r: 0.03, len: 0.1, cut: 0.4, vol: 0.25 }, out, at)
    if (dr === 3) synth({ wave: 'noise', f0: 8, a: 0.001, d: 0.02, s: 0, r: 0.01, len: 0.02, cut: 0.9, vol: 0.08 }, out, at)
  }
  return delay(out, step * 3, 0.25)
}

export class Audio {
  dir = join(tmpdir(), 'krieg-audio')
  enabled: boolean
  music = true
  private kids = new Set<ChildProcess>()
  private musicProc: ChildProcess | null = null
  private last: Record<string, number> = {}
  ms = 0

  constructor(enabled: boolean) {
    this.enabled = enabled && process.platform === 'darwin' && existsSync('/usr/bin/afplay')
    if (!this.enabled) return
    const t0 = performance.now()
    mkdirSync(this.dir, { recursive: true })
    for (const [k, f] of Object.entries(SFX)) writeFileSync(join(this.dir, `${k}.wav`), wav(f()))
    writeFileSync(join(this.dir, 'song.wav'), wav(song()))
    this.ms = performance.now() - t0
  }

  play(name: string, vol = 0.6) {
    if (!this.enabled || !SFX[name] || this.kids.size > 8) return
    const now = performance.now()
    if (now - (this.last[name] ?? 0) < (name === 'shoot' ? 60 : 40)) return
    this.last[name] = now
    const c = spawn('/usr/bin/afplay', ['-v', String(vol), join(this.dir, `${name}.wav`)], { stdio: 'ignore' })
    this.kids.add(c); c.on('exit', () => this.kids.delete(c))
  }

  startMusic() {
    if (!this.enabled || !this.music || this.musicProc) return
    const c = spawn('/usr/bin/afplay', ['-v', '0.35', join(this.dir, 'song.wav')], { stdio: 'ignore' })
    this.musicProc = c
    c.on('exit', () => { if (this.musicProc === c) { this.musicProc = null; this.startMusic() } })
  }

  toggleMusic() {
    this.music = !this.music
    if (!this.music) { const c = this.musicProc; this.musicProc = null; c?.kill() } else this.startMusic()
  }

  stop() { this.music = false; this.musicProc?.kill(); this.musicProc = null; for (const k of this.kids) k.kill() }
}
