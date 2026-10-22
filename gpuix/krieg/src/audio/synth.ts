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

// Positional voice: wave, f0, f1 (0 = no sweep), attack, decay, sustain, release, len, cutoff, volume.
const V = (wave: Wave, f0: number, f1: number, a: number, d: number, s: number, r: number, len: number, cut: number, vol: number): Voice => ({ wave, f0, f1: f1 || undefined, a, d, s, r, len, cut, vol })
const mix = (...vs: Voice[]) => { const len = Math.max(...vs.map((v) => v.len + v.r)); const o = new Float32Array(Math.ceil(len * SR)); for (const v of vs) synth(v, o); return o }

export const SFX: Record<string, () => Float32Array> = {
  shoot: () => mix(V('noise', 1, 0, 0.001, 0.07, 0, 0.05, 0.07, 0.55, 0.75), V('square', 190, 55, 0.001, 0.06, 0, 0.03, 0.06, 0.25, 0.45)),
  launch: () => mix(V('noise', 2, 0, 0.01, 0.3, 0.1, 0.15, 0.35, 0.15, 0.7), V('saw', 160, 60, 0.005, 0.2, 0, 0.1, 0.25, 0.2, 0.4)),
  boom: () => delay(mix(V('noise', 3, 0, 0.002, 0.6, 0, 0.3, 0.6, 0.08, 1), V('sine', 90, 30, 0.002, 0.5, 0, 0.2, 0.5, 1, 0.8)), 0.09, 0.3),
  hit: () => mix(V('square', 300, 120, 0.001, 0.06, 0, 0.03, 0.06, 0.3, 0.35)),
  die: () => delay(mix(V('saw', 500, 40, 0.005, 0.5, 0.2, 0.2, 0.5, 0.25, 0.45), V('noise', 4, 0, 0.01, 0.3, 0, 0.2, 0.3, 0.2, 0.3)), 0.12, 0.35),
  pickup: () => mix(V('square', 660, 0, 0.002, 0.05, 0.6, 0.05, 0.07, 0.4, 0.25), V('square', 990, 0, 0.08, 0.05, 0.6, 0.08, 0.16, 0.4, 0.25)),
  key: () => delay(mix(V('sine', 523, 0, 0.01, 0.1, 0.7, 0.3, 0.2, 1, 0.4), V('sine', 784, 0, 0.12, 0.1, 0.7, 0.4, 0.4, 1, 0.4)), 0.15, 0.4),
  door: () => mix(V('saw', 70, 110, 0.05, 0.3, 0.6, 0.2, 0.5, 0.05, 0.5), V('noise', 5, 0, 0.05, 0.3, 0.5, 0.2, 0.5, 0.04, 0.4)),
  hurt: () => mix(V('saw', 200, 90, 0.002, 0.15, 0, 0.05, 0.15, 0.3, 0.5)),
  eshoot: () => mix(V('sine', 1200, 300, 0.002, 0.15, 0, 0.05, 0.15, 1, 0.3)),
  shotgun: () => mix(V('noise', 7, 0, 0.001, 0.2, 0, 0.12, 0.24, 0.35, 0.9), V('sine', 110, 40, 0.001, 0.16, 0, 0.08, 0.2, 1, 0.8)),
  pain: () => mix(V('saw', 260, 140, 0.005, 0.12, 0.3, 0.08, 0.2, 0.25, 0.4)),
  fire: () => mix(V('noise', 8, 0, 0.02, 0.25, 0, 0.1, 0.3, 0.12, 0.6), V('saw', 120, 240, 0.02, 0.2, 0, 0.1, 0.3, 0.2, 0.3)),
  sight: () => delay(mix(V('saw', 90, 60, 0.05, 0.4, 0.5, 0.2, 0.6, 0.15, 0.5), V('square', 93, 58, 0.05, 0.4, 0.5, 0.2, 0.6, 0.1, 0.3)), 0.1, 0.3),
  bite: () => mix(V('noise', 9, 0, 0.002, 0.08, 0, 0.04, 0.1, 0.3, 0.7), V('square', 140, 70, 0.002, 0.08, 0, 0.04, 0.1, 0.3, 0.4)),
  step: () => mix(V('noise', 6, 0, 0.002, 0.05, 0, 0.02, 0.05, 0.06, 0.35)),
  win: () => delay(mix(...[523, 659, 784, 1047].map((f, i) => (V('square', f, 0, 0.01 + i * 0.12, 0.1, 0.6, 0.3, 0.2 + i * 0.12, 0.3, 0.2)))), 0.18, 0.4),
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
    synth(V('saw', hz(BASS[pi]![s]!), 0, 0.005, 0.08, 0.4, 0.05, step * 0.9, 0.12, 0.22), out, at)
    const ld = LEAD[pi]![s]!
    if (ld >= 0 && n >= 128) synth(V('square', hz(ld), 0, 0.01, 0.1, 0.5, 0.1, step * 1.8, 0.18, 0.09), out, at)
    const dr = DRUM[s]!
    if (dr === 1) synth(V('sine', 140, 40, 0.001, 0.12, 0, 0.02, 0.12, 1, 0.5), out, at)
    if (dr === 2) synth(V('noise', 7, 0, 0.001, 0.1, 0, 0.03, 0.1, 0.4, 0.25), out, at)
    if (dr === 3) synth(V('noise', 8, 0, 0.001, 0.02, 0, 0.01, 0.02, 0.9, 0.08), out, at)
  }
  return delay(out, step * 3, 0.25)
}

export class Audio {
  dir = join(tmpdir(), 'krieg-audio')
  enabled: boolean
  music = true
  // SFX spawn from a worker thread: posix_spawn of afplay on the render thread stalled frames in busy fights.
  private wk: Worker | null = null
  private n = 0
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
    const code = 'const{spawn}=require("node:child_process");const k=new Set;onmessage=e=>{if(!e.data){for(const c of k)c.kill();return}const c=spawn("/usr/bin/afplay",e.data,{stdio:"ignore"});k.add(c);c.on("exit",()=>{k.delete(c);postMessage(0)})}'
    this.wk = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))
    this.wk.onmessage = () => { this.n-- }
    this.wk.unref()
  }

  play(name: string, vol = 0.6) {
    if (!this.wk || !SFX[name] || this.n > 2) return
    // Each afplay launch costs ~1 core of coreaudiod/mediaremoted time, so cap the global launch rate.
    const now = performance.now()
    const big = /die|hurt|boom|key|door|pick|win|lose/.test(name)
    if (now - (this.last[name] ?? 0) < 90 || now - (this.last[''] ?? 0) < (big ? 50 : 160)) return
    this.last[name] = this.last[''] = now
    this.n++
    this.wk.postMessage(['-v', String(vol), join(this.dir, `${name}.wav`)])
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

  stop() { this.music = false; this.musicProc?.kill(); this.musicProc = null; this.wk?.postMessage(0) }
}
