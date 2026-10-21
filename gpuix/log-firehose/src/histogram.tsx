import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { EventPayload, ImgInstance } from '@gpuix/react'
import type { Controller } from './controller'
import { C, MONO, fmt, fmtCompact } from './theme'

const H = 64
const LIVE_SECONDS = 120
const SCALE = 2

interface Layout {
  firstBin: number
  bins: number
  bucket: number
  max: number
}

function barPx(width: number) {
  return Math.max(4, Math.floor(width / LIVE_SECONDS))
}

function computeLayout(ctl: Controller, width: number): Layout {
  const h = ctl.hist
  const fit = Math.max(1, Math.floor(width / barPx(width)))
  const secs = h.seconds
  if (ctl.source.kind === 'live' || secs <= fit) {
    // live: newest second at the right edge; a short file: start at the left
    const firstBin = ctl.source.kind === 'live' ? secs - fit : 0
    let max = 1
    for (let k = Math.max(0, firstBin); k < secs; k++) max = Math.max(max, h.bins[0][k]! + h.bins[1][k]! + h.bins[2][k]!)
    return { firstBin, bins: fit, bucket: 1, max }
  }
  const bucket = Math.ceil(secs / fit)
  let max = 1
  for (let b = 0; b * bucket < secs; b++) {
    let t = 0
    for (let k = b * bucket; k < Math.min(secs, (b + 1) * bucket); k++) t += h.bins[0][k]! + h.bins[1][k]! + h.bins[2][k]!
    max = Math.max(max, t)
  }
  return { firstBin: 0, bins: fit, bucket, max }
}

function binTotals(ctl: Controller, l: Layout, b: number): [number, number, number] {
  const h = ctl.hist
  const out: [number, number, number] = [0, 0, 0]
  const from = l.firstBin + b * l.bucket
  for (let k = Math.max(0, from); k < Math.min(h.seconds, from + l.bucket); k++) {
    out[0] += h.bins[0][k]!
    out[1] += h.bins[1][k]!
    out[2] += h.bins[2][k]!
  }
  return out
}

const BG = [0x13, 0x14, 0x17]
const COLORS = [
  [0x5d, 0x66, 0x75],
  [0xe8, 0xa9, 0x3b],
  [0xf0, 0x56, 0x4f],
]

function paint(ctl: Controller, l: Layout, width: number): Buffer {
  const w = width * SCALE
  const h = H * SCALE
  const px = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = BG[2]!
    px[i * 4 + 1] = BG[1]!
    px[i * 4 + 2] = BG[0]!
    px[i * 4 + 3] = 255
  }
  const BAR = barPx(width)
  const barW = BAR * SCALE - SCALE * 2
  const offset = 0
  for (let b = 0; b < l.bins; b++) {
    const t = binTotals(ctl, l, b)
    let y = h
    const x0 = offset + b * BAR * SCALE
    for (let g = 0; g < 3; g++) {
      const bh = Math.round((t[g]! / l.max) * (h - 4))
      const col = COLORS[g]!
      for (let yy = Math.max(0, y - bh); yy < y; yy++) {
        for (let xx = x0; xx < x0 + barW; xx++) {
          if (xx < 0 || xx >= w) continue
          const o = (yy * w + xx) * 4
          px[o] = col[2]!
          px[o + 1] = col[1]!
          px[o + 2] = col[0]!
        }
      }
      y -= bh
    }
  }
  return px
}

const clock = (sec: number) => new Date(sec * 1000).toISOString().slice(11, 19)

/** Per-second ingest histogram painted with `setImagePixels`. Click a bar to jump. */
export const Histogram = memo(function Histogram({
  ctl,
  tick,
  visible,
  onJumpSecond,
}: {
  ctl: Controller
  tick: number
  visible: [number, number] | null
  onJumpSecond: (sec: number) => void
}) {
  const img = useRef<ImgInstance>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ x: number; sec: number; t: [number, number, number] } | null>(null)
  const [box, setBox] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const layout = width > 0 ? computeLayout(ctl, width) : null

  useLayoutEffect(() => {
    if (!layout || width <= 0) return
    img.current?.setImagePixels(width * SCALE, H * SCALE, paint(ctl, layout, width), { format: 'bgra' })
  }, [tick, width])

  const BAR = barPx(Math.max(1, width))
  const offset = 0
  const secAtX = (x: number) => {
    if (!layout) return -1
    const b = Math.floor((x - offset) / BAR)
    if (b < 0 || b >= layout.bins) return -1
    const k = layout.firstBin + b * layout.bucket
    if (k < 0 || k >= ctl.hist.seconds) return -1
    return ctl.hist.firstSec + k
  }
  const xOfSec = (sec: number) => (layout ? offset + ((sec - ctl.hist.firstSec - layout.firstBin) / layout.bucket) * BAR : 0)

  let marker: { left: number; width: number } | null = null
  if (layout && visible && ctl.store.count > 0) {
    const a = Math.max(0, xOfSec(visible[0]))
    const b = Math.min(width, xOfSec(visible[1]) + BAR)
    if (b > 0 && a < width) marker = { left: a, width: Math.max(3, b - a) }
  }
  const peak = layout ? layout.max / layout.bucket : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 20, paddingRight: 20, paddingTop: 4, paddingBottom: 10, gap: 6, backgroundColor: C.panel, borderBottomWidth: 1, borderColor: C.border, userSelect: 'none' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <text style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>{layout && layout.bucket > 1 ? `LINES PER SECOND · ${layout.bucket}s BUCKETS` : 'LINES PER SECOND'}</text>
        <Legend color="#5d6675" label="info / debug" />
        <Legend color="#e8a93b" label="warn" />
        <Legend color="#f0564f" label="error" />
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 11, color: C.textMuted, fontFamily: MONO }}>
          {hover ? `${clock(hover.sec)}  ${fmt(hover.t[0] + hover.t[1] + hover.t[2])} lines  ${fmt(hover.t[2])} errors` : `peak ${fmtCompact(peak)}/s · click to jump`}
        </text>
      </div>
      <div
        testId="histogram"
        onLayout={(e: EventPayload) => {
          setWidth(Math.round(e.width ?? 0))
          setBox({ x: e.x ?? 0, y: e.y ?? 0 })
        }}
        onMouseMove={(e: EventPayload) => {
          const sec = secAtX((e.x ?? 0) - box.x)
          if (sec < 0 || !layout) return setHover(null)
          const b = Math.floor(((e.x ?? 0) - box.x - offset) / BAR)
          setHover({ x: (e.x ?? 0) - box.x, sec, t: binTotals(ctl, layout, b) })
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e: EventPayload) => {
          const sec = secAtX((e.x ?? 0) - box.x)
          if (sec >= 0) onJumpSecond(sec)
        }}
        style={{ position: 'relative', height: H, cursor: 'pointer', borderRadius: 6, overflow: 'hidden' }}
      >
        <img ref={img} objectFit="fill" style={{ width: '100%', height: H }} />
        {marker && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: marker.left, width: marker.width, backgroundColor: '#3d8bfd26', borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#3d8bfd99', pointerEvents: 'none' }} />
        )}
        {hover && <div style={{ position: 'absolute', top: 0, bottom: 0, left: hover.x, width: 1, backgroundColor: '#ffffff55', pointerEvents: 'none' }} />}
      </div>
    </div>
  )
})

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      <text style={{ fontSize: 11, color: C.textMuted }}>{label}</text>
    </div>
  )
}
