/** Subsequence fuzzy match with Raycast-like scoring. Returns matched char indices for highlighting. */
export interface FuzzyMatch {
  score: number
  indices: number[]
}

const isBoundary = (text: string, i: number) => {
  if (i === 0) return true
  const prev = text[i - 1]!
  const cur = text[i]!
  return /[\s\-_./()]/.test(prev) || (prev === prev.toLowerCase() && cur !== cur.toLowerCase())
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, indices: [] }
  const t = text.toLowerCase()

  // Contiguous substring wins outright, prefix and word-start more so.
  const at = t.indexOf(q)
  if (at >= 0) {
    const indices = Array.from({ length: q.length }, (_, k) => at + k)
    let score = 100 + q.length * 6
    if (at === 0) score += 60
    else if (isBoundary(text, at)) score += 35
    score -= at * 0.5
    score -= (t.length - q.length) * 0.15
    return { score, indices }
  }

  // Greedy subsequence, preferring word boundaries when one is available ahead.
  const indices: number[] = []
  let score = 0
  let ti = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    if (ch === ' ') continue
    let found = -1
    let boundary = -1
    for (let k = ti; k < t.length; k++) {
      if (t[k] !== ch) continue
      if (found < 0) found = k
      if (isBoundary(text, k)) {
        boundary = k
        break
      }
      if (k - ti > 12) break
    }
    const prevIdx = indices[indices.length - 1]
    const contiguous = prevIdx !== undefined && found === prevIdx + 1
    const pick = !contiguous && boundary >= 0 && (found < 0 || boundary - found < 8) ? boundary : found
    if (pick < 0) return null
    const prev = indices[indices.length - 1]
    score += 10
    if (isBoundary(text, pick)) score += 14
    if (prev !== undefined && pick === prev + 1) score += 9
    if (prev !== undefined) score -= Math.min(pick - prev - 1, 10) * 1.2
    indices.push(pick)
    ti = pick + 1
  }
  score -= (indices[0] ?? 0) * 0.8
  score -= (t.length - indices.length) * 0.2
  return { score, indices }
}

/** Splits text into runs so the UI can paint matched characters in the accent colour. */
export function highlightRuns(text: string, indices: number[]): { text: string; match: boolean }[] {
  if (!indices.length) return [{ text, match: false }]
  const set = new Set(indices)
  const runs: { text: string; match: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const match = set.has(i)
    const last = runs[runs.length - 1]
    if (last && last.match === match) last.text += text[i]
    else runs.push({ text: text[i]!, match })
  }
  return runs
}
