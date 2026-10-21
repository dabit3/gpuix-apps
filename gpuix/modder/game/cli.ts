#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'

const HELP = `grovekeep: a tiny single-player arena game with an official mod API (the modder demo target)

Usage: grovekeep [options]

Options:
  -p, --profile <dir>  mod profile to load mods from (<dir>/mods/*/manifest.json)
      --give <id>      equip a weapon at start
      --spawn <id>     spawn 4 of an enemy at start
      --autopilot      let the hero play itself
      --seed <n>       world seed
  -w, --window         native window instead of the terminal
  -h, --help           show this help

Keys: arrows/WASD move · space/J swing · Q cycle weapon · E spawn newest enemy · P autopilot · R reload mods · Ctrl-C quit`

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    profile: { type: 'string', short: 'p' }, give: { type: 'string' }, spawn: { type: 'string' },
    autopilot: { type: 'boolean' }, seed: { type: 'string' }, window: { type: 'boolean', short: 'w' }, help: { type: 'boolean', short: 'h' },
  },
  strict: true,
})
if (values.help) { console.log(HELP); process.exit(0) }

// GPUIX replays held native INFO/WARN logs after exit; re-exec once with RUST_LOG pinned.
if (!process.env.GROVEKEEP_CHILD) {
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env: { ...process.env, GROVEKEEP_CHILD: '1', RUST_LOG: 'error' }, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}
const log = console.log
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return; log(...a) }

const { startGame } = await import('./app')
const { loadGhosttyTheme } = await import('../src/theme')
const c = await startGame({ profile: values.profile ? resolve(values.profile) : null, seed: values.seed ? Number(values.seed) : undefined, autopilot: values.autopilot, give: values.give, spawn: values.spawn }, loadGhosttyTheme(), !values.window)
process.on('exit', () => log(`grovekeep: ${c.game.kills} slain · ${c.loader.mods.length} mod(s) · ${c.loader.reloads} hot reload(s)`))
