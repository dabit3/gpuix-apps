#!/usr/bin/env -S RUST_LOG=error bun
import { parseArgs } from 'util'
import { initialSessions, MODES, type AgentMode } from './src/data'
import { filterSessions } from './src/state'

const HELP = `devin-tui: the Devin web app, GPU-painted inside your terminal (GPUIX + kitty graphics)

Usage
  devin-tui [options] [prompt]

Arguments
  prompt              start a new session with this prompt and stream the run

Options
  -s, --session <q>   open the first session matching <q> (title, repo or branch)
  -m, --mode <mode>   agent mode for new sessions: normal | fast | ultra
  -w, --window        open a native window instead of painting into the terminal
  -h, --help          show this help

Runs in Ghostty or kitty. Split the pane and the app reflows; Ctrl-C quits.

Examples
  devin-tui
  devin-tui -s terraform
  devin-tui -m ultra "Add dark mode to the settings page"
`

function fail(message: string): never {
  process.stderr.write(`devin-tui: ${message}\n\n${HELP}`)
  process.exit(2)
}

let parsed: ReturnType<typeof parse>
function parse() {
  return parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      session: { type: 'string', short: 's' },
      mode: { type: 'string', short: 'm' },
      window: { type: 'boolean', short: 'w' },
      help: { type: 'boolean', short: 'h' },
    },
  })
}
try {
  parsed = parse()
} catch (error) {
  fail((error as Error).message)
}
const { values, positionals } = parsed

if (values.help) {
  process.stdout.write(HELP)
  process.exit(0)
}

const mode = (values.mode ?? 'normal').toLowerCase() as AgentMode
if (!MODES.some((m) => m.value === mode)) fail(`unknown mode "${values.mode}"`)

let initialSelected: string | null = 's-rate-limit'
if (values.session) {
  const match = filterSessions(initialSessions(), values.session)[0]
  if (!match) fail(`no session matches "${values.session}"`)
  initialSelected = match.id
}

const prompt = positionals.join(' ').trim() || undefined
const windowMode = values.window || process.env.GPUIX_WINDOW === '1'

// Terminal mode holds stdout/stderr until exit; keep the restored prompt clean unless asked.
// (The shebang sets RUST_LOG=error for the native side; it is read before JS runs.)
if (!process.env.GPUIX_VERBOSE) {
  const log = console.log
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return
    log(...args)
  }
}

const { applyMacCpuThrottleFromEnv, render } = await import('@gpuix/react')
const { DevinApp, handleWindowKey } = await import('./src/App')

applyMacCpuThrottleFromEnv()
render(<DevinApp initialSelected={initialSelected} initialMode={mode} initialPrompt={prompt} />, {
  title: 'Devin',
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 600,
  titlebarTransparent: true,
  trafficLightX: 18,
  trafficLightY: 18,
  windowBackground: '#0a0c10',
  terminal: !windowMode,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  onKeyDown: handleWindowKey,
  debugFrameOverlay: process.env.GPUIX_DEBUG_OVERLAY === '1' ? 'full' : undefined,
})
