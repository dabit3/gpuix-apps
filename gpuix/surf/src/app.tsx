import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { render, useGpuix, useWindowSize, type ImgInstance, type KeyEvent, type CursorValue, type PublicInstance } from '@gpuix/react'
import type { EventPayload } from '@gpuix/react'
import { cdpButton, cdpButtons, cdpModifiers, keyEvents, mapPoint, printable, wheelDelta, type KeyLike } from './input'
import { displayUrl, hostOf } from './omnibox'
import { RateMeter } from './frame'
import { alpha, mix, type Theme } from './theme'
import type { Session } from './session'
import type { Tab } from './browser'

const UI = 'Helvetica Neue'
const MONO = 'Menlo'
export const TAB_H = 34
export const TOOL_H = 42
export const STATUS_H = 24

/** Browser shortcuts. Ghostty owns Cmd, so everything also works with Ctrl or Alt. Returns true when handled. */
export function shortcut(s: Session, e: KeyLike, ui: { focusOmnibox: () => void; focusPage: () => void; focusFind: () => void }): boolean {
  const b = s.browser
  const m = e.modifiers ?? {}
  const k = (printable(e) ?? e.key ?? '').toLowerCase()
  const mod = m.ctrl || m.cmd
  if (!b) return false
  if (mod && !m.shift && k === 'l') { ui.focusOmnibox(); return true }
  if (e.key === 'f6') { ui.focusOmnibox(); return true }
  if (mod && k === 't') { void b.newTab('about:blank').then(() => ui.focusOmnibox()); return true }
  if (mod && k === 'w') { void b.closeTab(); return true }
  if ((mod && k === 'r') || e.key === 'f5') { b.reload(); return true }
  if (mod && k === 'f') { ui.focusFind(); return true }
  if ((m.ctrl && e.key === 'tab') || (m.ctrl && (e.key === 'pagedown' || e.key === 'pageup'))) { b.cycle(m.shift || e.key === 'pageup' ? -1 : 1); return true }
  // Ghostty turns Option-←/→ into Alt-b / Alt-f (word motion), so accept both
  if (m.alt && (e.key === 'left' || k === 'b')) { void b.back(); return true }
  if (m.alt && (e.key === 'right' || k === 'f')) { void b.forward(); return true }
  if (mod && (k === '=' || k === '+' || e.key === 'plus' || e.key === 'equal')) { void s.zoom('in'); return true }
  if (mod && (k === '-' || k === '_' || e.key === 'minus')) { void s.zoom('out'); return true }
  if (mod && k === '0') { void s.zoom('reset'); return true }
  if (mod && /^[1-9]$/.test(k)) { const t = k === '9' ? b.tabs.at(-1) : b.tabs[Number(k) - 1]; if (t) void b.activate(t.id); return true }
  if (e.key === 'escape' && s.focus !== 'page') { if (s.focus === 'find') { s.findOpen = false; void b.find('') } ui.focusPage(); return true }
  return false
}

/** Ghostty keeps Cmd-V for itself, so Ctrl-V reads the system clipboard and types it into the page. */
function readClipboard(): string {
  for (const cmd of [['pbpaste'], ['wl-paste', '-n'], ['xclip', '-selection', 'clipboard', '-o']]) {
    try { const r = Bun.spawnSync(cmd); if (r.exitCode === 0) return r.stdout.toString() } catch {}
  }
  return ''
}


const CSS_CURSOR: Record<string, CursorValue> = { pointer: 'pointer', text: 'text', 'vertical-text': 'vertical-text', crosshair: 'crosshair', grab: 'grab', grabbing: 'grabbing', move: 'move', 'col-resize': 'col-resize', 'row-resize': 'row-resize', 'ew-resize': 'ew-resize', 'ns-resize': 'ns-resize', 'not-allowed': 'not-allowed', copy: 'copy', 'context-menu': 'context-menu' }
export const cursorFor = (css: string): CursorValue => CSS_CURSOR[css] ?? 'default'

