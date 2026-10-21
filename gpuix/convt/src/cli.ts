#!/usr/bin/env bun
import { parseArgs } from 'node:util'

const HELP = `convt: convert local files from your terminal, drawn by GPUIX

Usage: convt [options] <file|dir>...

Detects each file by its magic bytes, shows the formats it can become, previews
lossy settings live, and writes name.converted.ext next to the original.
Everything runs locally (ffmpeg, sips, cwebp, pandoc, textutil, typst). No network.

Options:
  -t, --to <fmt>       preselect a target for matching files (e.g. webp, mp4, mp3, pdf)
  -q, --quality <n>    starting quality, 1-100
  -j, --jobs <n>       parallel conversions (default: CPU cores - 1)
  -w, --watch          watch directory arguments and add new files as they appear
  -y, --yes            convert everything immediately with the defaults, then stay open
      --theme <name>   Ghostty theme to paint with (default: your Ghostty config)
      --window         open a native window instead of drawing in the terminal
  -h, --help           show this help
  -v, --version        print the version

Keys: ↑↓ file · space select · a all · ←→ format · - = quality · 1 2 3 presets
      m max size · s strip metadata · ⏎ convert · x cancel · esc cancel all · o reveal
Runs inside Ghostty or kitty (kitty graphics protocol). Ctrl-C quits.`

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    to: { type: 'string', short: 't' },
    quality: { type: 'string', short: 'q' },
    jobs: { type: 'string', short: 'j' },
    watch: { type: 'boolean', short: 'w' },
    yes: { type: 'boolean', short: 'y' },
    theme: { type: 'string' },
    window: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  allowPositionals: true,
  strict: true,
})

if (values.help) { console.log(HELP); process.exit(0) }
if (values.version) { console.log('convt 0.1.0 (gpuix 0.11.0)'); process.exit(0) }
if (!positionals.length) { console.error('convt: give it some files or a folder, e.g. convt ~/Downloads/*.heic\n\n' + HELP); process.exit(2) }

const terminal = !values.window
if (terminal && !process.stdin.isTTY) {
  console.error('convt: needs a terminal on stdin (Ghostty or kitty). Pass files as arguments, not on stdin. Use --window for a native window.')
  process.exit(1)
}

// GPUIX's native logger reads RUST_LOG from the real process environment and replays held INFO/WARN lines after exit,
// so re-exec once with it pinned. CONVT_LOG=<filter> opts back into logs.
if (!process.env.CONVT_CHILD) {
  const env = { ...process.env, CONVT_CHILD: '1', RUST_LOG: process.env.CONVT_LOG ?? 'error' }
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}
const log = console.log
console.log = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return; log(...args) }

const { detectEngines } = await import('./engines')
const { Store } = await import('./store')
const { loadGhosttyTheme } = await import('./theme')
const { TARGETS } = await import('./formats')
const { start } = await import('./app')

const theme = loadGhosttyTheme(values.theme)
const jobs = values.jobs ? Math.max(1, Number(values.jobs) | 0) : undefined
const store = new Store(detectEngines(), { concurrency: jobs, color: (k) => theme.kinds[k] })
if (values.to) {
  const want = values.to.toLowerCase().replace(/^\./, '').replace('jpeg', 'jpg')
  for (const k of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) if (TARGETS[k].some((t) => t.id === want)) store.settings[k].target = want
}
if (values.quality) for (const s of Object.values(store.settings)) s.quality = Math.max(1, Math.min(100, Number(values.quality) | 0))

process.on('exit', () => {
  const st = store.stats()
  store.dispose()
  if (st.done) log(`convt: ${st.done} converted · ${(st.before / 1048576).toFixed(1)} MB → ${(st.after / 1048576).toFixed(1)} MB`)
})

start(store, theme, { terminal })
await store.add(positionals, { watch: values.watch })
if (values.yes) store.convert(store.files)
