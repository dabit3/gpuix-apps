import { closeSync } from 'node:fs'

/** Minimal Chrome DevTools Protocol client over one browser-level connection, with flattened target sessions. */
export type CdpParams = Record<string, unknown>
type Listener = (params: any, sessionId?: string) => void

export class CdpError extends Error {
  constructor(public method: string, message: string, public code?: number) { super(`${method}: ${message}`) }
}

/** One message stream to Chrome's browser target. */
export interface CdpTransport {
  send(msg: string): void
  onMessage(fn: (msg: string) => void): void
  onClose(fn: () => void): void
  close(): void
}

/**
 * The `--remote-debugging-pipe` transport: Chrome reads NUL-terminated JSON messages on its fd 3 and writes them on its fd 4.
 * `writeFd`/`readFd` are our ends of those pipes. No TCP listener exists, so no other local process can reach the browser.
 */
export function pipeTransport(writeFd: number, readFd: number): CdpTransport {
  const out = Bun.file(writeFd).writer()
  const messages = new Set<(msg: string) => void>()
  const closes = new Set<() => void>()
  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    try { out.end() } catch {}
    try { closeSync(writeFd) } catch {}
    for (const fn of closes) fn()
  }
  void (async () => {
    const dec = new TextDecoder()
    let buf = ''
    try {
      for await (const chunk of Bun.file(readFd).stream()) {
        buf += dec.decode(chunk, { stream: true })
        let end: number
        while ((end = buf.indexOf('\0')) >= 0) {
          const msg = buf.slice(0, end)
          buf = buf.slice(end + 1)
          for (const fn of messages) fn(msg)
        }
      }
    } catch {}
    finish()
  })()
  return {
    send(msg) {
      if (closed) throw new Error('connection closed')
      out.write(msg + '\0')
      out.flush()
    },
    onMessage: (fn) => void messages.add(fn),
    onClose: (fn) => void closes.add(fn),
    close: finish,
  }
}

export class Cdp {
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>()
  private listeners = new Map<string, Set<Listener>>()
  closed = false

  constructor(private transport: CdpTransport) {
    transport.onMessage((raw) => this.onMessage(raw))
    transport.onClose(() => {
      this.closed = true
      for (const p of this.pending.values()) p.reject(new CdpError(p.method, 'connection closed'))
      this.pending.clear()
      this.emit('close', {})
    })
  }

  send<T = any>(method: string, params: CdpParams = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new CdpError(method, 'connection closed'))
    const id = this.nextId++
    const msg: Record<string, unknown> = { id, method, params }
    if (sessionId) msg.sessionId = sessionId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      try { this.transport.send(JSON.stringify(msg)) } catch (e) { this.pending.delete(id); reject(new CdpError(method, (e as Error).message)) }
    })
  }

  /** Fire-and-forget: errors (e.g. a tab that just closed) are swallowed. */
  post(method: string, params: CdpParams = {}, sessionId?: string) { this.send(method, params, sessionId).catch(() => {}) }

  on(event: string, fn: Listener) {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  }

  private emit(event: string, params: unknown, sessionId?: string) {
    const set = this.listeners.get(event)
    if (set) for (const fn of set) fn(params, sessionId)
  }

  private onMessage(raw: string) {
    let msg: any
    try { msg = JSON.parse(raw) } catch { return }
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new CdpError(p.method, msg.error.message, msg.error.code))
      else p.resolve(msg.result)
    } else if (msg.method) {
      this.emit(msg.method, msg.params, msg.sessionId)
    }
  }

  close() { try { this.transport.close() } catch {} }
}
