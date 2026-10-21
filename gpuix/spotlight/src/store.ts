/** Persisted launcher state: usage counts (for ranking) and clipboard history. */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Usage {
  count: number
  last: number
}
export interface ClipEntry {
  text: string
  at: number
}
export interface StoreData {
  usage: Record<string, Usage>
  clipboard: ClipEntry[]
}

export const dataDir = () =>
  process.env.SPOTLIGHT_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'gpuix-spotlight')
export const cacheDir = () =>
  process.env.SPOTLIGHT_CACHE_DIR ?? join(homedir(), 'Library', 'Caches', 'gpuix-spotlight')

const MAX_CLIPS = 40

export class Store {
  data: StoreData
  private file: string
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(dir = dataDir()) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'state.json')
    this.data = { usage: {}, clipboard: [] }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoreData>
      this.data = { usage: raw.usage ?? {}, clipboard: raw.clipboard ?? [] }
    } catch {}
  }

  /** Ranking boost: frequency (log) plus a recency bonus that decays over a week. */
  boost(id: string, now = Date.now()): number {
    const u = this.data.usage[id]
    if (!u) return 0
    const days = (now - u.last) / 86_400_000
    return Math.log2(1 + u.count) * 22 + Math.max(0, 18 - days * 2.5)
  }

  recordOpen(id: string) {
    const u = this.data.usage[id] ?? { count: 0, last: 0 }
    this.data.usage[id] = { count: u.count + 1, last: Date.now() }
    this.save()
  }

  /** Returns true when the history changed. */
  pushClip(text: string): boolean {
    const t = text.replace(/\r\n/g, '\n')
    if (!t.trim() || t.length > 20_000) return false
    if (this.data.clipboard[0]?.text === t) return false
    this.data.clipboard = [{ text: t, at: Date.now() }, ...this.data.clipboard.filter((c) => c.text !== t)].slice(0, MAX_CLIPS)
    this.save()
    return true
  }

  removeClip(text: string) {
    this.data.clipboard = this.data.clipboard.filter((c) => c.text !== text)
    this.save()
  }

  clearClips() {
    this.data.clipboard = []
    this.save()
  }

  save(immediate = false) {
    if (this.timer) clearTimeout(this.timer)
    const write = () => {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 1))
      renameSync(tmp, this.file)
    }
    if (immediate) write()
    else this.timer = setTimeout(write, 150)
  }
}
