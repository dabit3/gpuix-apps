// Grovekeep's official mod loader. Reads <profile>/mods/*/manifest.json, imports each mod's bundle,
// hot-reloads when a bundle changes, appends to <profile>/logs/<name>.log, and runs debug console
// commands appended to <profile>/console.in (give <weapon>, spawn <enemy> [n], reload).
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Game, LogLine } from './engine'

export interface Manifest { id: string; name: string; version: string; entry: string; api: number; description?: string; hooks?: string[] }
export interface LoadedMod { manifest: Manifest; dir: string; mtime: number }

export class ModLoader {
  mods: LoadedMod[] = []
  reloads = 0
  private logFile: string | null
  private consoleOffset = 0
  private stamp = ''
  private loading = false

  constructor(public game: Game, public profile: string | null, opts: { logName?: string } = {}) {
    this.logFile = profile ? join(profile, 'logs', `${opts.logName ?? 'latest'}.log`) : null
    if (this.logFile) {
      mkdirSync(join(profile!, 'logs'), { recursive: true })
      writeFileSync(this.logFile, '')
    }
    game.onLog = (l) => this.write(l)
    const cin = profile ? join(profile, 'console.in') : null
    if (cin && existsSync(cin)) this.consoleOffset = statSync(cin).size
  }

  private write(l: LogLine) {
    if (!this.logFile) return
    const line = `${new Date().toISOString().slice(11, 23)} ${l.level.toUpperCase().padEnd(5)} [${l.src}] ${l.msg}\n`
    try { appendFileSync(this.logFile, line) } catch {}
  }

  modsDir() { return this.profile ? join(this.profile, 'mods') : null }

  scan(): Array<{ dir: string; manifest: Manifest; mtime: number }> {
    const root = this.modsDir()
    if (!root || !existsSync(root)) return []
    const out = []
    for (const name of readdirSync(root).sort()) {
      const dir = join(root, name)
      const mf = join(dir, 'manifest.json')
      if (!existsSync(mf)) continue
      try {
        const manifest = JSON.parse(readFileSync(mf, 'utf8')) as Manifest
        const entry = join(dir, manifest.entry || 'mod.js')
        if (!existsSync(entry)) { this.game.log('loader', `${name}: missing ${manifest.entry}`, 'warn'); continue }
        out.push({ dir, manifest, mtime: Math.max(statSync(entry).mtimeMs, statSync(mf).mtimeMs) })
      } catch (e) { this.game.log('loader', `${name}: bad manifest (${(e as Error).message})`, 'error') }
    }
    return out
  }

  async loadAll(reason = 'start') {
    if (this.loading) return
    this.loading = true
    try {
      const found = this.scan()
      this.stamp = found.map((f) => `${f.manifest.id}@${f.mtime}`).join('|')
      this.game.resetMods()
      this.mods = []
      if (reason !== 'start') this.reloads++
      this.game.log('loader', `${reason === 'start' ? 'loading' : 'reloading'} ${found.length} mod${found.length === 1 ? '' : 's'} from ${this.modsDir() ?? '(no profile)'}`)
      for (const f of found) {
        if (f.manifest.api !== 1) { this.game.log('loader', `${f.manifest.id}: needs mod API ${f.manifest.api}, game has 1`, 'error'); continue }
        try {
          // Import a uniquely named copy so a rebuilt bundle is evaluated fresh.
          const tmp = join(tmpdir(), `grovekeep-${f.manifest.id}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mjs`)
          copyFileSync(join(f.dir, f.manifest.entry || 'mod.js'), tmp)
          const mod = await import(tmp)
          const init = mod.default
          if (typeof init !== 'function') throw new Error('bundle has no default export')
          init(this.game.apiFor(f.manifest.id))
          this.mods.push({ manifest: f.manifest, dir: f.dir, mtime: f.mtime })
          this.game.log('loader', `loaded ${f.manifest.id} v${f.manifest.version}`)
        } catch (e) {
          this.game.log('loader', `${f.manifest.id} failed: ${(e as Error).message}`, 'error')
        }
      }
      this.game.emit('init', { mods: this.mods.map((m) => m.manifest.id) })
    } finally { this.loading = false }
  }

  // Called a few times a second by the host.
  async poll() {
    const found = this.scan()
    const stamp = found.map((f) => `${f.manifest.id}@${f.mtime}`).join('|')
    if (stamp !== this.stamp) await this.loadAll('reload')
    this.readConsole()
  }

  private readConsole() {
    if (!this.profile) return
    const cin = join(this.profile, 'console.in')
    if (!existsSync(cin)) return
    const size = statSync(cin).size
    if (size < this.consoleOffset) this.consoleOffset = 0
    if (size === this.consoleOffset) return
    const text = readFileSync(cin, 'utf8').slice(this.consoleOffset)
    this.consoleOffset = size
    for (const line of text.split('\n')) if (line.trim()) this.command(line.trim())
  }

  command(line: string) {
    const [cmd, a, b] = line.split(/\s+/)
    this.game.log('console', `> ${line}`)
    if (cmd === 'give' && a) this.game.give(a)
    else if (cmd === 'spawn' && a) this.game.spawn(a, Math.min(20, Number(b) || 1))
    else if (cmd === 'reload') void this.loadAll('reload')
    else this.game.log('console', `unknown command: ${line}`, 'warn')
  }
}
