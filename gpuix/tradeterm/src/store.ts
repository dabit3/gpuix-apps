import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME } from './data/feed'

export type Point = { t: number; p: number }
export type DrawingKind = 'trend' | 'hline' | 'rect' | 'fib'
export type Drawing = { id: string; kind: DrawingKind; a: Point; b: Point }

export type State = {
  indicators: string[]
  chart: 'candles' | 'heikin' | 'line' | 'area'
  log: boolean
  strategy: string
  drawings: Record<string, Drawing[]>
  watchlist: string[]
  paneSizes: Record<string, number>
}

export const DEFAULT_STATE: State = {
  indicators: ['ema', 'bb', 'rsi', 'macd'],
  chart: 'candles',
  log: false,
  strategy: 'sma',
  drawings: {},
  watchlist: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'LINK-USD'],
  paneSizes: {},
}

const file = () => join(HOME, 'state.json')

export function loadState(): State {
  try {
    return { ...DEFAULT_STATE, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<State>) }
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
export function saveState(s: State, immediate = false) {
  const write = () => {
    try {
      mkdirSync(HOME, { recursive: true })
      writeFileSync(file(), JSON.stringify(s, null, 2))
    } catch {}
  }
  clearTimeout(timer)
  if (immediate) write()
  else timer = setTimeout(write, 250)
}
