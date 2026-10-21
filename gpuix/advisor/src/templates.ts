import type { RepoScan } from './scan'

export interface PlannedFile { path: string; content: string; role: 'scout' | 'advisor' | 'builder' | 'command' | 'hook'; mode?: number; merge?: 'claude-md' | 'settings' }

export const MODELS = { builder: 'sonnet', scout: 'haiku', advisor: 'opus' } as const
export const START = '<!-- advisor:workflow:start -->'
export const END = '<!-- advisor:workflow:end -->'

const cmd = (s: RepoScan, k: keyof RepoScan['commands']) => s.commands[k] ?? `(no ${k} command found: confirm)`

export function scoutMd(): string {
  return `---
name: scout
description: Cheap, parallel, read-only exploration. Use for file discovery, grep scans, dependency or API lookups and summarising large files whenever a question would otherwise read more than ~5 files. Never edits.
model: ${MODELS.scout}
tools: Read, Grep, Glob, Bash(rg:*), Bash(ls:*), Bash(git log:*), Bash(git show:*), Bash(git grep:*), Bash(wc:*)
---
You are a scout: a fast, read-only explorer working for the builder.

Rules
- You never create, edit, move or delete files, and you never run commands that change state. If a task needs an edit, say so and stop.
- Answer only the question you were given. Prefer rg and Read over reading whole directories.
- Return compact, structured findings and stay under ~300 words unless the builder asks for more.

Output format
FINDINGS
- path/to/file.ts:LINE  one-line summary
- ...
OPEN QUESTIONS (optional, max 3)
`
}

export function advisorMd(s: RepoScan): string {
  return `---
name: advisor
description: Senior read-only reviewer. Invoke only at the three checkpoints: before a plan locks (/plan-review), when the same test fails twice (/root-cause), and before declaring done (/final-review).
model: ${MODELS.advisor}
tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*), Bash(rg:*), Bash(ls:*)
---
You are the advisor: a read-only senior reviewer. You never edit files. You are called at exactly one of three checkpoints; the caller names it.

Checkpoint 1: PLAN REVIEW (before the plan locks)
Read PLAN.md and the files it names. Check:
- [ ] Auth invariants: every protected path still verifies the session and role (see the invariants in CLAUDE.md)
- [ ] Data and schema contracts: types, DB constraints and serialised shapes stay compatible
- [ ] Migrations: shipped migrations untouched; new ones are additive and reversible
- [ ] Public API compatibility: request/response shapes and status codes unchanged unless versioned
- [ ] Security boundaries: input validation at the edge, no secrets in code or logs
- [ ] The plan names the tests that prove it

Checkpoint 2: ROOT CAUSE (the same test failed twice)
Read the failing test, the code under test and both failure outputs. Decide whether the last two attempts fixed the root cause or patched symptoms (special cases, loosened assertions, retries, sleeps). Propose the root-cause fix in one paragraph with file:line.

Checkpoint 3: FINAL REVIEW (before declaring done)
Run \`git diff ${s.baseBranch}\` (and \`git diff ${s.baseBranch}...HEAD\` once committed). Check:
- [ ] Hidden regressions in callers of changed functions
- [ ] Missing or weakened tests; every behaviour change has a test
- [ ] Broken invariants from CLAUDE.md
- [ ] Rule violations from CLAUDE.md (workflow, lint rules, no edits to shipped migrations)
- [ ] ${cmd(s, 'test')}, ${cmd(s, 'lint')} and ${cmd(s, 'typecheck')} were run and passed

Output format (always, and nothing else)
VERDICT: approve | revise | block
ISSUES:
1. path/file.ts:LINE  concrete issue (max 5, write "none" if none)
MOST IMPORTANT FIX: one sentence
`
}

