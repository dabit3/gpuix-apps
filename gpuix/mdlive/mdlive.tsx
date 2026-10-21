#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const HELP = `mdlive: live Markdown preview, rendered inside your terminal

usage
  mdlive [file.md] [options]

  file.md          markdown file to watch (default: README.md)

options
  -w, --wide       wide reading mode (default: narrow column)
      --no-toc     hide the table of contents
      --no-follow  don't scroll to the block you just edited
      --window     open a native macOS window instead of the terminal
  -h, --help       show this help
  -v, --version    print version

keys
  /  find      w  wide/narrow   t  contents   f  follow edits
  j k  scroll  space  page      [ ]  prev/next section   ^C  quit

Runs in Ghostty or kitty (kitty graphics protocol). Edit the file in another
pane or editor; mdlive re-renders on every save.`

type Args = { file: string; wide: boolean; toc: boolean; follow: boolean; window: boolean }

export function parseArgs(argv: string[]): Args | { exit: number; out: string } {
  const a: Args = { file: 'README.md', wide: false, toc: true, follow: true, window: false }
  let gotFile = false
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') return { exit: 0, out: HELP }
    if (arg === '-v' || arg === '--version') return { exit: 0, out: 'mdlive 0.1.0' }
    if (arg === '-w' || arg === '--wide') a.wide = true
    else if (arg === '--no-toc') a.toc = false
    else if (arg === '--no-follow') a.follow = false
    else if (arg === '--window') a.window = true
    else if (arg.startsWith('-')) return { exit: 2, out: `mdlive: unknown option ${arg}\n\n${HELP}` }
    else if (!gotFile) {
      a.file = arg
      gotFile = true
    } else return { exit: 2, out: `mdlive: one file at a time (got ${arg})` }
  }
  return a
}

if (import.meta.main) {
  const parsed = parseArgs(process.argv.slice(2))
  if ('exit' in parsed) {
    ;(parsed.exit ? console.error : console.log)(parsed.out)
    process.exit(parsed.exit)
  }
  const file = resolve(parsed.file)
  if (!existsSync(file) && !parsed.window && process.argv.slice(2).every((x) => x.startsWith('-'))) {
    console.error(`mdlive: no README.md here. Pass a file: mdlive notes.md`)
    process.exit(1)
  }
  const terminal = !parsed.window && process.env.GPUIX_BACKGROUND !== '1'
  if (terminal && !process.stdin.isTTY) {
    console.error('mdlive: needs a terminal (Ghostty or kitty). Use --window for a native window.')
    process.exit(1)
  }
  // GPUIX holds stderr while the terminal UI runs and replays it on exit, and its
  // native logger ignores RUST_LOG. Run the UI in a child whose stderr goes to a
  // log file, so Ctrl-C lands on a clean prompt; show the log only on failure.
  if (terminal && !process.env.MDLIVE_UI) {
    const { openSync, readFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const logPath = resolve(tmpdir(), `mdlive-${process.pid}.log`)
    const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], {
      env: { ...process.env, MDLIVE_UI: '1' },
      stdio: ['inherit', 'inherit', openSync(logPath, 'w')],
    })
    process.on('SIGINT', () => {})
    const code = await child.exited
    if (code !== 0 && code !== 130) process.stderr.write(readFileSync(logPath, 'utf8'))
    rmSync(logPath, { force: true })
    process.exit(code)
  }
  // Keep the restored shell clean: GPUIX holds stdout/stderr while the terminal
  // UI runs and replays them on exit, so drop its startup chatter and font warnings.
  process.env.RUST_LOG ??= 'error'
  const log = console.log
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return
    log(...args)
  }
  const { render } = await import('@gpuix/react')
  const { App, keyBus } = await import('./src/App')
  render(<App file={file} wide={parsed.wide} toc={parsed.toc} follow={parsed.follow} />, {
    title: `mdlive — ${parsed.file}`,
    terminal,
    width: 1200,
    height: 860,
    titlebarTransparent: true,
    trafficLightX: 16,
    trafficLightY: 14,
    focus: process.env.GPUIX_BACKGROUND !== '1',
    onKeyDown: (event) => keyBus.handler?.(event),
  })
}