function Txt({ c, s = 13, w, f = UI, children, grow }: { c: string; s?: number; w?: number; f?: string; children: React.ReactNode; grow?: boolean }) {
  return <text style={{ color: c, fontSize: s, fontWeight: w as never, fontFamily: f, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', flexShrink: 1, minWidth: 0, flexGrow: grow ? 1 : 0 }}>{children}</text>
}

const pct = (z: number) => `${Math.round(z * 100)}%`

/** Toolbar zoom: − / level / +, the level resets to 100%. Narrow panes only show the level, and only when it isn't 100%. */
function ZoomControl({ t, zoom, compact, onZoom }: { t: Theme; zoom: number; compact: boolean; onZoom: (to: 'in' | 'out' | 'reset') => void }) {
  const zoomed = Math.abs(zoom - 1) > 1e-3
  const level = (
    <div testId="zoom-level" onClick={() => onZoom('reset')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 50, height: 26, paddingLeft: 6, paddingRight: 6, borderRadius: 13, flexShrink: 0, cursor: 'pointer', backgroundColor: zoomed ? t.raised : 'transparent', hover: { backgroundColor: t.raised } }}>
      <text style={{ color: zoomed ? t.fg : t.dim, fontSize: 12, fontFamily: MONO }}>{pct(zoom)}</text>
    </div>
  )
  if (compact) return zoomed ? level : null
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 6, flexShrink: 0 }}>
      <IconButton t={t} testId="zoom-out" label="−" size={16} onClick={() => onZoom('out')} />
      {level}
      <IconButton t={t} testId="zoom-in" label="+" size={16} onClick={() => onZoom('in')} />
    </div>
  )
}

function IconButton({ t, label, title, onClick, disabled, testId, size = 15 }: { t: Theme; label: string; title?: string; onClick: () => void; disabled?: boolean; testId?: string; size?: number }) {
  return (
    <div testId={testId} onClick={disabled ? undefined : onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, flexShrink: 0, cursor: disabled ? 'default' : 'pointer', hover: disabled ? {} : { backgroundColor: t.raised } }}>
      <text style={{ color: disabled ? t.faint : t.fg, fontSize: size, fontFamily: UI }}>{label}</text>
    </div>
  )
}

/** A padlock drawn from two boxes: shackle (ring) and body. */
function Lock({ color }: { color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 10, height: 13, flexShrink: 0 }}>
      <div style={{ width: 7, height: 6, borderWidth: 1.6, borderColor: color, borderBottomWidth: 0, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
      <div style={{ width: 10, height: 7, borderRadius: 1.5, backgroundColor: color }} />
    </div>
  )
}

function SecurityBadge({ t, tab }: { t: Theme; tab: Tab | undefined }) {
  const sec = tab?.security ?? 'none'
  if (sec === 'secure') return <Lock color={t.palette[2]!} />
  if (sec === 'local') return <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.palette[4]!, flexShrink: 0 }} />
  if (sec === 'insecure') return <Txt c={t.palette[1]!} s={11} w={600}>Not secure</Txt>
  return <div style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.4, borderColor: t.faint, flexShrink: 0 }} />
}

function Favicon({ t, tab }: { t: Theme; tab: Tab }) {
  const host = hostOf(tab.url)
  const icon = useFavicon(/^https?:/.test(tab.url) ? host : '')
  if (tab.loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: alpha(t.accent, 0.35), flexShrink: 0 }}><div style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: t.accent }} /></div>
  if (!host || !/^https?:/.test(tab.url)) return <div style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: t.raised, flexShrink: 0 }} />
  if (!icon) return <div style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: t.raised, flexShrink: 0 }} />
  return <img src={icon} style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
}

/** Fetched here rather than by `<img src=https…>`, which paints "img: load failed" text when a site has no icon. */
const favicons = new Map<string, Promise<string | null>>()
function faviconFor(host: string) {
  let p = favicons.get(host)
  if (!p) {
    p = fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`, { signal: AbortSignal.timeout(5000) })
      .then(async (r) => {
        const type = r.headers.get('content-type') ?? ''
        if (!r.ok || !type.startsWith('image/')) return null
        return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`
      })
      .catch(() => null)
    favicons.set(host, p)
  }
  return p
}
function useFavicon(host: string) {
  const [icon, setIcon] = useState<{ host: string; src: string | null } | null>(null)
  useEffect(() => { if (!host) return; let live = true; void faviconFor(host).then((src) => { if (live) setIcon({ host, src }) }); return () => { live = false } }, [host])
  return icon?.host === host ? icon.src : null
}

