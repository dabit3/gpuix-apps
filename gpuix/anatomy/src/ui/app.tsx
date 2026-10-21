import { render, useWindowSize, type ImgInstance, type KeyEvent } from '@gpuix/react'
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { alpha, mix, type Theme } from '../theme'
import { SPEEDS, type Viewer } from './viewer'

const MONO = 'Menlo'
type Box = { x: number; y: number; width: number; height: number }

function useViewer(v: Viewer, hz = 8) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => v.subscribe(bump), [v])
  useEffect(() => { const id = setInterval(bump, 1000 / hz); return () => clearInterval(id) }, [hz])
}

const isShift = (m: unknown) => (typeof m === 'string' ? m.includes('shift') : !!(m as { shift?: boolean } | undefined)?.shift)

/** Plain-key name: terminal mode may report letters as key "space" with the real character in keyChar. */
export function keyName(e: { key?: string; keyChar?: string }): string {
  const c = e.keyChar
  if (c && c.length === 1 && c !== ' ' && (e.key === 'space' || e.key?.length === 1 || !e.key)) return c.toLowerCase()
  return (e.key ?? '').toLowerCase()
}

function Viewport({ v, theme }: { v: Viewer; theme: Theme }) {
  const img = useRef<ImgInstance>(null)
  const box = useRef<Box>({ x: 0, y: 0, width: 0, height: 0 })
  const drag = useRef<{ x: number; y: number; moved: number; pan: boolean } | null>(null)
  const [label, setLabel] = useState<{ x: number; y: number; text: string } | null>(null)

  useLayoutEffect(() => {
    let alive = true, last = performance.now()
    const loop = () => {
      if (!alive) return
      const now = performance.now()
      v.tick(Math.min(0.1, (now - last) / 1000))
      last = now
      const b = box.current
      if (b.width > 8 && b.height > 8) {
        const f = v.frame(b.width, b.height)
        if (f) img.current?.setImagePixels(f.w, f.h, f.rgba, { format: 'rgba' })
      }
      setTimeout(loop, Math.max(1, 16 - (performance.now() - now)))
    }
    loop()
    return () => { alive = false }
  }, [v])

  const local = (e: { x?: number; y?: number }) => ({ x: (e.x ?? 0) - box.current.x, y: (e.y ?? 0) - box.current.y })
  const hoverAt = (x: number, y: number) => {
    const i = v.pick(x, y, box.current.width, box.current.height)
    v.setHover(i)
    setLabel(i >= 0 ? { x, y, text: v.scene.parts[i]!.part.label } : null)
  }

  return (
    <div
      style={{ display: 'flex', flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden', backgroundColor: theme.bg }}
      onLayout={(e) => { box.current = { x: e.x ?? 0, y: e.y ?? 0, width: e.width ?? 0, height: e.height ?? 0 } }}
      onMouseDown={(e) => { const p = local(e); drag.current = { ...p, moved: 0, pan: e.button !== 0 || isShift(e.modifiers) } }}
      onMouseMove={(e) => {
        const p = local(e), d = drag.current
        if (d && e.pressedButton !== undefined && e.pressedButton !== null) {
          const dx = p.x - d.x, dy = p.y - d.y
          d.moved += Math.abs(dx) + Math.abs(dy)
          if (d.pan) v.pan(dx, dy, box.current.height); else v.orbit(dx, dy)
          d.x = p.x; d.y = p.y
          setLabel(null)
        } else { drag.current = null; hoverAt(p.x, p.y) }
      }}
      onMouseUp={(e) => {
        const d = drag.current
        drag.current = null
        if (!d || d.moved > 5) return
        const p = local(e)
        const i = v.pick(p.x, p.y, box.current.width, box.current.height)
        if ((e.clickCount ?? 1) >= 2 && i >= 0) v.focus(i)
        else v.select(i)
      }}
      onMouseLeave={() => { v.setHover(-1); setLabel(null) }}
      onScroll={(e) => v.zoom(Math.exp((e.deltaY ?? 0) * (e.precise ? -0.004 : -0.12)))}
    >
      <img ref={img} objectFit="fill" testId="viewport" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} />
      {label && (
        <div style={{ position: 'absolute', left: label.x + 14, top: label.y + 12, display: 'flex', paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 6, backgroundColor: alpha(theme.panel, 0.92), borderWidth: 1, borderColor: theme.line, pointerEvents: 'none' }}>
          <text style={{ color: theme.fg, fontSize: 12, fontFamily: MONO }}>{label.text}</text>
        </div>
      )}
    </div>
  )
}

function Tree({ v, theme }: { v: Viewer; theme: Theme }) {
  const rows = v.scene.parts
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: 'scroll', paddingTop: 4, paddingBottom: 8 }}>
      {rows.map((sp) => {
        const sel = sp.index === v.selected, hov = sp.index === v.hover
        return (
          <div
            key={sp.part.id}
            testId={`tree-${sp.part.id}`}
            style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 22, flexShrink: 0, paddingLeft: 12 + Math.min(sp.depth, 6) * 12, paddingRight: 10, backgroundColor: sel ? alpha(theme.accent, 0.18) : hov ? alpha(theme.fg, 0.06) : 'transparent', cursor: 'pointer' }}
            onClick={(e) => ((e.clickCount ?? 1) >= 2 ? v.focus(sp.index) : v.select(sel ? -1 : sp.index))}
            onMouseEnter={() => v.setHover(sp.index)}
          >
            <text style={{ color: sel ? theme.accent : sp.children.length ? theme.fg : theme.dim, fontSize: 12, fontFamily: MONO }}>{`${sp.children.length ? '▾' : '·'} ${sp.part.label}`}</text>
          </div>
        )
      })}
    </div>
  )
}

