import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Status = 'pass' | 'fail' | 'skip' | 'todo'

export interface Frame {
  file: string
  line: number
  col: number
}

export interface Failure {
  type: string
  headline: string
  message: string
  expected?: string
  received?: string
  patch?: string
  frames: Frame[]
}

export interface TestCase {
  id: string
  file: string
  suites: string[]
  name: string
  line: number
  timeMs: number
  status: Status
  failure?: Failure
}

export interface RunResult {
  startedAt: number
  durationMs: number
  tests: TestCase[]
  files: string[]
  counts: Record<Status, number>
  partial: boolean
  error?: string
}

export interface RunOptions {
  files?: string[]
  namePattern?: string
  bun?: string
}

export async function runTests(dir: string, opts: RunOptions = {}): Promise<RunResult> {
  const tmp = mkdtempSync(join(tmpdir(), 'testdeck-'))
  const out = join(tmp, 'junit.xml')
  const args = ['test', '--reporter=junit', `--reporter-outfile=${out}`]
  if (opts.namePattern) args.push('-t', opts.namePattern)
  if (opts.files?.length) args.push(...opts.files.map((f) => (f.startsWith('.') || f.startsWith('/') ? f : `./${f}`)))
  const startedAt = Date.now()
  const t0 = performance.now()
  const { code, output } = await new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn(opts.bun ?? process.execPath, args, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', GPUIX_TERMINAL: '', GPUIX_BACKGROUND: '' },
    })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    child.on('close', (c) => resolve({ code: c ?? 1, output }))
    child.on('error', (e) => resolve({ code: 1, output: String(e) }))
  })
  const durationMs = Math.round(performance.now() - t0)
  let xml = ''
  try {
    xml = readFileSync(out, 'utf8')
  } catch {}
  rmSync(tmp, { recursive: true, force: true })
  const tests = parseJunit(xml)
  const result = summarize(tests, startedAt, durationMs, Boolean(opts.files?.length || opts.namePattern))
  const unhandled = output.match(/# Unhandled error[^\n]*\n-+\n([\s\S]*?)\n-+/)
  if (unhandled) result.error = cleanOutput(unhandled[1])
  else if (code !== 0 && result.counts.fail === 0) result.error = cleanOutput(output)
  return result
}

function cleanOutput(s: string) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-30).join('\n')
}

export function summarize(tests: TestCase[], startedAt: number, durationMs: number, partial = false): RunResult {
  const counts: Record<Status, number> = { pass: 0, fail: 0, skip: 0, todo: 0 }
  const files: string[] = []
  for (const t of tests) {
    counts[t.status]++
    if (!files.includes(t.file)) files.push(t.file)
  }
  return { startedAt, durationMs, tests, files, counts, partial }
}

/** Replace the tests a partial run touched, keep everything else from the previous run. */
export function mergeRun(prev: RunResult, next: RunResult): RunResult {
  const byId = new Map(next.tests.map((t) => [t.id, t]))
  const tests = prev.tests.map((t) => byId.get(t.id) ?? t)
  for (const t of next.tests) if (!prev.tests.some((p) => p.id === t.id)) tests.push(t)
  const merged = summarize(tests, next.startedAt, next.durationMs, true)
  merged.error = next.error
  return merged
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENT[e] ?? m
  })
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = decode(m[2])
  return out
}

export function parseJunit(xml: string): TestCase[] {
  const tests: TestCase[] = []
  const stack: { name: string; file?: string }[] = []
  const re = /<(\/?)(testsuite|testcase|failure|skipped|error)\b([^>]*?)(\/?)>/g
  let current: TestCase | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const [, close, tag, rest, selfClose] = m
    if (tag === 'testsuite') {
      if (close) stack.pop()
      else if (!selfClose) stack.push({ name: attrs(rest).name ?? '', file: attrs(rest).file })
    } else if (tag === 'testcase') {
      if (close) {
        current = null
        continue
      }
      const a = attrs(rest)
      const file = a.file ?? stack[0]?.file ?? stack[0]?.name ?? ''
      const suites = stack.slice(1).map((s) => s.name)
      const tc: TestCase = {
        id: [file, ...suites, a.name].join(' › '),
        file,
        suites,
        name: a.name ?? '',
        line: Number(a.line ?? 0),
        timeMs: Math.round(Number(a.time ?? 0) * 100000) / 100,
        status: 'pass',
      }
      tests.push(tc)
      current = selfClose ? null : tc
    } else if (current && !close && (tag === 'failure' || tag === 'error')) {
      const a = attrs(rest)
      const end = xml.indexOf(`</${tag}>`, re.lastIndex)
      const body = selfClose || end < 0 ? '' : decode(xml.slice(re.lastIndex, end))
      current.status = 'fail'
      current.failure = parseFailure(a.message ?? body, body, a.type ?? 'Error')
      if (!current.failure.frames.length && current.line) current.failure.frames.push({ file: current.file, line: current.line, col: 1 })
      if (end >= 0 && !selfClose) re.lastIndex = end
    } else if (current && !close && tag === 'skipped') {
      current.status = attrs(rest).message === 'TODO' ? 'todo' : 'skip'
    }
  }
  return tests
}

export function parseFailure(message: string, body: string, type: string): Failure {
  const msg = message.replace(/\s+$/, '')
  const lines = msg.split('\n')
  const headline = lines[0] ?? type
  const frames: Frame[] = []
  for (const fm of (body || msg).matchAll(/at (?:.*?\()?([^\s()]+?):(\d+):(\d+)\)?/g)) {
    if (fm[1].includes('node_modules') || fm[1].startsWith('native')) continue
    frames.push({ file: fm[1], line: Number(fm[2]), col: Number(fm[3]) })
  }
  const f: Failure = { type, headline, message: msg, frames }
  const exp = msg.match(/^Expected(?: [\w ]+)?: (.*)$/m)
  const rec = msg.match(/^Received(?: [\w ]+)?: (.*)$/m)
  if (exp && rec) {
    f.expected = exp[1]
    f.received = rec[1]
    f.patch = makePatch([`-${exp[1]}`, `+${rec[1]}`])
    return f
  }
  const diffLines = lines.slice(1).filter((l) => l.trim() && !/^[-+] (Expected|Received)\s+[-+] \d+/.test(l))
  if (diffLines.some((l) => /^[-+] /.test(l))) {
    f.patch = makePatch(diffLines.map((l) => (l.startsWith('- ') ? `-${l.slice(2)}` : l.startsWith('+ ') ? `+${l.slice(2)}` : ` ${l.replace(/^  /, '')}`)))
  }
  return f
}

/** bun prints Expected as "-" and Received as "+", the same sides as a git patch from expected to received. */
export function makePatch(body: string[]): string {
  const oldN = body.filter((l) => !l.startsWith('+')).length
  const newN = body.filter((l) => !l.startsWith('-')).length
  return ['diff --git a/expected b/expected → received', '--- a/expected', '+++ b/expected → received', `@@ -1,${oldN} +1,${newN} @@`, ...body, ''].join('\n')
}