function TabStrip({ s, t, width, onNew, onSelect }: { s: Session; t: Theme; width: number; onNew: () => void; onSelect: (id: string) => void }) {
  const b = s.browser
  const tabs = b?.tabs ?? []
  const tabW = Math.max(64, Math.min(230, (width - 60) / Math.max(1, tabs.length)))
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', height: TAB_H, paddingLeft: 8, paddingRight: 8, gap: 2, backgroundColor: t.bg, flexShrink: 0, overflow: 'hidden' }}>
      {tabs.map((tab, i) => {
        const active = tab.id === b?.activeId
        return (
          <div key={tab.id} testId={`tab-${i + 1}`} onClick={() => onSelect(tab.id)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: tabW, height: TAB_H - 6, paddingLeft: 10, paddingRight: 4, borderTopLeftRadius: 9, borderTopRightRadius: 9, backgroundColor: active ? t.panel : 'transparent', cursor: 'pointer', flexShrink: 0, hover: active ? {} : { backgroundColor: alpha(t.panel, 0.55) } }}>
            <Favicon t={t} tab={tab} />
            <Txt c={active ? t.fg : t.dim} s={12} w={active ? 600 : 400} grow>{tab.crashed ? 'Crashed' : tab.title || displayUrl(tab.url) || 'New Tab'}</Txt>
            {tabW > 90 || active ? (
              <div testId={`tab-close-${i + 1}`} onClick={(e: EventPayload & { stopPropagation?: () => void }) => { e.stopPropagation?.(); b && void b.closeTab(tab.id) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: 'pointer', hover: { backgroundColor: t.raised } }}>
                <text style={{ color: t.dim, fontSize: 13, fontFamily: UI }}>×</text>
              </div>
            ) : null}
          </div>
        )
      })}
      <div testId="tab-new" onClick={onNew} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, marginBottom: 2, borderRadius: 8, cursor: 'pointer', flexShrink: 0, hover: { backgroundColor: t.panel } }}>
        <text style={{ color: t.dim, fontSize: 18, fontFamily: UI }}>+</text>
      </div>
    </div>
  )
}

