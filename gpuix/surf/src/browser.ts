import { Cdp } from './cdp'
import { decodeBase64, imageSize, LatestFrame, RateMeter } from './frame'
import { findExpression } from './findpage'
import { securityOf, type Security } from './omnibox'
import type { KeyEventParams } from './input'

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
}

export interface Frame { bytes: Uint8Array; width: number; height: number; tabId: string; receivedAt: number; ack: () => void }
export interface Viewport { width: number; height: number; deviceScaleFactor: number; frameWidth: number; frameHeight: number }

const QUALITY = 82

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

  constructor(readonly cdp: Cdp) {}

  static async connect(wsUrl: string, opts: { viewport?: Viewport } = {}) {
    const cdp = await Cdp.connect(wsUrl)
    const b = new Browser(cdp)
    if (opts.viewport) b.viewport = opts.viewport
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
    c.on('Page.frameNavigated', (p, sid) => { const t = this.bySession(sid); if (t && !p.frame.parentId) { t.url = p.frame.url; t.security = securityOf(t.url); void this.refreshHistory(t); this.changed() } })
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
    const tab: Tab = { id: targetId, sessionId, url, title: '', loading: false, progress: 1, canBack: false, canForward: false, security: securityOf(url), requests: 0, finished: 0, crashed: false }
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
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: QUALITY, maxWidth: this.viewport.frameWidth, maxHeight: this.viewport.frameHeight, everyNthFrame: 1 }, t.sessionId).catch(() => {})
  }

  /** Headless screencast frames are capped by the window size, so the window must hold the full device-pixel frame at DPR > 1. */
  private async fitWindow() {
    const t = this.active
    if (!t) return
    const { frameWidth: w, frameHeight: h } = this.viewport
    const win = await this.cdp.send('Browser.getWindowForTarget', { targetId: t.id }).catch(() => null)
    if (win?.windowId != null) await this.cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { width: Math.max(w, 400), height: Math.max(h, 300) } }).catch(() => {})
  }

  private async applyViewport(t: Tab) {
    const v = this.viewport
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor, mobile: false }, t.sessionId).catch(() => {})
  }

  /** Resizes every tab's viewport; the active tab's screencast restarts at the new frame size. */
  async setViewport(v: Viewport) {
    const same = v.width === this.viewport.width && v.height === this.viewport.height && v.deviceScaleFactor === this.viewport.deviceScaleFactor
    this.viewport = v
    if (same) return
    await this.fitWindow()
    await Promise.all(this.tabs.map((t) => this.applyViewport(t)))
    const a = this.active
    if (a) { await this.cdp.send('Page.stopScreencast', {}, a.sessionId).catch(() => {}); await this.startScreencast(a) }
    this.changed()
  }

  private onScreencast(p: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }, sid?: string) {
    const tab = this.bySession(sid)
    let acked = false
    const ack = () => { if (!acked) { acked = true; this.cdp.post('Page.screencastFrameAck', { sessionId: p.sessionId }, sid) } }
    if (!tab || tab.id !== this.activeId) { ack(); return }
    const now = performance.now()
    if (this.inputAt) { const d = now - this.inputAt; if (d < 600) this.latency = this.latency ? this.latency * 0.7 + d * 0.3 : d; this.inputAt = 0 }
    const bytes = decodeBase64(p.data)
    // replaced (dropped) frames must still be acked or Chrome stops sending
    const size = imageSize(bytes)
    const stale = this.frames.push({ bytes, width: size?.width ?? this.viewport.frameWidth, height: size?.height ?? this.viewport.frameHeight, tabId: tab.id, receivedAt: now, ack })
    stale?.ack()
    this.fps.tick(now)
    // document.title set by script doesn't always produce targetInfoChanged; repaints are a cheap hint to re-read it
    if (!this.titleTimer) {
      const wait = Math.max(0, 1000 - (now - this.titleAt))
      this.titleTimer = setTimeout(() => { this.titleTimer = null; this.titleAt = performance.now(); const t = this.active; if (t) void this.refreshTitle(t) }, wait)
    }
    for (const fn of this.frameListeners) fn()
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

  /** Mouse moves are coalesced: at most one in flight, the latest position wins. */
  mouse(params: { type: 'mousePressed' | 'mouseReleased' | 'mouseMoved'; x: number; y: number; button?: string; buttons?: number; clickCount?: number; modifiers?: number }) {
    const sid = this.session()
    if (!sid) return
    const p = { button: 'none', buttons: 0, clickCount: 0, modifiers: 0, ...params }
    if (p.type !== 'mouseMoved') { this.markInput(); this.cdp.post('Input.dispatchMouseEvent', p, sid); return }
    if (this.moveInFlight) { this.queuedMove = p; return }
    this.moveInFlight = true
    const t0 = performance.now()
    this.cdp.send('Input.dispatchMouseEvent', p, sid).catch(() => {}).finally(() => {
      this.rtt = this.rtt ? this.rtt * 0.8 + (performance.now() - t0) * 0.2 : performance.now() - t0
      this.moveInFlight = false
      const q = this.queuedMove
      this.queuedMove = null
      if (q) this.mouse(q as never)
    })
  }

  wheel(x: number, y: number, deltaX: number, deltaY: number, modifiers = 0) {
    const sid = this.session()
    if (!sid) return
    this.markInput()
    this.cdp.post('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers, button: 'none' }, sid)
  }

  keys(events: KeyEventParams[]) {
    const sid = this.session()
    if (!sid) return
    this.markInput()
    for (const e of events) this.cdp.post('Input.dispatchKeyEvent', e as never, sid)
  }

  insertText(text: string) {
    const sid = this.session()
    if (!sid || !text) return
    this.markInput()
    this.cdp.post('Input.insertText', { text }, sid)
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
    this.closing = true
    try { await Promise.race([this.cdp.send('Browser.close'), Bun.sleep(800)]) } catch {}
    this.cdp.close()
  }
}
