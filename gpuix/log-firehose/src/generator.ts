/**
 * Realistic structured log generator: ten services, correlated request ids,
 * log-normal latencies, JSON payloads, stack traces and periodic incidents.
 * Deterministic for a given seed.
 */
import type { LogStore } from './store'

export const SERVICES = [
  'api-gateway', 'auth', 'orders', 'payments', 'inventory',
  'search', 'notifications', 'billing-worker', 'postgres-proxy', 'redis-cache',
] as const

const LEVEL_NAMES = ['TRACE', 'DEBUG', 'INFO ', 'WARN ', 'ERROR', 'FATAL']

export class Rng {
  constructor(private s: number) {}
  next() {
    // mulberry32
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(n: number) {
    return Math.floor(this.next() * n)
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length)]!
  }
  hex(n: number) {
    let s = ''
    for (let i = 0; i < n; i++) s += HEX[this.int(16)]
    return s
  }
  /** log-normal around `median` ms */
  latency(median: number, spread = 0.6) {
    const u = Math.max(1e-9, this.next())
    const v = this.next()
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    return Math.max(1, Math.round(median * Math.exp(z * spread)))
  }
}
const HEX = '0123456789abcdef'

const ROUTES = [
  ['GET', '/v1/orders/:id'], ['POST', '/v1/orders'], ['GET', '/v1/products'], ['GET', '/v1/search'],
  ['POST', '/v1/payments/charge'], ['GET', '/v1/users/me'], ['PATCH', '/v1/cart/items'], ['POST', '/v1/auth/token'],
  ['GET', '/v1/inventory/:sku'], ['DELETE', '/v1/cart/items/:id'], ['GET', '/healthz'],
] as const
const QUERIES = ['wireless headphones', 'running shoes', 'espresso machine', 'usb-c hub', 'standing desk', 'merino socks', 'mechanical keyboard', 'air purifier', 'trail backpack', 'cast iron pan']
const SKUS = ['SKU-48213', 'SKU-10442', 'SKU-77310', 'SKU-29981', 'SKU-66120', 'SKU-31877', 'SKU-90215']
const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-2']
const PODS = ['7f9c4', 'b21de', '4c8a1', 'e03f7', '9d2b6']
const AGENTS = ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1.15', 'okhttp/4.12.0', 'Firehose-iOS/5.2.1', 'python-requests/2.32.3', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0']
const DECLINES = ['insufficient_funds', 'card_declined', 'expired_card', 'incorrect_cvc', 'do_not_honor']
const SQL = [
  'SELECT o.id, o.total_cents FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 50',
  'UPDATE inventory SET reserved = reserved + $1 WHERE sku = $2 AND available >= $1',
  'SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > now()',
  'INSERT INTO invoices (account_id, period, amount_cents) VALUES ($1, $2, $3) RETURNING id',
]

function stack(service: string, err: string, rng: Rng) {
  const file = service.replace(/-/g, '_')
  const frames = [
    `${err}`,
    `    at ${pickFn(rng)} (/srv/${service}/src/${file}.ts:${20 + rng.int(300)}:${3 + rng.int(40)})`,
    `    at processTicksAndRejections (node:internal/process/task_queues:95:5)`,
    `    at async Router.handle (/srv/${service}/node_modules/@firehose/http/dist/router.js:${100 + rng.int(200)}:17)`,
    `    at async withSpan (/srv/${service}/src/telemetry.ts:${40 + rng.int(60)}:12)`,
  ]
  return frames.join('\n')
}
function pickFn(rng: Rng) {
  return rng.pick(['chargeCard', 'reserveStock', 'verifyToken', 'loadOrder', 'renderInvoice', 'publishEvent', 'acquireConnection', 'fetchProfile'])
}

export interface GenLine {
  text: string
  level: number
  service: number
}

export class LogGenerator {
  rng: Rng
  private activeReqs: string[] = []
  private isoCacheMs = -1
  private isoCache = ''
  /** Incident window: [service, endTs]. */
  incident: { service: number; until: number } | null = null
  private nextIncidentAt = 0

  constructor(seed = 1337) {
    this.rng = new Rng(seed)
  }

  private iso(ts: number) {
    if (ts !== this.isoCacheMs) {
      this.isoCacheMs = ts
      this.isoCache = new Date(ts).toISOString()
    }
    return this.isoCache
  }

