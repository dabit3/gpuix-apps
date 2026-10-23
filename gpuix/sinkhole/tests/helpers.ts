import { parseQuery } from '../src/dns/packet'

/** A fake upstream resolver on a random local port: answers every A with 93.184.216.34 and AAAA with 2606::1, TTL 300. */
export async function fakeUpstream(opts: { silent?: boolean; ttl?: number; delayMs?: number; before?: (req: Uint8Array, port: number) => Uint8Array[] } = {}) {
  let hits = 0
  const ports: number[] = []
  const sock = await Bun.udpSocket<'buffer'>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data: (s, buf, port, addr) => {
        hits++
        ports.push(port)
        const req = new Uint8Array(buf)
        const go = () => {
          for (const f of opts.before?.(req, port) ?? []) s.send(f, port, addr)
          if (!opts.silent) s.send(answer(req, opts.ttl ?? 300), port, addr)
        }
        if (opts.delayMs) setTimeout(go, opts.delayMs)
        else go()
      },
    },
  })
  return { port: sock.port, addr: `127.0.0.1:${sock.port}`, ports, get hits() { return hits }, close: () => sock.close() }
}

/** A spoofed-looking reply to `req` that points the name at `ip`, optionally with no question section or a different question type. */
export function forged(req: Uint8Array, o: { ip?: number[]; qdcount0?: boolean; qtype?: number; id?: number } = {}): Uint8Array {
  const q = parseQuery(req)
  const ip = o.ip ?? [6, 6, 6, 6]
  const name = req.subarray(12, q.questionEnd - 4)
  const head = new Uint8Array(12)
  head.set(req.subarray(0, 12))
  if (o.id !== undefined) { head[0] = o.id >> 8; head[1] = o.id & 0xff }
  head[2] = 0x81; head[3] = 0x80
  head[4] = 0; head[5] = o.qdcount0 ? 0 : 1; head[6] = 0; head[7] = 1; head[8] = 0; head[9] = 0; head[10] = 0; head[11] = 0
  const qt = o.qtype ?? q.qtype
  const question = o.qdcount0 ? [] : [...name, qt >> 8, qt & 0xff, 0, 1]
  const rr = [...name, 0, 1, 0, 1, 0, 0, 0x0e, 0x10, 0, 4, ...ip]
  return Uint8Array.from([...head, ...question, ...rr])
}

export function answer(req: Uint8Array, ttl = 300): Uint8Array {
  const q = parseQuery(req)
  const qEnd = q.questionEnd
  const rdata = q.qtype === 28 ? [0x26, 0x06, ...new Array(13).fill(0), 1] : [93, 184, 216, 34]
  const out = new Uint8Array(qEnd + 12 + rdata.length)
  out.set(req.subarray(0, qEnd))
  out[2] = 0x81; out[3] = 0x80
  out[6] = 0; out[7] = 1; out[8] = 0; out[9] = 0; out[10] = 0; out[11] = 0
  const v = new DataView(out.buffer)
  let p = qEnd
  v.setUint16(p, 0xc00c); v.setUint16(p + 2, q.qtype); v.setUint16(p + 4, 1); v.setUint32(p + 6, ttl); v.setUint16(p + 10, rdata.length)
  out.set(rdata, p + 12)
  return out
}

/** Sends one query over real UDP and resolves with the raw answer. */
export async function ask(port: number, name: string, qtype: number | string = 1, timeoutMs = 2500): Promise<Uint8Array> {
  const { encodeQuery } = await import('../src/dns/packet')
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => { sock.close(); reject(new Error(`timeout asking ${name}`)) }, timeoutMs)
    const sock = await Bun.udpSocket<'buffer'>({ socket: { data: (_s, buf) => { clearTimeout(timer); sock.close(); resolve(new Uint8Array(buf)) } } })
    sock.send(encodeQuery(name, qtype), port, '127.0.0.1')
  })
}
