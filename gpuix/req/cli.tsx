#!/usr/bin/env bun
import { render } from '@gpuix/react'
import { App, windowKeys } from './src/App'
import { METHODS, type Method } from './src/http'
import { dataPaths, defaultDataDir, kv, type RequestDraft } from './src/store'

const HELP = `req: a Postman-style HTTP client that runs inside your terminal

Usage
  req [url] [options]

Options
  -X, --method <verb>     GET POST PUT PATCH DELETE HEAD OPTIONS
  -H, --header 'K: V'     add a header (repeatable)
  -d, --data <body>       request body (implies POST); JSON gets a JSON editor
  -e, --env <name>        environment to use for {{variables}} (default: last used)
  -n, --no-send           open the request without sending it
      --window            open a native macOS window instead of the terminal
      --data-dir <dir>    where collections.json and history.json live
                          (default ${defaultDataDir().replace(process.env.HOME ?? '', '~')})
  -h, --help              show this help
  -v, --version           print the version

Examples
  req https://api.github.com/repos/remorses/gpuix
  req '{{base}}/api/products?limit=3' -e dev
  req -X POST https://httpbin.org/post -d '{"hello":"terminal"}'

Runs in kitty or Ghostty (kitty graphics protocol). Ctrl-C quits.`

function parse(argv: string[]) {
  const out = { url: '', method: '' as Method | '', headers: [] as [string, string][], data: '', env: '', send: true, window: false, dataDir: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const next = () => {
      const v = argv[++i]
      if (v == null) fail(`${a} needs a value`)
      return v!
    }
    switch (a) {
      case '-h':
      case '--help':
        console.log(HELP)
        process.exit(0)
      case '-v':
      case '--version':
        console.log('req 0.1.0')
        process.exit(0)
      case '-X':
      case '--method': {
        const m = next().toUpperCase() as Method
        if (!METHODS.includes(m)) fail(`unknown method ${m}`)
        out.method = m
        break
      }
      case '-H':
      case '--header': {
        const h = next()
        const i2 = h.indexOf(':')
        if (i2 < 1) fail(`header must look like 'Name: value', got ${h}`)
        out.headers.push([h.slice(0, i2).trim(), h.slice(i2 + 1).trim()])
        break
      }
      case '-d':
      case '--data':
        out.data = next()
        break
      case '-e':
      case '--env':
        out.env = next()
        break
      case '-n':
      case '--no-send':
        out.send = false
        break
      case '--window':
        out.window = true
        break
      case '--data-dir':
        out.dataDir = next()
        break
      default:
        if (a.startsWith('-')) fail(`unknown option ${a}`)
        if (out.url) fail(`unexpected argument ${a}`)
        out.url = a
    }
  }
  return out
}

function fail(message: string): never {
  console.error(`req: ${message}\nRun req --help for usage.`)
  process.exit(2)
}

const args = parse(process.argv.slice(2))
const terminal = !args.window
if (terminal) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail('needs an interactive terminal (kitty or Ghostty). Use --window for a native window.')
  if (process.env.TMUX) fail('tmux is not supported by the kitty graphics renderer. Run req in a plain Ghostty or kitty pane.')
}

let request: Partial<RequestDraft> | undefined
if (args.url || args.data || args.headers.length) {
  const url = args.url && !/^(https?:\/\/|\{\{)/.test(args.url) ? `https://${args.url}` : args.url
  const isJson = args.data.trim().startsWith('{') || args.data.trim().startsWith('[')
  request = {
    name: 'Untitled request',
    url,
    method: args.method || (args.data ? 'POST' : 'GET'),
    headers: args.headers.map(([k, v]) => kv(k, v)),
    body: isJson ? safePretty(args.data) : args.data,
    bodyType: args.data ? (isJson ? 'json' : 'text') : 'none',
  }
}

function safePretty(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

render(
  <App
    paths={dataPaths(args.dataDir || defaultDataDir())}
    initial={{ request, autoSend: !!args.url && args.send, env: args.env || undefined }}
  />,
  {
    title: 'req',
    appName: 'req',
    appId: 'dev.gpuix.req',
    terminal,
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 420,
    titlebarTransparent: true,
    focus: process.env.GPUIX_BACKGROUND !== '1',
    debugFrameOverlay: process.env.REQ_DEBUG_OVERLAY === '1' ? 'full' : undefined,
    onKeyDown: (event) => windowKeys.current?.(event),
  },
)
