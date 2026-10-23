import { Cdp } from './cdp'
import { decodeBase64, imageSize, LatestFrame, RateMeter } from './frame'
import { findExpression } from './findpage'
import { securityOf, type Security } from './omnibox'
import { clampZoom, WheelGlide, zoomedMetrics, type KeyEventParams } from './input'

/** `p`, or undefined once `ms` passes. */
function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let done = () => {}
  const late = new Promise<undefined>((r) => { done = () => r(undefined) })
  const timer = setTimeout(() => done(), ms)
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

export interface Tab {
  id: string
  sessionId: string
  url: string
  title: string
  loading: boolean
  progress: number
  canBack: boolean
  canForward: boolean
  security: Security
  requests: number
  finished: number
  crashed: boolean
  /** Page zoom factor (1 = 100%), kept per tab like Chrome. */
  zoom: number
}

/** width/height are the encoded pixels; cssWidth/cssHeight the CSS viewport Chrome rendered the frame at; zoom the page zoom it was rendered with (it covers cssWidth × zoom logical px on screen). */
export interface Frame { bytes: Uint8Array; width: number; height: number; cssWidth: number; cssHeight: number; zoom: number; tabId: string; receivedAt: number; ack: () => void }
export interface Viewport { width: number; height: number; deviceScaleFactor: number; frameWidth: number; frameHeight: number }

const QUALITY = 82

/** Remembers the element at `fy` of the viewport height and where on it, so the same spot can be put back after a zoom re-layout. At the very top there is nothing to keep. */
export const saveAnchor = (fy: number) => `(()=>{window.__surfAnchor=null;if(scrollY<1)return;const y=innerHeight*${fy};const e=document.elementFromPoint(innerWidth/2,y);if(!e||e===document.documentElement||e===document.body)return;const r=e.getBoundingClientRect();window.__surfAnchor={e,f:r.height?(y-r.top)/r.height:0,fy:${fy}}})()`
export const RESTORE_ANCHOR = `(()=>{const a=window.__surfAnchor;window.__surfAnchor=null;if(!a||!a.e.isConnected)return;const r=a.e.getBoundingClientRect();const d=r.top+a.f*r.height-innerHeight*a.fy;if(Math.abs(d)>1)scrollBy({top:d,behavior:'instant'})})()`

/** Rewrites the HeadlessChrome UA token so sites serve the same pages they serve desktop Chrome. */
export function desktopUserAgent(ua: string) { return ua.replace(/HeadlessChrome/g, 'Chrome').replace(/\s*Headless\b/g, '') }

