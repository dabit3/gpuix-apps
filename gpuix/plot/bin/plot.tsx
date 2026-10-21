#!/usr/bin/env -S RUST_LOG=error bun
import { existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'

const HELP = `plot: live GPU charts in your terminal (GPUIX + kitty graphics)

usage
  plot [options] -- <command> [args…]   chart the numbers a command prints as it runs
  plot [options] <file.csv>             chart a CSV / TSV / log file and follow appends

examples
  plot -- ping -i 0.2 1.1.1.1
  plot -c us,sy -- iostat -w 1
  plot -c free,active -- vm_stat 1
  plot traffic.csv

options
  -c, --columns a,b    only these series (names from key=value pairs or the header row)
  -w, --window <sec>   seconds of live data on screen (default 60; files show everything)
  -m, --mode <m>       line | area | bar (default line)
  -t, --title <text>   label in the header instead of the command
      --csv            parse the file/command output as CSV
      --no-pty         don't run the command under a pty (output may arrive in blocks)
      --native         open a native window instead of rendering in the terminal
  -h, --help           this help

keys
  space pause · drag zoom · scroll pan · ⌥/ctrl-scroll zoom · ←/→ pan · ↑/↓ zoom
  l/a/b or m chart style · 1–9 toggle series · e export PNG · r reset · q / ctrl-c quit

Works in Ghostty and kitty. Don't pipe into plot; pass a command or a file instead.`

function fail(msg: string): never {
  process.stderr.write(`plot: ${msg}\n\nRun plot --help for usage.\n`)
  process.exit(2)
}

const argv = process.argv.slice(2)
const opts: { columns?: string[]; window?: number; mode?: 'line' | 'area' | 'bar'; title?: string; csv?: boolean; pty: boolean; native: boolean } = { pty: true, native: false }
const rest: string[] = []
let command: string[] | null = null
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!
  const val = () => argv[++i] ?? fail(`${a} needs a value`)
  if (a === '--') {
    command = argv.slice(i + 1)
    break
  } else if (a === '-h' || a === '--help') {
    console.log(HELP)
    process.exit(0)
  } else if (a === '-c' || a === '--columns') opts.columns = val().split(',').map((s) => s.trim()).filter(Boolean)
  else if (a === '-w' || a === '--window') {
    opts.window = Number(val())
    if (!(opts.window > 0)) fail('--window must be a positive number of seconds')
  } else if (a === '-m' || a === '--mode') {
    const m = val()
    if (m !== 'line' && m !== 'area' && m !== 'bar') fail(`unknown mode "${m}"`)
    opts.mode = m
  } else if (a === '--line' || a === '--area' || a === '--bar') opts.mode = a.slice(2) as 'line'
  else if (a === '-t' || a === '--title') opts.title = val()
  else if (a === '--csv') opts.csv = true
  else if (a === '--no-pty') opts.pty = false
  else if (a === '--native') opts.native = true
  else if (a.startsWith('-') && a !== '-') fail(`unknown option ${a}`)
  else {
    // `plot ping 1.1.1.1` works too: anything that isn't an existing file is a command.
    if (!rest.length && !existsSync(a)) {
      command = argv.slice(i)
      break
    }
    rest.push(a)
  }
}

if (!command && !rest.length) {
  console.log(HELP)
  process.exit(process.stdin.isTTY ? 0 : 2)
}
if (command && !command.length) fail('nothing to run after --')
if (rest.length > 1) fail('plot takes one file')
if (!process.stdin.isTTY && !opts.native && !process.env.GPUIX_BACKGROUND) fail("stdin isn't a terminal. Pass a command (plot -- cmd) or a file instead of piping into plot.")

const file = rest[0]
if (file && statSync(file).isDirectory()) fail(`${file} is a directory`)

// Quiet the renderer's own startup logs; they'd be printed over the prompt after quitting.
process.env.RUST_LOG ??= 'error'
const log = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return
  log(...args)
}

const [{ render }, { PlotApp }, { Plotter }, { commandSource, fileSource }, { formatValue, stats }] = await Promise.all([
  import('@gpuix/react'),
  import('../src/app'),
  import('../src/plotter'),
  import('../src/sources'),
  import('../src/series'),
])

const csv = opts.csv ?? (file ? ['.csv', '.tsv'].includes(extname(file).toLowerCase()) : false)
const plotter = new Plotter({ label: opts.title, csv, columns: opts.columns, window: opts.window, chart: opts.mode })
plotter.attach(command ? commandSource(command, { pty: opts.pty && process.platform === 'darwin' }) : fileSource(file!))

let summarized = false
const summary = () => {
  if (summarized) return
  summarized = true
  plotter.stop()
  const lines = plotter.visibleSeries().map((s) => {
    const st = stats(s)!
    return `  ${s.name.padEnd(12)} n=${st.n}  min ${formatValue(st.min, s.unit)}  avg ${formatValue(st.avg, s.unit)}  p95 ${formatValue(st.p95, s.unit)}  max ${formatValue(st.max, s.unit)}`
  })
  if (plotter.saved) lines.push(`  saved ${plotter.saved}`)
  if (lines.length) process.stdout.write(`plot ${plotter.label}\n${lines.join('\n')}\n`)
}
process.on('exit', summary)

render(
  <PlotApp
    plotter={plotter}
    onQuit={() => {
      summary()
      process.exit(0)
    }}
  />,
  {
    terminal: !opts.native,
    title: `plot ${plotter.label}`,
    width: 1280,
    height: 800,
    focus: process.env.GPUIX_BACKGROUND !== '1',
  },
)
