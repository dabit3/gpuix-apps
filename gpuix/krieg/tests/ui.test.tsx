import { expect, test } from 'bun:test'
import { createTestRoot } from '@gpuix/react/testing'
import { App } from '../src/app'
import { boot } from '../src/boot'

test('title card shows the generated-asset report, enter starts the game HUD', async () => {
  const root = createTestRoot({ width: 960, height: 600 }), renderer = root.renderer
  root.render(<App opts={{ seed: 1337, mute: true, god: false, scale: 4, size: { bytes: 60000, gzip: 24000, packed: 40000 } }} game={boot(1337, 32)} />)
  renderer.flush()
  const title = renderer.getAllText().join(' ')
  expect(title).toContain('KRIEG')
  expect(title).toContain('0 files')
  expect(title).toContain('58.6 KB min')
  renderer.nativeSimulateKeystrokes(renderer.findByTestId('krieg')!.id, 'enter')
  await new Promise((r) => setTimeout(r, 300))
  renderer.flush()
  const hud = renderer.getAllText().join(' ')
  expect(hud).toContain('HEALTH')
  expect(hud).toContain("SHOTGUN")
})
