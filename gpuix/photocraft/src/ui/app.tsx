import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useWindowSize, type EventPayload, type ImgInstance } from '@gpuix/react'
import { ADJUST_LABELS, curveLut, type Adjust, type AdjustKind } from '../core/adjust'
import { BLEND_LABELS, BLEND_MODES } from '../core/blend'
import type { Editor, Tool } from '../core/editor'
import { fullRect, type Rect } from '../core/doc'
import { xformCorners, type Xform } from '../core/geometry'
import { textBounds, textCaret } from '../core/text'
import { ColorPicker, DIALOG_TITLES, DialogView, LevelsEditor, MenuBar, MenuDropdown, Palette, type DialogState } from './chrome'
import { searchCommands, TOOL_INFO, type AppActions, type Command, type Ctx, type Dialog, type MenuName } from './commands'
import { FILTER_LABELS, type FilterKind } from '../core/filters'
import type { Layer } from '../core/doc'
import { Button, Chip, Divider, Icon, IconButton, Kbd, Label, Section, Segmented, Slider, type IconName } from './atoms'
import { ICONS } from './icons'
import { handleKey, normKey, typedChar, type KeyActions, type KeyLike } from './keys'
import { computeLayout } from './layout'
import { hex, rgb, SWATCHES, T } from './theme'
import { Viewport, type Overlay, type Preview } from './viewport'

type Ev = EventPayload

export interface AppProps {
  ed: Editor
  /** Fixed size for tests; live terminal size otherwise. */
  size?: { width: number; height: number }
  actions: AppActions
  fileLabel: string
  notice?: string
}

const ADJ_KINDS: AdjustKind[] = ['levels', 'curves', 'hue-sat', 'brightness-contrast', 'exposure', 'vibrance', 'black-white', 'threshold', 'color-balance']
const FILTERS: FilterKind[] = ['gaussian', 'unsharp', 'motion', 'noise', 'high-pass', 'median']
const SHORT_ADJ: Record<AdjustKind, string> = { levels: 'Levels', 'color-balance': 'Color Bal.', curves: 'Curves', 'hue-sat': 'Hue/Sat', 'brightness-contrast': 'Brightness', exposure: 'Exposure', vibrance: 'Vibrance', 'black-white': 'Grayscale', invert: 'Invert', threshold: 'Threshold' }
const SHORT_FILTER: Record<FilterKind, string> = { gaussian: 'Blur', unsharp: 'Sharpen', motion: 'Motion Blur', noise: 'Noise', 'high-pass': 'High Pass', median: 'Median' }

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
        <Label color={T.faint} size={10.5} clip>{`${L.kind === 'pixel' && L.text ? 'Type · ' : ''}${BLEND_LABELS[L.blend]} · ${Math.round(L.opacity * 100)}%${active && ed.editMask ? ' · mask' : ''}`}</Label>
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
    case 'levels':
      return <LevelsEditor ed={ed} adjust={a} version={version} width={width} />
    case 'color-balance':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Slider label="Cyan · Red" value={a.cyanRed} min={-100} max={100} onChange={(v) => set({ cyanRed: v })} />
          <Slider label="Magenta · Green" value={a.magentaGreen} min={-100} max={100} onChange={(v) => set({ magentaGreen: v })} />
          <Slider label="Yellow · Blue" value={a.yellowBlue} min={-100} max={100} onChange={(v) => set({ yellowBlue: v })} />
          <Chip label={a.preserveLuminosity ? 'Preserve Luminosity: On' : 'Preserve Luminosity: Off'} active={a.preserveLuminosity} onClick={() => set({ preserveLuminosity: !a.preserveLuminosity })} />
        </div>
      )
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

