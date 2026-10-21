import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanRepo } from '../src/scan'
import { claudeMd, GUARD_SH, parseAgent, settingsJson, writeCapable, START, END } from '../src/templates'
import { plan, writeOne, ensureGitignore } from '../src/writer'
import { emptyRun, parseVerdict, shortModel, tierTotals } from '../src/run'
import { applyEvent } from '../src/engine-claude'
import { keywords, parseFiles } from '../src/engine-api'
import { pickTask } from '../src/store'
import { cleanup, fixture, RUN } from './helpers'

afterAll(cleanup)

describe('scan', () => {
  it('finds commands, risk areas and invariants, and ignores tests', () => {
    const s = scanRepo(fixture())
    expect(s.commands).toEqual({ test: 'bun test', lint: 'bun run lint', typecheck: 'bun run typecheck' })
    expect(s.riskFiles.auth).toEqual(['src/auth.ts'])
    expect(s.riskFiles.migrations).toEqual(['src/db/migrations/001_init.sql'])
    expect(s.riskFiles['public-api']).toEqual(['src/api/routes.ts'])
    expect(Object.values(s.riskFiles).flat().some((f) => f.startsWith('tests/'))).toBe(false)
    expect(s.invariants.filter((i) => i.confirmed).map((i) => i.source)).toContain('src/auth.ts:12')
    expect(s.invariants.some((i) => !i.confirmed)).toBe(true)
    expect(s.baseBranch).toBe('main')
    expect(pickTask(s)).toContain('src/cart.ts:8 TODO')
  })
})

describe('setup files', () => {
  it('writes haiku read-only scouts and an opus read-only advisor', () => {
    const root = fixture()
    const s = scanRepo(root)
    const files = plan(s)
    expect(files.map((f) => f.path)).toEqual([
      '.claude/agents/scout.md', '.claude/agents/advisor.md', 'CLAUDE.md',
      '.claude/commands/plan-review.md', '.claude/commands/root-cause.md', '.claude/commands/final-review.md',
      '.claude/settings.json', '.claude/hooks/advisor-guard.sh',
    ])
    expect(files.every((f) => f.status === 'new')).toBe(true)
    for (const f of files) writeOne(root, f)
    ensureGitignore(root)
    const scout = parseAgent(readFileSync(join(root, '.claude/agents/scout.md'), 'utf8'))!
    const advisor = parseAgent(readFileSync(join(root, '.claude/agents/advisor.md'), 'utf8'))!
    expect(scout.model).toBe('haiku')
    expect(advisor.model).toBe('opus')
    expect(writeCapable(scout.tools)).toEqual([])
    expect(writeCapable(advisor.tools)).toEqual([])
    expect(writeCapable(['Read', 'Bash'])).toEqual(['Bash'])
    expect(advisor.prompt).toContain('VERDICT: approve | revise | block')
    const md = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    for (const needle of ['PLAN.md', '/plan-review', '/root-cause', '/final-review', 'git diff main...HEAD', 'bun run lint', 'src/auth.ts:12', 'confirm']) expect(md).toContain(needle)
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.claude/state/')
    expect(plan(scanRepo(root)).every((f) => f.status === 'same')).toBe(true)
  })

  it('replaces only its own CLAUDE.md section and keeps other settings', () => {
    const s = scanRepo(fixture())
    const once = claudeMd(s, '# Project\n\nKeep me.\n')
    const twice = claudeMd(s, once)
    expect(twice).toBe(once)
    expect(once.startsWith('# Project\n\nKeep me.')).toBe(true)
    expect(once.split(START).length).toBe(2)
    expect(once).toContain(END)
    const settings = JSON.parse(settingsJson(settingsJson(JSON.stringify({ permissions: { allow: ['Bash(bun:*)'] } }))))
    expect(settings.permissions.allow).toEqual(['Bash(bun:*)'])
    expect(settings.model).toBe('sonnet')
    expect(settings.hooks.Stop).toHaveLength(1)
    expect(settings.hooks.PostToolUse).toHaveLength(2)
  })

  it('guard hook blocks Stop after an edit until checkpoint 3 runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'))
    mkdirSync(join(dir, '.claude/hooks'), { recursive: true })
    writeFileSync(join(dir, '.claude/hooks/g.sh'), GUARD_SH)
    const run = (arg: string, input: string) => Bun.spawnSync(['sh', '.claude/hooks/g.sh', arg], { cwd: dir, stdin: new TextEncoder().encode(input), env: { CLAUDE_PROJECT_DIR: dir } }).exitCode
    expect(run('stop', '{}')).toBe(0)
    expect(run('edited', '{"tool_input":{"file_path":"/x/PLAN.md"}}')).toBe(0)
    expect(run('stop', '{}')).toBe(0)
    run('edited', '{"tool_input":{"file_path":"/x/src/cart.ts"}}')
    expect(run('stop', '{}')).toBe(2)
    expect(run('stop', '{"stop_hook_active":true}')).toBe(0)
    Bun.sleepSync(1100)
    run('reviewed', '{"tool_input":{"subagent_type":"advisor","prompt":"Checkpoint 1: plan"}}')
    expect(run('stop', '{}')).toBe(2)
    run('reviewed', '{"tool_input":{"subagent_type":"advisor","prompt":"Checkpoint 3: final review"}}')
    expect(run('stop', '{}')).toBe(0)
  })
})

