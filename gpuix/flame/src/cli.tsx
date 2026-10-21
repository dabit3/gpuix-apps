#!/usr/bin/env -S RUST_LOG=warn bun
import { render } from '@gpuix/react'
import { existsSync } from 'node:fs'
import { FlameApp, type Order, type View } from './app.tsx'
import { watchProfile } from './watch.ts'

const HELP = `flame: interactive CPU profile flamegraphs, painted by the GPU in your terminal

usage
  flame [options] <profile.cpuprofile>

options
  -v, --view <flame|icicle|sandwich>   start view (default flame)
  -o, --order <heavy|time>             left-heavy merge or time order (default heavy)
  -s, --search <text>                  highlight matching frames
  -w, --window                         open a native macOS window instead
  -t, --terminal                       force terminal mode (kitty graphics protocol)
  -h, --help                           show this help

make a profile
  bun --cpu-prof --cpu-prof-name app.cpuprofile app.ts
  node --cpu-prof --cpu-prof-name=app.cpuprofile app.js

keys
  click zoom · scroll zoom/pan · esc back · r reset · / search
  f flame · i icicle · s sandwich · t toggle order · ctrl-c quit

The file is watched: re-run the profiler and flame reloads in place.
Runs in Ghostty and kitty (not tmux).`

const args = process.argv.slice(2)
let view: View = 'flame'
let order: Order = 'heavy'
let search = ''
let mode: 'auto' | 'window' | 'terminal' = 'auto'
let file: string | undefined
const fail = (msg: string): never => {
  console.error(`flame: ${msg}\nrun \`flame --help\` for usage`)
  process.exit(1)
}
for (let i = 0; i < args.length; i++) {
  const a = args[i]!
  const val = () => args[++i] ?? fail(`${a} needs a value`)
  if (a === '-h' || a === '--help') {
    console.log(HELP)
    process.exit(0)
  } else if (a === '-v' || a === '--view') {
    const v = val()
    if (v !== 'flame' && v !== 'icicle' && v !== 'sandwich') fail(`unknown view "${v}"`)
    view = v as View
  } else if (a === '-o' || a === '--order') {
    const v = val()
    if (v !== 'heavy' && v !== 'time') fail(`unknown order "${v}"`)
    order = v as Order
  } else if (a === '-s' || a === '--search') search = val()
  else if (a === '-w' || a === '--window') mode = 'window'
  else if (a === '-t' || a === '--terminal') mode = 'terminal'
  else if (a.startsWith('-')) fail(`unknown option ${a}`)
  else file = a
}
if (!file) fail('missing <profile.cpuprofile>')
if (!existsSync(file!)) fail(`no such file: ${file}`)
if (!process.stdin.isTTY && mode !== 'window' && !process.env.GPUIX_BACKGROUND) fail('stdin is not a terminal (pass a file path; do not pipe into flame)')

let source: ReturnType<typeof watchProfile>
try {
  source = watchProfile(file!)
} catch (e) {
  fail(`could not read ${file}: ${(e as Error).message}`)
}

const termEnv = /ghostty|kitty/i.test(`${process.env.TERM_PROGRAM ?? ''} ${process.env.TERM ?? ''}`) || process.env.GPUIX_TERMINAL === '1'
const terminal = mode === 'terminal' || (mode === 'auto' && termEnv && !process.env.GPUIX_BACKGROUND)

// Keep the restored shell clean: GPUIX prints mount logs to stdout.
const log = console.log
console.log = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return
  log(...a)
}

render(<FlameApp source={source!} initialView={view} initialOrder={order} initialQuery={search} />, {
  terminal,
  title: `flame · ${file!.split('/').pop()}`,
  width: 1320,
  height: 840,
  titlebarTransparent: true,
  focus: process.env.GPUIX_BACKGROUND !== '1',
})
