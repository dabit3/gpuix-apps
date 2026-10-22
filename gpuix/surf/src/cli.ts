#!/usr/bin/env -S RUST_LOG=error bun
import { parseArgs } from 'node:util'

const VERSION = 'surf 0.1.0 (gpuix 0.11.0)'
const HELP = `surf: a real web browser inside your terminal

Headless Google Chrome, driven over the Chrome DevTools Protocol, painted by GPUIX into Ghostty or kitty
(kitty graphics protocol). Tabs, omnibox, back/forward/reload and find are GPUIX; the pages are Chrome.

Usage: surf [options] [url|search ...]     open a browser (each argument becomes a tab)
       surf <command> [args]               control the running surf (most recently used)

Commands:
  open <url>          open a new tab            go <url>        navigate the current tab
  back | forward      history                   reload          reload the current tab
  tabs                list tabs                 tab <n>         switch to tab n
  close [n]           close a tab               find <text>     find in page
  eval <js>           print a JS expression     shot <file.png> [--full]   save a screenshot
  zoom [in|out|reset|150%]   page zoom of the current tab (no argument: print it)
  info                url, title, fps, latency  ls              list running surf windows

Options:
  -p, --pid <pid>       talk to a specific surf window (see "surf ls")
      --dpr <n>         device pixel ratio for page rendering (default: what GPUIX uses here)
      --chrome <path>   Chrome/Chromium binary (default: Google Chrome, or $SURF_CHROME)
  -t, --theme <name>    Ghostty theme to paint with (default: your Ghostty config)
  -w, --window          open a native window instead of drawing in the terminal
  -h, --help            show this help
  -v, --version         print the version

Keys: Ctrl-L omnibox · Ctrl-T new tab · Ctrl-W close · Ctrl-Tab next tab · Ctrl-R reload · Ctrl-F find
      Ctrl-= / Ctrl-- zoom in/out · Ctrl-0 reset zoom · Alt-←/→ back/forward · Ctrl-1..9 tab
      Esc back to the page · Ctrl-C quit`

const COMMANDS = new Set(['open', 'go', 'back', 'forward', 'reload', 'tabs', 'tab', 'close', 'find', 'eval', 'shot', 'info', 'ls', 'zoom'])
const argv = process.argv.slice(2)
const sub = argv[0] && COMMANDS.has(argv[0]) ? argv.shift()! : undefined
const { values, positionals } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    pid: { type: 'string', short: 'p' },
    dpr: { type: 'string' },
    chrome: { type: 'string' },
    theme: { type: 'string', short: 't' },
    window: { type: 'boolean', short: 'w' },
    full: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: true,
})

if (values.help) { console.log(HELP); process.exit(0) }
if (values.version) { console.log(VERSION); process.exit(0) }
const fail = (msg: string): never => { console.error(`surf: ${msg}`); process.exit(1) }

if (sub) {
  const { instances, request } = await import('./ipc')
  const { absolute } = await import('./session')
  const list = instances()
  if (sub === 'ls') {
    if (!list.length) console.log('no running surf windows')
    for (const i of list) console.log(`${String(i.pid).padEnd(7)} ${i.title ?? ''}  ${i.url ?? ''}`)
    process.exit(0)
  }
  const target = values.pid ? list.find((i) => i.pid === Number(values.pid)) : list[0]
  if (!target) fail(values.pid ? `no surf window with pid ${values.pid}` : 'no running surf window. Start one with: surf <url>')
  let args = positionals
  if (sub === 'shot') args = [absolute(positionals[0] ?? 'surf.png'), values.full ? 'full' : '']
  if (sub === 'eval' || sub === 'find' || sub === 'go') args = [positionals.join(' ')]
  const reply = await request(target!.path, sub, args).catch((e: Error) => fail(e.message))
  if (!reply.ok) fail(reply.error ?? 'failed')
  const r = reply.result
  if (sub === 'tabs' || sub === 'tab') for (const t of r as { index: number; active: boolean; title: string; url: string }[]) console.log(`${t.active ? '●' : ' '} ${t.index}  ${t.title}  ${t.url}`)
  else if (sub === 'shot') { const s = r as { path: string; bytes: number }; console.log(`${s.path} (${(s.bytes / 1024).toFixed(0)} KB)`) }
  else if (sub === 'open') { const o = r as { tab: number; url: string }; console.log(`tab ${o.tab}: ${o.url}`) }
  else if (sub === 'find') { const f = r as { count: number }; console.log(`${f.count} match${f.count === 1 ? '' : 'es'}`) }
  else if (typeof r === 'string') console.log(r)
  else console.log(JSON.stringify(r, null, typeof r === 'object' && r ? 2 : 0))
  process.exit(0)
}

const terminal = !values.window
if (terminal && !process.stdin.isTTY) fail('needs a terminal on stdin (Ghostty or kitty). Use --window for a native window.')

// GPUIX's native logger reads RUST_LOG from the real process environment; the shebang covers `surf`, this covers `bun src/cli.ts`.
// The parent stays alive only to reap Chrome if the child dies hard.
if (!process.env.SURF_CHILD) {
  const { defaultProfile } = await import('./chrome')
  const profile = defaultProfile()
  const env = { ...process.env, SURF_CHILD: '1', SURF_PROFILE: profile, RUST_LOG: process.env.SURF_LOG ?? 'error' }
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => child.kill('SIGTERM'))
  const code = await child.exited
  const { reapProfile } = await import('./chrome')
  reapProfile(profile)
  process.exit(code)
}

const scale = values.dpr ? Number(values.dpr) : terminal ? await (await import('./term')).detectScale() : 2
if (!Number.isFinite(scale) || scale <= 0) fail(`bad --dpr "${values.dpr}"`)
const { Session } = await import('./session')
const s = new Session({ urls: positionals, dpr: scale, chrome: values.chrome ?? process.env.SURF_CHROME, profile: process.env.SURF_PROFILE })
const out = console.log
console.log = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return; out(...args) }
let quitting = false
const quit = async (code = 0) => { if (quitting) return; quitting = true; await s.close(); process.exit(code) }
process.on('SIGINT', () => void quit(0))
process.on('SIGTERM', () => void quit(0))
process.on('beforeExit', () => void quit(0))
process.on('exit', () => {
  // last-resort: synchronous kill if the async close never ran (process.exit from GPUIX on Ctrl-C)
  try { s.chrome?.proc.kill('SIGKILL') } catch {}
  const i = s.info()
  if (s.painted) out(`surf: ${s.painted.toLocaleString('en-US')} frames painted · ${i.tabs} tab${i.tabs === 1 ? '' : 's'} · Chrome closed`)
})
const { loadGhosttyTheme } = await import('./theme')
const { start } = await import('./app')
start(s, loadGhosttyTheme(values.theme), { terminal })
void s.start()
