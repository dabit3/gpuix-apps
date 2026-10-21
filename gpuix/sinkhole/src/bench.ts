import { mixedQueries, type BenchItem } from './corpus'
import { encodeQuery, getId, parseResponse, formatIp, RCODE } from './dns/packet'

export interface BenchResult {
  sent: number
  answered: number
  timeouts: number
  blockedOk: number
  adsExpected: number
  resolvedOk: number
  normalExpected: number
  seconds: number
  qps: number
  p50: number
  p95: number
}

export interface BenchOptions {
  host?: string
  port: number
  n?: number
  /** Parallel queries in flight. */
  concurrency?: number
  /** Paced queries per second instead of as-fast-as-possible. */
  rate?: number
  timeoutMs?: number
  seed?: number
  items?: BenchItem[]
  onProgress?: (done: number, total: number) => void
}

/** The acceptance script: N mixed queries over real UDP; checks ads come back 0.0.0.0/::/NXDOMAIN and normal names resolve. */
export async function runBench(o: BenchOptions): Promise<BenchResult> {
  const host = o.host ?? '127.0.0.1'
  const items = o.items ?? mixedQueries(o.n ?? 1000, o.seed ?? Date.now() % 100000)
  const timeoutMs = o.timeoutMs ?? 3000
  const conc = o.concurrency ?? 32
  const inflight = new Map<number, { item: BenchItem; t0: number; timer: ReturnType<typeof setTimeout> }>()
  const lat: number[] = []
  const r: BenchResult = { sent: 0, answered: 0, timeouts: 0, blockedOk: 0, adsExpected: items.filter((i) => i.ad).length, resolvedOk: 0, normalExpected: items.filter((i) => !i.ad).length, seconds: 0, qps: 0, p50: 0, p95: 0 }
  let next = 0
  let done = 0
  let finish!: () => void
  const finished = new Promise<void>((res) => (finish = res))
  const t0 = performance.now()

  const settle = () => {
    done++
    o.onProgress?.(done, items.length)
    if (done === items.length) finish()
    else if (!o.rate) pump()
  }

  const sock = await Bun.udpSocket({
    socket: {
      data(_s, buf) {
        const u = new Uint8Array(buf)
        const p = inflight.get(getId(u))
        if (!p) return
        inflight.delete(getId(u))
        clearTimeout(p.timer)
        lat.push(performance.now() - p.t0)
        r.answered++
        try {
          const res = parseResponse(u)
          const addrs = res.records.filter((x) => x.section === 'an').map((x) => formatIp(x.type, x.data)).filter(Boolean)
          const sunk = res.rcode === RCODE.NXDOMAIN || (addrs.length > 0 && addrs.every((a) => a === '0.0.0.0' || a === '::'))
          if (p.item.ad && sunk) r.blockedOk++
          if (!p.item.ad && res.rcode === RCODE.NOERROR && !sunk) r.resolvedOk++
        } catch {}
        settle()
      },
    },
  })

  const fire = () => {
    if (next >= items.length) return
    const item = items[next++]!
    let id = 0
    do id = (Math.random() * 0x10000) | 0
    while (inflight.has(id))
    const timer = setTimeout(() => { inflight.delete(id); r.timeouts++; settle() }, timeoutMs)
    inflight.set(id, { item, t0: performance.now(), timer })
    r.sent++
    sock.send(encodeQuery(item.name, item.qtype, id), o.port, host)
  }
  const pump = () => { while (inflight.size < conc && next < items.length) fire() }

  if (o.rate) {
    const every = 1000 / o.rate
    const start = performance.now()
    const tick = () => {
      const due = Math.floor((performance.now() - start) / every) + 1
      while (next < Math.min(due, items.length)) fire()
      if (next < items.length) setTimeout(tick, Math.max(1, every / 2))
    }
    tick()
  } else pump()

  if (items.length) await finished
  sock.close()
  r.seconds = (performance.now() - t0) / 1000
  r.qps = r.answered / r.seconds
  lat.sort((a, b) => a - b)
  r.p50 = lat[Math.floor(lat.length * 0.5)] ?? 0
  r.p95 = lat[Math.floor(lat.length * 0.95)] ?? 0
  return r
}

export function formatBench(r: BenchResult) {
  return [
    `${r.answered}/${r.sent} answered in ${r.seconds.toFixed(2)} s  (${r.qps.toFixed(0)} q/s, p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms)`,
    `ads sunk      ${r.blockedOk}/${r.adsExpected}`,
    `names resolved ${r.resolvedOk}/${r.normalExpected}`,
    r.timeouts ? `timeouts      ${r.timeouts}` : '',
  ].filter(Boolean).join('\n')
}
