#!/usr/bin/env bun
import { parseArgs } from 'node:util'

const HELP = `caustic: real-time water caustics in your terminal, drawn by GPUIX

Usage: caustic [options]
       caustic drop [x z] [-n count]   drop ripples into every running caustic
       caustic rain on|off             start or stop rain in every running caustic

Options:
  -q, --quality <lite|full>  start quality (default lite)
  -r, --rain                 start with rain on
      --no-ball              start without the floating ball
      --sun <deg>            sun elevation, 30-88 (default 64)
  -d, --depth <m>            water depth, 0.45-1.6 (default 1.0)
  -t, --theme <name>         Ghostty theme to paint with (default: your Ghostty config)
      --workers <n>          ray-trace worker threads (default: half the cores, max 6)
      --solo                 don't share ripples with other caustic panes
  -w, --window               open a native window instead of drawing in the terminal
  -h, --help                 show this help
  -v, --version              print the version

Runs inside Ghostty or kitty (kitty graphics protocol). Ctrl-C quits.
Mouse: drag water = ripples · drag ball = push · drag deck = orbit · scroll = zoom
Keys: 1/2 LITE/FULL · R rain · B ball · V shafts · space pause · [ ] sun · - = depth · S snapshot · H help`

const argv = process.argv.slice(2)

if (argv[0] === 'drop' || argv[0] === 'rain') {
  const { broadcast } = await import('./link')
  let msg
  if (argv[0] === 'rain') {
    const on = argv[1] !== 'off'
    msg = { from: process.pid, settings: { rain: on } }
  } else {
    const { values, positionals } = parseArgs({ args: argv.slice(1), options: { count: { type: 'string', short: 'n' } }, allowPositionals: true, allowNegative: true } as never) as { values: { count?: string }; positionals: string[] }
    const n = Math.max(1, Math.min(64, Number(values.count ?? 1)))
    const at = positionals.map(Number)
    const ripples = Array.from({ length: n }, () => ({
      x: Number.isFinite(at[0]) ? at[0]! : Math.random() * 1.6 - 0.8,
      z: Number.isFinite(at[1]) ? at[1]! : Math.random() * 1.6 - 0.8,
      r: 0.08, s: 0.035,
    }))
    msg = { from: process.pid, ripples }
  }
  const reached = await broadcast(msg)
  console.log(reached ? `caustic: sent to ${reached} pane${reached > 1 ? 's' : ''}` : 'caustic: no running caustic found')
  process.exit(reached ? 0 : 1)
}

const { values } = parseArgs({
  args: argv,
  options: {
    quality: { type: 'string', short: 'q' },
    rain: { type: 'boolean', short: 'r' },
    'no-ball': { type: 'boolean' },
    sun: { type: 'string' },
    depth: { type: 'string', short: 'd' },
    theme: { type: 'string', short: 't' },
    workers: { type: 'string' },
    solo: { type: 'boolean' },
    window: { type: 'boolean', short: 'w' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: true,
})

if (values.help) { console.log(HELP); process.exit(0) }
if (values.version) { console.log('caustic 0.1.0 (gpuix 0.11.0)'); process.exit(0) }
if (values.quality && values.quality !== 'lite' && values.quality !== 'full') { console.error(`caustic: --quality must be lite or full`); process.exit(2) }

const terminal = !values.window
if (terminal && !process.stdin.isTTY) {
  console.error('caustic: needs a terminal on stdin (Ghostty or kitty). Use --window for a native window.')
  process.exit(1)
}

// GPUIX's env_logger prints held INFO/WARN lines under the prompt after Ctrl-C. It reads RUST_LOG from the real process
// environment (setting process.env at runtime doesn't reach it), so re-exec once with it pinned. CAUSTIC_LOG opts back in.
if (!process.env.CAUSTIC_CHILD) {
  const env = { ...process.env, CAUSTIC_CHILD: '1', RUST_LOG: process.env.CAUSTIC_LOG ?? 'error' }
  const child = Bun.spawn([process.execPath, import.meta.path, ...argv], { env, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}
const log = console.log
console.log = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return; log(...args) }

const { loadGhosttyTheme, rgb } = await import('./theme')
const { workerSource } = await import('./source')
const { Link } = await import('./link')
const { start } = await import('./app')

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const initial = {
  quality: (values.quality ?? 'lite') as 'lite' | 'full',
  rain: !!values.rain,
  ball: !values['no-ball'],
  ...(values.sun ? { sunElev: clamp(Number(values.sun), 30, 88) } : {}),
  ...(values.depth ? { depth: clamp(Number(values.depth), 0.45, 1.6) } : {}),
}
const theme = loadGhosttyTheme(values.theme)
const source = workerSource(initial, rgb(theme.bg), values.workers ? Number(values.workers) : undefined)

let link: InstanceType<typeof Link> | null = null
if (!values.solo) {
  link = new Link((m) => {
    if (m.ripples?.length) source.post({ type: 'drops', ripples: m.ripples })
    if (m.settings) {
      const { controls } = require('./app') as typeof import('./app')
      controls.current?.set(m.settings)
    }
  })
}

const started = Date.now()
process.on('exit', () => {
  link?.close()
  log(`caustic: ${((Date.now() - started) / 1000).toFixed(0)} s of water`)
})

start({ source, theme, initial, onRipples: link ? (r) => void link!.send({ ripples: r }) : undefined, peers: link ? () => link!.peerCount : undefined }, { terminal })
