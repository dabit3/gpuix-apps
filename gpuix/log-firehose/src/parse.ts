import { LEVEL_INDEX } from './store'

/**
 * Line layout written by the generator and the sample script:
 * `2026-10-21T19:53:01.123Z INFO  payments req=9f2c41d7 message {"json":1}`
 * Lines from other files fall back to looser detection.
 */
export interface ParsedLine {
  time: string
  level: string
  service: string
  rest: string
  requestId: string | null
  payload: string | null
}

const LEVEL_WORDS: Array<[RegExp, number]> = [
  [/\b(FATAL|CRIT(ICAL)?|PANIC|EMERG)\b/i, 5],
  [/\b(ERROR|ERR|SEVERE)\b/i, 4],
  [/\b(WARN(ING)?)\b/i, 3],
  [/\b(INFO|NOTICE)\b/i, 2],
  [/\b(DEBUG|DBG)\b/i, 1],
  [/\b(TRACE|VERBOSE)\b/i, 0],
]

const d = (s: string, i: number) => s.charCodeAt(i) - 48

/** Fast fixed-width ISO-8601 UTC parse (`YYYY-MM-DDTHH:MM:SS.mmmZ`), NaN when it isn't one. */
export function parseIsoFast(s: string, at = 0): number {
  if (s.charCodeAt(at + 4) !== 45 || s.charCodeAt(at + 10) !== 84) return NaN
  const y = d(s, at) * 1000 + d(s, at + 1) * 100 + d(s, at + 2) * 10 + d(s, at + 3)
  const mo = d(s, at + 5) * 10 + d(s, at + 6)
  const da = d(s, at + 8) * 10 + d(s, at + 9)
  const h = d(s, at + 11) * 10 + d(s, at + 12)
  const mi = d(s, at + 14) * 10 + d(s, at + 15)
  const se = d(s, at + 17) * 10 + d(s, at + 18)
  const ms = s.charCodeAt(at + 19) === 46 ? d(s, at + 20) * 100 + d(s, at + 21) * 10 + d(s, at + 22) : 0
  const t = Date.UTC(y, mo - 1, da, h, mi, se, ms)
  return t
}

/** Metadata for one raw line: [ts, level, serviceName]. */
export function parseMeta(line: string, fallbackTs: number): [number, number, string] {
  let ts = line.length >= 24 ? parseIsoFast(line, 0) : NaN
  if (Number.isNaN(ts)) ts = fallbackTs
  const lv = line.slice(25, 30).trimEnd()
  let level = LEVEL_INDEX[lv]
  let service = '-'
  if (level !== undefined) {
    const sEnd = line.indexOf(' ', 31)
    service = line.slice(31, sEnd < 0 ? line.length : sEnd) || '-'
  } else {
    level = 2
    const head = line.length > 200 ? line.slice(0, 200) : line
    for (const [re, l] of LEVEL_WORDS) {
      if (re.test(head)) {
        level = l
        break
      }
    }
  }
  return [ts, level, service]
}

export function parseLine(line: string): ParsedLine {
  const structured = line.length > 31 && LEVEL_INDEX[line.slice(25, 30).trimEnd()] !== undefined
  if (!structured) {
    return { time: '', level: '', service: '', rest: line, requestId: null, payload: null }
  }
  const sEnd = line.indexOf(' ', 31)
  const service = line.slice(31, sEnd < 0 ? line.length : sEnd)
  const rest = sEnd < 0 ? '' : line.slice(sEnd + 1)
  const req = /^req=([0-9a-f]+)/.exec(rest)
  const brace = rest.indexOf(' {')
  return {
    time: line.slice(11, 23),
    level: line.slice(25, 30).trimEnd(),
    service,
    rest,
    requestId: req ? req[1]! : null,
    payload: brace >= 0 ? rest.slice(brace + 1) : null,
  }
}

/** HH:MM[:SS[.mmm]] → ms since midnight, or null. */
export function parseClock(text: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*$/.exec(text)
  if (!m) return null
  const h = +m[1]!
  const mi = +m[2]!
  const s = m[3] ? +m[3] : 0
  const ms = m[4] ? +m[4].padEnd(3, '0') : 0
  if (h > 23 || mi > 59 || s > 59) return null
  return ((h * 60 + mi) * 60 + s) * 1000 + ms
}