export function workflowSection(s: RepoScan): string {
  const inv = s.invariants.length
    ? s.invariants.map((i) => `- ${i.text} (${i.source})${i.confirmed ? '' : '  **[uncertain: please confirm]**'}`).join('\n')
    : '- (none found in code: please add your auth rules and schema contracts here)'
  const risky = (Object.entries(s.riskFiles) as [string, string[]][])
    .filter(([, f]) => f.length)
    .map(([k, f]) => `- ${k}: ${f.slice(0, 6).map((x) => '`' + x + '`').join(', ')}`)
    .join('\n')
  return `${START}
## Workflow

Three tiers: the **builder** (this session, Sonnet at high effort) writes diffs, runs tests and owns the plan. **Scouts** (\`scout\`, Haiku) do cheap parallel read-only exploration. The **advisor** (\`advisor\`, Opus) reviews at three checkpoints and never edits.

1. Use scouts in parallel for any exploration that would otherwise read more than ~5 files.
2. Write the plan into PLAN.md, then call the advisor (checkpoint 1, \`/plan-review\`) before editing code.
3. Track test failures. On the second failure of the same test, call the advisor (checkpoint 2, \`/root-cause\`) before trying again.
4. Before finishing, run tests, lint and type-check, then call the advisor (checkpoint 3, \`/final-review\`) on \`git diff ${s.baseBranch}...HEAD\` (or \`git diff ${s.baseBranch}\` before committing).
5. An advisor **block** verdict must be resolved, or explicitly overridden with a written reason in PLAN.md.

Commands
- test: \`${cmd(s, 'test')}\`
- lint: \`${cmd(s, 'lint')}\`
- type-check: \`${cmd(s, 'typecheck')}\`

Riskiest areas
${risky || '- (none detected)'}

Invariants the advisor checks
${inv}
${END}
`
}

export function claudeMd(s: RepoScan, existing: string | null): string {
  const section = workflowSection(s)
  if (!existing) return `# ${s.name}\n\nGuidance for Claude Code in this repository.\n\n${section}`
  const a = existing.indexOf(START), b = existing.indexOf(END)
  if (a >= 0 && b > a) return existing.slice(0, a) + section.trimEnd() + existing.slice(b + END.length)
  return existing.trimEnd() + '\n\n' + section
}

export function commandMd(kind: 'plan-review' | 'root-cause' | 'final-review', s: RepoScan): string {
  if (kind === 'plan-review') return `---
description: Advisor checkpoint 1. Review PLAN.md before any code is edited.
allowed-tools: Read, Task
---
Use the advisor subagent for CHECKPOINT 1: PLAN REVIEW.

Give it PLAN.md (read it first), the list of files the plan touches, and the invariants section of CLAUDE.md. $ARGUMENTS

Do not edit code until the verdict is approve, or a block is overridden in PLAN.md with a written reason.
`
  if (kind === 'root-cause') return `---
description: Advisor checkpoint 2. The same test failed twice; find the root cause before trying again.
allowed-tools: Read, Task, Bash(${(s.commands.test ?? 'bun test').split(' ')[0]}:*)
---
Use the advisor subagent for CHECKPOINT 2: ROOT CAUSE.

Failing test: $ARGUMENTS

Pass it the test name, the last two failure outputs, what each attempt changed, and the code under test. Apply its proposed root-cause fix, not another symptom patch.
`
  return `---
description: Advisor checkpoint 3. Review the full diff before declaring done.
allowed-tools: Read, Task, Bash(git diff:*), Bash(mkdir -p .claude/state), Bash(touch .claude/state/final-review)
---
!\`mkdir -p .claude/state && touch .claude/state/final-review\`

First run \`${cmd(s, 'test')}\`, \`${cmd(s, 'lint')}\` and \`${cmd(s, 'typecheck')}\` and note the results.

Then use the advisor subagent for CHECKPOINT 3: FINAL REVIEW on \`git diff ${s.baseBranch}...HEAD\` (plus uncommitted changes from \`git diff ${s.baseBranch}\`). Include the check results. $ARGUMENTS

Report its VERDICT. A block must be fixed or overridden with a written reason.
`
}

