import { homedir } from 'node:os'
import { join } from 'node:path'

export function whipHome() {
  return process.env.WHIP_HOME || join(homedir(), '.whip')
}

export function agentsDir() {
  return join(whipHome(), 'agents')
}

export type LeashMessage =
  | { type: 'hello'; pid: number; name: string; command: string[]; tty: string; startedAt: number }
  | { type: 'activity'; bytes: number }
  | { type: 'injected'; id: number; message: string; events: string[] }
  | { type: 'rejected'; id: number; reason: string }

export type WhipMessage = { type: 'nudge'; id: number; message: string }

export function encode(msg: LeashMessage | WhipMessage) {
  return JSON.stringify(msg) + '\n'
}

/** Splits a byte stream into JSON lines, keeping a partial tail between chunks. */
export class LineDecoder<T> {
  private buf = ''
  push(chunk: string): T[] {
    this.buf += chunk
    const out: T[] = []
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line) continue
      try {
        out.push(JSON.parse(line) as T)
      } catch {}
    }
    if (this.buf.length > 64 * 1024) this.buf = ''
    return out
  }
}

/** The only bytes a leash ever writes into the agent for a nudge. */
export function nudgeSequence(message: string): { esc: string; text: string; enter: string } {
  return { esc: '\x1b', text: message, enter: '\r' }
}
