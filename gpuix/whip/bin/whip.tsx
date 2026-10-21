#!/usr/bin/env -S RUST_LOG=error bun
import { HELP, parseArgs } from '../src/args'

const args = parseArgs(process.argv.slice(2))

if (args.mode === 'help') {
  console.log(HELP)
  process.exit(0)
}
if (args.mode === 'version') {
  console.log('whip 0.1.0')
  process.exit(0)
}
if (args.mode === 'leash') {
  const { runLeash } = await import('../src/leash')
  process.exit(await runLeash(args.command))
}

const term = process.env.TERM ?? ''
const prog = process.env.TERM_PROGRAM ?? ''
if (!(prog === 'ghostty' || term.includes('kitty') || term.includes('ghostty') || process.env.KITTY_WINDOW_ID || process.env.GPUIX_TERMINAL === '0')) {
  console.error('whip paints with the kitty graphics protocol: run it in Ghostty or kitty (not tmux or an editor terminal).')
  process.exit(1)
}

// GPUIX replays held stdout after exit; keep its own startup chatter out of it.
const log = console.log
console.log = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return
  log(...a)
}

const { render } = await import('@gpuix/react')
const { App } = await import('../src/app')
render(
  <App armed={args.armed} polite={args.polite} sound={args.sound} length={args.length} intro={args.intro} targets={args.targets} />,
  {
    title: 'whip',
    terminal: process.env.GPUIX_TERMINAL !== '0',
    onKeyDown: (e) => (globalThis as any).__whipKey?.(e),
  },
)
