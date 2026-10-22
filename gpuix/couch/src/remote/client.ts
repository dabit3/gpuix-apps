import { ACTIONS, type Action } from '../controller.ts'
import { lineReader, socketPath, type Status } from './protocol.ts'

export interface RemoteConn { send: (msg: object) => void; close: () => void }

export async function connectRemote(onStatus: (s: Status | null) => void, path = socketPath()): Promise<RemoteConn | null> {
  try {
    const sock = await Bun.connect<undefined>({
      unix: path,
      socket: {
        data: (() => { const r = lineReader((m) => { if ('screen' in m) onStatus(m) }); return (_s: unknown, chunk: Uint8Array) => r(chunk) })(),
        close: () => onStatus(null),
        error: () => onStatus(null),
      },
    })
    sock.write(JSON.stringify({ cmd: 'subscribe' }) + '\n')
    return { send: (m) => sock.write(JSON.stringify(m) + '\n'), close: () => sock.end() }
  } catch { return null }
}

/** `couch remote up up ok`, `couch remote status`, `couch remote open sintel`. */
export async function sendRemote(args: string[], path = socketPath()): Promise<number> {
  const msgs: object[] = []
  let wantReply = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!.toLowerCase()
    if (a === 'status') { msgs.push({ cmd: 'status' }); wantReply = true }
    else if (a === 'open') { msgs.push({ cmd: 'open', query: args.slice(i + 1).join(' ') }); wantReply = true; break }
    else if (ACTIONS.includes(a as Action)) msgs.push({ action: a })
    else { console.error(`couch remote: unknown action "${args[i]}"`); return 2 }
  }
  let reply = ''
  let done: () => void = () => {}
  const finished = new Promise<void>((r) => { done = r })
  try {
    const sock = await Bun.connect<undefined>({
      unix: path,
      socket: {
        data: lineReader((m) => { reply = JSON.stringify(m); done() }) as any,
        close: () => done(),
        error: () => done(),
      },
    })
    for (const m of msgs) { sock.write(JSON.stringify(m) + '\n'); await Bun.sleep(90) }
    if (wantReply) await Promise.race([finished, Bun.sleep(1500)])
    sock.end()
  } catch {
    console.error('couch remote: no couch running (start one with `couch ~/Movies`)')
    return 1
  }
  if (reply) console.log(reply)
  return 0
}
