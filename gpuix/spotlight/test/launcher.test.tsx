import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { calculate } from '../src/calc'
import { parseColor, toHex } from '../src/color'
import { fuzzyMatch } from '../src/fuzzy'
import { HEIGHT, Launcher, WIDTH, type Deps } from '../src/Launcher'
import { Store } from '../src/store'
import { scanApps, type FileHit } from '../src/system'

const apps = await scanApps()
const appPath = (name: string) => apps.find((a) => a.name === name)!.path

/** "12 usd" → "1 2 space u s d" for nativeSimulateKeystrokes. */
const keys = (text: string) => [...text].map((c) => (c === ' ' ? 'space' : c)).join(' ')

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'spotlight-test-'))
  const calls: string[] = []
  let clipboard = 'first copied line'
  const fileHit: FileHit = { path: '/Users/devin/Documents/Quarterly Plan.md', name: 'Quarterly Plan.md', dir: '~/Documents', kind: 'text' }
  const deps: Deps = {
    apps,
    store: new Store(dir),
    fileIcons: {},
    initialDark: true,
    clipboardPollMs: 20,
    fileDebounceMs: 10,
    sys: {
      searchFiles: async (q) => (q.toLowerCase().includes('quart') ? [fileHit] : []),
      readClipboard: async () => clipboard,
      writeClipboard: async (t) => void calls.push(`copy:${t}`),
      isDarkMode: async () => true,
      openPath: (p) => calls.push(`open:${p}`),
      revealInFinder: (p) => calls.push(`reveal:${p}`),
      openWith: (a, p) => calls.push(`openWith:${a}:${p}`),
      quickLook: (p) => calls.push(`ql:${p}`),
      quitApp: (n) => calls.push(`quit:${n}`),
      commands: {
        toggleDarkMode: () => calls.push('darkmode'),
        lockScreen: () => calls.push('lock'),
        sleepDisplay: () => calls.push('sleep'),
        emptyTrash: () => calls.push('emptyTrash'),
        trashCount: async () => 3,
      },
    },
  }
  return { dir, deps, calls, setClipboard: (t: string) => void (clipboard = t) }
}

describe('pure helpers', () => {
  it('calculates math, units and currency inline', () => {
    expect(calculate('12 usd in eur')?.value).toBe('€11.04')
    expect(calculate('12*(3+4)')?.value).toBe('84')
    expect(calculate('5 ft to cm')?.value).toBe('152.4 cm')
    expect(calculate('20% of 150')?.value).toBe('30')
    expect(calculate('safari')).toBeNull()
  })
  it('fuzzy matches word starts and parses colours', () => {
    expect(fuzzyMatch('sysset', 'System Settings')?.indices).toEqual([0, 1, 2, 7, 8, 9])
    expect(fuzzyMatch('xyz', 'Calculator')).toBeNull()
    expect(toHex(parseColor('rgb(255, 107, 53)')!)).toBe('#FF6B35')
  })
})

const describeNative = hasNativeTestRenderer ? describe : describe.skip

