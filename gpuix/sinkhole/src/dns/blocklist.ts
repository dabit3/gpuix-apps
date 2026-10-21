import { hash40 } from './hash'

const BLOOM_BITS = 1 << 19 // 64 KB, like the in-RAM filter on the ESP32
const BLOOM_K = 4
const MAGIC = [0x53, 0x4e, 0x4b, 0x48, 0x31] // "SNKH1"

const SKIP = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', 'ip6-localhost', 'ip6-loopback', 'ip6-localnet', 'ip6-mcastprefix', 'ip6-allnodes', 'ip6-allrouters', 'ip6-allhosts', '0.0.0.0'])
const DOMAIN = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/

export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase()
  if (d.startsWith('*.')) d = d.slice(2)
  while (d.endsWith('.')) d = d.slice(0, -1)
  if (!d || SKIP.has(d) || !DOMAIN.test(d)) return null
  if (/^\d+(\.\d+){3}$/.test(d)) return null
  return d
}

/** Parses hosts-format (`0.0.0.0 ads.example.com`) or plain one-domain-per-line lists. */
export function parseHosts(text: string): string[] {
  const out = new Set<string>()
  for (const line of text.split('\n')) {
    const body = line.replace(/#.*/, '').trim()
    if (!body) continue
    const parts = body.split(/\s+/)
    const isIp = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f]*:[0-9a-f:]*)$/i.test(parts[0]!)
    const names = isIp ? parts.slice(1) : parts.length === 1 ? parts : []
    for (const n of names) {
      const d = normalizeDomain(n)
      if (d) out.add(d)
    }
  }
  return [...out]
}

/** Each name, then its parents: a.b.example.com, b.example.com, example.com. */
export function candidates(name: string): string[] {
  const labels = name.split('.')
  const out: string[] = []
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join('.'))
  return out
}

function bloomProbes(h: number, out: Uint32Array) {
  const lo = h % 0x100000000
  const hi = Math.floor(h / 0x100000000)
  const a = lo >>> 0
  const b = (Math.imul(hi + 1, 0x9e3779b1) ^ (lo >>> 13)) | 1
  for (let i = 0; i < BLOOM_K; i++) out[i] = (a + Math.imul(i, b)) & (BLOOM_BITS - 1)
}

/** A sorted array of 40-bit hashes with a bloom filter in front: 5 bytes per domain, no names kept. */
export class HashedBlocklist {
  readonly hashes: Float64Array
  private readonly bloom = new Uint8Array(BLOOM_BITS / 8)
  private readonly probes = new Uint32Array(BLOOM_K)
  bloomSkips = 0
  searches = 0

  constructor(hashes: Float64Array) {
    this.hashes = hashes
    for (let i = 0; i < hashes.length; i++) {
      bloomProbes(hashes[i]!, this.probes)
      for (const p of this.probes) this.bloom[p >>> 3]! |= 1 << (p & 7)
    }
  }

  static fromDomains(domains: Iterable<string>): HashedBlocklist {
    const set = new Set<number>()
    for (const d of domains) set.add(hash40(d))
    const arr = Float64Array.from(set).sort()
    return new HashedBlocklist(arr)
  }

  get size() { return this.hashes.length }

  hasHash(h: number): boolean {
    bloomProbes(h, this.probes)
    for (const p of this.probes) {
      if (!(this.bloom[p >>> 3]! & (1 << (p & 7)))) { this.bloomSkips++; return false }
    }
    this.searches++
    let lo = 0, hi = this.hashes.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const v = this.hashes[mid]!
      if (v === h) return true
      if (v < h) lo = mid + 1
      else hi = mid - 1
    }
    return false
  }

  has(domain: string) { return this.hasHash(hash40(domain)) }

  /** The flash file: "SNKH1", u32 count, then big-endian 5-byte hashes in ascending order. */
  serialize(): Uint8Array {
    const out = new Uint8Array(9 + this.hashes.length * 5)
    out.set(MAGIC, 0)
    new DataView(out.buffer).setUint32(5, this.hashes.length)
    let o = 9
    for (const h of this.hashes) {
      const hi = Math.floor(h / 0x100000000)
      const lo = h % 0x100000000
      out[o++] = hi
      out[o++] = lo >>> 24; out[o++] = (lo >>> 16) & 0xff; out[o++] = (lo >>> 8) & 0xff; out[o++] = lo & 0xff
    }
    return out
  }

  static deserialize(buf: Uint8Array): HashedBlocklist {
    if (buf.length < 9 || MAGIC.some((m, i) => buf[i] !== m)) throw new Error('not a sinkhole blocklist file')
    const n = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(5)
    if (buf.length !== 9 + n * 5) throw new Error('blocklist file is truncated')
    const hashes = new Float64Array(n)
    for (let i = 0, o = 9; i < n; i++, o += 5) hashes[i] = buf[o]! * 0x100000000 + ((buf[o + 1]! << 24) >>> 0) + (buf[o + 2]! << 16) + (buf[o + 3]! << 8) + buf[o + 4]!
    for (let i = 1; i < n; i++) if (hashes[i]! <= hashes[i - 1]!) throw new Error('blocklist file is not sorted')
    return new HashedBlocklist(hashes)
  }
}

export type Verdict =
  | { action: 'block'; source: 'deny' | 'list'; rule: string }
  | { action: 'pass'; source: 'allow'; rule: string }
  | { action: 'pass'; source: 'none' }

/** Allowlist beats the custom denylist beats the hashed list; each checks the name and then its parents. */
export class Matcher {
  list: HashedBlocklist
  allow = new Set<string>()
  deny = new Set<string>()
  constructor(list: HashedBlocklist, allow: Iterable<string> = [], deny: Iterable<string> = []) {
    this.list = list
    for (const a of allow) this.allow.add(a)
    for (const d of deny) this.deny.add(d)
  }
  check(name: string): Verdict {
    const names = candidates(name)
    for (const n of names) if (this.allow.has(n)) return { action: 'pass', source: 'allow', rule: n }
    for (const n of names) if (this.deny.has(n)) return { action: 'block', source: 'deny', rule: n }
    for (const n of names) if (this.list.has(n)) return { action: 'block', source: 'list', rule: n }
    return { action: 'pass', source: 'none' }
  }
}
