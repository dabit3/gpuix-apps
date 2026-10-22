import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, posix, relative, resolve } from 'node:path'

export const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.php', '.vue', '.svelte', '.zig', '.ex', '.exs', '.scala', '.dart', '.lua'])
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.next', '.turbo', 'coverage', '__pycache__', '.venv', 'venv', '.cache', 'Pods', '.build', 'DerivedData'])
const MAX_FILES = 6000

/** Does a change to this repo-relative path matter to a scan? (Used by the live watcher.) */
export const isScannedPath = (p: string) => SOURCE_EXT.has(extname(p)) && !p.split(/[\\/]/).some((s) => SKIP_DIRS.has(s))
const MAX_BYTES = 400_000

export type FileKind = 'source' | 'test' | 'entry' | 'types' | 'config'

export interface CodeFile {
  path: string
  ext: string
  loc: number
  kind: FileKind
  imports: string[]
  importedBy: number
  churn: number
}

export interface CodeModule {
  /** Directory path relative to the repo root ("." for root-level files). */
  path: string
  files: CodeFile[]
  loc: number
  fanIn: number
  fanOut: number
  churn: number
  score: number
}

export interface CodeEdge { from: string; to: string; weight: number }

export interface Codebase {
  root: string
  name: string
  files: CodeFile[]
  modules: CodeModule[]
  /** Modules folded into the "everything else" bucket because they fell outside the top N. */
  rest: { modules: number; files: number; loc: number }
  edges: CodeEdge[]
  languages: { ext: string; loc: number }[]
  totalLoc: number
  commits: number
}

/** List tracked files (git) or walk the tree, keeping source files only. */
export function listFiles(root: string): string[] {
  let files: string[] | undefined
  if (existsSync(join(root, '.git')) || existsSync(join(root, '..', '.git'))) {
    try {
      const out = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })
      files = out.split('\n').filter(Boolean)
    } catch { files = undefined }
  }
  if (!files) {
    files = []
    const walk = (dir: string) => {
      if (files!.length > MAX_FILES * 4) return
      for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (e.name.startsWith('.') && e.name !== '.') continue
        const rel = dir ? `${dir}/${e.name}` : e.name
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel) } else files!.push(rel)
      }
    }
    walk('')
  }
  return files
    .filter((f) => SOURCE_EXT.has(extname(f)) && !f.split('/').some((s) => SKIP_DIRS.has(s)) && !/\.(min|d)\.[cm]?[jt]s$/.test(f) && !/(^|\/)(fixtures?|__snapshots__|examples?\/.*\/node_modules)\//.test(f))
    .slice(0, MAX_FILES)
}

