/** Data-layer timings: `bun bench/data-bench.ts sample-2m.log` */
import { Controller } from '../src/controller'
import { SearchJob, compileSearch } from '../src/search'

const path = process.argv[2] ?? 'sample-2m.log'
const ctl = new Controller()
const rss = () => `${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`
let t = performance.now()
await ctl.loadFile(path, { yieldEvery: 1_000_000 })
console.log(`load ${ctl.store.count.toLocaleString()} lines: ${(performance.now() - t).toFixed(0)} ms, rss ${rss()}`)
for (const [q, regex] of [['timeout', false], ['ord_[0-9a-f]{4}e', true], ['pool exhausted', false], ['req=923ac401', false]] as const) {
  const re = compileSearch({ query: q, regex, caseSensitive: false }) as RegExp
  const job = new SearchJob(ctl.store, re)
  t = performance.now()
  while (!job.done) job.step(1000)
  console.log(`search ${JSON.stringify(q)}${regex ? ' (regex)' : ''}: ${job.matches.length.toLocaleString()} lines in ${(performance.now() - t).toFixed(0)} ms`)
}
t = performance.now()
ctl.toggleLevel(4, true)
console.log(`level filter (ERROR only): ${ctl.view.count.toLocaleString()} rows in ${(performance.now() - t).toFixed(1)} ms`)
t = performance.now()
ctl.resetFilters()
ctl.toggleService(3, true)
console.log(`service filter (payments only): ${ctl.view.count.toLocaleString()} rows in ${(performance.now() - t).toFixed(1)} ms`)
const live = new Controller()
t = performance.now()
live.ingestLive(500_000, Date.now())
console.log(`generate 500k live lines: ${(performance.now() - t).toFixed(0)} ms (${((500_000 / (performance.now() - t)) * 1000).toFixed(0)} lines/s max)`)