describeNative('launcher in the GPU test renderer', () => {
  let ctx: ReturnType<typeof setup>
  let root: ReturnType<typeof createTestRoot>
  const r = () => root.renderer
  const settle = async (ms = 60) => {
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(ms / 4)
      r().flush()
    }
  }
  const text = () => r().getAllText().join('')
  const input = () => r().findByTestId('search')!
  const type = async (s: string) => {
    r().nativeSimulateKeystrokes(input().id, keys(s))
    await settle()
  }
  const press = async (k: string) => {
    r().nativeSimulateKeystrokes(input().id, k)
    await settle()
  }
  const clear = async () => {
    await press('escape')
    expect(text()).toMatch(/Suggestions|Recent/)
  }
  const clickTestId = async (id: string) => {
    const el = r().findByTestId(id)
    expect(el).toBeDefined()
    const b = r().getElementBounds(el!.id)!
    r().nativeSimulateClick(b.x + b.width / 2, b.y + b.height / 2)
    await settle()
  }

  beforeEach(async () => {
    ctx = setup()
    root = createTestRoot({ width: WIDTH, height: HEIGHT })
    root.render(<Launcher deps={ctx.deps} />)
    await settle()
    r().focusElement(input().id)
  })
  afterEach(() => {
    root.unmount?.()
    ctx.deps.store.save(true)
    rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('searches apps with highlighted matches, moves selection, opens and learns', async () => {
    expect(text()).toContain('Suggestions')
    await type('calc')
    expect(r().getAllText()).toContain('Calc')
    expect(r().getAllText()).toContain('ulator')
    await press('enter')
    expect(ctx.calls).toContain(`open:${appPath('Calculator')}`)
    expect(text()).toContain('Opened Calculator')

    // Up/Down moves the highlight: with "text" the second row is a different item.
    await type('te')
    const rows = ['row-0', 'row-1'].map((id) => r().findByTestId(id))
    expect(rows.every(Boolean)).toBe(true)
    await press('down')
    await press('enter')
    const opened = ctx.calls.filter((c) => c.startsWith('open:'))
    expect(opened.length).toBe(2)
    expect(opened[1]).not.toBe(opened[0])

    // Ranking persisted to disk and the empty view now shows Recent first.
    ctx.deps.store.save(true)
    const saved = JSON.parse(readFileSync(join(ctx.dir, 'state.json'), 'utf8'))
    expect(saved.usage[`app:${appPath('Calculator')}`].count).toBe(1)
    await clear()
    expect(text()).toContain('Recent')
    expect(text().indexOf('Calculator')).toBeLessThan(text().indexOf('Commands'))
  })

  it('answers math and currency inline and copies the answer', async () => {
    await type('12 usd in eur')
    expect(text()).toContain('€11.04')
    expect(text()).toContain('Static rate · 1 USD = 0.92 EUR')
    await press('enter')
    expect(ctx.calls).toContain('copy:11.04')
    await clear()
    await type('2^10')
    expect(text()).toContain('1,024')
  })

  it('reveals in Finder with cmd-enter and runs actions from the cmd-k panel', async () => {
    await type('quart')
    expect(text()).toContain('Quarterly Plan.md')
    // No app or command matches "quart", so the file is the first, selected row.
    expect(text()).not.toContain('Results')
    await press('cmd-enter')
    expect(ctx.calls).toContain('reveal:/Users/devin/Documents/Quarterly Plan.md')
    // Revealing hands off to Finder and resets the launcher, like opening does.
    expect(text()).toContain('Suggestions')
    await type('quart')
    await press('cmd-k')
    expect(r().findByTestId('action-panel')).toBeDefined()
    expect(text()).toContain('Open with TextEdit')
    await press('down')
    await press('down')
    await press('enter')
    expect(ctx.calls).toContain('openWith:TextEdit:/Users/devin/Documents/Quarterly Plan.md')
    expect(r().findByTestId('action-panel')).toBeUndefined()
  })

  it('records clipboard history and browses it', async () => {
    await settle(80)
    ctx.setClipboard('ssh deploy@10.0.4.12')
    await settle(80)
    ctx.setClipboard('https://github.com/remorses/gpuix')
    await settle(80)
    await type('clipboard')
    await press('enter')
    expect(text()).toContain('Clipboard History')
    expect(text()).toContain('https://github.com/remorses/gpuix')
    expect(text()).toContain('ssh deploy@10.0.4.12')
    expect(text()).toContain('first copied line')
    expect(ctx.deps.store.data.clipboard.map((c) => c.text)).toEqual([
      'https://github.com/remorses/gpuix',
      'ssh deploy@10.0.4.12',
      'first copied line',
    ])
    await type('ssh')
    expect(text()).not.toContain('first copied line')
    await press('enter')
    expect(ctx.calls).toContain('copy:ssh deploy@10.0.4.12')
  })

  it('confirms Empty Trash in a dialog before running it', async () => {
    await type('empty trash')
    await press('enter')
    expect(text()).toContain('Empty Trash?')
    expect(text()).toContain('3 items will be permanently erased')
    expect(ctx.calls).not.toContain('emptyTrash')
    await clickTestId('trash-cancel')
    expect(text()).not.toContain('Empty Trash?')
    expect(ctx.calls).not.toContain('emptyTrash')
    await press('enter')
    expect(text()).toContain('Empty Trash?')
    await clickTestId('trash-confirm')
    expect(ctx.calls).toContain('emptyTrash')
    expect(text()).not.toContain('Empty Trash?')
    expect(text()).toContain('Trash emptied')
  })

  it('converts colours and captures a screenshot', async () => {
    await type('#ff6b35')
    expect(text()).toContain('#FF6B35')
    expect(text()).toContain('rgb(255, 107, 53)')
    expect(text()).toContain('hsl(16, 100%, 60%)')
    r().captureScreenshot(join(ctx.dir, 'color.png'))
    expect(readFileSync(join(ctx.dir, 'color.png')).length).toBeGreaterThan(5000)
  })
})
