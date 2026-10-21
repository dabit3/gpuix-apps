/**
 * Columnar log store built for millions of lines.
 *
 * Text lives in large chunk strings (one string per ~16k lines) so a search is
 * one native regex scan per chunk, not millions of small string visits. Per-line
 * metadata lives in typed arrays: 22 bytes per line.
 */

export const LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const
export type Level = (typeof LEVELS)[number]
export const LEVEL_INDEX: Record<string, number> = Object.fromEntries(LEVELS.map((l, i) => [l, i]))
export const ALL_LEVELS = (1 << LEVELS.length) - 1

export const CHUNK_LINES = 16_384
export const DEFAULT_CAPACITY = 1 << 16

export class LogStore {
  count = 0
  capacity = DEFAULT_CAPACITY
  ts = new Float64Array(this.capacity)
  level = new Uint8Array(this.capacity)
  svc = new Uint8Array(this.capacity)
  start = new Uint32Array(this.capacity)
  end = new Uint32Array(this.capacity)
  chunkOf = new Uint32Array(this.capacity)

  /** Sealed chunk strings. The open chunk is `open`, joined on seal. */
  chunks: string[] = []
  chunkFirst: number[] = []
  open: string[] = []
  openLen = 0
  openBase = 0

  services: string[] = []
  serviceIndex = new Map<string, number>()
  levelCounts = new Float64Array(LEVELS.length)
  serviceCounts: number[] = []
  textBytes = 0
  version = 0

  constructor(public maxLines = 6_000_000) {}

  serviceId(name: string): number {
    let id = this.serviceIndex.get(name)
    if (id === undefined) {
      id = this.services.length
      if (id > 255) id = 255
      else {
        this.services.push(name)
        this.serviceIndex.set(name, id)
        this.serviceCounts.push(0)
      }
    }
    return id
  }

  private grow(min: number) {
    let cap = this.capacity
    while (cap < min) cap *= 2
    const g = <T extends Float64Array | Uint8Array | Uint32Array>(a: T): T => {
      const n = new (a.constructor as new (n: number) => T)(cap)
      n.set(a)
      return n
    }
    this.ts = g(this.ts)
    this.level = g(this.level)
    this.svc = g(this.svc)
    this.start = g(this.start)
    this.end = g(this.end)
    this.chunkOf = g(this.chunkOf)
    this.capacity = cap
  }

  get full() {
    return this.count >= this.maxLines
  }

  /** Append one line with already-known metadata (the generator path). */
  push(line: string, ts: number, level: number, svc: number) {
    const i = this.count
    if (i >= this.capacity) this.grow(i + 1)
    this.ts[i] = ts
    this.level[i] = level
    this.svc[i] = svc
    this.start[i] = this.openLen
    this.openLen += line.length
    this.end[i] = this.openLen
    this.openLen += 1
    this.chunkOf[i] = this.chunks.length
    this.open.push(line)
    this.levelCounts[level]!++
    this.serviceCounts[svc]!++
    this.textBytes += line.length + 1
    this.count = i + 1
    if (this.open.length >= CHUNK_LINES) this.seal()
  }

  /** Join the open chunk into one flat string. */
  seal() {
    if (this.open.length === 0) return
    this.chunks.push(this.open.join('\n'))
    this.chunkFirst.push(this.openBase)
    this.open = []
    this.openLen = 0
    this.openBase = this.count
  }

  /**
   * Append a pre-built chunk (the file path): `text` holds lines `[0, n)` with
   * starts/ends relative to it.
   */
  pushChunk(text: string, starts: ArrayLike<number>, ends: ArrayLike<number>, ts: ArrayLike<number>, levels: ArrayLike<number>, svcs: ArrayLike<number>, n: number) {
    this.seal()
    const base = this.count
    if (base + n > this.capacity) this.grow(base + n)
    const chunk = this.chunks.length
    for (let k = 0; k < n; k++) {
      const i = base + k
      this.start[i] = starts[k]!
      this.end[i] = ends[k]!
      this.ts[i] = ts[k]!
      this.level[i] = levels[k]!
      this.svc[i] = svcs[k]!
      this.chunkOf[i] = chunk
      this.levelCounts[levels[k]!]!++
      this.serviceCounts[svcs[k]!]!++
    }
    this.chunks.push(text)
    this.chunkFirst.push(base)
    this.textBytes += text.length
    this.count = base + n
    this.openBase = this.count
  }

  line(i: number): string {
    const c = this.chunkOf[i]!
    if (c >= this.chunks.length) return this.open[i - this.openBase]!
    return this.chunks[c]!.slice(this.start[i]!, this.end[i]!)
  }

  /** First line whose timestamp is >= t. Lines are assumed time ordered. */
  lowerBoundTime(t: number): number {
    let lo = 0
    let hi = this.count
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.ts[mid]! < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  clear() {
    this.count = 0
    this.chunks = []
    this.chunkFirst = []
    this.open = []
    this.openLen = 0
    this.openBase = 0
    this.services = []
    this.serviceIndex.clear()
    this.levelCounts.fill(0)
    this.serviceCounts = []
    this.textBytes = 0
    this.capacity = DEFAULT_CAPACITY
    this.ts = new Float64Array(this.capacity)
    this.level = new Uint8Array(this.capacity)
    this.svc = new Uint8Array(this.capacity)
    this.start = new Uint32Array(this.capacity)
    this.end = new Uint32Array(this.capacity)
    this.chunkOf = new Uint32Array(this.capacity)
    this.version++
  }
}

/** Growable Uint32 list. */
export class U32List {
  data: Uint32Array
  length = 0
  constructor(cap = 1024) {
    this.data = new Uint32Array(cap)
  }
  push(v: number) {
    if (this.length === this.data.length) {
      const n = new Uint32Array(this.data.length * 2)
      n.set(this.data)
      this.data = n
    }
    this.data[this.length++] = v
  }
  clear() {
    this.length = 0
  }
  /** First position whose value is >= v (list is sorted ascending). */
  lowerBound(v: number): number {
    let lo = 0
    let hi = this.length
    const d = this.data
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (d[mid]! < v) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
