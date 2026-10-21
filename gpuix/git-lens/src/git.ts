import { execFile } from 'node:child_process'

export interface RunOptions {
  input?: string
  okCodes?: number[]
}

export function git(repo: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', 'core.quotepath=off', '-c', 'color.ui=never', ...args],
      { cwd: repo, maxBuffer: 1024 * 1024 * 512, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as any).code === 'number' ? (error as any).code : 1) : 0
        if (error && !(opts.okCodes ?? []).includes(code)) {
          reject(new Error(`git ${args[0]} failed: ${String(stderr || error.message).trim()}`))
          return
        }
        resolve(stdout)
      },
    )
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input)
    }
  })
}

export async function repoRoot(path: string): Promise<string> {
  return (await git(path, ['rev-parse', '--show-toplevel'])).trim()
}

export interface Ref {
  name: string
  short: string
  kind: 'head' | 'remote' | 'tag'
  sha: string
  date: number
  current: boolean
  track: string
}

export async function refs(repo: string): Promise<Ref[]> {
  const out = await git(repo, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(committerdate:unix)%00%(HEAD)%00%(upstream:track)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ])
  const result: Ref[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [name, short, sha, date, head, track] = line.split('\0')
    if (name.endsWith('/HEAD')) continue
    const kind = name.startsWith('refs/heads/') ? 'head' : name.startsWith('refs/remotes/') ? 'remote' : 'tag'
    result.push({ name, short, kind, sha, date: Number(date) || 0, current: head === '*', track: track ?? '' })
  }
  return result
}

export async function currentBranch(repo: string): Promise<string> {
  return (await git(repo, ['symbolic-ref', '--short', '-q', 'HEAD'], { okCodes: [1] })).trim() || 'HEAD'
}

export interface Commit {
  sha: string
  parents: string[]
  author: string
  email: string
  time: number
  subject: string
  refs: string[]
}

const RS = '\x1e'
const US = '\x1f'

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = []
  for (const record of out.split(RS)) {
    const trimmed = record.replace(/^\n/, '')
    if (!trimmed) continue
    const [sha, parents, author, email, time, subject, decoration] = trimmed.split(US)
    commits.push({
      sha,
      parents: parents ? parents.split(' ') : [],
      author,
      email,
      time: Number(time),
      subject,
      refs: decoration
        ? decoration
            .trim()
            .split(', ')
            .map((r) => r.replace(/^HEAD -> /, ''))
            .filter((r) => r && r !== 'HEAD' && !r.endsWith('/HEAD'))
        : [],
    })
  }
  return commits
}