  private reqId() {
    const r = this.rng
    if (this.activeReqs.length > 0 && r.next() < 0.62) return this.activeReqs[r.int(this.activeReqs.length)]!
    const id = r.hex(8)
    this.activeReqs.push(id)
    if (this.activeReqs.length > 48) this.activeReqs.splice(r.int(48), 1)
    return id
  }

  private level(service: number, ts: number): number {
    const r = this.rng.next()
    const inc = this.incident && this.incident.service === service && ts < this.incident.until
    if (inc) return r < 0.5 ? 4 : r < 0.53 ? 5 : r < 0.75 ? 3 : 2
    if (r < 0.0004) return 5
    if (r < 0.022) return 4
    if (r < 0.085) return 3
    if (r < 0.62) return 2
    if (r < 0.93) return 1
    return 0
  }

  /** One line at `ts`. */
  line(ts: number): GenLine {
    const r = this.rng
    if (ts >= this.nextIncidentAt) {
      if (this.nextIncidentAt > 0) this.incident = { service: r.pick([3, 8, 1, 4]), until: ts + 3000 + r.int(4000) }
      this.nextIncidentAt = ts + 14_000 + r.int(18_000)
    }
    let service = r.int(SERVICES.length)
    if (this.incident && ts < this.incident.until && r.next() < 0.25) service = this.incident.service
    const level = this.level(service, ts)
    const name = SERVICES[service]!
    const req = this.reqId()
    const [msg, payload] = this.message(service, level, req)
    const text = `${this.iso(ts)} ${LEVEL_NAMES[level]} ${name} req=${req} ${msg} ${JSON.stringify(payload)}`
    return { text, level, service }
  }