describe('run parsing', () => {
  it('parses the advisor output format', () => {
    const v = parseVerdict('VERDICT: block\nISSUES:\n1. src/a.ts:3  token never expires\n2. none-ish but real\nMOST IMPORTANT FIX: check expiry first.\n')
    expect(v).toEqual({ verdict: 'block', issues: ['src/a.ts:3  token never expires', 'none-ish but real'], fix: 'check expiry first.' })
    expect(parseVerdict('VERDICT: approve\nISSUES:\n1. none\nMOST IMPORTANT FIX: ship it')!.issues).toEqual([])
    expect(parseVerdict('no verdict here')).toBeNull()
    expect(shortModel('claude-opus-5-5')).toBe('opus 5.5')
  })

  it('folds a real Claude Code stream-json dry run into agents, tokens and verdicts', async () => {
    const s = emptyRun('claude'); s.status = 'running'
    for (const line of (await Bun.file(RUN).text()).split('\n')) if (line.trim()) applyEvent(s, JSON.parse(line), 'bun test')
    expect(s.status as string).toBe('done')
    const labels = s.agents.map((a) => a.label)
    expect(labels[0]).toBe('builder')
    expect(labels).toContain('scout 1')
    expect(labels).toContain('advisor · CP1')
    expect(labels).toContain('advisor · CP3')
    expect(s.agents.find((a) => a.label === 'scout 1')!.model).toContain('haiku')
    expect(s.agents.find((a) => a.label === 'advisor · CP1')!.model).toContain('opus')
    const cps = new Set(s.verdicts.map((v) => v.checkpoint))
    expect(cps.has(1) && cps.has(3)).toBe(true)
    const t = tierTotals(s)
    expect(t.scout.tokens).toBeGreaterThan(0)
    expect(t.advisor.tokens).toBeGreaterThan(0)
    // The scout only used read tools.
    const scoutTools = s.log.filter((l) => l.role === 'scout' && l.kind === 'tool').map((l) => l.text.split(' ')[0])
    expect(scoutTools.every((t) => ['Read', '$', 'Grep', 'Glob'].includes(t))).toBe(true)
  })

  it('reads builder file blocks and task keywords', () => {
    expect(parseFiles('x\n<<<FILE src/a.ts>>>\nconst a = 1\n<<<END>>>\n<<<FILE ./t/b.ts>>>\nb\n<<<END>>>')).toEqual([
      { path: 'src/a.ts', content: 'const a = 1\n' }, { path: 't/b.ts', content: 'b\n' },
    ])
    expect(keywords('applyDiscount in src/cart.ts accepts bad input')).toEqual(['applyDiscount', 'src/cart.ts'])
  })
})
