import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { ImgInstance } from '@gpuix/react'
import { STATE_LABEL, type StateId } from './lib/beats'
import { mixColor, withAlpha } from './lib/color'
import { CURSOR_SVG, icon } from './icons'
import { CHART, CHART_DATA, CHART_HOVER_INDEX, CHART_LABELS, PALETTE_INPUT_H, PALETTE_ITEMS, PALETTE_PAD, PALETTE_ROW_H, SCRUB, TAB_W, VOLUME, chartPoint, type Box } from './lib/layout'
import type { Palette } from './lib/palette'
import { arc, playPause, rasterize, trim, type Prim, type V } from './lib/raster'
import { clamp, lerp } from './lib/spring'
import type { Layer, Params, Scene } from './scene'

export const FONT = 'Geist'

/** Maps scene units of one content layer to pixels inside the shape. */
interface Frame { u: number; ox: number; oy: number; pal: Palette; p: Params; box: Box; op: number }

const abs = (f: Frame, x: number, y: number, w: number, h: number) => ({
  position: 'absolute' as const, left: f.ox + x * f.u, top: f.oy + y * f.u, width: Math.max(0, w * f.u), height: Math.max(0, h * f.u),
})

function T({ f, x, y, w, h, size, color, weight = 400, align = 'left', children }: { f: Frame; x: number; y: number; w: number; h: number; size: number; color: string; weight?: number; align?: 'left' | 'center' | 'right'; children: ReactNode }) {
  return (
    <div style={{ ...abs(f, x, y, w, h), display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', pointerEvents: 'none' }}>
      <text style={{ color, fontSize: size * f.u, fontWeight: weight, fontFamily: FONT, whiteSpace: 'nowrap', lineHeight: 1.2 * size * f.u }}>{children}</text>
    </div>
  )
}

function Rect({ f, x, y, w, h, r, fill, border }: { f: Frame; x: number; y: number; w: number; h: number; r: number; fill: string; border?: string }) {
  return <div style={{ ...abs(f, x, y, w, h), borderRadius: r * f.u, backgroundColor: fill, ...(border ? { borderWidth: Math.max(1, f.u), borderColor: border } : {}), pointerEvents: 'none' }} />
}

function Icon({ f, name, x, y, size, color, fill = false }: { f: Frame; name: string; x: number; y: number; size: number; color: string; fill?: boolean }) {
  return <svg source={icon(name, color, fill)} style={{ ...abs(f, x - size / 2, y - size / 2, size, size), color, pointerEvents: 'none' }} />
}

/** CPU-rasterized vector strokes, clipped to the shape's rounded rect (an <img> ignores parent overflow clipping). */
function Raster({ wPx, hPx, rPx, prims }: { wPx: number; hPx: number; rPx: number; prims: Prim[] }) {
  const ref = useRef<ImgInstance>(null)
  const w = Math.max(1, Math.round(wPx)), h = Math.max(1, Math.round(hPx))
  useLayoutEffect(() => {
    const px = rasterize(w, h, prims)
    const r = Math.min(rPx, w / 2, h / 2)
    for (let y = 0; y < h; y++) {
      const cy = y + 0.5
      const dy = cy < r ? r - cy : cy > h - r ? cy - (h - r) : 0
      if (dy === 0) continue
      for (let x = 0; x < w; x++) {
        const cx = x + 0.5
        const dx = cx < r ? r - cx : cx > w - r ? cx - (w - r) : 0
        if (dx === 0) continue
        const c = clamp(r + 0.5 - Math.hypot(dx, dy))
        const k = (y * w + x) * 4 + 3
        px[k] = Math.round(px[k]! * c)
      }
    }
    ref.current?.setImagePixels(w, h, px)
  })
  return <img ref={ref} objectFit="fill" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, pointerEvents: 'none' }} />
}

// --- content per state ----------------------------------------------------------------------------------------------
type Content = (f: Frame) => { nodes: ReactNode; prims?: Prim[] }

const pt = (f: Frame, x: number, y: number): V => [f.ox + x * f.u, f.oy + y * f.u]

