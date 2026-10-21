// Sample workload for flame: builds a 1200-page markdown docs site in memory.
//   bun --cpu-prof --cpu-prof-name build.cpuprofile workload/build.ts [--fast]
// --fast swaps in the optimized paths (cached RegExps, one-pass escaping,
// Bun.hash), so the profile's hot path visibly shrinks.
import { makeCorpus } from './content.ts'
import { parseMarkdown, renderHtml } from './markdown.ts'
import { buildSearchIndex } from './search-index.ts'

const fast = process.argv.includes('--fast')
const pagesArg = process.argv.find((a) => a.startsWith('--pages='))
const PAGES = pagesArg ? Number(pagesArg.slice(8)) : 1200

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function hashContent(html: string): string {
  if (fast) return Bun.hash(html).toString(16)
  // Slow path: hashes every line separately and then the joined digests.
  return fnv1a(html.split('\n').map((l) => fnv1a(l).toString(16)).join('')).toString(16)
}

function minifyHtml(html: string): string {
  return html.replace(/\n\s*/g, '').replace(/\s{2,}/g, ' ')
}

function renderPage(page: { path: string; source: string }) {
  const blocks = parseMarkdown(page.source)
  const html = minifyHtml(renderHtml(blocks, fast))
  return { path: page.path.replace(/\.md$/, '.html'), html, hash: hashContent(html) }
}

function buildSite() {
  const t0 = performance.now()
  const corpus = makeCorpus(PAGES)
  const pages = corpus.map(renderPage)
  const index = buildSearchIndex(pages, fast)
  const bytes = pages.reduce((n, p) => n + p.html.length, 0)
  const ms = performance.now() - t0
  console.log(
    `built ${pages.length} pages · ${(bytes / 1e6).toFixed(1)} MB html · ${index.size} index terms · ${ms.toFixed(0)} ms${fast ? ' (fast)' : ''}`,
  )
}

buildSite()
