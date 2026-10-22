#!/usr/bin/env -S RUST_LOG=off bun
import { existsSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const HELP = `yard: a Miller-column file manager GUI that runs in your terminal

Usage
  yard [dir]           open dir (default: current directory)

Options
  -a, --all            show hidden files
  -w, --window         open a native window instead of the terminal
  -h, --help           show this help

Keys
  h j k l / arrows     navigate        space   select     a  select all
  y  copy   x  cut     p  paste        r  rename          d  trash
  /  fuzzy jump        .  hidden files n  new folder      ~  home
  q / ctrl-c           quit

Runs inside Ghostty or kitty through the Kitty Graphics protocol.`

const args = process.argv.slice(2)
if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP)
  process.exit(0)
}
const dirArg = args.find((a) => !a.startsWith('-'))
// Prefer the shell's $PWD so symlinked folders keep the path the user typed.
const pwd = process.env.PWD && existsSync(process.env.PWD) && realpathSync(process.env.PWD) === process.cwd() ? process.env.PWD : process.cwd()
const start = resolve(pwd, dirArg ?? '.')
if (!existsSync(start) || !statSync(start).isDirectory()) {
  console.error(`yard: not a directory: ${dirArg}`)
  process.exit(1)
}
const windowed = args.includes('-w') || args.includes('--window')
const showHidden = args.includes('-a') || args.includes('--all')

// GPUIX prints mount logs to stdout; terminal mode replays them on exit, so keep the shell clean.
const log = console.log
console.log = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return
  log(...a)
}

const [{ render }, { createElement }, { Yard }] = await Promise.all([import('@gpuix/react'), import('react'), import('../src/Yard')])
render(createElement(Yard, { start, showHidden }), {
  terminal: !windowed,
  title: 'yard',
  width: 1240,
  height: 780,
  titlebarTransparent: true,
  focus: process.env.GPUIX_BACKGROUND !== '1',
})
