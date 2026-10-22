// Menu bar, command palette, dialogs, color picker and the Levels editor.
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { EventPayload, ImgInstance } from '@gpuix/react'
import { levelsLut, type Adjust } from '../core/adjust'
import type { Editor } from '../core/editor'
import { Button, Divider, Icon, Kbd, Label, Slider } from './atoms'
import { COMMANDS, MENUS, type Command, type Dialog, type MenuName } from './commands'
import { hex, rgb, SWATCHES, T } from './theme'

type Ev = EventPayload

// ---------- menu bar ----------

export function MenuBar({ open, onOpen, onHover }: { open: MenuName | null; onOpen: (m: MenuName | null, x: number) => void; onHover: (m: MenuName, x: number) => void }) {
  const xs = useRef<Record<string, number>>({})
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 1, flexShrink: 0 }}>
      {MENUS.map((m) => (
        <div
          key={m}
          testId={`menu-${m}`}
          onLayout={(e) => (xs.current[m] = e.x ?? 0)}
          onClick={() => onOpen(open === m ? null : m, xs.current[m] ?? 0)}
          onMouseEnter={() => open && open !== m && onHover(m, xs.current[m] ?? 0)}
          style={{ height: 24, paddingLeft: 9, paddingRight: 9, borderRadius: 6, display: 'flex', alignItems: 'center', backgroundColor: open === m ? T.hover : undefined, cursor: 'pointer', hover: { backgroundColor: open === m ? T.hover : T.raised } }}
        >
          <Label size={12.5} color={open === m ? T.fg : T.dim} weight={500}>{m}</Label>
        </div>
      ))}
    </div>
  )
}

