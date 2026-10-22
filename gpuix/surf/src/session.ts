import { writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { Browser, type Tab } from './browser'
import { launchChrome, removeProfile, type ChromeProcess } from './chrome'
import { serve, type Handler } from './ipc'
import { resolveInput } from './omnibox'
import { parseZoom, viewportFor, zoomStep, type Box } from './input'

export type Focus = 'page' | 'omnibox' | 'find'

export interface SessionOptions { urls: string[]; dpr: number; chrome?: string; profile?: string; ipc?: boolean }

/** Owns Chrome, the CDP browser, the UI focus state and the control socket for one surf window. */
const RESIZE_MS = 50

export class Session {
  chrome: ChromeProcess | null = null
  browser: Browser | null = null
  error = ''
  dpr: number
  focus: Focus = 'page'
  findOpen = false
  findQuery = ''
  findCount = 0
  findIndex = 0
  omnibox = ''
  box: Box = { x: 0, y: 0, width: 0, height: 0 }
  painted = 0
  paintMs = 0
  private listeners = new Set<() => void>()
  private ipc: ReturnType<typeof serve> | null = null
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private resizedAt = 0
  private closed = false

  constructor(readonly opts: SessionOptions) { this.dpr = opts.dpr }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  ping() { for (const fn of this.listeners) fn() }

  get tab(): Tab | undefined { return this.browser?.active }

  async start() {
    try {
      const v = this.box.width > 0 ? viewportFor(this.box, this.dpr) : undefined
      this.chrome = await launchChrome({ executable: this.opts.chrome, profile: this.opts.profile, width: v?.width, height: v?.height })
      this.browser = await Browser.connect(this.chrome.wsUrl, { viewport: v })
      this.browser.onChange(() => { this.touch(); this.ping() })
      this.fitViewport()
      const [first, ...rest] = this.opts.urls.length ? this.opts.urls : ['https://news.ycombinator.com']
      await this.browser.navigate(resolveInput(first))
      for (const u of rest) await this.browser.newTab(resolveInput(u), false)
      if (this.opts.ipc !== false) this.ipc = serve(this.handlers())
    } catch (e) {
      this.error = (e as Error).message
    }
    this.ping()
  }

  /** Called from the page container's onLayout. Chrome follows live while a divider or window edge is dragged, at most every RESIZE_MS, plus once at the final size. */
  layout(box: Box) {
    const same = box.x === this.box.x && box.y === this.box.y && box.width === this.box.width && box.height === this.box.height
    this.box = box
    if (same || this.resizeTimer) return
    const wait = RESIZE_MS - (performance.now() - this.resizedAt)
    if (wait <= 0) { this.resizedAt = performance.now(); this.fitViewport(); return }
    this.resizeTimer = setTimeout(() => { this.resizeTimer = null; this.resizedAt = performance.now(); this.fitViewport() }, wait)
  }

  /** Sizes Chrome's viewport to the page box at this terminal's pixel ratio; Browser skips sizes it already has. */
  fitViewport() {
    const b = this.browser
    if (!b || this.box.width < 8 || this.box.height < 8) return
    void b.setViewport(viewportFor(this.box, this.dpr)).then(() => this.ping())
  }

  async go(input: string) {
    const b = this.browser
    if (!b || !input.trim()) return
    if (!b.active) await b.newTab(resolveInput(input))
    else await b.navigate(resolveInput(input))
  }

  async runFind(query: string, opts: { backwards?: boolean; fromStart?: boolean } = {}) {
    this.findQuery = query
    if (!this.browser || !query) { this.findCount = 0; this.findIndex = 0; this.ping(); return }
    const r = await this.browser.find(query, opts)
    this.findCount = r.count
    this.findIndex = r.index
    this.ping()
  }

  /** When the zoom last changed, so the UI can flash the level. */
  zoomedAt = 0
  private wheelZoom = 0

  /** Zooms the active tab: `in`/`out` step through Chrome's levels, `reset` goes back to 100%, a number sets the factor. */
  async zoom(to: 'in' | 'out' | 'reset' | number): Promise<number> {
    const b = this.browser, t = b?.active
    if (!b || !t) return 1
    const z = to === 'in' ? zoomStep(t.zoom, 1) : to === 'out' ? zoomStep(t.zoom, -1) : to === 'reset' ? 1 : to
    this.zoomedAt = performance.now()
    const r = await b.setZoom(z, t.id)
    this.ping()
    return r
  }

  /** Ctrl-scroll: accumulate wheel px so one notch or a short trackpad swipe is one zoom step. `dy` > 0 is wheel up = zoom in. */
  zoomWheel(dy: number) {
    if (Math.sign(dy) !== Math.sign(this.wheelZoom)) this.wheelZoom = 0
    this.wheelZoom += dy
    if (Math.abs(this.wheelZoom) < 50) return
    const dir = this.wheelZoom > 0 ? 'in' : 'out'
    this.wheelZoom = 0
    void this.zoom(dir)
  }

  info() {
    const b = this.browser, t = b?.active
    return {
      pid: process.pid,
      chrome: this.chrome?.version,
      url: t?.url ?? '',
      title: t?.title ?? '',
      tabs: b?.tabs.length ?? 0,
      viewport: b ? `${b.viewport.width}x${b.viewport.height}@${b.viewport.deviceScaleFactor}x` : '',
      fps: b ? b.fps.rate() : 0,
      zoom: `${Math.round((t?.zoom ?? 1) * 100)}%`,
      latencyMs: b ? Math.round(b.latency) : 0,
      dropped: b?.frames.dropped ?? 0,
    }
  }

  private touch() { const t = this.tab; this.ipc?.touch({ url: t?.url, title: t?.title }) }

  /** Commands the `surf <cmd>` CLI sends over ~/.surf/run/<pid>.sock. */
  handlers(): Record<string, Handler> {
    const need = () => { if (!this.browser) throw new Error('browser not ready'); return this.browser }
    const tabList = () => need().tabs.map((t, i) => ({ index: i + 1, active: t.id === need().activeId, title: t.title, url: t.url }))
    return {
      open: async ([url]) => { const b = need(); const tab = await b.newTab(resolveInput(url ?? 'about:blank')); this.ping(); return { tab: b.tabs.findIndex((t) => t.id === tab.id) + 1, url: resolveInput(url ?? 'about:blank') } },
      go: async ([url]) => { if (!url) throw new Error('usage: surf go <url|search>'); await this.go(url); return { url: resolveInput(url) } },
      back: async () => { await need().back(); return 'ok' },
      forward: async () => { await need().forward(); return 'ok' },
      reload: async () => { need().reload(); return 'ok' },
      close: async ([n]) => { const b = need(); const t = n ? b.tabs[Number(n) - 1] : b.active; if (!t) throw new Error(`no tab ${n}`); await b.closeTab(t.id); return 'ok' },
      tabs: async () => tabList(),
      tab: async ([n]) => { const b = need(); const t = b.tabs[Number(n) - 1]; if (!t) throw new Error(`no tab ${n}`); await b.activate(t.id); return tabList() },
      info: async () => this.info(),
      eval: async ([expr]) => { if (!expr) throw new Error('usage: surf eval <js>'); return need().evaluate(expr) },
      shot: async ([path, full]) => {
        if (!path || !isAbsolute(path)) throw new Error('shot needs an absolute path')
        const png = await need().screenshot({ full: full === 'full' })
        writeFileSync(path, png)
        return { path, bytes: png.length }
      },
      zoom: async ([arg]) => { const t = need().active; if (!t) throw new Error('no tab'); const z = arg ? await this.zoom(parseZoom(arg, t.zoom)) : t.zoom; return `${Math.round(z * 100)}%` },
      find: async ([q]) => { this.findOpen = true; await this.runFind(q ?? '', { fromStart: true }); return { query: q, count: this.findCount, index: this.findIndex } },
    }
  }

  /** Closes Chrome and waits for the process so no orphan is left behind. */
  async close() {
    if (this.closed) return
    this.closed = true
    this.ipc?.stop()
    try { await Promise.race([this.browser?.close(), Bun.sleep(800)]) } catch {}
    const c = this.chrome
    if (c) {
      c.kill()
      await Promise.race([c.proc.exited, Bun.sleep(1500)])
      try { c.proc.kill('SIGKILL') } catch {}
      removeProfile(c.profile)
    }
  }
}

export const absolute = (p: string, cwd = process.cwd()) => (isAbsolute(p) ? p : resolve(cwd, p))
