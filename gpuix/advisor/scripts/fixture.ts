#!/usr/bin/env bun
// Reset a throwaway copy of examples/tiny-shop as a git repo on main: `bun run fixture [dir]` (default ~/demo/tiny-shop).
import { cpSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const dest = resolve(process.argv[2] ?? join(homedir(), 'demo', 'tiny-shop'))
rmSync(dest, { recursive: true, force: true })
cpSync(join(import.meta.dir, '..', 'examples', 'tiny-shop'), dest, { recursive: true })
const git = (...a: string[]) => {
  const r = Bun.spawnSync(['git', ...a], { cwd: dest, stdout: 'ignore', stderr: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'tiny-shop', GIT_AUTHOR_EMAIL: 'dev@tiny.shop', GIT_COMMITTER_NAME: 'tiny-shop', GIT_COMMITTER_EMAIL: 'dev@tiny.shop' } })
  if (r.exitCode !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`)
}
git('init', '-q', '-b', 'main')
git('add', '-A')
git('commit', '-q', '-m', 'tiny-shop 0.3.0')
console.log(dest)
