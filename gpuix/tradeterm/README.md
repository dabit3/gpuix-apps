# tradeterm

A charting and backtesting terminal for crypto, drawn by [GPUIX](https://github.com/remorses/gpuix) **inside Ghostty** (or kitty) over the Kitty Graphics protocol. Candles, volume, indicators, a crosshair, drag-zoom, scroll-pan, seven timeframes, drawings, a watchlist and a strategy backtester with an equity curve and trade list, all in one terminal pane you can split.

```sh
tradeterm BTC-USD 1h
```

> **Independent project.** tradeterm is not affiliated with, endorsed by, or derived from TradingView. It contains no TradingView code, assets or "premium" indicators: the chart engine, indicator math (published formulas) and backtester were written from scratch here. Market data comes only from public, keyless endpoints (Binance and Coinbase market data). Nothing here is investment advice.

## Run it

Needs [Bun](https://bun.sh) and a terminal that speaks the kitty graphics protocol (Ghostty or kitty; not tmux, not the VS Code/Zed terminals). macOS (Metal).

```sh
cd gpuix/tradeterm
bun install
bun link            # puts `tradeterm` on your PATH
tradeterm BTC-USD 1h
```

Or without linking: `bun bin/tradeterm.tsx ETH-USD 15m`.

```
tradeterm [SYMBOL] [TIMEFRAME] [options]
  SYMBOL      BTC-USD, ETH-USD, SOLUSDT, ... (default BTC-USD)
  TIMEFRAME   1m 5m 15m 1h 4h 1D 1W (default 1h)
  -n, --bars <count>     history to load (default 3000; 26280 ≈ 3 years of 1h)
  -s, --strategy <id>    sma | rsi | donchian
      --offline          built-in sample data, no network
      --native           open a native window instead of the terminal
  -h, --help
```

Ctrl-C (or `q`) quits and gives the prompt back. Split Ghostty (Cmd-D) and run a second symbol next to the first; each instance reflows to its pane.

### Controls

| Input | Action |
|---|---|
| `/` or Ctrl-K, or click the symbol | command palette: type `eth 4h`, `rsi`, `fib`, `sweep`, any symbol… and press Enter |
| hover | crosshair, OHLC + indicator readout, price/time tags |
| drag on a pane | live measure (% change, bars, duration), then zoom to the range (double-click resets) |
| shift-drag / right-drag | pan |
| scroll | pan · ctrl-scroll zooms around the pointer |
| ← → / ↑ ↓ / `0` | pan / zoom / reset to latest |
| `1`–`7` | 1m 5m 15m 1h 4h 1D 1W |
| `c` / `l` | chart type (candles, Heikin-Ashi, line, area) / log scale; also the **Chart** menu |
| `e s b v u d` | EMA, SMA, Bollinger, VWAP, SuperTrend, Donchian (overlays) |
| `r m k a o` | RSI, MACD, Stochastic, ATR, OBV (own panes; drag the dividers); also the **Indicators** menu |
| `t h g f` then click/drag | trend line, horizontal level, box, Fibonacci retracement · `x` deletes the last |
| `n` | next strategy (SMA cross, RSI reversion, Donchian breakout) |
| `,` `.` | step through trades on the chart |
| `w` | SMA parameter sweep heatmap with walk-forward check |
| `[` `]` | previous / next watchlist symbol (or click it) |
| `p` / `?` | hide the inspector / keyboard shortcuts sheet |

Indicators, chart type, strategy, pane sizes and drawings (per symbol) persist in `~/.tradeterm/state.json`, so a relaunch comes back exactly as you left it. Downloaded bars are cached in `~/.tradeterm/cache/`.

## Design

Built to feel like a native Mac app that happens to live in a terminal pane:

- **One accent.** Everything is GitHub Dark High Contrast neutrals plus one blue; green and red only ever mean up and down. Live data is quiet gray text. Sample or cached data gets a yellow tag so it can never pass as live.
- **SF Mono for every number** (registered from Terminal.app's bundled fonts with `registerFont`; falls back to Menlo), so prices and metrics stay tabular.
- **Little chrome.** A title bar (symbol, price that flashes on each live tick, 24h pill, timeframe control), a single toolbar with Chart and Indicators menus, four icon drawing tools, Search, Sweep and an inspector toggle. No status bar.
- **Spotlight-style command palette.** Fuzzy over symbols, timeframes, indicators, chart styles, tools, strategies and actions; `eth 4h` becomes one "ETH-USD · 4h" result.
- **Motion with purpose.** View changes ease out; the equity curve draws itself in when you switch strategy; drag-to-zoom shows a live measure first.
- **Inspector.** Watchlist with change pills, a headline total return next to buy & hold, equity/drawdown, a metrics grid, and trades with duration and P&L bars.

## Data

1. **Binance public market data** (`data-api.binance.vision`, REST klines + a kline WebSocket for the live candle and 24h tickers for the watchlist). `api.binance.com` returns HTTP 451 from US IPs, so the `binance.vision` mirror is the default.
2. **Coinbase Exchange** public candles as a fallback.
3. The last successful download from the local cache.
4. A deterministic random-walk **sample** series, clearly badged `SAMPLE DATA`, so the app always opens (also `--offline`).

No API keys, no accounts.

## Backtester

Event-driven, one bar at a time, no lookahead: a strategy's `onBar(ctx)` only sees bars up to the one that just closed, signals fill at the **next bar's open** by default (or the same close with `fill: 'close'`). Fees default to 10 bps and slippage to 5 bps per side. Market, limit and stop orders; percent-of-equity, fixed or volatility-targeted sizing. Metrics: total return, CAGR, Sharpe, Sortino, max drawdown and its duration, win rate, profit factor, exposure, trade count and fees. The equity curve is drawn against buy-and-hold with the drawdown underneath; trades are marked on the price chart.

`w` opens a 6×6 fast/slow SMA sweep and a 4-fold walk-forward (optimise in-sample, report the next window out-of-sample), with an explicit overfitting warning: the best in-sample cell is almost never the best out-of-sample one.

Custom indicators use a small plugin API, `(bars, params) => series[]`:

```ts
import { registerIndicator, ema } from './src/indicators'
registerIndicator({ id: 'ema200', label: 'EMA 200', pane: 'overlay', params: { n: 200 },
  fn: (bars, p) => [{ name: 'EMA 200', values: ema(bars.map((b) => b.c), p.n!), color: '#f0b72f' }] })
```

## Tests

```sh
bun test          # indicator reference values, hand-checked backtest fixture, data parsing, UI (GPUIX test renderer)
bun run typecheck
```

- `tests/indicators.test.ts` checks SMA, EMA, WMA, Bollinger, RSI, MACD, ATR, Stochastic, OBV and Donchian against reference values generated with **TA-Lib 0.8** (Python wrapper 0.8.2) (`tests/fixtures/talib.json`, regenerate with `tests/fixtures/gen_talib.py`).
- `tests/backtest.test.ts` replays an SMA(2/3) crossover on a 12-bar fixture with 10 bps fees and 5 bps slippage and compares fills, equity and metrics to a spreadsheet-style calculation written out in the test, plus a no-lookahead check.
- `tests/app.test.tsx` drives the real app in GPUIX's headless test renderer: crosshair readout, drag-zoom, ctrl-scroll zoom, indicator keys and the Indicators menu, the command palette (`sol 1d`, `sweep`), strategy cycling, the sweep sheet and timeframe switching. `tests/narrow.test.tsx` checks every control stays reachable in a 640 px split.

## What was adapted from the original prompt

The original prompt asked for a React + Vite web app with a Canvas 2D engine, a Python FastAPI + DuckDB backend and a Python backtester. Here:

- **Browser Canvas → CPU rasterizer into GPUIX `<img>`.** Every chart pane is a BGRA `Uint8Array` drawn by `src/raster.ts` (anti-aliased lines, fills, bands) and uploaded with `setImagePixels(w, h, buf, { format: 'bgra' })`. Axes, labels, crosshair, legends and every control are native GPUIX elements on top. Zoomed out, the renderer decimates to one min/max candle per pixel column, so 26k bars draw in a few ms.
- **Python backend + DuckDB → direct public REST/WebSocket from the app** and a JSON cache. Resampling happens client-side; the exchanges already serve every timeframe.
- **Python backtester → the same design in TypeScript** (`src/backtest.ts`), so it runs in-process and redraws instantly when you switch strategy.
- **Equities** (needs a user-supplied key) were left out; crypto only.

### Cut or simplified

- 11 indicators instead of 30+ (SMA, EMA, Bollinger, VWAP, SuperTrend, Donchian, RSI, MACD, Stochastic, ATR, OBV). WMA and Keltner are implemented and tested but not on the toolbar. No Ichimoku, Parabolic SAR, ADX, CCI, MFI, ZigZag, volume profile, anchored VWAP.
- Drawings: trend line, horizontal level, rectangle and Fibonacci. No ray, parallel channel or text notes; no OHLC snapping or editing (delete-last only).
- Chart types: candles, Heikin-Ashi, line, area (no OHLC bars). Zoom, reset and trade jumps ease into place (~300 ms cubic ease-out) but there is no kinetic flick scrolling or pinch.
- No alerts or webhooks.
- The sweep is SMA-only.

## GPUIX findings (0.11.0, terminal mode in Ghostty)

- `render(<App />, { terminal: true })` just works in Ghostty: the whole app, including four raster panes re-uploaded on every crosshair move, runs smoothly over the kitty graphics protocol, and a Ghostty split resizes it live.
- `setImagePixels(..., { format: 'bgra' })` is the fast path for custom drawing; a whole frame of the main pane rasterizes in ~1–3 ms on the paravirtual Mac VM.
- In terminal mode printable keys can arrive as `key: "space"` with the real character in `keyChar`; `keyOf()` in `src/app.tsx` handles both.
- The left mouse button is `0`, so `e.button !== 2` (not `!e.button`) tells left from right.
- Ghostty keeps Cmd shortcuts (Cmd-D splits), so every action has a plain-key or Ctrl alternative.
- GPUIX holds stdout/stderr until exit; the `#!/usr/bin/env -S RUST_LOG=error bun` shebang keeps INFO logs from spilling under the prompt.
- Absolutely-positioned overlays (crosshair lines, axis tags, the zoom selection) need `pointerEvents: 'none'` or they swallow the pane's mouse events.
- A component that calls `setState` from inside an `<img>` redraw layout effect, combined with a dependency that is a fresh `[]` every render, produces "Maximum update depth exceeded" right away, and GPUIX shows React's error overlay inside the terminal (nice for debugging). Keep redraw keys referentially stable.
- Every painted `<text>` is selectable, so a drag that misses a chart pane starts a text selection that highlights the whole sidebar. A charting app wants none of that: `userSelect: 'none'` on the root turns it off for everything.
- `createTestRoot()` + `connectTest()` make UI tests easy, including `dragBy` and `wheel(…, { modifiers: 'ctrl' })`.
- Menus, the palette and sheets use `<anchored fill="window" deferred occlude>` with the dimming backdrop as a *sibling* of the card, not its parent, so clicks inside the card never dismiss it. They paint over the scrolling trade list and the raster panes, and the test renderer finds their contents by `testId`.
- `<svg source>` icons render fine over kitty graphics; they are monochrome and need `style.color`.
- `renderer.registerFont(bytes)` works in terminal mode: SF Mono from `/System/Applications/Utilities/Terminal.app/Contents/Resources/Fonts` is a drop-in.
- `boxShadow` is a structured object and TypeScript requires `spreadRadius` on each shadow.
- Animation from JS (a 16 ms interval setting a view state that re-rasterizes ~2 panes) stays smooth in Ghostty; `motion.div` only animates layout props, so chart transitions are done this way.
