import { U32List, type LogStore } from './store'

export interface SearchSpec {
  query: string
  regex: boolean
  caseSensitive: boolean
}

export function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Compile a spec into a global multiline regex, or an error message. */
export function compileSearch(spec: SearchSpec): RegExp | string | null {
  if (!spec.query) return null
  const source = spec.regex ? spec.query : escapeRegExp(spec.query)
  try {
    return new RegExp(source, spec.caseSensitive ? 'gm' : 'gim')
  } catch (err) {
    return (err as Error).message.replace(/^Invalid regular expression: /, '')
  }
}

/** Match ranges inside one string (UTF-16 offsets), capped for very dense matches. */
export function rangesIn(re: RegExp, text: string, cap = 64): Array<[number, number]> {
  const out: Array<[number, number]> = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && out.length < cap) {
    const end = m.index + m[0].length
    if (end > m.index) out.push([m.index, end])
    else re.lastIndex++
  }
  return out
}

/**
 * Incremental search over the store. Sealed chunks are scanned with one native
 * regex pass per chunk; after a hit the scan skips to the next line, so cost
 * stays proportional to text size rather than to match count. The open chunk
 * and newly streamed lines are tested line by line. `matches` stays sorted.
 */
export class SearchJob {
  matches = new U32List(4096)
  scanned = 0
  private lineRe: RegExp

  constructor(
    private store: LogStore,
    public re: RegExp,
  ) {
    this.lineRe = new RegExp(re.source, re.flags.replace('g', ''))
  }

  get done() {
    return this.scanned >= this.store.count
  }

  get progress() {
    return this.store.count === 0 ? 1 : this.scanned / this.store.count
  }

  /** Scan until caught up or `budgetMs` elapsed. Returns the number of new matches. */
  step(budgetMs: number, onMatch?: (line: number) => void): number {
    const s = this.store
    const deadline = performance.now() + budgetMs
    const re = this.re
    let found = 0
    while (this.scanned < s.count) {
      const c = s.chunkOf[this.scanned]!
      if (c < s.chunks.length) {
        const text = s.chunks[c]!
        const last = c + 1 < s.chunks.length ? s.chunkFirst[c + 1]! : s.openBase
        let lo = this.scanned
        re.lastIndex = s.start[this.scanned]!
        let m: RegExpExecArray | null
        while ((m = re.exec(text))) {
          // the line holding m.index: last line in [lo, last) with start <= index
          let a = lo
          let b = last - 1
          while (a < b) {
            const mid = (a + b + 1) >>> 1
            if (s.start[mid]! <= m.index) a = mid
            else b = mid - 1
          }
          this.matches.push(a)
          onMatch?.(a)
          found++
          lo = a + 1
          if (lo >= last) break
          re.lastIndex = s.start[lo]!
        }
        this.scanned = last
      } else {
        const lineRe = this.lineRe
        let n = 0
        while (this.scanned < s.count) {
          const i = this.scanned++
          if (lineRe.test(s.line(i))) {
            this.matches.push(i)
            onMatch?.(i)
            found++
          }
          if (++n % 4096 === 0 && performance.now() > deadline) break
        }
      }
      if (performance.now() > deadline) break
    }
    return found
  }
}
