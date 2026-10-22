import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useWindowSize, type EventPayload, type ImgInstance } from '@gpuix/react'
import { ADJUST_LABELS, curveLut, type Adjust, type AdjustKind } from '../core/adjust'
import { BLEND_LABELS, BLEND_MODES } from '../core/blend'
import type { Editor, Tool } from '../core/editor'
import { FILTER_LABELS, type FilterKind } from '../core/filters'
import type { Layer } from '../core/doc'
import { ICONS } from './icons'
import { handleKey, normKey, type KeyActions, type KeyLike } from './keys'
import { computeLayout } from './layout'
import { hex, rgb, SWATCHES, T } from './theme'
import { Viewport, type Preview } from './viewport'

type Ev = EventPayload

export interface AppProps {
  ed: Editor
  /** Fixed size for tests; live terminal size otherwise. */
  size?: { width: number; height: number }
  actions: Omit<KeyActions, 'fit' | 'zoom' | 'toggleHelp'>
  fileLabel: string
  notice?: string
}

const TOOLS: { id: Tool; icon: keyof typeof ICONS; key: string; label: string }[] = [
  { id: 'move', icon: 'move', key: 'V', label: 'Move' },
  { id: 'marquee', icon: 'marquee', key: 'M', label: 'Rectangle' },
  { id: 'ellipse', icon: 'ellipse', key: 'O', label: 'Ellipse' },
  { id: 'lasso', icon: 'lasso', key: 'L', label: 'Lasso' },
  { id: 'wand', icon: 'wand', key: 'W', label: 'Magic Wand' },
  { id: 'brush', icon: 'brush', key: 'B', label: 'Brush' },
  { id: 'eraser', icon: 'eraser', key: 'E', label: 'Eraser' },
  { id: 'fill', icon: 'fill', key: 'K', label: 'Fill' },
  { id: 'gradient', icon: 'gradient', key: 'G', label: 'Gradient' },
  { id: 'eyedropper', icon: 'eyedropper', key: 'I', label: 'Eyedropper' },
  { id: 'hand', icon: 'hand', key: 'H', label: 'Hand' },
]

const ADJ_KINDS: AdjustKind[] = ['curves', 'hue-sat', 'brightness-contrast', 'exposure', 'vibrance', 'black-white', 'invert', 'threshold']
const FILTERS: FilterKind[] = ['gaussian', 'unsharp', 'motion', 'noise', 'high-pass', 'median']
const SHORT_ADJ: Record<AdjustKind, string> = { curves: 'Curves', 'hue-sat': 'Hue/Sat', 'brightness-contrast': 'Brightness', exposure: 'Exposure', vibrance: 'Vibrance', 'black-white': 'Grayscale', invert: 'Invert', threshold: 'Threshold' }
const SHORT_FILTER: Record<FilterKind, string> = { gaussian: 'Blur', unsharp: 'Sharpen', motion: 'Motion Blur', noise: 'Noise', 'high-pass': 'High Pass', median: 'Median' }

const Icon = ({ name, color = T.dim, size = 16 }: { name: keyof typeof ICONS; color?: string; size?: number }) => <svg source={ICONS[name]} style={{ width: size, height: size, color }} />

const Label = ({ children, color = T.dim, size = 12, weight = 500, clip }: { children: ReactNode; color?: string; size?: number; weight?: number; clip?: boolean }) => (
  <text style={{ color, fontSize: size, fontWeight: weight, ...(clip ? { whiteSpace: 'nowrap', textOverflow: 'ellipsis' } : null) }}>{children}</text>
)

function IconButton({ name, onClick, active, testId, disabled }: { name: keyof typeof ICONS; onClick: () => void; active?: boolean; testId?: string; disabled?: boolean }) {
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: active ? T.hover : undefined, cursor: disabled ? 'default' : 'pointer', hover: disabled ? undefined : { backgroundColor: T.hover } }}
    >
      <Icon name={name} color={disabled ? T.lineHi : active ? T.fg : T.dim} size={15} />
    </div>
  )
}

function Chip({ label, onClick, testId, active, width }: { label: string; onClick: () => void; testId?: string; active?: boolean; width?: number }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{ width, paddingLeft: width ? 0 : 10, paddingRight: width ? 0 : 10, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: active ? T.hover : T.raised, cursor: 'pointer', hover: { backgroundColor: T.hover } }}
    >
      <Label color={T.fg} size={11.5} clip>{label}</Label>
    </div>
  )
}

