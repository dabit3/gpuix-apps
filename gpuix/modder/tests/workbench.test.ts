import { describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdtempSync, readdirSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GuardError, isInside, safeWrite } from '../src/guard'
import { workspaceFor, Workbench } from '../src/workbench'

const GAME = join(import.meta.dir, '..', 'game')
const snapshot = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort().map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`)

describe('--yes guard', () => {
  test('isInside resolves symlinks and ..', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'modder-g-'))
    symlinkSync(GAME, join(tmp, 'link'))
    expect(isInside(join(tmp, 'link', 'mods', 'x'), GAME)).toBe(true)
    expect(isInside(join(GAME, '..', 'src'), GAME)).toBe(false)
  })
  test('safeWrite refuses the game folder without yes', () => {
    const game = mkdtempSync(join(tmpdir(), 'modder-game-'))
    expect(() => safeWrite(join(game, 'mods', 'a.js'), 'x', { gameDir: game, yes: false })).toThrow(GuardError)
    expect(existsSync(join(game, 'mods'))).toBe(false)
    safeWrite(join(game, 'mods', 'a.js'), 'x', { gameDir: game, yes: true })
    expect(existsSync(join(game, 'mods', 'a.js'))).toBe(true)
  })
  test('the default workspace is never inside the game folder', () => {
    expect(isInside(workspaceFor(GAME, GAME), GAME)).toBe(false)
    expect(isInside(workspaceFor(GAME, join(GAME, 'assets')), GAME)).toBe(false)
  })
})

describe('pipeline on Grovekeep', () => {
  const copy = mkdtempSync(join(tmpdir(), 'modder-copy-'))
  cpSync(GAME, join(copy, 'game'), { recursive: true })
  const game = join(copy, 'game')
  const ws = join(copy, 'ws')

  test('recon → hooks → write-mod → build → test, without touching the game', async () => {
    const before = snapshot(game)
    const wb = new Workbench(game, ws)
    wb.writeRecon()
    const h = wb.scan()
    expect(wb.hooks.filter((x) => x.kind === 'event').map((x) => x.name)).toEqual(expect.arrayContaining(['swing', 'hit', 'kill', 'spawn', 'tick', 'key']))
    expect(h.note).toContain('event hooks')
    wb.writeMod()
    expect(wb.sprite?.rows.length).toBe(12)
    const b = await wb.build()
    expect(b.error).toBeUndefined()
    expect(b.ok).toBe(true)
    const t = await wb.test(5)
    expect(t.errors).toEqual([])
    expect(t.ok).toBe(true)
    expect(t.log).toContain('[loader] loaded emberblade v1.0.0')
    expect(t.projectiles).toBeGreaterThan(0)
    expect(existsSync(t.screenshot)).toBe(true)
    expect(snapshot(game)).toEqual(before)
    expect(wb.ctx.written!.every((f) => f.startsWith(ws))).toBe(true)
  })

  test('install refuses without --yes and works with it', async () => {
    const wb = new Workbench(game, ws)
    await wb.build()
    expect(() => wb.install()).toThrow(GuardError)
    expect(existsSync(join(game, 'mods'))).toBe(false)
    const yes = new Workbench(game, ws, true)
    yes.writeMod()
    await yes.build()
    expect(existsSync(join(yes.install(), 'mod.js'))).toBe(true)
  })

  test('hud and unit templates build and load', async () => {
    for (const tpl of ['hud', 'unit'] as const) {
      const wb = new Workbench(game, join(copy, `ws-${tpl}`))
      wb.setTemplate(tpl)
      wb.writeMod()
      expect((await wb.build()).ok).toBe(true)
      const t = await wb.test(3)
      expect(t.errors).toEqual([])
      expect(t.ok).toBe(true)
    }
  })

  test('unsupported engines get a plan, not a mod', () => {
    const fx = new Workbench(join(import.meta.dir, '..', 'fixtures', 'unity-mono-indie'), join(copy, 'ws-unity'))
    expect(() => fx.writeMod()).toThrow(/write-mod only runs end to end/)
    expect(fx.recon.plan.length).toBeGreaterThan(2)
  })
})
