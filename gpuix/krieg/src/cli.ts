#!/usr/bin/env -S RUST_LOG=error bun
// krieg: procedural FPS rendered inside Ghostty/kitty by GPUIX terminal mode.
import { spawnSync } from 'node:child_process'

// GPUIX logs "[gpuix] mount complete" etc. via console.log, which terminal mode holds and prints under the prompt on exit.
const log = console.log
console.log = (...a: unknown[]) => { if (!(typeof a[0] === 'string' && a[0].startsWith('[gpuix]'))) log(...a) }

const HELP = `krieg: a .kkrieger-style procedural FPS that renders inside your terminal (Ghostty / kitty)

usage
  krieg [options]          play
  krieg map [options]      live tactical map of a running game (run it in a split pane)
  krieg size               print the size budget report (fails if the packed build is above 64 KB)
  krieg build              write the packed single-file build to dist/krieg.js

options
  -s, --seed <n>    level seed (default 1337, deterministic)
  -m, --mute        no audio (audio plays through afplay on macOS)
  -g, --god         take no damage
  -q, --scale <n>   internal resolution divisor 2|3|4 (default 2; r cycles in game)
  -w, --window      open a native window instead of painting in the terminal
  -h, --help        this help

keys
  WASD move  ·  drag look  ·  click/f fire  ·  arrows or q/e turn  ·  space jump  ·  c crouch
  1/2/3 or scroll weapon  ·  t texture lab  ·  m music  ·  p perf  ·  b bloom  ·  esc title  ·  ctrl-c quit`

const argv = process.argv.slice(2)
if (process.env.RUST_LOG !== 'error') {
  const r = spawnSync(process.execPath, [import.meta.path, ...argv], { stdio: 'inherit', env: { ...process.env, RUST_LOG: 'error' } })
  process.exit(r.status ?? 0)
}

const has = (...f: string[]) => argv.some((a) => f.includes(a))
const val = (...f: string[]) => { const i = argv.findIndex((a) => f.includes(a)); return i >= 0 ? argv[i + 1] : undefined }
if (has('-h', '--help')) { console.log(HELP); process.exit(0) }
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'play'
const seed = Number(val('-s', '--seed') ?? 1337) | 0
const terminal = !has('-w', '--window')

if (cmd === 'size') {
  const { measure, formatReport, BUDGET } = await import('./size')
  const r = await measure()
  console.log(formatReport(r))
  process.exit(r.packed > BUDGET ? 1 : 0)
} else if (cmd === 'build') {
  const { pack } = await import('./size')
  const { join } = await import('node:path')
  const out = join(import.meta.dir, '..', 'dist', 'krieg.js'), src = await pack()
  await Bun.write(out, src)
  ;(await import('node:fs')).chmodSync(out, 0o755)
  console.log(`dist/krieg.js  ${src.length} bytes`)
} else if (cmd === 'map') {
  const { render } = await import('@gpuix/react')
  const { MapApp } = await import('./map')
  const { createElement } = await import('react')
  render(createElement(MapApp, { seed }), { terminal, title: 'krieg map', width: 900, height: 700 } as never)
} else if (cmd === 'play') {
  const { render } = await import('@gpuix/react')
  const { App } = await import('./app')
  const { measure } = await import('./size')
  const { createElement } = await import('react')
  const size = await measure().then((r) => ({ bytes: r.bytes, gzip: r.gzip, packed: r.packed })).catch(() => undefined)
  const scale = Math.max(2, Math.min(4, Number(val('-q', '--scale') ?? 2) | 0))
  render(createElement(App, { opts: { seed, mute: has('-m', '--mute'), god: has('-g', '--god'), scale, size } }), { terminal, title: 'krieg', width: 1280, height: 800 } as never)
} else {
  console.error(`krieg: unknown command "${cmd}"\n\n${HELP}`)
  process.exit(2)
}
