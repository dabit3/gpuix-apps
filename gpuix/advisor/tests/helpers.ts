import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirs: string[] = []
/** Copies examples/tiny-shop into a fresh git repo on main. */
export function fixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'advisor-')), 'tiny-shop')
  dirs.push(dir)
  cpSync(join(import.meta.dir, '../examples/tiny-shop'), dir, { recursive: true })
  const git = (...a: string[]) => Bun.spawnSync(['git', ...a], { cwd: dir, stdout: 'ignore', stderr: 'ignore' })
  git('init', '-q', '-b', 'main'); git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  return dir
}
export function cleanup() { for (const d of dirs.splice(0)) rmSync(join(d, '..'), { recursive: true, force: true }) }
export const RUN = join(import.meta.dir, '../examples/runs/claude-code-dry-run.jsonl')