export function classify(path: string): FileKind {
  const b = basename(path).toLowerCase()
  if (/(\.|_)(test|spec)\.|^test_|_test\.(go|py|rs)$|(^|\/)(__tests__|tests?)\//.test(path.toLowerCase())) return 'test'
  if (/^(index|main|mod|lib|app|cli|server|__init__|__main__)\.[a-z]+$/.test(b)) return 'entry'
  if (/^types?\.|\.types?\.|(^|\/)types\//.test(b) || b.endsWith('.d.ts')) return 'types'
  if (/(config|\.rc|settings|constants?)\./.test(b)) return 'config'
  return 'source'
}

const JS_IMPORT = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const PY_IMPORT = /^\s*from\s+([.\w]+)\s+import|^\s*import\s+([\w.]+)/gm
const GO_IMPORT = /"([\w./-]+)"/g
const RS_IMPORT = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;|use\s+(?:crate|super)::([\w:]+)/gm
const C_IMPORT = /#include\s+"([^"]+)"/g

/** Raw import specifiers by language (regex, clean-room, no parsers). */
export function parseImports(path: string, text: string): string[] {
  const ext = extname(path)
  const out: string[] = []
  const grab = (re: RegExp) => { re.lastIndex = 0; let m; while ((m = re.exec(text))) { const s = m.slice(1).find(Boolean); if (s) out.push(s) } }
  if (/\.(m|c)?[jt]sx?$|\.vue$|\.svelte$/.test(ext)) grab(JS_IMPORT)
  else if (ext === '.py') grab(PY_IMPORT)
  else if (ext === '.go') { const blocks = text.match(/import\s*\(([\s\S]*?)\)|import\s+"[^"]+"/g) ?? []; for (const b of blocks) { GO_IMPORT.lastIndex = 0; let m; while ((m = GO_IMPORT.exec(b))) out.push(m[1]!) } }
  else if (ext === '.rs') grab(RS_IMPORT)
  else if (/\.(c|cc|cpp|h|hpp)$/.test(ext)) grab(C_IMPORT)
  return out
}

/** Map an import specifier to a repo file, or undefined when it's external. */
export function resolveImport(from: string, spec: string, index: Set<string>, byStem: Map<string, string[]>, packages: Map<string, string> = new Map()): string | undefined {
  const ext = extname(from)
  const dir = posix.dirname(from)
  const tryPaths = (base: string) => {
    const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.vue', '.svelte', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs']
    for (const e of exts) { const p = posix.normalize(base + e); if (index.has(p)) return p }
    const noJs = base.replace(/\.(m|c)?js$/, '')
    if (noJs !== base) for (const e of ['.ts', '.tsx', '.mts', '.cts']) { const p = posix.normalize(noJs + e); if (index.has(p)) return p }
    return undefined
  }
  if (/\.(m|c)?[jt]sx?$|\.vue$|\.svelte$/.test(ext)) {
    if (spec.startsWith('.')) return tryPaths(posix.join(dir, spec))
    if (spec.startsWith('@/') || spec.startsWith('~/')) return tryPaths(`src/${spec.slice(2)}`) ?? tryPaths(spec.slice(2))
    if (spec.startsWith('src/')) return tryPaths(spec)
    // Workspace packages: `@scope/pkg` or `pkg/sub` resolve to the package's own sources.
    const m = spec.match(/^(@[^/]+\/[^/]+|[^/@.][^/]*)(?:\/(.+))?$/)
    const pdir = m ? packages.get(m[1]!) : undefined
    if (pdir !== undefined) {
      const at = (s: string) => (pdir ? `${pdir}/${s}` : s)
      return m![2] ? tryPaths(at(`src/${m![2]}`)) ?? tryPaths(at(m![2])) : tryPaths(at('src/index')) ?? tryPaths(at('index')) ?? tryPaths(at('src/main')) ?? tryPaths(at('js/index')) ?? tryPaths(at('lib/index'))
    }
    return undefined
  }
  if (ext === '.py') {
    let base: string
    if (spec.startsWith('.')) {
      const ups = spec.match(/^\.+/)![0].length
      let d = dir
      for (let i = 1; i < ups; i++) d = posix.dirname(d)
      base = posix.join(d, spec.slice(ups).replace(/\./g, '/'))
    } else base = spec.replace(/\./g, '/')
    for (const c of [`${base}.py`, `${base}/__init__.py`]) if (index.has(posix.normalize(c))) return posix.normalize(c)
    const tail = spec.split('.').pop()!
    const hits = byStem.get(tail)?.filter((p) => p.endsWith('.py') && p.includes(base.split('/')[0]!))
    return hits?.length === 1 ? hits[0] : undefined
  }
  if (ext === '.go') {
    // Package path: match the longest repo directory suffix, then point at its first file.
    const parts = spec.split('/')
    for (let k = Math.min(parts.length, 4); k >= 1; k--) {
      const suffix = parts.slice(-k).join('/')
      const hit = [...index].find((p) => p.endsWith('.go') && posix.dirname(p).endsWith(suffix) && !p.endsWith('_test.go'))
      if (hit) return hit
    }
    return undefined
  }
  if (ext === '.rs') {
    const name = spec.split('::')[0]!
    for (const c of [posix.join(dir, `${name}.rs`), posix.join(dir, name, 'mod.rs'), `src/${name}.rs`, `src/${name}/mod.rs`]) if (index.has(c)) return c
    return undefined
  }
  if (/\.(c|cc|cpp|h|hpp)$/.test(ext)) {
    const p = posix.normalize(posix.join(dir, spec))
    if (index.has(p)) return p
    const hits = byStem.get(posix.basename(spec))
    return hits?.length === 1 ? hits[0] : undefined
  }
  return undefined
}

/** package.json names found in any ancestor directory of a source file, mapped to that directory ('' = root). */
export function workspacePackages(root: string, paths: string[]): Map<string, string> {
  const dirs = new Set<string>([''])
  for (const p of paths) { let d = posix.dirname(p); while (d !== '.' && !dirs.has(d)) { dirs.add(d); d = posix.dirname(d) } }
  const out = new Map<string, string>()
  for (const d of dirs) {
    const f = join(root, d, 'package.json')
    if (!existsSync(f)) continue
    try { const name = (JSON.parse(readFileSync(f, 'utf8')) as { name?: string }).name; if (name && !out.has(name)) out.set(name, d) } catch {}
  }
  return out
}

function gitChurn(root: string, commits = 400): { churn: Map<string, number>; total: number } {
  const churn = new Map<string, number>()
  try {
    const prefix = execFileSync('git', ['-C', root, 'rev-parse', '--show-prefix'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const out = execFileSync('git', ['-C', root, 'log', `-n${commits}`, '--name-only', '--pretty=format:@@', '--', '.'], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })
    let total = 0
    for (const line of out.split('\n')) {
      if (line === '@@') { total++; continue }
      if (!line) continue
      const rel = prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line
      churn.set(rel, (churn.get(rel) ?? 0) + 1)
    }
    return { churn, total }
  } catch { return { churn, total: 0 } }
}

/**
 * Group files into modules by directory. Start from the top-level folders and keep splitting the biggest group into
 * its sub-folders while there's room under `top`, so `src/` alone becomes `src/router`, `src/middleware`, ...
 */
export function groupModules(files: CodeFile[], top: number): Map<string, CodeFile[]> {
  const dirOf = (f: CodeFile, depth: number) => { const segs = f.path.split('/').slice(0, -1); return segs.length ? segs.slice(0, depth).join('/') : '.' }
  const depthOf = new Map<string, number>()
  let groups = new Map<string, CodeFile[]>()
  const put = (g: Map<string, CodeFile[]>, k: string, f: CodeFile) => { const a = g.get(k); if (a) a.push(f); else g.set(k, [f]) }
  for (const f of files) put(groups, dirOf(f, 1), f)
  for (const k of groups.keys()) depthOf.set(k, 1)
  const target = Math.max(top, 4)
  for (let guard = 0; guard < 200; guard++) {
    const locOf = (fs: CodeFile[]) => fs.reduce((s, f) => s + f.loc, 0)
    const total = [...groups.values()].reduce((s, fs) => s + locOf(fs), 0)
    const splittable = [...groups.entries()]
      .filter(([k, fs]) => k !== '.' && !k.endsWith('/·') && new Set(fs.map((f) => dirOf(f, depthOf.get(k)! + 1))).size > 1)
      .sort((a, b) => locOf(b[1]) - locOf(a[1]))
    const big = splittable[0]
    if (!big) break
    const [key, fs] = big
    const children = new Map<string, CodeFile[]>()
    const d = depthOf.get(key)! + 1
    for (const f of fs) { const c = dirOf(f, d); put(children, c === key ? `${key}/·` : c, f) }
    // Split when we still have room, or when one group is a lopsided majority of the code (a lone src/).
    if (groups.size - 1 + children.size > target * 1.6 && locOf(fs) < total * 0.5) break
    groups.delete(key)
    for (const [c, cf] of children) { put(groups, c, cf[0]!); groups.get(c)!.push(...cf.slice(1)); depthOf.set(c, d) }
    groups = new Map([...groups.entries()].map(([k, v]) => [k, [...new Set(v)]]))
    if (groups.size >= target && locOf(fs) < total * 0.5) break
  }
  return groups
}

/** Scan a directory: files, lines of code, resolved import graph, git churn, and the top-N modules ranked. */
export function scanCodebase(dir: string, opts: { top?: number } = {}): Codebase {
  const root = resolve(dir)
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${dir} is not a directory`)
  const top = Math.max(3, Math.min(24, opts.top ?? 12))
  const paths = listFiles(root)
  if (!paths.length) throw new Error(`no source files found in ${dir}`)
  const index = new Set(paths)
  const byStem = new Map<string, string[]>()
  for (const p of paths) { const s = basename(p).replace(/\.[^.]+$/, ''); const a = byStem.get(s); if (a) a.push(p); else byStem.set(s, [p]); const b = basename(p); if (b !== s) { const a2 = byStem.get(b); if (a2) a2.push(p); else byStem.set(b, [p]) } }
  const { churn, total: commits } = gitChurn(root)
  const packages = workspacePackages(root, paths)
  const files: CodeFile[] = []
  for (const p of paths) {
    let text = ''
    try { const st = statSync(join(root, p)); if (st.size > MAX_BYTES) continue; text = readFileSync(join(root, p), 'utf8') } catch { continue }
    const loc = text.split('\n').filter((l) => l.trim()).length
    files.push({ path: p, ext: extname(p), loc, kind: classify(p), imports: parseImports(p, text), importedBy: 0, churn: churn.get(p) ?? 0 })
  }
  const byPath = new Map(files.map((f) => [f.path, f]))
  for (const f of files) {
    const res = new Set<string>()
    for (const s of f.imports) { const r = resolveImport(f.path, s, index, byStem, packages); if (r && r !== f.path && byPath.has(r)) res.add(r) }
    f.imports = [...res]
    for (const r of res) byPath.get(r)!.importedBy++
  }

  const groups = groupModules(files, top)
  const modOf = new Map<string, string>()
  for (const [k, fs] of groups) for (const f of fs) modOf.set(f.path, k)
  const edgeW = new Map<string, number>()
  for (const f of files) for (const r of f.imports) {
    const a = modOf.get(f.path)!, b = modOf.get(r)!
    if (a !== b) edgeW.set(`${a}\u0000${b}`, (edgeW.get(`${a}\u0000${b}`) ?? 0) + 1)
  }
  let modules: CodeModule[] = [...groups.entries()].map(([path, fs]) => {
    const fanIn = new Set([...edgeW.keys()].filter((k) => k.endsWith(`\u0000${path}`)).map((k) => k.split('\u0000')[0])).size
    const fanOut = new Set([...edgeW.keys()].filter((k) => k.startsWith(`${path}\u0000`)).map((k) => k.split('\u0000')[1])).size
    const loc = fs.reduce((s, f) => s + f.loc, 0)
    const ch = fs.reduce((s, f) => s + f.churn, 0)
    return { path, files: fs.sort((a, b) => fileScore(b) - fileScore(a)), loc, fanIn, fanOut, churn: ch, score: loc * (1 + Math.log1p(fanIn) * 0.8 + Math.log1p(ch) * 0.15) }
  })
  modules.sort((a, b) => b.score - a.score)
  const kept = modules.slice(0, top)
  const dropped = modules.slice(top)
  const keep = new Set(kept.map((m) => m.path))
  modules = kept
  const edges: CodeEdge[] = [...edgeW.entries()].map(([k, weight]) => { const [from, to] = k.split('\u0000') as [string, string]; return { from, to, weight } }).filter((e) => keep.has(e.from) && keep.has(e.to)).sort((a, b) => b.weight - a.weight)
  const lang = new Map<string, number>()
  for (const f of files) lang.set(f.ext, (lang.get(f.ext) ?? 0) + f.loc)
  return {
    root,
    name: repoName(root),
    files,
    modules,
    rest: { modules: dropped.length, files: dropped.reduce((s, m) => s + m.files.length, 0), loc: dropped.reduce((s, m) => s + m.loc, 0) },
    edges,
    languages: [...lang.entries()].map(([ext, loc]) => ({ ext, loc })).sort((a, b) => b.loc - a.loc),
    totalLoc: files.reduce((s, f) => s + f.loc, 0),
    commits,
  }
}

export const fileScore = (f: CodeFile) => f.loc * (1 + Math.log1p(f.importedBy)) * (f.kind === 'test' ? 0.35 : 1)

function repoName(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string }
    if (pkg.name) return pkg.name
  } catch {}
  return basename(root) || relative(dirname(root), root)
}
