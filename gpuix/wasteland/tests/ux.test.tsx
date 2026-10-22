import { describe, expect, it } from 'bun:test'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App } from '../src/ui/App'
import { chooseOption, newGame, objective, openContainer, startCombat, talkTo } from '../src/engine/game'

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

d('input never gets stuck in a panel (GPUIX test renderer)', () => {
  const press = (root: ReturnType<typeof createTestRoot>, k: string, held = false) => { const r = root.renderer.findByTestId('root')!; root.renderer.nativeSimulateKeyDown(r.id, k, held); root.renderer.flush() }
  it('bumping a container while holding a key does not trap movement; a fresh press walks away, Enter loots', () => {
    const g = newGame()
    g.player.x = 8; g.player.y = 27
    openContainer(g, 'locker')
    expect(g.mode).toBe('loot')
    const root = createTestRoot({ width: 1400, height: 900 })
    try {
      root.render(<App initial={g} />)
      root.renderer.flush()
      expect(root.renderer.findByTestId('tracker-title')).toBeFalsy()
      press(root, 'right', true)
      expect(g.mode).toBe('loot')
      press(root, 'down')
      expect(g.mode).toBe('explore')
      expect([g.player.x, g.player.y]).toEqual([9, 28])
      g.player.x = 8; g.player.y = 27
      openContainer(g, 'locker')
      root.renderer.flush()
      press(root, 'enter')
      expect(g.mode).toBe('explore')
      expect(g.player.inv.some((st) => st.id === 'canned_beans')).toBe(true)
    } finally { root.unmount() }
  })
  it('a move with no AP left ends the combat turn instead of being ignored', () => {
    const g = newGame()
    g.player.x = 19; g.player.y = 22
    startCombat(g)
    expect(g.combat?.round).toBe(1)
    g.player.ap = 0
    const root = createTestRoot({ width: 1400, height: 900 })
    try {
      root.render(<App initial={g} />)
      root.renderer.flush()
      press(root, 'up', true)
      expect(g.combat?.round).toBe(1)
      press(root, 'up')
      expect(g.mode === 'dead' || (g.combat?.round ?? 0) >= 2).toBe(true)
    } finally { root.unmount() }
  })
  it('dialogue choices can be picked with up/down + Enter', () => {
    const g = newGame()
    talkTo(g, 'ada')
    const ref = structuredClone(g)
    chooseOption(ref, 1)
    const root = createTestRoot({ width: 1400, height: 900 })
    try {
      root.render(<App initial={g} />)
      root.renderer.flush()
      press(root, 'down')
      press(root, 'enter')
      expect(g.mode).toBe(ref.mode)
      expect(g.dialogue?.node).toBe(ref.dialogue?.node)
    } finally { root.unmount() }
  })
})
