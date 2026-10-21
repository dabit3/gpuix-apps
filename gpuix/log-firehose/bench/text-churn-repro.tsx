/**
 * Minimal repro used for the GPUIX findings: per-frame native flush cost and RSS
 * growth for 40 changing text rows in different containers.
 * `bun bench/text-churn-repro.tsx <same|text|vlist|vlist-follow|img>`
 */
import { useLayoutEffect, useRef } from 'react'
import { createTestRoot } from '@gpuix/react/testing'
import type { ImgInstance } from '@gpuix/react'

const mode = process.argv[2] ?? 'text'
const root = createTestRoot({ width: 1200, height: 900 })
const W = 120
const BASE = Number(process.env.BASE ?? 200_000)
const STEP = Number(process.env.STEP ?? 833)

function rowsFor(f: number, start: number, n: number) {
  const rows = []
  for (let pos = start; pos < start + n; pos++) {
    const s = mode === 'same' ? `row ${pos} the quick brown fox jumps over the lazy dog` : `row ${f}-${pos} ${(pos * 2654435761 % 1e9).toString(36)} the quick brown fox jumps over the lazy dog ${f}`
    rows.push(
      <div key={pos % W} style={{ height: 22 }}>
        <text style={{ color: '#fff', fontFamily: 'Menlo', fontSize: 12, whiteSpace: 'nowrap' }}>{s}</text>
      </div>,
    )
  }
  return rows
}

function Img({ f }: { f: number }) {
  const ref = useRef<ImgInstance>(null)
  useLayoutEffect(() => {
    ref.current?.setImagePixels(2400, 128, Buffer.alloc(2400 * 128 * 4, f % 255), { format: 'bgra' })
  }, [f])
  return <img ref={ref} objectFit="fill" style={{ width: 1200, height: 64 }} />
}

function App({ f }: { f: number }) {
  if (mode.startsWith('vlist')) {
    const count = BASE + f * STEP
    const start = mode === "vlist-scroll" ? (f * 37) % (count - W) : count - W
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#000' }}>
        <virtual-list itemCount={count} windowStart={start} estimatedItemHeight={22} alignment="bottom" followTail={mode === 'vlist-follow'} style={{ flexGrow: 1, minHeight: 0 }}>
          {rowsFor(f, start, W)}
        </virtual-list>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#000' }}>
      {mode === 'img' && <Img f={f} />}
      {rowsFor(f, 0, 40)}
    </div>
  )
}

const rss0 = process.memoryUsage().rss
const t: number[] = []
for (let f = 0; f < 300; f++) {
  root.render(<App f={f} />)
  const a = performance.now()
  root.renderer.flush()
  t.push(performance.now() - a)
}
t.sort((a, b) => a - b)
console.log(`${mode}: flush p50 ${t[150]!.toFixed(2)} ms p90 ${t[270]!.toFixed(2)} ms; rss +${((process.memoryUsage().rss - rss0) / 1e6).toFixed(0)} MB over 300 frames`)
process.exit(0)
