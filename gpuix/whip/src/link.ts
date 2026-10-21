import { appendFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { agentsDir, encode, LineDecoder, type LeashMessage } from './protocol'

export const ACTIVITY_SAMPLES = 40

export interface AgentInfo {
  key: string
  kind: 'leash' | 'file'
  name: string
  pid: number
  tty: string
  command: string[]
  activity: number[]
  nudges: number
}

export type LogKind = 'esc' | 'text' | 'enter' | 'crack' | 'blocked' | 'rate' | 'link' | 'unlink' | 'hook'

export interface LogEntry {
  id: number
  at: number
  kind: LogKind
  text: string
}

type Conn = { info: AgentInfo; sock?: { write(d: string): number; end(): void } }

/** Finds leashed agents (unix sockets in ~/.whip/agents) and sends them nudges. */
export class AgentLink {
  private conns = new Map<string, Conn>()
  private pending = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private nextId = 1
  private logId = 1
  injected = 0
  onChange: () => void = () => {}
  onLog: (e: LogEntry) => void = () => {}

  constructor(private dir = agentsDir(), private extraTargets: string[] = []) {}

  start() {
    for (const t of this.extraTargets) this.addTarget(t)
    this.scan()
    this.timer = setInterval(() => this.scan(), 400)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    for (const c of this.conns.values()) c.sock?.end()
    this.conns.clear()
  }

  list(): AgentInfo[] {
    return [...this.conns.values()].map((c) => c.info)
  }

  log(kind: LogKind, text: string) {
    this.onLog({ id: this.logId++, at: Date.now(), kind, text })
  }

  /** Agents whose tty was named with --target /dev/ttysNNN. */
  readonly ttys = new Set<string>()

  preferred(): string | null {
    for (const c of this.conns.values()) if (this.ttys.has(c.info.tty)) return c.info.key
    return null
  }

  private addTarget(path: string) {
    if (path.startsWith('/dev/')) {
      // A tty can't be typed into from outside; pick the leashed agent running on it.
      this.ttys.add(path)
      return
    }
    let isSocket = false
    try { isSocket = statSync(path).isSocket() } catch {}
    if (isSocket) return this.connect(path)
    const key = 'file:' + path
    this.conns.set(key, {
      info: { key, kind: 'file', name: basename(path), pid: 0, tty: path, command: [], activity: [], nudges: 0 },
    })
    this.onChange()
  }

  private scan() {
    let files: string[] = []
    try {
      if (existsSync(this.dir)) files = readdirSync(this.dir).filter((f) => f.endsWith('.sock'))
    } catch {}
    for (const f of files) {
      const path = join(this.dir, f)
      if (!this.conns.has(path) && !this.pending.has(path)) this.connect(path)
    }
  }

  private connect(path: string) {
    this.pending.add(path)
    const dec = new LineDecoder<LeashMessage>()
    Bun.connect({
      unix: path,
      socket: {
        data: (_s, chunk) => {
          for (const msg of dec.push(chunk.toString())) this.handle(path, msg)
        },
        close: () => this.drop(path),
        error: () => this.drop(path),
      },
    })
      .then((sock) => {
        this.pending.delete(path)
        const pid = Number(basename(path).replace('.sock', '')) || 0
        this.conns.set(path, {
          sock,
          info: { key: path, kind: 'leash', name: 'agent', pid, tty: '', command: [], activity: [], nudges: 0 },
        })
        this.onChange()
      })
      .catch(() => {
        this.pending.delete(path)
        // Nobody listening: a leash that died without cleaning up.
        try { unlinkSync(path) } catch {}
      })
  }

  private drop(path: string) {
    const c = this.conns.get(path)
    if (!c) return
    this.conns.delete(path)
    this.log('unlink', `${c.info.name} left`)
    this.onChange()
  }

  private handle(path: string, msg: LeashMessage) {
    const c = this.conns.get(path)
    if (!c) return
    if (msg.type === 'hello') {
      c.info = { ...c.info, name: msg.name, pid: msg.pid, tty: msg.tty, command: msg.command }
      this.log('link', `leashed ${msg.name} · pid ${msg.pid}`)
      this.onChange()
    } else if (msg.type === 'activity') {
      const a = [...c.info.activity, msg.bytes]
      if (a.length > ACTIVITY_SAMPLES) a.splice(0, a.length - ACTIVITY_SAMPLES)
      c.info = { ...c.info, activity: a }
      this.onChange()
    } else if (msg.type === 'injected') {
      this.injected += msg.events.length
      c.info = { ...c.info, nudges: c.info.nudges + 1 }
      this.log('esc', `Esc → ${c.info.name}`)
      this.log('text', `"${msg.message}"`)
      this.log('enter', 'Enter')
      this.onChange()
    } else if (msg.type === 'rejected') {
      this.log('rate', `${c.info.name} refused (${msg.reason})`)
    }
  }

  /** Sends one nudge. Returns false if the target is gone. */
  nudge(key: string, message: string): boolean {
    const c = this.conns.get(key)
    if (!c) return false
    if (c.info.kind === 'file') {
      try {
        appendFileSync(c.info.tty, message + '\n')
        this.injected += 1
        c.info = { ...c.info, nudges: c.info.nudges + 1 }
        this.log('hook', `"${message}" → ${c.info.name}`)
        this.onChange()
        return true
      } catch {
        return false
      }
    }
    c.sock?.write(encode({ type: 'nudge', id: this.nextId++, message }))
    return true
  }
}