/** Horizontal slider. Listening for both mouseDown and mouseMove captures the pointer, so drags keep tracking. */
function Slider({ label, value, min, max, step = 1, format, onChange, testId, width }: { label: string; value: number; min: number; max: number; step?: number; format?: (v: number) => string; onChange: (v: number) => void; testId?: string; width?: number }) {
  const box = useRef({ x: 0, w: 1 })
  const drag = useRef(false)
  const set = (x?: number) => {
    if (x == null) return
    const t = Math.min(1, Math.max(0, (x - box.current.x) / box.current.w))
    const v = Math.round((min + t * (max - min)) / step) * step
    onChange(Math.min(max, Math.max(min, v)))
  }
  const t = (value - min) / (max - min || 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width, flexGrow: width ? 0 : 1 }}>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Label size={11} color={T.dim}>{label}</Label>
        <Label size={11} color={T.fg}>{format ? format(value) : String(value)}</Label>
      </div>
      <div style={{ position: 'relative', height: 14, display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', width: '100%', height: 12 }}>
          <div style={{ flexGrow: Math.max(0.0001, t), flexBasis: 0, height: 3, borderTopLeftRadius: 2, borderBottomLeftRadius: 2, backgroundColor: T.dim }} />
          <div style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: T.fg, flexShrink: 0 }} />
          <div style={{ flexGrow: Math.max(0.0001, 1 - t), flexBasis: 0, height: 3, borderTopRightRadius: 2, borderBottomRightRadius: 2, backgroundColor: T.line }} />
        </div>
        {/* Childless hit layer on top: in GPUIX 0.11 a div whose children paint over it stops getting mouse events. */}
        <div
          testId={testId}
          onLayout={(e) => (box.current = { x: e.x ?? 0, w: Math.max(1, e.width ?? 1) })}
          onMouseDown={(e) => {
            drag.current = true
            set(e.x)
          }}
          onMouseMove={(e) => {
            if (drag.current && e.pressedButton != null) set(e.x)
          }}
          onMouseUp={() => (drag.current = false)}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, cursor: 'pointer' }}
        />
      </div>
    </div>
  )
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 10, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderColor: T.line }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 22 }}>
        <Label size={12} color={T.fg} weight={600}>{title}</Label>
        {right ?? null}
      </div>
      {children}
    </div>
  )
}

/** Point-sampled layer thumbnail (pixels or mask) on a checkerboard. */
function Thumb({ ed, layer, mask, w, h, active, onClick, version }: { ed: Editor; layer: Layer; mask?: boolean; w: number; h: number; active?: boolean; onClick?: () => void; version: number }) {
  const img = useRef<ImgInstance>(null)
  useLayoutEffect(() => {
    const { width: W, height: H } = ed.doc
    const s = Math.min(w / W, h / H)
    const bw = Math.max(1, Math.round(W * s))
    const bh = Math.max(1, Math.round(H * s))
    const out = new Uint8Array(bw * bh * 4)
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const p = Math.min(H - 1, Math.floor((y + 0.5) / s)) * W + Math.min(W - 1, Math.floor((x + 0.5) / s))
        const o = (y * bw + x) * 4
        const ck = ((x >> 2) + (y >> 2)) & 1 ? 70 : 50
        if (mask || layer.kind === 'adjust') {
          const v = mask ? layer.mask![p]! : 0
          if (layer.kind === 'adjust' && !mask) {
            // Adjustment layers show a split light/dark glyph.
            out[o] = out[o + 1] = out[o + 2] = x < bw / 2 ? 230 : 40
          } else out[o] = out[o + 1] = out[o + 2] = v
          out[o + 3] = 255
          continue
        }
        const a = layer.pixels[p * 4 + 3]! / 255
        out[o] = layer.pixels[p * 4]! * a + ck * (1 - a)
        out[o + 1] = layer.pixels[p * 4 + 1]! * a + ck * (1 - a)
        out[o + 2] = layer.pixels[p * 4 + 2]! * a + ck * (1 - a)
        out[o + 3] = 255
      }
    img.current?.setImagePixels(bw, bh, out)
  }, [version, layer, mask, w, h])
  return (
    <div onClick={onClick} style={{ width: w + 4, height: h + 4, padding: 1, borderRadius: 4, borderWidth: 1, borderColor: active ? T.dim : T.line, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: T.bg }}>
      <img ref={img} objectFit="contain" style={{ width: w, height: h, borderRadius: 2 }} />
    </div>
  )
}

function LayerRow({ ed, L, i, version }: { ed: Editor; L: Layer; i: number; version: number }) {
  const active = ed.active === i
  return (
    <div
      testId={`layer-${i}`}
      onClick={() => ed.select(i)}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 6, paddingRight: 8, borderRadius: 7, backgroundColor: active ? T.raised : undefined, cursor: 'pointer', hover: active ? undefined : { backgroundColor: T.raised } }}
    >
      <div testId={`eye-${i}`} onClick={() => ed.toggleVisible(i)} style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={L.visible ? 'eye' : 'eyeOff'} color={L.visible ? T.faint : T.lineHi} size={14} />
      </div>
      <Thumb ed={ed} layer={L} w={38} h={26} version={version} active={active && !ed.editMask} onClick={() => {
        ed.editMask = false
        ed.select(i)
      }} />
      {L.mask ? (
        <Thumb
          ed={ed}
          layer={L}
          mask
          w={26}
          h={26}
          version={version}
          active={active && ed.editMask}
          onClick={() => {
            ed.select(i)
            ed.editMask = true
            ed.emit()
          }}
        />
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, overflow: 'hidden' }}>
        <Label color={L.visible ? T.fg : T.faint} size={12.5} weight={500} clip>{L.name}</Label>
        <Label color={T.faint} size={10.5} clip>{`${BLEND_LABELS[L.blend]} · ${Math.round(L.opacity * 100)}%${active && ed.editMask ? ' · mask' : ''}`}</Label>
      </div>
    </div>
  )
}

