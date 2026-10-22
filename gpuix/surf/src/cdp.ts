/** Minimal Chrome DevTools Protocol client over one browser-level WebSocket, with flattened target sessions. */
export type CdpParams = Record<string, unknown>
type Listener = (params: any, sessionId?: string) => void

export class CdpError extends Error {
  constructor(public method: string, message: string, public code?: number) { super(`${method}: ${message}`) }
}

export class Cdp {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>()
  private listeners = new Map<string, Set<Listener>>()
  closed = false
  readonly ready: Promise<void>

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true })
      this.ws.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)), { once: true })
    })
    this.ws.addEventListener('message', (ev) => this.onMessage(String(ev.data)))
    this.ws.addEventListener('close', () => {
      this.closed = true
      for (const p of this.pending.values()) p.reject(new CdpError(p.method, 'connection closed'))
      this.pending.clear()
      this.emit('close', {})
    })
  }

  static async connect(url: string) { const c = new Cdp(url); await c.ready; return c }

  send<T = any>(method: string, params: CdpParams = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new CdpError(method, 'connection closed'))
    const id = this.nextId++
    const msg: Record<string, unknown> = { id, method, params }
    if (sessionId) msg.sessionId = sessionId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify(msg))
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

  close() { try { this.ws.close() } catch {} }
}
