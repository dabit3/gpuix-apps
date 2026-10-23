// Output and input paths never follow symlinks planted in the folder being converted.
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectEngines, run } from '../src/engines'
import { Store } from '../src/store'

const info = detectEngines()
const root = mkdtempSync(join(tmpdir(), 'convt-store-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

async function folder(name: string) {
  const dir = join(root, name)
  const outside = join(root, `${name}-outside`)
  mkdirSync(dir)
  mkdirSync(outside)
  const r = await run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', join(dir, 'tone.wav')])
  expect(r.code).toBe(0)
  return { dir, outside }
}

async function convertTone(store: Store, dir: string, beforeRun?: (out: string) => void) {
  expect(await store.add([dir])).toBe(1)
  const f = store.files[0]!
  expect(f.name).toBe('tone.wav')
  store.update({ target: 'flac' })
  store.convert([f])
  expect(f.state).toBe('running')
  beforeRun?.(f.output!)
  const t0 = Date.now()
  while (f.state === 'running' || f.state === 'queued') {
    if (Date.now() - t0 > 20000) throw new Error('timed out')
    await Bun.sleep(20)
  }
  expect(f.error).toBeNull()
  expect(f.state).toBe('done')
  return f.output!
}

describe.skipIf(!info.engines.ffmpeg || !info.engines.ffprobe)('store symlink safety', () => {
  test('a dangling .converted link is never chosen as the output', async () => {
    const { dir, outside } = await folder('dangling')
    const target = join(outside, 'victim.flac')
    symlinkSync(target, join(dir, 'tone.converted.flac'))
    const store = new Store(info, { cache: join(root, '.cache-a') })
    const out = await convertTone(store, dir)
    expect(out).toBe(join(dir, 'tone.converted-2.flac'))
    expect(lstatSync(out).isFile()).toBe(true)
    expect(existsSync(target)).toBe(false)
    expect(lstatSync(join(dir, 'tone.converted.flac')).isSymbolicLink()).toBe(true)
    store.dispose()
  }, 30000)

  test('a link planted at the output while the job runs is not written through', async () => {
    const { dir, outside } = await folder('race')
    const target = join(outside, 'victim.flac')
    const store = new Store(info, { cache: join(root, '.cache-b') })
    const out = await convertTone(store, dir, (planned) => {
      expect(planned).toBe(join(dir, 'tone.converted.flac'))
      symlinkSync(target, planned)
    })
    expect(out).toBe(join(dir, 'tone.converted-2.flac'))
    expect(lstatSync(out).isFile()).toBe(true)
    expect(existsSync(target)).toBe(false)
    store.dispose()
  }, 30000)

  test('symlinked inputs are skipped in folders and rejected by name', async () => {
    const { dir, outside } = await folder('inputs')
    const secret = join(outside, 'secret.wav')
    rmSync(secret, { force: true })
    await run(['cp', join(dir, 'tone.wav'), secret])
    expect(existsSync(secret)).toBe(true)
    symlinkSync(secret, join(dir, 'zlink.wav'))
    const store = new Store(info, { cache: join(root, '.cache-c') })
    expect(await store.add([dir])).toBe(1)
    expect(store.files.map((f) => f.name)).toEqual(['tone.wav'])
    expect(await store.add([join(dir, 'zlink.wav')])).toBe(0)
    expect(store.rejected).toEqual([{ path: join(dir, 'zlink.wav'), reason: 'symlink' }])
    store.dispose()
  }, 30000)
})
