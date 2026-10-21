export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const diff = Math.max(0, now / 1000 - unixSeconds)
  if (diff < 60) return 'just now'
  const minutes = Math.floor(diff / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30.4)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function absoluteDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/)
  if (!parts[0]) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function hashColor(text: string, palette: string[]): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export function filterCommits<T extends { sha: string; subject: string; author: string; email: string }>(commits: T[], query: string): number[] {
  const q = query.trim().toLowerCase()
  const out: number[] = []
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i]
    if (!q || c.sha.startsWith(q) || c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)) out.push(i)
  }
  return out
}

export function languageFor(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    rs: 'rust', json: 'json', md: 'markdown', py: 'python', go: 'go', toml: 'toml', yml: 'yaml', yaml: 'yaml',
    css: 'css', html: 'html', sh: 'bash', c: 'c', h: 'c', cpp: 'cpp', swift: 'swift',
  }
  return map[ext]
}

export interface TreeRow<F> {
  key: string
  depth: number
  name: string
  dir: boolean
  file?: F
  additions: number
  deletions: number
}

/** Flattens changed paths into an indented tree, compressing single-child directories like GitHub. */
export function buildTree<F extends { path: string; additions: number; deletions: number }>(files: F[], collapsed: Set<string>): TreeRow<F>[] {
  interface Node { name: string; path: string; children: Map<string, Node>; file?: F; additions: number; deletions: number }
  const root: Node = { name: '', path: '', children: new Map(), additions: 0, deletions: 0 }
  for (const f of files) {
    const parts = f.path.split('/')
    let node = root
    node.additions += f.additions
    node.deletions += f.deletions
    for (let i = 0; i < parts.length; i++) {
      const p = parts.slice(0, i + 1).join('/')
      let child = node.children.get(parts[i])
      if (!child) {
        child = { name: parts[i], path: p, children: new Map(), additions: 0, deletions: 0 }
        node.children.set(parts[i], child)
      }
      child.additions += f.additions
      child.deletions += f.deletions
      if (i === parts.length - 1) child.file = f
      node = child
    }
  }
  const rows: TreeRow<F>[] = []
  const walk = (node: Node, depth: number) => {
    const kids = [...node.children.values()].sort((a, b) => {
      const ad = a.file ? 1 : 0
      const bd = b.file ? 1 : 0
      return ad - bd || a.name.localeCompare(b.name)
    })
    for (let kid of kids) {
      let name = kid.name
      while (!kid.file && kid.children.size === 1) {
        const only = [...kid.children.values()][0]
        if (only.file) break
        name += '/' + only.name
        kid = only
      }
      if (kid.file) {
        rows.push({ key: kid.path, depth, name, dir: false, file: kid.file, additions: kid.additions, deletions: kid.deletions })
      } else {
        rows.push({ key: kid.path, depth, name, dir: true, additions: kid.additions, deletions: kid.deletions })
        if (!collapsed.has(kid.path)) walk(kid, depth + 1)
      }
    }
  }
  walk(root, 0)
  return rows
}

export interface SplitRow {
  kind: 'hunk' | 'line'
  header?: string
  left?: { no: number; text: string; type: 'ctx' | 'del' }
  right?: { no: number; text: string; type: 'ctx' | 'add' }
}

/** Pairs a unified patch into side-by-side rows the way split diff views do. */
export function toSplitRows(patch: string): SplitRow[] {
  const rows: SplitRow[] = []
  let oldNo = 0
  let newNo = 0
  let dels: { no: number; text: string }[] = []
  let adds: { no: number; text: string }[] = []
  const flush = () => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) {
      rows.push({
        kind: 'line',
        left: dels[i] ? { ...dels[i], type: 'del' } : undefined,
        right: adds[i] ? { ...adds[i], type: 'add' } : undefined,
      })
    }
    dels = []
    adds = []
  }
  let inHunk = false
  for (const line of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (m) {
      flush()
      oldNo = Number(m[1])
      newNo = Number(m[2])
      inHunk = true
      rows.push({ kind: 'hunk', header: line })
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('-')) dels.push({ no: oldNo++, text: line.slice(1) })
    else if (line.startsWith('+')) adds.push({ no: newNo++, text: line.slice(1) })
    else if (line.startsWith(' ')) {
      flush()
      rows.push({ kind: 'line', left: { no: oldNo++, text: line.slice(1), type: 'ctx' }, right: { no: newNo++, text: line.slice(1), type: 'ctx' } })
    } else if (line.startsWith('diff --git')) {
      flush()
      inHunk = false
    }
  }
  flush()
  return rows
}
