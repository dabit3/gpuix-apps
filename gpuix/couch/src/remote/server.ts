import { existsSync, unlinkSync } from 'node:fs'
import type { Socket } from 'bun'
import { ACTIONS, type Action, type Controller } from '../controller.ts'
import { lineReader, socketPath, type ClientMsg } from './protocol.ts'

/** Lets `couch remote` (a second pane or a one-shot shell command) drive the running app over a unix socket. */
export function startRemoteServer(ctl: Controller, path = socketPath()) {
  try { if (existsSync(path)) unlinkSync(path) } catch {}
  const subs = new Set<Socket<{ read: (c: Uint8Array) => void }>>()
  let last = ''
  const push = () => {
    const line = JSON.stringify(ctl.status()) + '\n'
    if (line === last) return
    last = line
    for (const s of subs) s.write(line)
  }
  ctl.onStatus.add(push)
  const server = Bun.listen<{ read: (c: Uint8Array) => void }>({
    unix: path,
    socket: {
      open(sock) {
        sock.data = {
          read: lineReader((msg: ClientMsg) => {
            if ('action' in msg && ACTIONS.includes(msg.action as Action)) ctl.dispatch(msg.action, 'remote')
            else if ('cmd' in msg && msg.cmd === 'subscribe') { subs.add(sock); sock.write(JSON.stringify(ctl.status()) + '\n') }
            else if ('cmd' in msg && msg.cmd === 'status') sock.write(JSON.stringify(ctl.status()) + '\n')
            else if ('cmd' in msg && msg.cmd === 'open') {
              const q = msg.query.toLowerCase()
              const id = [...ctl.lib.movies, ...ctl.lib.shows].find((i) => ctl.lib.items[i]!.title.toLowerCase().includes(q))
              if (id && ctl.view.screen !== 'profiles') ctl.open(id)
              sock.write(JSON.stringify({ ok: !!id, title: id ? ctl.lib.items[id]!.title : undefined }) + '\n')
            }
          }),
        }
      },
      data(sock, chunk) { sock.data.read(chunk) },
      close(sock) { subs.delete(sock) },
      error(sock) { subs.delete(sock) },
    },
  })
  const stop = () => { try { server.stop(true) } catch {} try { unlinkSync(path) } catch {} }
  process.on('exit', stop)
  return { stop, path }
}
