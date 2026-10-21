// The modder pipeline shared by the TUI and the subcommands:
// recon → hooks → write-mod (+ assets) → build → test-in-game → (install --yes)
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { generateSword, sampleStyle, spritePng, type SpriteDef } from './assets'
import { guard, isInside, safeCopy, safeWrite, type GuardCtx } from './guard'
import { hooksMarkdown, scanHooks, type Hook } from './hooks'
import { encodePng } from './png'
import { recon, type Recon } from './recon'
import { TEMPLATES, manifestFor, modSource, slug, type Knobs, type TemplateId } from './templates'

export interface BuildResult { ok: boolean; ms: number; bytes: number; out: string; error?: string }
export interface TestResult { ok: boolean; seconds: number; kills: number; projectiles: number; errors: string[]; log: string[]; screenshot: string; rgba: Uint8Array; w: number; h: number }

export function workspaceFor(gameDir: string, cwd = process.cwd()) {
  const local = join(cwd, '.modder', basename(resolve(gameDir)))
  return isInside(local, gameDir) ? join(homedir(), '.modder', basename(resolve(gameDir))) : local
}

export class Workbench {
  recon: Recon
  hooks: Hook[] = []
  hooksNote = ''
  template: TemplateId = 'sword'
  knobs: Knobs = { ...TEMPLATES.sword.defaults }
  sprite: SpriteDef | null = null
  lastBuild: BuildResult | null = null
  lastTest: TestResult | null = null
  ctx: GuardCtx
  constructor(public gameDir: string, public workspace = workspaceFor(gameDir), yes = false) {
    this.gameDir = resolve(gameDir)
    this.ctx = { gameDir: this.gameDir, yes, written: [] }
    this.recon = recon(this.gameDir)
  }
  get profile() { return join(this.workspace, 'profile') }
  get modId() { return slug(this.knobs.name) }
  get srcDir() { return join(this.workspace, 'src', this.modId) }
  get supported() { return this.recon.supported }

  writeRecon() { safeWrite(join(this.workspace, 'recon.json'), JSON.stringify(this.recon, null, 2) + '\n', this.ctx); return join(this.workspace, 'recon.json') }

  scan() {
    const r = scanHooks(this.recon)
    this.hooks = r.hooks
    this.hooksNote = r.note
    if (this.hooks.length) safeWrite(join(this.workspace, 'hooks.md'), hooksMarkdown(this.recon, this.hooks), this.ctx)
    return r
  }

  setTemplate(t: TemplateId) { this.template = t; this.knobs = { ...TEMPLATES[t].defaults }; this.sprite = null }

  makeAssets() {
    if (this.template !== 'sword') return null
    this.sprite = generateSword(sampleStyle(this.gameDir), this.knobs.color)
    safeWrite(join(this.srcDir, 'sprite.json'), JSON.stringify(this.sprite, null, 2), this.ctx)
    safeWrite(join(this.srcDir, 'sprite.png'), spritePng(this.sprite), this.ctx)
    return this.sprite
  }

  writeMod() {
    if (!this.supported) throw new Error(`${this.recon.engine}: write-mod only runs end to end for Grovekeep here. Plan: ${this.recon.plan.join(' → ')}`)
    if (this.template === 'sword') this.makeAssets()
    const modApi = relative(this.srcDir, join(this.gameDir, 'modapi.ts')).replace(/\.ts$/, '')
    const src = modSource(this.template, this.knobs, modApi.startsWith('.') ? modApi : './' + modApi, this.sprite ?? undefined)
    safeWrite(join(this.srcDir, 'mod.ts'), src, this.ctx)
    safeWrite(join(this.srcDir, 'manifest.json'), JSON.stringify(manifestFor(this.template, this.knobs), null, 2) + '\n', this.ctx)
    return { file: join(this.srcDir, 'mod.ts'), source: src }
  }

  async build(): Promise<BuildResult> {
    const t0 = performance.now()
    const out = join(this.profile, 'mods', this.modId)
    try {
      if (!existsSync(join(this.srcDir, 'mod.ts'))) this.writeMod()
      const res = await Bun.build({ entrypoints: [join(this.srcDir, 'mod.ts')], target: 'bun', format: 'esm' })
      if (!res.success) throw new Error(res.logs.map((l) => String(l.message ?? l)).join('\n'))
      const code = await res.outputs[0]!.text()
      safeWrite(join(out, 'manifest.json'), readFileSync(join(this.srcDir, 'manifest.json')), this.ctx)
      safeWrite(join(out, 'mod.js'), code, this.ctx)
      this.lastBuild = { ok: true, ms: performance.now() - t0, bytes: code.length, out }
    } catch (e) {
      this.lastBuild = { ok: false, ms: performance.now() - t0, bytes: 0, out, error: (e as Error).message }
    }
    return this.lastBuild
  }

  // test-in-game, headless: the real engine and loader run against the profile for a few seconds
  // of autopilot play; the log is checked for errors and a screenshot is written.
  async test(seconds = 6, seed = 7): Promise<TestResult> {
    const { Game } = await import(join(this.gameDir, 'engine.ts'))
    const { ModLoader } = await import(join(this.gameDir, 'modloader.ts'))
    const { FB, W, H, upscale } = await import(join(this.gameDir, 'fb.ts'))
    const game = new Game(seed)
    const log: string[] = []
    const errors: string[] = []
    guard(join(this.profile, 'logs'), this.ctx)
    const loader = new ModLoader(game, this.profile, { logName: 'test' })
    const toFile = game.onLog
    game.onLog = (l: { src: string; msg: string; level: string }) => { toFile?.(l); log.push(`[${l.src}] ${l.msg}`); if (l.level === 'error') errors.push(`[${l.src}] ${l.msg}`) }
    await loader.loadAll()
    if (this.template === 'unit') game.spawn(this.modId, 2)
    let maxProj = 0, best = -1
    const fb = new FB()
    // keep the frame with the most projectiles on screen (after warm-up) as the screenshot
    for (let i = 0; i < seconds * 60; i++) {
      game.update(1 / 60, game.autopilot())
      maxProj = Math.max(maxProj, game.projectiles)
      const score = game.projectiles * 4 + game.enemies
      if (i > 90 && score > best) { best = score; game.render(fb) }
    }
    if (best < 0) game.render(fb)
    const s = 3
    const px = new Uint32Array(W * s * H * s)
    upscale(fb, s, px)
    const rgba = new Uint8Array(px.buffer)
    const n = existsSync(join(this.workspace, 'screens')) ? readdirSync(join(this.workspace, 'screens')).length : 0
    const shot = join(this.workspace, 'screens', `test-${String(n + 1).padStart(3, '0')}.png`)
    safeWrite(shot, encodePng(W * s, H * s, rgba), this.ctx)
    this.lastTest = { ok: errors.length === 0 && loader.mods.length > 0, seconds, kills: game.kills, projectiles: maxProj, errors, log, screenshot: shot, rgba, w: W * s, h: H * s }
    return this.lastTest
  }

  // Copies the built mod into the game's own mods/ folder. Requires --yes (guarded).
  install() {
    const dst = join(this.gameDir, 'mods', this.modId)
    safeCopy(join(this.profile, 'mods', this.modId), dst, this.ctx)
    return dst
  }

  launchCommand() { return `grovekeep -p ${relative(process.cwd(), this.profile) || '.'}` }
}
