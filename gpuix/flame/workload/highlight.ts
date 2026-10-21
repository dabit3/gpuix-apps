const KEYWORDS = [
  'export', 'function', 'const', 'let', 'return', 'class', 'private', 'async', 'await',
  'new', 'if', 'else', 'for', 'while', 'import', 'from', 'type', 'interface', 'number', 'string',
]

export type Token = { kind: 'kw' | 'str' | 'num' | 'id' | 'punct' | 'ws'; text: string }

// Slow path: rebuilds a RegExp for every keyword on every word.
function isKeywordSlow(word: string): boolean {
  for (const kw of KEYWORDS) {
    if (new RegExp(`^${kw}$`).test(word)) return true
  }
  return false
}

const KEYWORD_SET = new Set(KEYWORDS)

function tokenizeLine(line: string, fast: boolean): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (ch === ' ') {
      let j = i
      while (line[j] === ' ') j++
      out.push({ kind: 'ws', text: line.slice(i, j) })
      i = j
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < line.length && line[j] !== ch) j++
      out.push({ kind: 'str', text: line.slice(i, j + 1) })
      i = j + 1
    } else if (/[0-9]/.test(ch)) {
      let j = i
      while (j < line.length && /[0-9.]/.test(line[j]!)) j++
      out.push({ kind: 'num', text: line.slice(i, j) })
      i = j
    } else if (/[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < line.length && /[A-Za-z0-9_$]/.test(line[j]!)) j++
      const word = line.slice(i, j)
      const kw = fast ? KEYWORD_SET.has(word) : isKeywordSlow(word)
      out.push({ kind: kw ? 'kw' : 'id', text: word })
      i = j
    } else {
      out.push({ kind: 'punct', text: ch })
      i++
    }
  }
  return out
}

export function highlightCode(code: string, fast: boolean, escape: (s: string) => string): string {
  return code
    .split('\n')
    .map((line) =>
      tokenizeLine(line, fast)
        .map((t) => (t.kind === 'ws' || t.kind === 'punct' ? escape(t.text) : `<span class="${t.kind}">${escape(t.text)}</span>`))
        .join(''),
    )
    .join('\n')
}
