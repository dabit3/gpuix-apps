import { describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { ModderApp } from '../src/app'
import { expandTargets } from '../src/recon'
import { fallbackTheme } from '../src/theme'

const d = hasNativeTestRenderer ? describe : describe.skip
const SHOTS = join(import.meta.dir, '..', 'screens')
mkdirSync(SHOTS, { recursive: true })
const settle = async (r: { flush(): void }) => { for (let i = 0; i < 6; i++) { r.flush(); await Bun.sleep(15) } }

d('workbench UI (GPU test renderer)', () => {
  const copy = mkdtempSync(join(tmpdir(), 'modder-ui-'))
  cpSync(join(import.meta.dir, '..', 'game'), join(copy, 'game'), { recursive: true })
  const targets = expandTargets([join(copy, 'game'), join(import.meta.dir, '..', 'fixtures')])
  const ws = join(copy, 'ws')

  test('recon → mod → build → screenshot, driven by clicks and keys', async () => {
    const { root, renderer } = createTestRoot({ width: 1440, height: 900 })
    root.render(<ModderApp targets={targets} theme={fallbackTheme()} workspace={() => ws} live={false} />)
    await settle(renderer)
    const app = await connectTest(renderer)
    expect(await app.getByTestId('target-name').textContent()).toBe('game')
    expect(await app.getByTestId('risk').textContent()).toBe('moddable')
    expect(await app.getByTestId('recon-card').textContent()).toContain('Official mod API v1')
    await app.screenshot({ path: join(SHOTS, 'ui-recon.png') })

    await app.getByTestId('btn-hooks').click()
    expect(await app.getByTestId('hooks-card').textContent()).toContain('swing')

    await app.getByTestId('tab-Mod').click()
    await app.getByTestId('inc-count').click()
    expect(await app.getByTestId('val-count').textContent()).toBe('6')
    await app.getByTestId('color-frost').click()
    await settle(renderer)
    expect(renderer.getPaintedText().join('\n')).toContain('#39c5cf')
    await app.screenshot({ path: join(SHOTS, 'ui-mod.png') })

    await app.getByTestId('btn-build').click()
    const logOk = async () => (await app.getByTestId('chk-log').count()) === 1 && (await app.getByTestId('chk-log').textContent()) === '✓'
    for (let i = 0; i < 200 && !(await logOk()); i++) await settle(renderer)
    await settle(renderer)
    expect(await app.getByTestId('chk-build').textContent()).toBe('✓')
    expect(await app.getByTestId('chk-load').textContent()).toBe('✓')
    expect(await app.getByTestId('chk-log').textContent()).toBe('✓')
    expect(await app.getByTestId('chk-feature').textContent()).toBe('✓')
    expect(await app.getByTestId('chk-guard').textContent()).toBe('✓')
    await app.screenshot({ path: join(SHOTS, 'ui-build.png') })

    await app.getByTestId(`target-${targets.findIndex((t) => t.endsWith('unity-il2cpp-roguelite'))}`).click()
    expect(await app.getByTestId('risk').textContent()).toBe('plan only')
    await app.getByTestId('tab-Recon').click()
    expect(await app.getByTestId('recon-card').textContent()).toContain('BepInEx 6')
  })

  test('reflows to a half-width split pane', async () => {
    const { root, renderer } = createTestRoot({ width: 700, height: 860 })
    root.render(<ModderApp targets={targets} theme={fallbackTheme()} workspace={() => ws} live={false} initialTab="Mod" />)
    await settle(renderer)
    const app = await connectTest(renderer)
    expect(await app.getByTestId('targets').count()).toBe(0)
    expect(await app.getByTestId('tab-Build').count()).toBe(1)
    await app.screenshot({ path: join(SHOTS, 'ui-narrow.png') })
  })
})
