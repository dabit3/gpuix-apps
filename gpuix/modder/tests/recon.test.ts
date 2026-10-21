import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandTargets, recon } from '../src/recon'
import { FIXTURES, makeFixtures } from '../tools/make-fixtures'

const root = mkdtempSync(join(tmpdir(), 'modder-fx-'))
makeFixtures(root)

describe('recon classifies every fake install', () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    test(name, () => {
      const r = recon(join(root, name))
      expect(r.engineId).toBe(f.expect)
      expect(r.risk).toBe((f.risk ?? 'caution') as never)
      expect(r.evidence.length).toBeGreaterThan(0)
      expect(r.framework.length).toBeGreaterThan(0)
    })
  }
  test('the committed fixtures folder matches the generator', () => {
    for (const [name, f] of Object.entries(FIXTURES)) expect(recon(join(import.meta.dir, '..', 'fixtures', name)).engineId).toBe(f.expect)
  })
  test('grovekeep is the one fully supported target', () => {
    const r = recon(join(import.meta.dir, '..', 'game'))
    expect(r.engineId).toBe('grovekeep')
    expect(r.risk).toBe('ok')
    expect(r.supported).toBe(true)
    expect(r.framework).toBe('Official mod API v1')
  })
  test('anti-cheat installs are refused and get no plan', () => {
    const r = recon(join(root, 'online-shooter-eac'))
    expect(r.supported).toBe(false)
    expect(r.plan).toEqual(['Refused: anti-cheat / online protection detected.'])
  })
  test('unknown folders stay unknown', () => {
    const r = recon(mkdtempSync(join(tmpdir(), 'modder-empty-')))
    expect(r.engineId).toBe('unknown')
    expect(r.supported).toBe(false)
  })
  test('a folder of games expands to its children', () => {
    expect(expandTargets([root]).length).toBe(Object.keys(FIXTURES).length)
  })
})
