import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { scanRepo, type RepoScan } from './scan'
import { parseAgent, writeCapable, type AgentSpec } from './templates'
import { plan, writeOne, ensureGitignore, type FilePlan } from './writer'
import { emptyRun, type RunState } from './run'
import { startClaude, startReplay, type Engine } from './engine-claude'
import { startApi } from './engine-api'

export type View = 'setup' | 'run' | 'review'
export type EngineKind = 'claude' | 'api' | 'replay'
export interface Check { id: string; label: string; ok: boolean | null; detail: string }

export interface StoreOptions { root: string; engine: EngineKind; task?: string; replay?: string; replayMs?: number; autoWrite?: boolean; autoRun?: boolean }

export function pickTask(s: RepoScan): string {
  for (const f of s.files) {
    if (!/\.(ts|tsx|js|py|go|rs)$/.test(f) || /test|spec/.test(f)) continue
    let text = ''
    try { text = readFileSync(join(s.root, f), 'utf8') } catch { continue }
    const lines = text.split('\n')
    const i = lines.findIndex((l) => /(\/\/|#)\s*(TODO|FIXME|BUG)\b/.test(l))
    if (i >= 0) return `Fix the ${f}:${i + 1} TODO (${lines[i].replace(/^.*?(TODO|FIXME|BUG)[:\s]*/, '').trim()}) and add the missing test.`
  }
  return 'Pick one small real bug or missing test in this repo, fix it and add the test.'
}

export class Store {
  scan: RepoScan
  files: FilePlan[] = []
  agents: Record<string, AgentSpec | null> = {}
  selected = 0
  view: View = 'setup'
  run: RunState
  task: string
  tick = 0
  notice = ''
  diff = ''
  private engine: Engine | null = null
  private listeners = new Set<() => void>()
  private stamp = ''
  private timers: ReturnType<typeof setInterval>[] = []

  constructor(public opts: StoreOptions) {
    this.scan = scanRepo(opts.root)
    this.task = opts.task ?? pickTask(this.scan)
    this.run = emptyRun(opts.engine === 'replay' ? 'claude' : opts.engine)
    this.refresh()
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  snapshot = () => this.tick
  changed() { this.tick++; for (const fn of this.listeners) fn() }

  start() {
    this.timers.push(setInterval(() => this.poll(), 600))
    this.timers.push(setInterval(() => { if (this.run.status === 'running') this.changed() }, 100))
    if (this.opts.autoWrite) this.write()
    if (this.opts.autoRun) setTimeout(() => this.dryRun(), 400)
  }
  dispose() { for (const t of this.timers) clearInterval(t); this.engine?.stop() }

  /** Re-reads the target repo's .claude config so edits made in another pane show up live. */
  poll() {
    const s = this.fsStamp()
    if (s !== this.stamp) { this.refresh(); this.changed() }
  }
  private fsStamp() {
    const parts: string[] = []
    const walk = (d: string) => {
      let names: string[] = []
      try { names = readdirSync(join(this.scan.root, d)) } catch { return }
      for (const n of names) {
        if (n === 'state' || n === 'advisor-runs') continue
        const p = join(d, n)
        try { const st = statSync(join(this.scan.root, p)); if (st.isDirectory()) walk(p); else parts.push(`${p}:${st.mtimeMs}:${st.size}`) } catch {}
      }
    }
    walk('.claude')
    for (const f of ['CLAUDE.md', '.gitignore']) { try { const st = statSync(join(this.scan.root, f)); parts.push(`${f}:${st.mtimeMs}:${st.size}`) } catch {} }
    return parts.join('|')
  }
  refresh() {
    this.files = plan(this.scan)
    this.stamp = this.fsStamp()
    for (const n of ['scout', 'advisor']) {
      try { this.agents[n] = parseAgent(readFileSync(join(this.scan.root, `.claude/agents/${n}.md`), 'utf8')) } catch { this.agents[n] = null }
    }
    if (this.selected >= this.files.length) this.selected = 0
  }

  get written() { return this.files.every((f) => f.status === 'same') }

  write() {
    for (const f of this.files) if (f.status !== 'same') writeOne(this.scan.root, f)
    ensureGitignore(this.scan.root)
    const n = this.files.filter((f) => f.status !== 'same').length
    this.notice = n ? `wrote ${n} file${n === 1 ? '' : 's'}` : 'setup already up to date'
    this.refresh(); this.changed()
  }

  checks(): Check[] {
    const s = this.agents.scout, a = this.agents.advisor
    const cps = new Set(this.run.verdicts.map((v) => v.checkpoint))
    const scoutWrite = s ? writeCapable(s.tools) : []
    return [
      { id: 'scout-model', label: 'scout runs on haiku', ok: s ? s.model === 'haiku' : null, detail: s ? `model: ${s.model}` : 'not written' },
      { id: 'advisor-model', label: 'advisor runs on opus', ok: a ? a.model === 'opus' : null, detail: a ? `model: ${a.model}` : 'not written' },
      { id: 'scout-readonly', label: 'scouts cannot edit', ok: s ? scoutWrite.length === 0 : null, detail: s ? (scoutWrite.length ? `has ${scoutWrite.join(', ')}` : 'no Edit / Write / unscoped Bash') : 'not written' },
      { id: 'advisor-readonly', label: 'advisor is read-only', ok: a ? writeCapable(a.tools).length === 0 : null, detail: a ? a.tools.slice(0, 3).join(', ') : 'not written' },
      { id: 'cp1', label: 'checkpoint 1 before edits', ok: this.run.status === 'idle' ? null : cps.has(1) ? true : this.run.status === 'running' ? null : false, detail: cps.has(1) ? 'plan reviewed' : 'not yet' },
      { id: 'cp3', label: 'checkpoint 3 before done', ok: this.run.status === 'idle' ? null : cps.has(3) ? true : this.run.status === 'running' ? null : false, detail: cps.has(3) ? 'diff reviewed' : 'not yet' },
    ]
  }

  dryRun() {
    if (this.run.status === 'running') return
    if (!this.written) this.write()
    this.engine?.stop()
    this.run = { ...emptyRun(this.opts.engine === 'replay' ? 'claude' : this.opts.engine), status: 'running', startedAt: Date.now() }
    this.diff = ''
    this.view = 'run'
    this.notice = ''
    const emit = (fn: (s: RunState) => void) => { fn(this.run); this.changed() }
    const scan = scanRepo(this.scan.root)
    if (this.opts.engine === 'api') this.engine = startApi(scan, this.task, emit)
    else if (this.opts.engine === 'replay') this.engine = startReplay(this.opts.replay!, emit, this.opts.replayMs ?? 110)
    else this.engine = startClaude(scan, this.task, emit)
    this.engine.done.then(() => this.loadDiff())
    this.changed()
  }

  async loadDiff() {
    if (this.opts.engine === 'replay') return
    const p = Bun.spawn(['git', 'diff', '--', '.', ':!PLAN.md', ':!.claude', ':!CLAUDE.md', ':!.gitignore'], { cwd: this.scan.root, stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' })
    this.diff = (await new Response(p.stdout).text()).trim()
    this.changed()
  }

  setView(v: View) { this.view = v; this.changed() }
  select(i: number) { this.selected = Math.max(0, Math.min(this.files.length - 1, i)); this.view = 'setup'; this.changed() }
}
