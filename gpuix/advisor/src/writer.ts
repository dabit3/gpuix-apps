import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RepoScan } from './scan'
import { planFiles, type PlannedFile } from './templates'

export type FileStatus = 'new' | 'update' | 'same'
export interface FilePlan extends PlannedFile { status: FileStatus; before: string | null }

export function readIn(root: string) {
  return (p: string) => { try { return readFileSync(join(root, p), 'utf8') } catch { return null } }
}

export function plan(s: RepoScan): FilePlan[] {
  const read = readIn(s.root)
  return planFiles(s, read).map((f) => {
    const before = read(f.path)
    return { ...f, before, status: before == null ? 'new' : before === f.content ? 'same' : 'update' }
  })
}

export function writeOne(root: string, f: PlannedFile) {
  const p = join(root, f.path)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, f.content)
  if (f.mode) chmodSync(p, f.mode)
}

export function ensureGitignore(root: string) {
  const p = join(root, '.gitignore')
  const cur = existsSync(p) ? readFileSync(p, 'utf8') : ''
  if (!cur.split('\n').includes('.claude/state/')) writeFileSync(p, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '.claude/state/\n.claude/advisor-runs/\n')
}