function Row({ k, val, theme, color }: { k: string; val: string; theme: Theme; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', height: 18 }}>
      <text style={{ color: theme.faint, fontSize: 12, fontFamily: MONO }}>{k}</text>
      <text style={{ color: color ?? theme.fg, fontSize: 12, fontFamily: MONO }}>{val}</text>
    </div>
  )
}

function Inspector({ v, theme }: { v: Viewer; theme: Theme }) {
  const i = v.selected
  if (i < 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 14, borderTopWidth: 1, borderColor: theme.line, flexShrink: 0 }}>
        <text style={{ color: theme.dim, fontSize: 12 }}>Click a part, or use ↑ ↓ to walk the tree.</text>
      </div>
    )
  }
  const sp = v.scene.parts[i]!, p = sp.part, s = v.partState(i)
  const note = v.spec.annotations?.find((a) => a.part === p.id)?.text
  const geo = p.geometry
  const geoText = geo.type === 'gear' ? `gear z=${geo.teeth} m=${geo.module}` : geo.type === 'spring' ? `spring ${geo.turns} turns` : geo.type
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 14, borderTopWidth: 1, borderColor: theme.line, flexShrink: 0 }}>
      <text style={{ color: theme.accent, fontSize: 14, fontWeight: 600 }}>{p.label}</text>
      <text style={{ color: theme.dim, fontSize: 12, lineHeight: 17 }}>{p.description}</text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 6 }}>
        <Row k="motion" val={s.kind} theme={theme} />
        {s.rpm !== undefined && <Row k="rpm" val={Math.abs(s.rpm) >= 100 ? Math.round(s.rpm).toLocaleString('en-US') : s.rpm.toFixed(2)} theme={theme} color={theme.good} />}
        {s.angleDeg !== undefined && <Row k="phase" val={`${s.angleDeg.toFixed(0).padStart(3, ' ')}°`} theme={theme} />}
        {s.offset !== undefined && <Row k="offset" val={s.offset.toFixed(2)} theme={theme} color={theme.warn} />}
        <Row k="geometry" val={geoText} theme={theme} />
        <Row k="material" val={`${p.material.style}${p.material.effect ? ` + ${p.material.effect}` : ''}`} theme={theme} />
        {sp.children.length > 0 && <Row k="children" val={String(sp.children.length)} theme={theme} />}
      </div>
      {note && <text style={{ color: theme.warn, fontSize: 12, paddingTop: 4 }}>{note}</text>}
    </div>
  )
}

