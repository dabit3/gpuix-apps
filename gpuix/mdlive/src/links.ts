import { existsSync, openSync, writeSync, closeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type LinkTarget =
  | { kind: 'anchor'; slug: string }
  | { kind: 'doc'; path: string; slug?: string }
  | { kind: 'external'; url: string }
  | { kind: 'missing'; path: string }

const MD = /\.(md|markdown|mdx)$/i

/** Classifies a link clicked inside the document at `fromPath`. */
export function resolveLink(fromPath: string, href: string): LinkTarget {
  const h = href.trim()
  if (h.startsWith('#')) return { kind: 'anchor', slug: decodeURIComponent(h.slice(1)).toLowerCase() }
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) {
    if (h.startsWith('file://')) return resolveLink(fromPath, decodeURIComponent(h.slice(7)))
    return { kind: 'external', url: h }
  }
  const [rel = '', anchor] = h.split('#')
  const path = resolve(dirname(fromPath), decodeURIComponent(rel))
  if (!MD.test(path)) return existsSync(path) ? { kind: 'external', url: `file://${path}` } : { kind: 'missing', path }
  if (!existsSync(path)) return { kind: 'missing', path }
  return { kind: 'doc', path, slug: anchor ? anchor.toLowerCase() : undefined }
}

export function osc52(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`
}

/** Copies via OSC 52 in a terminal (works over SSH), pbcopy in a native window. */
export function copyText(text: string, terminal: boolean): boolean {
  try {
    if (terminal) {
      const fd = openSync('/dev/tty', 'w')
      writeSync(fd, osc52(text))
      closeSync(fd)
      return true
    }
    const p = Bun.spawn(['pbcopy'], { stdin: 'pipe' })
    p.stdin.write(text)
    p.stdin.end()
    return true
  } catch {
    return false
  }
}

export function openExternal(url: string) {
  try {
    Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' })
  } catch {}
}

/** Subsequence match with a score that favours word starts and contiguous runs. */
export function fuzzy(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const s = text.toLowerCase()
  let score = 0
  let qi = 0
  let prev = -2
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] !== q[qi]) continue
    score += i === prev + 1 ? 3 : 1
    if (i === 0 || s[i - 1] === ' ' || s[i - 1] === '-') score += 4
    prev = i
    qi++
  }
  return qi === q.length ? score - s.length * 0.01 : null
}
