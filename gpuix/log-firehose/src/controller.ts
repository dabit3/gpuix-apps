/**
 * App state outside React: the store, generator, search job, filter view,
 * per-second histogram and rate meter. React reads it through `version`.
 */
import { CHUNK_LINES, LEVELS, LogStore } from './store'
import { LogGenerator, SERVICES } from './generator'
import { compileSearch, SearchJob, type SearchSpec } from './search'
import { FilterView } from './view'
import { parseMeta } from './parse'

export type Source = { kind: 'live' } | { kind: 'file'; name: string; path: string; bytes: number }

export const RATES = [1_000, 10_000, 50_000, 100_000] as const

export class Histogram {
  firstSec = -1
  /** counts per second: [info-and-below, warn, error+] */
  bins: [number[], number[], number[]] = [[], [], []]
  add(ts: number, level: number) {
    const sec = Math.floor(ts / 1000)
    if (this.firstSec < 0) this.firstSec = sec
    let k = sec - this.firstSec
    if (k < 0) k = 0
    if (k > 5_000_000) return
    const g = level >= 4 ? 2 : level === 3 ? 1 : 0
    const b = this.bins
    while (b[0].length <= k) {
      b[0].push(0)
      b[1].push(0)
      b[2].push(0)
    }
    b[g][k]!++
  }
  get seconds() {
    return this.bins[0].length
  }
  clear() {
    this.firstSec = -1
    this.bins = [[], [], []]
  }
}

export class Controller {
  store = new LogStore()
  gen = new LogGenerator()
  view = new FilterView(this.store)
  hist = new Histogram()
  job: SearchJob | null = null
  spec: SearchSpec = { query: '', regex: false, caseSensitive: false }
  searchError: string | null = null
  source: Source = { kind: 'live' }
  rate: number = 10_000
  running = false
  loading: { name: string; progress: number } | null = null
  version = 0
  /** bumped whenever the view is rebuilt (filters/search mode), not on append */
  viewGeneration = 0
  ingestRate = 0
  private rateSamples: Array<[number, number]> = []
  private carry = 0
  private lastTick = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<() => void>()
  private dirty = false
  /** time spent in ingest + search per second, for the perf readout */
  busyMs = 0

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() {
    this.version++
    this.dirty = false
    for (const fn of this.listeners) fn()
  }
  markDirty() {
    this.dirty = true
  }
  /** Notify React now (tests and one-off actions). */
  flushNow() {
    this.emit()
  }

  /** Start the 8 ms ingest loop and the 16 ms UI notifier. */
  start() {
    if (this.timer) return
    this.lastTick = performance.now()
    let lastEmit = 0
    this.timer = setInterval(() => {
      const now = performance.now()
      this.tick(now)
      if (this.dirty && now - lastEmit >= 15) {
        lastEmit = now
        this.emit()
      }
    }, 8)
  }
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  tick(now: number) {
    const t0 = performance.now()
    const dt = Math.min(100, now - this.lastTick)
    this.lastTick = now
    if (this.running && this.source.kind === 'live' && !this.store.full) {
      const owed = (this.rate * dt) / 1000 + this.carry
      const n = Math.floor(owed)
      this.carry = owed - n
      if (n > 0) this.ingestLive(n, Date.now())
    } else if (this.running && this.store.full) {
      this.running = false
      this.markDirty()
    }
    if (this.job && !this.job.done) {
      const found = this.job.step(this.loading ? 2 : 6, (line) => this.view.onMatch(line))
      if (found > 0 || this.job.done) this.markDirty()
      this.markDirty()
    }
    this.sampleRate(now)
    this.busyMs = this.busyMs * 0.98 + (performance.now() - t0) * 0.02
  }

  private sampleRate(now: number) {
    const s = this.rateSamples
    s.push([now, this.store.count])
    while (s.length > 2 && now - s[0]![0] > 1000) s.shift()
    const [t, c] = s[0]!
    const r = now - t > 200 ? ((this.store.count - c) * 1000) / (now - t) : this.ingestRate
    if (Math.abs(r - this.ingestRate) > 0.5) {
      this.ingestRate = r
      this.markDirty()
    }
  }

  private lastLiveTs = 0
  /** Append `n` generated lines ending at wall-clock `nowMs`. */
  ingestLive(n: number, nowMs: number) {
    const from = this.store.count
    const t0 = Math.max(this.lastLiveTs, nowMs - 50)
    this.gen.fill(this.store, n, t0, nowMs)
    this.lastLiveTs = nowMs
    this.afterAppend(from)
  }

  private afterAppend(from: number) {
    const s = this.store
    const to = s.count
    for (let i = from; i < to; i++) this.hist.add(s.ts[i]!, s.level[i]!)
    this.view.onIngest(from, to)
    if (this.job && this.job.done) this.job.step(4, (line) => this.view.onMatch(line))
    this.markDirty()
  }

  setRunning(on: boolean) {
    if (on && this.source.kind !== 'live') this.useLive()
    this.running = on
    this.carry = 0
    this.markDirty()
  }
  setRate(rate: number) {
    this.rate = rate
    this.markDirty()
  }

  useLive() {
    if (this.source.kind === 'live') return
    this.reset({ kind: 'live' })
  }

  private reset(source: Source) {
    this.store.clear()
    this.hist.clear()
    this.source = source
    this.lastLiveTs = 0
    this.restartSearch()
  }

