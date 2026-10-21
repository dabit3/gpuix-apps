import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useGpuixRequired } from '@gpuix/react'
import type { EventPayload, ImgInstance, PublicInstance } from '@gpuix/react'
import { BOOKMARKS, type Bookmark, type Camera, formatCoord, formatZoom } from './camera'
import { type Explorer, type Stats } from './engine'
import { PALETTES, type PaletteId, paletteById, paletteSwatches } from './fractal'

const C = {
  bg: '#0a0b0d',
  panel: '#111215',
  raised: '#1a1c20',
  hover: '#202328',
  line: '#24272c',
  text: '#eceef1',
  dim: '#8d939c',
  faint: '#5d636b',
  accent: '#ffb547',
  chip: '#0b0c0ecc',
}
const MONO = 'Menlo'
const SIDEBAR = 300
const JULIA_W = 300
const JULIA_H = 200
const ITER_MIN = 50
const ITER_MAX = 10000

export const iterToT = (n: number) => Math.log(n / ITER_MIN) / Math.log(ITER_MAX / ITER_MIN)
export const tToIter = (t: number) => Math.round(ITER_MIN * (ITER_MAX / ITER_MIN) ** Math.min(1, Math.max(0, t)))

function near(a: Camera, b: Camera) {
  return Math.abs(Math.log(a.w / b.w)) < 0.08 && Math.hypot(a.re - b.re, a.im - b.im) < b.w * 0.08
}

