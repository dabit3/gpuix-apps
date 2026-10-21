import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

export type RiskKind = 'auth' | 'payments' | 'migrations' | 'public-api'
export interface RiskHit { kind: RiskKind; file: string; line: number; text: string }
export interface Invariant { text: string; source: string; confirmed: boolean }
export interface RepoScan {
  root: string
  name: string
  packageManager: string
  commands: { test?: string; lint?: string; typecheck?: string }
  files: string[]
  risks: RiskHit[]
  riskFiles: Record<RiskKind, string[]>
  invariants: Invariant[]
  hasClaudeMd: boolean
  branch: string | null
  baseBranch: string
}

const IGNORE = new Set(['.git', 'node_modules', 'dist', 'build', '.build', 'target', '.next', 'out', 'coverage', '.venv', 'venv', '__pycache__', '.claude'])
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|\.test\.|\.spec\./
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|sql|prisma|php|cs|swift)$/

export function listFiles(root: string, limit = 4000): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir).sort() } catch { return }
    for (const e of entries) {
      if (out.length >= limit) return
      if (IGNORE.has(e) || e.startsWith('.DS_')) continue
      const p = join(dir, e)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else out.push(relative(root, p))
    }
  }
  walk(root)
  return out
}

const RISK_PATH: [RiskKind, RegExp][] = [
  ['migrations', /(^|\/)(migrations?|migrate|schema)(\/|\.)|\.sql$|schema\.prisma$/i],
  ['auth', /(^|\/)(auth|session|login|permissions?|acl|rbac|jwt|oauth)[^/]*$/i],
  ['payments', /(^|\/)(payments?|billing|checkout|invoice|stripe|cart|orders?|pricing|discounts?)[^/]*$/i],
  ['public-api', /(^|\/)(routes?|api|controllers?|handlers?|endpoints?|graphql)(\/|\.|$)/i],
]
const RISK_LINE: [RiskKind, RegExp][] = [
  ['auth', /\b(verify|authori[sz]e|canManage|isAdmin|role|session|token|password|jwt)\b/],
  ['payments', /\b(price|cents|amount|total|discount|charge|refund|invoice)\w*/i],
  ['migrations', /\b(CREATE TABLE|ALTER TABLE|CHECK\s*\(|REFERENCES|PRIMARY KEY)\b/],
  ['public-api', /(\/v\d+\/|\b(app|router)\.(get|post|put|patch|delete)\b|url\.pathname)/],
]

function detectCommands(root: string): { pm: string; commands: RepoScan['commands'] } {
  const commands: RepoScan['commands'] = {}
  let pm = 'npm'
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) pm = 'bun'
  else if (existsSync(join(root, 'pnpm-lock.yaml'))) pm = 'pnpm'
  else if (existsSync(join(root, 'yarn.lock'))) pm = 'yarn'
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const s = pkg.scripts ?? {}
      if (pm === 'npm' && Object.values<string>(s).some((v) => /\bbun\b/.test(v))) pm = 'bun'
      const run = (k: string) => (pm === 'npm' ? `npm run ${k}` : `${pm} run ${k}`)
      if (s.test) commands.test = pm === 'bun' && /^bun test/.test(s.test) ? 'bun test' : run('test')
      const lint = ['lint', 'eslint', 'check:lint'].find((k) => s[k])
      if (lint) commands.lint = run(lint)
      const tc = ['typecheck', 'type-check', 'tsc', 'check:types', 'types'].find((k) => s[k])
      if (tc) commands.typecheck = run(tc)
    } catch {}
  }
  if (existsSync(join(root, 'Cargo.toml'))) {
    pm = 'cargo'
    commands.test ??= 'cargo test'; commands.lint ??= 'cargo clippy -- -D warnings'; commands.typecheck ??= 'cargo check'
  }
  if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'setup.py'))) {
    pm = pm === 'npm' ? 'python' : pm
    commands.test ??= 'pytest'; commands.lint ??= 'ruff check .'; commands.typecheck ??= 'mypy .'
  }
  if (existsSync(join(root, 'go.mod'))) {
    pm = 'go'
    commands.test ??= 'go test ./...'; commands.lint ??= 'go vet ./...'; commands.typecheck ??= 'go build ./...'
  }
  return { pm, commands }
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function git(root: string, args: string[]): string | null {
  try {
    const r = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'ignore' })
    return r.exitCode === 0 ? r.stdout.toString().trim() : null
  } catch { return null }
}

export function scanRepo(root: string): RepoScan {
  const files = listFiles(root)
  const { pm, commands } = detectCommands(root)
  const risks: RiskHit[] = []
  const riskFiles: Record<RiskKind, string[]> = { auth: [], payments: [], migrations: [], 'public-api': [] }
  const invariants: Invariant[] = []
  for (const f of files) {
    if (!CODE.test(f) || TEST_FILE.test(f)) continue
    for (const [kind, re] of RISK_PATH) if (re.test(f) && !riskFiles[kind].includes(f)) riskFiles[kind].push(f)
    let text = ''
    try { text = readFileSync(join(root, f), 'utf8') } catch { continue }
    if (text.length > 400_000) continue
    text.split('\n').forEach((line, i) => {
      const m = line.match(/(?:\/\/|#|--|\*)\s*(Invariant|Contract|INVARIANT|CONTRACT):\s*(.+)$/)
      if (m) invariants.push({ text: cap(m[2].trim()), source: `${f}:${i + 1}`, confirmed: true })
      const chk = line.match(/(\w+)\s+\w+[^,]*CHECK\s*\((.+?)\)\s*,?\s*$/i)
      if (chk && /\.sql$/.test(f)) invariants.push({ text: `${chk[1]}: CHECK (${chk[2].replace(/\)+$/, '')})`, source: `${f}:${i + 1}`, confirmed: true })
      for (const [kind, re] of RISK_LINE) {
        if (re.test(line) && riskFiles[kind].includes(f) && risks.filter((r) => r.file === f && r.kind === kind).length < 3)
          risks.push({ kind, file: f, line: i + 1, text: line.trim().slice(0, 120) })
      }
    })
  }
  for (const f of riskFiles.auth.slice(0, 1)) invariants.push({ text: `Every non-public route checks the session from ${basename(f)} before reading the body`, source: f, confirmed: false })
  if (riskFiles['public-api'].length) invariants.push({ text: 'Public routes (/v1/*) keep their request and response shapes; breaking changes need a new version', source: riskFiles['public-api'][0], confirmed: false })
  if (riskFiles.migrations.length) invariants.push({ text: 'Shipped migrations are never edited; schema changes go in a new numbered file', source: riskFiles.migrations[0], confirmed: false })
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const base = git(root, ['rev-parse', '--verify', '--quiet', 'main']) ? 'main' : git(root, ['rev-parse', '--verify', '--quiet', 'master']) ? 'master' : 'main'
  return {
    root, name: basename(root), packageManager: pm, commands, files, risks, riskFiles, invariants,
    hasClaudeMd: existsSync(join(root, 'CLAUDE.md')), branch, baseBranch: base,
  }
}
