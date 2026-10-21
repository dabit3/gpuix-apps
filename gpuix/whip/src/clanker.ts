// A fake coding-agent CLI for whip demos. It streams pretend work, stops on Esc,
// asks what to do instead, and speeds up when told to.
const ESC = '\x1b'
const c = {
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  invert: (s: string) => `\x1b[48;5;236m\x1b[97m${s}\x1b[0m`,
}

const STEPS: [string, string][] = [
  ['Read(src/auth/middleware.ts)', 'Read 214 lines'],
  ['Grep("verifySession")', 'Found 9 matches in 4 files'],
  ['Update(src/auth/middleware.ts)', 'Updated with 12 additions and 4 removals'],
  ['Bash(bun test auth)', '18 pass, 2 fail'],
  ['Read(src/auth/session.ts)', 'Read 88 lines'],
  ['Update(src/auth/session.ts)', 'Updated with 6 additions and 2 removals'],
  ['Bash(bun test auth)', '20 pass, 0 fail'],
  ['Write(test/auth/refresh.test.ts)', 'Wrote 48 lines'],
  ['Bash(bun run typecheck)', 'No errors'],
  ['Update(README.md)', 'Updated with 9 additions'],
]
const VERBS = ['Refactoring', 'Pondering', 'Clanking', 'Percolating', 'Grepping', 'Untangling']
const SPIN = ['✻', '✶', '✳', '✢', '·', '✢', '✳', '✶']

export function speedAfter(speed: number, message: string): number {
  const m = message.toLowerCase()
  const urgent = /fast|speed|go go|quick|hurry/.test(m)
  return Math.min(9, +(speed * (urgent ? 1.6 : 1.25)).toFixed(2))
}

export function replyTo(message: string, speed: number): string {
  const m = message.toLowerCase()
  if (/fast|speed|go go|hurry/.test(m)) return `You're absolutely right. Picking up the pace (${speed}x).`
  if (/great|continue|keep going/.test(m)) return `Thank you! Continuing (${speed}x).`
  return `Got it: "${message}". Continuing (${speed}x).`
}

export function runClanker(task = 'refactor the auth middleware and add tests') {
  const out = (s: string) => process.stdout.write(s)
  let speed = 1
  let mode: 'working' | 'asking' = 'working'
  let draft = ''
  let step = 0
  let tokens = 0
  let started = Date.now()
  let frame = 0
  let verb = VERBS[0]
  let nextStepAt = 0

  out('\x1b[?25l')
  out(`\n ${c.yellow('✻')} ${c.bold('Clanker')} ${c.dim('· fake coding agent for whip demos')}\n`)
  out(`   ${c.dim('model clanker-1 · ' + process.cwd().replace(process.env.HOME ?? '', '~'))}\n\n`)
  out(` ${c.dim('>')} ${task}\n\n`)

  const status = () => {
    if (mode !== 'working') return
    const secs = Math.floor((Date.now() - started) / 1000)
    const tk = tokens > 999 ? (tokens / 1000).toFixed(1) + 'k' : String(tokens)
    const sp = speed > 1 ? ` · ${c.red(speed + 'x')}` : ''
    out(`\r\x1b[2K ${c.yellow(SPIN[frame % SPIN.length])} ${c.yellow(verb + '…')} ${c.dim(`(${secs}s · ↓ ${tk} tokens`)}${sp}${c.dim(' · esc to interrupt)')}`)
  }
  const line = (s: string) => out(`\r\x1b[2K${s}\n`)

  const tick = setInterval(() => {
    if (mode !== 'working') return
    frame++
    tokens += Math.round(9 * speed + Math.random() * 6 * speed)
    const now = Date.now()
    if (now >= nextStepAt) {
      const [tool, result] = STEPS[step % STEPS.length]
      step++
      line(` ${c.green('⏺')} ${c.bold(tool)}`)
      line(`   ${c.dim('⎿  ' + result)}`)
      if (step % 3 === 0) verb = VERBS[(step / 3) % VERBS.length | 0]
      nextStepAt = now + (1500 + Math.random() * 500) / speed
    }
    status()
  }, 90)

  const interrupt = () => {
    if (mode !== 'working') return
    mode = 'asking'
    draft = ''
    line(`   ${c.red('⎿  Interrupted · What should Clanker do instead?')}`)
    out('\n')
    out(`\r\x1b[2K ${c.blue('>')} \x1b[?25h`)
  }

  const submit = () => {
    const msg = draft.trim()
    out('\x1b[?25l')
    out(`\r\x1b[2K`)
    if (msg) {
      out(`\x1b[1A\r\x1b[2K ${c.invert(' > ' + msg + ' ')}\n\n`)
      speed = speedAfter(speed, msg)
      line(` ${c.green('⏺')} ${replyTo(msg, speed)}`)
      out('\n')
    }
    mode = 'working'
    nextStepAt = Date.now() + 500 / speed
    status()
  }

  const quit = () => {
    clearInterval(tick)
    out('\r\x1b[2K\x1b[?25h\n')
    try { process.stdin.setRawMode(false) } catch {}
    process.exit(0)
  }

  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.on('data', (buf: Buffer) => {
    const s = buf.toString('utf8')
    if (s === '\x03' || s === '\x04') return quit()
    if (s === ESC) return interrupt()
    if (s.startsWith(ESC)) return // arrows and other sequences
    if (mode !== 'asking') return
    for (const ch of s) {
      if (ch === '\r' || ch === '\n') return submit()
      if (ch === '\x7f') {
        if (draft) { draft = draft.slice(0, -1); out('\b \b') }
      } else if (ch >= ' ') {
        draft += ch
        out(ch)
      }
    }
  })
  status()
}
