#!/usr/bin/env -S RUST_LOG=error bun
import { parseArgs } from 'util'
import { readFileSync } from 'fs'
import { initialSessions, MODES, type AgentMode } from './src/data'
import { filterSessions } from './src/state'
import { DevinClient, loadConfig } from './src/api'
import { resolveTheme } from './src/theme'

const HELP = `devin-tui: the Devin web app, GPU-painted inside your terminal (GPUIX + kitty graphics)

Usage
  devin-tui [options] [prompt]

Arguments
  prompt              start a new Devin session with this prompt

Options
  -s, --session <q>   open the first session matching <q> (title or repo)
  -m, --mode <mode>   agent mode for new sessions: normal | fast | ultra
  -r, --repo <repo>   repository for new sessions (owner/name)
  -t, --theme <name>  light | dark | auto (default: follow Ghostty's theme)
      --demo          use scripted demo data instead of the Devin API
  -w, --window        open a native window instead of painting into the terminal
  -h, --help          show this help

Auth
  Live mode talks to the Devin API (v3). Set DEVIN_API_KEY (a personal access
  token) and DEVIN_ORG_ID, or put {"apiKey", "orgId"} in
  ~/.config/devin-tui/config.json. Without them the app runs on demo data.

Runs in Ghostty or kitty. Split the pane and the app reflows; Ctrl-C quits.

Examples
  devin-tui
  devin-tui -s terraform
  devin-tui -t light -m fast "Summarize the open PRs in acme/api"
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
      repo: { type: 'string', short: 'r' },
      theme: { type: 'string', short: 't' },
      demo: { type: 'boolean' },
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

const config = values.demo ? null : loadConfig()
const client = config ? new DevinClient(config) : null

let initialSelected: string | null = 's-rate-limit'
if (values.session && !client) {
  const match = filterSessions(initialSessions(), values.session)[0]
  if (!match) fail(`no session matches "${values.session}"`)
  initialSelected = match.id
}

if (values.theme && !['light', 'dark', 'auto'].includes(values.theme)) fail(`unknown theme "${values.theme}"`)
let ghosttyConfig = ''
try {
  ghosttyConfig = readFileSync(`${process.env.HOME}/.config/ghostty/config`, 'utf8')
} catch {}
const theme = resolveTheme(values.theme, ghosttyConfig)

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
render(
  <DevinApp
    client={client}
    sessionQuery={client ? values.session : undefined}
    initialSelected={client ? null : initialSelected}
    initialMode={mode}
    initialPrompt={prompt}
    initialRepo={values.repo}
    theme={theme}
    userName={process.env.DEVIN_TUI_NAME ?? 'Nader Dabit'}
  />,
  {
  title: 'Devin',
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 600,
  titlebarTransparent: true,
  trafficLightX: 18,
  trafficLightY: 18,
  windowBackground: theme === 'light' ? '#ffffff' : '#0a0c10',
  terminal: !windowMode,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  onKeyDown: handleWindowKey,
  debugFrameOverlay: process.env.GPUIX_DEBUG_OVERLAY === '1' ? 'full' : undefined,
  },
)