/** `ref` is a revision or `--all`. Commits come in topological order so graph lanes stay stable. */
export async function log(repo: string, ref = 'HEAD', limit?: number): Promise<Commit[]> {
  const args = ['log', '--topo-order', `--format=${RS}%H${US}%P${US}%an${US}%ae${US}%at${US}%s${US}%D`]
  if (limit) args.push(`-n${limit}`)
  args.push(ref === '--all' ? '--all' : ref, '--')
  const out = await git(repo, args, { okCodes: [128] })
  return parseLog(out)
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'

export interface ChangedFile {
  path: string
  oldPath?: string
  status: FileStatus
  additions: number
  deletions: number
  binary: boolean
}

export interface CommitDetail {
  sha: string
  parents: string[]
  author: string
  email: string
  authorTime: number
  committer: string
  commitTime: number
  message: string
  files: ChangedFile[]
}

function parseNumstatZ(out: string): ChangedFile[] {
  const tokens = out.split('\0')
  const files: ChangedFile[] = []
  let i = 0
  while (i < tokens.length) {
    const head = tokens[i++]
    if (!head) continue
    const [a, d, maybePath] = head.split('\t')
    let path = maybePath
    let oldPath: string | undefined
    if (maybePath === '') {
      oldPath = tokens[i++]
      path = tokens[i++]
    }
    const binary = a === '-'
    files.push({ path, oldPath, status: oldPath ? 'R' : 'M', additions: binary ? 0 : Number(a), deletions: binary ? 0 : Number(d), binary })
  }
  return files
}

function parseNameStatusZ(out: string): Map<string, FileStatus> {
  const tokens = out.split('\0')
  const map = new Map<string, FileStatus>()
  let i = 0
  while (i < tokens.length) {
    const status = tokens[i++]
    if (!status) continue
    const letter = status[0] as FileStatus
    if (letter === 'R' || letter === 'C') {
      i++
      map.set(tokens[i++], letter)
    } else {
      map.set(tokens[i++], letter)
    }
  }
  return map
}

export async function commitDetail(repo: string, sha: string): Promise<CommitDetail> {
  const header = await git(repo, ['show', '-s', `--format=%H${US}%P${US}%an${US}%ae${US}%at${US}%cn${US}%ct${US}%B`, sha])
  const [full, parents, author, email, at, cn, ct, ...body] = header.split(US)
  const parentList = parents ? parents.split(' ') : []
  const range = parentList.length ? [parentList[0], full] : ['--root', full]
  const [numstat, nameStatus] = await Promise.all([
    git(repo, ['diff-tree', '-r', '-M', '--no-commit-id', '-z', '--numstat', ...range]),
    git(repo, ['diff-tree', '-r', '-M', '--no-commit-id', '-z', '--name-status', ...range]),
  ])
  const statuses = parseNameStatusZ(nameStatus)
  const files = parseNumstatZ(numstat).map((f) => ({ ...f, status: statuses.get(f.path) ?? f.status }))
  return {
    sha: full,
    parents: parentList,
    author,
    email,
    authorTime: Number(at),
    committer: cn,
    commitTime: Number(ct),
    message: body.join(US).trim(),
    files,
  }
}

export async function commitFileDiff(repo: string, detail: CommitDetail, file: ChangedFile): Promise<string> {
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
  if (detail.parents.length) {
    return git(repo, ['diff', '-M', detail.parents[0], detail.sha, '--', ...paths])
  }
  return git(repo, ['diff-tree', '-p', '-M', '--root', '--no-commit-id', detail.sha, '--', ...paths])
}

export async function fileAt(repo: string, sha: string, path: string): Promise<string | null> {
  try {
    return await git(repo, ['show', `${sha}:${path}`])
  } catch {
    return null
  }
}

export interface BlameLine {
  sha: string
  author: string
  time: number
  summary: string
  lineNo: number
  text: string
  chunkStart: boolean
}

export function parseBlame(out: string): BlameLine[] {
  const meta = new Map<string, { author: string; time: number; summary: string }>()
  const lines: BlameLine[] = []
  const rows = out.split('\n')
  let current: { sha: string; lineNo: number } | null = null
  let pending: { author?: string; time?: number; summary?: string } = {}
  let previousSha = ''
  for (const row of rows) {
    if (row.startsWith('\t')) {
      if (!current) continue
      if (!meta.has(current.sha)) {
        meta.set(current.sha, { author: pending.author ?? '', time: pending.time ?? 0, summary: pending.summary ?? '' })
      }
      const m = meta.get(current.sha)!
      lines.push({ sha: current.sha, ...m, lineNo: current.lineNo, text: row.slice(1), chunkStart: current.sha !== previousSha })
      previousSha = current.sha
      current = null
      pending = {}
      continue
    }
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row)
    if (header) {
      current = { sha: header[1], lineNo: Number(header[2]) }
      continue
    }
    if (row.startsWith('author ')) pending.author = row.slice(7)
    else if (row.startsWith('author-time ')) pending.time = Number(row.slice(12))
    else if (row.startsWith('summary ')) pending.summary = row.slice(8)
  }
  return lines
}

export async function blame(repo: string, sha: string, path: string): Promise<BlameLine[]> {
  return parseBlame(await git(repo, ['blame', '--porcelain', sha, '--', path]))
}

