import type { udp } from 'bun'
import { DnsCache } from './cache'
import type { Matcher } from './blocklist'
import { buildBlocked, buildError, DnsError, getId, parseQuery, parseResponse, RCODE, readName, setId, summarize, type BlockMode, type Query } from './packet'
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

interface Waiter {
  query: Query
  req: Uint8Array
  host: string
  port: number
  t0: number
  allowRule?: string
}

/** One upstream lookup, shared by every client asking the same name/type/class while it is in flight. */
interface Pending {
  key: string
  query: Query
  raw: Uint8Array
  id: number
  waiters: Waiter[]
  t0: number
  sentAt: number
  upstream: number
  sentTo: Upstream[]
  sock: Sock | null
  done: boolean
}

const randomId = () => crypto.getRandomValues(new Uint16Array(1))[0]!

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
  /** Distinct upstream lookups allowed at once; more answer SERVFAIL. */
  maxInFlight = 512
  /** Clients that may wait on one in-flight lookup; more answer SERVFAIL. */
  maxWaiters = 64
  private now: () => number
  private server: Sock | null = null
  private running = false
  private pending = new Map<string, Pending>()
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
    this.running = true
    this.sweeper = setInterval(() => this.sweep(), 100)
  }

  stop() {
    if (this.sweeper) clearInterval(this.sweeper)
    this.running = false
    this.server?.close()
    this.server = null
    for (const p of this.pending.values()) this.finish(p)
    this.pending.clear()
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
    if (!this.upstreams.length || !this.running) {
      this.reply(buildError(buf, q), host, port)
      this.emit(ctx, 'failed', 'no upstream')
      return
    }
    const w: Waiter = { query: q, req: Uint8Array.from(buf), host, port, t0, allowRule: verdict.action === 'pass' && verdict.source === 'allow' ? verdict.rule : undefined }
    const inflight = this.pending.get(key)
    if (inflight) {
      if (inflight.waiters.length >= this.maxWaiters) return this.busy(w)
      inflight.waiters.push(w)
      return
    }
    if (this.pending.size >= this.maxInFlight) return this.busy(w)
    const id = randomId()
    const raw = Uint8Array.from(buf)
    setId(raw, id)
    const p: Pending = { key, query: q, raw, id, waiters: [w], t0, sentAt: t0, upstream: 0, sentTo: [], sock: null, done: false }
    this.pending.set(key, p)
    void this.open(p)
  }

  private busy(w: Waiter) {
    this.reply(buildError(w.req, w.query), w.host, w.port)
    this.emit({ query: w.query, clientHost: w.host, t0: w.t0 }, 'failed', 'busy')
  }

  /** Each lookup gets its own socket, so its source port is a fresh OS-chosen ephemeral port. */
  private async open(p: Pending) {
    let sock: Sock
    try {
      sock = await Bun.udpSocket<'buffer'>({ socket: { data: (_s, buf, port, addr) => this.onUpstream(p, new Uint8Array(buf), addr, port) } })
    } catch {
      if (!p.done) this.fail(p, 'socket error')
      return
    }
    if (p.done || !this.running) { sock.close(); return }
    p.sock = sock
    this.send(p)
  }

  private finish(p: Pending) {
    p.done = true
    if (this.pending.get(p.key) === p) this.pending.delete(p.key)
    p.sock?.close()
    p.sock = null
  }

  private fail(p: Pending, why: string) {
    this.finish(p)
    for (const w of p.waiters) {
      this.reply(buildError(w.req, w.query), w.host, w.port)
      this.emit({ query: w.query, clientHost: w.host, t0: w.t0 }, 'failed', why)
    }
  }

  private send(p: Pending) {
    if (!p.sock || !this.upstreams.length) return
    const u = this.upstreams[p.upstream % this.upstreams.length]!
    if (!p.sentTo.includes(u)) p.sentTo.push(u)
    p.sentAt = this.now()
    p.sock.send(p.raw, u.port, u.host)
  }

  /** Accepts only a response to this lookup: our ID, from an upstream we asked, echoing exactly our one question. */
  private onUpstream(p: Pending, buf: Uint8Array, host: string, port: number) {
    if (p.done || buf.length < 12) return
    if (getId(buf) !== p.id || !(buf[2]! & 0x80)) return
    const u = p.sentTo.find((x) => x.port === port && x.host === host)
    if (!u) return
    let questionEnd: number
    try {
      const res = parseResponse(buf)
      const q = res.question
      if (res.qdcount !== 1 || !q || q.name !== p.query.name || q.qtype !== p.query.qtype || q.qclass !== p.query.qclass) return
      questionEnd = readName(buf, 12).next + 4
    } catch { return }
    this.finish(p)
    if (this.cacheEnabled) this.cache.put(p.key, buf)
    for (const w of p.waiters) {
      const out = Uint8Array.from(buf)
      setId(out, w.query.id)
      if (w.query.questionEnd === questionEnd) out.set(w.req.subarray(12, questionEnd), 12)
      this.reply(out, w.host, w.port)
      this.emit({ query: w.query, clientHost: w.host, t0: w.t0 }, w.allowRule ? 'allowed' : 'forwarded', summarize(out), { upstream: u.label, ...(w.allowRule ? { rule: `allow: ${w.allowRule}` } : {}) })
    }
  }

  private sweep() {
    const t = this.now()
    for (const p of [...this.pending.values()]) {
      if (t - p.t0 >= this.timeoutMs) {
        this.fail(p, 'timeout')
      } else if (p.sock && this.upstreams.length > 1 && t - p.sentAt >= this.fallbackAfterMs && p.upstream < this.upstreams.length - 1) {
        p.upstream++
        this.send(p)
      }
    }
  }
}
