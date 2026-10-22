import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App } from '../src/app'
import { loadSessions, resetCache } from '../src/load'
import { DEFAULT_PRICES } from '../src/prices'

const d = hasNativeTestRenderer ? describe : describe.skip
const SAMPLE = join(import.meta.dir, '..', 'sample', 'projects')

d('dashboard (GPU test renderer)', () => {
  resetCache()
  const initial = loadSessions([SAMPLE], DEFAULT_PRICES)

  function mount(width = 1400, height = 900) {
    const t = createTestRoot({ width, height })
    const renderer = t.renderer
    t.render(<App paths={[SAMPLE]} sheet={DEFAULT_PRICES} auditPath="/tmp/tokscope-test-AUDIT.md" watch={false} initial={initial} />)
    renderer.flush()
    return { renderer }
  }

  it('renders KPIs, segments and sessions', () => {
    const { renderer } = mount()
    const text = renderer.getAllText().join(' ')
    expect(text).toContain('$4.55')
    expect(text).toContain('Tool results')
    expect(text).toContain('Retrieved context')
    expect(text).toContain('Fix the flaky checkout test')
    renderer.captureScreenshot(join(import.meta.dir, 'overview.png'))
  })

  it('toggles fixes from the keyboard and updates the projection', () => {
    const { renderer } = mount()
    const id = (renderer.findByTestId('root') as { id: number }).id
    renderer.nativeSimulateKeystrokes(id, '3')
    renderer.flush()
    expect(renderer.getAllText().join(' ')).toContain('space toggles the selected fix')
    renderer.nativeSimulateKeystrokes(id, 'space')
    renderer.flush()
    const text = renderer.getAllText().join(' ')
    expect(text).toContain('1 of 7 fixes')
    expect(text).toContain('$0.532')
  })

  it('hovering a request bar shows what that turn carried', () => {
    const { renderer } = mount()
    const bar = renderer.findByTestId('req-40') as { id: number }
    const b = renderer.getElementBounds(bar.id)!
    renderer.nativeSimulateMouseMove(b.x + b.width / 2, b.y + b.height - 10)
    renderer.flush()
    const text = renderer.getAllText().join(' ')
    expect(text).toContain('turn 41')
    expect(text).toMatch(/in [\d.]+k = [\d.]+k read \+ [\d.]+k write/)
  })

  it('hides the sidebar and shows a switcher when narrow', () => {
    const { renderer } = mount(760, 800)
    const text = renderer.getAllText().join(' ')
    expect(text).toContain('All sessions · 7')
    expect(text).not.toContain('7 transcripts')
    renderer.captureScreenshot(join(import.meta.dir, 'narrow.png'))
  })
})
