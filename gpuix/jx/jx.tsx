#!/usr/bin/env bun
import type { Doc } from './src/App'
import { type Json, loadSource } from './src/json'

const HELP = `jx: a GPU JSON explorer that runs in your terminal (kitty, Ghostty)

usage
  jx <file.json | file.json.gz | url>     explore a document (files are watched and reload live)
  jx <a.json> <b.json>                   side-by-side diff
  jx data.json -q '.[] | .actor.login'   start with a jq filter

options
  -q, --query <filter>   initial jq-style filter
  -w, --window           open a native window instead of rendering in the terminal
      --no-watch         don't reload files when they change
  -h, --help             show this help

keys
  ↑↓ / j k   move           ←→ / h l   fold, unfold      ⏎ / space  toggle
  f          filter (jq)    /          search, ⏎ next     n N        next / previous match
  y          copy jq path   Y          copy value (OSC 52 clipboard)
  e          expand subtree c          collapse all       s          schema panel
  q / ctrl-c quit
`

const args = process.argv.slice(2)
const files: string[] = []
let query = ''
let windowed = false
let watch = true
for (let i = 0; i < args.length; i++) {
  const a = args[i]!
  if (a === '-h' || a === '--help') { process.stdout.write(HELP); process.exit(0) }
  else if (a === '-q' || a === '--query') query = args[++i] ?? ''
  else if (a === '-w' || a === '--window') windowed = true
  else if (a === '--no-watch') watch = false
  else if (a.startsWith('-')) { process.stderr.write(`jx: unknown option ${a}\n\n${HELP}`); process.exit(2) }
  else files.push(a)
}
if (files.length === 0 || files.length > 2) { process.stderr.write(HELP); process.exit(files.length ? 2 : 1) }

const docs: Doc[] = []
for (const f of files) {
  try {
    const src = await loadSource(f)
    docs.push({ name: src.name, bytes: src.bytes, root: JSON.parse(src.text) as Json, path: src.path })
  } catch (e) {
    process.stderr.write(`jx: ${f}: ${(e as Error).message}\n`)
    process.exit(1)
  }
}

// Keep the shell clean after quit: the renderer's mount logs and the native INFO line are
// held while the app runs and would print over the restored prompt.
const log = console.log
console.log = (...a: unknown[]) => { if (!(typeof a[0] === 'string' && a[0].startsWith('[gpuix]'))) log(...a) }

const { render } = await import('@gpuix/react')
const { App } = await import('./src/App')

render(<App docs={docs} watch={watch} initialFilter={query} />, {
  terminal: !windowed,
  title: 'jx',
  width: 1280,
  height: 800,
  minWidth: 520,
  minHeight: 360,
  titlebarTransparent: true,
  trafficLightX: 16,
  trafficLightY: 22,
  focus: process.env.GPUIX_BACKGROUND !== '1',
})
