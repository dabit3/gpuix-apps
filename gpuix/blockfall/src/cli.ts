#!/usr/bin/env bun
import { parseArgs } from 'node:util'

const HELP = `blockfall: falling blocks for your terminal split, drawn by GPUIX

Usage: blockfall [options]

Options:
  -l, --level <n>     starting level, 1-15 (default 1)
  -s, --seed <n>      piece sequence seed (default: random)
  -t, --theme <name>  Ghostty theme to paint with (default: your Ghostty config)
      --scores <file> high-score file (default: ~/Library/Application Support/blockfall/scores.json)
      --das <ms>      delayed auto shift (default 133)
      --arr <ms>      auto repeat rate, 0 = instant (default 33)
  -w, --window        open a native window instead of drawing in the terminal
  -h, --help          show this help
  -v, --version       print the version

Runs inside Ghostty or kitty (kitty graphics protocol). Ctrl-C quits.
Keys: ← → move · ↓ soft drop · ↑/X rotate · Z rotate left · space hard drop · C hold · P pause · F perf`

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    level: { type: 'string', short: 'l' },
    seed: { type: 'string', short: 's' },
    theme: { type: 'string', short: 't' },
    scores: { type: 'string' },
    das: { type: 'string' },
    arr: { type: 'string' },
    window: { type: 'boolean', short: 'w' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: true,
})

if (values.help) { console.log(HELP); process.exit(0) }
if (values.version) { console.log('blockfall 0.1.0 (gpuix 0.11.0)'); process.exit(0) }

const terminal = !values.window
if (terminal && !process.stdin.isTTY) {
  console.error('blockfall: needs a terminal on stdin (Ghostty or kitty). Use --window for a native window.')
  process.exit(1)
}
const num = (v: string | undefined) => (v == null ? undefined : Number(v))

// Keep the shell clean after Ctrl-C: GPUIX holds stdout until exit and then prints its own startup lines.
process.env.RUST_LOG ??= 'error'
const log = console.log
console.log = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return; log(...args) }

const { Controller } = await import('./controller')
const { loadGhosttyTheme } = await import('./theme')
const { start } = await import('./app')

const c = new Controller({
  level: num(values.level),
  seed: num(values.seed),
  scoresFile: values.scores,
  tuning: { ...(values.das ? { das: Number(values.das) / 1000 } : {}), ...(values.arr ? { arr: Number(values.arr) / 1000 } : {}) },
})
const theme = loadGhosttyTheme(values.theme)

process.on('exit', () => {
  const g = c.game
  if (c.mode !== 'title' && g.score > 0) log(`blockfall: ${g.score.toLocaleString('en-US')} points · ${g.lines} lines · level ${g.level}  (best ${c.best.toLocaleString('en-US')})`)
})

start(c, theme, { terminal })
