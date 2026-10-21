import { describe, expect, test } from 'bun:test'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App } from '../src/app'
import { Controller } from '../src/controller'
import { ArtQueue } from '../src/library/art'
import { scanLibrary } from '../src/library/scan'
import { fallbackTheme } from '../src/theme'
import { sizes } from '../src/ui/browse'
import { fakeDecoder, makeLibraryDir } from './fixtures'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describe('layout', () => {
  test('a half split keeps posters readable and fits fewer per row', () => {
    const full = sizes(1416, 860)
    const half = sizes(700, 860)
    expect(half.posterW).toBeGreaterThanOrEqual(92)
    expect(half.posterW).toBeLessThanOrEqual(full.posterW)
  })
})

describeNative('couch in the GPU test renderer', () => {
  test('profile picker → home rows → details → player, then reflows into a half pane', async () => {
    const root = makeLibraryDir()
    const lib = scanLibrary(root)
    for (const it of Object.values(lib.items)) if (it.path) it.probe = { duration: 600, width: 1280, height: 720, fps: 24, vcodec: 'h264', container: 'mov' }
    const c = new Controller(lib, { profiles: {} }, { profiles: [{ name: 'Nader', color: 4 }, { name: 'Kids', color: 2, kids: true }], decoder: () => fakeDecoder() })
    const metrics = { probeSpawns: 0, source: 'test' }
    const art = new ArtQueue(undefined, 0)
    let W = 1300, H = 820
    const { render, renderer } = createTestRoot({ width: W, height: H })
    const draw = () => { render(<App ctl={c} theme={fallbackTheme()} art={art} metrics={metrics} size={{ width: W, height: H }} />); renderer.flush() }
    const text = () => renderer.getAllText().join('\n')
    draw()
    expect(text()).toContain("Who's watching?")
    expect(text()).toContain('Nader')

    c.dispatch('ok'); draw()
    expect(text()).toContain('Recently Added')
    expect(text()).toContain('Tears of Steel')
    expect(text()).toContain('TV Shows')

    c.dispatch('down'); c.dispatch('right'); c.dispatch('ok'); draw()
    expect(c.view.screen).toBe('details')
    expect(text()).toContain('Tears of Steel')
    expect(text()).toContain('720p')

    c.dispatch('ok'); draw()
    expect(c.view.screen).toBe('player')
    c.dispatch('back'); draw()
    c.dispatch('back'); draw()

    c.setTab('movies'); draw(); await Bun.sleep(5); draw()
    const wide = c.view.gridCols
    W = 640; draw(); await Bun.sleep(5); draw()
    expect(c.view.gridCols).toBeLessThan(wide)
    expect(text()).toContain('Spring')

    c.dispatch('hud'); draw()
    expect(text()).toContain('PERF HUD')
    c.dispose()
  })
})
