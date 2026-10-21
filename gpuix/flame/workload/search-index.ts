const SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ers', 'er', 'ies', 'es', 's', 'ed', 'ly']

function stemWord(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) return word.slice(0, -suffix.length)
  }
  return word
}

const stemCache = new Map<string, string>()
function stemCached(word: string): string {
  let s = stemCache.get(word)
  if (s === undefined) stemCache.set(word, (s = stemWord(word)))
  return s
}

function tokenizeWords(html: string): string[] {
  return html
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)
}

// Slow path: postings are arrays, so every word does a linear `includes` scan.
function addPostingSlow(index: Map<string, string[]>, stem: string, path: string) {
  let list = index.get(stem)
  if (!list) index.set(stem, (list = []))
  if (!list.includes(path)) list.push(path)
}

function addPostingFast(index: Map<string, Set<string>>, stem: string, path: string) {
  let set = index.get(stem)
  if (!set) index.set(stem, (set = new Set()))
  set.add(path)
}

export function buildSearchIndex(pages: { path: string; html: string }[], fast: boolean): Map<string, unknown> {
  if (fast) {
    const index = new Map<string, Set<string>>()
    for (const page of pages) for (const word of tokenizeWords(page.html)) addPostingFast(index, stemCached(word), page.path)
    return index
  }
  const index = new Map<string, string[]>()
  for (const page of pages) for (const word of tokenizeWords(page.html)) addPostingSlow(index, stemWord(word), page.path)
  return index
}