export function Surf({ s, t, size, paint }: { s: Session; t: Theme; size: { width: number; height: number }; paint?: RateMeter }) {
  const { renderer } = useGpuix()
  const img = useRef<ImgInstance>(null)
  const omni = useRef<PublicInstance>(null)
  const find = useRef<PublicInstance>(null)
  const root = useRef<PublicInstance>(null)
  const [, setRev] = useState(0)
  const [cursor, setCursor] = useState<CursorValue>('default')
  const [hasFrame, setHasFrame] = useState(false)
  // The frame on screen: drawn at its own pixel size (width/height, logical px) and clicks map onto the CSS viewport it was rendered at,
  // so a frame from before a resize or zoom change is never stretched and clicks land where they look
  const [shown, setShown] = useState<{ width: number; height: number; cssWidth: number; cssHeight: number; zoom: number } | null>(null)
  const shownRef = useRef(shown)
  const lastCursor = useRef({ at: 0, x: -1, y: -1 })
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const meter = useRef(paint ?? new RateMeter())

  const b = s.browser
  const tab = s.tab

  const ui = {
    focusOmnibox: () => { s.focus = 'omnibox'; s.omnibox = ''; if (omni.current) renderer?.focusElement?.(omni.current.id); setRev((r) => r + 1) },
    focusPage: () => { s.focus = 'page'; if (root.current) renderer?.focusElement?.(root.current.id); setRev((r) => r + 1) },
    focusFind: () => { s.focus = 'find'; s.findOpen = true; setRev((r) => r + 1); setTimeout(() => { if (find.current) renderer?.focusElement?.(find.current.id) }, 0) },
  }

  useEffect(() => {
    let queued: ReturnType<typeof setTimeout> | null = null
    const off = s.subscribe(() => { if (!queued) queued = setTimeout(() => { queued = null; setRev((r) => r + 1) }, 33) })
    const tick = setInterval(() => setRev((r) => r + 1), 500)
    return () => { off(); clearInterval(tick); if (queued) clearTimeout(queued) }
  }, [s])

  // Paint the newest screencast frame; older ones were already acked and dropped by LatestFrame.
  useLayoutEffect(() => {
    if (!b) return
    let scheduled = false
    const paintFrame = () => {
      scheduled = false
      const f = b.frames.take()
      if (!f || !img.current) return
      const t0 = performance.now()
      img.current.setImage(f.bytes)
      const cur = shownRef.current
      const w = f.cssWidth * f.zoom, h = f.cssHeight * f.zoom
      if (!cur || cur.width !== w || cur.height !== h || cur.cssWidth !== f.cssWidth || cur.cssHeight !== f.cssHeight || cur.zoom !== f.zoom) { shownRef.current = { width: w, height: h, cssWidth: f.cssWidth, cssHeight: f.cssHeight, zoom: f.zoom }; setShown(shownRef.current) }
      s.paintMs = performance.now() - t0
      s.painted++
      meter.current.tick()
      f.ack()
      if (s.painted === 1) setHasFrame(true)
    }
    const off = b.onFrame(() => { if (!scheduled) { scheduled = true; setImmediate(paintFrame) } })
    paintFrame()
    return () => { off() }
  }, [b, s])

  useEffect(() => { if (b && s.focus === 'page') ui.focusPage() }, [b])

  const pageX = (e: EventPayload) => {
    const f = shownRef.current
    const v = b?.viewport ?? { width: 1, height: 1 }
    const z = b?.active?.zoom ?? 1
    if (!f) return mapPoint(e.x ?? 0, e.y ?? 0, { x: s.box.x, y: s.box.y, width: v.width, height: v.height }, { width: v.width / z, height: v.height / z })
    return mapPoint(e.x ?? 0, e.y ?? 0, { x: s.box.x, y: s.box.y, width: f.width, height: f.height }, { width: f.cssWidth, height: f.cssHeight })
  }

  const onMouseDown = (e: EventPayload) => {
    if (!b) return
    if (s.focus !== 'page') ui.focusPage()
    const p = pageX(e)
    b.mouse({ type: 'mousePressed', x: p.x, y: p.y, button: cdpButton(e.button ?? 0), buttons: cdpButtons(e.button ?? 0), clickCount: e.clickCount ?? 1, modifiers: cdpModifiers(e.modifiers) })
  }
  const onMouseUp = (e: EventPayload) => {
    if (!b) return
    const p = pageX(e)
    b.mouse({ type: 'mouseReleased', x: p.x, y: p.y, button: cdpButton(e.button ?? 0), buttons: 0, clickCount: e.clickCount ?? 1, modifiers: cdpModifiers(e.modifiers) })
  }
  const onMouseMove = (e: EventPayload) => {
    if (!b) return
    const p = pageX(e)
    const held = e.pressedButton
    b.mouse({ type: 'mouseMoved', x: p.x, y: p.y, button: held == null ? 'none' : cdpButton(held), buttons: cdpButtons(held), modifiers: cdpModifiers(e.modifiers) })
    // the cursor lookup is a page evaluation, so it runs when the pointer rests (or every 250 ms while it moves), not on every move
    const probe = () => {
      cursorTimer.current = null
      const lc = lastCursor.current
      if (Math.abs(p.x - lc.x) <= 2 && Math.abs(p.y - lc.y) <= 2) return
      lastCursor.current = { at: performance.now(), x: p.x, y: p.y }
      void b.cursorAt(p.x, p.y).then((c) => setCursor(cursorFor(c))).catch(() => {})
    }
    if (cursorTimer.current) clearTimeout(cursorTimer.current)
    if (performance.now() - lastCursor.current.at > 250) probe()
    else cursorTimer.current = setTimeout(probe, 45)
  }
  useEffect(() => () => { if (cursorTimer.current) clearTimeout(cursorTimer.current) }, [])
  const onScroll = (e: EventPayload) => {
    if (!b) return
    if (e.modifiers?.ctrl || e.modifiers?.cmd) { s.zoomWheel((e.deltaY ?? 0) * (e.precise ? 1 : 40), s.box.height > 0 ? Math.min(1, Math.max(0, ((e.y ?? 0) - s.box.y) / s.box.height)) : 0.5); return }
    const p = pageX(e)
    // wheel px are screen px; at 200% one screen px is half a CSS px
    const z = b.active?.zoom ?? 1
    const k = s.opts.wheelScale ?? 1
    const d = wheelDelta((e.deltaX ?? 0) * k, (e.deltaY ?? 0) * k, e.precise)
    b.wheel(p.x, p.y, d.deltaX / z, d.deltaY / z, cdpModifiers(e.modifiers))
  }

  // Keys: the focused element sees them first, then this root handler.
  const onKeyDown = (e: KeyEvent) => {
    if (shortcut(s, e, ui)) { e.preventDefault(); e.stopPropagation(); return }
    if (s.focus === 'page' && b) {
      if (e.modifiers?.ctrl && !e.modifiers.shift && (e.key === 'v' || e.keyChar === 'v')) { const text = readClipboard(); if (text) b.insertText(text); e.preventDefault(); e.stopPropagation(); return }
      const evs = keyEvents(e, !!e.isHeld)
      if (evs) { b.keys(evs); e.preventDefault(); e.stopPropagation() }
    }
  }

  const progress = tab?.loading ? Math.max(0.08, tab.progress) : 0
  const vp = b?.viewport
  // until Chrome sends a frame at a new zoom level, the last one is scaled to it, so the zoom shows at once
  const preview = shown && tab ? tab.zoom / shown.zoom : 1
  const fps = b ? b.fps.rate() : 0
  const narrow = size.width < 640
  const omniFocused = s.focus === 'omnibox'
  const url = tab?.url ?? ''
  const zoom = tab?.zoom ?? 1
  const zoomFlash = b && performance.now() - s.zoomedAt < 1200

  return (
    <div ref={root} testId="surf-root" tabIndex={-1} autoFocus onKeyDown={onKeyDown} style={{ display: 'flex', flexDirection: 'column', width: size.width, height: size.height, backgroundColor: t.bg, overflow: 'hidden' }}>
      <TabStrip s={s} t={t} width={size.width} onNew={() => b && void b.newTab('about:blank').then(() => ui.focusOmnibox())} onSelect={(id) => { if (!b) return; void b.activate(id); if (s.focus === 'omnibox') ui.focusPage() }} />
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, height: TOOL_H, paddingLeft: 8, paddingRight: 10, backgroundColor: t.panel, flexShrink: 0 }}>
        <IconButton t={t} testId="nav-back" label="←" disabled={!tab?.canBack} onClick={() => b && void b.back()} />
        <IconButton t={t} testId="nav-forward" label="→" disabled={!tab?.canForward} onClick={() => b && void b.forward()} />
        {tab?.loading
          ? <IconButton t={t} testId="nav-stop" label="✕" size={13} onClick={() => b?.stop()} />
          : <IconButton t={t} testId="nav-reload" label="↻" size={16} onClick={() => b?.reload()} />}
        <div testId="omnibox" onClick={() => { if (!omniFocused) ui.focusOmnibox() }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, flexGrow: 1, minWidth: 0, height: 30, marginLeft: 4, paddingLeft: 12, paddingRight: 12, borderRadius: 15, backgroundColor: t.bg, borderWidth: 1.5, borderColor: omniFocused ? t.accent : 'transparent', cursor: 'text' }}>
          {omniFocused ? null : <SecurityBadge t={t} tab={tab} />}
          <input
            ref={omni}
            testId="omnibox-input"
            value={omniFocused ? s.omnibox : displayUrl(url)}
            placeholder={omniFocused ? (url && url !== 'about:blank' ? displayUrl(url) : 'Search DuckDuckGo or type a URL') : 'Search DuckDuckGo or type a URL'}
            onChange={(e) => { if (s.focus === 'omnibox') s.omnibox = e.value ?? '' }}
            onFocus={() => { if (s.focus !== 'omnibox') { s.focus = 'omnibox'; s.omnibox = ''; setRev((r) => r + 1) } }}
            onSubmit={() => { if (s.focus !== 'omnibox') return; const v = s.omnibox.trim() || url; ui.focusPage(); void s.go(v) }}
            style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: t.fg, fontFamily: UI }}
          />
        </div>
        <ZoomControl t={t} zoom={zoom} compact={narrow} onZoom={(to) => void s.zoom(to)} />
      </div>
      <div style={{ height: 2, backgroundColor: t.panel, flexShrink: 0 }}>
        <div testId="progress" style={{ width: Math.round(size.width * progress), height: 2, backgroundColor: progress ? t.accent : 'transparent' }} />
      </div>
      <div
        testId="page"
        onLayout={(e: EventPayload) => s.layout({ x: e.x ?? 0, y: e.y ?? 0, width: e.width ?? 0, height: e.height ?? 0 })}
        style={{ position: 'relative', display: 'flex', flexGrow: 1, minHeight: 0, backgroundColor: '#ffffff', overflow: 'hidden' }}
      >
        <img ref={img} testId="page-img" style={{ position: 'absolute', left: 0, top: 0, width: shown ? shown.width * preview : vp ? vp.width : '100%', height: shown ? shown.height * preview : vp ? vp.height : '100%' }} />
        <div testId="page-input" onMouseDown={onMouseDown} onMouseUp={onMouseUp} onMouseMove={onMouseMove} onScroll={onScroll} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, cursor }} />
        {zoomFlash ? (
          <div style={{ position: 'absolute', top: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <div testId="zoom-flash" style={{ display: 'flex', alignItems: 'center', height: 34, paddingLeft: 16, paddingRight: 16, borderRadius: 17, backgroundColor: t.panel, borderWidth: 1, borderColor: t.line, boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: 'rgba(0,0,0,0.45)' }] }}>
              <text style={{ color: t.fg, fontSize: 14, fontWeight: 600 as never, fontFamily: MONO }}>{pct(zoom)}</text>
            </div>
          </div>
        ) : null}
        {!hasFrame ? (
          <div testId="splash" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: t.bg, pointerEvents: 'none' }}>
            <text style={{ color: t.fg, fontSize: 34, fontWeight: 700 as never, fontFamily: UI }}>surf</text>
            <text style={{ color: s.error ? t.palette[1]! : t.dim, fontSize: 13, fontFamily: UI }}>{s.error ? s.error : b ? `Loading ${displayUrl(url) || 'page'}…` : 'Starting Chrome…'}</text>
          </div>
        ) : null}
        {s.findOpen ? (
          <div style={{ position: 'absolute', top: 10, right: 14, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingLeft: 12, paddingRight: 6, borderRadius: 10, backgroundColor: t.panel, borderWidth: 1, borderColor: t.line, boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: 'rgba(0,0,0,0.45)' }] }}>
            <input ref={find} testId="find-input" value={s.findQuery} placeholder="Find in page" onFocus={() => { s.focus = 'find'; setRev((r) => r + 1) }} onChange={(e) => void s.runFind(e.value ?? '', { fromStart: true })} onSubmit={() => void s.runFind(s.findQuery)} style={{ width: 170, fontSize: 13, color: t.fg, fontFamily: UI }} />
            <text style={{ color: t.dim, fontSize: 12, fontFamily: UI }}>{s.findQuery ? (s.findCount ? `${s.findIndex} of ${s.findCount}` : 'no matches') : ''}</text>
            <IconButton t={t} testId="find-prev" label="↑" size={13} onClick={() => void s.runFind(s.findQuery, { backwards: true })} />
            <IconButton t={t} testId="find-next" label="↓" size={13} onClick={() => void s.runFind(s.findQuery)} />
            <IconButton t={t} testId="find-close" label="×" onClick={() => { s.findOpen = false; void b?.find(''); ui.focusPage() }} />
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, height: STATUS_H, paddingLeft: 12, paddingRight: 12, backgroundColor: t.bg, borderTopWidth: 1, borderColor: t.line, flexShrink: 0 }}>
        <Txt c={t.dim} s={11} grow>{tab ? (tab.loading ? `Loading ${hostOf(tab.url)}…` : tab.title || displayUrl(tab.url)) : ''}</Txt>
        {narrow ? null : <Txt c={t.faint} s={11} f={MONO}>{s.chrome ? s.chrome.version.replace('HeadlessChrome', 'Chrome') : ''}</Txt>}
        {vp && !narrow ? <Txt c={t.faint} s={11} f={MONO}>{`${vp.width}×${vp.height} @${vp.deviceScaleFactor}x`}</Txt> : null}
        <Txt c={fps > 0 ? t.palette[2]! : t.faint} s={11} f={MONO}>{`${fps} fps`}</Txt>
        <Txt c={t.dim} s={11} f={MONO}>{b && b.latency ? `${Math.round(b.latency)} ms` : '— ms'}</Txt>
        {narrow ? null : <Txt c={t.faint} s={11} f={MONO}>{`${b?.tabs.length ?? 0} tab${b?.tabs.length === 1 ? '' : 's'}`}</Txt>}
      </div>
    </div>
  )
}

export function App({ session, theme }: { session: Session; theme: Theme }) {
  const size = useWindowSize()
  return <Surf s={session} t={theme} size={size} />
}

export function start(s: Session, theme: Theme, opts: { terminal: boolean }) {
  render(<App session={s} theme={theme} />, { terminal: opts.terminal, title: 'surf', width: 1400, height: 900 } as never)
}

export const _mix = mix
