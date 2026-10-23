// Minimal RFC 1035 wire format: enough to answer, forward and cache queries.

export const QTYPE: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 64: 'SVCB', 65: 'HTTPS', 255: 'ANY' }
export const TYPE_CODE: Record<string, number> = Object.fromEntries(Object.entries(QTYPE).map(([k, v]) => [v, Number(k)]))
export const RCODE = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 } as const

export interface Query {
  id: number
  flags: number
  name: string
  qtype: number
  qclass: number
  /** Byte offset just past the first question. */
  questionEnd: number
}

export class DnsError extends Error {}

/** Reads a (possibly compressed) domain name. Returns the lowercase name without the trailing dot. */
export function readName(buf: Uint8Array, offset: number): { name: string; next: number } {
  const labels: string[] = []
  let pos = offset
  let next = -1
  let jumps = 0
  for (;;) {
    if (pos >= buf.length) throw new DnsError('name runs past the packet')
    const len = buf[pos]!
    if (len === 0) { pos += 1; break }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new DnsError('truncated pointer')
      if (++jumps > 32) throw new DnsError('compression loop')
      if (next < 0) next = pos + 2
      pos = ((len & 0x3f) << 8) | buf[pos + 1]!
      continue
    }
    if (len & 0xc0) throw new DnsError('bad label type')
    if (pos + 1 + len > buf.length) throw new DnsError('label runs past the packet')
    let label = ''
    for (let i = 0; i < len; i++) label += String.fromCharCode(buf[pos + 1 + i]!)
    labels.push(label.toLowerCase())
    pos += 1 + len
    if (labels.length > 127) throw new DnsError('too many labels')
  }
  return { name: labels.join('.'), next: next < 0 ? pos : next }
}

export function parseQuery(buf: Uint8Array): Query {
  if (buf.length < 12) throw new DnsError('short header')
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const id = v.getUint16(0)
  const flags = v.getUint16(2)
  const qd = v.getUint16(4)
  if (qd < 1) throw new DnsError('no question')
  const { name, next } = readName(buf, 12)
  if (next + 4 > buf.length) throw new DnsError('truncated question')
  return { id, flags, name, qtype: v.getUint16(next), qclass: v.getUint16(next + 2), questionEnd: next + 4 }
}

function encodeName(name: string): number[] {
  const out: number[] = []
  for (const label of name.split('.').filter(Boolean)) {
    if (label.length > 63) throw new DnsError('label too long')
    out.push(label.length)
    for (let i = 0; i < label.length; i++) out.push(label.charCodeAt(i) & 0x7f)
  }
  out.push(0)
  return out
}

/** A recursion-desired query, as `dig` sends it. */
export function encodeQuery(name: string, qtype: number | string = 1, id = (Math.random() * 0x10000) | 0): Uint8Array {
  const type = typeof qtype === 'string' ? TYPE_CODE[qtype.toUpperCase()] ?? 1 : qtype
  const q = encodeName(name)
  const buf = new Uint8Array(12 + q.length + 4)
  const v = new DataView(buf.buffer)
  v.setUint16(0, id)
  v.setUint16(2, 0x0100)
  v.setUint16(4, 1)
  buf.set(q, 12)
  v.setUint16(12 + q.length, type)
  v.setUint16(14 + q.length, 1)
  return buf
}

/** Header + question of `q`, as a response with `rcode` and room for answers appended by the caller. */
function responseHead(req: Uint8Array, q: Query, rcode: number, answers: number): number[] {
  const rd = q.flags & 0x0100
  const opcode = q.flags & 0x7800
  const flags = 0x8000 | opcode | rd | 0x0080 | rcode
  const head = [q.id >> 8, q.id & 0xff, flags >> 8, flags & 0xff, 0, 1, answers >> 8, answers & 0xff, 0, 0, 0, 0]
  for (let i = 12; i < q.questionEnd; i++) head.push(req[i]!)
  return head
}

export type BlockMode = 'null' | 'nxdomain'

/** Sinkhole answer: 0.0.0.0 / :: (or NXDOMAIN), TTL 60. Other record types get an empty NOERROR. */
export function buildBlocked(req: Uint8Array, q: Query, mode: BlockMode = 'null', ttl = 60): Uint8Array {
  if (mode === 'nxdomain') return Uint8Array.from(responseHead(req, q, RCODE.NXDOMAIN, 0))
  const addr = q.qtype === 1 ? [0, 0, 0, 0] : q.qtype === 28 ? new Array(16).fill(0) : null
  const out = responseHead(req, q, RCODE.NOERROR, addr ? 1 : 0)
  if (addr) {
    out.push(0xc0, 0x0c, q.qtype >> 8, q.qtype & 0xff, 0, 1, (ttl >>> 24) & 0xff, (ttl >>> 16) & 0xff, (ttl >>> 8) & 0xff, ttl & 0xff, 0, addr.length, ...addr)
  }
  return Uint8Array.from(out)
}

