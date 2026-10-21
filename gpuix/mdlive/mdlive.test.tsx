import { connectTest } from '@gpuix/react/automation'
import { createTestRoot } from '@gpuix/react/testing'
import { afterEach, expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from './mdlive'
import { App, keyBus, keyName } from './src/App'
import { changedBlock, parseBlocks, stats } from './src/doc'
import { loadPalette } from './src/theme'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const T = 60_000
const roots: { unmount: () => void; renderer: any }[] = []
const pump = () => {
  for (const r of roots) {
    try {
      r.renderer.flush?.()
      r.renderer.dispatchNativeEvents?.()
    } catch {}
  }
}
afterEach(() => {
  while (roots.length) {
    try {
      roots.pop()!.unmount()
    } catch {}
  }
})

async function until(fn: () => boolean | Promise<boolean>, ms = 5000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    pump()
    if (await fn()) return
    await sleep(50)
  }
  throw new Error('condition not met')
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mdlive-test-'))
  const file = join(dir, 'notes.md')
  copyFileSync(join(import.meta.dir, 'examples/notes.md'), file)
  copyFileSync(join(import.meta.dir, 'examples/sync-diagram.png'), join(dir, 'sync-diagram.png'))
  return file
}

async function setup(file = fixture(), width = 1400) {
  const root = createTestRoot({ width, height: 900 })
  roots.push(root)
  root.render(<App file={file} palette={loadPalette('GitHub Dark High Contrast')} />)
  const app = await connectTest(root.renderer)
  await app.getByTestId('toc-architecture').waitFor({ timeoutMs: 10_000 })
  const text = async (id: string) => (await app.getByTestId(id).textContent()) ?? ''
  return { app, root, file, text }
}

const key = (k: string, mods: Partial<{ shift: boolean; ctrl: boolean; cmd: boolean }> = {}) =>
  keyBus.handler?.({ key: k, modifiers: { shift: false, ctrl: false, alt: false, cmd: false, ...mods } } as never)

test('parses GFM into measured blocks with stats and a TOC', () => {
  const src = readFileSync(join(import.meta.dir, 'examples/notes.md'), 'utf8')
  const blocks = parseBlocks(src, join(import.meta.dir, 'examples'))
  expect(blocks.filter((b) => b.kind === 'heading').map((b) => b.title)).toEqual([
    'Offline Sync for Ledger', 'Why now', 'Goals', 'Architecture', 'Merge rules', 'Rollout', 'Open questions',
  ])
  expect(blocks.find((b) => b.kind === 'code')?.lang).toBe('ts')
  expect(blocks.find((b) => b.kind === 'img')?.path).toEndWith('examples/sync-diagram.png')
  const s = stats(blocks)
  expect(s.words).toBeGreaterThan(300)
  expect(s.minutes).toBe(Math.max(1, Math.round(s.words / 230)))
  const edited = parseBlocks(src.replace('Dogfood with the finance team', 'Dogfood with finance and support'), '.')
  expect(edited[changedBlock(parseBlocks(src, '.'), edited)!]!.src).toContain('finance and support')
})

test('CLI args: file, flags, help', () => {
  expect(parseArgs(['notes.md', '-w', '--no-toc'])).toEqual({ file: 'notes.md', wide: true, toc: false, follow: true, window: false })
  expect(parseArgs(['--help'])).toMatchObject({ exit: 0 })
  expect(parseArgs(['--bogus'])).toMatchObject({ exit: 2 })
})

test('renders the document, live-reloads on an atomic save, and tracks the edited block', async () => {
  const { app, file, text } = await setup()
  expect(await text('file-name')).toBe('notes.md')
  const before = Number((await text('word-count')).replace(/\D/g, ''))
  expect(before).toBeGreaterThan(300)
  expect((await app.getByTestId('h-merge-rules').bounds())!.height).toBeGreaterThan(20)

  // nvim-style save: write a temp file and rename it over the original
  const src = readFileSync(file, 'utf8')
  const next = src.replace('## Open questions', '## Launch checklist\n\nPing the on-call channel before each ramp step. Freeze schema changes during the rollout window.\n\n## Open questions')
  writeFileSync(`${file}.tmp`, next)
  renameSync(`${file}.tmp`, file)

  await app.getByTestId('h-launch-checklist').waitFor({ timeoutMs: 5000 })
  await app.getByTestId('toc-launch-checklist').waitFor({ timeoutMs: 5000 })
  await until(async () => Number((await text('word-count')).replace(/\D/g, '')) > before + 10)
  expect(await text('status-updated')).toBe('Updated just now')
}, T)

test('clicking a TOC entry scrolls to it and marks it active; ] and [ walk sections', async () => {
  const { app } = await setup()
  const headingTop = async (id: string) => (await app.getByTestId(id).bounds())!.y
  const startTop = await headingTop('h-open-questions')
  expect(startTop).toBeGreaterThan(900)
  await app.getByTestId('toc-open-questions').click()
  await until(async () => (await headingTop('h-open-questions')) < 200)
  key('[')
  await until(async () => (await headingTop('h-rollout')) < 200)
  key(']')
  await until(async () => (await headingTop('h-open-questions')) < 200)
}, T)

test('find-in-page highlights matches and steps through them', async () => {
  const { app, text } = await setup()
  key('/')
  await app.getByTestId('find-input').waitFor({ timeoutMs: 3000 })
  await app.getByTestId('find-input').fill('budget')
  await until(async () => /^1\/\d+$/.test(await text('find-count')))
  const total = Number((await text('find-count')).split('/')[1])
  expect(total).toBeGreaterThanOrEqual(4)
  await app.getByTestId('find-next').click()
  await until(async () => (await text('find-count')) === `2/${total}`)
  await app.getByTestId('find-input').fill('zzzz-nope')
  await until(async () => (await text('find-count')) === 'No results')
}, T)

test('wide/narrow toggle changes the reading column and the TOC hides in a narrow split', async () => {
  const { app } = await setup()
  const docW = async () => (await app.getByTestId('doc').bounds())!.width
  const narrow = await docW()
  await app.getByTestId('width-toggle').click()
  await until(async () => (await docW()) > narrow + 100)
  // GPUIX 0.11.0 terminal mode delivers printable keys as key "space" + keyChar
  keyBus.handler?.({ key: 'space', keyChar: 'w', modifiers: { shift: false, ctrl: false, alt: false, cmd: false } } as never)
  await until(async () => Math.abs((await docW()) - narrow) < 2)
  expect(keyName({ key: 'space', keyChar: 'w' })).toBe('w')
  expect(keyName({ key: 'space', keyChar: ' ' })).toBe('space')
  expect(keyName({ key: 'down', keyChar: null })).toBe('down')

  const half = await setup(undefined, 700)
  await until(async () => (await half.app.getByTestId('doc-scroll').bounds())!.x < 2)
}, T)

test('clicking a task checkbox writes the toggled state back to the file', async () => {
  const { app, file } = await setup()
  expect(readFileSync(file, 'utf8')).toContain('- [ ] Receipts upload in resumable 1 MB chunks')
  await app.getByTestId('task-receipts-upload-in-resumable-1-mb-chunks').click()
  await until(() => readFileSync(file, 'utf8').includes('- [x] Receipts upload in resumable 1 MB chunks'))
  await sleep(400)
  await app.getByTestId('task-receipts-upload-in-resumable-1-mb-chunks').click()
  await until(() => readFileSync(file, 'utf8').includes('- [ ] Receipts upload in resumable 1 MB chunks'))
}, T)
