// Startup and query timings for the bundled 26 MB GitHub events dump, through the Metal test renderer.
import { createTestRoot } from '@gpuix/react/testing'
import { App } from './src/App'
import { countNodes, readSource, type Json } from './src/json'
import { runQuery } from './src/query'
import { inferSchema } from './src/schema'

const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`
let t = performance.now()
const src = readSource('data/github-events.json.gz')
console.log(`read + gunzip ${(src.text.length / 2 ** 20).toFixed(1)} MB: ${ms(t)}`)
t = performance.now()
const root = JSON.parse(src.text) as Json
console.log(`JSON.parse: ${ms(t)}`)
t = performance.now()
console.log(`count ${countNodes(root).toLocaleString()} nodes: ${ms(t)}`)
t = performance.now()
inferSchema(root)
console.log(`schema inference: ${ms(t)}`)
for (const q of ['.[] | select(.type == "PushEvent") | .repo.name', 'group_by(.type) | map({type: .[0].type, n: length})', '.[] | .payload.commits[]? | .author.name']) {
  t = performance.now()
  const n = runQuery(q, root).length
  console.log(`filter ${q} -> ${n.toLocaleString()}: ${ms(t)}`)
}
t = performance.now()
const r = createTestRoot({ width: 1440, height: 860 })
r.render(<App docs={[{ name: 'github-events.json.gz', bytes: src.bytes, root }]} />)
r.renderer.flush()
console.log(`first render (mount + layout + paint): ${ms(t)}`)
const app = r.renderer.findByTestId('app')!
const frames: number[] = []
for (let i = 0; i < 120; i++) {
  const t0 = performance.now()
  r.renderer.nativeSimulateKeystrokes(app.id, 'down')
  r.renderer.flush()
  frames.push(performance.now() - t0)
}
frames.sort((a, b) => a - b)
console.log(`cursor move + repaint p50 ${frames[60]!.toFixed(1)} ms, p95 ${frames[114]!.toFixed(1)} ms`)
console.log(`rss ${(process.memoryUsage().rss / 2 ** 20).toFixed(0)} MB, heap ${(process.memoryUsage().heapUsed / 2 ** 20).toFixed(0)} MB`)
process.exit(0)
