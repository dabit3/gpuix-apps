import { describe, expect, it } from 'bun:test'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App } from '../src/ui/App'
import { newGame, objective, startCombat } from '../src/engine/game'

describe('objective tracking', () => {
  it('points a new game at the Overseer, then follows quest stages to their locations', () => {
    const s = newGame()
    const o = objective(s)!
    expect(o.title).toBe('Report to the Overseer')
    expect([o.x, o.y]).toEqual([7, 28])
    s.flags.talked_ada = true
    s.quests.clean_water = 'active'
    expect(objective(s)!.label).toContain('Marcus')
    s.quests.clean_water = 'got'
    expect(objective(s)!.label).toContain('Ada')
    s.quests.clean_water = 'done'
    s.quests.bell = 'active'
    const b = objective(s)!
    expect(b.title).toContain('Bell')
    expect([b.x, b.y]).toEqual([9, 7])
  })
})

const d = hasNativeTestRenderer ? describe : describe.skip
d('HUD overlays (GPUIX test renderer)', () => {
  const key = (root: ReturnType<typeof createTestRoot>, k: string) => { const r = root.renderer.findByTestId('root')!; root.renderer.nativeSimulateKeyDown(r.id, k); root.renderer.flush() }
  it('shows the quest tracker, toggles the field manual, and swaps to the combat tracker', () => {
    const g = newGame()
    const root = createTestRoot({ width: 1400, height: 900 })
    try {
      root.render(<App initial={g} />)
      root.renderer.flush()
      expect(root.renderer.findByTestId('tracker-title')).toBeTruthy()
      expect(root.renderer.getAllText().join(' ')).toContain('REPORT TO THE OVERSEER')
      key(root, 'h')
      expect(root.renderer.findByTestId('help')).toBeTruthy()
      key(root, 'escape')
      expect(root.renderer.findByTestId('help')).toBeFalsy()
      g.player.x = 19; g.player.y = 22
      startCombat(g)
      expect(g.combat).toBeTruthy()
      key(root, 't')
      const text = root.renderer.getAllText().join(' ')
      expect(text).toContain('ROUND 1')
      expect(root.renderer.findByTestId('target-chance')).toBeTruthy()
    } finally { root.unmount() }
  })
})
