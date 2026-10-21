import { describe, expect, it } from 'bun:test'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App } from '../src/app'

const d = hasNativeTestRenderer ? describe : describe.skip

d('crawler app (GPUIX test renderer)', () => {
  it('renders the mock results page with header, links and key hints', () => {
    const root = createTestRoot({ width: 1200, height: 800 })
    root.render(<App spiders={0} animate={false} />)
    root.renderer.flush()
    const text = root.renderer.getAllText().join(' ')
    expect(text).toContain('crawler')
    expect(text).toContain('crawl://search?q=how%20do%20spiders%20walk')
    expect(text).toContain('Wikipedia')
    expect(text).toContain('0 spiders')
    expect(text).toContain('ctrl-c')
  })
  it('reflows into a compact layout in a narrow split', () => {
    const root = createTestRoot({ width: 600, height: 800 })
    root.render(<App spiders={0} animate={false} />)
    root.renderer.flush()
    const text = root.renderer.getAllText().join(' ')
    expect(text).toContain('0 · 0 idx')
    expect(text).not.toContain('ctrl-c')
  })
})