export function buildError(req: Uint8Array, q: Query, rcode: number = RCODE.SERVFAIL): Uint8Array {
  return Uint8Array.from(responseHead(req, q, rcode, 0))
}

export function setId(buf: Uint8Array, id: number) {
  buf[0] = (id >> 8) & 0xff
  buf[1] = id & 0xff
}
export const getId = (buf: Uint8Array) => (buf[0]! << 8) | buf[1]!
export const getRcode = (buf: Uint8Array) => buf[3]! & 0x0f

export interface Record_ { name: string; type: number; ttl: number; ttlOffset: number; data: Uint8Array; section: 'an' | 'ns' | 'ar' }
export interface Response { id: number; rcode: number; truncated: boolean; qdcount: number; question?: { name: string; qtype: number; qclass: number }; records: Record_[] }

export function parseResponse(buf: Uint8Array): Response {
  if (buf.length < 12) throw new DnsError('short header')
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const counts = [v.getUint16(4), v.getUint16(6), v.getUint16(8), v.getUint16(10)] as const
  let pos = 12
  let question: Response['question']
  for (let i = 0; i < counts[0]; i++) {
    const n = readName(buf, pos)
    if (n.next + 4 > buf.length) throw new DnsError('truncated question')
    if (i === 0) question = { name: n.name, qtype: v.getUint16(n.next), qclass: v.getUint16(n.next + 2) }
    pos = n.next + 4
  }
  const records: Record_[] = []
  const sections = ['an', 'ns', 'ar'] as const
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < counts[s + 1]!; i++) {
      const n = readName(buf, pos)
      if (n.next + 10 > buf.length) throw new DnsError('truncated record')
      const type = v.getUint16(n.next)
      const ttlOffset = n.next + 4
      const ttl = v.getUint32(ttlOffset)
      const len = v.getUint16(n.next + 8)
      const start = n.next + 10
      if (start + len > buf.length) throw new DnsError('truncated rdata')
      records.push({ name: n.name, type, ttl, ttlOffset, data: buf.subarray(start, start + len), section: sections[s]! })
      pos = start + len
    }
  }
  return { id: v.getUint16(0), rcode: buf[3]! & 0x0f, truncated: (buf[2]! & 0x02) !== 0, qdcount: counts[0], question, records }
}

/** Seconds a response may be cached: the smallest answer TTL, or the SOA minimum for negative answers. */
export function cacheTtl(res: Response, fallback = 60): number {
  const an = res.records.filter((r) => r.section === 'an' && r.type !== 41)
  if (an.length) return Math.min(...an.map((r) => r.ttl))
  const soa = res.records.find((r) => r.section === 'ns' && r.type === 6)
  if (soa && soa.data.length >= 4) {
    const v = new DataView(soa.data.buffer, soa.data.byteOffset + soa.data.length - 4, 4)
    return Math.min(soa.ttl, v.getUint32(0))
  }
  return fallback
}

/** Lowers every record TTL by `elapsed` seconds (cache hits report the remaining lifetime, like a real resolver). */
export function ageTtls(buf: Uint8Array, res: Response, elapsed: number) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  for (const r of res.records) {
    if (r.type === 41) continue
    v.setUint32(r.ttlOffset, Math.max(0, r.ttl - elapsed))
  }
}

export function formatIp(type: number, data: Uint8Array): string | null {
  if (type === 1 && data.length === 4) return Array.from(data).join('.')
  if (type === 28 && data.length === 16) {
    const parts: string[] = []
    for (let i = 0; i < 16; i += 2) parts.push(((data[i]! << 8) | data[i + 1]!).toString(16))
    const s = parts.join(':')
    return s.replace(/(^|:)0(:0)+(:|$)/, '::').replace(/:{3,}/, '::')
  }
  return null
}

/** Short human summary of an answer: first address, CNAME target, or rcode. */
export function summarize(buf: Uint8Array): string {
  try {
    const res = parseResponse(buf)
    if (res.rcode === RCODE.NXDOMAIN) return 'NXDOMAIN'
    if (res.rcode === RCODE.SERVFAIL) return 'SERVFAIL'
    if (res.rcode !== 0) return `rcode ${res.rcode}`
    for (const r of res.records) {
      if (r.section !== 'an') continue
      const ip = formatIp(r.type, r.data)
      if (ip) return ip
    }
    const cname = res.records.find((r) => r.section === 'an' && r.type === 5)
    if (cname) return `→ ${readName(buf, cname.data.byteOffset - buf.byteOffset).name}`
    return res.records.some((r) => r.section === 'an') ? `${res.records.filter((r) => r.section === 'an').length} records` : 'no data'
  } catch {
    return 'malformed'
  }
}
