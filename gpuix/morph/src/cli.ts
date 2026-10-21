#!/usr/bin/env -S RUST_LOG=error bun
import { parseArgs } from 'node:util'

const HELP = `morph: one shape that never cuts. A 14 s code-only UI motion piece, played live by GPUIX in your terminal.

Usage:
  morph [options]                 play it in this terminal (Ghostty or kitty)
  morph --export out.mp4          render all 840 frames offscreen and encode an MP4
  morph --check                   print the beat map and verify the timing + loop

Options:
  -e, --export <file>    frame-exact export (H.264, CRF 18, 60 fps)
  -p, --palette <name>   dark (Ghostty theme, default) or light (the brief's #EDEBE8)
  -V, --vertical         1080x1350 instead of 1080x1080
  -s, --size <px>        export width in px (default 1080)
  -f, --frame <n>        start at frame n (0-839)
      --paused           start paused
  -t, --theme <name>     Ghostty theme to paint with (default: from your Ghostty config)
  -w, --window           open a native window instead of drawing in the terminal
  -h, --help             show this help

Keys: space play/pause · ←/→ frame (shift ×10) · ↑/↓ beat · 0 start · T palette · V 4:5 · E export · ctrl-c quit`

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    export: { type: 'string', short: 'e' },
    palette: { type: 'string', short: 'p' },
    vertical: { type: 'boolean', short: 'V' },
    size: { type: 'string', short: 's' },
    frame: { type: 'string', short: 'f' },
    paused: { type: 'boolean' },
    theme: { type: 'string', short: 't' },
    window: { type: 'boolean', short: 'w' },
    check: { type: 'boolean' },
    progress: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
})

if (values.help) { console.log(HELP); process.exit(0) }
const palette = values.palette === 'light' ? 'light' : 'dark'
if (values.palette && values.palette !== 'light' && values.palette !== 'dark') { console.error(`morph: unknown palette "${values.palette}" (dark | light)`); process.exit(2) }
const aspect = values.vertical ? 'vertical' : 'square'

// Ghostty shells export RUST_LOG=info; GPUIX holds native logs until exit and would print them over the restored prompt.
if (!process.env.MORPH_CHILD && process.env.RUST_LOG !== 'error') {
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env: { ...process.env, MORPH_CHILD: '1', RUST_LOG: process.env.MORPH_LOG ?? 'error' }, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}
const log = console.log
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return; log(...a) }

const { loadTerminalTheme } = await import('./theme')
const theme = loadTerminalTheme(values.theme)

if (values.export) {
  const { exportVideo } = await import('./export')
  const tty = process.stdout.isTTY && !values.progress
  const bar = (d: number, t: number) => {
    if (values.progress) { if (d % 6 === 0 || d === t) log(`progress ${d}/${t}`); return }
    if (!tty) return
    const w = 32, k = Math.round((d / t) * w)
    process.stdout.write(`\r  rendering  ${'█'.repeat(k)}${'░'.repeat(w - k)}  ${String(d).padStart(3)}/${t} frames`)
  }
  if (tty) log(`morph → ${values.export}  (${palette}, ${aspect === 'square' ? '1080×1080' : '1080×1350'}, 60 fps, 840 frames)`)
  try {
    const r = await exportVideo({ out: values.export, palette, aspect, width: values.size ? Number(values.size) : undefined, theme, onFrame: bar })
    if (tty) process.stdout.write('\n')
    log(`${values.progress ? 'done ' : '  ✓ '}${r.out}  ${(r.bytes / 1e6).toFixed(1)} MB  in ${(r.ms / 1000).toFixed(1)} s (${(r.ms / r.frames).toFixed(1)} ms/frame)`)
    process.exit(0)
  } catch (err) {
    console.error(`morph: export failed: ${(err as Error).message}`)
    process.exit(1)
  }
}

if (values.check) {
  const { runCheck } = await import('./check')
  process.exit(await runCheck({ palette, theme, log }))
}

const terminal = !values.window
if (terminal && !process.stdin.isTTY) {
  console.error('morph: needs a terminal on stdin (Ghostty or kitty). Use --window for a native window, or --export.')
  process.exit(1)
}
const { Controller } = await import('./controller')
const { start } = await import('./app')
const { spawnExport } = await import('./spawn-export')
const c = new Controller({ palette, aspect, frame: values.frame ? Number(values.frame) : 0, paused: values.paused })
c.onExport = () => spawnExport(c, values.theme)
start(c, theme, { terminal })
