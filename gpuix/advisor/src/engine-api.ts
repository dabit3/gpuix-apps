import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RepoScan } from './scan'
import { parseAgent } from './templates'
import { childEnv, type Engine } from './engine-claude'
import { newAgent, parseVerdict, type AgentRun, type LogLine, type RunState } from './run'

type Emit = (fn: (s: RunState) => void) => void
const API = 'https://api.anthropic.com/v1'

export const MODEL_IDS: Record<string, string> = {
  haiku: process.env.ADVISOR_HAIKU ?? 'claude-haiku-5-5',
  sonnet: process.env.ADVISOR_SONNET ?? 'claude-sonnet-5-5',
  opus: process.env.ADVISOR_OPUS ?? 'claude-opus-5-5',
}
export const modelId = (alias: string) => MODEL_IDS[alias] ?? (alias.startsWith('claude-') ? alias : MODEL_IDS.sonnet)

/** Splits `<<<FILE path>>> ... <<<END>>>` blocks out of a builder reply. */
export function parseFiles(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = []
  const re = /<<<FILE\s+([^>\s]+)\s*>>>\n([\s\S]*?)\n?<<<END>>>/g
  let m
  while ((m = re.exec(text))) out.push({ path: m[1].replace(/^\.\//, ''), content: m[2].replace(/\s*$/, '\n') })
  return out
}

/** Identifiers and paths mentioned in a task, used to aim the scouts. */
export function keywords(task: string): string[] {
  const words = task.match(/[A-Za-z_][\w./-]*[A-Z_./][\w./-]*|[a-z]+[A-Z]\w*/g) ?? []
  return [...new Set(words.filter((w) => w.length > 3))].slice(0, 6)
}

async function sh(cmd: string, cwd: string) {
  const p = Bun.spawn(['/bin/sh', '-c', cmd], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: childEnv() })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, out: (out + err).trim() }
}

export function startApi(scan: RepoScan, task: string, emit: Emit, key = process.env.ANTHROPIC_API_KEY ?? ''): Engine {
  const ctrl = new AbortController()
  const root = scan.root
  const read = (p: string) => { try { return readFileSync(join(root, p), 'utf8') } catch { return '' } }
  const spec = (name: string) => parseAgent(read(`.claude/agents/${name}.md`))
  const log = (agentId: string, kind: LogLine['kind'], text: string, ok?: boolean) => emit((s) => {
    const a = s.agents.find((x) => x.id === agentId)
    s.log.push({ t: Date.now(), agentId, role: a?.role ?? 'builder', kind, text: text.replace(/\s+/g, ' ').trim().slice(0, 240), ok })
  })
  const add = (a: AgentRun) => emit((s) => { s.agents.push(a) })
  const patch = (id: string, fn: (a: AgentRun) => void) => emit((s) => { const a = s.agents.find((x) => x.id === id); if (a) fn(a) })

  async function call(agent: AgentRun, system: string, user: string, maxTokens = 1800): Promise<string> {
    const body: Record<string, unknown> = { model: agent.model, max_tokens: maxTokens, system, stream: true, messages: [{ role: 'user', content: user }] }
    if (/sonnet/.test(agent.model)) body.thinking = { type: 'between_tools' }
    const res = await fetch(`${API}/messages`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok || !res.body) throw new Error(`${agent.model}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
    let text = '', buf = '', last = 0
    const dec = new TextDecoder()
    for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2)
        const data = block.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim()
        if (!data) continue
        const ev = JSON.parse(data)
        if (ev.type === 'message_start') {
          const u = ev.message.usage ?? {}
          patch(agent.id, (a) => { a.input += u.input_tokens ?? 0; a.cacheRead += u.cache_read_input_tokens ?? 0; a.cacheWrite += u.cache_creation_input_tokens ?? 0; a.model = ev.message.model ?? a.model })
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          text += ev.delta.text
          const est = Math.round(text.length / 4)
          if (est - last >= 12) { const d = est - last; last = est; patch(agent.id, (a) => { a.output += d; a.lastText = text }) }
        } else if (ev.type === 'message_delta' && ev.usage?.output_tokens != null) {
          const real = ev.usage.output_tokens
          patch(agent.id, (a) => { a.output += real - last; a.lastText = text }); last = real
        } else if (ev.type === 'error') throw new Error(ev.error?.message ?? 'stream error')
      }
    }
    return text
  }

  const files = (paths: string[]) => paths.filter((p) => existsSync(join(root, p))).map((p) => `=== ${p} ===\n${read(p)}`).join('\n\n')
  const finish = (id: string, ok = true) => patch(id, (a) => { a.status = ok ? 'done' : 'error'; a.endedAt = Date.now() })

  async function advisor(cp: 1 | 2 | 3, n: number, context: string): Promise<'approve' | 'revise' | 'block'> {
    const sp = spec('advisor')
    const titles = { 1: 'Checkpoint 1: plan review', 2: 'Checkpoint 2: root cause', 3: 'Checkpoint 3: final review' }
    const a = newAgent(`advisor-${cp}-${n}`, 'advisor', modelId(sp?.model ?? 'opus'), titles[cp], 0)
    add(a); log('builder', 'tool', `→ ${a.label}: ${titles[cp]}`)
    const text = await call(a, sp?.prompt ?? '', `${titles[cp]}.\n\n${context}\n\nReply in the exact VERDICT / ISSUES / MOST IMPORTANT FIX format. At most 4 issues, one sentence each (under 30 words), most important first.`, 2000)
    const v = parseVerdict(text) ?? { verdict: 'revise' as const, issues: ['advisor reply had no VERDICT line'], fix: '' }
    emit((s) => { s.verdicts.push({ ...v, checkpoint: cp, agentId: a.id }) })
    log(a.id, 'text', `VERDICT: ${v.verdict}${v.issues[0] ? ` · ${v.issues[0]}` : ''}`)
    finish(a.id)
    return v.verdict
  }

  async function checks(): Promise<{ ok: boolean; out: string; failed?: string }> {
    let all = ''
    for (const [name, cmd] of Object.entries(scan.commands)) {
      if (!cmd) continue
      log('builder', 'tool', `$ ${cmd}`)
      const r = await sh(cmd, root)
      log('builder', 'test', `${cmd}  ${r.code === 0 ? 'passed' : 'failed'}`, r.code === 0)
      all += `$ ${cmd}\n${r.out.slice(-1500)}\n`
      if (r.code !== 0) return { ok: false, out: all, failed: name }
    }
    return { ok: true, out: all }
  }

  function apply(text: string) {
    const changed = parseFiles(text)
    for (const f of changed) {
      if (f.path.includes('..') || f.path.startsWith('/') || f.path.startsWith('.claude/')) continue
      mkdirSync(dirname(join(root, f.path)), { recursive: true })
      writeFileSync(join(root, f.path), f.content)
      log('builder', 'tool', `${existsSync(join(root, f.path)) ? 'Write' : 'Edit'} ${f.path}`)
    }
    return changed.map((f) => f.path)
  }

  const done = (async () => {
    emit((s) => { s.status = 'running'; s.startedAt = Date.now() })
    let builderModel = 'sonnet'
    try { builderModel = JSON.parse(read('.claude/settings.json')).model ?? 'sonnet' } catch {}
    const builder = { ...newAgent('builder', 'builder', modelId(builderModel), 'main session', 0), label: 'builder', role: 'builder' as const }
    add(builder)
    log('builder', 'info', `Anthropic API fallback · roles from .claude/agents · ${builder.model}`)
    const claudeMd = read('CLAUDE.md')
    const builderSystem = `You are the builder (main session) in this repository. Follow the Workflow below exactly.\n\n${claudeMd}`
    try {
      // Scouts: the app performs their read-only tool calls (rg / Read) and hands them the output.
      const kw = keywords(task)
      const hits = kw.length ? (await sh(`rg -n --no-heading -S ${kw.map((k) => `-e '${k.replace(/'/g, '')}'`).join(' ')} . 2>/dev/null | grep -v '^./.claude' | head -60`, root)).out : ''
      const hitFiles = [...new Set(hits.split('\n').map((l) => l.split(':')[0].replace(/^\.\//, '')).filter(Boolean))]
      const src = hitFiles.filter((f) => !/test|spec/.test(f)).slice(0, 4)
      const tests = scan.files.filter((f) => /(^|\/)tests?\/|\.test\.|\.spec\./.test(f)).slice(0, 4)
      const risk = [...new Set([...scan.riskFiles.auth, ...scan.riskFiles.migrations, ...scan.riskFiles['public-api']])].slice(0, 4)
      const sp = spec('scout')
      const jobs: [string, string, string][] = [
        ['Locate the code the task touches', `rg ${kw.join(' ')}`, `${hits}\n\n${files(src)}`],
        ['Map existing tests and gaps', `ls tests; Read ${tests.join(', ')}`, files(tests)],
        ['Scan risk areas: auth, schema, public API', `Read ${risk.join(', ')}`, files(risk)],
      ]
      const scoutTexts = await Promise.all(jobs.map(async ([title, toolLine, ctx], i) => {
        const a = newAgent(`scout-${i + 1}`, 'scout', modelId(sp?.model ?? 'haiku'), title, i + 1)
        add(a); log('builder', 'tool', `→ ${a.label}: ${title}`); log(a.id, 'tool', toolLine)
        patch(a.id, (x) => { x.tools = toolLine.split(';').length })
        const t = await call(a, sp?.prompt ?? '', `Task context: ${task}\n\nYour question: ${title}. Tool output:\n\n${ctx}\n\nReply with FINDINGS only: at most 5 bullets, under 120 words.`, 900)
        log(a.id, 'text', t); finish(a.id)
        return `## ${a.label}: ${title}\n${t}`
      }))
      const findings = scoutTexts.join('\n\n')

      const planText = await call(builder, builderSystem, `Task: ${task}\n\nScout findings:\n${findings}\n\nWrite PLAN.md now (under 25 lines: problem, change, tests, invariants touched, out of scope). Reply with only the file body.`, 900)
      writeFileSync(join(root, 'PLAN.md'), planText.trim() + '\n'); log('builder', 'tool', 'Write PLAN.md')
      const touched = [...new Set([...src, ...tests])]

      let v1 = await advisor(1, 1, `PLAN.md:\n${read('PLAN.md')}\n\n${files(touched)}`)
      if (v1 !== 'approve') {
        const fb = (await new Promise<RunState>((r) => emit((s) => r(s)))).verdicts.at(-1)
        const revised = await call(builder, builderSystem, `Advisor checkpoint 1 said ${v1}:\n${fb?.issues.join('\n')}\nFix: ${fb?.fix}\n\nCurrent PLAN.md:\n${read('PLAN.md')}\n\nRewrite PLAN.md to address every issue (or note a written override). Reply with only the file body.`, 900)
        writeFileSync(join(root, 'PLAN.md'), revised.trim() + '\n'); log('builder', 'tool', 'Edit PLAN.md')
        if (v1 === 'block') v1 = await advisor(1, 2, `Revised PLAN.md:\n${read('PLAN.md')}`)
      }

      let fails = 0, lastOut = '', lastChecks = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        const ask = attempt === 0
          ? `Implement PLAN.md now.\n\nPLAN.md:\n${read('PLAN.md')}\n\n${files(touched)}\n\nReturn each changed or new file in full as:\n<<<FILE relative/path>>>\n...entire file...\n<<<END>>>\nNo prose outside the blocks.`
          : `The checks failed:\n${lastOut}\n\n${fails >= 2 ? `Advisor root-cause guidance:\n${(await new Promise<RunState>((r) => emit((s) => r(s)))).verdicts.at(-1)?.fix}\n\n` : ''}Current files:\n${files(touched)}\n\nReturn fixed files in the same <<<FILE>>> format.`
        const changed = apply(await call(builder, builderSystem, ask, 3000))
        for (const p of changed) if (!touched.includes(p)) touched.push(p)
        const r = await checks()
        lastChecks = r.out
        if (r.ok) break
        fails++; lastOut = r.out
        if (fails === 2) await advisor(2, 1, `The same check failed twice.\n${r.out}\n\n${files(touched)}`)
      }

      const diff = (await sh(`git add -N . && git diff -- . ':!PLAN.md' ':!.claude' ':!CLAUDE.md' ':!.gitignore'`, root)).out
      await advisor(3, 1, `PLAN.md:\n${read('PLAN.md')}\n\nChecks:\n${lastChecks}\n\ngit diff:\n${diff.slice(0, 12000)}`)
      mkdirSync(join(root, '.claude/state'), { recursive: true })
      writeFileSync(join(root, '.claude/state/final-review'), new Date().toISOString())
      finish('builder')
      emit((s) => { s.status = 'done'; s.endedAt = Date.now() })
    } catch (e) {
      if (ctrl.signal.aborted) return
      emit((s) => { s.status = 'error'; s.error = String((e as Error).message ?? e).slice(0, 200); s.endedAt = Date.now(); for (const a of s.agents) if (a.status === 'running') a.status = 'error' })
    }
  })()
  return { stop: () => ctrl.abort(), done }
}
