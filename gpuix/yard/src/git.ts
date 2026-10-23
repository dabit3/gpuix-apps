import { spawn } from 'node:child_process'
import { dirname, join, sep } from 'node:path'

export type GitCode = 'M' | 'A' | 'D' | 'R' | '?'
export interface GitInfo {
  root: string
  branch: string
  ahead: number
  /** Absolute path → status. Folders carry the status of the most notable change inside them. */
  status: Map<string, GitCode>
}

/**
 * yard runs git in whatever folder the user browses, so the repo config may be hostile.
 * These overrides stop repo-controlled config from running commands during status.
 */
const HARDEN = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'safe.bareRepository=explicit',
  '-c', 'submodule.recurse=false',
  '--no-optional-locks',
]
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }

const run = (args: string[], cwd: string) =>
  new Promise<string | null>((resolve) => {
    let out = ''
    const p = spawn('git', [...HARDEN, ...args], { cwd, env: ENV, stdio: ['ignore', 'pipe', 'ignore'] })
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => resolve(null))
    p.on('close', (code) => resolve(code === 0 ? out : null))
  })

/**
 * `-c` overrides that turn every configured filter driver into a no-op, since `git status`
 * runs clean filters while refreshing the index. Returns null when a driver name can't be
 * overridden safely (contains `=` or a newline).
 */
export function filterOverrides(varList: string): string[] | null {
  const names = new Set<string>()
  for (const line of varList.split('\n')) {
    if (!line.toLowerCase().startsWith('filter.')) continue
    // The subsection name may itself contain dots, so neutralize every possible split.
    const re = /\.(clean|smudge|process|required)=/gi
    for (let m; (m = re.exec(line)); ) names.add(line.slice('filter.'.length, m.index))
  }
  const out: string[] = []
  for (const n of names) {
    if (!n || /[=\n\r]/.test(n)) return null
    out.push('-c', `filter.${n}.clean=`, '-c', `filter.${n}.smudge=`, '-c', `filter.${n}.process=`, '-c', `filter.${n}.required=false`)
  }
  return out
}

const RANK: Record<GitCode, number> = { '?': 1, A: 2, R: 2, D: 3, M: 4 }

export function parseStatus(root: string, porcelain: string): Omit<GitInfo, 'root'> {
  const status = new Map<string, GitCode>()
  let branch = ''
  let ahead = 0
  const parts = porcelain.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]!
    if (!line) continue
    if (line.startsWith('## ')) {
      const m = line.slice(3).match(/^(?:No commits yet on )?([^.\s]+)(?:\.\.\.\S+)?(?: \[ahead (\d+))?/)
      branch = m?.[1] ?? ''
      ahead = m?.[2] ? +m[2] : 0
      continue
    }
    const xy = line.slice(0, 2)
    const rel = line.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C') i++
    const code: GitCode = xy === '??' ? '?' : xy.includes('D') ? 'D' : xy[0] === 'R' ? 'R' : xy[0] === 'A' ? 'A' : 'M'
    let abs = join(root, rel.replace(/\/$/, ''))
    status.set(abs, code)
    while ((abs = dirname(abs)).length >= root.length && abs !== root) {
      const prev = status.get(abs)
      if (!prev || RANK[code] > RANK[prev]) status.set(abs, code)
    }
  }
  return { branch, ahead, status }
}

export async function gitInfo(dir: string): Promise<GitInfo | null> {
  const root = (await run(['rev-parse', '--show-toplevel'], dir))?.trim()
  if (!root) return null
  const vars = await run(['var', '-l'], dir)
  const filters = vars === null ? null : filterOverrides(vars)
  if (!filters) return null
  const out = await run([...filters, 'status', '--porcelain=v1', '-z', '-b', '--untracked-files=all', '--ignore-submodules=all'], dir)
  if (out === null) return null
  return { root: root.split('/').join(sep), ...parseStatus(root, out) }
}