export function MenuDropdown({ ed, menu, x, y, maxH, run, close }: { ed: Editor; menu: MenuName; x: number; y: number; maxH: number; run: (c: Command) => void; close: () => void }) {
  const items = COMMANDS.filter((c) => c.menu === menu && !c.paletteOnly)
  return (
    <div
      testId="menu-dropdown"
      onMouseDownOutside={close}
      style={{ position: 'absolute', left: x, top: y, width: 268, maxHeight: maxH, overflowY: 'scroll', padding: 5, borderRadius: 10, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'column', boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 30, spreadRadius: 0, color: '#00000099' }] }}
    >
      {items.map((c, i) => {
        const on = !c.enabled || c.enabled(ed)
        return (
          <div key={c.id} style={{ display: 'flex', flexDirection: 'column' }}>
            {c.sep && i > 0 ? <div style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: 8, marginRight: 8, backgroundColor: T.line }} /> : null}
            <div
              testId={`cmd-${c.id}`}
              onClick={on ? () => run(c) : undefined}
              style={{ height: 26, borderRadius: 6, paddingLeft: 10, paddingRight: 10, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', cursor: on ? 'pointer' : 'default', hover: on ? { backgroundColor: T.hover } : undefined }}
            >
              <Label size={12.5} color={on ? T.fg : T.faint} weight={400}>{c.label}</Label>
              {c.keys ? <Kbd k={c.keys} /> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- text field (keys are routed by the app; this only draws) ----------

export function Field({ value, placeholder, width, icon, testId }: { value: string; placeholder: string; width?: number; icon?: 'search'; testId?: string }) {
  return (
    <div testId={testId} style={{ width, height: 34, borderRadius: 8, paddingLeft: 10, paddingRight: 10, gap: 8, backgroundColor: T.bg, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }}>
      {icon ? <Icon name={icon} size={15} color={T.faint} /> : null}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
        {value ? <Label size={13} color={T.fg} weight={400} clip>{value}</Label> : null}
        <div style={{ width: 1.5, height: 16, marginLeft: 1, backgroundColor: T.fg, flexShrink: 0 }} />
        {value ? null : <Label size={13} color={T.faint} weight={400}>{` ${placeholder}`}</Label>}
      </div>
    </div>
  )
}

// ---------- command palette ----------

export function Palette({ x, y, w, query, results, sel, run, close, hover }: { x: number; y: number; w: number; query: string; results: Command[]; sel: number; run: (c: Command) => void; close: () => void; hover: (i: number) => void }) {
  const shown = results.slice(0, 9)
  return (
    <div testId="palette" onMouseDownOutside={close} style={{ position: 'absolute', left: x, top: y, width: w, padding: 8, borderRadius: 14, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: [{ offsetX: 0, offsetY: 18, blurRadius: 48, spreadRadius: 0, color: '#000000aa' }] }}>
      <Field value={query} placeholder="Search commands, tools and adjustments" icon="search" testId="palette-input" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {shown.length ? (
          shown.map((c, i) => (
            <div
              key={c.id}
              testId={`palette-${c.id}`}
              onClick={() => run(c)}
              onMouseEnter={() => hover(i)}
              style={{ height: 32, borderRadius: 7, paddingLeft: 10, paddingRight: 10, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: i === sel ? T.hover : undefined, cursor: 'pointer' }}
            >
              <Label size={13} color={T.fg} weight={i === sel ? 500 : 400}>{c.label}</Label>
              <Label size={11.5} color={T.faint}>{c.paletteOnly ? 'Tool' : c.menu}</Label>
              <div style={{ flexGrow: 1 }} />
              {c.keys ? <Kbd k={c.keys} /> : null}
            </div>
          ))
        ) : (
          <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Label size={12.5} color={T.faint}>No matching commands</Label>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 14, paddingLeft: 6, paddingTop: 2 }}>
        <Kbd k="↑↓ navigate" />
        <Kbd k="↩ run" />
        <Kbd k="esc close" />
      </div>
    </div>
  )
}

// ---------- dialogs ----------

export interface DialogState {
  value: number
  text: string
}

export const DIALOG_TITLES: Record<Dialog['kind'], string> = { feather: 'Feather Selection', resize: 'Image Size', rename: 'Rename Layer', open: 'Open', place: 'Place Image', filter: '' }

export function DialogView({ d, s, set, ed, title, x, y, w, apply, cancel, error }: { d: Dialog; s: DialogState; set: (s: DialogState) => void; ed: Editor; title: string; x: number; y: number; w: number; apply: () => void; cancel: () => void; error?: string }) {
  let body: ReactNode = null
  if (d.kind === 'feather') body = <Slider testId="dialog-slider" label="Radius" value={s.value} min={1} max={120} format={(v) => `${v} px`} onChange={(v) => set({ ...s, value: v })} />
  else if (d.kind === 'resize') {
    const nw = Math.max(1, Math.round((ed.doc.width * s.value) / 100))
    const nh = Math.max(1, Math.round((ed.doc.height * s.value) / 100))
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Slider testId="dialog-slider" label="Scale" value={s.value} min={10} max={200} format={(v) => `${v}%`} onChange={(v) => set({ ...s, value: v })} />
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
          <Label size={12} color={T.faint}>{`${ed.doc.width} × ${ed.doc.height}`}</Label>
          <Label size={12} color={T.fg}>{`${nw} × ${nh} px`}</Label>
        </div>
      </div>
    )
  } else if (d.kind === 'filter') {
    const spec = FILTER_SPEC[d.filter]!
    body = <Slider testId="dialog-slider" label={spec.label} value={s.value} min={spec.min} max={spec.max} format={spec.fmt} onChange={(v) => set({ ...s, value: v })} />
  } else body = <Field value={s.text} placeholder={d.kind === 'rename' ? 'Layer name' : 'Path to an image, e.g. samples/lake.jpg'} testId="dialog-field" />
  return (
    <div testId="dialog" style={{ position: 'absolute', left: x, top: y, width: w, padding: 18, borderRadius: 14, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: [{ offsetX: 0, offsetY: 18, blurRadius: 48, spreadRadius: 0, color: '#000000aa' }] }}>
      <Label size={13.5} color={T.fg} weight={600}>{title}</Label>
      {body}
      {error ? <Label size={11.5} color={T.red}>{error}</Label> : null}
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        <Button label="Cancel" onClick={cancel} width={78} testId="dialog-cancel" />
        <Button label={d.kind === 'open' ? 'Open' : d.kind === 'place' ? 'Place' : d.kind === 'rename' ? 'Rename' : 'Apply'} primary onClick={apply} width={78} testId="dialog-apply" />
      </div>
    </div>
  )
}

export const FILTER_SPEC: Record<string, { label: string; min: number; max: number; fmt: (v: number) => string }> = {
  gaussian: { label: 'Radius', min: 1, max: 40, fmt: (v) => `${v} px` },
  unsharp: { label: 'Radius', min: 1, max: 20, fmt: (v) => `${v} px` },
  motion: { label: 'Distance', min: 2, max: 120, fmt: (v) => `${v} px` },
  noise: { label: 'Amount', min: 1, max: 60, fmt: (v) => `${v}%` },
  'high-pass': { label: 'Radius', min: 1, max: 40, fmt: (v) => `${v} px` },
  median: { label: 'Radius', min: 1, max: 8, fmt: (v) => `${v} px` },
}

// ---------- color picker ----------

export function rgbToHsv([r, g, b]: number[]): [number, number, number] {
  r! /= 255
  g! /= 255
  b! /= 255
  const mx = Math.max(r!, g!, b!)
  const mn = Math.min(r!, g!, b!)
  const d = mx - mn
  let h = 0
  if (d) h = mx === r ? ((g! - b!) / d + 6) % 6 : mx === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4
  return [h / 6, mx ? d / mx : 0, mx]
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6]!
  return [Math.round(r! * 255), Math.round(g! * 255), Math.round(b! * 255)]
}

/** Saturation/brightness square, hue strip, hex readout and swatches. Edits the foreground or background color. */
export function ColorPicker({ ed, x, y, close, version }: { ed: Editor; x: number; y: number; close: () => void; version: number }) {
  const W = 216
  const H = 140
  const sv = useRef<ImgInstance>(null)
  const hue = useRef<ImgInstance>(null)
  const target = useRef<'fg' | 'bg'>('fg')
  const hsvRef = useRef(rgbToHsv(ed.fg))
  const boxSv = useRef({ x: 0, y: 0 })
  const boxHue = useRef({ x: 0 })
  const cur = target.current === 'fg' ? ed.fg : ed.bg
  // Keep hue stable when the color is gray (hue undefined).
  const [h0, s0, v0] = rgbToHsv(cur)
  const hsv = hsvRef.current
  if (hex(hsvToRgb(hsv[0], hsv[1], hsv[2])) !== hex(cur)) hsvRef.current = [s0 > 0 && v0 > 0 ? h0 : hsv[0], s0, v0]
  const [h, s, v] = hsvRef.current
  useLayoutEffect(() => {
    const out = new Uint8Array(W * H * 4)
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) {
        const c = hsvToRgb(h, xx / (W - 1), 1 - yy / (H - 1))
        const o = (yy * W + xx) * 4
        out[o] = c[0]
        out[o + 1] = c[1]
        out[o + 2] = c[2]
        out[o + 3] = 255
      }
    const cx = Math.round(s * (W - 1))
    const cy = Math.round((1 - v) * (H - 1))
    for (let a = 0; a < 48; a++) {
      const t = (a / 48) * Math.PI * 2
      for (const [r, col] of [[6, 255], [7, 0]] as const) {
        const px = Math.round(cx + Math.cos(t) * r)
        const py = Math.round(cy + Math.sin(t) * r)
        if (px < 0 || py < 0 || px >= W || py >= H) continue
        const o = (py * W + px) * 4
        out[o] = out[o + 1] = out[o + 2] = col
      }
    }
    sv.current?.setImagePixels(W, H, out)
    const HH = 12
    const hb = new Uint8Array(W * HH * 4)
    const hx = Math.round(h * (W - 1))
    for (let yy = 0; yy < HH; yy++)
      for (let xx = 0; xx < W; xx++) {
        const c = hsvToRgb(xx / W, 1, 1)
        const o = (yy * W + xx) * 4
        const mark = Math.abs(xx - hx) <= 1
        hb[o] = mark ? 255 : c[0]
        hb[o + 1] = mark ? 255 : c[1]
        hb[o + 2] = mark ? 255 : c[2]
        hb[o + 3] = 255
        if (Math.abs(xx - hx) === 2) hb[o] = hb[o + 1] = hb[o + 2] = 0
      }
    hue.current?.setImagePixels(W, HH, hb)
  }, [h, s, v, version])
  const apply = (c: [number, number, number]) => {
    if (target.current === 'fg') ed.fg = c
    else ed.bg = c
    ed.emit()
  }
  const setSv = (e: Ev) => {
    const ns = Math.min(1, Math.max(0, ((e.x ?? 0) - boxSv.current.x) / W))
    const nv = Math.min(1, Math.max(0, 1 - ((e.y ?? 0) - boxSv.current.y) / H))
    hsvRef.current = [h, ns, nv]
    apply(hsvToRgb(h, ns, nv))
  }
  const setHue = (e: Ev) => {
    const nh = Math.min(0.999, Math.max(0, ((e.x ?? 0) - boxHue.current.x) / W))
    hsvRef.current = [nh, s, v]
    apply(hsvToRgb(nh, s, v))
  }
  const Well = ({ which }: { which: 'fg' | 'bg' }) => (
    <div
      testId={`picker-${which}`}
      onClick={() => {
        target.current = which
        hsvRef.current = rgbToHsv(which === 'fg' ? ed.fg : ed.bg)
        ed.emit()
      }}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, height: 26, paddingLeft: 4, paddingRight: 8, borderRadius: 6, backgroundColor: target.current === which ? T.hover : undefined, cursor: 'pointer' }}
    >
      <div style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: T.lineHi, backgroundColor: hex(which === 'fg' ? ed.fg : ed.bg) }} />
      <Label size={11.5} color={target.current === which ? T.fg : T.dim}>{which === 'fg' ? 'Foreground' : 'Background'}</Label>
    </div>
  )
  return (
    <div testId="color-picker" onMouseDownOutside={close} style={{ position: 'absolute', left: x, top: y, width: W + 24, padding: 12, borderRadius: 12, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineHi, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 36, spreadRadius: 0, color: '#000000aa' }] }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
        <Well which="fg" />
        <Well which="bg" />
      </div>
      <div style={{ position: 'relative', width: W, height: H }}>
        <img ref={sv} objectFit="fill" style={{ width: W, height: H, borderRadius: 6 }} />
        <div testId="picker-sv" onLayout={(e) => (boxSv.current = { x: e.x ?? 0, y: e.y ?? 0 })} onMouseDown={setSv} onMouseMove={(e) => e.pressedButton != null && setSv(e)} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, cursor: 'crosshair' }} />
      </div>
      <div style={{ position: 'relative', width: W, height: 12 }}>
        <img ref={hue} objectFit="fill" style={{ width: W, height: 12, borderRadius: 6 }} />
        <div testId="picker-hue" onLayout={(e) => (boxHue.current = { x: e.x ?? 0 })} onMouseDown={setHue} onMouseMove={(e) => e.pressedButton != null && setHue(e)} style={{ position: 'absolute', left: 0, top: -4, width: W, height: 20, cursor: 'pointer' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label size={12} color={T.fg} weight={500}>{hex(cur).toUpperCase()}</Label>
        <Label size={11.5} color={T.faint}>{`${cur[0]}  ${cur[1]}  ${cur[2]}`}</Label>
      </div>
      <Divider h={0} />
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {SWATCHES.map((c) => (
          <div key={c} testId={`swatch-${c.slice(1)}`} onClick={() => apply(rgb(c))} style={{ width: 13 * 2 + 1, height: 18, borderRadius: 4, backgroundColor: c, borderWidth: 1, borderColor: c === hex(cur) ? T.fg : T.line, cursor: 'pointer' }} />
        ))}
      </div>
    </div>
  )
}