function Button({ label, on, theme, onClick, testId, width }: { label: string; on?: boolean; theme: Theme; onClick: () => void; testId?: string; width?: number }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 24, minWidth: width ?? 0, paddingLeft: 9, paddingRight: 9, borderRadius: 6, borderWidth: 1, borderColor: on ? alpha(theme.accent, 0.7) : theme.line, backgroundColor: on ? alpha(theme.accent, 0.16) : hov ? alpha(theme.fg, 0.07) : 'transparent', cursor: 'pointer', flexShrink: 0 }}
    >
      <text style={{ color: on ? theme.accent : theme.fg, fontSize: 12, fontFamily: MONO }}>{label}</text>
    </div>
  )
}

function Slider({ value, onChange, theme, width }: { value: number; onChange: (v: number) => void; theme: Theme; width: number }) {
  const box = useRef<Box>({ x: 0, y: 0, width: 1, height: 1 })
  const set = (x?: number) => onChange(((x ?? 0) - box.current.x) / Math.max(1, box.current.width))
  return (
    <div
      testId="explode-slider"
      onLayout={(e) => { box.current = { x: e.x ?? 0, y: e.y ?? 0, width: e.width ?? 1, height: e.height ?? 1 } }}
      onMouseDown={(e) => set(e.x)}
      onMouseMove={(e) => { if (e.pressedButton !== undefined && e.pressedButton !== null) set(e.x) }}
      style={{ display: 'flex', alignItems: 'center', width, height: 24, position: 'relative', cursor: 'pointer', flexShrink: 0 }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, top: 11, height: 2, borderRadius: 1, backgroundColor: theme.line, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, top: 11, height: 2, width: Math.round(value * width), borderRadius: 1, backgroundColor: theme.accent, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: Math.round(value * (width - 12)), top: 6, width: 12, height: 12, borderRadius: 6, backgroundColor: theme.fg, pointerEvents: 'none' }} />
    </div>
  )
}

function Toolbar({ v, theme, compact }: { v: Viewer; theme: Theme; compact: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 12, paddingRight: 12, borderTopWidth: 1, borderColor: theme.line, backgroundColor: theme.panel, flexShrink: 0, overflow: 'hidden' }}>
      <Button testId="play" label={v.playing ? '❚❚' : '▶'} width={34} theme={theme} on={v.playing} onClick={() => v.togglePlay()} />
      <Button testId="step" label="›|" theme={theme} onClick={() => v.step(1)} />
      <Button testId="slower" label="−" theme={theme} onClick={() => v.setSpeed(-1)} />
      <text testId="speed" style={{ color: theme.fg, fontSize: 12, fontFamily: MONO, width: 42 }}>{`${v.speed}×`}</text>
      <Button testId="faster" label="+" theme={theme} onClick={() => v.setSpeed(1)} />
      <div style={{ width: 8, flexShrink: 0 }} />
      <text style={{ color: theme.faint, fontSize: 12, fontFamily: MONO }}>explode</text>
      <Slider value={v.explodeTarget} onChange={(x) => v.setExplode(x)} theme={theme} width={compact ? 80 : 140} />
      <Button testId="view" label={v.cam.view === 'iso' ? 'iso' : 'persp'} theme={theme} on={v.cam.view === 'perspective'} onClick={() => v.toggleView()} />
      <Button testId="fx" label="fx" theme={theme} on={v.effects} onClick={() => { v.effects = !v.effects; v.emit() }} />
      {!compact && <Button testId="tree" label="parts" theme={theme} on={v.panel} onClick={() => v.key('i')} />}
      <div style={{ flexGrow: 1 }} />
      {!compact && <text style={{ color: theme.faint, fontSize: 11, fontFamily: MONO }}>drag orbit · ⇧drag pan · scroll zoom · dbl-click focus · e explode · v view · space play</text>}
    </div>
  )
}

