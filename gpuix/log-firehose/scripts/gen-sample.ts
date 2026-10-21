/** Writes a large sample log: `bun scripts/gen-sample.ts [lines=2000000] [out=sample-2m.log]` */
import { LogGenerator } from '../src/generator'

const lines = Number(process.argv[2] ?? 2_000_000)
const out = process.argv[3] ?? 'sample-2m.log'
const rate = 8_000 // lines per second of simulated time
const gen = new LogGenerator(2026)
const t0 = Date.UTC(2026, 9, 21, 14, 0, 0)
const writer = Bun.file(out).writer()
const started = performance.now()
let buf: string[] = []
for (let i = 0; i < lines; i++) {
  buf.push(gen.line(Math.floor(t0 + (i * 1000) / rate)).text)
  if (buf.length === 50_000) {
    writer.write(buf.join('\n') + '\n')
    buf = []
  }
}
if (buf.length) writer.write(buf.join('\n') + '\n')
await writer.end()
const size = Bun.file(out).size
console.log(`wrote ${lines.toLocaleString()} lines (${(size / 1e6).toFixed(0)} MB) to ${out} in ${((performance.now() - started) / 1000).toFixed(1)}s`)