// ---------- levels ----------

export function LevelsEditor({ ed, adjust, version, width }: { ed: Editor; adjust: Extract<Adjust, { kind: 'levels' }>; version: number; width: number }) {
  const W = width
  const HH = 92
  const TRACK = 16
  const H = HH + TRACK
  const img = useRef<ImgInstance>(null)
  const box = useRef({ x: 0 })
  const drag = useRef<'inBlack' | 'gamma' | 'inWhite' | null>(null)
  const gx = adjust.inBlack + (adjust.inWhite - adjust.inBlack) * Math.pow(0.5, adjust.gamma)
  useLayoutEffect(() => {
    const out = new Uint8Array(W * H * 4)
    const hist = new Float32Array(W)
    const c = ed.comp
    const step = Math.max(1, Math.floor(c.length / 4 / 60000)) * 4
    for (let q = 0; q < c.length; q += step) hist[Math.min(W - 1, Math.floor(((0.3 * c[q]! + 0.59 * c[q + 1]! + 0.11 * c[q + 2]!) / 256) * W))]!++
    const sm = hist.map((_, i) => (hist[i - 1] ?? hist[i]!) * 0.25 + hist[i]! * 0.5 + (hist[i + 1] ?? hist[i]!) * 0.25)
    const hmax = Math.max(...sm) || 1
    const lut = levelsLut(adjust)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4
        let v = y < HH ? 13 : 22
        if (y < HH) {
          const t = x / (W - 1)
          const inside = t >= adjust.inBlack && t <= adjust.inWhite
          if (HH - y < Math.sqrt(sm[x]! / hmax) * HH * 0.92) v = inside ? 92 : 46
          const cy = Math.round((1 - lut[Math.round(t * 255)]!) * (HH - 1))
          if (Math.abs(y - cy) <= 0) v = 200
        }
        out[o] = out[o + 1] = out[o + 2] = v
        out[o + 3] = 255
      }
    const tri = (cx: number, fill: number) => {
      const px = Math.round(cx * (W - 1))
      for (let dy = 0; dy < 10; dy++)
        for (let dx = -dy * 0.6 - 1; dx <= dy * 0.6 + 1; dx++) {
          const xx = Math.round(px + dx)
          const yy = HH + 3 + dy
          if (xx < 0 || xx >= W) continue
          const o = (yy * W + xx) * 4
          const edge = Math.abs(dx) > dy * 0.6 - 0.5 || dy === 9
          out[o] = out[o + 1] = out[o + 2] = edge ? 200 : fill
        }
    }
    tri(adjust.inBlack, 10)
    tri(gx, 128)
    tri(adjust.inWhite, 245)
    img.current?.setImagePixels(W, H, out)
  }, [version, adjust, width])
  const pos = (e: Ev) => Math.min(1, Math.max(0, ((e.x ?? 0) - box.current.x) / W))
  const update = (e: Ev) => {
    const p = pos(e)
    const a = { ...adjust }
    if (drag.current === 'inBlack') a.inBlack = Math.min(p, a.inWhite - 0.04)
    else if (drag.current === 'inWhite') a.inWhite = Math.max(p, a.inBlack + 0.04)
    else if (drag.current === 'gamma') {
      const t = Math.min(0.97, Math.max(0.03, (p - a.inBlack) / (a.inWhite - a.inBlack)))
      a.gamma = Math.round((Math.log(t) / Math.log(0.5)) * 100) / 100
    }
    ed.setAdjust(a)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative', width: W, height: H }}>
        <img ref={img} objectFit="fill" style={{ width: W, height: H, borderRadius: 6 }} />
        <div
          testId="levels-editor"
          onLayout={(e) => (box.current = { x: e.x ?? 0 })}
          onMouseDown={(e) => {
            const p = pos(e)
            const ds = [['inBlack', adjust.inBlack], ['gamma', gx], ['inWhite', adjust.inWhite]] as const
            drag.current = ds.reduce((b, d) => (Math.abs(d[1] - p) < Math.abs(b[1] - p) ? d : b))[0]
            update(e)
          }}
          onMouseMove={(e) => drag.current && e.pressedButton != null && update(e)}
          onMouseUp={() => (drag.current = null)}
          style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, cursor: 'ew-resize' }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
        <Label size={11} color={T.dim}>{String(Math.round(adjust.inBlack * 255))}</Label>
        <Label size={11} color={T.fg}>{adjust.gamma.toFixed(2)}</Label>
        <Label size={11} color={T.dim}>{String(Math.round(adjust.inWhite * 255))}</Label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
        <Slider label="Output black" value={Math.round(adjust.outBlack * 255)} min={0} max={254} onChange={(v) => ed.setAdjust({ ...adjust, outBlack: Math.min(v / 255, adjust.outWhite - 0.02) })} />
        <Slider label="Output white" value={Math.round(adjust.outWhite * 255)} min={1} max={255} onChange={(v) => ed.setAdjust({ ...adjust, outWhite: Math.max(v / 255, adjust.outBlack + 0.02) })} />
      </div>
    </div>
  )
}