export interface StatusEntry {
  path: string
  oldPath?: string
  staged: FileStatus | null
  unstaged: FileStatus | null
}

export async function status(repo: string): Promise<StatusEntry[]> {
  const out = await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const tokens = out.split('\0')
  const entries: StatusEntry[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i++]
    if (!t) continue
    const x = t[0]
    const y = t[1]
    const path = t.slice(3)
    let oldPath: string | undefined
    if (x === 'R' || x === 'C') oldPath = tokens[i++]
    if (x === '?' && y === '?') {
      entries.push({ path, staged: null, unstaged: '?' })
      continue
    }
    entries.push({
      path,
      oldPath,
      staged: x === ' ' ? null : (x as FileStatus),
      unstaged: y === ' ' ? null : (y as FileStatus),
    })
  }
  return entries
}

export async function workingDiff(repo: string, entry: StatusEntry, staged: boolean): Promise<string> {
  if (!staged && entry.unstaged === '?') {
    return git(repo, ['diff', '--no-index', '--', '/dev/null', entry.path], { okCodes: [1] })
  }
  return git(repo, ['diff', ...(staged ? ['--cached'] : []), '--', entry.path])
}

export async function hasHead(repo: string): Promise<boolean> {
  try {
    await git(repo, ['rev-parse', '--verify', '-q', 'HEAD'])
    return true
  } catch {
    return false
  }
}

export async function stageFile(repo: string, path: string): Promise<void> {
  await git(repo, ['add', '-A', '--', path])
}

export async function unstageFile(repo: string, path: string): Promise<void> {
  if (await hasHead(repo)) await git(repo, ['reset', '-q', 'HEAD', '--', path])
  else await git(repo, ['rm', '--cached', '-q', '--', path])
}

export interface Hunk {
  header: string
  body: string
  additions: number
  deletions: number
}

export interface ParsedPatch {
  header: string
  hunks: Hunk[]
}

export function splitPatch(patch: string): ParsedPatch {
  const lines = patch.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const headerLines: string[] = []
  const hunks: Hunk[] = []
  let current: { header: string; lines: string[] } | null = null
  const flush = () => {
    if (!current) return
    const body = current.lines.join('\n') + '\n'
    let additions = 0
    let deletions = 0
    for (const l of current.lines.slice(1)) {
      if (l.startsWith('+')) additions++
      else if (l.startsWith('-')) deletions++
    }
    hunks.push({ header: current.header, body, additions, deletions })
  }
  for (const line of lines) {
    if (line.startsWith('@@')) {
      flush()
      current = { header: line, lines: [line] }
    } else if (current) {
      current.lines.push(line)
    } else {
      headerLines.push(line)
    }
  }
  flush()
  return { header: headerLines.join('\n') + '\n', hunks }
}

/** Stage (or with `reverse`, unstage) one hunk through the index, exactly like `git add -p`. */
export async function applyHunk(repo: string, patch: ParsedPatch, hunk: Hunk, reverse: boolean): Promise<void> {
  const text = patch.header + hunk.body
  await git(repo, ['apply', '--cached', '--unidiff-zero', '--whitespace=nowarn', ...(reverse ? ['-R'] : []), '-'], { input: text })
}

export async function commit(repo: string, message: string): Promise<string> {
  await git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-F', '-'], { input: message })
  return (await git(repo, ['rev-parse', 'HEAD'])).trim()
}

export async function readme(repo: string, ref = 'HEAD'): Promise<{ path: string; text: string } | null> {
  const out = await git(repo, ['ls-tree', '--name-only', ref], { okCodes: [128] })
  const name = out.split('\n').find((n) => /^readme(\.md|\.markdown)?$/i.test(n))
  if (!name) return null
  const text = await fileAt(repo, ref, name)
  return text === null ? null : { path: name, text }
}
