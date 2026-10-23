// App state: the files, per-kind settings, the conversion queue, and live previews. UI-free so tests can drive it.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, watch, type FSWatcher, openSync, readSync, closeSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULTS, MAX_DIMS, PRESETS, isConverted, outputPath, parseProgress, plan, targetsFor, type Engines, type PresetId, type Settings, type Source } from './formats'
import { excerpt, previewCrop, previewEncode, probe, run, thumbnail, type EngineInfo, type Preview } from './engines'
import { sniff, type Kind } from './sniff'

export type JobState = 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface FileItem {
  id: number
  path: string
  name: string
  size: number
  src: Source & { label: string }
  meta: { codec?: string; fps?: number; channels?: number; sampleRate?: number }
  checked: boolean
  thumb: string | null
  text: string | null
  crop: { path: string; w: number; h: number } | null
  state: JobState
  progress: number
  speed: string | null
  output: string | null
  outputSize: number | null
  outputThumb: string | null
  error: string | null
  ms: number | null
}

export interface Rejected { path: string; reason: string }

type Listener = () => void

export class Store {
  files: FileItem[] = []
  /** Every output written this session, including ones whose row was later re-run or canceled. */
  private written = { done: 0, before: 0, after: 0 }
  rejected: Rejected[] = []
  focus = 0
  settings: Record<Kind, Settings> = structuredClone(DEFAULTS)
  preview: Preview | null = null
  previewBusy = false
  log: string[] = []
  readonly concurrency: number
  readonly cache: string
  private listeners = new Set<Listener>()
  private nextId = 1
  private controllers = new Map<number, AbortController>()
  private reserved = new Set<string>()
  private watchers: FSWatcher[] = []
  private previewAbort: AbortController | null = null
  private previewTimer: ReturnType<typeof setTimeout> | null = null
  version = 0

  constructor(readonly info: EngineInfo, opts: { concurrency?: number; cache?: string; color?: (k: Kind) => string } = {}) {
    this.concurrency = opts.concurrency ?? Math.max(1, availableParallelism() - 1)
    this.cache = opts.cache ?? join(tmpdir(), `convt-${process.pid}`)
    this.color = opts.color ?? (() => '#71b7ff')
  }
  private color: (k: Kind) => string

  get engines(): Engines { return this.info.engines }
  get focused(): FileItem | undefined { return this.files[this.focus] }

  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  emit() { this.version++; for (const l of this.listeners) l() }

  /** Adds files (and the files inside directories). Returns how many were accepted. */
  async add(paths: string[], opts: { watch?: boolean } = {}): Promise<number> {
    let n = 0
    for (const raw of paths) {
      const p = resolve(raw)
      if (!existsSync(p)) { this.rejected.push({ path: raw, reason: 'not found' }); continue }
      if (statSync(p).isDirectory()) {
        for (const f of readdirSync(p).sort()) if (!f.startsWith('.')) n += (await this.addFile(join(p, f), true)) ? 1 : 0
        if (opts.watch) this.watchDir(p)
      } else n += (await this.addFile(p, false)) ? 1 : 0
    }
    this.emit()
    return n
  }

  private async addFile(path: string, quiet: boolean): Promise<boolean> {
    if (this.files.some((f) => f.path === path)) return false
    if (isConverted(path)) return false
    let st
    try { st = statSync(path) } catch { return false }
    if (!st.isFile()) return false
    const head = new Uint8Array(4096)
    const fd = openSync(path, 'r')
    const len = readSync(fd, head, 0, 4096, 0)
    closeSync(fd)
    const s = sniff(head.subarray(0, len), path)
    if (!s) { if (!quiet) this.rejected.push({ path, reason: 'unknown format' }); this.emit(); return false }
    const name = path.split('/').pop()!
    const item: FileItem = {
      id: this.nextId++, path, name, size: st.size, src: { path, kind: s.kind, format: s.format, label: s.label }, meta: {},
      checked: false, thumb: null, text: null, crop: null, state: 'idle', progress: 0, speed: null, output: null, outputSize: null, outputThumb: null, error: null, ms: null,
    }
    this.files.push(item)
    this.emit()
    void this.load(item)
    return true
  }

  private async load(item: FileItem) {
    const p = await probe(item.src, this.engines)
    const { codec, fps, channels, sampleRate, ...src } = p
    Object.assign(item.src, src)
    item.meta = { codec, fps, channels, sampleRate }
    this.emit()
    if (item.src.kind === 'doc') item.text = await excerpt(item.src, this.engines)
    else item.thumb = await thumbnail(item.src, this.engines, this.cache, this.color(item.src.kind))
    this.emit()
    if (item.src.kind === 'image') {
      item.crop = await previewCrop(item.src, this.engines, this.cache)
      if (item === this.focused) this.schedulePreview(0)
    }
  }

