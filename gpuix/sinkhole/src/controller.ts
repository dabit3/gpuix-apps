import { runBench, type BenchResult } from './bench'
import { Matcher, normalizeDomain } from './dns/blocklist'
import type { BlockMode } from './dns/packet'
import { Sinkhole } from './dns/server'
import { loadBlocklist, saveConfig, updateBlocklist, type Config, type ListMeta } from './lists'

export type Tab = 'live' | 'top' | 'rules'

export interface ControllerOptions {
  host?: string
  port?: number
  upstreams?: string[]
  blockMode?: BlockMode
  cacheSize?: number
  listFile?: string
  config?: Config
  persist?: boolean
  /** Inject a ready matcher (tests). */
  matcher?: Matcher
  meta?: ListMeta
}

/** App state around the sinkhole: rules, toggles, bench and list updates. The UI only reads it and calls actions. */
export class Controller {
  readonly dns: Sinkhole
  meta: ListMeta
  config: Config
  tab: Tab = 'live'
  filter = ''
  draft = ''
  bench: { running: boolean; done: number; total: number; result?: BenchResult } = { running: false, done: 0, total: 0 }
  update: { running: boolean; error?: string } = { running: false }
  flash = ''
  private persist: boolean
  private version = 0
  private listeners = new Set<() => void>()

  constructor(o: ControllerOptions = {}) {
    this.config = o.config ?? { allow: [], deny: [] }
    this.persist = o.persist ?? false
    let matcher = o.matcher
    if (matcher) this.meta = o.meta ?? { source: 'test', domains: matcher.list.size, updated: '', bytes: matcher.list.size * 5 }
    else {
      const loaded = loadBlocklist(o.listFile)
      matcher = new Matcher(loaded.list)
      this.meta = loaded.meta
    }
    for (const a of this.config.allow) matcher.allow.add(a)
    for (const d of this.config.deny) matcher.deny.add(d)
    this.dns = new Sinkhole({
      host: o.host,
      port: o.port,
      upstreams: o.upstreams ?? this.config.upstreams,
      blockMode: o.blockMode ?? this.config.blockMode,
      cacheSize: o.cacheSize,
      matcher,
    })
    this.dns.onQuery(() => this.bump())
  }

  get rev() { return this.version + this.dns.stats.version }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  ping() { this.bump() }
  private bump() { this.version++; for (const fn of this.listeners) fn() }
  private say(msg: string) { this.flash = msg; this.bump() }

  start() { return this.dns.start() }
  stop() { this.dns.stop() }

  private save() {
    this.config.allow = [...this.dns.matcher.allow].sort()
    this.config.deny = [...this.dns.matcher.deny].sort()
    this.config.upstreams = this.dns.upstreams.map((u) => u.label)
    this.config.blockMode = this.dns.blockMode
    if (this.persist) saveConfig(this.config)
  }

  toggleBlocking() {
    if (this.dns.pausedFor > 0) this.dns.pause(0)
    else this.dns.enabled = !this.dns.enabled
    this.say(this.dns.blocking ? 'Blocking on' : 'Blocking off')
  }
  pause(minutes: number) {
    this.dns.enabled = true
    this.dns.pause(this.dns.pausedFor > 0 && minutes === 0 ? 0 : minutes)
    this.say(minutes ? `Paused for ${minutes} min` : 'Blocking resumed')
  }
  toggleMode() {
    this.dns.blockMode = this.dns.blockMode === 'null' ? 'nxdomain' : 'null'
    this.save()
    this.say(this.dns.blockMode === 'null' ? 'Blocked names answer 0.0.0.0 / ::' : 'Blocked names answer NXDOMAIN')
  }
  toggleCache() {
    this.dns.cacheEnabled = !this.dns.cacheEnabled
    if (!this.dns.cacheEnabled) this.dns.cache.clear()
    this.say(this.dns.cacheEnabled ? 'Cache on' : 'Cache off')
  }
  setTab(t: Tab) { this.tab = t; this.bump() }
  setFilter(f: string) { this.filter = f; this.bump() }
  setDraft(d: string) { this.draft = d; this.bump() }
  clearStats() { this.dns.stats.reset(); this.dns.cache.clear(); this.say('Stats and cache cleared') }

  /** Adds a deny or allow rule; a name moves between lists rather than living in both. */
  addRule(kind: 'deny' | 'allow', raw: string): boolean {
    const d = normalizeDomain(raw)
    if (!d) { this.say(`"${raw.trim()}" is not a domain`); return false }
    const m = this.dns.matcher
    ;(kind === 'deny' ? m.allow : m.deny).delete(d)
    ;(kind === 'deny' ? m.deny : m.allow).add(d)
    this.dns.cache.clear()
    this.save()
    this.say(kind === 'deny' ? `Blocking ${d}` : `Allowing ${d}`)
    return true
  }
  removeRule(kind: 'deny' | 'allow', d: string) {
    ;(kind === 'deny' ? this.dns.matcher.deny : this.dns.matcher.allow).delete(d)
    this.dns.cache.clear()
    this.save()
    this.say(`Removed ${d}`)
  }
  submitDraft(kind: 'deny' | 'allow' = 'deny') {
    if (this.addRule(kind, this.draft)) this.setDraft('')
  }
  rules() {
    const m = this.dns.matcher
    return [...[...m.deny].map((d) => ({ kind: 'deny' as const, domain: d })), ...[...m.allow].map((d) => ({ kind: 'allow' as const, domain: d }))].sort((a, b) => a.domain.localeCompare(b.domain))
  }
  setUpstreams(raw: string) {
    const list = raw.split(/[\s,]+/).filter(Boolean)
    try { this.dns.setUpstreams(list); this.save(); this.say(`Upstream ${this.dns.upstreams.map((u) => u.label).join(', ')}`) } catch (e) { this.say(String((e as Error).message)) }
  }

  async runBench(n = 1000, rate?: number) {
    if (this.bench.running) return
    this.bench = { running: true, done: 0, total: n }
    this.bump()
    let last = 0
    const result = await runBench({
      host: this.dns.host === '0.0.0.0' ? '127.0.0.1' : this.dns.host,
      port: this.dns.port,
      n,
      rate,
      concurrency: 16,
      onProgress: (done, total) => { this.bench.done = done; this.bench.total = total; if (done - last >= 25) { last = done; this.bump() } },
    })
    this.bench = { running: false, done: n, total: n, result }
    this.say(`Bench: ${result.answered}/${result.sent} answered · ${result.qps.toFixed(0)} q/s · ads sunk ${result.blockedOk}/${result.adsExpected}`)
  }

  async updateList(source?: string) {
    if (this.update.running) return
    this.update = { running: true }
    this.bump()
    try {
      const { list, meta } = await updateBlocklist(source)
      this.dns.matcher.list = list
      this.meta = meta
      this.dns.cache.clear()
      this.update = { running: false }
      this.say(`Blocklist updated: ${meta.domains.toLocaleString('en-US')} domains`)
    } catch (e) {
      this.update = { running: false, error: String((e as Error).message) }
      this.say(`Update failed: ${(e as Error).message}`)
    }
  }
}
