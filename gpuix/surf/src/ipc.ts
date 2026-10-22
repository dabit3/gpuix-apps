import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One request per line: {"id":1,"cmd":"open","args":["https://…"]}; one reply per line: {"id":1,"ok":true,"result":…}. */
export interface Request { id: number; cmd: string; args: string[] }
export interface Reply { id: number; ok: boolean; result?: unknown; error?: string }
export type Handler = (args: string[]) => unknown | Promise<unknown>

export const COMMANDS = ['open', 'go', 'back', 'forward', 'reload', 'close', 'tabs', 'tab', 'info', 'eval', 'shot', 'find'] as const

export const runDir = (home = homedir()) => join(process.env.SURF_HOME ?? join(home, '.surf'), 'run')
export const socketPath = (pid = process.pid, dir = runDir()) => join(dir, `${pid}.sock`)

export function encode(msg: Request | Reply) { return JSON.stringify(msg) + '\n' }

/** Splits a byte stream into JSON lines; tolerates partial chunks and ignores garbage lines. */
export class LineReader {
  private buf = ''
  push(chunk: string): unknown[] {
    this.buf += chunk
    const out: unknown[] = []
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line) continue
      try { out.push(JSON.parse(line)) } catch {}
    }
    return out
  }
}

export function isRequest(v: unknown): v is Request {
  const r = v as Request
  return !!r && typeof r.id === 'number' && typeof r.cmd === 'string' && Array.isArray(r.args) && r.args.every((a) => typeof a === 'string')
}

export async function dispatch(handlers: Record<string, Handler>, req: Request): Promise<Reply> {
  const h = handlers[req.cmd]
  if (!h) return { id: req.id, ok: false, error: `unknown command "${req.cmd}"` }
  try { return { id: req.id, ok: true, result: await h(req.args) } } catch (e) { return { id: req.id, ok: false, error: (e as Error).message } }
}

/** Listens on ~/.surf/run/<pid>.sock. `touch()` marks this instance as the most recently used one. */
export function serve(handlers: Record<string, Handler>, path = socketPath()) {
  mkdirSync(join(path, '..'), { recursive: true })
  if (existsSync(path)) rmSync(path)
  const server = Bun.listen<{ reader: LineReader }>({
    unix: path,
    socket: {
      open(s) { s.data = { reader: new LineReader() } },
      async data(s, chunk) {
        for (const msg of s.data.reader.push(chunk.toString())) {
          const reply = isRequest(msg) ? await dispatch(handlers, msg) : { id: (msg as Reply)?.id ?? 0, ok: false, error: 'bad request' }
          s.write(encode(reply))
        }
      },
    },
  })
  const meta = path.replace(/\.sock$/, '.json')
  const touch = (info: Record<string, unknown> = {}) => {
    try { writeFileSync(meta, JSON.stringify({ pid: process.pid, cwd: process.cwd(), ...info })); utimesSync(meta, new Date(), new Date()) } catch {}
  }
  touch()
  const stop = () => { try { server.stop(true) } catch {} for (const f of [path, meta]) try { rmSync(f) } catch {} }
  return { path, touch, stop }
}

export interface Instance { pid: number; path: string; active: number; url?: string; title?: string }

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

/** Running instances, most recently used first. Sockets of dead processes are cleaned up. */
export function instances(dir = runDir()): Instance[] {
  if (!existsSync(dir)) return []
  const out: Instance[] = []
  for (const f of readdirSync(dir)) {
    const m = /^(\d+)\.sock$/.exec(f)
    if (!m) continue
    const pid = Number(m[1]), path = join(dir, f), meta = join(dir, `${pid}.json`)
    if (!alive(pid)) { for (const p of [path, meta]) try { rmSync(p) } catch {} continue }
    let info: { url?: string; title?: string } = {}, active = 0
    try { info = JSON.parse(readFileSync(meta, 'utf8')); active = statSync(meta).mtimeMs } catch {}
    out.push({ pid, path, active, url: info.url, title: info.title })
  }
  return out.sort((a, b) => b.active - a.active)
}

/** Sends one command to a running instance and resolves with its reply. */
export async function request(path: string, cmd: string, args: string[], timeoutMs = 15000): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const reader = new LineReader()
    const timer = setTimeout(() => reject(new Error(`no reply from ${path}`)), timeoutMs)
    Bun.connect({
      unix: path,
      socket: {
        open(s) { s.write(encode({ id: 1, cmd, args })) },
        data(s, chunk) {
          for (const msg of reader.push(chunk.toString())) if ((msg as Reply).id === 1) { clearTimeout(timer); s.end(); resolve(msg as Reply) }
        },
        error(_s, e) { clearTimeout(timer); reject(e) },
        connectError(_s, e) { clearTimeout(timer); reject(e) },
      },
    }).catch((e) => { clearTimeout(timer); reject(e) })
  })
}