function CurveEditor({ ed, adjust, version, width }: { ed: Editor; adjust: Extract<Adjust, { kind: 'curves' }>; version: number; width: number }) {
  const W = width
  const H = 150
  const img = useRef<ImgInstance>(null)
  const box = useRef({ x: 0, y: 0, w: W, h: H })
  const dragIdx = useRef(-1)
  useLayoutEffect(() => {
    const out = new Uint8Array(W * H * 4)
    // Luminance histogram of the composite (strided sample).
    const hist = new Float32Array(64)
    const c = ed.comp
    const step = Math.max(1, Math.floor(c.length / 4 / 40000)) * 4
    for (let q = 0; q < c.length; q += step) hist[Math.min(63, ((0.3 * c[q]! + 0.59 * c[q + 1]! + 0.11 * c[q + 2]!) / 4) | 0)]!++
    const hmax = Math.max(...hist) || 1
    const lut = curveLut(adjust.points)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4
        let v: number[] = [13, 17, 23]
        const hb = hist[Math.min(63, Math.floor((x / W) * 64))]! / hmax
        if (H - y < hb * H * 0.85) v = [32, 38, 48]
        if (x % Math.round(W / 4) === 0 || y % Math.round(H / 4) === 0) v = [39, 43, 51]
        out[o] = v[0]!
        out[o + 1] = v[1]!
        out[o + 2] = v[2]!
        out[o + 3] = 255
      }
    const plot = (x: number, y: number, col: number[]) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return
      const o = (y * W + x) * 4
      out[o] = col[0]!
      out[o + 1] = col[1]!
      out[o + 2] = col[2]!
    }
    for (let i = 0; i < W; i++) plot(i, Math.round((1 - i / W) * (H - 1)), [61, 67, 77])
    let prev = -1
    for (let x = 0; x < W; x++) {
      const y = Math.round((1 - lut[Math.round((x / (W - 1)) * 255)]!) * (H - 1))
      const y0 = prev < 0 ? y : prev
      for (let yy = Math.min(y, y0); yy <= Math.max(y, y0); yy++) {
        plot(x, yy, [201, 209, 217])
        plot(x, yy + 1, [201, 209, 217])
      }
      prev = y
    }
    for (const [px, py] of adjust.points) {
      const cx = Math.round(px * (W - 1))
      const cy = Math.round((1 - py) * (H - 1))
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 16) plot(cx + dx, cy + dy, dx * dx + dy * dy <= 6 ? [240, 243, 246] : [10, 12, 16])
    }
    img.current?.setImagePixels(W, H, out)
  }, [version, adjust, width])
  const toCurve = (e: Ev) => ({ x: Math.min(1, Math.max(0, ((e.x ?? 0) - box.current.x) / box.current.w)), y: Math.min(1, Math.max(0, 1 - ((e.y ?? 0) - box.current.y) / box.current.h)) })
  return (
    <div
      testId="curve-editor"
      onLayout={(e) => (box.current = { x: e.x ?? 0, y: e.y ?? 0, w: e.width ?? W, h: e.height ?? H })}
      onMouseDown={(e) => {
        const p = toCurve(e)
        let best = -1
        let bd = 0.08
        adjust.points.forEach(([x, y], i) => {
          const d = Math.hypot(x - p.x, (y - p.y) * 0.65)
          if (d < bd) (bd = d), (best = i)
        })
        if (best < 0) {
          const pts = [...adjust.points, [p.x, p.y] as [number, number]].sort((a, b) => a[0] - b[0])
          best = pts.findIndex((q) => q[0] === p.x && q[1] === p.y)
          ed.setAdjust({ kind: 'curves', points: pts })
        }
        dragIdx.current = best
      }}
      onMouseMove={(e) => {
        const i = dragIdx.current
        if (i < 0 || e.pressedButton == null) return
        const cur = (ed.layer?.kind === 'adjust' && ed.layer.adjust.kind === 'curves' ? ed.layer.adjust : adjust).points
        const p = toCurve(e)
        const pts = cur.map((q) => [...q] as [number, number])
        const lo = i === 0 ? 0 : pts[i - 1]![0] + 0.02
        const hi = i === pts.length - 1 ? 1 : pts[i + 1]![0] - 0.02
        pts[i] = [i === 0 ? 0 : i === pts.length - 1 ? 1 : Math.min(hi, Math.max(lo, p.x)), p.y]
        ed.setAdjust({ kind: 'curves', points: pts })
      }}
      onMouseUp={() => (dragIdx.current = -1)}
      style={{ width: W, height: H, borderRadius: 6, borderWidth: 1, borderColor: T.line, cursor: 'crosshair' }}
    >
      <img ref={img} objectFit="fill" style={{ width: W - 2, height: H - 2, borderRadius: 5 }} />
    </div>
  )
}