function Panel({ ed, L: layout, version, openBlend, openFilter }: { ed: Editor; L: ReturnType<typeof computeLayout>; version: number; openBlend: (y: number, x: number) => void; openFilter: (k: FilterKind) => void }) {
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
            <Chip key={k} width={cell} testId={`filter-${k}`} label={SHORT_FILTER[k]} disabled={L?.kind !== 'pixel'} onClick={() => openFilter(k)} />
          ))}
        </div>
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
  const [picker, setPicker] = useState(false)
  const [help, setHelp] = useState(false)
  const [menu, setMenu] = useState<{ name: MenuName; x: number } | null>(null)
  const [palette, setPalette] = useState<{ q: string; sel: number } | null>(null)
  const [dialog, setDialog] = useState<{ d: Dialog; s: DialogState; err?: string } | null>(null)
  const [selMode, setSelMode] = useState<'replace' | 'add' | 'subtract'>('replace')
  const [cropRatio, setCropRatio] = useState<'free' | '1' | '4:3' | '16:9' | 'orig'>('free')
  const [tip, setTip] = useState<{ label: string; key: string; y: number } | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const vp = useRef(new Viewport()).current
  const img = useRef<ImgInstance>(null)
  type Gesture = {
    kind: 'paint' | 'pan' | 'select' | 'move' | 'gradient' | 'eyedrop' | 'crop' | 'xform'
    sx: number
    sy: number
    last: { x: number; y: number }
    pts: { x: number; y: number }[]
    op: 'replace' | 'add' | 'subtract'
    mode?: string
    hx?: number
    hy?: number
    r0?: Rect
    t0?: Xform
    off?: { x: number; y: number }
    shift?: boolean
  }
  const gesture = useRef<Gesture | null>(null)
  const preview = useRef<Preview>(null)
  const crop = useRef<Rect | null>(null)
  const ring = useRef<{ x: number; y: number; r: number } | null>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const phase = useRef(0)
  const drawTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const needFull = useRef(true)
  const lastSel = useRef(-1)
  const lastDoc = useRef(ed.docVersion)
  const spaceDown = useRef(false)
  const shownZoom = useRef(0)

  const overlays = (): Overlay[] => {
    const o: Overlay[] = []
    const sc = (x: number, y: number) => vp.toScreen(x, y)
    if (ed.tool === 'crop' && crop.current) {
      const c = crop.current
      const untouched = c.x0 <= 0 && c.y0 <= 0 && c.x1 >= ed.doc.width && c.y1 >= ed.doc.height
      o.push({ kind: 'crop', a: sc(c.x0, c.y0), b: sc(c.x1, c.y1), thirds: !untouched || gesture.current?.kind === 'crop' })
    }
    if (ed.xf) o.push({ kind: 'xform', pts: xformCorners(ed.xf.box, ed.xf.t).map(([x, y]) => sc(x, y)) })
    if (ed.textEdit?.layer.text) {
      const t = ed.textEdit.layer.text
      const b = textBounds(t)
      const c = textCaret(t)
      const a = sc(b.x0 - 4, b.y0 - 4)
      const bb = sc(Math.max(b.x1, c.x) + 4, b.y1 + 4)
      const c0 = sc(c.x, c.y0)
      const c1 = sc(c.x, c.y1)
      o.push({ kind: 'textbox', a, b: bb, caret: { x: c0.x, y0: c0.y, y1: c1.y } })
    }
    if (ed.tool === 'clone' && ed.cloneSource) {
      const g = gesture.current
      if (g?.kind === 'paint' && g.off && pointer.current) {
        const d = vp.toDoc(pointer.current.x, pointer.current.y)
        const p = sc(d.x + g.off.x, d.y + g.off.y)
        o.push({ kind: 'cross', x: p.x, y: p.y })
      } else {
        const p = sc(ed.cloneSource.x, ed.cloneSource.y)
        o.push({ kind: 'cross', x: p.x, y: p.y })
      }
    }
    return o
  }

  const present = () => {
    if (!img.current) return
    const out = vp.present(phase.current, preview.current, ring.current, overlays())
    img.current.setImagePixels(vp.w, vp.h, new Uint8Array(out.buffer, out.byteOffset, out.length))
  }

  const draw = () => {
    drawTimer.current = null
    if (vp.resize(cv.w, cv.h)) needFull.current = true
    if (vp.docW !== ed.doc.width || vp.docH !== ed.doc.height || lastDoc.current !== ed.docVersion) {
      vp.setDoc(ed.doc.width, ed.doc.height)
      if (lastDoc.current !== ed.docVersion) vp.fit()
      lastDoc.current = ed.docVersion
      if (ed.tool === 'crop') crop.current = fullRect(ed.doc)
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
    // Marching ants and the text caret blink.
    const id = setInterval(() => {
      if (!ed.selection && !preview.current && !ed.textEdit) return
      phase.current = (phase.current + 1) % 8
      present()
    }, 120)
    return () => clearInterval(id)
  }, [ed])

  const refresh = () => {
    schedule(true)
    setVersion((v) => v + 1)
  }

  const setTool = (t: Tool) => {
    if (ed.tool !== t) {
      ed.commitText()
      if (ed.xf) ed.commitTransform()
    }
    ed.tool = t
    crop.current = t === 'crop' ? fullRect(ed.doc) : null
    ed.emit()
    present()
  }

  const openDialog = (d: Dialog) => {
    setMenu(null)
    setPalette(null)
    if (d.kind === 'filter') {
      if (!ed.previewFilter(d.filter, ed.filterAmount[d.filter])) return
      setDialog({ d, s: { value: ed.filterAmount[d.filter], text: '' } })
      return
    }
    if (d.kind === 'feather' && !ed.selection) return ed.emit('Make a selection first')
    setDialog({ d, s: { value: d.kind === 'feather' ? 8 : d.kind === 'resize' ? 50 : 0, text: d.kind === 'rename' ? ed.layer?.name ?? '' : '' } })
  }

  const act: KeyActions & Ctx = {
    ...actions,
    ed,
    actions,
    fit: () => {
      vp.fit()
      refresh()
    },
    zoom: (f) => {
      vp.zoomAt(vp.w / 2, vp.h / 2, f)
      refresh()
    },
    actualSize: () => {
      vp.zoomAt(vp.w / 2, vp.h / 2, 1 / vp.zoom)
      refresh()
    },
    toggleHelp: () => setHelp((h) => !h),
    help: () => setHelp((h) => !h),
    palette: () => {
      setMenu(null)
      setPalette({ q: '', sel: 0 })
    },
    dialog: openDialog,
    setTool,
  }

  const runCommand = (c: Command) => {
    setMenu(null)
    setPalette(null)
    c.run(act)
    present()
  }

  const applyDialog = () => {
    if (!dialog) return
    const { d, s } = dialog
    let err: string | void = undefined
    if (d.kind === 'feather') ed.feather(s.value)
    else if (d.kind === 'resize') ed.resizeImage((ed.doc.width * s.value) / 100, (ed.doc.height * s.value) / 100)
    else if (d.kind === 'rename') ed.renameLayer(s.text)
    else if (d.kind === 'filter') ed.commitFilter()
    else if (d.kind === 'open') err = s.text.trim() ? actions.openFile?.(s.text.trim()) ?? 'Opening files is not available here' : 'Type a file path'
    else if (d.kind === 'place') err = s.text.trim() ? actions.placeFile?.(s.text.trim()) ?? 'Placing files is not available here' : 'Type a file path'
    if (err) return setDialog({ ...dialog, err })
    setDialog(null)
    refresh()
  }

  const cancelDialog = () => {
    if (dialog?.d.kind === 'filter') ed.cancelFilter()
    setDialog(null)
  }

  const setDialogState = (s: DialogState) => {
    if (!dialog) return
    setDialog({ ...dialog, s, err: undefined })
    const d = dialog.d
    if (d.kind === 'filter') {
      if (filterTimer.current) clearTimeout(filterTimer.current)
      filterTimer.current = setTimeout(() => ed.previewFilter(d.filter, s.value), 16)
    }
  }

  const applyCrop = () => {
    const r = crop.current
    if (!r) return
    const full = r.x0 <= 0 && r.y0 <= 0 && r.x1 >= ed.doc.width && r.y1 >= ed.doc.height
    if (full) return ed.emit('Drag the crop handles first')
    if (ed.crop({ x0: Math.round(r.x0), y0: Math.round(r.y0), x1: Math.round(r.x1), y1: Math.round(r.y1) })) crop.current = fullRect(ed.doc)
  }

  const local = (e: Ev) => ({ x: (e.x ?? 0) - cv.x, y: (e.y ?? 0) - cv.y })
  const mods = (e: Ev) => e.modifiers as { shift?: boolean; alt?: boolean; ctrl?: boolean } | undefined

  const painting = () => ed.tool === 'brush' || ed.tool === 'eraser' || ed.tool === 'clone' || ed.tool === 'heal'
  const updateRing = (s: { x: number; y: number } | null) => {
    ring.current = s && painting() ? { x: s.x, y: s.y, r: (ed.brush.size / 2) * vp.zoom } : null
  }

  const ratioValue = () => (cropRatio === 'free' ? 0 : cropRatio === '1' ? 1 : cropRatio === '4:3' ? 4 / 3 : cropRatio === '16:9' ? 16 / 9 : ed.doc.width / ed.doc.height)

  const cropHit = (s: { x: number; y: number }) => {
    const r = crop.current
    if (!r) return { mode: 'new', hx: 0, hy: 0 }
    const a = vp.toScreen(r.x0, r.y0)
    const b = vp.toScreen(r.x1, r.y1)
    const near = (v: number, t: number) => Math.abs(v - t) <= 10
    const hx = near(s.x, a.x) ? -1 : near(s.x, b.x) ? 1 : 0
    const hy = near(s.y, a.y) ? -1 : near(s.y, b.y) ? 1 : 0
    const inX = s.x > a.x - 10 && s.x < b.x + 10
    const inY = s.y > a.y - 10 && s.y < b.y + 10
    if ((hx && inY) || (hy && inX)) return { mode: 'handle', hx: inY ? hx : 0, hy: inX ? hy : 0 }
    // An untouched (full-canvas) frame can't move, so dragging inside it draws a new one.
    const untouched = r.x0 <= 0 && r.y0 <= 0 && r.x1 >= ed.doc.width && r.y1 >= ed.doc.height
    if (!untouched && s.x > a.x && s.x < b.x && s.y > a.y && s.y < b.y) return { mode: 'move', hx: 0, hy: 0 }
    return { mode: 'new', hx: 0, hy: 0 }
  }

  const dragCrop = (g: Gesture, s: { x: number; y: number }, shift: boolean) => {
    const W = ed.doc.width
    const H = ed.doc.height
    const a = vp.toDoc(g.sx, g.sy)
    const d = vp.toDoc(s.x, s.y)
    const ratio = shift && !ratioValue() ? 1 : ratioValue()
    const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    const r0 = g.r0!
    let r: Rect
    if (g.mode === 'move') {
      const w = r0.x1 - r0.x0
      const h = r0.y1 - r0.y0
      const x0 = cl(r0.x0 + d.x - a.x, 0, W - w)
      const y0 = cl(r0.y0 + d.y - a.y, 0, H - h)
      r = { x0, y0, x1: x0 + w, y1: y0 + h }
    } else if (g.mode === 'handle') {
      r = { ...r0 }
      const px = cl(d.x, 0, W)
      const py = cl(d.y, 0, H)
      if (g.hx === -1) r.x0 = Math.min(px, r.x1 - 4)
      if (g.hx === 1) r.x1 = Math.max(px, r.x0 + 4)
      if (g.hy === -1) r.y0 = Math.min(py, r.y1 - 4)
      if (g.hy === 1) r.y1 = Math.max(py, r.y0 + 4)
      if (ratio && g.hx && g.hy) {
        const h = (r.x1 - r.x0) / ratio
        if (g.hy === -1) r.y0 = Math.max(0, r.y1 - h)
        else r.y1 = Math.min(H, r.y0 + h)
      }
    } else {
      const ax = cl(a.x, 0, W)
      const ay = cl(a.y, 0, H)
      let bx = cl(d.x, 0, W)
      let by = cl(d.y, 0, H)
      if (ratio) {
        const w = Math.abs(bx - ax)
        by = cl(ay + Math.sign(by - ay || 1) * (w / ratio), 0, H)
        bx = ax + Math.sign(bx - ax || 1) * Math.abs(by - ay) * ratio
      }
      r = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }
    }
    crop.current = r
  }

  const xfHit = (s: { x: number; y: number }) => {
    const x = ed.xf!
    const cs = xformCorners(x.box, x.t).map(([px, py]) => vp.toScreen(px, py))
    const hs = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(s.x - cs[i]!.x, s.y - cs[i]!.y) <= 10) return { mode: 'scale', hx: hs[i]![0]!, hy: hs[i]![1]! }
      const n = (i + 1) % 4
      const mx = (cs[i]!.x + cs[n]!.x) / 2
      const my = (cs[i]!.y + cs[n]!.y) / 2
      if (Math.hypot(s.x - mx, s.y - my) <= 9) return { mode: 'scale', hx: (hs[i]![0]! + hs[n]![0]!) / 2, hy: (hs[i]![1]! + hs[n]![1]!) / 2 }
    }
    // Inside the (possibly rotated) box: point-in-convex-quad.
    let inside = true
    for (let i = 0; i < 4; i++) {
      const a = cs[i]!
      const b = cs[(i + 1) % 4]!
      if ((b.x - a.x) * (s.y - a.y) - (b.y - a.y) * (s.x - a.x) < 0) inside = false
    }
    return { mode: inside ? 'move' : 'rotate', hx: 0, hy: 0 }
  }

  const dragXf = (g: Gesture, s: { x: number; y: number }, shift: boolean) => {
    const x = ed.xf
    if (!x) return
    const t0 = g.t0!
    const p0 = vp.toDoc(g.sx, g.sy)
    const p = vp.toDoc(s.x, s.y)
    if (g.mode === 'move') return ed.setTransform({ cx: t0.cx + p.x - p0.x, cy: t0.cy + p.y - p0.y })
    if (g.mode === 'rotate') {
      let rot = t0.rot + Math.atan2(p.y - t0.cy, p.x - t0.cx) - Math.atan2(p0.y - t0.cy, p0.x - t0.cx)
      if (shift) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12)
      return ed.setTransform({ rot })
    }
    const hw = (x.box.x1 - x.box.x0) / 2
    const hh = (x.box.y1 - x.box.y0) / 2
    const hx = g.hx!
    const hy = g.hy!
    const c = Math.cos(t0.rot)
    const sn = Math.sin(t0.rot)
    const rot = (u: number, v: number) => ({ x: u * c - v * sn, y: u * sn + v * c })
    const al = { x: -hx * hw * t0.sx, y: -hy * hh * t0.sy }
    const ar = rot(al.x, al.y)
    const anchor = { x: t0.cx + ar.x, y: t0.cy + ar.y }
    const dx = p.x - anchor.x
    const dy = p.y - anchor.y
    const q = { x: dx * c + dy * sn, y: -dx * sn + dy * c }
    let sx = hx ? Math.max(2 / hw, (q.x * hx) / (2 * hw)) : t0.sx
    let sy = hy ? Math.max(2 / hh, (q.y * hy) / (2 * hh)) : t0.sy
    if (hx && hy && !shift) {
      const dvx = hx * 2 * hw * t0.sx
      const dvy = hy * 2 * hh * t0.sy
      const k = Math.max(0.02, (q.x * dvx + q.y * dvy) / (dvx * dvx + dvy * dvy))
      sx = t0.sx * k
      sy = t0.sy * k
    }
    const off = rot(hx * hw * sx, hy * hh * sy)
    ed.setTransform({ sx, sy, cx: anchor.x + off.x, cy: anchor.y + off.y })
  }

  const onDown = (e: Ev) => {
    const s = local(e)
    const d = vp.toDoc(s.x, s.y)
    const m = mods(e)
    const op = m?.shift ? 'add' : m?.alt ? 'subtract' : selMode
    const g = { sx: s.x, sy: s.y, last: s, pts: [d], op } as Gesture
    setBlendMenu(null)
    setPicker(false)
    setMenu(null)
    if (e.button === 1 || e.button === 2 || ed.tool === 'hand' || spaceDown.current) {
      gesture.current = { ...g, kind: 'pan', pts: [] }
      return
    }
    if (ed.xf) {
      const h = xfHit(s)
      gesture.current = { ...g, kind: 'xform', mode: h.mode, hx: h.hx, hy: h.hy, t0: { ...ed.xf.t } }
      return
    }
    switch (ed.tool) {
      case 'brush':
      case 'eraser':
      case 'clone':
      case 'heal': {
        if (ed.tool === 'clone' && m?.alt) {
          ed.setCloneSource(d.x, d.y)
          present()
          return
        }
        const off = ed.cloneSource ? { x: ed.cloneSource.x - d.x, y: ed.cloneSource.y - d.y } : undefined
        const from = m?.shift && ed.lastPoint && (ed.tool === 'brush' || ed.tool === 'eraser') ? ed.lastPoint : null
        if (!ed.beginStroke(d.x, d.y, ed.tool === 'eraser', from)) {
          if (ed.tool !== 'clone') ed.emit(ed.layer?.kind === 'adjust' ? 'Select a pixel layer or its mask to paint' : 'Nothing to paint on')
          present()
          return
        }
        gesture.current = { ...g, kind: 'paint', off }
        schedule()
        return
      }
      case 'marquee':
      case 'ellipse':
      case 'lasso':
        gesture.current = { ...g, kind: 'select', pts: [s] }
        return
      case 'wand':
        ed.selectWand(d.x, d.y, op)
        return
      case 'fill':
        ed.fill(d.x, d.y)
        return
      case 'gradient':
        gesture.current = { ...g, kind: 'gradient', pts: [] }
        return
      case 'eyedropper':
        ed.eyedrop(d.x, d.y)
        gesture.current = { ...g, kind: 'eyedrop', pts: [] }
        return
      case 'move':
        gesture.current = { ...g, kind: 'move', pts: [] }
        return
      case 'text':
        ed.beginText(d.x, d.y)
        present()
        return
      case 'crop': {
        const h = cropHit(s)
        gesture.current = { ...g, kind: 'crop', mode: h.mode, hx: h.hx, hy: h.hy, r0: crop.current ? { ...crop.current } : fullRect(ed.doc) }
        return
      }
    }
  }

  const onMove = (e: Ev) => {
    const s = local(e)
    const g = gesture.current
    pointer.current = s
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
      case 'crop':
        dragCrop(g, s, !!mods(e)?.shift)
        present()
        setVersion((v) => v + 1)
        break
      case 'xform':
        dragXf(g, s, !!mods(e)?.shift)
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
      case 'crop':
        if (g.mode === 'new' && Math.hypot(s.x - g.sx, s.y - g.sy) < 4) crop.current = g.r0 ?? null
        setVersion((v) => v + 1)
        break
    }
    present()
  }

  const onScroll = (e: Ev) => {
    const s = local(e)
    const dy = (e.deltaY ?? 0) * (e.precise ? 1 : 24)
    const dx = (e.deltaX ?? 0) * (e.precise ? 1 : 24)
    if (mods(e)?.shift || Math.abs(dx) > Math.abs(dy)) vp.pan(dx || dy, 0)
    else vp.zoomAt(s.x, s.y, Math.exp(dy * 0.006))
    updateRing(s)
    schedule(true)
    setVersion((v) => v + 1)
  }

  const L = ed.layer
  const info = TOOL_INFO.find((t) => t.id === ed.tool)!
  const docName = ed.docVersion > 0 ? ed.doc.name : fileLabel.split(' · ')[0]!
  const fg = hex(ed.fg)
  const status = notice && ed.lastAction === '' ? notice : ed.lastAction
  const results = palette ? searchCommands(palette.q, ed) : []

  useEffect(() => {
    keyBus.down = (e) => {
      const k = normKey(e)
      const m = e.modifiers ?? {}
      const ctrl = !!(m.ctrl || m.cmd)
      const ch = typedChar(e)
      if (palette) {
        if (k === 'escape') setPalette(null)
        else if (k === 'enter' || k === 'return') results[palette.sel] && runCommand(results[palette.sel]!)
        else if (k === 'down' || (ctrl && k === 'n')) setPalette({ ...palette, sel: Math.min(Math.min(8, results.length - 1), palette.sel + 1) })
        else if (k === 'up' || (ctrl && k === 'p')) setPalette({ ...palette, sel: Math.max(0, palette.sel - 1) })
        else if (k === 'backspace') setPalette({ q: palette.q.slice(0, -1), sel: 0 })
        else if (ctrl && k === 'k') setPalette(null)
        else if (ch) setPalette({ q: palette.q + ch, sel: 0 })
        return
      }
      if (dialog) {
        const textual = dialog.d.kind === 'rename' || dialog.d.kind === 'open' || dialog.d.kind === 'place'
        if (k === 'escape') cancelDialog()
        else if (k === 'enter' || k === 'return') applyDialog()
        else if (textual && k === 'backspace') setDialogState({ ...dialog.s, text: dialog.s.text.slice(0, -1) })
        else if (textual && ch) setDialogState({ ...dialog.s, text: dialog.s.text + ch })
        else if (!textual && (k === 'left' || k === 'right')) setDialogState({ ...dialog.s, value: dialog.s.value + (k === 'left' ? -1 : 1) })
        return
      }
      if (menu && k === 'escape') return setMenu(null)
      if (ed.textEdit) {
        if (k === 'escape' || (ctrl && (k === 'enter' || k === 'return'))) {
          ed.commitText()
          present()
          return
        }
        if (!ctrl) {
          if (k === 'enter' || k === 'return') ed.typeText('\n')
          else if (k === 'backspace') ed.backspaceText()
          else if (ch) ed.typeText(ch)
          present()
          return
        }
        ed.commitText()
      }
      if (ed.xf && (k === 'enter' || k === 'return' || k === 'escape')) {
        if (k === 'escape') ed.cancelTransform()
        else ed.commitTransform()
        present()
        return
      }
      if (ed.tool === 'crop' && (k === 'enter' || k === 'return')) return applyCrop()
      if (ed.tool === 'crop' && k === 'escape') {
        crop.current = fullRect(ed.doc)
        present()
        setVersion((v) => v + 1)
        return
      }
      if (k === 'space') {
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

  const sliderW = layout.compactTop ? 92 : 104
  const brushSliders = (opts: { opacity?: boolean; flow?: boolean }) => (
    <>
      <Slider testId="size-slider" width={sliderW} label="Size" value={ed.brush.size} min={1} max={300} format={(v) => `${v} px`} onChange={(v) => ((ed.brush.size = v), ed.emit())} />
      <Slider width={sliderW} label="Hardness" value={Math.round(ed.brush.hardness * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => ((ed.brush.hardness = v / 100), ed.emit())} />
      {opts.opacity && !layout.compactTop ? <Slider width={sliderW} label="Opacity" value={Math.round(ed.brush.opacity * 100)} min={1} max={100} format={(v) => `${v}%`} onChange={(v) => ((ed.brush.opacity = v / 100), ed.emit())} /> : null}
      {opts.flow && !layout.compactTop ? <Slider width={sliderW} label="Flow" value={Math.round(ed.brush.flow * 100)} min={1} max={100} format={(v) => `${v}%`} onChange={(v) => ((ed.brush.flow = v / 100), ed.emit())} /> : null}
    </>
  )
  const hint = (t: string) => (layout.w >= 980 ? <Label size={11.5} color={T.faint}>{t}</Label> : null)

  const toolOptions = (): ReactNode => {
    if (ed.xf) {
      const t = ed.xf.t
      return (
        <>
          <Label size={12} color={T.dim}>{`W ${Math.round(t.sx * 100)}%`}</Label>
          <Label size={12} color={T.dim}>{`H ${Math.round(t.sy * 100)}%`}</Label>
          <Label size={12} color={T.dim}>{`${Math.round((t.rot * 180) / Math.PI)}°`}</Label>
          {hint('Drag corners to scale · outside to rotate · Shift to snap')}
          <div style={{ flexGrow: 1 }} />
          <Button label="Cancel" testId="xf-cancel" onClick={() => (ed.cancelTransform(), present())} />
          <Button label="Apply" primary testId="xf-apply" onClick={() => (ed.commitTransform(), present())} />
        </>
      )
    }
    switch (ed.tool) {
      case 'brush':
      case 'eraser':
        return brushSliders({ opacity: true, flow: true })
      case 'clone':
        return (
          <>
            {brushSliders({ opacity: true })}
            <Label size={11.5} color={ed.cloneSource ? T.dim : T.fg}>{ed.cloneSource ? `Source ${ed.cloneSource.x}, ${ed.cloneSource.y} · Alt-click to change` : 'Alt-click to set the source'}</Label>
          </>
        )
      case 'heal':
        return (
          <>
            {brushSliders({})}
            {hint('Paint over a blemish to blend it away')}
          </>
        )
      case 'marquee':
      case 'ellipse':
      case 'lasso':
      case 'wand':
        return (
          <>
            <Segmented testId="selmode" value={selMode} onChange={setSelMode} items={[{ value: 'replace', label: 'New' }, { value: 'add', label: 'Add' }, { value: 'subtract', label: 'Subtract' }]} />
            {ed.tool === 'wand' ? <Slider width={110} label="Tolerance" value={ed.tolerance} min={0} max={255} onChange={(v) => ((ed.tolerance = v), ed.emit())} /> : null}
            {ed.tool === 'wand' ? <Chip label={ed.contiguous ? 'Contiguous' : 'All Pixels'} active={ed.contiguous} onClick={() => ((ed.contiguous = !ed.contiguous), ed.emit())} /> : null}
            {ed.selection ? <Button label="Feather…" onClick={() => openDialog({ kind: 'feather' })} /> : null}
          </>
        )
      case 'fill':
        return (
          <>
            <Slider width={110} label="Tolerance" value={ed.tolerance} min={0} max={255} onChange={(v) => ((ed.tolerance = v), ed.emit())} />
            <Chip label={ed.contiguous ? 'Contiguous' : 'All Pixels'} active={ed.contiguous} onClick={() => ((ed.contiguous = !ed.contiguous), ed.emit())} />
          </>
        )
      case 'gradient':
        return (
          <>
            <Segmented testId="gradient-shape" value={ed.gradientShape} onChange={(v) => ((ed.gradientShape = v), ed.emit())} items={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} />
            <Slider width={sliderW} label="Opacity" value={Math.round(ed.brush.opacity * 100)} min={1} max={100} format={(v) => `${v}%`} onChange={(v) => ((ed.brush.opacity = v / 100), ed.emit())} />
          </>
        )
      case 'text':
        return (
          <>
            <Slider testId="text-size" width={120} label="Size" value={ed.textEdit?.layer.text?.size ?? ed.textSize} min={8} max={400} format={(v) => `${v} px`} onChange={(v) => {
              ed.textSize = v
              if (ed.textEdit) ed.editText((t) => ({ ...t, size: v }))
              else ed.emit()
            }} />
            <div onClick={() => setPicker(true)} style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: fg, borderWidth: 1, borderColor: T.lineHi, cursor: 'pointer' }} />
            {ed.textEdit ? <Button label="Done" primary testId="text-done" onClick={() => (ed.commitText(), present())} /> : hint('Click the canvas to type · click existing type to edit it')}
          </>
        )
      case 'crop': {
        const r = crop.current
        return (
          <>
            <Segmented testId="crop-ratio" value={cropRatio} onChange={setCropRatio} items={[{ value: 'free', label: 'Free' }, { value: '1', label: '1:1' }, { value: '4:3', label: '4:3' }, { value: '16:9', label: '16:9' }, ...(layout.compactTop ? [] : [{ value: 'orig' as const, label: 'Original' }])]} />
            {r ? <Label size={12} color={T.dim}>{`${Math.round(r.x1 - r.x0)} × ${Math.round(r.y1 - r.y0)}`}</Label> : null}
            <div style={{ flexGrow: 1 }} />
            <Button label="Reset" testId="crop-reset" onClick={() => ((crop.current = fullRect(ed.doc)), present(), setVersion((v) => v + 1))} />
            <Button label="Crop" primary testId="crop-apply" onClick={applyCrop} />
          </>
        )
      }
      case 'move':
        return (
          <>
            <Button label="Free Transform" testId="begin-transform" onClick={() => (ed.beginTransform(), present())} />
            <IconButton name="flip" onClick={() => ed.flipLayer('h')} />
            {hint('Drag to move the layer · ⌃T to scale and rotate')}
          </>
        )
      case 'eyedropper':
        return (
          <>
            <div style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: fg, borderWidth: 1, borderColor: T.lineHi }} />
            <Label size={12} color={T.fg}>{fg.toUpperCase()}</Label>
          </>
        )
      case 'hand':
        return (
          <>
            <Button label="Fit" onClick={() => act.fit()} />
            <Button label="100%" onClick={() => act.actualSize()} />
          </>
        )
    }
    return null
  }

  const groups = [0, 1, 2, 3, 4]
  const railCompact = layout.h < 720

  return (
    <div testId="app-root" tabIndex={-1} autoFocus style={{ width: layout.w, height: layout.h, backgroundColor: T.bg, position: 'relative', overflow: 'hidden', userSelect: 'none' }}>
      {/* Menu bar */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: layout.w, height: layout.menu, backgroundColor: T.panel, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 10 }}>
        {layout.w >= 600 ? (
          <MenuBar open={menu?.name ?? null} onOpen={(m, x) => setMenu(m ? { name: m, x } : null)} onHover={(m, x) => setMenu({ name: m, x })} />
        ) : (
          <IconButton name="search" testId="open-palette" onClick={() => act.palette()} />
        )}
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {layout.w >= 760 ? (
            <div testId="palette-button" onClick={() => act.palette()} style={{ height: 24, paddingLeft: 8, paddingRight: 10, marginRight: 6, gap: 6, borderRadius: 6, borderWidth: 1, borderColor: T.line, display: 'flex', flexDirection: 'row', alignItems: 'center', cursor: 'pointer', hover: { backgroundColor: T.raised } }}>
              <Icon name="search" size={13} color={T.faint} />
              <Label size={11.5} color={T.faint}>⌃K</Label>
            </div>
          ) : null}
          <IconButton testId="undo" name="undo" onClick={() => ed.undo()} disabled={!ed.history.canUndo} />
          <IconButton testId="redo" name="redo" onClick={() => ed.redo()} disabled={!ed.history.canRedo} />
          <div testId="export" onClick={() => actions.exportPng()} style={{ marginLeft: 8, height: 24, paddingLeft: 12, paddingRight: 12, borderRadius: 6, backgroundColor: T.raised, borderWidth: 1, borderColor: T.line, display: 'flex', flexDirection: 'row', alignItems: 'center', cursor: 'pointer', hover: { backgroundColor: T.hover, borderColor: T.lineHi } }}>
            <Label color={T.fg} size={12} weight={500}>Export</Label>
          </div>
        </div>
        {layout.w >= 1000 ? (
          <div style={{ position: 'absolute', left: layout.w / 2 - 170, top: 0, width: 340, height: layout.menu, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
            <Label color={T.fg} size={12.5} weight={600}>{docName}</Label>
            <Label color={T.faint} size={12}>{`${ed.doc.width} × ${ed.doc.height}`}</Label>
          </div>
        ) : null}
      </div>

      {/* Tool options */}
      <div style={{ position: 'absolute', left: 0, top: layout.menu, width: layout.w, height: layout.top - layout.menu, borderTopWidth: 1, borderBottomWidth: 1, borderColor: T.line, backgroundColor: T.panel, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 10, gap: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <Icon name={(ed.xf ? 'transform' : info.icon) as IconName} size={15} color={T.fg} />
          <Label color={T.fg} size={12.5} weight={600}>{ed.xf ? 'Free Transform' : info.label}</Label>
        </div>
        <Divider />
        {toolOptions()}
      </div>

      {/* Tool rail */}
      <div style={{ position: 'absolute', left: 0, top: layout.top, width: layout.rail, height: layout.h - layout.top - layout.status, backgroundColor: T.panel, borderRightWidth: 1, borderColor: T.line, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, gap: 2, overflowY: 'scroll' }}>
        {groups.map((gi) => (
          <div key={gi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            {gi > 0 ? <div style={{ width: 22, height: 1, marginTop: railCompact ? 2 : 4, marginBottom: railCompact ? 2 : 4, backgroundColor: T.line }} /> : null}
            {TOOL_INFO.filter((t) => t.group === gi).map((t) => {
              const on = ed.tool === t.id
              const ty = useRef(0)
              return (
                <div
                  key={t.id}
                  testId={`tool-${t.id}`}
                  onLayout={(e) => (ty.current = e.y ?? 0)}
                  onClick={() => setTool(t.id)}
                  onMouseEnter={() => setTip({ label: t.label, key: t.key, y: ty.current })}
                  onMouseLeave={() => setTip(null)}
                  style={{ width: 34, height: railCompact ? 28 : 31, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: on ? T.hover : undefined, cursor: 'pointer', hover: on ? undefined : { backgroundColor: T.raised } }}
                >
                  <Icon name={t.icon as IconName} color={on ? T.fg : T.faint} size={17} />
                </div>
              )
            })}
          </div>
        ))}
        <div style={{ flexGrow: 1, minHeight: 8 }} />
        <div style={{ width: 40, height: 44, position: 'relative', marginBottom: 8, flexShrink: 0 }}>
          <div testId="bg-swatch" onClick={() => setPicker((p) => !p)} style={{ position: 'absolute', left: 15, top: 16, width: 21, height: 21, borderRadius: 5, backgroundColor: hex(ed.bg), borderWidth: 1, borderColor: T.lineHi, cursor: 'pointer' }} />
          <div testId="fg-swatch" onClick={() => setPicker((p) => !p)} style={{ position: 'absolute', left: 4, top: 5, width: 21, height: 21, borderRadius: 5, backgroundColor: fg, borderWidth: 1.5, borderColor: T.fg, cursor: 'pointer' }} />
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
          pointer.current = null
          setCursor(null)
          present()
        }}
        style={{ position: 'absolute', left: cv.x, top: cv.y, width: cv.w, height: cv.h, cursor: painting() || ed.tool === 'crop' ? 'crosshair' : ed.tool === 'hand' ? 'grab' : ed.tool === 'text' ? 'text' : 'default' }}
      >
        <img ref={img} objectFit="fill" style={{ width: cv.w, height: cv.h }} />
      </div>

      {layout.panel > 0 ? <Panel ed={ed} L={layout} version={version} openBlend={(y, x) => setBlendMenu({ x, y })} openFilter={(k) => openDialog({ kind: 'filter', filter: k })} /> : null}

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

      {tip && !menu && !palette ? (
        <div style={{ position: 'absolute', left: layout.rail + 6, top: tip.y + 3, height: 26, paddingLeft: 10, paddingRight: 10, gap: 10, borderRadius: 6, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'row', alignItems: 'center', pointerEvents: 'none' }}>
          <Label size={12} color={T.fg}>{tip.label}</Label>
          <Label size={11.5} color={T.faint}>{tip.key}</Label>
        </div>
      ) : null}

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

      {menu ? <MenuDropdown ed={ed} menu={menu.name} x={menu.x} y={layout.menu - 2} maxH={layout.h - layout.menu - 8} run={runCommand} close={() => setMenu(null)} /> : null}

      {picker ? <ColorPicker ed={ed} x={layout.rail + 8} y={Math.max(layout.top + 8, layout.h - layout.status - 330)} close={() => setPicker(false)} version={version} /> : null}

      {palette ? (
        <Palette
          x={cv.x + Math.max(12, (cv.w - Math.min(560, cv.w - 24)) / 2)}
          y={cv.y + 36}
          w={Math.min(560, cv.w - 24)}
          query={palette.q}
          results={results}
          sel={palette.sel}
          run={runCommand}
          close={() => setPalette(null)}
          hover={(i) => setPalette({ ...palette, sel: i })}
        />
      ) : null}

      {dialog ? (
        <DialogView
          d={dialog.d}
          s={dialog.s}
          set={setDialogState}
          ed={ed}
          error={dialog.err}
          title={dialog.d.kind === 'filter' ? FILTER_TITLES[dialog.d.filter] : DIALOG_TITLES[dialog.d.kind]}
          x={cv.x + Math.max(12, (cv.w - Math.min(380, cv.w - 24)) / 2)}
          y={cv.y + 36}
          w={Math.min(380, cv.w - 24)}
          apply={applyDialog}
          cancel={cancelDialog}
        />
      ) : null}

      {help ? (
        <div onClick={() => setHelp(false)} style={{ position: 'absolute', left: cv.x + Math.max(12, (cv.w - 560) / 2), top: cv.y + 24, width: Math.min(560, cv.w - 24), padding: 20, borderRadius: 14, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Label size={13.5} color={T.fg} weight={600}>Keyboard Shortcuts</Label>
          {[
            ['V  M  O  L  W  C', 'move · marquee · ellipse · lasso · wand · crop'],
            ['B  E  S  J', 'brush · eraser · clone stamp · spot healing'],
            ['K  G  T  I  H', 'bucket · gradient · type · eyedropper · hand'],
            ['[  ]   X  D', 'brush size · swap colors · default colors'],
            ['1 … 0   +  −   Q', 'opacity · blend mode · layer mask'],
            ['⌃K', 'command palette'],
            ['⌃T  ↩  esc', 'free transform · apply · cancel'],
            ['⌃L  ⌃M  ⌃U  ⌃B', 'levels · curves · hue/saturation · color balance'],
            ['⌃Z  ⌃⇧Z', 'undo · redo'],
            ['⌃J  ⌃⇧N  ⌃⌥E', 'duplicate · new layer · merge down'],
            ['⌃A  ⌃D  ⌃⇧I  ⇧F6', 'select all · deselect · inverse · feather'],
            ['⌃O  ⌃⇧P  ⌃S', 'open · place · save .pcraft'],
            ['⌃E  ⌃⇧E', 'export PNG · JPEG'],
            ['scroll  space-drag  ⌃0  ⌃1', 'zoom · pan · fit · actual pixels'],
            ['⌃C', 'quit'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
              <div style={{ width: 190 }}>
                <Label size={12} color={T.fg} weight={500}>{k!}</Label>
              </div>
              <Label size={12} color={T.dim}>{v!}</Label>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const FILTER_TITLES: Record<FilterKind, string> = { gaussian: 'Gaussian Blur', unsharp: 'Unsharp Mask', motion: 'Motion Blur', noise: 'Add Noise', 'high-pass': 'High Pass', median: 'Median' }
