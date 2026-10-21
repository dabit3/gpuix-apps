export const POLITE = ["Please continue, you're doing great", 'Keep going']
export const SPICY = ['FASTER', 'Work FASTER', 'faster clanker', 'speed it up', 'go go go']

export const MAX_MESSAGE = 120
export const RATE_LIMIT_MS = 2000

/** One printable line: no control, format or escape characters, capped length. */
export function sanitizeMessage(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE)
}

/** Cycles through a list without repeating the previous pick. */
export class MessagePicker {
  private last = -1
  constructor(private rand: () => number = Math.random) {}
  pick(list: string[]): string {
    const clean = list.map(sanitizeMessage).filter(Boolean)
    if (clean.length === 0) return 'Keep going'
    if (clean.length === 1) return clean[0]
    let i = Math.floor(this.rand() * clean.length)
    if (i === this.last) i = (i + 1) % clean.length
    this.last = i
    return clean[i]
  }
}

export class RateLimiter {
  private last = -Infinity
  constructor(readonly intervalMs = RATE_LIMIT_MS) {}
  /** True if an event at `now` may go out; records it when it does. */
  take(now: number): boolean {
    if (now - this.last < this.intervalMs) return false
    this.last = now
    return true
  }
  remaining(now: number) {
    return Math.max(0, this.intervalMs - (now - this.last))
  }
}
