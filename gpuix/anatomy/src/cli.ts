#!/usr/bin/env -S RUST_LOG=error bun
import { watch, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const VERSION = 'anatomy 0.1.0 (gpuix 0.11.0)'
const HELP = `anatomy: one line of text -> an interactive, animated 3D machine, drawn by GPUIX in your terminal

Usage:
  anatomy "<description>"          design a machine from a one-liner ("a V8 engine", "a steam locomotive")
  anatomy <spec.json>              open a machine spec; edits to the file hot-reload
  anatomy gen "<description>" [-o file]   write the designed spec as JSON (stdout by default)
  anatomy validate <spec.json>...  schema + mechanical checks; exit 1 on any issue
  anatomy snap <spec|description> [-o out.png]   headless PNG render

Options:
  -t, --theme <name>  Ghostty theme to paint with (default: your Ghostty config)
  -x, --explode <0-1> start exploded
  -s, --speed <x>     clock speed 0.1-4 (default 1)
  -o, --out <file>    output file for gen / snap
  -w, --window        open a native window instead of drawing in the terminal
  -h, --help          show this help
  -v, --version       print the version

Built-in designers: V6/V8/V12, inline-N and boxer engines, mechanical watch, turbofan, steam locomotive, planetary gearset.
Runs inside Ghostty or kitty (kitty graphics protocol). Ctrl-C quits.
Mouse: drag orbit · shift/right-drag pan · scroll zoom · click inspect · double-click focus
Keys:  space play · , . step · [ ] speed · e explode · - = explode · v iso/persp · f effects · i parts · ↑↓ walk · enter focus · r reset · p PNG`

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    theme: { type: 'string', short: 't' },
    explode: { type: 'string', short: 'x' },
    speed: { type: 'string', short: 's' },
    out: { type: 'string', short: 'o' },
    window: { type: 'boolean', short: 'w' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  allowPositionals: true,
  strict: true,
})

if (values.help) { console.log(HELP); process.exit(0) }
if (values.version) { console.log(VERSION); process.exit(0) }

const { loadSource, readSpec, isSpecPath, SpecError } = await import('./source')
const fail = (e: unknown): never => { console.error(e instanceof SpecError ? e.message : `anatomy: ${(e as Error).message}`); process.exit(1) }

const [cmd, ...rest] = positionals
if (cmd === 'validate') {
  if (!rest.length) fail(new Error('validate needs at least one spec file'))
  let bad = 0
  for (const f of rest) {
    try { const s = readSpec(f); console.log(`ok  ${f}  ${s.meta.name}, ${s.parts.length} parts`) } catch (e) { bad++; console.error(e instanceof SpecError ? e.message : `${f}: ${(e as Error).message}`) }
  }
  process.exit(bad ? 1 : 0)
}
if (cmd === 'gen') {
  const prompt = rest.join(' ')
  if (!prompt) fail(new Error('gen needs a description, e.g. anatomy gen "a V12 engine"'))
  let spec
  try { spec = loadSource(prompt).spec } catch (e) { fail(e) }
  const json = `${JSON.stringify({ $schema: '../schema/machine.schema.json', ...spec }, null, 2)}\n`
  if (values.out) {
    if (!existsSync(dirname(values.out))) mkdirSync(dirname(values.out), { recursive: true })
    writeFileSync(values.out, json)
    console.log(`wrote ${values.out}  ${spec!.meta.name}, ${spec!.parts.length} parts`)
  } else process.stdout.write(json)
  process.exit(0)
}
if (cmd === 'snap') {
  const { Scene } = await import('./scene')
  const { Renderer, ISO_PITCH, ISO_YAW } = await import('./render/renderer')
  const { encodePng } = await import('./png')
  const { loadGhosttyTheme } = await import('./theme')
  let spec
  try { spec = loadSource(rest.join(' ') || 'a V8 engine').spec } catch (e) { fail(e) }
  const scene = new Scene(spec!), r = new Renderer(), th = loadGhosttyTheme(values.theme)
  r.resize(1600, 1000)
  const pal = paletteOf(th), c = spec!.meta.camera ?? {}
  for (let k = 0; k <= 12; k++) {
    const t = 0.4 - (12 - k) / 30
    scene.pose(t, Number(values.explode ?? 0))
    r.render({ scene, camera: { view: c.view ?? 'iso', yaw: ISO_YAW + (c.yaw ?? 0), pitch: c.pitch ?? ISO_PITCH, dist: (scene.radius * 1.8) / (c.zoom ?? 1), target: scene.center }, time: t, hover: -1, selected: -1, palette: pal, effects: true })
  }
  const out = values.out ?? 'anatomy.png'
  writeFileSync(out, encodePng(r.w, r.h, r.rgba))
  console.log(`wrote ${out}`)
  process.exit(0)
}

const arg = positionals.join(' ')
if (!arg) { console.log(HELP); process.exit(0) }
const terminal = !values.window
if (terminal && !process.stdin.isTTY) fail(new Error('needs a terminal on stdin (Ghostty or kitty). Use --window for a native window.'))

// GPUIX's native logger reads RUST_LOG from the real process environment, and Ghostty shells can export RUST_LOG=info, so
// re-exec once with it pinned; otherwise INFO lines print under the prompt after Ctrl-C. ANATOMY_LOG=<filter> opts back in.
if (!process.env.ANATOMY_CHILD) {
  const env = { ...process.env, ANATOMY_CHILD: '1', RUST_LOG: process.env.ANATOMY_LOG ?? 'error' }
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}
const log = console.log
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return; log(...a) }

function paletteOf(th: { bg: string; palette: string[]; accent: string }) {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
  return { bg: rgb(th.bg), grid: rgb(th.palette[0] ?? '#7a828e'), accent: rgb(th.accent) }
}

let src
try { src = loadSource(arg) } catch (e) { fail(e) }
const { loadGhosttyTheme } = await import('./theme')
const { Viewer } = await import('./ui/viewer')
const { start } = await import('./ui/app')
const theme = loadGhosttyTheme(values.theme)
const file = src!.path ? resolve(src!.path) : undefined
const v = new Viewer(src!.spec, paletteOf(theme), file ? relative(process.cwd(), file) || basename(file) : `"${arg}"`)
if (values.speed) v.speed = Math.max(0.1, Math.min(4, Number(values.speed) || 1))
if (values.explode) { v.explodeTarget = v.explode = Math.max(0, Math.min(1, Number(values.explode) || 0)) }

if (file) {
  // Watch the directory: editors and `anatomy gen -o` replace the file, which drops a watch on the file itself.
  let timer: ReturnType<typeof setTimeout> | undefined
  const name = basename(file)
  watch(dirname(file), (_ev, f) => {
    if (f !== null && f !== name) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!existsSync(file)) return
      try { const spec = readSpec(file); v.load(spec, `reloaded ${v.source} · ${spec.meta.name} · ${spec.parts.length} parts`) } catch (e) {
        const msg = e instanceof SpecError ? `${e.issues.length} issue${e.issues.length === 1 ? '' : 's'} · ${e.issues[0]!.path} ${e.issues[0]!.message}` : (e as Error).message
        v.say(`${v.source}: ${msg} (kept last good spec)`, 'err')
      }
    }, 120)
  })
}

process.on('exit', () => log(`anatomy: ${v.spec.meta.name} · ${v.scene.parts.length} parts · ${v.reloads} reload${v.reloads === 1 ? '' : 's'}`))
start(v, theme, { terminal })