export function App({ v, theme }: { v: Viewer; theme: Theme }) {
  useViewer(v)
  const size = useWindowSize()
  const w = size.width || 1200
  const compact = w < 900
  const side = v.panel && w >= 760
  const sideW = Math.round(Math.min(320, Math.max(220, w * 0.26)))
  const toast = v.toast
  return (
    <div
      tabIndex={-1}
      autoFocus
      testId="root"
      onKeyDown={(e: KeyEvent) => { if (v.key(keyName(e), isShift(e.modifiers))) { e.preventDefault(); e.stopPropagation() } }}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: theme.bg }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingLeft: 14, paddingRight: 14, borderBottomWidth: 1, borderColor: theme.line, flexShrink: 0, overflow: 'hidden' }}>
        <text testId="title" style={{ color: theme.fg, fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{v.spec.meta.name}</text>
        {!compact && <text style={{ color: theme.dim, fontSize: 12, flexShrink: 1 }}>{v.spec.meta.description}</text>}
        <div style={{ flexGrow: 1 }} />
        <text testId="stats" style={{ color: theme.faint, fontSize: 11, fontFamily: MONO, flexShrink: 0 }}>{`${v.scene.parts.length} parts · t ${v.t.toFixed(2)}s · ${v.fps} fps · ${v.renderer.lastMs.toFixed(0)} ms`}</text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <Viewport v={v} theme={theme} />
        {side && (
          <div style={{ display: 'flex', flexDirection: 'column', width: sideW, flexShrink: 0, borderLeftWidth: 1, borderColor: theme.line, backgroundColor: theme.panel }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 30, paddingLeft: 12, paddingRight: 12, flexShrink: 0, borderBottomWidth: 1, borderColor: theme.line }}>
              <text style={{ color: theme.faint, fontSize: 11, fontFamily: MONO }}>{`PARTS  ${v.scene.parts.length}`}</text>
              <div style={{ flexGrow: 1 }} />
              {v.source && <text style={{ color: theme.faint, fontSize: 11, fontFamily: MONO }}>{v.source}</text>}
            </div>
            <Tree v={v} theme={theme} />
            <Inspector v={v} theme={theme} />
          </div>
        )}
      </div>
      {toast && (
        <div style={{ position: 'absolute', left: 14, top: 54, maxWidth: Math.max(200, w - 28), display: 'flex', paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, borderWidth: 1, borderColor: toast.kind === 'err' ? theme.bad : toast.kind === 'ok' ? alpha(theme.good, 0.6) : theme.line, backgroundColor: mix(theme.bg, toast.kind === 'err' ? theme.bad : theme.good, 0.1), pointerEvents: 'none' }}>
          <text testId="toast" style={{ color: toast.kind === 'err' ? theme.bad : theme.good, fontSize: 12, fontFamily: MONO, flexShrink: 1 }}>{toast.text}</text>
        </div>
      )}
      <Toolbar v={v} theme={theme} compact={compact} />
    </div>
  )
}

export function start(v: Viewer, theme: Theme, opts: { terminal: boolean }) {
  return render(<App v={v} theme={theme} />, {
    terminal: opts.terminal,
    title: `anatomy · ${v.spec.meta.name}`,
    width: 1400,
    height: 900,
    // Fallback for when a click leaves no element focused (seen after a double-click in Ghostty).
    onKeyDown(e: KeyEvent) { if (v.key(keyName(e), isShift(e.modifiers))) e.preventDefault() },
  } as Parameters<typeof render>[1])
}

export { SPEEDS }
