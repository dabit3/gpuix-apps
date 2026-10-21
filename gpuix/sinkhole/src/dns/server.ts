import type { udp } from 'bun'
import { DnsCache } from './cache'
import type { Matcher } from './blocklist'
import { buildBlocked, buildError, DnsError, getId, parseQuery, parseResponse, RCODE, setId, summarize, type BlockMode, type Query } from './packet'
import { Stats, type QueryEvent, type Status } from './stats'

type Sock = udp.Socket<'buffer'>

export interface Upstream { host: string; port: number; label: string }

export function parseUpstream(s: string): Upstream {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(s.trim())
  if (!m || !m[1]) throw new Error(`bad upstream "${s}"`)
  const port = m[2] ? Number(m[2]) : 53
  return { host: m[1], port, label: port === 53 ? m[1] : `${m[1]}:${port}` }
}

export interface SinkholeOptions {
  host?: string
  port?: number
  upstreams?: string[]
  blockMode?: BlockMode
  cacheSize?: number
  /** Give up and answer SERVFAIL after this long (ms). */
  timeoutMs?: number
  /** Re-send to the next upstream after this long (ms). */
  fallbackAfterMs?: number
  matcher: Matcher
  now?: () => number
}

interface Pending {
  query: Query
  raw: Uint8Array
  clientHost: string
  clientPort: number
  t0: number
  sentAt: number
  upstream: number
  key: string
  allowRule?: string
}

/** The ESP32 DNS sinkhole loop: parse, match, answer blocked names locally, forward the rest, cache answers. */
export class Sinkhole {
  readonly stats: Stats
  readonly cache: DnsCache
  readonly matcher: Matcher
  host: string
  port: number
  upstreams: Upstream[]
  blockMode: BlockMode
  enabled = true
  cacheEnabled = true
  pausedUntil = 0
  timeoutMs: number
  fallbackAfterMs: number
  dropped = 0
  private now: () => number
  private server: Sock | null = null
  private client: Sock | null = null
  private pending = new Map<number, Pending>()
  private sweeper: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<(e: QueryEvent) => void>()
  private seq = 0

  constructor(o: SinkholeOptions) {
    this.matcher = o.matcher
    this.host = o.host ?? '127.0.0.1'
    this.port = o.port ?? 5300
    this.upstreams = (o.upstreams ?? ['1.1.1.1', '9.9.9.9']).map(parseUpstream)
    this.blockMode = o.blockMode ?? 'null'
    this.timeoutMs = o.timeoutMs ?? 2000
    this.fallbackAfterMs = o.fallbackAfterMs ?? 800
    this.now = o.now ?? Date.now
    this.stats = new Stats(this.now)
    this.cache = new DnsCache(o.cacheSize ?? 256, this.now)
  }

  get blocking() { return this.enabled && this.now() >= this.pausedUntil }
  get pausedFor() { return Math.max(0, this.pausedUntil - this.now()) }
  get inFlight() { return this.pending.size }

