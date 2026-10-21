import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function sh(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `export const ${tag}${i} = ${i}`).join('\n') + '\n'

/** A small repo with a merged feature branch and two unstaged hunks in src/app.ts. */
export function makeScratchRepo(dir?: string): string {
  const repo = dir ?? mkdtempSync(join(tmpdir(), 'git-lens-scratch-'))
  mkdirSync(repo, { recursive: true })
  sh(repo, 'init', '-q', '-b', 'main')
  sh(repo, 'config', 'user.name', 'Ada Lovelace')
  sh(repo, 'config', 'user.email', 'ada@example.com')
  sh(repo, 'config', 'commit.gpgsign', 'false')
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'README.md'), '# Scratch\n\nA scratch repo for **git-lens**.\n')
  writeFileSync(join(repo, 'src/app.ts'), lines(40, 'value'))
  sh(repo, 'add', '-A')
  sh(repo, 'commit', '-q', '-m', 'Initial commit')
  sh(repo, 'checkout', '-q', '-b', 'feature/search')
  writeFileSync(join(repo, 'src/search.ts'), 'export const search = (q: string) => q.trim()\n')
  sh(repo, 'add', '-A')
  sh(repo, 'commit', '-q', '-m', 'Add search helper')
  sh(repo, 'checkout', '-q', 'main')
  writeFileSync(join(repo, 'README.md'), '# Scratch\n\nA scratch repo for **git-lens**.\n\nNow with docs.\n')
  sh(repo, 'commit', '-q', '-am', 'Document the scratch repo')
  sh(repo, 'merge', '-q', '--no-ff', '-m', 'Merge branch feature/search', 'feature/search')
  const edited = lines(40, 'value').split('\n')
  edited[2] = 'export const value2 = 200 // first hunk'
  edited[35] = 'export const value35 = 3500 // second hunk'
  writeFileSync(join(repo, 'src/app.ts'), edited.join('\n'))
  return repo
}
