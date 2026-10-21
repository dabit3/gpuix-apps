import { closeSync, openSync, readSync, statSync, watch, type FSWatcher } from 'node:fs'

export type SourceEvents = {
  line: (line: string) => void
  status: (status: string, running: boolean) => void
  reset: () => void
}

export interface Source {
  label: string
  kind: 'command' | 'file'
  start(on: SourceEvents): void
  stop(): void
}

function splitter(onLine: (l: string) => void) {
  let rest = ''
  return (chunk: string, end = false) => {
    rest += chunk
    const parts = rest.split(/\r?\n|\r/)
    rest = end ? '' : (parts.pop() ?? '')
    for (const p of parts) onLine(p)
    if (end && rest) onLine(rest)
  }
}

/**
 * Spawns `argv` and streams its stdout+stderr line by line. On macOS the child runs under
 * `script -q /dev/null` so it sees a pty and line-buffers its output like it would in a terminal.
 * The child never gets our stdin: GPUIX needs the TTY, and a stdin pipe means automation to it.
 */
export function commandSource(argv: string[], { pty = process.platform === 'darwin' } = {}): Source {
  let proc: ReturnType<typeof Bun.spawn> | null = null
  let stopped = false
  return {
    label: argv.join(' '),
    kind: 'command',
    start(on) {
      const cmd = pty ? ['script', '-q', '/dev/null', ...argv] : argv
      try {
        proc = Bun.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GPUIX_TERMINAL: '' } })
      } catch (err) {
        on.status(`failed: ${(err as Error).message}`, false)
        return
      }
      on.status('running', true)
      const pump = async (stream: ReadableStream<Uint8Array>) => {
        const dec = new TextDecoder()
        const push = splitter(on.line)
        for await (const chunk of stream) push(dec.decode(chunk, { stream: true }))
        push('', true)
      }
      const p = proc
      Promise.all([pump(p.stdout as ReadableStream<Uint8Array>), pump(p.stderr as ReadableStream<Uint8Array>)]).catch(() => {})
      p.exited.then((code) => {
        if (!stopped) on.status(code === 0 ? 'exited' : `exited ${code}`, false)
      })
    },
    stop() {
      stopped = true
      try {
        proc?.kill('SIGTERM')
      } catch {}
    },
  }
}

/** Reads a CSV (or any text) file, then follows appends; a truncated/rewritten file is re-read from the top. */
export function fileSource(path: string): Source {
  let offset = 0
  let watcher: FSWatcher | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  return {
    label: path,
    kind: 'file',
    start(on) {
      let push = splitter(on.line)
      const read = () => {
        let size: number
        try {
          size = statSync(path).size
        } catch {
          on.status('missing', false)
          return
        }
        if (size < offset) {
          offset = 0
          push = splitter(on.line)
          on.reset()
        }
        if (size === offset) return
        const fd = openSync(path, 'r')
        try {
          const buf = Buffer.alloc(size - offset)
          readSync(fd, buf, 0, buf.length, offset)
          offset = size
          push(buf.toString('utf8'))
        } finally {
          closeSync(fd)
        }
        on.status('watching', true)
      }
      read()
      on.status('watching', true)
      try {
        watcher = watch(path, () => read())
      } catch {}
      // fs.watch misses some editors' atomic saves; a cheap poll backs it up.
      timer = setInterval(read, 250)
    },
    stop() {
      watcher?.close()
      if (timer) clearInterval(timer)
    },
  }
}
