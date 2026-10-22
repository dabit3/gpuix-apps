import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { copyInto, imageSize, listDir, moveInto, readClip, renameEntry, trash, uniqueDest, walk, writeClip } from '../src/fs'
import { fuzzyMatch } from '../src/fuzzy'
import { Yard } from '../src/Yard'

const SAMPLE = join(import.meta.dir, '..', 'sample')
let base: string
let root: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'yard-test-'))
  root = join(base, 'sample')
  cpSync(SAMPLE, root, { recursive: true })
  process.env.YARD_TRASH = join(base, 'Trash')
  process.env.YARD_STATE = join(base, 'state')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('filesystem model', () => {
  it('lists folders first in natural order and hides dotfiles until asked', () => {
    expect(listDir(root, false).map((e) => e.name)).toEqual(['Code', 'Data', 'Docs', 'Photos', 'README.txt'])
    const all = listDir(root, true).map((e) => e.name)
    expect(all).toContain('.env.example')
    expect(all.indexOf('.config')).toBeLessThan(all.indexOf('README.txt'))
  })
  it('copies, moves, renames and trashes on disk without clobbering', () => {
    const photo = join(root, 'Photos', 'waterfall.jpg')
    const [copied] = copyInto([photo], join(root, 'Docs'))
    expect(copied).toBe(join(root, 'Docs', 'waterfall.jpg'))
    expect(uniqueDest(join(root, 'Docs'), 'waterfall.jpg')).toBe(join(root, 'Docs', 'waterfall copy.jpg'))
    expect(copyInto([photo], join(root, 'Docs'))[0]).toBe(join(root, 'Docs', 'waterfall copy.jpg'))
    expect(() => copyInto([join(root, 'Code')], join(root, 'Code', 'orbit'))).toThrow('into itself')
    moveInto([join(root, 'Data', 'hikes.csv')], join(root, 'Docs'))
    expect(existsSync(join(root, 'Docs', 'hikes.csv'))).toBe(true)
    expect(existsSync(join(root, 'Data', 'hikes.csv'))).toBe(false)
    expect(renameEntry(join(root, 'Docs', 'hikes.csv'), 'walks.csv')).toBe(join(root, 'Docs', 'walks.csv'))
    expect(() => renameEntry(join(root, 'Docs', 'walks.csv'), 'Roadmap Q4.md')).toThrow('already exists')
    expect(trash([join(root, 'Docs', 'walks.csv')])).toBe(1)
    expect(readdirSync(join(base, 'Trash'))).toEqual(['walks.csv'])
  })
  it('reads image sizes from headers, walks for fuzzy jump and shares the clipboard file', () => {
    expect(imageSize(join(root, 'Photos', 'coastline.jpg'))).toEqual({ width: 1200, height: 800 })
    const paths = walk(root, false)
    expect(paths).toContain(join('Code', 'orbit', 'src', 'scheduler.ts'))
    expect(paths.some((p) => p.includes('.env'))).toBe(false)
    expect(fuzzyMatch('sched', 'scheduler.ts')?.indices).toEqual([0, 1, 2, 3, 4])
    writeClip({ mode: 'copy', paths: ['/a', '/b'], at: 1 })
    expect(readClip()?.paths).toEqual(['/a', '/b'])
  })
})

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative('yard in the GPU test renderer', () => {
  let t: ReturnType<typeof createTestRoot>
  let quit = 0
  const opened: string[] = []
  const r = () => t.renderer
  const settle = async (ms = 80) => {
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(ms / 4)
      r().flush()
    }
  }
  const text = () => r().getAllText().join('|')
  const press = async (keys: string, id = r().findByTestId('yard')!.id) => {
    r().nativeSimulateKeystrokes(id, keys)
    await settle()
  }
  const type = async (s: string) => press([...s].map((c) => (c === ' ' ? 'space' : c)).join(' '), r().findByTestId('prompt')!.id)
  const click = async (testId: string, clickCount = 1) => {
    const b = r().getElementBounds(r().findByTestId(testId)!.id)!
    for (let i = 0; i < clickCount; i++) r().nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2)
    await settle()
  }

  beforeEach(async () => {
    t = createTestRoot({ width: 1280, height: 800 })
    t.render(<Yard start={root} home={base} onQuit={() => quit++} openFile={(p) => opened.push(p)} clipPollMs={30} />)
    await settle(160)
    r().focusElement(r().findByTestId('yard')!.id)
  })
  afterEach(() => t.unmount?.())

  it('navigates Miller columns with hjkl and shows breadcrumbs and directory sizes', async () => {
    expect(text()).toContain('~|')
    expect(text()).toContain('sample')
    await settle(200)
    expect(text()).toContain('Total size')
    await press('j j j')
    expect(text()).toContain('4/5')
    await press('l')
    expect(text()).toContain('Photos')
    expect(text()).toContain('city-blocks.jpg')
    expect(text()).toContain('1200 × 800  ·  JPG')
    await press('j')
    expect(text()).toContain('2/6')
    await press('h')
    expect(text()).toContain('4/5')
  })

  it('selects with the mouse, opens folders and files and toggles hidden files', async () => {
    await click('current-row-4')
    expect(text()).toContain('5/5')
    await press('l')
    expect(opened.at(-1)).toBe(join(root, 'README.txt'))
    await click('current-row-3')
    await click('current-row-3')
    expect(text()).toContain('city-blocks.jpg')
    await click('parent-row-4')
    expect(text()).toContain('5/5')
    expect(text()).not.toContain('.env.example')
    await press('.')
    expect(text()).toContain('.env.example')
    await click('toggle-hidden')
    expect(text()).not.toContain('.env.example')
  })

  it('multi-selects, copies into another folder and pastes for real', async () => {
    await press('j j j l')
    await press('space space')
    expect(text()).toContain('2 selected')
    await press('y')
    expect(text()).toContain('2 items copied')
    await press('h k l')
    expect(text()).toContain('Field Notes.md')
    await press('p')
    await settle(150)
    expect(readdirSync(join(root, 'Docs')).sort()).toEqual(['Field Notes.md', 'Roadmap Q4.md', 'city-blocks.jpg', 'coastline.jpg', 'meeting-2026-10-14.txt'])
    expect(text()).toContain('Pasted 2 items into Docs')
    expect(existsSync(join(root, 'Photos', 'city-blocks.jpg'))).toBe(true)
  })

  it('cuts and moves, renames and trashes with confirmation', async () => {
    await press('j l j x')
    await press('h p')
    expect(existsSync(join(root, 'Data', 'hikes.csv'))).toBe(false)
    expect(existsSync(join(root, 'hikes.csv'))).toBe(true)
    await press('r')
    expect(r().findByTestId('prompt')).toBeDefined()
    await press('ctrl-u', r().findByTestId('prompt')!.id)
    await type('walks.csv')
    await press('enter', r().findByTestId('prompt')!.id)
    expect(existsSync(join(root, 'walks.csv'))).toBe(true)
    expect(text()).toContain('Renamed to walks.csv')
    await press('d')
    expect(text()).toContain('Move 1 item to Trash?')
    await press('enter')
    expect(existsSync(join(root, 'walks.csv'))).toBe(false)
    expect(readdirSync(join(base, 'Trash'))).toEqual(['walks.csv'])
  })

  it('fuzzy-jumps to a nested file and previews highlighted code', async () => {
    await press('/')
    await type('sched')
    expect(text()).toContain('Code/orbit/src')
    await press('enter', r().findByTestId('prompt')!.id)
    await settle(120)
    expect(text()).toContain('src')
    expect(text()).toContain('scheduler.ts')
    expect(r().getPaintedText().join('\n')).toContain('export async function runJob')
    await press('ctrl-c')
    expect(quit).toBe(1)
    r().captureScreenshot(join(import.meta.dir, '..', 'media', 'test-code.png'))
  })
})
