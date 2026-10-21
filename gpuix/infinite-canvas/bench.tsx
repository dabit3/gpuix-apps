// Frame-time benchmark for the 10k stress field on the GPUIX Metal test renderer.
// Every sample = one wheel event + a full GPUI build/layout/paint (renderer.flush()).
// usage: bun bench.tsx
import { createTestRoot } from '@gpuix/react/testing'
import { App } from './src/App'

const W = 1440, H = 900
type Stats = { total: number; painted: number; mode: string; zoom: number }
let stats: Stats = { total: 0, painted: 0, mode: '', zoom: 1 }
const t0 = performance.now()
const { render, renderer: r } = createTestRoot({ width: W, height: H })
render(<App onStats={(s) => { stats = s }} />)
r.flush()
console.log(`mount (empty board): ${(performance.now() - t0).toFixed(0)} ms`)

const b = r.getElementBounds(r.findByTestId('stress')!.id)!
const ts = performance.now()
r.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2)
r.flush()
console.log(`spawn 10k + first paint: ${(performance.now() - ts).toFixed(0)} ms`)
await new Promise((res) => setTimeout(res, 900))
r.flush()

function pct(xs: number[], p: number) { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! }
function pan(label: string, n = 120) {
  const xs: number[] = []
  const painted: number[] = []
  for (let i = 0; i < n; i++) {
    const dir = Math.floor(i / 20) % 2 ? -1 : 1
    const s = performance.now()
    r.nativeSimulateScrollWheel(W / 2, H / 2, dir * 18, dir * 9)
    r.flush()
    if (i >= 10) { xs.push(performance.now() - s); painted.push(stats.painted) }
  }
  const p50 = pct(xs, 50), p95 = pct(xs, 95)
  console.log(`${label.padEnd(22)} zoom=${(stats.zoom * 100).toFixed(0).padStart(3)}% mode=${stats.mode.padEnd(5)} painted≈${Math.round(painted.reduce((a, b) => a + b, 0) / painted.length).toString().padStart(5)}  p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms (~${Math.round(1000 / p50)} fps)`)
}
function zoomTo(z: number) {
  for (let i = 0; i < 200 && Math.abs(Math.log(stats.zoom / z)) > 0.1; i++) {
    r.nativeSimulateScrollWheel(W / 2, H / 2, 0, stats.zoom < z ? 15 : -15, 'cmd')
    r.flush()
  }
}
pan('fit (all 10k)')
zoomTo(0.2); pan('zoomed out')
zoomTo(0.45); pan('mid')
zoomTo(1); pan('100%')
const mem = process.memoryUsage()
console.log(`rss=${(mem.rss / 1048576).toFixed(0)} MB heap=${(mem.heapUsed / 1048576).toFixed(0)} MB`)
process.exit(0)
