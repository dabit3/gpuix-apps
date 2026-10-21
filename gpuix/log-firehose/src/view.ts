import { ALL_LEVELS, U32List, type LogStore } from './store'
import type { SearchJob } from './search'

/**
 * The filtered row list the virtual list scrolls. When nothing is filtered it
 * is the identity, so a 2M-line store costs no index at all.
 */
export class FilterView {
  levelMask = ALL_LEVELS
  serviceOff = new Uint8Array(256)
  onlyMatches = false
  list = new U32List(1 << 16)
  active = false
  /** Search matches that pass the level/service filters. */
  matchesInView = 0

  constructor(private store: LogStore) {}

  get count() {
    return this.active ? this.list.length : this.store.count
  }
  lineAt(pos: number) {
    return this.active ? this.list.data[pos]! : pos
  }
  /** View position of `line`, or of the next visible line after it. */
  posOf(line: number) {
    return this.active ? this.list.lowerBound(line) : Math.min(line, this.store.count)
  }
  passes(i: number) {
    const s = this.store
    return ((this.levelMask >> s.level[i]!) & 1) === 1 && this.serviceOff[s.svc[i]!] === 0
  }
  private filtersOn() {
    return this.levelMask !== ALL_LEVELS || this.serviceOff.some((v) => v !== 0)
  }

  rebuild(job: SearchJob | null) {
    const s = this.store
    this.list.clear()
    const filtered = this.filtersOn()
    if (this.onlyMatches && job) {
      this.active = true
      const m = job.matches
      for (let k = 0; k < m.length; k++) {
        const i = m.data[k]!
        if (this.passes(i)) this.list.push(i)
      }
      this.matchesInView = this.list.length
      return
    }
    this.active = filtered
    if (filtered) {
      for (let i = 0; i < s.count; i++) if (this.passes(i)) this.list.push(i)
    }
    this.matchesInView = 0
    if (job) {
      const m = job.matches
      if (!filtered) this.matchesInView = m.length
      else for (let k = 0; k < m.length; k++) if (this.passes(m.data[k]!)) this.matchesInView++
    }
  }

  /** New lines [from, to) were appended to the store. */
  onIngest(from: number, to: number) {
    if (!this.active || this.onlyMatches) return
    for (let i = from; i < to; i++) if (this.passes(i)) this.list.push(i)
  }

  /** The running search found `line`. */
  onMatch(line: number) {
    if (!this.passes(line)) return
    this.matchesInView++
    if (this.onlyMatches && this.active) this.list.push(line)
  }
}
