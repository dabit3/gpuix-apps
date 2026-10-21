#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const VERSION = '0.1.0'
const HELP = `photocraft: a layered, Photoshop-style image editor that paints inside your terminal (GPUIX)

Usage: photocraft [image|project.pcraft] [options]

Arguments:
  image               PNG or JPEG (HEIC/WebP/TIFF via macOS sips), or a .pcraft project.
                      Omit it for a blank 1600×1000 canvas.

Options:
  -o, --out <file>    export path for Ctrl-E (default: <image>-edit.png next to the image)
  -m, --max <px>      downscale big photos so the long edge fits (default 1600)
  -w, --window        open a native window instead of drawing in the terminal
  -h, --help          show this help
  -v, --version       print the version

Runs inside Ghostty or kitty (kitty graphics protocol). Ctrl-C quits.
Keys: B brush · E eraser · M/O/L/W select · K fill · G gradient · I eyedropper · [ ] size
      Ctrl-Z/Ctrl-Shift-Z undo/redo · Ctrl-J duplicate · Q mask · +/- blend · 1-0 opacity
      Ctrl-E export PNG · Ctrl-Shift-E JPEG · Ctrl-S save .pcraft · ? all keys`

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    out: { type: 'string', short: 'o' },
    max: { type: 'string', short: 'm' },
    window: { type: 'boolean', short: 'w' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  allowPositionals: true,
  strict: true,
})

if (values.help) {
  console.log(HELP)
  process.exit(0)
}
if (values.version) {
  console.log(`photocraft ${VERSION} (gpuix 0.11.0)`)
  process.exit(0)
}

const input = positionals[0] ? resolve(positionals[0]) : null
if (input && !existsSync(input)) {
  console.error(`photocraft: no such file: ${positionals[0]}`)
  process.exit(1)
}
const terminal = !values.window
if (terminal && !process.stdin.isTTY) {
  console.error('photocraft: needs a terminal on stdin (Ghostty or kitty). Pass a file path, not a pipe; or use --window.')
  process.exit(1)
}

// GPUIX's native logger reads RUST_LOG from the real environment at startup, so re-exec once with it pinned;
// otherwise held INFO/WARN lines print under the prompt after Ctrl-C. PHOTOCRAFT_LOG=<filter> opts back in.
if (!process.env.PHOTOCRAFT_CHILD) {
  const env = { ...process.env, PHOTOCRAFT_CHILD: '1', RUST_LOG: process.env.PHOTOCRAFT_LOG ?? 'error' }
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}

const log = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return
  log(...args)
}

const { Editor } = await import('../src/core/editor')
const { fitImage, readImageFile, writeImageFile } = await import('../src/core/io')
const { render } = await import('@gpuix/react')
const { App, keyHandlers } = await import('../src/ui/app')

const max = Number(values.max ?? 1600)
let ed: InstanceType<typeof Editor>
let notice = ''
const stem = input ? basename(input, extname(input)) : 'untitled'
const dir = input ? dirname(input) : process.cwd()
if (input && extname(input).toLowerCase() === '.pcraft') {
  ed = Editor.openProject(readFileSync(input))
  notice = `Opened ${basename(input)} · ${ed.doc.layers.length} layers`
} else if (input) {
  const src = readImageFile(input)
  const img = fitImage(src, max)
  ed = Editor.fromImage(img, basename(input))
  notice = img.width === src.width ? `Opened ${basename(input)}` : `Opened ${basename(input)} (${src.width}×${src.height} → ${img.width}×${img.height})`
} else {
  ed = Editor.blank(1600, 1000)
  notice = 'New canvas'
}
ed.lastAction = notice

const pngOut = values.out ? resolve(values.out) : join(dir, `${stem.replace(/-edit$/, '')}-edit.png`)
const jpgOut = pngOut.replace(/\.png$/i, '') + '.jpg'
const projOut = join(dir, `${stem}.pcraft`)
const kb = (p: string) => `${Math.round(readFileSync(p).length / 1024)} KB`

const actions = {
  exportPng() {
    writeImageFile(pngOut, ed.flattened())
    ed.emit(`Exported ${basename(pngOut)} · ${kb(pngOut)}`)
  },
  exportJpeg() {
    writeImageFile(jpgOut, ed.flattened())
    ed.emit(`Exported ${basename(jpgOut)} · ${kb(jpgOut)}`)
  },
  saveProject() {
    writeFileSync(projOut, ed.saveProject())
    ed.emit(`Saved ${basename(projOut)} · ${kb(projOut)}`)
  },
}

const label = input ? basename(input) : 'Untitled'
render(<App ed={ed} actions={actions} fileLabel={`${label} · ${ed.doc.width}×${ed.doc.height}`} />, terminal ? { terminal: true, ...keyHandlers } : { title: 'PhotoCraft', width: 1440, height: 900, ...keyHandlers })
