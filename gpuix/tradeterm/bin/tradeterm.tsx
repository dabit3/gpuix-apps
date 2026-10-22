#!/usr/bin/env -S RUST_LOG=error bun
import { normalizeSymbol, parseTimeframe, TIMEFRAMES } from '../src/types'

const HELP = `tradeterm: charting + backtesting terminal, drawn by GPUIX inside your terminal

usage
  tradeterm [SYMBOL] [TIMEFRAME] [options]

examples
  tradeterm BTC-USD 1h
  tradeterm ETH-USD 15m -s rsi
  tradeterm SOL 4h --offline

arguments
  SYMBOL      crypto pair, e.g. BTC-USD, ETH-USD, SOLUSDT (default BTC-USD)
  TIMEFRAME   ${TIMEFRAMES.join(' ')} (default 1h)

options
  -n, --bars <count>     history to load (default 3000; 26280 ≈ 3 years of 1h)
  -s, --strategy <id>    sma | rsi | donchian (default: last used)
      --offline          use the built-in sample data instead of the network
      --native           open a native window instead of rendering in the terminal
  -h, --help             this help

data: Binance public market data (data-api.binance.vision), Coinbase Exchange as a
fallback, then the local cache, then labelled sample data. No API keys.
Works in Ghostty and kitty (kitty graphics protocol). Press ? in the app for keys.`

function fail(msg: string): never {
  process.stderr.write(`tradeterm: ${msg}\n\nRun tradeterm --help for usage.\n`)
  process.exit(2)
}

const argv = process.argv.slice(2)
const pos: string[] = []
const opts = { bars: 3000, strategy: undefined as string | undefined, offline: false, native: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!
  const val = () => argv[++i] ?? fail(`${a} needs a value`)
  if (a === '-h' || a === '--help') {
    console.log(HELP)
    process.exit(0)
  } else if (a === '-n' || a === '--bars') {
    opts.bars = Math.round(Number(val()))
    if (!(opts.bars >= 100 && opts.bars <= 200_000)) fail('--bars must be between 100 and 200000')
  } else if (a === '-s' || a === '--strategy') {
    opts.strategy = val()
    if (!['sma', 'rsi', 'donchian'].includes(opts.strategy)) fail(`unknown strategy "${opts.strategy}"`)
  } else if (a === '--offline') opts.offline = true
  else if (a === '--native') opts.native = true
  else if (a.startsWith('-')) fail(`unknown option ${a}`)
  else pos.push(a)
}
if (pos.length > 2) fail('expected at most SYMBOL and TIMEFRAME')
let symbol = 'BTC-USD'
let tf = parseTimeframe('1h')!
for (const p of pos) {
  const t = parseTimeframe(p)
  if (t) tf = t
  else if (/^[A-Za-z0-9/_-]{2,20}$/.test(p)) symbol = normalizeSymbol(p)
  else fail(`can't read "${p}" as a symbol or timeframe`)
}
if (!process.stdin.isTTY && !opts.native && !process.env.GPUIX_BACKGROUND) fail("stdin isn't a terminal. Run tradeterm directly in Ghostty or kitty; don't pipe into it.")

process.env.RUST_LOG ??= 'error'
const log = console.log
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[gpuix]')) return
  log(...args)
}

const [{ render }, { App }, { loadState, saveState }] = await Promise.all([import('@gpuix/react'), import('../src/app'), import('../src/store')])

const quit = () => {
  saveState(loadState(), true)
  process.exit(0)
}

render(<App symbol={symbol} timeframe={tf} bars={opts.bars} offline={opts.offline} strategy={opts.strategy} onQuit={quit} />, {
  terminal: !opts.native,
  title: `tradeterm ${symbol} ${tf}`,
  width: 1440,
  height: 900,
  focus: process.env.GPUIX_BACKGROUND !== '1',
})
