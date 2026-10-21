import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App, handleKey } from '../src/app'
import { Store } from '../src/store'
import { detectEngines } from '../src/engines'
import { loadGhosttyTheme } from '../src/theme'

const FIX = join(import.meta.dir, '..', 'demo')
const MORE = join(import.meta.dir, '..', 'demo-more')
const haveFixtures = existsSync(join(FIX, 'dunes.png')) && existsSync(join(import.meta.dir, '..', 'demo-more', 'no-extension'))
const dir = mkdtempSync(join(tmpdir(), 'convt-app-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const settle = async (r: { flush(): void }, ms = 50) => {
  for (let i = 0; i < 4; i++) {
    await Bun.sleep(ms)
    r.flush()
  }
}
const until = async (r: { flush(): void }, ok: () => boolean, ms = 20000) => {
  const t0 = Date.now()
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await settle(r, 100)
  }
}

describe.skipIf(!hasNativeTestRenderer || !haveFixtures)('convt UI (GPU test renderer)', () => {
  const theme = loadGhosttyTheme()

  test('renders sniffed files, converts with a click, and writes beside the input', async () => {
    for (const f of ['dunes.png', 'release-notes.md']) copyFileSync(join(FIX, f), join(dir, f))
    copyFileSync(join(MORE, 'no-extension'), join(dir, 'no-extension'))
    const store = new Store(detectEngines(), { cache: join(dir, '.cache') })
    const { renderer, render, unmount } = createTestRoot({ width: 1400, height: 840 })
    render(<App store={store} theme={theme} size={{ width: 1400, height: 840 }} />)
    await store.add([dir])
    await settle(renderer)

    const text = renderer.getAllText().join(' ')
    expect(text).toContain('dunes.png')
    expect(text).toContain('no-extension')
    expect(renderer.findByTestId('file-2')).toBeDefined()
    // the extensionless file is a JPEG by its bytes
    const noext = store.files.find((f) => f.name === 'no-extension')!
    expect(noext.src.format).toBe('jpeg')

    const dunes = store.files.findIndex((f) => f.name === 'dunes.png')
    store.setFocus(dunes)
    await settle(renderer)
    expect(renderer.findByTestId('target-webp')).toBeDefined()
    expect(renderer.findByTestId('target-mp4')).toBeUndefined()

    // keyboard: lower quality, then convert with Enter-equivalent
    const q0 = store.current()!.quality
    handleKey(store, { key: '-' })
    expect(store.current()!.quality).toBeLessThan(q0)

    const btn = renderer.findByTestId('convert')!
    const b = renderer.getElementBounds(btn.id)!
    renderer.nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2)
    await settle(renderer)
    await until(renderer, () => store.files[dunes]!.state === 'done')
    const out = store.files[dunes]!.output!
    expect(out).toBe(join(dir, 'dunes.converted.webp'))
    expect(existsSync(out)).toBe(true)
    await settle(renderer)
    expect(renderer.getAllText().join(' ')).toContain('dunes.converted.webp')
    unmount()
  }, 60000)

  test('reflows: wide three columns, stacked when split, no preview when thin', async () => {
    const store = new Store(detectEngines(), { cache: join(dir, '.cache2') })
    for (const [w, preview] of [[1400, true], [700, true], [460, false]] as const) {
      const { renderer, render, unmount } = createTestRoot({ width: w, height: 840 })
      render(<App store={store} theme={theme} size={{ width: w, height: 840 }} />)
      if (!store.files.length) await store.add([join(FIX, 'alpine-sunset.jpg')])
      await settle(renderer)
      expect(!!renderer.findByTestId('preview')).toBe(preview)
      const conv = renderer.getElementBounds(renderer.findByTestId('convert')!.id)!
      expect(conv.x + conv.width).toBeLessThanOrEqual(w)
      unmount()
    }
  }, 60000)
})
