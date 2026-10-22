#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { SCENE_NAMES, sceneSettings, type SceneName } from './scene'

const HELP = `gargantua: a real-time relativistic black hole in your terminal, drawn by GPUIX

Usage: gargantua [options]
       gargantua drop [-n count]   throw probes into every running gargantua

Options:
  -q, --quality <lite|full>  start quality (default lite)
  -s, --scene <name>         gargantua | m87 | sgr-a | quasar (default gargantua)
  -l, --look <name>          physical | interstellar (default: the scene's)
      --no-lens              start with lensing off (flat space)
      --no-disk              start without the accretion disk
      --dist <rs>            camera distance in Schwarzschild radii, 6-120
      --pitch <deg>          camera elevation above the disk, -80-80
  -t, --theme <name>         Ghostty theme for the HUD (default: your Ghostty config)
      --workers <n>          ray-trace worker threads (default: cores − 3, max 8)
      --solo                 don't share probes with other gargantua panes
  -w, --window               open a native window instead of drawing in the terminal
  -h, --help                 show this help
  -v, --version              print the version

Runs inside Ghostty or kitty (kitty graphics protocol). Ctrl-C quits.
Mouse: drag = orbit (fling it) · scroll = distance
Keys: L lensing · K disk · I Physical/Interstellar · 1/2 LITE/FULL · 3-6 scenes · B drop probe · D dive · E eject
      [ ] disk tilt · - = mass · space pause · S snapshot · R reset camera · G perf · H help`

const argv = process.argv.slice(2)

if (argv[0] === 'drop') {
  const { broadcast } = await import('./link')
  const { makeSpec } = await import('./probe')
  const { values } = parseArgs({ args: argv.slice(1), options: { count: { type: 'string', short: 'n' } }, allowPositionals: true } as never) as { values: { count?: string } }
  const n = Math.max(1, Math.min(12, Number(values.count ?? 1) || 1))
  const now = Date.now()
  const probes = Array.from({ length: n }, (_, i) => makeSpec(now + i * 450))
  const reached = await broadcast({ from: process.pid, probes })
  console.log(reached ? `gargantua: ${n} probe${n > 1 ? 's' : ''} sent to ${reached} pane${reached > 1 ? 's' : ''}` : 'gargantua: no running gargantua found')
  process.exit(reached ? 0 : 1)
}

const { values } = parseArgs({
  args: argv,
  options: {
    quality: { type: 'string', short: 'q' },
    scene: { type: 'string', short: 's' },
    look: { type: 'string', short: 'l' },
    'no-lens': { type: 'boolean' },
    'no-disk': { type: 'boolean' },
    dist: { type: 'string' },
    pitch: { type: 'string' },
    theme: { type: 'string', short: 't' },
    workers: { type: 'string' },
    solo: { type: 'boolean' },
    window: { type: 'boolean', short: 'w' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: true,
})

if (values.help) { console.log(HELP); process.exit(0) }
if (values.version) { console.log('gargantua 0.1.0 (gpuix 0.11.0)'); process.exit(0) }
if (values.scene && !SCENE_NAMES.includes(values.scene as SceneName)) { console.error(`gargantua: --scene must be ${SCENE_NAMES.join(', ')}`); process.exit(2) }
if (values.quality && values.quality !== 'lite' && values.quality !== 'full') { console.error('gargantua: --quality must be lite or full'); process.exit(2) }
if (values.look && values.look !== 'physical' && values.look !== 'interstellar') { console.error('gargantua: --look must be physical or interstellar'); process.exit(2) }

const terminal = !values.window
if (terminal && !process.stdin.isTTY) {
  console.error('gargantua: needs a terminal on stdin (Ghostty or kitty). Use --window for a native window.')
  process.exit(1)
}

// GPUIX's env_logger prints held INFO/WARN lines under the prompt after Ctrl-C. It reads RUST_LOG from the real process
// environment, so re-exec once with it pinned. GARGANTUA_LOG opts back in.
if (!process.env.GARGANTUA_CHILD) {
  const env = { ...process.env, GARGANTUA_CHILD: '1', RUST_LOG: process.env.GARGANTUA_LOG ?? 'error' }
  const child = Bun.spawn([process.execPath, import.meta.path, ...argv], { env, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}
const log = console.log
console.log = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return; log(...args) }

const { loadGhosttyTheme } = await import('./theme')
const { workerSource } = await import('./source')
const { Link } = await import('./link')
const { start } = await import('./app')

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const scene = (values.scene ?? 'gargantua') as SceneName
const initial = {
  quality: (values.quality ?? 'lite') as 'lite' | 'full',
  ...sceneSettings(scene),
  ...(values.look ? { look: values.look as 'physical' | 'interstellar' } : {}),
  lens: !values['no-lens'],
  disk: !values['no-disk'],
}
const camera = {
  ...(values.dist ? { dist: clamp(Number(values.dist), 6, 120) } : {}),
  ...(values.pitch ? { pitch: clamp(Number(values.pitch), -80, 80) } : {}),
}
const theme = loadGhosttyTheme(values.theme)
const source = workerSource(initial, camera, values.workers ? Number(values.workers) : undefined)

let link: InstanceType<typeof Link> | null = null
if (!values.solo) link = new Link((m) => { if (m.probes?.length) source.post({ type: 'drop', specs: m.probes }) })

const started = Date.now()
process.on('exit', () => {
  link?.close()
  log(`gargantua: ${((Date.now() - started) / 1000).toFixed(0)} s at the edge of a black hole`)
})

start({ source, theme, initial, onProbes: link ? (p) => void link!.send({ probes: p }) : undefined, peers: link ? () => link!.peerCount : undefined }, { terminal })
