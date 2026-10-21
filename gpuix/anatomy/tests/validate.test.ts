import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSpec, validate, type IssueCode } from '../src/spec/validate'
import type { MachineSpec } from '../src/spec/types'

const EX = join(import.meta.dir, '..', 'examples')
const base = (): MachineSpec => ({
  version: 1,
  meta: { name: 'Test rig', description: 'Two meshing gears on a plate.', unit: 'mm' },
  bounds: 500,
  parts: [
    { id: 'plate', label: 'Plate', description: 'Holds everything.', geometry: { type: 'box', size: [200, 10, 200] }, material: { style: 'ghost', color: '#9ea7b3' } },
    { id: 'drive', label: 'Drive gear', description: 'Driver.', parentId: 'plate', geometry: { type: 'gear', teeth: 20, module: 2, thickness: 8 }, material: { style: 'wire', color: '#71b7ff' }, animation: { type: 'rotate', axis: [0, 1, 0], rpm: 60 } },
    { id: 'idler', label: 'Idler', description: 'Driven.', parentId: 'plate', transform: { position: [41, 0, 0] }, geometry: { type: 'gear', teeth: 21, module: 2, thickness: 8 }, material: { style: 'wire', color: '#f0b72f' }, animation: { type: 'rotate', axis: [0, 1, 0], drivenBy: 'drive', ratio: -20 / 21 } },
  ],
})
const codes = (s: unknown) => validate(s).map((i) => i.code)
const expectCode = (s: unknown, code: IssueCode) => {
  const c = codes(s)
  expect(c.length).toBeGreaterThan(0)
  expect(c).toContain(code)
}

describe('validator', () => {
  it('accepts the base spec and every shipped example', () => {
    expect(validate(base())).toEqual([])
    const files = readdirSync(EX).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(3)
    for (const f of files) expect({ f, issues: parseSpec(readFileSync(join(EX, f), 'utf8')).issues }).toEqual({ f, issues: [] })
  })

  it('1. schema: unknown geometry type and missing fields', () => {
    const s = base() as any
    s.parts[1].geometry = { type: 'hexagon', size: 3 }
    delete s.parts[2].label
    const issues = validate(s)
    expect(issues.every((i) => i.code === 'schema')).toBe(true)
    expect(issues.some((i) => i.path.startsWith('/parts/1/geometry'))).toBe(true)
    expect(issues.some((i) => i.path === '/parts/2')).toBe(true)
  })

  it('2. duplicate ids', () => {
    const s = base()
    s.parts[2]!.id = 'drive'
    s.parts[2]!.animation = { type: 'rotate', axis: [0, 1, 0], rpm: 10 }
    expectCode(s, 'duplicate-id')
  })

  it('3. orphan parents', () => {
    const s = base()
    s.parts[1]!.parentId = 'chassis'
    expectCode(s, 'orphan-parent')
  })

  it('4. parent cycles', () => {
    const s = base()
    s.parts[0]!.parentId = 'idler'
    s.parts[2]!.parentId = 'drive'
    expectCode(s, 'parent-cycle')
  })

  it('5. driven-by cycles', () => {
    const s = base()
    s.parts[1]!.animation = { type: 'rotate', axis: [0, 1, 0], drivenBy: 'idler', ratio: -1 }
    const issues = validate(s)
    expect(issues.map((i) => i.code)).toEqual(['driven-cycle'])
    expect(issues[0]!.message).toContain('→')
  })

  it('6. missing drivers and bad crank references', () => {
    const s = base()
    s.parts[2]!.animation = { type: 'rotate', axis: [0, 1, 0], drivenBy: 'motor' }
    expectCode(s, 'missing-ref')
    const t = base()
    t.parts.push({ id: 'piston', label: 'Piston', description: 'Slides.', geometry: { type: 'cylinder', radius: 10, height: 12 }, material: { style: 'wire', color: '#9ea7b3' }, animation: { type: 'crank', crank: 'plate', pin: [10, 0, 0], direction: [0, 1, 0], rod: 40 } })
    expect(validate(t).map((i) => i.message).join()).toContain('must have a rotate animation')
  })

  it('7. NaN / Infinity transforms', () => {
    const s = base()
    s.parts[2]!.transform = { position: [Number.NaN, 0, 0] }
    expectCode(s, 'nan')
    const text = JSON.stringify(base()).replace('[41,0,0]', '[41,Infinity,0]')
    expect(parseSpec(text).issues.map((i) => i.code)).toContain('nan')
  })

  it('8. parts outside the bounding box (through the parent chain)', () => {
    const s = base()
    s.bounds = 320
    s.parts[0]!.transform = { position: [300, 0, 0] }
    const issues = validate(s).filter((i) => i.code === 'out-of-bounds')
    expect(issues.map((i) => i.path)).toEqual(['/parts/2/transform/position'])
  })

  it('9. degenerate geometry: overlapping spring coils, oversized bore', () => {
    const s = base()
    s.parts[1]!.geometry = { type: 'spring', radius: 10, wire: 3, turns: 12, height: 20 }
    s.parts[2]!.geometry = { type: 'gear', teeth: 10, module: 1, thickness: 3, bore: 6 }
    expect(validate(s).filter((i) => i.code === 'degenerate')).toHaveLength(2)
  })

  it('reports invalid JSON instead of throwing', () => {
    expect(parseSpec('{ "version": 1, ').issues[0]!.message).toContain('invalid JSON')
  })
})
