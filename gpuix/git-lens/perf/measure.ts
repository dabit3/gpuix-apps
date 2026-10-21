// Measures repo open time on a large repo and wheel-scrolling a 5k-line native <diff>.
// Usage: bun perf/measure.ts [path-to-large-repo]   (defaults to a clone of expressjs/express)
import { launch } from '@gpuix/react/automation'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const app = join(import.meta.dir, '..', 'app.tsx')
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let big = process.argv[2] ?? join(homedir(), '.cache', 'git-lens', 'express')
if (!existsSync(big)) execFileSync('git', ['clone', '--quiet', 'https://github.com/expressjs/express.git', big])
const commitCount = Number(sh(big, 'rev-list', '--count', 'HEAD').trim())

async function run(repo: string, body: (a: Awaited<ReturnType<typeof launch>>) => Promise<void>) {
  const out = join(mkdtempSync(join(tmpdir(), 'git-lens-perf-')), 'perf.json')
  const t0 = performance.now()
  const a = await launch({ command: process.execPath, args: [app, repo], env: { GPUIX_BACKGROUND: '1', GIT_LENS_PERF_OUT: out } })
  try {
    await a.getByTestId('commit-0').waitFor()
    const firstRowMs = performance.now() - t0
    await body(a)
    await sleep(400)
    return { firstRowMs, ...JSON.parse(readFileSync(out, 'utf8')) }
  } finally {
    await a.close()
  }
}

const opens = []
for (let i = 0; i < 3; i++) opens.push(await run(big, async () => {}))

// Scratch repo whose last commit adds a 5,000-line TypeScript file.
const scratch = mkdtempSync(join(tmpdir(), 'git-lens-bigdiff-'))
sh(scratch, 'init', '-q', '-b', 'main')
sh(scratch, '-c', 'user.name=Perf', '-c', 'user.email=perf@example.com', 'commit', '-q', '--allow-empty', '-m', 'root')
writeFileSync(join(scratch, 'generated.ts'), Array.from({ length: 5000 }, (_, i) => `export function handler${i}(input: number): number { return input * ${i} + ${i % 7} }`).join('\n') + '\n')
sh(scratch, 'add', '-A')
sh(scratch, '-c', 'user.name=Perf', '-c', 'user.email=perf@example.com', 'commit', '-q', '-m', 'Add 5k-line generated module')

const scroll = await run(scratch, async (a) => {
  await a.getByTestId('file-generated.ts').waitFor()
  await a.getByTestId('file-generated.ts').click()
  await a.getByTestId('diff-view').waitFor()
  await sleep(1600) // perf mode resets the draw-time samples 1 s after the patch lands
  for (let i = 0; i < 160; i++) await a.getByTestId('diff-view').wheel(0, i < 80 ? -240 : 240)
})

const ms = (n?: number) => (n == null ? 'n/a' : `${n.toFixed(1)} ms`)
const result = {
  machine: 'macOS arm64 VM, Apple Paravirtual Metal GPU (slower than real Apple silicon)',
  largeRepo: { path: big, commits: commitCount, runs: opens.map((o) => ({ windowToFirstRowMs: Math.round(o.firstRowMs), ...o.open, rssMb: Math.round(o.rssMb) })) },
  bigDiff: { patchLines: scroll.patchLines, wheelEvents: 160, frame: scroll.frame, rssMb: Math.round(scroll.rssMb) },
}
console.log(JSON.stringify(result, null, 2))
console.log(`\nopen ${commitCount} commits: in-app ${opens.map((o) => `${o.open.totalMs} ms`).join(', ')}; launch→first row ${opens.map((o) => `${Math.round(o.firstRowMs)} ms`).join(', ')}`)
console.log(`5k-line diff wheel scroll: ${scroll.frame.samples} draws, p90 ${ms(scroll.frame.p90Ms)}, p99 ${ms(scroll.frame.p99Ms)}, max ${ms(scroll.frame.maxMs)}, rss ${Math.round(scroll.rssMb)} MB`)
writeFileSync(join(import.meta.dir, 'results.json'), JSON.stringify(result, null, 2) + '\n')
