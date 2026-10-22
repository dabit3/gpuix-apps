import { describe, expect, it } from 'bun:test'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App } from '../src/ui/App'
import { newGame, type GameState } from '../src/engine/game'

const d = hasNativeTestRenderer ? describe : describe.skip
const center = (root: ReturnType<typeof createTestRoot>, id: string) => {
  const el = root.renderer.findByTestId(id)
  expect(el).toBeTruthy()
  const b = root.renderer.getElementBounds(el!.id)!
  return [b.x + b.width / 2, b.y + b.height / 2] as const
}
const click = (root: ReturnType<typeof createTestRoot>, id: string) => { const [x, y] = center(root, id); root.renderer.nativeSimulateClick(x, y); root.renderer.flush() }
const key = (root: ReturnType<typeof createTestRoot>, k: string) => { const r = root.renderer.findByTestId('root')!; root.renderer.nativeSimulateKeyDown(r.id, k); root.renderer.flush() }

d('WRIST-LINK UI (GPUIX test renderer)', () => {
  it('character creation spends points and starts the game', () => {
    const root = createTestRoot({ width: 1400, height: 1000 })
    try {
    root.render(<App startScreen="title" />)
    root.renderer.flush()
    expect(root.renderer.getAllText().join(' ')).toContain('pts left')
    click(root, 'dec-grit')
    expect(root.renderer.getAllText().join(' ')).toContain('1 pts left')
    click(root, 'inc-wits')
    click(root, 'start')
    root.renderer.flush()
    expect(root.renderer.findByTestId('hud')).toBeTruthy()
    expect(root.renderer.findByTestId('wristlink')).toBeTruthy()
  } finally { root.unmount() }
  })

  it('tabs, inventory detail, dialogue by keyboard and save via the io hooks', () => {
    const saves: GameState[] = []
    const lines: string[] = []
    const g = newGame()
    const root = createTestRoot({ width: 1400, height: 860 })
    try {
    root.render(<App initial={g} io={{ save: (s) => saves.push(JSON.parse(JSON.stringify(s))), log: (l) => lines.push(...l) }} />)
    root.renderer.flush()
    click(root, 'tab-items')
    expect(root.renderer.findByTestId('item-detail')).toBeTruthy()
    expect(root.renderer.findByTestId('weapon-art')).toBeTruthy()
    key(root, '3')
    expect(root.renderer.findByTestId('map-img')).toBeTruthy()
    // walk into Ada (two tiles east of the start) to open her dialogue
    // stand south-east of Ada (7,28); "up" steps (-1,-1) on the iso grid, into her
    g.player.x = 8; g.player.y = 29
    key(root, 'up')
    expect(root.renderer.findByTestId('dialogue')).toBeTruthy()
    expect(root.renderer.getAllText().join(' ')).toContain('ADA')
    key(root, '1')
    key(root, 'escape')
    expect(root.renderer.findByTestId('dialogue')).toBeFalsy()
    key(root, 'q')
    expect(root.renderer.findByTestId('quest-clean_water')).toBeTruthy()
    key(root, 'ctrl-s')
    expect(saves.length).toBe(1)
    expect(lines.some((l) => l.includes('QUEST'))).toBe(true)
  } finally { root.unmount() }
  })

  it('reflows to a compact layout in a narrow split pane', () => {
    const root = createTestRoot({ width: 720, height: 860 })
    try {
    root.render(<App initial={newGame()} />)
    root.renderer.flush()
    expect(root.renderer.findByTestId('wristlink')).toBeFalsy()
    click(root, 'toggle-panel')
    expect(root.renderer.findByTestId('wristlink')).toBeTruthy()
  } finally { root.unmount() }
  })
})
