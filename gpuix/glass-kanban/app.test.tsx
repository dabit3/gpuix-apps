import { connectTest } from '@gpuix/react/automation'
import { createTestRoot } from '@gpuix/react/testing'
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { App, keyBus } from './src/App'
import { seedBoard, type Board } from './src/data'
import { textFocus } from './src/focus'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const T = 60_000
const roots: { unmount: () => void }[] = []
afterEach(() => {
  while (roots.length) {
    try {
      roots.pop()!.unmount()
    } catch {}
  }
})

async function setup(dataPath = join(mkdtempSync(join(tmpdir(), 'glass-kanban-test-')), 'board.json')) {
  textFocus.reset()
  const root = createTestRoot({ width: 1440, height: 900 })
  roots.push(root)
  root.render(<App dataPath={dataPath} />)
  const app = await connectTest(root.renderer)
  await app.getByTestId('card-FIN-118').waitFor({ timeoutMs: 10_000 })
  const readBoard = () => JSON.parse(readFileSync(dataPath, 'utf8')) as Board
  return { app, root, dataPath, readBoard }
}

function key(k: string, mods: Partial<{ cmd: boolean; shift: boolean }> = {}) {
  keyBus.handler?.({
    key: k,
    modifiers: { cmd: false, shift: false, ctrl: false, alt: false, ...mods },
  } as never)
}

async function until(fn: () => boolean | Promise<boolean>, ms = 4000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await fn()) return
    await sleep(50)
  }
  throw new Error('condition not met')
}

test('seed has 60 cards across five columns', () => {
  const b = seedBoard()
  expect(Object.keys(b.cards)).toHaveLength(60)
  expect(b.columnOrder).toEqual(['backlog', 'todo', 'progress', 'review', 'done'])
})

test('clicking a card opens the sheet and title edits persist to JSON', async () => {
  const { app, readBoard } = await setup()
  await app.getByTestId('card-FIN-118').click()
  await app.getByTestId('sheet-id').waitFor({ timeoutMs: 5000 })
  expect(await app.getByTestId('sheet-id').textContent()).toBe('FIN-118')
  await app.getByTestId('sheet-title').fill('Settings search with fuzzy matching')
  await app.getByTestId('sheet-title').press('enter')
  await until(() => readBoard().cards['FIN-118']!.title === 'Settings search with fuzzy matching')
  expect(await app.getByTestId('card-FIN-118').textContent()).toContain('fuzzy matching')
}, T)

test('dragging a card to another column moves it, undo/redo restore it, and it survives a restart', async () => {
  const { app, root, dataPath, readBoard } = await setup()
  expect(await app.getByTestId('count-review').textContent()).toBe('8')
  await app.getByTestId('card-FIN-118').dragTo(app.getByTestId('lane-review'), { steps: 16 })
  await until(() => readBoard().lanes.review.includes('FIN-118'))
  expect(readBoard().lanes.todo).not.toContain('FIN-118')
  await until(async () => (await app.getByTestId('count-review').textContent()) === '9')
  expect(await app.getByTestId('toast').textContent()).toBe('Moved FIN-118 to In Review')

  key('z', { cmd: true })
  await until(() => readBoard().lanes.todo.includes('FIN-118'))
  expect(readBoard().lanes.review).not.toContain('FIN-118')
  key('z', { cmd: true, shift: true })
  await until(() => readBoard().lanes.review.includes('FIN-118'))

  root.unmount()
  const again = await setup(dataPath)
  expect(await again.app.getByTestId('count-review').textContent()).toBe('9')
  expect(await again.app.getByTestId('count-todo').textContent()).toBe('10')
}, T)

test('dragging within a column reorders it', async () => {
  const { app, readBoard } = await setup()
  const before = readBoard().lanes.todo
  expect(before.indexOf('FIN-119')).toBe(4)
  const top = await app.getByTestId('card-FIN-115').center()
  await app.getByTestId('card-FIN-119').dragTo({ x: top.x, y: top.y - 30 }, { steps: 16 })
  await until(() => readBoard().lanes.todo[0] === 'FIN-119')
  expect(readBoard().lanes.todo).toHaveLength(before.length)
}, T)

test('dragging a column header reorders columns', async () => {
  const { app, readBoard } = await setup()
  await app.getByTestId('column-handle-review').dragTo(app.getByTestId('column-handle-backlog'), { steps: 20 })
  await until(() => readBoard().columnOrder[0] === 'review')
  expect(readBoard().columnOrder).toEqual(['review', 'backlog', 'todo', 'progress', 'done'])
}, T)

test('command palette moves the selected card and filters by label', async () => {
  const { app, readBoard } = await setup()
  await app.getByTestId('card-FIN-119').click()
  await app.getByTestId('sheet-id').waitFor({ timeoutMs: 5000 })
  await app.getByTestId('open-palette').click()
  await app.getByTestId('palette-input').waitFor({ timeoutMs: 5000 })
  await app.getByTestId('palette-input').fill('move to done')
  await app.getByTestId('palette-input').press('enter')
  await until(() => readBoard().lanes.done[0] === 'FIN-119')

  await app.getByTestId('open-palette').click()
  await app.getByTestId('palette-input').waitFor({ timeoutMs: 5000 })
  await app.getByTestId('palette-input').fill('filter by label: bug')
  await app.getByTestId('palette-input').press('enter')
  const bugs = Object.values(readBoard().cards).filter((c) => c.labels.includes('Bug')).length
  await until(async () => (await app.getByTestId('visible-count').textContent()) === `${bugs} of 60 issues`)
  expect(await app.getByTestId('card-FIN-118').count()).toBe(0)
}, T)

test('quick add with C creates a card at the top of Todo', async () => {
  const { app, readBoard } = await setup()
  key('c')
  await app.getByTestId('quick-add-title').waitFor({ timeoutMs: 5000 })
  await app.getByTestId('quick-add-title').fill('Biometric re-auth for large transfers')
  await app.getByTestId('quick-add-title').press('enter')
  await until(() => readBoard().lanes.todo[0] === 'FIN-161')
  expect(readBoard().cards['FIN-161']!.title).toBe('Biometric re-auth for large transfers')
  await app.getByTestId('card-FIN-161').waitFor({ timeoutMs: 5000 })
}, T)
