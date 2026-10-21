import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const RATE = 22050

type Wave = 'square' | 'tri' | 'sine' | 'noise' | 'saw'
interface Tone { f0: number; f1?: number; dur: number; wave: Wave; vol?: number; at?: number; decay?: number }

function synth(tones: Tone[]): Buffer {
  const total = Math.max(...tones.map((t) => (t.at ?? 0) + t.dur))
  const n = Math.ceil(total * RATE)
  const mix = new Float32Array(n)
  let seed = 12345
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1
  for (const t of tones) {
    const start = Math.floor((t.at ?? 0) * RATE)
    const len = Math.floor(t.dur * RATE)
    let phase = 0
    for (let i = 0; i < len && start + i < n; i++) {
      const k = i / len
      const f = t.f0 + ((t.f1 ?? t.f0) - t.f0) * k
      phase += f / RATE
      const p = phase % 1
      const s =
        t.wave === 'square' ? (p < 0.5 ? 1 : -1) * 0.6
        : t.wave === 'tri' ? 1 - 4 * Math.abs(p - 0.5)
        : t.wave === 'saw' ? (2 * p - 1) * 0.7
        : t.wave === 'noise' ? noise()
        : Math.sin(phase * Math.PI * 2)
      const attack = Math.min(1, i / (RATE * 0.003))
      const env = attack * Math.pow(1 - k, t.decay ?? 2)
      mix[start + i]! += s * env * (t.vol ?? 0.5)
    }
  }
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.tanh(mix[i]!) * 26000), 44 + i * 2)
  return buf
}

// C major pentatonic, climbing with the combo.
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]

const SOUNDS: Record<string, Tone[]> = {
  paddle: [{ f0: 330, f1: 300, dur: 0.07, wave: 'square', vol: 0.35 }],
  wall: [{ f0: 220, dur: 0.035, wave: 'tri', vol: 0.3 }],
  hit: [{ f0: 260, f1: 200, dur: 0.06, wave: 'square', vol: 0.3 }, { f0: 0, dur: 0.04, wave: 'noise', vol: 0.15 }],
  steel: [{ f0: 1400, f1: 1250, dur: 0.12, wave: 'tri', vol: 0.3, decay: 3 }, { f0: 2100, dur: 0.08, wave: 'sine', vol: 0.15 }],
  launch: [{ f0: 300, f1: 700, dur: 0.1, wave: 'square', vol: 0.25 }],
  laser: [{ f0: 1600, f1: 500, dur: 0.09, wave: 'saw', vol: 0.22 }],
  power: [0, 1, 2, 3].map((i) => ({ f0: [523, 659, 784, 1046][i]!, dur: 0.09, wave: 'square' as Wave, vol: 0.25, at: i * 0.055 })),
  lose: [{ f0: 400, f1: 90, dur: 0.55, wave: 'saw', vol: 0.3, decay: 1 }, { f0: 0, dur: 0.25, wave: 'noise', vol: 0.12 }],
  levelClear: [0, 1, 2, 3, 4, 5].map((i) => ({ f0: [523, 659, 784, 1046, 1318, 1568][i]!, dur: 0.16, wave: 'tri' as Wave, vol: 0.4, at: i * 0.08 })),
  gameOver: [0, 1, 2, 3].map((i) => ({ f0: [392, 330, 262, 196][i]!, dur: 0.3, wave: 'tri' as Wave, vol: 0.4, at: i * 0.22, decay: 1.2 })),
  select: [{ f0: 880, dur: 0.05, wave: 'square', vol: 0.2 }],
}
PENTA.forEach((f, i) => {
  SOUNDS[`brick${i}`] = [
    { f0: f, dur: 0.11, wave: 'square', vol: 0.28 },
    { f0: f * 2, dur: 0.07, wave: 'tri', vol: 0.12 },
    { f0: 0, dur: 0.05, wave: 'noise', vol: 0.12 },
  ]
})

export class Audio {
  muted: boolean
  private dir = join(homedir(), 'Library', 'Caches', 'neon-breakout', 'sfx-v1')
  private ready = false
  private live = 0
  private last = new Map<string, number>()

  constructor(muted: boolean) {
    this.muted = muted
  }

  private prepare() {
    if (this.ready) return
    mkdirSync(this.dir, { recursive: true })
    for (const [name, tones] of Object.entries(SOUNDS)) {
      const file = join(this.dir, `${name}.wav`)
      if (!existsSync(file)) writeFileSync(file, synth(tones))
    }
    this.ready = true
  }

  play(name: string, minGapMs = 35) {
    if (this.muted || process.platform !== 'darwin') return
    const now = performance.now()
    if (now - (this.last.get(name) ?? -1e9) < minGapMs || this.live >= 6) return
    this.last.set(name, now)
    try {
      this.prepare()
      this.live++
      const proc = Bun.spawn(['afplay', '-v', '0.6', join(this.dir, `${name}.wav`)], { stdout: 'ignore', stderr: 'ignore' })
      proc.exited.then(() => this.live--, () => this.live--)
    } catch {
      this.muted = true
    }
  }

  brick(combo: number) {
    this.play(`brick${Math.min(PENTA.length - 1, Math.max(0, combo - 1))}`, 20)
  }
}
