#!/usr/bin/env -S RUST_LOG=error bun
import { parseArgs } from 'node:util'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const HELP = `advisor: set up a three-tier Claude Code workflow (Sonnet builder, Haiku scouts, Opus advisor)
in a repo, then dry-run it and watch which agents ran, their tokens and the advisor's verdicts.

Usage: advisor [repo] [options]

Arguments:
  repo                  repository to configure (default: .)

Options:
  -e, --engine <name>   claude | api | replay (default: claude if the CLI is installed, else api)
                          claude  run the dry run through \`claude -p\` with the written .claude config
                          api     run the same roles straight through the Anthropic API ($ANTHROPIC_API_KEY)
                          replay  play back a recorded \`claude -p --output-format stream-json\` run
      --replay <file>   stream-json file for --engine replay
  -t, --task <text>     dry-run task (default: the first TODO/FIXME in the repo)
  -W, --write           write the setup files on start
  -r, --run             start the dry run on start
      --window          open a native window instead of drawing in the terminal
  -h, --help            show this help
  -v, --version         print the version

Keys: w write setup · r dry run · 1/2/3 setup/run/review · ↑↓ files · q or Ctrl-C quit
Runs inside Ghostty or kitty (kitty graphics protocol).`

const { values, positionals } = parseArgs({
  args: process.argv.slice(2), allowPositionals: true, strict: true,
  options: {
    engine: { type: 'string', short: 'e' }, replay: { type: 'string' }, task: { type: 'string', short: 't' },
    write: { type: 'boolean', short: 'W' }, run: { type: 'boolean', short: 'r' }, window: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  },
})
if (values.help) { console.log(HELP); process.exit(0) }
if (values.version) { console.log('advisor 0.1.0 (gpuix 0.11.0)'); process.exit(0) }

const root = resolve(positionals[0] ?? '.')
if (!existsSync(root)) { console.error(`advisor: no such directory: ${root}`); process.exit(1) }
const terminal = !values.window
if (terminal && !process.stdin.isTTY) { console.error('advisor: needs a terminal (Ghostty or kitty) on stdin. Use --window for a native window.'); process.exit(1) }

// GPUIX's native logger reads RUST_LOG from the real process environment, so re-exec once with it pinned
// when the shebang didn't (bun src/cli.ts). Otherwise held INFO/WARN lines print under the prompt after Ctrl-C.
if (process.env.RUST_LOG !== 'error' && !process.env.ADVISOR_CHILD) {
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env: { ...process.env, ADVISOR_CHILD: '1', RUST_LOG: 'error' }, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}

const hasClaude = Bun.which('claude') != null
let engine = (values.engine ?? (values.replay ? 'replay' : hasClaude ? 'claude' : 'api')) as 'claude' | 'api' | 'replay'
if (!['claude', 'api', 'replay'].includes(engine)) { console.error(`advisor: unknown engine ${engine}`); process.exit(1) }
if (engine === 'claude' && !hasClaude) { console.error('advisor: claude CLI not found, using the Anthropic API instead'); engine = 'api' }
if (engine === 'api' && !process.env.ANTHROPIC_API_KEY) { console.error('advisor: --engine api needs $ANTHROPIC_API_KEY'); process.exit(1) }
if (engine === 'replay' && !values.replay) { console.error('advisor: --engine replay needs --replay <file>'); process.exit(1) }

const { render } = await import('@gpuix/react')
const { Store } = await import('./store')
const { App, handleKey } = await import('./app')

const store = new Store({ root, engine, task: values.task, replay: values.replay && resolve(values.replay), autoWrite: values.write, autoRun: values.run })
store.start()
// @gpuix/react logs "[gpuix] created native window / mount complete"; terminal mode replays it under the prompt on exit.
const log = console.log
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return; log(...a) }
render(<App store={store} />, {
  terminal, title: 'advisor', width: 1440, height: 900,
  onKeyDown: (e: unknown) => { handleKey(store, e as never) },
} as never)
