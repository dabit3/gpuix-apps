import { mkdirSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { encode, LineDecoder, agentsDir, nudgeSequence, type LeashMessage, type WhipMessage } from './protocol'
import { RateLimiter, sanitizeMessage } from './messages'

export function agentName(cmd: string[]): string {
  const first = basename(cmd[0] ?? 'agent')
  if ((first === 'bun' || first === 'node' || first === 'npx' || first === 'bunx') && cmd[1]) {
    const rest = cmd.slice(1).find((a) => !a.startsWith('-'))
    if (rest) return basename(rest).replace(/\.(t|j)sx?$/, '')
  }
  return first
}

function ttyName(): string {
  try {
    const r = Bun.spawnSync(['tty'], { stdin: 'inherit', stdout: 'pipe', stderr: 'ignore' })
    const s = r.stdout.toString().trim()
    return s.startsWith('/dev/') ? s : 'pty'
  } catch {
    return 'pty'
  }
}

export interface Injector {
  write(data: string): void
}

/**
 * Turns a nudge into exactly three writes: Esc, the message, Enter.
 * Everything else is refused, and nudges are rate limited to one per interval.
 */
export class NudgeGate {
  readonly limiter: RateLimiter
  constructor(
    private target: Injector,
    intervalMs = 2000,
    private escDelayMs = 150,
    private enterDelayMs = 60,
    private now: () => number = () => performance.now(),
  ) {
    this.limiter = new RateLimiter(intervalMs)
  }

  async nudge(id: number, raw: string): Promise<LeashMessage> {
    const message = sanitizeMessage(String(raw ?? ''))
    if (!message) return { type: 'rejected', id, reason: 'empty' }
    if (!this.limiter.take(this.now())) return { type: 'rejected', id, reason: 'rate' }
    const seq = nudgeSequence(message)
    this.target.write(seq.esc)
    await Bun.sleep(this.escDelayMs)
    this.target.write(seq.text)
    await Bun.sleep(this.enterDelayMs)
    this.target.write(seq.enter)
    return { type: 'injected', id, message, events: ['esc', 'text', 'enter'] }
  }
}

export async function runLeash(cmd: string[]): Promise<number> {
  if (cmd.length === 0) {
    process.stderr.write('whip: nothing to leash. Usage: whip -- <agent command>\n')
    return 2
  }
  if (!process.stdin.isTTY) {
    process.stderr.write('whip: leash needs an interactive terminal\n')
    return 2
  }
  const dir = agentsDir()
  mkdirSync(dir, { recursive: true })
  const sockPath = join(dir, `${process.pid}.sock`)
  const name = agentName(cmd)
  const tty = ttyName()
  const startedAt = Date.now()

  let bytes = 0
  const proc = Bun.spawn(cmd, {
    env: { ...process.env, WHIP_LEASHED: '1' },
    terminal: {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      data(_t, data) {
        bytes += data.length
        process.stdout.write(data)
      },
    },
  })
  const term = proc.terminal!
  const gate = new NudgeGate({ write: (d) => term.write(d) })

  const clients = new Set<{ write(data: string): number }>()
  const hello: LeashMessage = { type: 'hello', pid: process.pid, name, command: cmd, tty, startedAt }
  const server = Bun.listen<{ dec: LineDecoder<WhipMessage> }>({
    unix: sockPath,
    socket: {
      open(s) {
        s.data = { dec: new LineDecoder<WhipMessage>() }
        clients.add(s)
        s.write(encode(hello))
      },
      async data(s, chunk) {
        for (const msg of s.data.dec.push(chunk.toString())) {
          if (msg?.type !== 'nudge') continue
          const reply = await gate.nudge(Number(msg.id) || 0, msg.message)
          s.write(encode(reply))
        }
      },
      close(s) {
        clients.delete(s)
      },
      error(s) {
        clients.delete(s)
      },
    },
  })

  const activity = setInterval(() => {
    const msg = encode({ type: 'activity', bytes })
    bytes = 0
    for (const c of clients) c.write(msg)
  }, 250)

  const cleanup = () => {
    clearInterval(activity)
    try { server.stop(true) } catch {}
    try { unlinkSync(sockPath) } catch {}
  }
  process.on('exit', cleanup)

  process.stdin.setRawMode(true)
  process.stdin.on('data', (d) => term.write(d))
  process.stdout.on('resize', () => term.resize(process.stdout.columns, process.stdout.rows))
  process.on('SIGTERM', () => proc.kill())
  process.on('SIGHUP', () => proc.kill())

  const code = await proc.exited
  try { process.stdin.setRawMode(false) } catch {}
  process.stdin.pause()
  cleanup()
  return code ?? 0
}
