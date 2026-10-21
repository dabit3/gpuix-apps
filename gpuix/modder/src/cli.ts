#!/usr/bin/env bun
// modder: a mod workbench for single-player games you own, rendered in the terminal with GPUIX.
import { parseArgs } from 'node:util'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const HELP = `modder: mod workbench for single-player games you own (GPUIX, renders in Ghostty/kitty)

Usage:
  modder <game> [more games or fixture folders...]   open the workbench
  modder recon <game>... [--json]                    classify engine + modding route
  modder hooks <game>                                 list hook points (writes hooks.md)
  modder new <game> [--template sword|hud|unit] [--name N] [--color #hex]
  modder build <game>                                 write + bundle the mod into the profile
  modder test <game>                                  headless test-in-game + screenshot
  modder install <game> --yes                         copy the built mod into the game's mods/

Options:
  -o, --workspace <dir>  workspace (default ./.modder/<game>; never inside the game folder)
  -y, --yes              allow writing into the original game directory
  -w, --window           native window instead of the terminal
      --json             machine-readable output
  -h, --help             show this help

Rules: single-player or officially mod-supported games only. No anti-cheat, DRM, online code
or license checks. Mods are separate files loaded by the game's framework.`

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    workspace: { type: 'string', short: 'o' }, yes: { type: 'boolean', short: 'y' }, window: { type: 'boolean', short: 'w' },
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, template: { type: 'string', short: 't' }, name: { type: 'string' }, color: { type: 'string' },
  },
  allowPositionals: true,
  strict: true,
})
const CMDS = ['recon', 'hooks', 'new', 'build', 'test', 'install']
if (values.help || positionals.length === 0) { console.log(HELP); process.exit(values.help ? 0 : 1) }
const cmd = CMDS.includes(positionals[0]!) ? positionals.shift()! : 'ui'
const dirs = positionals.map((p) => resolve(p))
for (const d of dirs) if (!existsSync(d) || !statSync(d).isDirectory()) { console.error(`modder: not a folder: ${d}`); process.exit(1) }
if (!dirs.length) { console.error('modder: give a game folder'); process.exit(1) }

const { Workbench } = await import('./workbench')
const { expandTargets, recon } = await import('./recon')
const { TEMPLATES } = await import('./templates')
const ws = values.workspace ? resolve(values.workspace) : undefined

if (cmd !== 'ui') {
  const wb = new Workbench(dirs[0]!, ws, !!values.yes)
  try {
    if (cmd === 'recon') {
      const all = expandTargets(dirs).map((d) => recon(d))
      wb.writeRecon()
      if (values.json) console.log(JSON.stringify(all.length === 1 ? all[0] : all, null, 2))
      else for (const r of all) console.log(`${r.name.padEnd(26)} ${r.engine.padEnd(38)} ${r.risk.padEnd(8)} ${r.framework}`)
    } else if (cmd === 'hooks') {
      const r = wb.scan()
      if (values.json) console.log(JSON.stringify(wb.hooks, null, 2))
      else { for (const h of wb.hooks) console.log(`${h.kind.padEnd(8)} ${h.name.padEnd(22)} ${h.detail}  (${h.file}:${h.line})`); console.log(r.note) }
    } else {
      if (values.template) { if (!(values.template in TEMPLATES)) throw new Error(`unknown template ${values.template}`); wb.setTemplate(values.template as never) }
      if (values.name) wb.knobs.name = values.name
      if (values.color) wb.knobs.color = values.color
      const m = wb.writeMod()
      console.log(`write-mod: ${m.file}`)
      if (cmd !== 'new') {
        const b = await wb.build()
        if (!b.ok) throw new Error(`build failed: ${b.error}`)
        console.log(`build: ${b.out}/mod.js (${b.bytes} bytes, ${b.ms.toFixed(0)} ms)`)
      }
      if (cmd === 'test' || cmd === 'install') {
        const t = await wb.test()
        console.log(t.log.join('\n'))
        console.log(`test-in-game: ${t.ok ? 'PASS' : 'FAIL'} · ${t.kills} slain · ${t.projectiles} projectiles · screenshot ${t.screenshot}`)
        if (!t.ok) process.exit(1)
      }
      if (cmd === 'install') console.log(`installed: ${wb.install()}`)
      console.log(`run it: ${wb.launchCommand()}`)
    }
  } catch (e) { console.error(`modder: ${(e as Error).message}`); process.exit(1) }
  process.exit(0)
}

// GPUIX replays held native INFO/WARN logs after exit; re-exec once with RUST_LOG pinned.
if (!process.env.MODDER_CHILD) {
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env: { ...process.env, MODDER_CHILD: '1', RUST_LOG: 'error' }, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}

const { render } = await import('@gpuix/react')
const { ModderApp } = await import('./app')
const { loadGhosttyTheme } = await import('./theme')
const { createElement } = await import('react')
const targets = expandTargets(dirs)
// @gpuix/react console.logs mount progress; terminal mode replays it under the prompt on exit.
{ const log = console.log; console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[gpuix]')) return; log(...a) } }
render(createElement(ModderApp, { targets, theme: loadGhosttyTheme(), workspace: ws ? () => ws : undefined, yes: !!values.yes }), { terminal: !values.window, title: 'modder', width: 1440, height: 900 } as never)
