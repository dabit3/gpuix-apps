#!/usr/bin/env bun
import { parseArgs } from 'node:util'

const HELP = `sinkhole: a DNS ad and tracker blocker with a live dashboard in your terminal

The ESP32-C3 "network-wide DNS blocker" design, emulated on macOS: a UDP DNS server with a
40-bit hashed blocklist, upstream forwarding, a TTL cache and per-domain stats, drawn by GPUIX.

Usage: sinkhole [options]
       sinkhole update [--source <url|file>]
       sinkhole bench [-n <count>] [--rate <qps>] [--port <port>]

Options:
  -p, --port <port>       UDP port to listen on (default 5300; 53 needs root, 5353 is mDNS on macOS)
  -H, --host <addr>       address to bind (default 127.0.0.1; 0.0.0.0 to serve your LAN)
  -u, --upstream <list>   upstream resolvers, comma separated (default 1.1.1.1,9.9.9.9)
  -l, --list <file>       hosts-format blocklist file to load instead of ~/.sinkhole/blocklist.bin
      --nxdomain          answer blocked names with NXDOMAIN instead of 0.0.0.0 / ::
      --cache <n>         response cache entries (default 256)
  -t, --theme <name>      Ghostty theme to paint with (default: your Ghostty config)
      --headless          run the DNS server without the dashboard (logs one line per query)
  -w, --window            open a native window instead of drawing in the terminal
  -h, --help              show this help
  -v, --version           print the version

Runs inside Ghostty or kitty (kitty graphics protocol). Ctrl-C quits.
Try it from a split:  dig @127.0.0.1 -p 5300 doubleclick.net`

const argv = process.argv.slice(2)
const sub = argv[0] === 'update' || argv[0] === 'bench' ? argv.shift() : undefined
const { values } = parseArgs({
  args: argv,
  options: {
    port: { type: 'string', short: 'p' },
    host: { type: 'string', short: 'H' },
    upstream: { type: 'string', short: 'u' },
    list: { type: 'string', short: 'l' },
    nxdomain: { type: 'boolean' },
    cache: { type: 'string' },
    theme: { type: 'string', short: 't' },
    headless: { type: 'boolean' },
    window: { type: 'boolean', short: 'w' },
    source: { type: 'string', short: 's' },
    n: { type: 'string', short: 'n' },
    rate: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: true,
})

if (values.help) { console.log(HELP); process.exit(0) }
if (values.version) { console.log('sinkhole 0.1.0 (gpuix 0.11.0)'); process.exit(0) }
const fail = (msg: string): never => { console.error(`sinkhole: ${msg}`); process.exit(1) }
const port = values.port == null ? 5300 : Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`bad port "${values.port}"`)

if (sub === 'update') {
  const { updateBlocklist, paths } = await import('./lists')
  const { meta } = await updateBlocklist(values.source)
  console.log(`sinkhole: ${meta.domains.toLocaleString('en-US')} domains → ${paths().bin} (${(meta.bytes / 1024).toFixed(0)} KB, 5 bytes each)`)
  process.exit(0)
}
if (sub === 'bench') {
  const { runBench, formatBench } = await import('./bench')
  const r = await runBench({ host: values.host ?? '127.0.0.1', port, n: Number(values.n ?? 1000), rate: values.rate ? Number(values.rate) : undefined })
  console.log(formatBench(r))
  process.exit(r.answered === r.sent && r.blockedOk === r.adsExpected ? 0 : 1)
}

const terminal = !values.window && !values.headless
if (terminal && !process.stdin.isTTY) fail('needs a terminal on stdin (Ghostty or kitty). Use --headless or --window.')

// GPUIX's native logger prints held INFO/WARN lines under the prompt after Ctrl-C. It reads RUST_LOG from the real
// process environment, so re-exec once with it pinned. SINKHOLE_LOG=<filter> opts back into logs.
if (!values.headless && !process.env.SINKHOLE_CHILD) {
  const env = { ...process.env, SINKHOLE_CHILD: '1', RUST_LOG: process.env.SINKHOLE_LOG ?? 'error' }
  const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], { env, stdio: ['inherit', 'inherit', 'inherit'] })
  process.on('SIGINT', () => {})
  process.exit(await child.exited)
}

const rawLog = console.log
console.log = (...args: unknown[]) => { if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return; rawLog(...args) }

const { Controller } = await import('./controller')
const { loadConfig } = await import('./lists')
const c = new Controller({
  host: values.host,
  port,
  upstreams: values.upstream?.split(',').map((s) => s.trim()).filter(Boolean),
  blockMode: values.nxdomain ? 'nxdomain' : undefined,
  cacheSize: values.cache ? Number(values.cache) : undefined,
  listFile: values.list,
  config: loadConfig(),
  persist: true,
})
try { await c.start() } catch (e) { fail(`${(e as Error).message}${port === 5353 ? ' (macOS mDNSResponder owns 5353; try --port 5300)' : ''}`) }

if (values.headless) {
  console.log(`sinkhole: listening on ${c.dns.host}:${c.dns.port} · ${c.meta.domains.toLocaleString('en-US')} blocked domains · upstream ${c.dns.upstreams.map((u) => u.label).join(', ')}`)
  c.dns.onQuery((e) => console.log(`${e.status.padEnd(9)} ${String(e.qtype).padStart(3)} ${e.name} ${e.answer} ${e.ms.toFixed(1)}ms`))
  process.on('SIGINT', () => { c.stop(); process.exit(0) })
} else {
  const log = rawLog
  process.on('exit', () => {
    const s = c.dns.stats
    if (s.total) log(`sinkhole: ${s.total.toLocaleString('en-US')} queries · ${s.blocked.toLocaleString('en-US')} blocked (${s.blockedPct.toFixed(1)}%) · ${s.cached} cached · ${s.forwarded} forwarded`)
  })
  const { loadGhosttyTheme } = await import('./theme')
  const { start } = await import('./app')
  start(c, loadGhosttyTheme(values.theme), { terminal })
}
