import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, createServer, type Server } from 'node:net'

export type Command =
  | { cmd: 'feed'; n: number }
  | { cmd: 'spawn'; n: number }
  | { cmd: 'web' }
  | { cmd: 'open'; url: string }
  | { cmd: 'still'; on: boolean }

export const SOCK_DIR = join(process.env.CRAWLER_SOCK_DIR ?? tmpdir(), `crawler-${process.getuid?.() ?? 'u'}`)

/** Each running crawler listens on its own unix socket; `crawler feed` etc. broadcast to all of them. */
export function listen(onCommand: (c: Command) => void): Server {
  mkdirSync(SOCK_DIR, { recursive: true })
  const path = join(SOCK_DIR, `${process.pid}.sock`)
  if (existsSync(path)) unlinkSync(path)
  const server = createServer((sock) => {
    let buf = ''
    sock.on('data', (d) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        try { onCommand(JSON.parse(line)) } catch {}
      }
      sock.end('ok\n')
    })
    sock.on('error', () => {})
  })
  server.listen(path)
  const cleanup = () => { try { unlinkSync(path) } catch {} }
  process.on('exit', cleanup)
  server.on('close', cleanup)
  return server
}

export async function broadcast(c: Command): Promise<number> {
  let files: string[] = []
  try { files = readdirSync(SOCK_DIR).filter((f) => f.endsWith('.sock')) } catch {}
  const results = await Promise.all(files.map((f) => new Promise<boolean>((resolve) => {
    const p = join(SOCK_DIR, f)
    const s = connect(p)
    const done = (ok: boolean) => { s.destroy(); resolve(ok) }
    s.on('connect', () => s.write(JSON.stringify(c) + '\n'))
    s.on('data', () => done(true))
    s.on('error', () => { try { unlinkSync(p) } catch {}; done(false) })
    setTimeout(() => done(false), 1500)
  })))
  return results.filter(Boolean).length
}