  // ---- filters -------------------------------------------------------------
  toggleLevel(level: number, solo = false) {
    const v = this.view
    v.levelMask = solo ? 1 << level : v.levelMask ^ (1 << level)
    this.rebuildView()
  }
  toggleService(id: number, solo = false) {
    const off = this.view.serviceOff
    if (solo) {
      const already = off[id] === 0 && this.store.services.every((_, k) => k === id || off[k] === 1)
      off.fill(already ? 0 : 1)
      off[id] = 0
    } else off[id] = off[id] ? 0 : 1
    this.rebuildView()
  }
  resetFilters() {
    this.view.levelMask = (1 << LEVELS.length) - 1
    this.view.serviceOff.fill(0)
    this.rebuildView()
  }
  setOnlyMatches(on: boolean) {
    this.view.onlyMatches = on
    this.rebuildView()
  }
  rebuildView() {
    this.view.rebuild(this.job)
    this.viewGeneration++
    this.markDirty()
  }

  // ---- search --------------------------------------------------------------
  setSearch(spec: SearchSpec) {
    this.spec = spec
    this.restartSearch()
  }
  private restartSearch() {
    const re = compileSearch(this.spec)
    this.searchError = typeof re === 'string' ? re : null
    this.job = re instanceof RegExp ? new SearchJob(this.store, re) : null
    if (this.job) this.job.step(12, () => {})
    this.rebuildView()
  }
  get regex(): RegExp | null {
    return this.job?.re ?? null
  }

  /** Next matching line after `fromLine` (inclusive=false) that is visible in the view. */
  findMatch(fromLine: number, dir: 1 | -1): number {
    const job = this.job
    if (!job || job.matches.length === 0) return -1
    const m = job.matches
    let k = dir > 0 ? m.lowerBound(fromLine + 1) : m.lowerBound(fromLine) - 1
    const total = m.length
    for (let tries = 0; tries < total; tries++) {
      if (k >= total) k = 0
      if (k < 0) k = total - 1
      const line = m.data[k]!
      if (this.view.passes(line)) return line
      k += dir
    }
    return -1
  }
  /** 0-based rank of `line` among visible matches. */
  matchRank(line: number): number {
    const job = this.job
    if (!job) return -1
    const m = job.matches
    const k = m.lowerBound(line)
    if (k >= m.length || m.data[k] !== line) return -1
    if (!this.view.active || this.view.onlyMatches) return this.view.onlyMatches ? this.view.posOf(line) : k
    let r = 0
    for (let j = 0; j < k; j++) if (this.view.passes(m.data[j]!)) r++
    return r
  }

  // ---- time ----------------------------------------------------------------
  /** First line at or after `msOfDay` on the day of the first line. */
  lineAtClock(msOfDay: number): number {
    const s = this.store
    if (s.count === 0) return -1
    const first = s.ts[0]!
    const day = first - (first % 86_400_000)
    let t = day + msOfDay
    if (t < first - 43_200_000) t += 86_400_000
    return Math.min(s.count - 1, s.lowerBoundTime(t))
  }
  lineAtSecond(sec: number): number {
    if (this.store.count === 0) return -1
    return Math.min(this.store.count - 1, this.store.lowerBoundTime(sec * 1000))
  }

  // ---- files ---------------------------------------------------------------
  async loadFile(path: string, opts: { yieldEvery?: number } = {}) {
    const name = path.split('/').pop() ?? path
    this.running = false
    const file = Bun.file(path)
    const bytes = file.size
    this.loading = { name, progress: 0 }
    this.reset({ kind: 'file', name, path, bytes })
    this.emit()
    const text = await file.text()
    const s = this.store
    const starts = new Uint32Array(CHUNK_LINES)
    const ends = new Uint32Array(CHUNK_LINES)
    const ts = new Float64Array(CHUNK_LINES)
    const levels = new Uint8Array(CHUNK_LINES)
    const svcs = new Uint8Array(CHUNK_LINES)
    let pos = 0
    let lastTs = Date.now()
    const t0 = performance.now()
    let chunks = 0
    while (pos < text.length) {
      const chunkStart = pos
      let n = 0
      while (n < CHUNK_LINES && pos < text.length) {
        let nl = text.indexOf('\n', pos)
        if (nl < 0) nl = text.length
        let e = nl
        if (e > pos && text.charCodeAt(e - 1) === 13) e--
        const line = text.slice(pos, e)
        const [t, lv, svc] = parseMeta(line, lastTs)
        lastTs = t
        starts[n] = pos - chunkStart
        ends[n] = e - chunkStart
        ts[n] = t
        levels[n] = lv
        svcs[n] = s.serviceId(svc)
        n++
        pos = nl + 1
      }
      const chunkText = text.slice(chunkStart, Math.min(pos, text.length))
      const from = s.count
      s.pushChunk(chunkText, starts, ends, ts, levels, svcs, n)
      for (let i = from; i < s.count; i++) this.hist.add(s.ts[i]!, s.level[i]!)
      this.view.onIngest(from, s.count)
      this.loading.progress = pos / text.length
      this.markDirty()
      if (++chunks % (opts.yieldEvery ?? 2) === 0) {
        await new Promise((r) => setTimeout(r, 0))
        if (this.source.kind !== 'file' || this.source.path !== path) return
      }
    }
    this.loading = null
    this.loadMs = performance.now() - t0
    this.markDirty()
  }
  loadMs = 0

  /** Services in display order (generator order first). */
  serviceOrder(): number[] {
    const s = this.store
    const ids = s.services.map((_, i) => i)
    const pref = new Map<string, number>(SERVICES.map((n, i) => [n, i]))
    return ids.sort((a, b) => (pref.get(s.services[a]!) ?? 99) - (pref.get(s.services[b]!) ?? 99) || s.services[a]!.localeCompare(s.services[b]!))
  }
}
