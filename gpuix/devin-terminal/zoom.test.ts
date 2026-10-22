import { describe, expect, it } from 'bun:test'
import { applyFontChange, cellSize, TerminalFontTracker } from './src/zoom/terminal-font'

// Grid sizes GPUIX reported in Ghostty for ⌘+, ⌘+, ⌘−, ⌘0 on a 158×44 window.
const launch = cellSize({ width: 1422, height: 880 }, { cols: 158, rows: 44 })!
const plus1 = cellSize({ width: 1420, height: 861 }, { cols: 142, rows: 41 })!
const plus2 = cellSize({ width: 1420, height: 880 }, { cols: 142, rows: 40 })!

describe('Ghostty font size → app zoom', () => {
  it('derives the cell size from grid pixels and columns/rows', () => {
    expect(launch).toEqual({ w: 9, h: 20 })
    expect(plus1).toEqual({ w: 10, h: 21 })
    expect(plus2).toEqual({ w: 10, h: 22 })
    expect(cellSize({ width: 0, height: 880 }, { cols: 158, rows: 44 })).toBeNull()
  })

  it('turns ⌘+ / ⌘− into zoom steps and ⌘0 into a reset', () => {
    const t = new TerminalFontTracker(launch)
    let z = 1
    z = applyFontChange(z, t.update(plus1))
    expect(z).toBe(1.1)
    z = applyFontChange(z, t.update(plus2))
    expect(z).toBe(1.25)
    z = applyFontChange(z, t.update(plus1))
    expect(z).toBe(1.1)
    z = applyFontChange(z, t.update(plus2))
    expect(z).toBe(1.25)
    expect(t.update(launch)).toEqual({ kind: 'reset' })
    z = applyFontChange(z, { kind: 'reset' })
    expect(z).toBe(1)
  })

  it('steps back from a saved zoom on a single ⌘− instead of resetting', () => {
    const t = new TerminalFontTracker(launch)
    let z = applyFontChange(1.25, t.update(plus1))
    expect(z).toBe(1.5)
    z = applyFontChange(z, t.update(launch))
    expect(z).toBe(1.25)
    const smaller = { w: 8, h: 18 }
    expect(applyFontChange(z, t.update(smaller))).toBe(1.1)
  })

  it('ignores window resizes, which keep the cell size', () => {
    const t = new TerminalFontTracker(launch)
    const resized = cellSize({ width: 900, height: 600 }, { cols: 100, rows: 30 })!
    expect(t.update(resized)).toBeNull()
    expect(applyFontChange(1.5, t.update(resized))).toBe(1.5)
  })
})

describe('zoom runtime outside the project folder', () => {
  it('every JSX module opts into the #zoom runtime with a pragma', () => {
    const { readdirSync, readFileSync } = require('fs') as typeof import('fs')
    const files = ['app.tsx', ...readdirSync(`${import.meta.dir}/src`).filter((f) => f.endsWith('.tsx')).map((f) => `src/${f}`)]
    for (const f of files) expect(`${f}: ${readFileSync(`${import.meta.dir}/${f}`, 'utf8').split('\n').slice(0, 2).join('\n')}`).toContain('@jsxImportSource #zoom')
  })

  it('scales host styles when launched from another working directory', () => {
    const { writeFileSync, rmSync } = require('fs') as typeof import('fs')
    const probe = `${import.meta.dir}/.zoom-probe.tsx`
    writeFileSync(probe, `/** @jsxImportSource #zoom */\nimport { setZoom } from './src/zoom/scale'\nsetZoom(2)\nconsole.log(JSON.stringify((<div style={{ width: 10 }} />).props.style))\n`)
    try {
      const out = Bun.spawnSync([process.execPath, probe], { cwd: require('os').tmpdir() })
      expect(out.stdout.toString().trim()).toBe('{"width":20}')
    } finally {
      rmSync(probe, { force: true })
    }
  })
})
