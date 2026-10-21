import { ageTtls, cacheTtl, parseResponse, setId, type Response } from './packet'

interface Entry { buf: Uint8Array; res: Response; stored: number; expires: number }

/** LRU response cache keyed by name/type/class that honors the answer TTLs. */
export class DnsCache {
  private map = new Map<string, Entry>()
  hits = 0
  misses = 0
  constructor(public capacity = 256, private now: () => number = Date.now, private maxTtl = 3600) {}

  static key(name: string, qtype: number, qclass = 1) { return `${name}|${qtype}|${qclass}` }

  get size() { return this.map.size }

  put(key: string, buf: Uint8Array) {
    if (this.capacity <= 0) return
    let res: Response
    try { res = parseResponse(buf) } catch { return }
    if (res.truncated || (res.rcode !== 0 && res.rcode !== 3)) return
    const ttl = Math.min(this.maxTtl, cacheTtl(res))
    if (ttl <= 0) return
    const t = this.now()
    this.map.delete(key)
    this.map.set(key, { buf: Uint8Array.from(buf), res, stored: t, expires: t + ttl * 1000 })
    while (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value!)
  }

  /** A copy of the cached response with `id` and aged TTLs, or null. */
  get(key: string, id: number): Uint8Array | null {
    const e = this.map.get(key)
    const t = this.now()
    if (!e || e.expires <= t) {
      if (e) this.map.delete(key)
      this.misses++
      return null
    }
    this.map.delete(key)
    this.map.set(key, e)
    this.hits++
    const out = Uint8Array.from(e.buf)
    setId(out, id)
    ageTtls(out, e.res, Math.floor((t - e.stored) / 1000))
    return out
  }

  clear() { this.map.clear() }
}
