import dns from 'node:dns/promises'
import net from 'node:net'
import tls from 'node:tls'
import zlib from 'node:zlib'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export interface WireRequest {
  method: Method
  url: string
  headers: [string, string][]
  body?: string
}

export interface Timings {
  dns: number
  connect: number
  tls: number
  ttfb: number
  download: number
  total: number
}

export interface WireResponse {
  status: number
  statusText: string
  httpVersion: string
  headers: [string, string][]
  body: string
  size: number
  timings: Timings
  remoteAddress: string
}

export type Sender = (request: WireRequest, signal?: AbortSignal) => Promise<WireResponse>

/**
 * HTTP/1.1 over raw sockets so every phase can be timed: DNS lookup, TCP
 * connect, TLS handshake, time to first byte and download. fetch() hides these.
 */
export const sendRequest: Sender = async (request, signal) => {
  const url = new URL(request.url)
  const secure = url.protocol === 'https:'
  if (!secure && url.protocol !== 'http:') throw new Error(`Unsupported protocol ${url.protocol}`)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const port = Number(url.port || (secure ? 443 : 80))

  const t0 = performance.now()
  const address = net.isIP(host) ? host : (await dns.lookup(host)).address
  const tDns = performance.now()
  abortCheck(signal)

  const socket = net.connect({ host: address, port })
  const sockets: net.Socket[] = [socket]
  const onAbort = () => sockets.forEach((s) => s.destroy(new Error('Request cancelled')))
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await once(socket, 'connect')
    const tConnect = performance.now()
    let stream: net.Socket = socket
    if (secure) {
      stream = tls.connect({ socket, servername: net.isIP(host) ? undefined : host, ALPNProtocols: ['http/1.1'] })
      sockets.push(stream)
      await once(stream, 'secureConnect')
    }
    const tTls = performance.now()

    const body = request.body && !['GET', 'HEAD'].includes(request.method) ? Buffer.from(request.body) : null
    const headers = new Map<string, [string, string]>()
    const set = (k: string, v: string) => headers.set(k.toLowerCase(), [k, v])
    set('Host', url.port ? `${host}:${url.port}` : host)
    set('User-Agent', 'req/0.1 (gpuix)')
    set('Accept', '*/*')
    set('Accept-Encoding', 'gzip, deflate')
    for (const [k, v] of request.headers) if (k.trim()) set(k.trim(), v)
    if (body) set('Content-Length', String(body.length))
    set('Connection', 'close')
    const head =
      `${request.method} ${url.pathname || '/'}${url.search} HTTP/1.1\r\n` +
      [...headers.values()].map(([k, v]) => `${k}: ${v}`).join('\r\n') +
      '\r\n\r\n'
    stream.write(body ? Buffer.concat([Buffer.from(head), body]) : head)

    let tFirst = 0
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (d: Buffer) => {
        if (!tFirst) tFirst = performance.now()
        chunks.push(d)
      })
      stream.once('end', () => resolve())
      stream.once('close', () => resolve())
      stream.once('error', reject)
    })
    const tEnd = performance.now()
    abortCheck(signal)
    const raw = Buffer.concat(chunks)
    const parsed = parseResponse(raw, request.method)
    return {
      ...parsed,
      size: raw.length,
      remoteAddress: address,
      timings: {
        dns: tDns - t0,
        connect: tConnect - tDns,
        tls: secure ? tTls - tConnect : 0,
        ttfb: (tFirst || tEnd) - tTls,
        download: tFirst ? tEnd - tFirst : 0,
        total: tEnd - t0,
      },
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    sockets.forEach((s) => s.destroy())
  }
}

function abortCheck(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Request cancelled')
}

function once(socket: net.Socket, event: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 15_000)
    socket.once(event, () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

export function parseResponse(raw: Buffer, method: string) {
  const split = raw.indexOf('\r\n\r\n')
  if (split < 0) throw new Error('Malformed HTTP response')
  const lines = raw.subarray(0, split).toString('latin1').split('\r\n')
  const statusLine = /^HTTP\/(\S+)\s+(\d{3})\s*(.*)$/.exec(lines[0] ?? '')
  if (!statusLine) throw new Error(`Malformed status line: ${lines[0]}`)
  const headers: [string, string][] = lines.slice(1).map((line) => {
    const i = line.indexOf(':')
    return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
  })
  const header = (name: string) => headers.find(([k]) => k.toLowerCase() === name)?.[1]
  let body = raw.subarray(split + 4)
  if (header('transfer-encoding')?.toLowerCase().includes('chunked')) body = dechunk(body)
  const encoding = header('content-encoding')?.toLowerCase()
  if (encoding === 'gzip') body = zlib.gunzipSync(body)
  else if (encoding === 'deflate') body = zlib.inflateSync(body)
  else if (encoding === 'br') body = zlib.brotliDecompressSync(body)
  return {
    status: Number(statusLine[2]),
    statusText: statusLine[3] || '',
    httpVersion: statusLine[1]!,
    headers,
    body: method === 'HEAD' ? '' : body.toString('utf8'),
  }
}

function dechunk(buf: Buffer): Buffer {
  const out: Buffer[] = []
  let i = 0
  while (i < buf.length) {
    const eol = buf.indexOf('\r\n', i)
    if (eol < 0) break
    const size = parseInt(buf.subarray(i, eol).toString('latin1'), 16)
    if (!size) break
    out.push(buf.subarray(eol + 2, eol + 2 + size))
    i = eol + 2 + size + 2
  }
  return Buffer.concat(out)
}