  private watchDir(dir: string) {
    try {
      const w = watch(dir, (_e, f) => {
        if (!f || f.startsWith('.')) return
        // Let writers finish (cp, ffmpeg in another pane) before sniffing.
        setTimeout(() => { void this.addFile(join(dir, f), true) }, 400)
      })
      this.watchers.push(w)
    } catch {}
  }

  dispose() {
    for (const w of this.watchers) w.close()
    this.cancelAll()
    this.previewAbort?.abort()
    try { rmSync(this.cache, { recursive: true, force: true }) } catch {}
  }

  // ---- selection and settings ----

  setFocus(i: number) {
    if (!this.files.length) return
    const n = Math.max(0, Math.min(this.files.length - 1, i))
    if (n === this.focus) return
    this.focus = n
    this.emit()
    this.schedulePreview(0)
  }
  moveFocus(d: number) { this.setFocus(this.focus + d) }
  toggleCheck(i = this.focus) { const f = this.files[i]; if (f) { f.checked = !f.checked; this.emit() } }
  checkAll() {
    const all = this.files.every((f) => f.checked)
    for (const f of this.files) f.checked = !all
    this.emit()
  }

  /** Files a Convert press acts on: the checked ones, else the focused one. */
  selection(): FileItem[] {
    const checked = this.files.filter((f) => f.checked)
    return checked.length ? checked : this.focused ? [this.focused] : []
  }

  kind(): Kind | null { return this.focused?.src.kind ?? null }
  current(): Settings | null { const k = this.kind(); return k ? this.settings[k] : null }
  targets() { const f = this.focused; return f ? targetsFor(f.src, this.engines) : [] }

  update(patch: Partial<Settings>) {
    const k = this.kind()
    if (!k) return
    const s = this.settings[k]
    const manual = 'quality' in patch || 'maxDim' in patch
    Object.assign(s, patch)
    if (manual && !('preset' in patch)) s.preset = null
    this.emit()
    this.schedulePreview(90)
  }

  setTarget(id: string) {
    const t = this.targets().find((x) => x.id === id)
    if (t?.available) this.update({ target: id })
  }
  cycleTarget(d: number) {
    const ts = this.targets().filter((t) => t.available)
    const s = this.current()
    if (!ts.length || !s) return
    const i = ts.findIndex((t) => t.id === s.target)
    this.update({ target: ts[(i + d + ts.length) % ts.length]!.id })
  }
  nudgeQuality(d: number) { const s = this.current(); if (s) this.update({ quality: Math.max(1, Math.min(100, s.quality + d)) }) }
  applyPreset(p: PresetId) { const pr = PRESETS[p]; this.update({ preset: p, quality: pr.quality, maxDim: pr.maxDim }) }
  cycleMaxDim() { const s = this.current(); if (!s) return; const i = MAX_DIMS.indexOf(s.maxDim as (typeof MAX_DIMS)[number]); this.update({ maxDim: MAX_DIMS[(i + 1) % MAX_DIMS.length]! }) }

  /** The target a file will convert to, if it's currently valid. */
  targetOf(f: FileItem) {
    const s = this.settings[f.src.kind]
    const ts = targetsFor(f.src, this.engines)
    return ts.find((t) => t.id === s.target && t.available) ?? ts.find((t) => t.available) ?? null
  }

  // ---- live preview ----

  schedulePreview(ms: number) {
    if (this.previewTimer) clearTimeout(this.previewTimer)
    this.previewTimer = setTimeout(() => { void this.renderPreview() }, ms)
  }

  private async renderPreview() {
    this.previewAbort?.abort()
    const f = this.focused
    if (!f || f.src.kind !== 'image' || !f.crop) { if (this.preview) { this.preview = null; this.emit() } return }
    const s = this.settings.image
    const ac = new AbortController()
    this.previewAbort = ac
    this.previewBusy = true
    this.emit()
    const p = await previewEncode(f.src, f.crop, s, this.engines, this.cache, ac.signal)
    if (ac.signal.aborted) return
    this.previewBusy = false
    this.preview = p
    this.emit()
  }

  // ---- conversion queue ----

  convert(items = this.selection()) {
    for (const f of items) {
      if (f.state === 'queued' || f.state === 'running') continue
      if (!this.targetOf(f)) { f.state = 'failed'; f.error = 'no available target'; continue }
      f.state = 'queued'
      f.progress = 0
      f.error = null
    }
    this.emit()
    this.pump()
  }