  pause(minutes: number) { this.pausedUntil = minutes > 0 ? this.now() + minutes * 60_000 : 0 }
  setUpstreams(list: string[]) { this.upstreams = list.map(parseUpstream) }
  onQuery(fn: (e: QueryEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }

  async start() {
    try {
      this.server = await Bun.udpSocket<'buffer'>({
        hostname: this.host,
        port: this.port,
        socket: { data: (_s, buf, port, addr) => this.onClient(new Uint8Array(buf), addr, port) },
      })
    } catch (err) {
      const msg = String((err as Error)?.message ?? err)
      throw new Error(/in use|EADDRINUSE/i.test(msg) ? `port ${this.port} on ${this.host} is already in use` : msg)
    }
    this.port = this.server!.port
    this.client = await Bun.udpSocket<'buffer'>({ socket: { data: (_s, buf, port, addr) => this.onUpstream(new Uint8Array(buf), addr, port) } })
    this.sweeper = setInterval(() => this.sweep(), 100)
  }

  stop() {
    if (this.sweeper) clearInterval(this.sweeper)
    this.server?.close()
    this.client?.close()
    this.server = this.client = null
  }

  private emit(p: { query: Query; clientHost: string; t0: number }, status: Status, answer: string, extra: Partial<QueryEvent> = {}) {
    const e: QueryEvent = { seq: ++this.seq, ts: this.now(), client: p.clientHost, name: p.query.name || '.', qtype: p.query.qtype, status, ms: Math.max(0, this.now() - p.t0), answer, ...extra }
    this.stats.record(e)
    for (const fn of this.listeners) fn(e)
  }

  private reply(buf: Uint8Array, host: string, port: number) { this.server?.send(buf, port, host) }

  /** Exposed for tests: handle one datagram from a client. */
  onClient(buf: Uint8Array, host: string, port: number) {
    const t0 = this.now()
    let q: Query
    try { q = parseQuery(buf) } catch (err) {
      if (err instanceof DnsError && buf.length >= 12) {
        const id = getId(buf)
        this.reply(Uint8Array.from([id >> 8, id & 0xff, 0x80, RCODE.FORMERR, 0, 0, 0, 0, 0, 0, 0, 0]), host, port)
      }
      this.dropped++
      return
    }
    const ctx = { query: q, clientHost: host, t0 }
    const verdict = this.matcher.check(q.name)
    if (verdict.action === 'block' && this.blocking) {
      const res = buildBlocked(buf, q, this.blockMode)
      this.reply(res, host, port)
      this.emit(ctx, 'blocked', summarize(res), { rule: `${verdict.source === 'deny' ? 'deny' : 'list'}: ${verdict.rule}` })
      return
    }
    const key = DnsCache.key(q.name, q.qtype, q.qclass)
    if (this.cacheEnabled) {
      const hit = this.cache.get(key, q.id)
      if (hit) {
        this.reply(hit, host, port)
        this.emit(ctx, 'cached', summarize(hit))
        return
      }
    }
    if (!this.upstreams.length || !this.client) {
      this.reply(buildError(buf, q), host, port)
      this.emit(ctx, 'failed', 'no upstream')
      return
    }
    let id = 0
    for (let tries = 0; tries < 64; tries++) {
      id = (Math.random() * 0x10000) | 0
      if (!this.pending.has(id)) break
    }
    const raw = Uint8Array.from(buf)
    setId(raw, id)
    const p: Pending = { query: q, raw, clientHost: host, clientPort: port, t0, sentAt: t0, upstream: 0, key, allowRule: verdict.action === 'pass' && verdict.source === 'allow' ? verdict.rule : undefined }
    this.pending.set(id, p)
    this.send(p)
  }

  private send(p: Pending) {
    const u = this.upstreams[p.upstream % this.upstreams.length]!
    p.sentAt = this.now()
    this.client?.send(p.raw, u.port, u.host)
  }

  private onUpstream(buf: Uint8Array, host: string, port: number) {
    if (buf.length < 12) return
    const id = getId(buf)
    const p = this.pending.get(id)
    if (!p) return
    if (!this.upstreams.some((u) => u.port === port && u.host === host)) return
    try {
      const res = parseResponse(buf)
      if (res.question && res.question.name !== p.query.name) return
    } catch { return }
    this.pending.delete(id)
    const out = Uint8Array.from(buf)
    setId(out, p.query.id)
    this.reply(out, p.clientHost, p.clientPort)
    if (this.cacheEnabled) this.cache.put(p.key, out)
    const u = this.upstreams[p.upstream % this.upstreams.length]!
    this.emit(p, p.allowRule ? 'allowed' : 'forwarded', summarize(out), { upstream: u.label, ...(p.allowRule ? { rule: `allow: ${p.allowRule}` } : {}) })
  }

  private sweep() {
    const t = this.now()
    for (const [id, p] of this.pending) {
      if (t - p.t0 >= this.timeoutMs) {
        this.pending.delete(id)
        this.reply(buildError(p.raw, { ...p.query }), p.clientHost, p.clientPort)
        this.emit(p, 'failed', 'timeout')
      } else if (this.upstreams.length > 1 && t - p.sentAt >= this.fallbackAfterMs && p.upstream < this.upstreams.length - 1) {
        p.upstream++
        this.send(p)
      }
    }
  }
}
