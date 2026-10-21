#!/usr/bin/env bun
import { existsSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const HELP = `couch: a fast 10-foot media center that paints inside your terminal

Usage:
  couch [library]            browse and play a local library (default ~/Movies)
  couch remote [action...]   drive a running couch from another pane
                             (no actions: open the on-screen remote)
  couch fetch [dir]          download the open-movie sample library (~1.9 GB)

Options:
  -p, --profile <name>       skip "Who's watching?" and sign in as <name>
      --profiles <list>      comma list of profiles, append * for kids (default: you,Family,Kids*)
  -m, --mute                 video only, no audio
  -t, --theme <name>         Ghostty theme to paint with (default: your Ghostty config)
      --plex <url>           browse a Plex Media Server instead (needs --token)
      --token <token>        X-Plex-Token for --plex
      --hud                  start with the perf HUD open
  -w, --window               native window instead of the terminal
  -h, --help                 show this help
  -v, --version              print the version

Remote actions: up down left right ok back home play ffwd rew next prev hud info
                status · open <title>

Keys: arrows/WASD move · ⏎ select · esc back · space play/pause · ← → scrub 10 s
      [ ] 30 s · 1 2 3 tabs · g home · h perf HUD · Ctrl-C quit
Runs inside Ghostty or kitty (kitty graphics protocol).`

const argv = process.argv.slice(2)
const sub = argv[0] === 'remote' || argv[0] === 'fetch' ? argv.shift() : undefined

if (sub === 'fetch') {
  const { fetchLibrary } = await import('../scripts/fetch-library.ts')
  await fetchLibrary(argv[0] ? resolve(argv[0]) : resolve(homedir(), 'Movies/Couch'))
  process.exit(0)
}

const { values, positionals } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    profile: { type: 'string', short: 'p' },
    profiles: { type: 'string' },
    mute: { type: 'boolean', short: 'm' },
    theme: { type: 'string', short: 't' },
    plex: { type: 'string' },
    token: { type: 'string' },
    hud: { type: 'boolean' },
    window: { type: 'boolean', short: 'w' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: true,
})

if (values.help) { console.log(HELP); process.exit(0) }
if (values.version) { console.log('couch 0.1.0 (gpuix 0.11.0)'); process.exit(0) }

if (sub === 'remote' && positionals.length) {
  const { sendRemote } = await import('./remote/client.ts')
  process.exit(await sendRemote(positionals))
}

const terminal = !values.window
if (terminal && !process.stdin.isTTY) {
  console.error('couch: needs a terminal on stdin (Ghostty or kitty). Use --window for a native window.')
  process.exit(1)
}

// GPUIX's native logger reads RUST_LOG at init and prints held INFO/WARN lines after the terminal is restored,
// so re-exec once with it pinned to keep the prompt clean. COUCH_LOG=<filter> opts back into logs.
if (!process.env.COUCH_CHILD) {
  const env = { ...process.env, COUCH_CHILD: '1', COUCH_T0: String(performance.timeOrigin + performance.now()), RUST_LOG: process.env.COUCH_LOG ?? 'error' }
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}
const log = console.log
console.log = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return; log(...args) }

const { loadGhosttyTheme } = await import('./theme.ts')
const theme = loadGhosttyTheme(values.theme)

if (sub === 'remote') {
  const { startRemoteApp } = await import('./remote/app.tsx')
  startRemoteApp(theme, { terminal })
} else {
  const { Controller } = await import('./controller.ts')
  const { ArtQueue } = await import('./library/art.ts')
  const { scanLibrary, probeAll } = await import('./library/scan.ts')
  const { loadState } = await import('./state.ts')
  const { startRemoteServer } = await import('./remote/server.ts')
  const { watchLibrary } = await import('./library/watch.ts')
  const { start } = await import('./app.tsx')

  const t0 = Number(process.env.COUCH_T0 ?? performance.timeOrigin)
  const me = userInfo().username
  const meName = me ? me[0]!.toUpperCase() + me.slice(1) : 'You'
  const profiles = (values.profiles ?? `${meName},Family,Kids*`).split(',').map((s, i) => {
    const kids = s.trim().endsWith('*')
    return { name: s.trim().replace(/\*$/, ''), color: [4, 6, 2, 3, 1][i % 5]!, kids }
  })

  let lib
  if (values.plex) {
    if (!values.token) { console.error('couch: --plex needs --token'); process.exit(1) }
    const { loadPlexLibrary } = await import('./library/plex.ts')
    lib = await loadPlexLibrary(values.plex, values.token)
  } else {
    const root = resolve(positionals[0] ?? resolve(homedir(), 'Movies'))
    if (!existsSync(root) || !statSync(root).isDirectory()) { console.error(`couch: ${root} is not a folder`); process.exit(1) }
    lib = scanLibrary(root)
  }
  const ctl = new Controller(lib, loadState(), { profiles, mute: values.mute })
  const art = new ArtQueue()
  const metrics = { coldStartMs: undefined as number | undefined, probeSpawns: 0, source: terminal ? 'Metal → kitty graphics' : 'Metal window' }
  if (values.hud) ctl.view.hud = true
  if (values.profile) {
    const i = profiles.findIndex((p) => p.name.toLowerCase() === values.profile!.toLowerCase())
    ctl.selectProfile(i >= 0 ? i : 0)
  }
  startRemoteServer(ctl)
  process.on('exit', () => ctl.dispose())
  start({
    ctl, theme, art, metrics,
    onFirstPaint: () => setTimeout(() => { metrics.coldStartMs = performance.timeOrigin + performance.now() - t0; ctl.touched() }, 0),
  }, { terminal })
  if (lib.source === 'local') {
    probeAll(lib, () => {}).then((n) => { metrics.probeSpawns = n; ctl.rebuild() })
    watchLibrary(lib.root, async (next) => { await probeAll(next); ctl.setLibrary(next) })
  }
}
