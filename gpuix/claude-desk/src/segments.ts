export type Segment = { kind: 'markdown'; source: string } | { kind: 'diff'; patch: string }

const FENCE = /^```diff[^\n]*\n([\s\S]*?)^```[ \t]*$/gm

/** GPUIX's <diff> wants file headers. Models often skip them. */
export function normalizePatch(body: string): string | null {
  if (!/^@@ /m.test(body)) return null
  if (/^--- /m.test(body) && /^\+\+\+ /m.test(body)) return body.endsWith('\n') ? body : body + '\n'
  const patch = `--- a/snippet\n+++ b/snippet\n${body}`
  return patch.endsWith('\n') ? patch : patch + '\n'
}

/**
 * Splits a reply into markdown runs and closed ```diff fences. An unclosed
 * fence (still streaming) stays markdown until its closing ``` arrives.
 */
export function splitSegments(source: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const match of source.matchAll(FENCE)) {
    const patch = normalizePatch(match[1] ?? '')
    if (!patch) continue
    const before = source.slice(last, match.index)
    if (before.trim()) out.push({ kind: 'markdown', source: before })
    out.push({ kind: 'diff', patch })
    last = (match.index ?? 0) + match[0].length
  }
  const rest = source.slice(last)
  if (rest.trim() || out.length === 0) out.push({ kind: 'markdown', source: rest })
  return out
}