  private message(service: number, level: number, req: string): [string, Record<string, unknown>] {
    const r = this.rng
    const base = { trace_id: r.hex(16), region: r.pick(REGIONS), pod: `${SERVICES[service]}-${r.pick(PODS)}` }
    switch (service) {
      case 0: {
        const [method, route] = r.pick(ROUTES)
        const path = route.replace(':id', String(10000 + r.int(90000))).replace(':sku', r.pick(SKUS))
        const ms = r.latency(level >= 3 ? 900 : 38)
        const status = level >= 4 ? r.pick([500, 502, 503, 504]) : level === 3 ? r.pick([429, 404, 409, 401]) : r.pick([200, 200, 200, 201, 204, 304])
        return [`${method} ${path} ${status} ${ms}ms`, { ...base, method, path, status, latency_ms: ms, bytes: 200 + r.int(48000), ip: `10.${r.int(255)}.${r.int(255)}.${r.int(255)}`, user_agent: r.pick(AGENTS) }]
      }
      case 1: {
        const user = `u_${100000 + r.int(900000)}`
        if (level >= 4) return [`JWT verification failed for ${user}`, { ...base, user_id: user, error: { type: 'JsonWebTokenError', message: 'invalid signature', stack: stack('auth', 'JsonWebTokenError: invalid signature', r) } }]
        if (level === 3) return [`Login failed for ${user}: invalid password (attempt ${1 + r.int(5)})`, { ...base, user_id: user, mfa: r.next() < 0.4 }]
        return [r.next() < 0.5 ? `Access token refreshed for ${user}` : `Session validated for ${user}`, { ...base, user_id: user, scopes: ['orders:read', 'cart:write'], ttl_s: 3600 }]
      }
      case 2: {
        const order = `ord_${r.hex(10)}`
        const total = 499 + r.int(40000)
        if (level >= 4) return [`Failed to persist order ${order}: deadlock detected`, { ...base, order_id: order, error: { type: 'PostgresError', code: '40P01', stack: stack('orders', 'PostgresError: deadlock detected', r) } }]
        if (level === 3) return [`Order ${order} retried after optimistic lock conflict`, { ...base, order_id: order, attempt: 2 }]
        return [r.next() < 0.5 ? `Order ${order} created total=$${(total / 100).toFixed(2)}` : `Order ${order} transitioned pending -> paid`, { ...base, order_id: order, total_cents: total, currency: 'usd', items: 1 + r.int(6) }]
      }
      case 3: {
        const amount = 199 + r.int(60000)
        const ch = `ch_${r.hex(14)}`
        if (level >= 4) return [`Stripe webhook timed out after 30000ms for ${ch}`, { ...base, charge_id: ch, amount_cents: amount, provider: 'stripe', error: { type: 'TimeoutError', message: 'upstream request timed out', stack: stack('payments', 'TimeoutError: upstream request timed out', r) } }]
        if (level === 3) {
          const reason = r.pick(DECLINES)
          return [`Charge declined: ${reason}`, { ...base, charge_id: ch, amount_cents: amount, decline_code: reason }]
        }
        return [`Charge ${ch} authorized amount=$${(amount / 100).toFixed(2)}`, { ...base, charge_id: ch, amount_cents: amount, currency: 'usd', three_ds: r.next() < 0.2 }]
      }
      case 4: {
        const sku = r.pick(SKUS)
        const units = 1 + r.int(5)
        if (level >= 4) return [`Reservation failed for ${sku}: stock ledger out of sync`, { ...base, sku, units, error: { type: 'InvariantError', stack: stack('inventory', 'InvariantError: ledger mismatch', r) } }]
        if (level === 3) return [`Low stock for ${sku}: ${r.int(9)} units left`, { ...base, sku, threshold: 10 }]
        return [`Reserved ${units} units of ${sku}`, { ...base, sku, units, warehouse: r.pick(['SFO-2', 'EWR-1', 'DUB-1']) }]
      }
      case 5: {
        const q = r.pick(QUERIES)
        const ms = r.latency(level >= 3 ? 700 : 24)
        return [`Query "${q}" returned ${r.int(4000)} hits in ${ms}ms`, { ...base, query: q, took_ms: ms, shard_count: 12, cache: r.next() < 0.35 ? 'hit' : 'miss' }]
      }
      case 6: {
        const ch = r.pick(['email', 'push', 'sms'])
        if (level >= 3) return [`Delivery deferred for ${ch}: SMTP 421 try again later`, { ...base, channel: ch, retry_in_s: 30 * (1 + r.int(4)) }]
        return [`Queued ${ch} notification template=${r.pick(['order_confirmation', 'password_reset', 'shipping_update'])}`, { ...base, channel: ch, queue_depth: r.int(900) }]
      }
      case 7: {
        const acct = `acct_${r.hex(6)}`
        const ms = r.latency(level >= 3 ? 4000 : 420)
        if (level >= 4) return [`Invoice job crashed for ${acct}`, { ...base, account_id: acct, error: { type: 'RangeError', message: 'Invalid time value', stack: stack('billing-worker', 'RangeError: Invalid time value', r) } }]
        return [`Invoice generated for ${acct} in ${ms}ms`, { ...base, account_id: acct, duration_ms: ms, period: '2026-10' }]
      }
      case 8: {
        const ms = r.latency(level >= 3 ? 1200 : 6)
        if (level >= 4) return [`Connection pool exhausted (max=64, waiting=${20 + r.int(200)})`, { ...base, pool: 'primary', max: 64, error: { type: 'PoolTimeoutError', stack: stack('postgres-proxy', 'PoolTimeoutError: timeout acquiring connection', r) } }]
        if (level === 3) return [`Slow query ${ms}ms`, { ...base, duration_ms: ms, sql: r.pick(SQL) }]
        return [`Query ok ${ms}ms rows=${r.int(500)}`, { ...base, duration_ms: ms, sql: r.pick(SQL) }]
      }
      default: {
        const key = `user:${100000 + r.int(900000)}:profile`
        if (level >= 3) return [`Evicted ${100 + r.int(5000)} keys under memory pressure`, { ...base, used_memory_mb: 3800 + r.int(300), maxmemory_mb: 4096 }]
        return [r.next() < 0.7 ? `Cache hit ${key}` : `Cache miss ${key}`, { ...base, key, ttl_s: 300 }]
      }
    }
  }

  /** Append `n` lines spread evenly over [t0, t1). */
  fill(store: LogStore, n: number, t0: number, t1: number) {
    const ids = SERVICES.map((s) => store.serviceId(s))
    const span = t1 - t0
    for (let k = 0; k < n && !store.full; k++) {
      const ts = Math.floor(t0 + (span * k) / n)
      const g = this.line(ts)
      store.push(g.text, ts, g.level, ids[g.service]!)
    }
  }
}
