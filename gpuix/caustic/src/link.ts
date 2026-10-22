import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Ripple } from './protocol'
import type { Settings } from './scene'

/**
 * Every running `caustic` listens on a unix socket in one shared folder. Ripples you draw in one pane are sent to
 * the others, and `caustic drop` / `caustic rain` from any shell talk to all of them.
 */
export type LinkMessage = { from: number; ripples?: Ripple[]; settings?: Partial<Settings> }

export const linkDir = () => process.env.CAUSTIC_LINK_DIR ?? join(tmpdir(), 'caustic-link')

export function peers(except = -1) {
  try {
    return readdirSync(linkDir()).filter((f) => f.endsWith('.sock') && f !== `${except}.sock`).map((f) => join(linkDir(), f))
  } catch {
    return []
  }
}

/** Send one message to every peer; stale sockets of dead instances are removed. Resolves with the number reached. */
export async function broadcast(msg: LinkMessage, except = -1) {
  const line = JSON.stringify(msg) + '\n'
  const results = await Promise.all(peers(except).map(async (path) => {
    try {
      const sock = await Bun.connect({ unix: path, socket: { data() {}, error() {} } })
      sock.write(line)
      sock.end()
      return 1
    } catch {
      try { unlinkSync(path) } catch {}
      return 0
    }
  }))
  return results.reduce<number>((a, b) => a + b, 0)
}

export class Link {
  private server: ReturnType<typeof Bun.listen> | null = null
  private path: string

  constructor(onMessage: (m: LinkMessage) => void) {
    mkdirSync(linkDir(), { recursive: true })
    this.path = join(linkDir(), `${process.pid}.sock`)
    try { unlinkSync(this.path) } catch {}
    let buf = ''
    this.server = Bun.listen({
      unix: this.path,
      socket: {
        data(_s, d) {
          buf += d.toString()
          let i: number
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i)
            buf = buf.slice(i + 1)
            try { onMessage(JSON.parse(line) as LinkMessage) } catch {}
          }
        },
      },
    })
    process.on('exit', () => this.close())
  }

  get peerCount() { return peers(process.pid).length }

  send(msg: Omit<LinkMessage, 'from'>) { return broadcast({ ...msg, from: process.pid }, process.pid) }

  close() {
    this.server?.stop(true)
    this.server = null
    try { unlinkSync(this.path) } catch {}
  }
}