export const GUARD_SH = `#!/bin/sh
# advisor guard: remind the session to run /final-review if files changed since the last one.
#   PostToolUse (Edit|Write)  -> "edited":   stamp the edit time (PLAN.md edits don't count)
#   PostToolUse (Agent|Task)  -> "reviewed": stamp when the advisor ran checkpoint 3
#   Stop                      -> "stop":     block once with a reminder when the review is stale
dir="\${CLAUDE_PROJECT_DIR:-.}/.claude/state"
mkdir -p "$dir"
input=$(cat)
case "$1" in
  edited)
    case "$input" in *'PLAN.md"'*) exit 0 ;; esac
    touch "$dir/last-edit" ;;
  reviewed)
    case "$input" in *'"subagent_type":"advisor"'*|*'"subagent_type": "advisor"'*) ;; *) exit 0 ;; esac
    case "$input" in *[Cc]heckpoint\\ 3*|*final-review*|*[Ff]inal\\ review*) touch "$dir/final-review" ;; esac ;;
  stop)
    case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac
    [ -f "$dir/last-edit" ] || exit 0
    if [ ! -f "$dir/final-review" ] || [ "$dir/last-edit" -nt "$dir/final-review" ]; then
      echo "Files changed since the last advisor review. Run /final-review (advisor checkpoint 3) before finishing." >&2
      exit 2
    fi ;;
esac
exit 0
`

export function settingsJson(existing: string | null): string {
  type Hook = { matcher?: string; hooks: { type: string; command: string }[] }
  let base: { hooks?: Record<string, Hook[]>; [k: string]: unknown } = {}
  try { if (existing) base = JSON.parse(existing) } catch {}
  const guard = (arg: string) => ({ type: 'command', command: `"$CLAUDE_PROJECT_DIR"/.claude/hooks/advisor-guard.sh ${arg}` })
  const hooks: Record<string, Hook[]> = { ...(base.hooks ?? {}) }
  const keep = (list: Hook[] | undefined) => (list ?? []).filter((h) => !JSON.stringify(h).includes('advisor-guard.sh'))
  hooks.PostToolUse = [...keep(hooks.PostToolUse), { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [guard('edited')] }]
  hooks.PostToolUse.push({ matcher: 'Agent|Task', hooks: [guard('reviewed')] })
  hooks.Stop = [...keep(hooks.Stop), { hooks: [guard('stop')] }]
  return JSON.stringify({ ...base, model: MODELS.builder, effortLevel: 'high', hooks }, null, 2) + '\n'
}

export function planFiles(s: RepoScan, read: (p: string) => string | null): PlannedFile[] {
  return [
    { path: '.claude/agents/scout.md', content: scoutMd(), role: 'scout' },
    { path: '.claude/agents/advisor.md', content: advisorMd(s), role: 'advisor' },
    { path: 'CLAUDE.md', content: claudeMd(s, read('CLAUDE.md')), role: 'builder', merge: 'claude-md' },
    { path: '.claude/commands/plan-review.md', content: commandMd('plan-review', s), role: 'command' },
    { path: '.claude/commands/root-cause.md', content: commandMd('root-cause', s), role: 'command' },
    { path: '.claude/commands/final-review.md', content: commandMd('final-review', s), role: 'command' },
    { path: '.claude/settings.json', content: settingsJson(read('.claude/settings.json')), role: 'hook', merge: 'settings' },
    { path: '.claude/hooks/advisor-guard.sh', content: GUARD_SH, role: 'hook', mode: 0o755 },
  ]
}

export interface AgentSpec { name: string; model: string; tools: string[]; description: string; prompt: string }

export function parseAgent(md: string): AgentSpec | null {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const fm: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  const tools = (fm.tools ?? '').match(/[A-Za-z]+(\([^)]*\))?/g) ?? []
  return { name: fm.name ?? '', model: fm.model ?? 'inherit', tools, description: fm.description ?? '', prompt: m[2].trim() }
}

export const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
export function writeCapable(tools: string[]): string[] {
  // Unscoped Bash can run anything; Bash(rg:*)-style patterns are read-only allowlists.
  return tools.filter((t) => WRITE_TOOLS.includes(t) || t === 'Bash')
}
