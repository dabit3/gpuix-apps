/** Frame cost while streaming, on the GPU test renderer: `bun bench/frame-bench.tsx [linesPerFrame]` */
import { createTestRoot } from '@gpuix/react/testing'
import { flushSync } from '@gpuix/react'
import { Controller } from '../src/controller'
import { FirehoseApp } from '../src/app'

const perFrame = Number(process.argv[2] ?? 833)
const ctl = new Controller()
ctl.ingestLive(200_000, Date.now())
const root = createTestRoot({ width: 1480, height: 920 })
root.render(<FirehoseApp ctl={ctl} />)
root.renderer.flush()
const react: number[] = []
const paint: number[] = []
const rss0 = process.memoryUsage().rss
for (let f = 0; f < 240; f++) {
  ctl.ingestLive(perFrame, Date.now())
  const t0 = performance.now()
  flushSync(() => ctl.flushNow())
  const t1 = performance.now()
  root.renderer.flush()
  const t2 = performance.now()
  react.push(t1 - t0)
  paint.push(t2 - t1)
}
const p = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)]!.toFixed(2)
console.log(`${perFrame} lines/frame: react p50 ${p(react, 0.5)} ms p90 ${p(react, 0.9)} | native flush p50 ${p(paint, 0.5)} ms p90 ${p(paint, 0.9)} | rss +${((process.memoryUsage().rss - rss0) / 1e6).toFixed(0)} MB over 240 frames`)
process.exit(0)