/** Tabs, navigation, screencast and input for one headless Chrome, all over one CDP socket. */
export class Browser {
  tabs: Tab[] = []
  activeId = ''
  viewport: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, frameWidth: 1280, frameHeight: 720 }
  frames = new LatestFrame<Frame>()
  fps = new RateMeter()
  latency = 0
  rtt = 0
  version = ''
  userAgent = ''
  private listeners = new Set<() => void>()
  private frameListeners = new Set<() => void>()
  private inputAt = 0
  private moveInFlight = false
  private queuedMove: Record<string, unknown> | null = null
  private ours = new Set<string>()
  private closing = false
  private titleAt = 0
  private titleTimer: ReturnType<typeof setTimeout> | null = null
  private wantViewport: Viewport | null = null
  private viewportJob: Promise<void> | null = null
  private zoomPending = new Set<Tab>()
  /** The --force-device-scale-factor Chrome was launched with: screencast frames come at CSS px × this, capped at the pane's pixel size. */
  rasterScale = 1
  private glide = new WheelGlide()
  private wheelAt = { x: 0, y: 0, modifiers: 0 }
  private wheelTimer: ReturnType<typeof setInterval> | null = null
  private wheelInFlight = false
  private wheelStepAt = 0
  private settleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(readonly cdp: Cdp) {}

  static async connect(cdp: Cdp, opts: { viewport?: Viewport; rasterScale?: number } = {}) {
    const b = new Browser(cdp)
    if (opts.viewport) b.viewport = opts.viewport
    if (opts.rasterScale) b.rasterScale = opts.rasterScale
    await b.init()
    return b
  }

  get active(): Tab | undefined { return this.tabs.find((t) => t.id === this.activeId) }
  tab(id: string) { return this.tabs.find((t) => t.id === id) }
  private bySession(sid?: string) { return sid ? this.tabs.find((t) => t.sessionId === sid) : undefined }

  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  onFrame(fn: () => void) { this.frameListeners.add(fn); return () => this.frameListeners.delete(fn) }
  private changed() { for (const fn of this.listeners) fn() }

  private async init() {
    const v = await this.cdp.send('Browser.getVersion')
    this.version = String(v.product ?? 'Chrome').replace('HeadlessChrome', 'Chrome')
    this.userAgent = desktopUserAgent(String(v.userAgent ?? ''))
    const c = this.cdp
    c.on('Target.targetInfoChanged', ({ targetInfo: t }) => {
      const tab = this.tab(t.targetId)
      if (!tab) return
      tab.title = t.title || tab.title
      if (t.url) { tab.url = t.url; tab.security = securityOf(t.url) }
      this.changed()
    })
    c.on('Target.targetCreated', ({ targetInfo: t }) => {
      // pages opened by the page itself (target=_blank, window.open) become tabs
      if (t.type === 'page' && t.openerId && !this.ours.has(t.targetId) && !this.tab(t.targetId)) void this.adopt(t.targetId, t.url, true)
    })
    c.on('Target.targetDestroyed', ({ targetId }) => this.dropTab(targetId))
    c.on('Target.detachedFromTarget', ({ targetId }) => { if (targetId) this.dropTab(targetId) })
    c.on('Page.screencastFrame', (p, sid) => this.onScreencast(p, sid))
    c.on('Page.frameStartedLoading', (p, sid) => { const t = this.bySession(sid); if (t && this.isMain(p.frameId, t)) { t.loading = true; t.progress = 0.08; t.requests = 0; t.finished = 0; this.changed() } })
    c.on('Page.javascriptDialogOpening', (p, sid) => { this.cdp.post('Page.handleJavaScriptDialog', { accept: p.type !== 'beforeunload' ? false : true }, sid) })
    c.on('Page.frameStoppedLoading', (p, sid) => { const t = this.bySession(sid); if (t && this.isMain(p.frameId, t)) { t.loading = false; t.progress = 1; this.changed(); void this.refreshHistory(t); void this.refreshTitle(t) } })
    c.on('Page.domContentEventFired', (_p, sid) => { const t = this.bySession(sid); if (t && t.loading) { t.progress = Math.max(t.progress, 0.7); this.changed() } })
    c.on('Page.frameNavigated', (p, sid) => { const t = this.bySession(sid); if (t && !p.frame.parentId) { t.url = p.frame.url; t.security = securityOf(t.url); void this.refreshHistory(t); this.changed(); if (this.needsCrisp(t)) void this.resumeZoomed(t) } })
    c.on('Page.navigatedWithinDocument', (p, sid) => { const t = this.bySession(sid); if (t) { t.url = p.url; void this.refreshHistory(t); void this.refreshTitle(t); this.changed() } })
    c.on('Page.domContentEventFired', (_p, sid) => { const t = this.bySession(sid); if (t) void this.refreshTitle(t) })
    c.on('Network.requestWillBeSent', (_p, sid) => { const t = this.bySession(sid); if (t?.loading) { t.requests++; this.bump(t) } })
    c.on('Network.loadingFinished', (_p, sid) => { const t = this.bySession(sid); if (t?.loading) { t.finished++; this.bump(t) } })
    c.on('Network.loadingFailed', (_p, sid) => { const t = this.bySession(sid); if (t?.loading) { t.finished++; this.bump(t) } })
    c.on('Inspector.targetCrashed', (_p, sid) => { const t = this.bySession(sid); if (t) { t.crashed = true; t.loading = false; this.changed() } })
    await c.send('Target.setDiscoverTargets', { discover: true })
    // reuse the about:blank page Chrome opened at launch, so there is no stray target
    const { targetInfos } = await c.send('Target.getTargets')
    for (const t of targetInfos as { targetId: string; type: string; url: string }[]) if (t.type === 'page') await this.adopt(t.targetId, t.url, !this.activeId)
  }

  /** targetInfoChanged reports the URL as the title until the page sets one, and not always the final title. */
  private async refreshTitle(t: Tab) {
    const r = await this.cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, t.sessionId).catch(() => null)
    const title = r?.result?.value
    if (typeof title === 'string' && title && title !== t.title) { t.title = title; this.changed() }
  }

  private mainFrames = new Map<string, string>()
  private isMain(frameId: string, t: Tab) { return this.mainFrames.get(t.id) === frameId }

  private bump(t: Tab) {
    const p = 0.1 + 0.8 * (t.finished / Math.max(t.requests, 1))
    if (p > t.progress) { t.progress = Math.min(p, 0.95); this.changed() }
  }

  private async adopt(targetId: string, url: string, activate: boolean) {
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const tab: Tab = { id: targetId, sessionId, url, title: '', loading: false, progress: 1, canBack: false, canForward: false, security: securityOf(url), requests: 0, finished: 0, crashed: false, zoom: 1 }
    this.tabs.push(tab)
    const s = (m: string, p: Record<string, unknown> = {}) => this.cdp.send(m, p, sessionId).catch(() => {})
    await Promise.all([s('Page.enable'), s('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }), s('Inspector.enable'), s('Runtime.enable')])
    const tree = await this.cdp.send('Page.getFrameTree', {}, sessionId).catch(() => null)
    if (tree) this.mainFrames.set(targetId, tree.frameTree.frame.id)
    await s('Emulation.setUserAgentOverride', { userAgent: this.userAgent, platform: 'MacIntel' })
    await this.applyViewport(tab)
    if (activate) await this.activate(targetId)
    else this.changed()
    return tab
  }

  private dropTab(id: string) {
    const i = this.tabs.findIndex((t) => t.id === id)
    if (i < 0) return
    this.tabs.splice(i, 1)
    if (this.closing) return
    if (this.activeId === id) {
      const next = this.tabs[Math.min(i, this.tabs.length - 1)]
      this.activeId = ''
      if (next) void this.activate(next.id)
      else void this.newTab('about:blank')
    }
    this.changed()
  }

  async newTab(url = 'about:blank', activate = true) {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank', newWindow: false, background: !activate })
    this.ours.add(targetId)
    const tab = await this.adopt(targetId, 'about:blank', activate)
    if (url !== 'about:blank') await this.navigate(url, tab.id)
    return tab
  }

  async closeTab(id = this.activeId) {
    if (this.tabs.length <= 1) { await this.navigate('about:blank', id); return }
    await this.cdp.send('Target.closeTarget', { targetId: id }).catch(() => {})
  }

  async activate(id: string) {
    const next = this.tab(id)
    if (!next) return
    const prev = this.active
    if (prev && prev.id !== id) this.cdp.post('Page.stopScreencast', {}, prev.sessionId)
    this.activeId = id
    this.glide.clear()
    this.frames.take()
    this.changed()
    this.cdp.post('Target.activateTarget', { targetId: id })
    this.cdp.post('Page.bringToFront', {}, next.sessionId)
    await this.fitWindow()
    await this.startScreencast(next)
  }

  cycle(step: number) {
    if (this.tabs.length < 2) return
    const i = this.tabs.findIndex((t) => t.id === this.activeId)
    void this.activate(this.tabs[(i + step + this.tabs.length) % this.tabs.length]!.id)
  }

  private async startScreencast(t: Tab) {
    this.lastCast = ''
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: QUALITY, maxWidth: this.viewport.frameWidth, maxHeight: this.viewport.frameHeight, everyNthFrame: 1 }, t.sessionId).catch(() => {})
  }

  /** Headless screencast frames are capped by the window's content area, so the window must hold the full device-pixel frame at DPR > 1. Sizing the contents rather than the window bounds avoids the window inset (87 px seen after `Target.createTarget`) cropping the frame. */
  private async fitWindow() {
    const t = this.active
    if (!t) return
    const { frameWidth: w, frameHeight: h } = this.viewport
    const win = await this.cdp.send('Browser.getWindowForTarget', { targetId: t.id }).catch(() => null)
    if (win?.windowId == null) return
    const ok = await this.cdp.send('Browser.setContentsSize', { windowId: win.windowId, width: w, height: h }).then(() => true, () => false)
    if (!ok) await this.cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { width: Math.max(w, 400), height: Math.max(h, 300) } }).catch(() => {})
  }

  private async applyViewport(t: Tab) {
    const m = zoomedMetrics(this.viewport, t.zoom)
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { ...m, mobile: false }, t.sessionId).catch(() => {})
  }

  /** Sets a tab's page zoom: Chrome re-lays the page out at pane size / zoom, and the active tab's frames follow. */
  /** The part of the page at `anchorY` (a fraction of the viewport height) stays put across the re-layout, like zooming in Chrome. */
  async setZoom(zoom: number, id = this.activeId, anchorY = 0.5): Promise<number> {
    const t = this.tab(id)
    if (!t) return 1
    const z = clampZoom(zoom)
    if (z === t.zoom) return z
    const live = t.id === this.activeId
    if (live) await this.quietEval(t, saveAnchor(anchorY))
    t.zoom = z
    this.zoomPending.add(t)
    this.changed()
    await this.kick()
    if (live && t.zoom === z) await this.quietEval(t, RESTORE_ANCHOR)
    return z
  }

  private quietEval(t: Tab, expression: string) {
    return within(this.cdp.send('Runtime.evaluate', { expression }, t.sessionId).catch(() => null), 400)
  }

  /** Zoom levels the screencast can't render at full resolution fall back to device-pixel screenshots once the page settles. */
  needsCrisp(t: Tab) { return t.zoom * this.viewport.deviceScaleFactor > this.rasterScale + 1e-3 }

  /** Resizes every tab's viewport; the active tab's screencast restarts at the new frame size. */
  /** Latest wins: resizes arrive faster than Chrome applies them, so updates run one at a time and only the newest pending size is applied next. */
  setViewport(v: Viewport): Promise<void> {
    this.wantViewport = v
    return this.kick()
  }

  /** Zoom changes share the resize queue, so rapid Ctrl-= presses apply in order and the last one wins. */
  private kick(): Promise<void> {
    if (!this.viewportJob) this.viewportJob = this.drainViewport().finally(() => {
      this.viewportJob = null
      if (this.wantViewport || this.zoomPending.size) void this.kick()
      else if (this.crispWanted) { this.crispWanted = false; const a = this.active; if (a && this.needsCrisp(a)) void this.captureCrisp(a) }
    })
    return this.viewportJob
  }

  private async drainViewport() {
    // a screenshot under emulation restores the metrics it started with, which would undo an override sent mid-capture
    if (this.crispJob) await within(this.crispJob, 1500)
    while (this.wantViewport || this.zoomPending.size) {
      let tabs: Tab[] = []
      let resized = false
      const v = this.wantViewport
      if (v) {
        this.wantViewport = null
        const same = v.width === this.viewport.width && v.height === this.viewport.height && v.deviceScaleFactor === this.viewport.deviceScaleFactor
        this.viewport = v
        if (!same) { await this.fitWindow(); tabs = [...this.tabs]; resized = true }
      }
      for (const t of this.zoomPending) if (!tabs.includes(t) && this.tabs.includes(t)) tabs.push(t)
      this.zoomPending.clear()
      if (!tabs.length) continue
      await Promise.all(tabs.map((t) => this.applyViewport(t)))
      const a = this.active
      // a zoom change keeps the frame size, so the running screencast just follows the new layout
      if (a && tabs.includes(a) && (resized || this.needsCrisp(a))) { await this.cdp.send('Page.stopScreencast', {}, a.sessionId).catch(() => {}); await this.startScreencast(a) }
      this.changed()
    }
  }

  private onScreencast(p: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }, sid?: string) {
    const tab = this.bySession(sid)
    let acked = false
    const ack = () => { if (!acked) { acked = true; this.cdp.post('Page.screencastFrameAck', { sessionId: p.sessionId }, sid) } }
    if (!tab || tab.id !== this.activeId) { ack(); return }
    const now = performance.now()
    if (this.inputAt) { const d = now - this.inputAt; if (d < 600) this.latency = this.latency ? this.latency * 0.7 + d * 0.3 : d; this.inputAt = 0 }
    // an identical frame changes nothing on screen (each crisp screenshot also echoes one), so skip the decode and the paint
    if (p.data === this.lastCast) { ack(); return }
    this.lastCast = p.data
    const bytes = decodeBase64(p.data)
    // replaced (dropped) frames must still be acked or Chrome stops sending
    const size = imageSize(bytes)
    const stale = this.frames.push({ bytes, width: size?.width ?? this.viewport.frameWidth, height: size?.height ?? this.viewport.frameHeight, cssWidth: p.metadata?.deviceWidth || this.viewport.width, cssHeight: p.metadata?.deviceHeight || this.viewport.height, zoom: tab.zoom, tabId: tab.id, receivedAt: now, ack })
    stale?.ack()
    this.fps.tick(now)
    if (this.needsCrisp(tab)) this.settleCrisp(tab)
    // document.title set by script doesn't always produce targetInfoChanged; repaints are a cheap hint to re-read it
    if (!this.titleTimer) {
      const wait = Math.max(0, 1000 - (now - this.titleAt))
      this.titleTimer = setTimeout(() => { this.titleTimer = null; this.titleAt = performance.now(); const t = this.active; if (t) void this.refreshTitle(t) }, wait)
    }
    for (const fn of this.frameListeners) fn()
  }

  /** With screenshots taken under emulation, headless Chrome stops screencasting a tab once it commits a new document, so a zoomed-in tab restarts it. */
  private async resumeZoomed(t: Tab) {
    if (t.id !== this.activeId || this.viewportJob) return
    await this.cdp.send('Page.stopScreencast', {}, t.sessionId).catch(() => {})
    await this.startScreencast(t)
  }

  private lastCast = ''
  private crispJob: Promise<void> | null = null
  private crispAgain = false
  private crispWanted = false

  /** Past the raster scale, screencast frames stream live (upscaled) and a device-pixel screenshot replaces them once the page is still. */
  private settleCrisp(t: Tab) {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => { this.settleTimer = null; if (t.id === this.activeId && this.needsCrisp(t)) this.captureCrisp(t) }, 140)
  }

  /** Screenshots under emulation are serialized with input; latest wins. */
  private captureCrisp(t: Tab) {
    if (this.viewportJob) { this.crispWanted = true; return }
    if (this.crispJob) { this.crispAgain = true; return }
    this.crispJob = this.crispLoop(t).finally(() => { this.crispJob = null })
  }

  private async crispLoop(t: Tab) {
    try {
      do {
        this.crispAgain = false
        if (this.viewportJob) { this.crispWanted = true; break }
        // an input whose page navigates away may never be answered, so don't wait on it for long
        if (this.inflightInputs.size) await within(Promise.all([...this.inflightInputs]), 250)
        const zoom = t.zoom, m = zoomedMetrics(this.viewport, zoom)
        this.capturing = true
        const r = await within(this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY, optimizeForSpeed: true }, t.sessionId).catch(() => null), 3000)
        // a screenshot under emulation can leave Chrome reading input coordinates at 1/zoom; re-applying the metrics before releasing held input resets that
        await this.applyViewport(t)
        this.capturing = false
        for (const go of this.heldInputs.splice(0)) go()
        if (!r?.data || t.id !== this.activeId || t.zoom !== zoom) continue
        const now = zoomedMetrics(this.viewport, t.zoom)
        if (now.width !== m.width || now.height !== m.height) continue
        const bytes = decodeBase64(r.data)
        const size = imageSize(bytes)
        this.frames.push({ bytes, width: size?.width ?? this.viewport.frameWidth, height: size?.height ?? this.viewport.frameHeight, cssWidth: m.width, cssHeight: m.height, zoom, tabId: t.id, receivedAt: performance.now(), ack: () => {} })
        this.fps.tick()
        for (const fn of this.frameListeners) fn()
      } while (this.crispAgain)
    } finally {
      this.capturing = false
      for (const go of this.heldInputs.splice(0)) go()
    }
  }

  private async refreshHistory(t: Tab) {
    const h = await this.cdp.send('Page.getNavigationHistory', {}, t.sessionId).catch(() => null)
    if (!h) return
    t.canBack = h.currentIndex > 0
    t.canForward = h.currentIndex < h.entries.length - 1
    this.changed()
  }

  async navigate(url: string, id = this.activeId) {
    const t = this.tab(id)
    if (!t) return
    t.url = url; t.security = securityOf(url); t.loading = true; t.progress = 0.05; t.crashed = false
    this.changed()
    const r = await this.cdp.send('Page.navigate', { url }, t.sessionId).catch((e: Error) => ({ errorText: e.message }))
    if (r?.errorText && r.errorText !== 'net::ERR_ABORTED') { t.loading = false; t.progress = 1; this.changed() }
  }

  async history(step: -1 | 1, id = this.activeId) {
    const t = this.tab(id)
    if (!t) return
    const h = await this.cdp.send('Page.getNavigationHistory', {}, t.sessionId).catch(() => null)
    const e = h?.entries[h.currentIndex + step]
    if (e) await this.cdp.send('Page.navigateToHistoryEntry', { entryId: e.id }, t.sessionId).catch(() => {})
  }
  back() { return this.history(-1) }
  forward() { return this.history(1) }
  reload(id = this.activeId) { const t = this.tab(id); if (t) this.cdp.post('Page.reload', {}, t.sessionId) }
  stop(id = this.activeId) { const t = this.tab(id); if (t) { this.cdp.post('Page.stopLoading', {}, t.sessionId); t.loading = false; t.progress = 1; this.changed() } }

  private session() { return this.active?.sessionId }

  private markInput() { if (!this.inputAt) this.inputAt = performance.now() }

  private capturing = false
  private heldInputs: (() => void)[] = []
  private inflightInputs = new Set<Promise<unknown>>()

  /**
   * All page input goes through here, in order. While a zoomed-in screenshot is being captured, Chrome briefly swaps the device
   * emulation and maps input coordinates at 1/zoom, so input is held until the capture ends, and captures wait for input in flight.
   */
  private input(method: string, params: Record<string, unknown>, sid: string): Promise<unknown> {
    return new Promise((resolve) => {
      const go = () => {
        const p = this.cdp.send(method, params, sid).catch(() => {})
        this.inflightInputs.add(p)
        void p.finally(() => { this.inflightInputs.delete(p); resolve(undefined) })
      }
      if (this.capturing) this.heldInputs.push(go); else go()
    })
  }

  /** Mouse moves are coalesced: at most one in flight, the latest position wins. */
  mouse(params: { type: 'mousePressed' | 'mouseReleased' | 'mouseMoved'; x: number; y: number; button?: string; buttons?: number; clickCount?: number; modifiers?: number }) {
    const sid = this.session()
    if (!sid) return
    const p = { button: 'none', buttons: 0, clickCount: 0, modifiers: 0, ...params }
    if (p.type !== 'mouseMoved') { this.markInput(); void this.input('Input.dispatchMouseEvent', p, sid); return }
    if (this.moveInFlight) { this.queuedMove = p; return }
    this.moveInFlight = true
    const t0 = performance.now()
    void this.input('Input.dispatchMouseEvent', p, sid).finally(() => {
      this.rtt = this.rtt ? this.rtt * 0.8 + (performance.now() - t0) * 0.2 : performance.now() - t0
      this.moveInFlight = false
      const q = this.queuedMove
      this.queuedMove = null
      if (q) this.mouse(q as never)
    })
  }

  /** Smooth wheel: deltas feed a glide that drains at most one CDP wheel event in flight, so bursts coalesce and line jumps become a scroll. */
  wheel(x: number, y: number, deltaX: number, deltaY: number, modifiers = 0, smooth = true) {
    const sid = this.session()
    if (!sid) return
    this.markInput()
    this.wheelAt = { x, y, modifiers }
    if (!smooth) { void this.input('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers, button: 'none' }, sid); return }
    this.glide.add(deltaX, deltaY)
    if (!this.wheelTimer) {
      this.wheelStepAt = performance.now() - 16
      this.wheelTimer = setInterval(() => this.wheelTick(), 12)
      this.wheelTick()
    }
  }

  /** True while a glide is still scrolling. */
  get scrolling() { return !!this.wheelTimer }

  private wheelTick() {
    if (this.wheelInFlight) return
    const sid = this.session()
    if (!sid || this.glide.idle) { if (this.wheelTimer) clearInterval(this.wheelTimer); this.wheelTimer = null; this.glide.clear(); return }
    const now = performance.now()
    const d = this.glide.step(Math.min(now - this.wheelStepAt, 50))
    this.wheelStepAt = now
    if (!d.deltaX && !d.deltaY) return
    this.wheelInFlight = true
    void this.input('Input.dispatchMouseEvent', { type: 'mouseWheel', ...this.wheelAt, deltaX: d.deltaX, deltaY: d.deltaY, button: 'none' }, sid).finally(() => { this.wheelInFlight = false })
  }

  keys(events: KeyEventParams[]) {
    const sid = this.session()
    if (!sid) return
    this.markInput()
    for (const e of events) void this.input('Input.dispatchKeyEvent', e as never, sid)
  }

  insertText(text: string) {
    const sid = this.session()
    if (!sid || !text) return
    this.markInput()
    void this.input('Input.insertText', { text }, sid)
  }

  async evaluate(expression: string, id = this.activeId): Promise<unknown> {
    const t = this.tab(id)
    if (!t) throw new Error('no tab')
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, t.sessionId)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'evaluation failed')
    return r.result.value ?? (r.result.type === 'undefined' ? undefined : r.result.description)
  }

  async screenshot(opts: { full?: boolean; format?: 'png' | 'jpeg' } = {}, id = this.activeId): Promise<Uint8Array> {
    const t = this.tab(id)
    if (!t) throw new Error('no tab')
    const r = await this.cdp.send('Page.captureScreenshot', { format: opts.format ?? 'png', captureBeyondViewport: !!opts.full, fromSurface: true }, t.sessionId)
    return decodeBase64(r.data)
  }

  /** The CSS cursor under a page point, so the terminal pointer can match links and text fields. */
  async cursorAt(x: number, y: number): Promise<string> {
    const expr = `(()=>{let e=document.elementFromPoint(${x},${y});if(!e)return'default';let c=getComputedStyle(e).cursor;if(c&&c!=='auto')return c;if(e.closest('a[href],button,[role=button],summary,label,select'))return'pointer';if(e.closest('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,[contenteditable=""],[contenteditable=true]'))return'text';return'default'})()`
    try { return String(await this.evaluate(expr)) } catch { return 'default' }
  }

  /** Find in page via window.find (which selects and scrolls to the match), plus a total count. */
  async find(query: string, opts: { backwards?: boolean; fromStart?: boolean } = {}): Promise<{ count: number; found: boolean; index: number }> {
    try { return (await this.evaluate(findExpression(query, opts))) as { count: number; found: boolean; index: number } } catch { return { count: 0, found: false, index: 0 } }
  }

  async close() {
    if (this.titleTimer) { clearTimeout(this.titleTimer); this.titleTimer = null }
    if (this.wheelTimer) { clearInterval(this.wheelTimer); this.wheelTimer = null }
    if (this.settleTimer) { clearTimeout(this.settleTimer); this.settleTimer = null }
    this.closing = true
    try { await Promise.race([this.cdp.send('Browser.close'), Bun.sleep(800)]) } catch {}
    this.cdp.close()
  }
}
