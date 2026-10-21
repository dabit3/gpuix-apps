export type Field = { name: string; value: number; unit?: string }
export type Parsed =
  | { kind: 'data'; fields: Field[]; x?: number }
  | { kind: 'header'; names: string[] }
  | { kind: 'text' }

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`
const NUM_TOKEN = new RegExp(`^(${NUM})(%|ms|us|µs|ns|s|[kKMGT]i?B?|B)?$`)
const PAIR = new RegExp(String.raw`([A-Za-z_][\w.\-]*)\s*[=:]\s*(${NUM})`, 'g')
const UNIT_AFTER = /\s*([A-Za-zµ°%][A-Za-z\/%]*)/y
const UNITS = new Set([
  'ms', 'us', 'µs', 'ns', 's', 'sec', '%', 'B', 'KB', 'MB', 'GB', 'KiB', 'MiB', 'GiB', 'kB', 'kb', 'mb', 'gb',
  'req/s', 'rps', 'qps', '/s', 'MB/s', 'KB/s', 'kB/s', 'GB/s', '°C', 'C', 'W', 'fps', 'ops/s',
])
const TIME_COLUMN = /^(time|timestamp|ts|date|datetime|epoch|t|x)$/i
const MULT: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 }

/** `12.5`, `40%`, `7ms`, `1.2K` (scaled to 1200). Returns null for anything else. */
export function parseNumber(token: string): { value: number; unit?: string } | null {
  const m = NUM_TOKEN.exec(token)
  if (!m) return null
  const value = Number(m[1])
  const suffix = m[2]
  if (!suffix) return { value }
  if (suffix === '%' || suffix === 'ms' || suffix === 'us' || suffix === 'µs' || suffix === 'ns' || suffix === 's') return { value, unit: suffix }
  const base = suffix.replace(/B$/, '')
  if (!base) return { value, unit: 'B' }
  const mult = MULT[base]
  return mult ? { value: value * mult, unit: suffix.endsWith('B') ? 'B' : undefined } : null
}

/** Epoch seconds from an ISO date, epoch seconds or epoch milliseconds. */
export function parseTime(token: string): number | null {
  const t = token.trim()
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t)
    return n > 1e11 ? n / 1000 : n
  }
  if (/^\d{4}-\d\d-\d\d/.test(t) || /^\d\d:\d\d(:\d\d)?/.test(t)) {
    const iso = /^\d\d:/.test(t) ? `${new Date().toISOString().slice(0, 10)}T${t}` : t.replace(' ', 'T')
    const ms = Date.parse(iso)
    return Number.isFinite(ms) ? ms / 1000 : null
  }
  return null
}

function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((raw) => {
    const n = raw || 'col'
    const k = (seen.get(n) ?? 0) + 1
    seen.set(n, k)
    return k === 1 ? n : `${n} ${k}`
  })
}

function unitFromName(name: string): string | undefined {
  const m = /[_\s(](ms|us|s|pct|percent|mb|kb|gb|bytes)\)?$/i.exec(name)
  if (!m) return undefined
  const u = m[1]!.toLowerCase()
  return u === 'pct' || u === 'percent' ? '%' : u === 'mb' ? 'MB' : u === 'kb' ? 'KB' : u === 'gb' ? 'GB' : u === 'bytes' ? 'B' : u
}

/**
 * Turns lines of arbitrary command output or CSV into named numeric fields.
 *
 * - `key=value` / `key: value` pairs (ping's `time=7.1 ms`) become series named by key.
 * - Rows of bare numbers become positional columns named by the latest header row with the same width
 *   (iostat, vm_stat), or `col1…colN`.
 * - In CSV mode the first row is the header and a time-like column becomes the x axis.
 */
export class LineParser {
  header: string[] | null = null
  private delim: string | null = null

  constructor(readonly mode: 'auto' | 'csv' = 'auto') {}

  push(rawLine: string): Parsed {
    // eslint-disable-next-line no-control-regex
    const line = rawLine.replace(/\^D|[\u0000-\u0008\u000b-\u001f\u007f]|\u001b\[[0-9;?]*[A-Za-z]/g, '').trim()
    if (!line || line.startsWith('#')) return { kind: 'text' }
    return this.mode === 'csv' ? this.csv(line) : this.auto(line)
  }

  private csv(line: string): Parsed {
    if (this.delim === null) this.delim = line.includes('\t') ? '\t' : line.includes(',') ? ',' : line.includes(';') ? ';' : ' '
    const cells = (this.delim === ' ' ? line.split(/\s+/) : line.split(this.delim)).map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
    if (!this.header) {
      const numeric = cells.filter((c) => parseNumber(c) || parseTime(c) !== null).length
      if (numeric < cells.length) {
        this.header = dedupe(cells)
        return { kind: 'header', names: this.header }
      }
      this.header = cells.map((_, i) => `col${i + 1}`)
    }
    return this.row(cells)
  }

  private row(cells: string[]): Parsed {
    const names = this.header && this.header.length === cells.length ? this.header : cells.map((_, i) => `col${i + 1}`)
    const fields: Field[] = []
    let x: number | undefined
    cells.forEach((cell, i) => {
      const name = names[i]!
      if (x === undefined && TIME_COLUMN.test(name)) {
        const t = parseTime(cell)
        if (t !== null) {
          x = t
          return
        }
      }
      const n = parseNumber(cell)
      if (n) fields.push({ name, value: n.value, unit: n.unit ?? unitFromName(name) })
    })
    return fields.length ? { kind: 'data', fields, x } : { kind: 'text' }
  }

  private auto(line: string): Parsed {
    const pairs = this.pairs(line)
    if (pairs.length) return { kind: 'data', fields: pairs }

    if (line.includes(',')) {
      const cells = line.split(',').map((c) => c.trim())
      if (cells.length >= 2) {
        if (cells.every((c) => parseNumber(c) || parseTime(c) !== null)) return this.row(cells)
        if (cells.every((c) => /^[A-Za-z_][\w.\/%()-]*$/.test(c))) {
          this.header = dedupe(cells)
          return { kind: 'header', names: this.header }
        }
      }
    }

    const tokens = line.split(/\s+/)
    const numeric = tokens.filter((t) => parseNumber(t)).length
    if (numeric === tokens.length) return this.row(tokens)
    if (numeric === 0 && tokens.length >= 2) {
      this.header = dedupe(tokens)
      return { kind: 'header', names: this.header }
    }
    return { kind: 'text' }
  }

  private pairs(line: string): Field[] {
    const out: Field[] = []
    PAIR.lastIndex = 0
    for (let m = PAIR.exec(line); m; m = PAIR.exec(line)) {
      const end = PAIR.lastIndex
      // `min/avg/max = 1/2/3` style lists are summaries, not samples.
      if (line[end] === '/') continue
      let unit: string | undefined
      UNIT_AFTER.lastIndex = end
      const u = UNIT_AFTER.exec(line)
      if (u && UNITS.has(u[1]!) && !/^\s*[=:]/.test(line.slice(UNIT_AFTER.lastIndex))) {
        unit = u[1]
        PAIR.lastIndex = UNIT_AFTER.lastIndex
      }
      out.push({ name: m[1]!, value: Number(m[2]), unit })
    }
    return out
  }
}
