#!/usr/bin/env -S RUST_LOG=error bun
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const HELP = `testdeck: a watch-mode dashboard for bun test, painted by GPUIX

usage
  testdeck [dir] [options]

options
  -t, --test <regex>   only run tests whose name matches
      --failed         open on the Failed filter
      --no-watch       run once, don't re-run on save
      --window         open a native window instead of the terminal
  -h, --help           show this help

keys
  j/k ↑/↓ move   / filter   1-4 all/failed/passed/skipped
  f rerun failed   r run all   w toggle watch   n next stack frame   ctrl-c quit
`

const argv = process.argv.slice(2)
let dir = '.'
let namePattern: string | undefined
let watch = true
let failed = false
let windowed = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '-h' || a === '--help') {
    process.stdout.write(HELP)
    process.exit(0)
  } else if (a === '-t' || a === '--test') namePattern = argv[++i]
  else if (a === '--no-watch') watch = false
  else if (a === '--failed') failed = true
  else if (a === '--window') windowed = true
  else if (a.startsWith('-')) {
    process.stderr.write(`testdeck: unknown option ${a}\n\n${HELP}`)
    process.exit(2)
  } else dir = a
}
dir = resolve(dir)
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  process.stderr.write(`testdeck: ${dir} is not a directory\n`)
  process.exit(2)
}

const background = process.env.GPUIX_BACKGROUND === '1'
const tty = process.stdout.isTTY === true && process.stdin.isTTY === true
const env = process.env
// GPUIX 0.11 paints over the kitty graphics protocol, which only kitty and Ghostty implement.
const kittyGraphics = env.GPUIX_TERMINAL === '1' || env.TERM === 'xterm-ghostty' || env.TERM === 'xterm-kitty' || env.TERM_PROGRAM === 'ghostty' || !!env.KITTY_WINDOW_ID
const terminal = !windowed && !background && tty && env.GPUIX_TERMINAL !== '0' && kittyGraphics
if (!windowed && !background && tty && !kittyGraphics) {
  process.stderr.write(`testdeck: ${env.TERM_PROGRAM ?? env.TERM ?? 'this terminal'} has no kitty graphics support, opening a window instead (force with GPUIX_TERMINAL=1)\n`)
}

// GPUIX holds stdout until exit in terminal mode; keep its startup chatter out of the restored shell.
process.env.RUST_LOG ??= 'error'
const log = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return
  log(...args)
}

const { start } = await import('./src/main')
start({ dir, watch, namePattern, initialFilter: failed ? 'fail' : 'all' }, { terminal, background })