function Label({ children }: { children: string }) {
  return (
    <text style={{ color: C.faint, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{children.toUpperCase()}</text>
  )
}

function Swatches({ id, width }: { id: PaletteId; width: number }) {
  const cols = paletteSwatches(paletteById(id), 8)
  return (
    <div style={{ display: 'flex', width, height: 10, borderRadius: 3, overflow: 'hidden' }}>
      {cols.map((c, i) => (
        <div key={i} style={{ flexGrow: 1, height: 10, backgroundColor: c }} />
      ))}
    </div>
  )
}

function PaletteSelect({ value, onChange, onClose }: { value: PaletteId; onChange: (id: PaletteId) => void; onClose: () => void }) {
  const items = PALETTES.map((p) => ({ value: p.id, label: p.name }))
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(v as PaletteId)} onOpenChange={(open) => !open && onClose()}>
      <SelectTrigger
        testId="palette-trigger"
        style={(s) => ({
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: SIDEBAR - 40,
          height: 34,
          paddingLeft: 10,
          paddingRight: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: s.open ? '#3a3e45' : C.line,
          backgroundColor: s.open ? C.hover : C.raised,
          cursor: 'pointer',
          // The root keeps keyboard focus for shortcuts; don't dim the trigger while it does.
          keyboardFocusDim: false,
        })}
      >
        <Swatches id={value} width={64} />
        <div style={{ flexGrow: 1, color: C.text, fontSize: 13 }}>
          <SelectValue />
        </div>
        <text style={{ color: C.dim, fontSize: 11 }}>▾</text>
      </SelectTrigger>
      <SelectContent
        sideOffset={6}
        style={{ width: SIDEBAR - 40, padding: 4, backgroundColor: '#17191d', borderRadius: 10, borderWidth: 1, borderColor: '#2c3036' }}
      >
        {PALETTES.map((p) => (
          <SelectItem
            key={p.id}
            value={p.id}
            testId={`palette-${p.id}`}
            style={(s) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 32,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: 6,
              backgroundColor: s.highlighted ? '#262a30' : 'transparent',
              cursor: 'pointer',
            })}
          >
            {(s) => (
              <>
                <Swatches id={p.id} width={64} />
                <text style={{ color: s.selected ? C.accent : C.text, fontSize: 13 }}>{p.name}</text>
              </>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function IterSlider({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const track = useRef({ x: 0, w: 1 })
  const dragging = useRef(false)
  const [trackW, setTrackW] = useState(260)
  const set = (x: number) => onChange(tToIter((x - track.current.x) / track.current.w))
  const t = iterToT(value)
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 8 }}>
        <text style={{ color: C.faint, fontSize: 11, fontWeight: 600, flexGrow: 1 }}>ITERATIONS</text>
        <text testId="iter-value" style={{ color: C.text, fontSize: 12, fontFamily: MONO }}>
          {String(value)}
        </text>
      </div>
      <div
        testId="iter-slider"
        style={{ height: 20, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        onLayout={(e) => {
          track.current = { x: e.x ?? 0, w: Math.max(1, e.width ?? 1) }
          setTrackW(track.current.w)
        }}
        onMouseDown={(e) => {
          dragging.current = true
          set(e.x ?? 0)
        }}
        onMouseMove={(e) => dragging.current && set(e.x ?? 0)}
        onMouseUp={() => (dragging.current = false)}
      >
        <div style={{ position: 'relative', flexGrow: 1, height: 4, borderRadius: 2, backgroundColor: '#2a2d33', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: 4, width: Math.round(t * trackW), borderRadius: 2, backgroundColor: C.accent, pointerEvents: 'none' }} />
          <div
            testId="iter-knob"
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              top: -6,
              left: Math.round(t * trackW) - 8,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: '#f4f5f7',
              boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 4, spreadRadius: 0, color: '#00000088' },
            }}
          />
        </div>
      </div>
    </div>
  )
}

function Thumb({ explorer, bookmark, palette }: { explorer: Explorer; bookmark: Bookmark; palette: PaletteId }) {
  const img = useRef<ImgInstance>(null)
  useLayoutEffect(() => {
    let live = true
    void explorer.thumbnail(bookmark, 56, 40, palette).then((px) => {
      if (live) img.current?.setImagePixels(56, 40, px, { format: 'bgra' })
    })
    return () => {
      live = false
    }
  }, [explorer, bookmark, palette])
  return <img ref={img} objectFit="fill" style={{ width: 56, height: 40, borderRadius: 6, backgroundColor: C.raised }} />
}

function BookmarkRow({ explorer, bookmark, palette, active }: { explorer: Explorer; bookmark: Bookmark; palette: PaletteId; active: boolean }) {
  return (
    <div
      testId={`bookmark-${bookmark.id}`}
      onClick={() => explorer.flyToBookmark(bookmark)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 6,
        borderRadius: 9,
        backgroundColor: active ? '#1f2227' : 'transparent',
        cursor: 'pointer',
        hover: { backgroundColor: active ? '#23262c' : '#17191c' },
      }}
    >
      <Thumb explorer={explorer} bookmark={bookmark} palette={palette} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
        <text style={{ color: active ? C.accent : C.text, fontSize: 13, fontWeight: 500 }}>{bookmark.name}</text>
        <text style={{ color: C.dim, fontSize: 11, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{bookmark.note}</text>
      </div>
    </div>
  )
}

function Readout({ label, value, testId, color = C.text }: { label: string; value: string; testId?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', height: 18 }}>
      <text style={{ color: C.faint, fontSize: 11, width: 52 }}>{label}</text>
      <text testId={testId} style={{ color, fontSize: 11, fontFamily: MONO }}>
        {value}
      </text>
    </div>
  )
}

function Chip({ children, testId }: { children: string; testId?: string }) {
  return (
    <div style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 7, backgroundColor: C.chip }}>
      <text testId={testId} style={{ color: '#d9dce1', fontSize: 11, fontFamily: MONO }}>
        {children}
      </text>
    </div>
  )
}

function phaseLabel(s: Stats) {
  if (s.flightTo) return `Flying to ${s.flightTo}`
  if (s.phase === 'pan') return 'Panning'
  if (s.phase === 'refine') return 'Refining'
  if (s.phase === 'preview' || (s.phase !== 'idle' && s.scale > 1)) return `Preview 1/${s.scale}`
  return 'Sharp'
}

export interface FractalAppProps {
  explorer: Explorer
  /** Where S writes PNGs. Defaults to ~/Desktop. */
  saveDir?: string
}

export function FractalApp({ explorer, saveDir }: FractalAppProps) {
  const [s, setS] = useState<Stats>(() => explorer.stats())
  const [toast, setToast] = useState<string | null>(null)
  const mainImg = useRef<ImgInstance>(null)
  const juliaImg = useRef<ImgInstance>(null)
  const rootRef = useRef<PublicInstance>(null)
  const renderer = useGpuixRequired()
  const view = useRef({ x: SIDEBAR, y: 0 })
  const hover = useRef({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => explorer.subscribe(setS), [explorer])
  useLayoutEffect(() => {
    explorer.attachMain(mainImg.current)
    explorer.attachJulia(juliaImg.current, JULIA_W, JULIA_H)
    return () => {
      explorer.attachMain(null)
      explorer.attachJulia(null, JULIA_W, JULIA_H)
    }
  }, [explorer])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const local = (e: EventPayload) => ({ x: (e.x ?? 0) - view.current.x, y: (e.y ?? 0) - view.current.y })

  const save = () => {
    setToast('Saving…')
    explorer
      .savePng(saveDir)
      .then((p) => setToast(`Saved ${p.split('/').pop()} to ${saveDir ? saveDir : 'Desktop'}`))
      .catch((err) => setToast(`Save failed: ${String(err)}`))
  }

  // A closed Select keeps focus and opens again on arrow keys, so hand focus back to the shortcut root.
  const refocus = () =>
    setTimeout(() => {
      if (rootRef.current) renderer.focusElement?.(rootRef.current.id)
    }, 0)

  const onKey = (e: EventPayload) => {
    if (e.modifiers?.cmd || e.modifiers?.ctrl) return
    const key = (e.key ?? '').toLowerCase()
    const ch = e.keyChar ?? ''
    const step = e.modifiers?.shift ? 0.35 : 0.12
    if (key === 'left') explorer.nudge(-step, 0)
    else if (key === 'right') explorer.nudge(step, 0)
    else if (key === 'up') explorer.nudge(0, step)
    else if (key === 'down') explorer.nudge(0, -step)
    else if (ch === '+' || key === '=' || key === '+') explorer.zoomBy(2)
    else if (ch === '-' || key === '-' || ch === '_') explorer.zoomBy(0.5)
    else if (key === 'r') explorer.reset()
    else if (key === 's') save()
  }

  const active = BOOKMARKS.find((b) => near(s.cam, b.cam))
  const c = s.julia

  return (
    <div
      testId="app"
      ref={rootRef}
      autoFocus
      tabIndex={0}
      onKeyDown={onKey}
      style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: C.bg }}
    >
      {/* Sidebar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: SIDEBAR,
          flexShrink: 0,
          height: '100%',
          paddingTop: 48,
          paddingLeft: 20,
          paddingRight: 20,
          paddingBottom: 18,
          gap: 22,
          backgroundColor: C.panel,
          borderRightWidth: 1,
          borderColor: C.line,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <text style={{ color: C.text, fontSize: 18, fontWeight: 600 }}>Fractal Explorer</text>
          <text style={{ color: C.dim, fontSize: 12 }}>{`Mandelbrot · Julia · ${s.threads} render threads`}</text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Label>Palette</Label>
          <PaletteSelect value={s.palette} onChange={(id) => explorer.setPalette(id)} onClose={refocus} />
        </div>
        <IterSlider value={s.maxIter} onChange={(n) => explorer.setMaxIter(n)} />
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Label>Locations</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: -6, marginRight: -6 }}>
            {BOOKMARKS.map((b) => (
              <BookmarkRow key={b.id} explorer={explorer} bookmark={b} palette={s.palette} active={active?.id === b.id || s.flightTo === b.name} />
            ))}
          </div>
        </div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Label>Coordinates</Label>
          <Readout label="Re" value={formatCoord(s.cam.re, s.cam.w)} testId="readout-re" />
          <Readout label="Im" value={formatCoord(s.cam.im, s.cam.w)} testId="readout-im" />
          <Readout label="Zoom" value={formatZoom(s.cam.w)} testId="readout-zoom" color={C.accent} />
          <Readout label="Julia c" value={`${c.re.toFixed(5)} ${c.im < 0 ? '−' : '+'} ${Math.abs(c.im).toFixed(5)}i`} testId="readout-c" />
        </div>
        <text style={{ color: C.faint, fontSize: 11, lineHeight: 16 }}>
          Drag to pan · scroll or double-click to zoom · arrows, + / −, R reset, S save PNG
        </text>
      </div>

      {/* Viewport */}
      <div
        testId="view"
        style={{ position: 'relative', flexGrow: 1, height: '100%', minWidth: 0, overflow: 'hidden', cursor: drag.current ? 'grabbing' : 'crosshair' }}
        onLayout={(e) => {
          view.current = { x: e.x ?? SIDEBAR, y: e.y ?? 0 }
          explorer.setView(e.width ?? 0, e.height ?? 0)
        }}
        onMouseDown={(e) => {
          const p = local(e)
          if ((e.clickCount ?? 1) >= 2) {
            drag.current = null
            explorer.zoomAt(p.x, p.y, e.modifiers?.shift ? 1 / 3 : 3, true)
            return
          }
          drag.current = p
        }}
        onMouseMove={(e) => {
          const p = local(e)
          hover.current = p
          const d = drag.current
          if (d) {
            const dx = Math.round(p.x - d.x)
            const dy = Math.round(p.y - d.y)
            if (dx || dy) {
              explorer.panPixels(dx, dy)
              drag.current = { x: d.x + dx, y: d.y + dy }
            }
          }
          explorer.setCursor(p.x, p.y)
        }}
        onMouseUp={() => (drag.current = null)}
        onScroll={(e) => {
          const dy = e.deltaY ?? 0
          // Line wheels arrive as 20 px per notch; one notch zooms ~1.27x.
          const log2 = dy * (e.precise ? 0.006 : 0.0175)
          const p = e.x != null && e.y != null ? local(e) : hover.current
          if (log2) explorer.wheelZoom(p.x, p.y, log2)
        }}
      >
        <img ref={mainImg} testId="mandelbrot" objectFit="fill" style={{ width: '100%', height: '100%' }} />

        <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', gap: 6, pointerEvents: 'none' }}>
          <Chip testId="hud-phase">{phaseLabel(s)}</Chip>
          <Chip testId="hud-fps">{`${String(s.fps).padStart(2, ' ')} fps`}</Chip>
          <Chip testId="hud-render">{`${s.renderMs.toFixed(1)} ms full · ${s.previewMs.toFixed(1)} ms preview`}</Chip>
          <Chip>{`${(s.mips / 1000).toFixed(2)} G it/s`}</Chip>
        </div>

        <div style={{ position: 'absolute', left: 16, bottom: 16, pointerEvents: 'none' }}>
          <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 9, backgroundColor: C.chip }}>
            <text style={{ color: '#f2f3f5', fontSize: 15, fontWeight: 600, fontFamily: MONO }}>{formatZoom(s.cam.w)}</text>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 12,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: '#ffffff26',
            backgroundColor: '#000000',
            pointerEvents: 'none',
            boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: '#00000099' },
          }}
        >
          <img ref={juliaImg} testId="julia" objectFit="fill" style={{ width: JULIA_W, height: JULIA_H }} />
          <div style={{ display: 'flex', alignItems: 'center', height: 28, paddingLeft: 10, paddingRight: 10, backgroundColor: '#0d0e10' }}>
            <text style={{ color: C.dim, fontSize: 11, flexGrow: 1 }}>Julia set</text>
            <text style={{ color: '#d9dce1', fontSize: 11, fontFamily: MONO }}>{`c = ${c.re.toFixed(4)} ${c.im < 0 ? '−' : '+'} ${Math.abs(c.im).toFixed(4)}i`}</text>
          </div>
        </div>

        {toast ? (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 16, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8, borderRadius: 9, backgroundColor: '#1d2024ee' }}>
              <text testId="toast" style={{ color: C.text, fontSize: 12 }}>
                {toast}
              </text>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
