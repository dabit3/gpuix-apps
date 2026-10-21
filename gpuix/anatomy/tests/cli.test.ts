import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts')
const run = (...args: string[]) => {
  const p = Bun.spawnSync([process.execPath, CLI, ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }
}

describe('cli', () => {
  it('--help documents the launch forms', () => {
    const r = run('--help')
    expect(r.code).toBe(0)
    expect(r.out).toContain('anatomy "<description>"')
    expect(r.out).toContain('anatomy <spec.json>')
  })

  it('gen writes a spec that validate accepts; validate rejects a broken edit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-'))
    const f = join(dir, 'loco.json')
    const g = run('gen', 'a steam locomotive', '-o', f)
    expect(g.code).toBe(0)
    expect(run('validate', f).code).toBe(0)
    const spec = JSON.parse(readFileSync(f, 'utf8'))
    spec.parts[3].parentId = 'nope'
    writeFileSync(f, JSON.stringify(spec))
    const bad = run('validate', f)
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('orphan-parent')
  })

  it('unknown one-liners point at the skill', () => {
    const r = run('gen', 'a toaster')
    expect(r.code).toBe(1)
    expect(r.err).toContain('skill/SKILL.md')
  })
})
