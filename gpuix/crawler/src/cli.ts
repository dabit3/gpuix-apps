import type { Command } from './ipc'

export type Options = { url?: string; spiders: number; still: boolean; chaos: boolean; window: boolean }
export type Parsed =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'command'; command: Command }
  | { kind: 'run'; options: Options }

const int = (s: string | undefined, def: number, max: number) => {
  if (s === undefined) return def
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : NaN
}

export function parseArgs(argv: string[]): Parsed {
  const [first, second] = argv
  if (first === 'feed' || first === 'spawn') {
    const n = int(second, first === 'feed' ? 5 : 1, first === 'feed' ? 40 : 8)
    if (Number.isNaN(n)) return { kind: 'error', message: `${first}: expected a positive number, got "${second}"` }
    return { kind: 'command', command: { cmd: first, n } }
  }
  if (first === 'web') return { kind: 'command', command: { cmd: 'web' } }
  if (first === 'open') {
    if (!second) return { kind: 'error', message: 'open: missing url' }
    return { kind: 'command', command: { cmd: 'open', url: second } }
  }
  if (first === 'still') return { kind: 'command', command: { cmd: 'still', on: second !== 'off' } }
  const o: Options = { spiders: 1, still: false, chaos: false, window: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '-h' || a === '--help') return { kind: 'help' }
    else if (a === '-r' || a === '--still') o.still = true
    else if (a === '-x' || a === '--chaos') o.chaos = true
    else if (a === '-w' || a === '--window') o.window = true
    else if (a === '-n' || a === '--spiders') {
      const n = int(argv[++i], 1, 10)
      if (Number.isNaN(n)) return { kind: 'error', message: `${a}: expected a number from 1 to 10` }
      o.spiders = n
    } else if (a.startsWith('-')) return { kind: 'error', message: `unknown option ${a}` }
    else if (!o.url) o.url = a
    else return { kind: 'error', message: `unexpected argument ${a}` }
  }
  return { kind: 'run', options: o }
}
