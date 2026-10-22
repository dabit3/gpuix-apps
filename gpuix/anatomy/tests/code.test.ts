import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { designCodebase } from '../src/code/design'
import { classify, isScannedPath, parseImports, resolveImport, scanCodebase } from '../src/code/scan'
import { Scene } from '../src/scene'
import { isCodebaseDir, isSpecPath, loadSource } from '../src/source'
import { validate } from '../src/spec/validate'
import { Viewer } from '../src/ui/viewer'

/** A small fake monorepo: an app importing a core package by name, utils, tests, and a node_modules dir to ignore. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'anatomy-code-'))
  const put = (p: string, body: string) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), body) }
  const lines = (n: number, prefix = 'const x') => Array.from({ length: n }, (_, i) => `${prefix}${i} = ${i}`).join('\n')
  put('package.json', JSON.stringify({ name: 'demo-repo' }))
  put('packages/core/package.json', JSON.stringify({ name: '@demo/core' }))
  put('packages/core/src/index.ts', `export * from './engine'\n${lines(40)}`)
  put('packages/core/src/engine.ts', `import { clamp } from '../../../src/utils/math'\n${lines(120)}`)
  put('packages/core/src/types.ts', `export type A = number\n${lines(10)}`)
  put('src/app/main.ts', `import { start } from '@demo/core'\nimport { clamp } from '../utils/math'\nimport './view'\n${lines(60)}`)
  put('src/app/view.tsx', `import { start } from '@demo/core'\n${lines(30)}`)
  put('src/utils/math.ts', lines(25))
  put('src/utils/strings.ts', `import { clamp } from './math'\n${lines(15)}`)
  put('tests/engine.test.ts', `import { start } from '../packages/core/src/engine'\n${lines(20)}`)
  put('scripts/build.py', `from .helpers import go\nimport os\n${lines(12, 'x')}`)
  put('scripts/helpers.py', lines(8, 'y'))
  put('node_modules/left-pad/index.js', lines(500))
  return root
}

describe('codebase scanner', () => {
  it('parses imports across languages', () => {
    expect(parseImports('a.ts', `import x from './x'\nexport { y } from "../y"\nconst z = await import('./z')\nconst w = require('w')`)).toEqual(['./x', '../y', './z', 'w'])
    expect(parseImports('a.py', 'from .models import User\nimport os, sys')).toContain('.models')
    expect(parseImports('a.go', 'import (\n  "fmt"\n  "github.com/me/app/internal/db"\n)')).toContain('github.com/me/app/internal/db')
    expect(parseImports('a.c', '#include "engine.h"\n#include <stdio.h>')).toEqual(['engine.h'])
  })

  it('classifies files', () => {
    expect(classify('src/foo.test.ts')).toBe('test')
    expect(classify('tests/foo.ts')).toBe('test')
    expect(classify('src/index.ts')).toBe('entry')
    expect(classify('src/types.ts')).toBe('types')
    expect(classify('src/engine.ts')).toBe('source')
  })

  it('resolves relative, extension-less and workspace-package imports', () => {
    const index = new Set(['src/a.ts', 'src/b/index.ts', 'src/c.ts', 'packages/core/src/index.ts', 'packages/core/src/x.ts'])
    const pk = new Map([['@demo/core', 'packages/core']])
    expect(resolveImport('src/a.ts', './b', index, new Map())).toBe('src/b/index.ts')
    expect(resolveImport('src/a.ts', './c.js', index, new Map())).toBe('src/c.ts')
    expect(resolveImport('src/a.ts', '@demo/core', index, new Map(), pk)).toBe('packages/core/src/index.ts')
    expect(resolveImport('src/a.ts', '@demo/core/x', index, new Map(), pk)).toBe('packages/core/src/x.ts')
    expect(resolveImport('src/a.ts', 'react', index, new Map(), pk)).toBeUndefined()
  })

  it('only watches source paths outside skipped directories', () => {
    expect(isScannedPath('src/a.ts')).toBe(true)
    expect(isScannedPath('node_modules/x/a.ts')).toBe(false)
    expect(isScannedPath('.git/index')).toBe(false)
    expect(isScannedPath('README.md')).toBe(false)
  })

  it('scans a repo: LOC, import graph, fan-in, ignores node_modules', () => {
    const cb = scanCodebase(fixture(), { top: 12 })
    expect(cb.name).toBe('demo-repo')
    expect(cb.files.some((f) => f.path.includes('node_modules'))).toBe(false)
    const engine = cb.files.find((f) => f.path === 'packages/core/src/engine.ts')!
    expect(engine.loc).toBe(121)
    expect(engine.importedBy).toBe(2) // index.ts re-export + the test
    const math = cb.files.find((f) => f.path === 'src/utils/math.ts')!
    expect(math.importedBy).toBe(3)
    expect(cb.files.find((f) => f.path === 'scripts/build.py')!.imports).toEqual(['scripts/helpers.py'])
    expect(cb.edges.length).toBeGreaterThan(2)
    expect(cb.modules.reduce((s, m) => s + m.files.length, 0) + cb.rest.files).toBe(cb.files.length)
    expect(cb.totalLoc).toBe(cb.files.reduce((s, f) => s + f.loc, 0))
  })

  it('keeps only the top N modules and counts the rest', () => {
    const cb = scanCodebase(fixture(), { top: 3 })
    expect(cb.modules.length).toBe(3)
    expect(cb.rest.modules).toBeGreaterThan(0)
    const scores = cb.modules.map((m) => m.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })
})

describe('codebase designer', () => {
  it('builds a valid, animated machine from a scan', () => {
    const cb = scanCodebase(fixture())
    const spec = designCodebase(cb)
    expect(validate(JSON.parse(JSON.stringify(spec)))).toEqual([])
    expect(spec.meta.name).toBe('demo-repo · codebase')
    // One housing per module, each with a gear driven (directly or through belts) from the engine gear.
    const housings = spec.parts.filter((p) => p.id.startsWith('mod-') && !p.parentId)
    expect(housings.length).toBe(cb.modules.length)
    const gears = spec.parts.filter((p) => p.id.endsWith('-gear'))
    expect(gears.filter((g) => g.animation?.type === 'rotate' && 'rpm' in g.animation && g.animation.rpm).length).toBe(1)
    expect(spec.connections!.some((c) => c.type === 'belt')).toBe(true)
    expect(spec.connections!.some((c) => c.type === 'wire' && c.arc !== undefined)).toBe(true)
    // Every file part's description carries its path and line count for the inspector.
    const file = spec.parts.find((p) => p.description.startsWith('packages/core/src/engine.ts'))!
    expect(file.description).toContain('121 lines')
    // The whole thing compiles and moves on the master clock.
    const scene = new Scene(spec)
    const packet = scene.byId.get(spec.parts.find((p) => p.animation?.type === 'slide')!.id)!
    scene.pose(0.1, 0); const a = scene.partCenter(packet)
    scene.pose(1.3, 0); const b = scene.partCenter(packet)
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(1)
  })

  it('lights up changed files', () => {
    const cb = scanCodebase(fixture())
    const spec = designCodebase(cb, { hot: new Set(['src/utils/math.ts']) })
    const p = spec.parts.find((x) => x.description.startsWith('src/utils/math.ts'))!
    expect(p.material.effect).toBe('electric')
    expect(spec.annotations!.some((n) => n.part === p.id && n.text === 'just changed')).toBe(true)
  })

  it('keeps part ids stable when a rescan reorders files', () => {
    const cb = scanCodebase(fixture())
    const ids = (hot?: Set<string>) =>
      new Map(designCodebase(cb, { hot }).parts.filter((p) => p.id.includes('-f-')).map((p) => [p.description.split(' ')[0], p.id]))
    const before = ids()
    const after = ids(new Set(['src/utils/strings.ts']))
    expect(before.size).toBeGreaterThan(3)
    expect(new Set(before.values()).size).toBe(before.size)
    for (const [path, id] of before) expect(after.get(path)).toBe(id)
  })

  it('routes directories to codebase mode and keeps json/description modes', () => {
    const dir = fixture()
    expect(isCodebaseDir(dir)).toBe(true)
    expect(isSpecPath(dir)).toBe(false)
    expect(isSpecPath('specs/v8.json')).toBe(true)
    const src = loadSource(dir, { top: 4 })
    expect(src.dir).toBe(dir)
    expect(src.codebase!.modules.length).toBeLessThanOrEqual(4)
    expect(loadSource('a V8 engine').dir).toBeUndefined()
  })

  it('n / b keys change the module count only in codebase mode', () => {
    const palette = { bg: [0, 0, 0] as [number, number, number], grid: [9, 9, 9] as [number, number, number], accent: [0, 128, 255] as [number, number, number] }
    const v = new Viewer(designCodebase(scanCodebase(fixture())), palette, '.')
    expect(v.key('n')).toBe(false)
    const calls: number[] = []
    v.code = { top: 12, setTop: (n) => calls.push(n) }
    expect(v.key('n')).toBe(true)
    expect(v.key('b')).toBe(true)
    expect(calls).toEqual([14, 10])
  })
})
