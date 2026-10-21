// Deterministic markdown corpus for the sample build: a docs site with
// prose, lists, tables and fenced TypeScript.
const WORDS = (
  'render frame layout paint gpu terminal window scene shader buffer texture glyph ' +
  'atlas cache pixel element tree reconcile commit mutation event pointer scroll ' +
  'focus keyboard theme palette border radius shadow flex column row gap padding ' +
  'virtual list sample profile stack frame call graph flame icicle sandwich hot path'
).split(' ')

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const SNIPPETS = [
  `export function layout(node: Node, width: number): Box {
  const children = node.children.map((c) => layout(c, width))
  const height = children.reduce((h, c) => h + c.height, 0)
  return { width, height, children }
}`,
  `const cache = new Map<string, Glyph>()
async function glyph(ch: string, size: number): Promise<Glyph> {
  const key = ch + ':' + size
  if (cache.has(key)) return cache.get(key)!
  const g = await rasterize(ch, size)
  cache.set(key, g)
  return g
}`,
  `class FrameClock {
  private last = performance.now()
  tick(): number {
    const now = performance.now()
    const dt = now - this.last
    this.last = now
    return Math.min(dt, 1000 / 30)
  }
}`,
]

export function makeCorpus(pages: number, seed = 7): { path: string; source: string }[] {
  const rand = rng(seed)
  const pick = () => WORDS[Math.floor(rand() * WORDS.length)]!
  const sentence = (n: number) => {
    const w = Array.from({ length: n }, pick)
    w[0] = w[0]![0]!.toUpperCase() + w[0]!.slice(1)
    if (rand() < 0.3) w[2] = `**${w[2]}**`
    if (rand() < 0.3) w[4] = `\`${w[4]}\``
    if (rand() < 0.2) w[5] = `[${w[5]}](https://gpuix.dev/${w[5]})`
    return w.join(' ') + '.'
  }
  const out: { path: string; source: string }[] = []
  for (let p = 0; p < pages; p++) {
    const lines: string[] = [`# ${sentence(4).slice(0, -1)}`, '']
    const sections = 3 + Math.floor(rand() * 4)
    for (let s = 0; s < sections; s++) {
      lines.push(`## ${sentence(3).slice(0, -1)}`, '')
      for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) {
        lines.push(Array.from({ length: 3 + Math.floor(rand() * 4) }, () => sentence(8 + Math.floor(rand() * 10))).join(' '), '')
      }
      if (rand() < 0.6) {
        for (let k = 0; k < 4; k++) lines.push(`- ${sentence(6)}`)
        lines.push('')
      }
      if (rand() < 0.5) {
        lines.push('```ts', SNIPPETS[Math.floor(rand() * SNIPPETS.length)]!, '```', '')
      }
      if (rand() < 0.3) {
        lines.push('| name | value | notes |', '| --- | --- | --- |')
        for (let k = 0; k < 4; k++) lines.push(`| ${pick()} | ${Math.floor(rand() * 1000)} | ${sentence(4)} |`)
        lines.push('')
      }
    }
    out.push({ path: `docs/${pick()}-${p}.md`, source: lines.join('\n') })
  }
  return out
}
