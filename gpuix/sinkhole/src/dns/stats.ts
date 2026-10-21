export type Status = 'blocked' | 'cached' | 'forwarded' | 'allowed' | 'failed'

export interface QueryEvent {
  seq: number
  ts: number
  client: string
  name: string
  qtype: number
  status: Status
  ms: number
  answer: string
  rule?: string
  upstream?: string
}

export interface Bucket { t: number; total: number; blocked: number; cached: number }

const SPARK_SECONDS = 120
const RECENT = 200
const MAX_DOMAINS = 20_000

/** Everything the dashboard shows: counters, per-second buckets, top domains/clients, and a 200-entry query ring. */
export class Stats {
  total = 0
  blocked = 0
  cached = 0
  forwarded = 0
  failed = 0
  version = 0
  startedAt: number
  recent: QueryEvent[] = []
  private buckets: Bucket[] = []
  private domains = new Map<string, { n: number; blocked: number }>()
  private clients = new Map<string, number>()
  private latencies: number[] = []
  constructor(private now: () => number = Date.now) { this.startedAt = now() }

  record(e: QueryEvent) {
    this.total++
    if (e.status === 'blocked') this.blocked++
    else if (e.status === 'cached') this.cached++
    else if (e.status === 'failed') this.failed++
    else this.forwarded++
    if (e.status === 'forwarded' || e.status === 'allowed') {
      this.latencies.push(e.ms)
      if (this.latencies.length > 512) this.latencies.splice(0, this.latencies.length - 512)
    }
    const sec = Math.floor(e.ts / 1000)
    let b = this.buckets[this.buckets.length - 1]
    if (!b || b.t !== sec) {
      b = { t: sec, total: 0, blocked: 0, cached: 0 }
      this.buckets.push(b)
      if (this.buckets.length > SPARK_SECONDS * 2) this.buckets.splice(0, this.buckets.length - SPARK_SECONDS)
    }
    b.total++
    if (e.status === 'blocked') b.blocked++
    if (e.status === 'cached') b.cached++
    const d = this.domains.get(e.name) ?? { n: 0, blocked: 0 }
    d.n++
    if (e.status === 'blocked') d.blocked++
    this.domains.set(e.name, d)
    if (this.domains.size > MAX_DOMAINS) for (const [k, v] of this.domains) if (v.n <= 1) this.domains.delete(k)
    this.clients.set(e.client, (this.clients.get(e.client) ?? 0) + 1)
    this.recent.unshift(e)
    if (this.recent.length > RECENT) this.recent.length = RECENT
    this.version++
  }

  get blockedPct() { return this.total ? (this.blocked / this.total) * 100 : 0 }

  /** Last `seconds` one-second buckets, oldest first, zero-filled. */
  series(seconds = SPARK_SECONDS): Bucket[] {
    const end = Math.floor(this.now() / 1000)
    const byT = new Map(this.buckets.map((b) => [b.t, b]))
    const out: Bucket[] = []
    for (let t = end - seconds + 1; t <= end; t++) out.push(byT.get(t) ?? { t, total: 0, blocked: 0, cached: 0 })
    return out
  }

  /** Queries over the last `window` seconds, excluding the current partial second when it is empty. */
  qps(window = 5): number {
    const s = this.series(window + 1).slice(0, window)
    return s.reduce((a, b) => a + b.total, 0) / window
  }

  latency(): { p50: number; p95: number } {
    if (!this.latencies.length) return { p50: 0, p95: 0 }
    const s = [...this.latencies].sort((a, b) => a - b)
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!
    return { p50: at(0.5), p95: at(0.95) }
  }

  top(kind: 'blocked' | 'allowed', n = 8): { name: string; count: number }[] {
    const rows: { name: string; count: number }[] = []
    for (const [name, v] of this.domains) {
      const count = kind === 'blocked' ? v.blocked : v.n - v.blocked
      if (count > 0) rows.push({ name, count })
    }
    return rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, n)
  }

  topClients(n = 5) {
    return [...this.clients].map(([client, count]) => ({ client, count })).sort((a, b) => b.count - a.count).slice(0, n)
  }

  reset() {
    this.total = this.blocked = this.cached = this.forwarded = this.failed = 0
    this.recent = []
    this.buckets = []
    this.domains.clear()
    this.clients.clear()
    this.latencies = []
    this.startedAt = this.now()
    this.version++
  }
}
