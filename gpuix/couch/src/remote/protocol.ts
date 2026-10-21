import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Action } from '../controller.ts'

export const socketPath = () => process.env.COUCH_SOCKET ?? join(tmpdir(), `couch-${process.getuid?.() ?? 0}.sock`)

export type ClientMsg = { action: Action } | { cmd: 'status' } | { cmd: 'open'; query: string } | { cmd: 'subscribe' }

export interface Status { screen: string; profile?: string; title?: string; playing: boolean; pos: number; dur: number }

/** Splits a byte stream into JSON lines. */
export function lineReader(onLine: (msg: any) => void) {
  let buf = ''
  return (chunk: Uint8Array | string) => {
    buf += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      try { onLine(JSON.parse(line)) } catch {}
    }
  }
}