  private running() { return this.files.filter((f) => f.state === 'running').length }

  private pump() {
    while (this.running() < this.concurrency) {
      const next = this.files.find((f) => f.state === 'queued')
      if (!next) return
      void this.runJob(next)
    }
  }

  private async runJob(f: FileItem) {
    const t = this.targetOf(f)!
    const s = { ...this.settings[f.src.kind], target: t.id }
    const exists = (p: string) => existsSync(p) || this.reserved.has(p)
    const out = outputPath(f.path, t.ext, exists)
    this.reserved.add(out)
    const ac = new AbortController()
    this.controllers.set(f.id, ac)
    f.state = 'running'
    f.progress = 0
    f.speed = null
    f.output = out
    f.outputSize = null
    f.outputThumb = null
    this.emit()
    const t0 = performance.now()
    let p
    try { p = plan(f.src, s, this.engines, out, this.cache) } catch (e) { return this.finish(f, ac, 'failed', String((e as Error).message)) }
    const n = p.steps.length
    let err: string | null = null
    for (let i = 0; i < n && !ac.signal.aborted; i++) {
      const step = p.steps[i]!
      let last = 0
      const r = await run(step.cmd, {
        signal: ac.signal,
        stdoutTo: step.stdoutTo,
        onStdout: step.progress
          ? (chunk) => {
              const pr = parseProgress(chunk)
              const sp = /speed=\s*([\d.]+x)/.exec(chunk)
              if (sp) f.speed = sp[1]!
              if (pr.seconds != null && f.src.duration) {
                f.progress = (i + Math.min(1, pr.seconds / f.src.duration)) / n
                const now = performance.now()
                if (now - last > 50) { last = now; this.emit() }
              }
            }
          : undefined,
      })
      if (ac.signal.aborted) break
      if (r.code !== 0) { err = r.stderr.trim().split('\n').pop()?.slice(0, 160) || `exit ${r.code}`; break }
      f.progress = (i + 1) / n
      this.emit()
    }
    for (const tmp of p.temps) rmSync(tmp, { recursive: true, force: true })
    if (ac.signal.aborted) { rmSync(out, { force: true }); return this.finish(f, ac, 'canceled', null) }
    if (err || !existsSync(out) || statSync(out).size === 0) { rmSync(out, { force: true }); return this.finish(f, ac, 'failed', err ?? 'no output written') }
    f.outputSize = statSync(out).size
    f.ms = performance.now() - t0
    this.written.done++
    this.written.before += f.size
    this.written.after += f.outputSize
    this.finish(f, ac, 'done', null)
    if (t.ext !== 'ico' && (f.src.kind === 'image' || f.src.kind === 'video' || f.src.kind === 'pdf') && t.id !== 'm4a' && t.id !== 'mp3') {
      const kind = f.src.kind === 'pdf' ? 'image' : t.id === 'gif' ? 'image' : f.src.kind
      const fmt = t.id === 'jpg' ? 'jpeg' : t.ext
      f.outputThumb = await thumbnail({ path: out, kind, format: fmt, duration: f.src.duration }, this.engines, this.cache, this.color(kind))
      this.emit()
    }
  }

  private finish(f: FileItem, ac: AbortController, state: JobState, error: string | null) {
    this.controllers.delete(f.id)
    if (f.output && state !== 'done') { this.reserved.delete(f.output); f.output = null }
    f.state = state
    f.error = error
    if (state !== 'done') f.progress = 0
    this.log.push(`${state} ${f.name}${error ? `: ${error}` : ''}`)
    this.emit()
    this.pump()
  }

  cancel(f: FileItem | undefined = this.focused) {
    if (!f) return
    if (f.state === 'queued') { f.state = 'canceled'; this.emit(); return }
    this.controllers.get(f.id)?.abort()
  }
  cancelAll() {
    for (const f of this.files) if (f.state === 'queued') f.state = 'canceled'
    for (const c of this.controllers.values()) c.abort()
    this.emit()
  }

  reveal(f: FileItem | undefined = this.focused) {
    if (f?.output) void run(['open', '-R', f.output])
  }

  stats() {
    const { done, before, after } = this.written
    return {
      done,
      running: this.running(),
      queued: this.files.filter((f) => f.state === 'queued').length,
      failed: this.files.filter((f) => f.state === 'failed').length,
      before,
      after,
    }
  }
}

export const readHead = (p: string) => new Uint8Array(readFileSync(p).subarray(0, 4096))