function AdjustProps({ ed, version, width }: { ed: Editor; version: number; width: number }) {
  const L = ed.layer
  if (!L || L.kind !== 'adjust') return null
  const a = L.adjust
  const set = (patch: Partial<Adjust>) => ed.setAdjust({ ...a, ...patch } as Adjust)
  switch (a.kind) {
    case 'curves':
      return <CurveEditor ed={ed} adjust={a} version={version} width={width} />
    case 'hue-sat':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Slider label="Hue" value={a.hue} min={-180} max={180} format={(v) => `${v}°`} onChange={(v) => set({ hue: v })} />
          <Slider label="Saturation" value={a.saturation} min={-100} max={100} onChange={(v) => set({ saturation: v })} />
          <Slider label="Lightness" value={a.lightness} min={-100} max={100} onChange={(v) => set({ lightness: v })} />
        </div>
      )
    case 'brightness-contrast':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Slider label="Brightness" value={a.brightness} min={-100} max={100} onChange={(v) => set({ brightness: v })} />
          <Slider label="Contrast" value={a.contrast} min={-100} max={100} onChange={(v) => set({ contrast: v })} />
        </div>
      )
    case 'exposure':
      return <Slider label="Exposure" value={a.ev} min={-3} max={3} step={0.05} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`} onChange={(v) => set({ ev: v })} />
    case 'vibrance':
      return <Slider label="Vibrance" value={a.amount} min={-100} max={100} onChange={(v) => set({ amount: v })} />
    case 'threshold':
      return <Slider label="Level" value={Math.round(a.level * 255)} min={0} max={255} onChange={(v) => set({ level: v / 255 })} />
    default:
      return <Label size={11.5} color={T.faint}>No settings</Label>
  }
}

function Panel({ ed, L: layout, version, openBlend }: { ed: Editor; L: ReturnType<typeof computeLayout>; version: number; openBlend: (y: number, x: number) => void }) {
  const L = ed.layer
  const rows = ed.doc.layers.map((l, i) => ({ l, i })).reverse()
  const blendRow = useRef({ x: 0, y: 0, h: 0 })
  const h = ed.history
  const firstHist = Math.max(0, h.entries.length - 6)
  const cols = layout.panel >= 280 ? 3 : 2
  const cell = Math.floor((layout.panel - 34 - 6 * (cols - 1)) / cols)
  return (
    <div testId="panel" style={{ position: 'absolute', right: 0, top: layout.top, width: layout.panel, height: layout.h - layout.top - layout.status, backgroundColor: T.panel, borderLeftWidth: 1, borderColor: T.line, display: 'flex', flexDirection: 'column', overflowY: 'scroll' }}>
      <Section
        title="Layers"
        right={
          <div style={{ display: 'flex', flexDirection: 'row', gap: 0 }}>
            <IconButton testId="add-layer" name="plus" onClick={() => ed.addLayer()} />
            <IconButton testId="dup-layer" name="copy" onClick={() => ed.duplicateLayer()} />
            <IconButton testId="add-mask" name="mask" active={!!L?.mask && ed.editMask} onClick={() => ed.addMask()} />
            {layout.panel >= 280 ? <IconButton name="up" onClick={() => ed.reorder(1)} disabled={ed.active >= ed.doc.layers.length - 1} /> : null}
            {layout.panel >= 280 ? <IconButton name="down" onClick={() => ed.reorder(-1)} disabled={ed.active <= 0} /> : null}
            <IconButton testId="del-layer" name="trash" onClick={() => ed.deleteLayer()} disabled={ed.doc.layers.length <= 1} />
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {rows.slice(0, layout.h >= 820 ? 6 : 4).map(({ l, i }) => (
            <LayerRow key={l.id} ed={ed} L={l} i={i} version={version} />
          ))}
          {rows.length > (layout.h >= 820 ? 6 : 4) ? <Label size={10.5} color={T.faint}>{`+${rows.length - (layout.h >= 820 ? 6 : 4)} more (↑/↓)`}</Label> : null}
        </div>
        {L ? (
          <div style={{ display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: layout.panel >= 280 ? 120 : 98 }}>
              <Label size={11} color={T.dim}>Blend</Label>
              <div
                testId="blend-button"
                onLayout={(e) => (blendRow.current = { x: e.x ?? 0, y: e.y ?? 0, h: e.height ?? 26 })}
                onClick={() => openBlend(blendRow.current.y + blendRow.current.h + 4, blendRow.current.x)}
                style={{ height: 26, borderRadius: 6, backgroundColor: T.raised, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 9, paddingRight: 7, cursor: 'pointer', hover: { backgroundColor: T.hover } }}
              >
                <Label size={12} color={T.fg}>{BLEND_LABELS[L.blend]}</Label>
                <Icon name="chevron" size={13} color={T.faint} />
              </div>
            </div>
            <Slider testId="opacity-slider" label="Opacity" value={Math.round(L.opacity * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => ed.setOpacity(v / 100)} />
          </div>
        ) : null}
      </Section>
      {L?.kind === 'adjust' ? (
        <Section title={ADJUST_LABELS[L.adjust.kind]}>
          <AdjustProps ed={ed} version={version} width={layout.panel - 34} />
        </Section>
      ) : null}
      <Section title="Adjustments">
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {ADJ_KINDS.map((k) => (
            <Chip key={k} width={cell} testId={`adj-${k}`} label={SHORT_ADJ[k]} onClick={() => ed.addAdjustment(k)} />
          ))}
        </div>
      </Section>
      <Section title="Filters">
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {FILTERS.map((k) => (
            <Chip key={k} width={cell} testId={`filter-${k}`} label={SHORT_FILTER[k]} onClick={() => ed.applyFilter(k)} />
          ))}
        </div>
        <Slider label="Radius" value={ed.filterAmount.gaussian} min={1} max={40} format={(v) => `${v} px`} onChange={(v) => {
          for (const k of ['gaussian', 'unsharp', 'high-pass'] as FilterKind[]) ed.filterAmount[k] = v
          ed.filterAmount.motion = v * 3
          ed.emit()
        }} />
      </Section>
      {layout.showHistory ? (
        <Section title="History">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <HistRow label="Open" active={h.index === 0} faded={false} onClick={() => ed.jumpTo(0)} hidden={firstHist > 0} />
            {h.entries.slice(firstHist).map((c, k) => {
              const n = firstHist + k + 1
              return <HistRow key={n} label={c.label} active={h.index === n} faded={n > h.index} onClick={() => ed.jumpTo(n)} />
            })}
          </div>
        </Section>
      ) : null}
    </div>
  )
}

const HistRow = ({ label, active, faded, onClick, hidden }: { label: string; active: boolean; faded: boolean; onClick: () => void; hidden?: boolean }) =>
  hidden ? null : (
    <div onClick={onClick} style={{ height: 24, borderRadius: 6, paddingLeft: 8, display: 'flex', flexDirection: 'row', alignItems: 'center', backgroundColor: active ? T.raised : undefined, cursor: 'pointer', hover: active ? undefined : { backgroundColor: T.raised } }}>
      <Label size={11.5} color={faded ? T.faint : active ? T.fg : T.dim}>{label}</Label>
    </div>
  )

/** Keys are window-level (render({ onKeyDown })) so they keep working after clicks move GPUI focus off the root. */
const keyBus: { down: ((e: KeyLike) => void) | null; up: ((e: KeyLike) => void) | null } = { down: null, up: null }
export const keyHandlers = {
  onKeyDown: (e: KeyLike) => keyBus.down?.(e),
  onKeyUp: (e: KeyLike) => keyBus.up?.(e),
}

export function App({ ed, size: fixed, actions, fileLabel, notice }: AppProps) {
  const live = useWindowSize()
  const size = fixed ?? live
  const layout = computeLayout(size.width, size.height)
  const cv = layout.canvas
  const [version, setVersion] = useState(ed.version)
  const [blendMenu, setBlendMenu] = useState<{ x: number; y: number } | null>(null)
  const [swatches, setSwatches] = useState(false)
  const [help, setHelp] = useState(false)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const vp = useRef(new Viewport()).current
  const img = useRef<ImgInstance>(null)
  const gesture = useRef<{ kind: 'paint' | 'pan' | 'select' | 'move' | 'gradient' | 'eyedrop'; sx: number; sy: number; last: { x: number; y: number }; pts: { x: number; y: number }[]; op: 'replace' | 'add' | 'subtract' } | null>(null)
  const preview = useRef<Preview>(null)
  const ring = useRef<{ x: number; y: number; r: number } | null>(null)
  const phase = useRef(0)
  const drawTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const needFull = useRef(true)
  const lastSel = useRef(-1)
  const spaceDown = useRef(false)
  const stats = useRef({ frames: 0, ms: 0, last: 0 })
  const shownZoom = useRef(0)

  const present = () => {
    if (!img.current) return
    const out = vp.present(phase.current, preview.current, ring.current)
    img.current.setImagePixels(vp.w, vp.h, new Uint8Array(out.buffer, out.byteOffset, out.length))
  }

  const draw = () => {
    drawTimer.current = null
    const t0 = performance.now()
    if (vp.resize(cv.w, cv.h)) needFull.current = true
    if (vp.docW !== ed.doc.width || vp.docH !== ed.doc.height) {
      vp.setDoc(ed.doc.width, ed.doc.height)
      needFull.current = true
    }
    const dirty = ed.flush()
    if (needFull.current) {
      vp.render(ed.comp)
      vp.traceSelection(ed.selection)
      lastSel.current = ed.selVersion
      needFull.current = false
    } else {
      if (dirty) vp.render(ed.comp, vp.screenRect(dirty))
      if (lastSel.current !== ed.selVersion) {
        vp.traceSelection(ed.selection)
        lastSel.current = ed.selVersion
      }
    }
    present()
    const s = stats.current
    s.frames++
    s.ms = s.ms * 0.9 + (performance.now() - t0) * 0.1
    if (vp.zoom !== shownZoom.current) {
      shownZoom.current = vp.zoom
      setVersion((v) => v + 1)
    }
  }

  const schedule = (full = false) => {
    if (full) needFull.current = true
    if (!drawTimer.current) drawTimer.current = setTimeout(draw, 0)
  }

  useLayoutEffect(() => ed.subscribe(() => {
    setVersion(ed.version)
    schedule()
  }), [ed])
  useLayoutEffect(() => schedule(true), [cv.w, cv.h])
  useLayoutEffect(() => {
    // Marching ants.
    const id = setInterval(() => {
      if (!ed.selection && !preview.current) return
      phase.current = (phase.current + 1) % 8
      present()
    }, 120)
    return () => clearInterval(id)
  }, [ed])

  const act: KeyActions = {
    ...actions,
    fit: () => {
      vp.fit()
      schedule(true)
      setVersion((v) => v + 1)
    },
    zoom: (f) => {
      vp.zoomAt(vp.w / 2, vp.h / 2, f)
      schedule(true)
      setVersion((v) => v + 1)
    },
    toggleHelp: () => setHelp((h) => !h),
  }

  const local = (e: Ev) => ({ x: (e.x ?? 0) - cv.x, y: (e.y ?? 0) - cv.y })
  const mods = (e: Ev) => e.modifiers as { shift?: boolean; alt?: boolean; ctrl?: boolean } | undefined

  const updateRing = (s: { x: number; y: number } | null) => {
    ring.current = s && (ed.tool === 'brush' || ed.tool === 'eraser') ? { x: s.x, y: s.y, r: (ed.brush.size / 2) * vp.zoom } : null
  }

  const onDown = (e: Ev) => {
    const s = local(e)
    const d = vp.toDoc(s.x, s.y)
    const m = mods(e)
    const op = m?.shift ? 'add' : m?.alt ? 'subtract' : 'replace'
    const g = { sx: s.x, sy: s.y, last: s, pts: [d], op } as const
    setBlendMenu(null)
    setSwatches(false)
    if (e.button === 1 || e.button === 2 || ed.tool === 'hand' || spaceDown.current) {
      gesture.current = { kind: 'pan', ...g, pts: [] }
      return
    }
    switch (ed.tool) {
      case 'brush':
      case 'eraser':
        if (!ed.beginStroke(d.x, d.y)) {
          ed.emit(ed.layer?.kind === 'adjust' ? 'Select a pixel layer or its mask to paint' : 'Nothing to paint on')
          return
        }
        gesture.current = { kind: 'paint', ...g, pts: [] }
        schedule()
        return
      case 'marquee':
      case 'ellipse':
      case 'lasso':
        gesture.current = { kind: 'select', ...g, pts: [s] }
        return
      case 'wand':
        ed.selectWand(d.x, d.y, op)
        return
      case 'fill':
        ed.fill(d.x, d.y)
        return
      case 'gradient':
        gesture.current = { kind: 'gradient', ...g, pts: [] }
        return
      case 'eyedropper':
        ed.eyedrop(d.x, d.y)
        gesture.current = { kind: 'eyedrop', ...g, pts: [] }
        return
      case 'move':
        gesture.current = { kind: 'move', ...g, pts: [] }
        return
    }
  }

  const onMove = (e: Ev) => {
    const s = local(e)
    const g = gesture.current
    setCursor(vp.toDoc(s.x, s.y))
    updateRing(s)
    if (!g || e.pressedButton == null) {
      if (!g) present()
      return
    }
    const d = vp.toDoc(s.x, s.y)
    switch (g.kind) {
      case 'paint':
        ed.strokeTo(d.x, d.y)
        schedule()
        break
      case 'pan':
        vp.pan(s.x - g.last.x, s.y - g.last.y)
        schedule(true)
        break
      case 'select':
        if (ed.tool === 'lasso') {
          g.pts.push(s)
          preview.current = { kind: 'lasso', pts: g.pts }
        } else preview.current = { kind: ed.tool === 'ellipse' ? 'ellipse' : 'rect', a: { x: g.sx, y: g.sy }, b: s }
        present()
        break
      case 'gradient':
      case 'move':
        preview.current = { kind: 'line', a: { x: g.sx, y: g.sy }, b: s }
        present()
        break
      case 'eyedrop':
        ed.eyedrop(d.x, d.y)
        break
    }
    g.last = s
  }

  const onUp = (e: Ev) => {
    const g = gesture.current
    gesture.current = null
    preview.current = null
    if (!g) return
    const s = local(e)
    const a = vp.toDoc(g.sx, g.sy)
    const b = vp.toDoc(s.x, s.y)
    switch (g.kind) {
      case 'paint':
        ed.strokeTo(b.x, b.y)
        ed.endStroke()
        break
      case 'select': {
        if (ed.tool === 'lasso') {
          if (g.pts.length > 2) ed.selectLasso(g.pts.map((p) => vp.toDoc(p.x, p.y)), g.op)
          else ed.deselect()
        } else if (Math.abs(s.x - g.sx) < 3 && Math.abs(s.y - g.sy) < 3) ed.deselect()
        else {
          const r = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }
          if (ed.tool === 'ellipse') ed.selectEllipse(r, g.op)
          else ed.selectRect(r, g.op)
        }
        break
      }
      case 'gradient':
        if (Math.hypot(s.x - g.sx, s.y - g.sy) > 3) ed.gradient(a.x, a.y, b.x, b.y)
        break
      case 'move':
        ed.moveLayer(b.x - a.x, b.y - a.y)
        break
      case 'pan':
        setVersion((v) => v + 1)
        break
    }
    present()
  }

  const onScroll = (e: Ev) => {
    const s = local(e)
    const dy = (e.deltaY ?? 0) * (e.precise ? 1 : 24)
    const dx = (e.deltaX ?? 0) * (e.precise ? 1 : 24)
    if (mods(e)?.shift || Math.abs(dx) > Math.abs(dy)) vp.pan(dx || dy, mods(e)?.shift ? 0 : 0)
    else vp.zoomAt(s.x, s.y, Math.exp(dy * 0.006))
    updateRing(s)
    schedule(true)
    setVersion((v) => v + 1)
  }

  const L = ed.layer
  const toolLabel = TOOLS.find((t) => t.id === ed.tool)?.label ?? ''
  const [docName, docSize] = fileLabel.split(' · ')
  const brushTool = ed.tool === 'brush' || ed.tool === 'eraser'
  const fg = hex(ed.fg)
  const status = notice && ed.lastAction === '' ? notice : ed.lastAction

  useEffect(() => {
    keyBus.down = (e) => {
      if (normKey(e) === 'space') {
        spaceDown.current = true
        return
      }
      if (handleKey(ed, e, act)) {
        updateRing(ring.current)
        present()
      }
    }
    keyBus.up = (e) => {
      if (normKey(e) === 'space') spaceDown.current = false
    }
  })

  return (
    <div
      testId="app-root"
      tabIndex={-1}
      autoFocus
      style={{ width: layout.w, height: layout.h, backgroundColor: T.bg, position: 'relative', overflow: 'hidden' }}
    >
      {/* Options bar */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: layout.w, height: layout.top, borderBottomWidth: 1, borderColor: T.line, backgroundColor: T.panel, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 10, gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Label color={T.fg} size={12.5} weight={600}>{docName}</Label>
          {layout.compactTop || !docSize ? null : <Label color={T.faint} size={12}>{docSize}</Label>}
        </div>
        <div style={{ width: 1, height: 16, backgroundColor: T.line }} />
        <Label color={T.dim} size={12}>{toolLabel}</Label>
        {brushTool ? (
          <div style={{ display: 'flex', flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <Slider testId="size-slider" width={layout.compactTop ? 92 : 110} label="Size" value={ed.brush.size} min={1} max={300} format={(v) => `${v} px`} onChange={(v) => ((ed.brush.size = v), ed.emit())} />
            <Slider width={layout.compactTop ? 104 : 104} label="Hardness" value={Math.round(ed.brush.hardness * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => ((ed.brush.hardness = v / 100), ed.emit())} />
            {layout.compactTop ? null : <Slider width={96} label="Opacity" value={Math.round(ed.brush.opacity * 100)} min={1} max={100} format={(v) => `${v}%`} onChange={(v) => ((ed.brush.opacity = v / 100), ed.emit())} />}
            {layout.compactTop ? null : <Slider width={96} label="Flow" value={Math.round(ed.brush.flow * 100)} min={1} max={100} format={(v) => `${v}%`} onChange={(v) => ((ed.brush.flow = v / 100), ed.emit())} />}
          </div>
        ) : ed.tool === 'wand' || ed.tool === 'fill' ? (
          <div style={{ display: 'flex', flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <Slider width={120} label="Tolerance" value={ed.tolerance} min={0} max={255} onChange={(v) => ((ed.tolerance = v), ed.emit())} />
            <Chip label={ed.contiguous ? 'Contiguous' : 'Global'} active={ed.contiguous} onClick={() => ((ed.contiguous = !ed.contiguous), ed.emit())} />
          </div>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <IconButton testId="undo" name="undo" onClick={() => ed.undo()} disabled={!ed.history.canUndo} />
          <IconButton testId="redo" name="redo" onClick={() => ed.redo()} disabled={!ed.history.canRedo} />
          <div
            testId="export"
            onClick={() => actions.exportPng()}
            style={{ marginLeft: 10, height: 26, paddingLeft: 12, paddingRight: 12, borderRadius: 6, backgroundColor: T.raised, borderWidth: 1, borderColor: T.line, display: 'flex', flexDirection: 'row', alignItems: 'center', cursor: 'pointer', hover: { backgroundColor: T.hover, borderColor: T.lineHi } }}
          >
            <Label color={T.fg} size={12} weight={500}>Export</Label>
          </div>
        </div>
      </div>

      {/* Tool rail */}
      <div style={{ position: 'absolute', left: 0, top: layout.top, width: layout.rail, height: layout.h - layout.top - layout.status, backgroundColor: T.panel, borderRightWidth: 1, borderColor: T.line, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, gap: 3 }}>
        {TOOLS.map((t) => {
          const on = ed.tool === t.id
          return (
            <div
              key={t.id}
              testId={`tool-${t.id}`}
              onClick={() => {
                ed.tool = t.id
                ed.emit()
              }}
              style={{ width: 34, height: 32, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: on ? T.hover : undefined, cursor: 'pointer', hover: on ? undefined : { backgroundColor: T.raised } }}
            >
              <Icon name={t.icon} color={on ? T.fg : T.faint} size={17} />
            </div>
          )
        })}
        <div style={{ flexGrow: 1 }} />
        <div testId="fg-swatch" onClick={() => setSwatches((s) => !s)} style={{ width: 40, height: 40, position: 'relative', marginBottom: 10, cursor: 'pointer' }}>
          <div style={{ position: 'absolute', left: 14, top: 14, width: 22, height: 22, borderRadius: 5, backgroundColor: hex(ed.bg), borderWidth: 1, borderColor: T.lineHi }} />
          <div style={{ position: 'absolute', left: 4, top: 4, width: 22, height: 22, borderRadius: 5, backgroundColor: fg, borderWidth: 1.5, borderColor: T.fg }} />
        </div>
      </div>

      {/* Canvas */}
      <div
        testId="canvas"
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onScroll={onScroll}
        onMouseLeave={() => {
          ring.current = null
          setCursor(null)
          present()
        }}
        style={{ position: 'absolute', left: cv.x, top: cv.y, width: cv.w, height: cv.h, cursor: brushTool ? 'crosshair' : ed.tool === 'hand' ? 'grab' : 'default' }}
      >
        <img ref={img} objectFit="fill" style={{ width: cv.w, height: cv.h }} />
      </div>

      {layout.panel > 0 ? <Panel ed={ed} L={layout} version={version} openBlend={(y, x) => setBlendMenu({ x, y })} /> : null}

      {/* Status bar */}
      <div style={{ position: 'absolute', left: 0, top: layout.h - layout.status, width: layout.w, height: layout.status, borderTopWidth: 1, borderColor: T.line, backgroundColor: T.panel, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 14, gap: 18 }}>
        <Label size={11} color={T.dim}>{`${Math.round(vp.zoom * 100)}%`}</Label>
        <Label size={11} color={T.faint}>{`${ed.doc.width} × ${ed.doc.height}`}</Label>
        {cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x < ed.doc.width && cursor.y < ed.doc.height ? <Label size={11} color={T.faint}>{`${Math.floor(cursor.x)}, ${Math.floor(cursor.y)}`}</Label> : null}
        {ed.selectionBounds ? <Label size={11} color={T.faint}>{`Selection ${ed.selectionBounds.x1 - ed.selectionBounds.x0} × ${ed.selectionBounds.y1 - ed.selectionBounds.y0}`}</Label> : null}
        {layout.w >= 760 && L ? <Label size={11} color={T.faint}>{`${L.name}${ed.editMask ? ' (mask)' : ''}`}</Label> : null}
        <div style={{ flexGrow: 1 }} />
        <Label size={11} color={status.startsWith('Exported') || status.startsWith('Saved') ? T.fg : T.faint}>{status}</Label>
        {layout.w >= 900 ? <Label size={11} color={T.faint}>? Shortcuts</Label> : null}
      </div>

      {blendMenu && L ? (
        <div testId="blend-menu" onMouseDownOutside={() => setBlendMenu(null)} style={{ position: 'absolute', left: blendMenu.x, top: Math.min(blendMenu.y, layout.h - 16 * 24 - 20), width: 150, padding: 4, borderRadius: 8, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'column' }}>
          {BLEND_MODES.map((m) => (
            <div
              key={m}
              testId={`blend-${m}`}
              onClick={() => {
                ed.setBlend(m)
                setBlendMenu(null)
              }}
              style={{ height: 24, borderRadius: 5, paddingLeft: 8, display: 'flex', alignItems: 'center', backgroundColor: L.blend === m ? T.hover : undefined, cursor: 'pointer', hover: { backgroundColor: T.hover } }}
            >
              <Label size={12} color={T.fg} weight={L.blend === m ? 600 : 400}>{BLEND_LABELS[m]}</Label>
            </div>
          ))}
        </div>
      ) : null}

      {swatches ? (
        <div testId="swatches" onMouseDownOutside={() => setSwatches(false)} style={{ position: 'absolute', left: layout.rail + 8, top: layout.h - layout.status - 132, width: 168, padding: 10, borderRadius: 10, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SWATCHES.map((c) => (
            <div
              key={c}
              testId={`swatch-${c.slice(1)}`}
              onClick={() => {
                ed.fg = rgb(c)
                setSwatches(false)
                ed.emit()
              }}
              style={{ width: 30, height: 30, borderRadius: 7, backgroundColor: c, borderWidth: 2, borderColor: c === fg ? T.fg : T.line, cursor: 'pointer' }}
            />
          ))}
        </div>
      ) : null}

      {help ? (
        <div onClick={() => setHelp(false)} style={{ position: 'absolute', left: cv.x + 20, top: cv.y + 20, width: 340, padding: 16, borderRadius: 12, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Label size={13} color={T.fg} weight={600}>Keyboard Shortcuts</Label>
          {[
            ['B / E', 'brush / eraser'],
            ['M  O  L  W', 'rect · ellipse · lasso · wand'],
            ['K  G  I  V  H', 'fill · gradient · eyedropper · move · hand'],
            ['[  ]', 'brush size'],
            ['1 … 0', 'layer opacity 10 … 100%'],
            ['+  -', 'cycle blend mode'],
            ['Q', 'add mask / toggle mask editing'],
            ['Ctrl-Z  Ctrl-Shift-Z', 'undo · redo'],
            ['Ctrl-J  Ctrl-Shift-N', 'duplicate · new layer'],
            ['Ctrl-A  Ctrl-D  Ctrl-Shift-I', 'all · deselect · invert'],
            ['Ctrl-E  Ctrl-Shift-E  Ctrl-S', 'export PNG · JPEG · save .pcraft'],
            ['scroll · space-drag · F', 'zoom · pan · fit'],
            ['Ctrl-C', 'quit'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
              <div style={{ width: 150 }}>
                <Label size={11.5} color={T.fg} weight={500}>{k!}</Label>
              </div>
              <Label size={11.5} color={T.dim}>{v!}</Label>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
