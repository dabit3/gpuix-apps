#!/usr/bin/env -S RUST_LOG=error bun
import { parseArgs } from './src/cli'

const HELP = `crawler: a procedurally animated spider that crawls a web page, inside your terminal (GPUIX + Ghostty)

usage
  crawler [url] [options]      open a page (default: a mock search results page) and release spiders
  crawler feed [n]             drop n flies into every running crawler (default 5)
  crawler spawn [n]            lower n more spiders on silk (default 1)
  crawler web                  ask a spider to build a web in a corner
  crawler open <url>           make every running crawler navigate to <url>
  crawler still on|off         reduced-motion mode

options
  -n, --spiders <n>            spiders to start with (default 1)
  -r, --still                  reduced motion: spiders sit still and blink
  -x, --chaos                  spiders follow the links they index
  -w, --window                 open a native window instead of painting in the terminal
  -h, --help                   show this help

keys
  click empty space  feed a fly        click a spider  it plays dead
  f flies  s spawn  w web  c curious (follow the cursor)  x chaos  r still  b back
  j/k/space scroll   ctrl-c quit

Terminal mode needs Ghostty or kitty (kitty graphics protocol).`

const args = parseArgs(process.argv.slice(2))
if (args.kind === 'help') {
  console.log(HELP)
} else if (args.kind === 'error') {
  console.error(`crawler: ${args.message}\n\n${HELP}`)
  process.exit(2)
} else if (args.kind === 'command') {
  const { broadcast } = await import('./src/ipc')
  const n = await broadcast(args.command)
  if (n === 0) {
    console.error('crawler: no running crawler found (start one with `crawler` in a Ghostty pane)')
    process.exit(1)
  }
  console.log(`${describe(args.command)} → ${n} crawler${n === 1 ? '' : 's'}`)
} else {
  const { render } = await import('@gpuix/react')
  const { App } = await import('./src/app')
  const o = args.options
  const quiet = console.log
  console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return; quiet(...a) }
  const log = process.env.CRAWLER_FPS_LOG
  const { appendFileSync } = await import('node:fs')
  const onFrame = log ? (fps: number) => appendFileSync(log, `${fps.toFixed(1)}\n`) : undefined
  render(<App url={o.url} spiders={o.spiders} still={o.still} chaos={o.chaos} ipc onFrame={onFrame} />, o.window
    ? { title: 'crawler', width: 1280, height: 820 }
    : { terminal: true })
}

function describe(c: import('./src/ipc').Command) {
  switch (c.cmd) {
    case 'feed': return `🪰 ×${c.n}`
    case 'spawn': return `🕷 ×${c.n}`
    case 'web': return 'web'
    case 'open': return `open ${c.url}`
    case 'still': return `still ${c.on ? 'on' : 'off'}`
  }
}