const contents: Record<StateId, Content> = {
  button: (f) => ({
    nodes: (
      <>
        <T f={f} x={0} y={0} w={f.box.w - 34} h={f.box.h} size={28} weight={600} color={f.pal.onSolid} align="center">Get started</T>
        <Icon f={f} name="arrow" x={f.box.w - 66} y={f.box.h / 2} size={24} color={f.pal.onSolid} />
      </>
    ),
  }),
  loader: (f) => {
    const a0 = f.p.loaderRot, sweep = Math.min(0.999, f.p.loaderSweep) * Math.PI * 2
    return { nodes: null, prims: [
      { kind: 'stroke', pts: arc(56, 56, 26, 0, Math.PI * 2, 64).map(([x, y]) => pt(f, x, y)), width: 6 * f.u, color: f.pal.onSolid, alpha: 0.18 },
      { kind: 'stroke', pts: arc(56, 56, 26, a0, a0 + sweep, 64).map(([x, y]) => pt(f, x, y)), width: 6 * f.u, color: f.pal.onSolid },
    ] }
  },
  check: (f) => ({ nodes: null, prims: [
    { kind: 'stroke', pts: trim([[35, 58], [50, 72], [78, 42]], f.p.checkDraw).map(([x, y]) => pt(f, x, y)), width: 7 * f.u, color: f.pal.onAccent },
  ] }),
  island: (f) => ({
    nodes: (
      <>
        <Rect f={f} x={16} y={16} w={52} h={52} r={14} fill={f.pal.accent} />
        <Icon f={f} name="sparkle" x={42} y={42} size={22} color={f.pal.onAccent} />
        <T f={f} x={84} y={14} w={220} h={24} size={15} color={withAlpha(f.pal.onSolid, 0.6)}>Now playing</T>
        <T f={f} x={84} y={38} w={220} h={30} size={21} weight={600} color={f.pal.onSolid}>Afterglow</T>
        {f.p.bars.map((b, i) => {
          const hh = 8 + 34 * clamp(b)
          return <Rect key={i} f={f} x={332 + i * 15} y={42 - hh / 2} w={7} h={hh} r={3.5} fill={f.pal.accent} />
        })}
      </>
    ),
  }),
  player: (f) => {
    const art = 176 * (1 + f.p.artPulse), ao = (176 - art) / 2
    const ps = 1 - 0.08 * f.p.playPress
    return {
      nodes: (
        <>
          <Rect f={f} x={28 + ao} y={28 + ao} w={art} h={art} r={26} fill={f.pal.accent} />
          <Rect f={f} x={28 + 88 - 30} y={28 + 88 - 30} w={60} h={60} r={30} fill={withAlpha('#000000', 0.22)} />
          <Rect f={f} x={28 + 88 - 9} y={28 + 88 - 9} w={18} h={18} r={9} fill={f.pal.accent} />
          <T f={f} x={232} y={34} w={320} h={40} size={30} weight={600} color={f.pal.onCard}>Afterglow</T>
          <T f={f} x={232} y={74} w={320} h={28} size={19} color={f.pal.muted}>Juniper Lane</T>
          <Icon f={f} name="prev" x={272} y={150} size={26} color={f.pal.onCard} />
          <Icon f={f} name="next" x={400} y={150} size={26} color={f.pal.onCard} />
          <Rect f={f} x={336 - 30 * ps} y={150 - 30 * ps} w={60 * ps} h={60 * ps} r={30 * ps} fill={f.pal.solid} />
          <Rect f={f} x={232} y={198} w={320} h={6} r={3} fill={f.pal.track} />
          <Rect f={f} x={232} y={198} w={320 * clamp(f.p.progress)} h={6} r={3} fill={f.pal.accent} />
        </>
      ),
      prims: playPause(336, 150, 20 * ps, f.p.playMorph).map((q) => ({ kind: 'fill' as const, pts: q.map(([x, y]) => pt(f, x + 2 * (1 - f.p.playMorph), y)), color: f.pal.onSolid })),
    }
  },
  scrubber: (f) => {
    const kx = lerp(SCRUB.x0, SCRUB.x1, f.p.scrub), kr = 13 + 3 * f.p.scrubPress
    const secs = Math.round(f.p.scrub * 228)
    return {
      nodes: (
        <>
          <Rect f={f} x={SCRUB.x0} y={48} w={SCRUB.x1 - SCRUB.x0} h={8} r={4} fill={f.pal.track} />
          <Rect f={f} x={SCRUB.x0} y={48} w={kx - SCRUB.x0} h={8} r={4} fill={f.pal.accent} />
          <Rect f={f} x={kx - kr} y={52 - kr} w={kr * 2} h={kr * 2} r={kr} fill={f.pal.solid} />
          <T f={f} x={506} y={30} w={80} h={44} size={22} weight={600} color={f.pal.onCard} align="left">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</T>
        </>
      ),
      prims: playPause(56, 52, 18, 1).map((q) => ({ kind: 'fill' as const, pts: q.map(([x, y]) => pt(f, x, y)), color: f.pal.onCard })),
    }
  },
  volume: (f) => {
    const s = f.p.stretch, x1 = VOLUME.x1 + s, kx = f.p.volume >= 1 ? x1 : lerp(VOLUME.x0, VOLUME.x1, f.p.volume)
    const kr = 13 + 3 * f.p.volumePress, cy = f.box.h / 2
    return {
      nodes: (
        <>
          <Icon f={f} name="speaker" x={46} y={cy} size={28} color={f.pal.onCard} />
          <Rect f={f} x={VOLUME.x0} y={cy - 4} w={x1 - VOLUME.x0} h={8} r={4} fill={f.pal.track} />
          <Rect f={f} x={VOLUME.x0} y={cy - 4} w={kx - VOLUME.x0} h={8} r={4} fill={f.pal.accent} />
          <Rect f={f} x={kx - kr} y={cy - kr} w={kr * 2} h={kr * 2} r={kr} fill={f.pal.solid} />
          <T f={f} x={458 + s} y={cy - 22} w={60} h={44} size={20} weight={600} color={f.pal.onCard}>{`${Math.round(f.p.volume * 100)}%`}</T>
        </>
      ),
    }
  },
  toggle: (f) => {
    const t = f.p.toggle, liquid = 18 * Math.sin(Math.PI * clamp(t))
    const kx = lerp(12, 92, clamp(t)) - (t > 0.5 ? liquid : 0)
    return { nodes: <Rect f={f} x={kx} y={12} w={80 + liquid} h={80} r={40} fill="#ffffff" /> }
  },
  tabs: (f) => {
    const names = [['home', 'Home'], ['search', 'Search'], ['library', 'Library'], ['profile', 'Profile']] as const
    const ps = f.p.tabPress * 4
    return {
      nodes: (
        <>
          <Rect f={f} x={f.p.tabL + ps / 2} y={10 + ps / 2} w={f.p.tabR - f.p.tabL - ps} h={84 - ps} r={(84 - ps) / 2} fill={f.pal.accent} />
          {names.map(([ic, label], i) => {
            const cx = i * TAB_W + TAB_W / 2
            const on = clamp(1 - Math.abs((f.p.tabL + f.p.tabR) / 2 - cx) / TAB_W)
            const c = mixColor(withAlpha(f.pal.onSolid, 0.62), f.pal.onAccent, on)
            return (
              <div key={ic}>
                <Icon f={f} name={ic} x={cx - 30} y={52} size={24} color={mixColor(f.pal.onSolid, '#ffffff', on)} />
                <T f={f} x={cx - 14} y={32} w={70} h={40} size={18} weight={600} color={c}>{label}</T>
              </div>
            )
          })}
        </>
      ),
    }
  },
  chart: (f) => {
    const pts: V[] = []
    for (let i = 0; i < CHART_DATA.length - 1; i++) {
      const a = chartPoint(Math.max(0, i - 1)), b = chartPoint(i), c = chartPoint(i + 1), d = chartPoint(Math.min(CHART_DATA.length - 1, i + 2))
      for (let k = 0; k < 12; k++) {
        const t = k / 12, t2 = t * t, t3 = t2 * t
        const cr = (p0: number, p1: number, p2: number, p3: number) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
        pts.push([cr(a[0], b[0], c[0], d[0]), cr(a[1], b[1], c[1], d[1])])
      }
    }
    pts.push(chartPoint(CHART_DATA.length - 1))
    const [hx, hy] = chartPoint(CHART_HOVER_INDEX)
    const tt = clamp(f.p.tooltip)
    const prims: Prim[] = [{ kind: 'stroke', pts: trim(pts, f.p.chartDraw).map(([x, y]) => pt(f, x, y)), width: 3 * f.u, color: f.pal.accent }]
    if (tt > 0) prims.push({ kind: 'dot', c: pt(f, hx, hy), r: 6 * f.u * tt, color: f.pal.accent, ring: { width: 3 * f.u, color: f.pal.card }, alpha: tt })
    return {
      nodes: (
        <>
          <T f={f} x={36} y={26} w={300} h={26} size={17} color={f.pal.muted}>Revenue</T>
          <T f={f} x={36} y={52} w={300} h={52} size={40} weight={600} color={f.pal.onCard}>$84.2k</T>
          <T f={f} x={420} y={58} w={184} h={40} size={18} weight={600} color={f.pal.accent} align="right">+12.4%</T>
          {[0, 0.5, 1].map((g) => <Rect key={g} f={f} x={CHART.x0} y={lerp(CHART.y1, CHART.y0, g)} w={CHART.x1 - CHART.x0} h={1} r={0} fill={f.pal.track} />)}
          {CHART_LABELS.map((m, i) => <T key={m} f={f} x={chartPoint(i)[0] - 30} y={CHART.y1 + 8} w={60} h={24} size={13} color={i === CHART_HOVER_INDEX && tt > 0.5 ? f.pal.onCard : f.pal.muted} align="center">{m}</T>)}
          {tt > 0.01 ? (
            <div style={{ ...abs(f, hx - 62, hy - 78 + 8 * (1 - tt), 124, 56), borderRadius: 14 * f.u, backgroundColor: f.pal.solid, opacity: tt, pointerEvents: 'none' }}>
              <T f={{ ...f, ox: 0, oy: 0 }} x={0} y={6} w={124} h={20} size={13} color={withAlpha(f.pal.onSolid, 0.62)} align="center">Aug 2026</T>
              <T f={{ ...f, ox: 0, oy: 0 }} x={0} y={24} w={124} h={26} size={19} weight={600} color={f.pal.onSolid} align="center">$70.1k</T>
            </div>
          ) : null}
        </>
      ),
      prims,
    }
  },
  palette: (f) => {
    const q = f.p.query
    let y = PALETTE_INPUT_H + PALETTE_PAD
    let first = true
    const rows: ReactNode[] = []
    PALETTE_ITEMS.forEach((it, i) => {
      const pr = f.p.rows[i]!
      if (pr > 0.01) {
        const hi = first
        first = false
        const hover = hi ? f.p.rowHover : 0
        const ps = hi ? f.p.rowPress * 6 : 0
        const bg = hi ? mixColor(f.pal.track, f.pal.accent, hover) : '#00000000'
        const fg = mixColor(f.pal.onCard, f.pal.onAccent, hover)
        const m = q ? it.label.toLowerCase().indexOf(q) : -1
        const parts = m >= 0 ? [it.label.slice(0, m), it.label.slice(m, m + q.length), it.label.slice(m + q.length)] : [it.label, '', '']
        const rf = { ...f, op: pr }
        rows.push(
          <div key={it.label} style={{ ...abs(f, PALETTE_PAD + ps / 2, y + 4 + ps / 4, f.box.w - PALETTE_PAD * 2 - ps, PALETTE_ROW_H - 8 - ps / 2), borderRadius: 12 * f.u, backgroundColor: bg, opacity: pr, pointerEvents: 'none' }}>
            <Icon f={{ ...rf, ox: 0, oy: 0 }} name={it.icon} x={30} y={(PALETTE_ROW_H - 8) / 2} size={22} color={fg} />
            <div style={{ position: 'absolute', left: 58 * f.u, top: 0, height: (PALETTE_ROW_H - 8) * f.u, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
              {parts.map((s, k) => s ? <text key={k} style={{ color: k === 1 && hover < 0.5 ? f.pal.accent : fg, fontSize: 19 * f.u, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap' }}>{s}</text> : null)}
            </div>
            {it.hint ? <T f={{ ...rf, ox: 0, oy: 0 }} x={f.box.w - PALETTE_PAD * 2 - 90} y={0} w={70} h={PALETTE_ROW_H - 8} size={15} color={hi ? withAlpha(fg, 0.7) : f.pal.muted} align="right">{it.hint}</T> : null}
          </div>,
        )
      }
      y += pr * PALETTE_ROW_H
    })
    return {
      nodes: (
        <>
          <Icon f={f} name="search" x={36} y={PALETTE_INPUT_H / 2} size={24} color={f.pal.muted} />
          {q ? (
            <T f={f} x={64} y={18} w={420} h={40} size={24} weight={500} color={f.pal.onCard}>{q}</T>
          ) : (
            <T f={f} x={64} y={18} w={420} h={40} size={24} color={f.pal.muted}>Type a command</T>
          )}
          {f.p.caret ? <Rect f={f} x={64 + (q ? q.length * 13.2 + 2 : 0)} y={24} w={2} h={28} r={1} fill={f.pal.accent} /> : null}
          <Rect f={f} x={f.box.w - 76} y={24} w={48} h={28} r={7} fill={f.pal.track} />
          <T f={f} x={f.box.w - 76} y={24} w={48} h={28} size={13} weight={500} color={f.pal.muted} align="center">esc</T>
          <Rect f={f} x={0} y={PALETTE_INPUT_H} w={f.box.w} h={1} r={0} fill={f.pal.cardBorder} />
          {rows}
        </>
      ),
    }
  },
}

/** The one shape, its content layers, and the cursor, drawn into a `size`-px square-ish artboard (scene = 1080 wide). */
export function Stage({ scene, pal, width, height, radius = 0 }: { scene: Scene; pal: Palette; width: number; height: number; radius?: number }) {
  const K = width / 1080
  const s = K * scene.camera
  const u = s * scene.box.scale
  const bw = scene.box.w * u, bh = scene.box.h * u
  const cx = width / 2, cy = height / 2
  const prims: Prim[] = []
  const layers = scene.layers.map((L: Layer, i) => {
    const lu = u * L.scale
    const f: Frame = { u: lu, ox: (bw - L.box.w * lu) / 2, oy: (bh - L.box.h * lu) / 2 + L.offsetY * u, pal, p: scene.p, box: L.box, op: L.opacity }
    const c = contents[L.state](f)
    if (c.prims) for (const p of c.prims) prims.push({ ...p, alpha: (p.alpha ?? 1) * L.opacity })
    return c.nodes ? (
      <div key={`${L.state}-${L.start}-${i}`} testId={`layer-${L.state}`} style={{ position: 'absolute', left: 0, top: 0, width: bw, height: bh, opacity: L.opacity, pointerEvents: 'none' }}>{c.nodes}</div>
    ) : null
  })
  const cur = scene.cursor
  const cs = 30 * K * (1 - 0.1 * cur.press)
  const curX = cx + cur.x * s, curY = cy + cur.y * s
  return (
    <div testId="stage" style={{ position: 'relative', width, height, borderRadius: radius, backgroundColor: pal.canvas, overflow: 'hidden', pointerEvents: 'none' }}>
      <div testId="shape" style={{ position: 'absolute', left: cx - bw / 2, top: cy - bh / 2, width: bw, height: bh, borderRadius: Math.min(scene.box.r * u, bw / 2, bh / 2), backgroundColor: scene.box.fill, borderWidth: Math.max(1, u), borderColor: scene.box.border, overflow: 'hidden', pointerEvents: 'none' }}>
        {layers}
        {prims.length ? <Raster wPx={bw} hPx={bh} rPx={scene.box.r * u} prims={prims} /> : null}
      </div>
      <svg source={CURSOR_SVG('edge')} style={{ position: 'absolute', left: curX - 6 * (cs / 28), top: curY - 3.5 * (cs / 28), width: cs, height: cs, color: pal.cursorEdge, pointerEvents: 'none' }} />
      <svg source={CURSOR_SVG('fill')} style={{ position: 'absolute', left: curX - 6 * (cs / 28), top: curY - 3.5 * (cs / 28), width: cs, height: cs, color: pal.cursor, pointerEvents: 'none' }} />
    </div>
  )
}

export const stateLabel = (s: StateId) => STATE_LABEL[s]
