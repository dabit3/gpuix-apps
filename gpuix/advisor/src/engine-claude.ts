import type { RepoScan } from './scan'
import { newAgent, parseVerdict, shortModel, type AgentRun, type LogLine, type RunState } from './run'

import { dirname } from 'node:path'

export function childEnv(): Record<string, string | undefined> {
  const bunDir = dirname(process.execPath)
  return { ...process.env, RUST_LOG: undefined, GPUIX_TERMINAL: undefined, PATH: `${bunDir}:${process.env.PATH ?? ''}` }
}

export interface Engine { stop(): void; done: Promise<void> }
type Emit = (fn: (s: RunState) => void) => void

export const ALLOWED = ['Agent', 'Task', 'Skill', 'Read', 'Edit', 'Write', 'Bash(bun:*)', 'Bash(npm:*)', 'Bash(pnpm:*)', 'Bash(git:*)', 'Bash(rg:*)', 'Bash(ls:*)']

export function claudeArgs(prompt: string, bin = 'claude') {
  return [bin, '-p', prompt, '--model', 'sonnet', '--effort', 'high', '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED, '--output-format', 'stream-json', '--verbose', '--max-turns', '60']
}

// Folds one Claude Code stream-json event into the run state. Exported for tests.
export function applyEvent(s: RunState, ev: any, test?: string) {
  const now = Date.now()
  const log = (agentId: string, kind: LogLine['kind'], text: string, ok?: boolean) => {
    const a = s.agents.find((x) => x.id === agentId)
    s.log.push({ t: now, agentId, role: a?.role ?? 'builder', kind, text: text.replace(/\s+/g, ' ').trim().slice(0, 240), ok })
    if (s.log.length > 400) s.log.splice(0, s.log.length - 400)
  }
  const seen = ((s as any)._seen ??= {} as Record<string, string>)
  if (ev.type === 'system' && ev.subtype === 'init' && !s.agents.some((a) => a.id === 'builder')) {
    s.agents.push({ ...newAgent('builder', 'builder', ev.model ?? 'sonnet', 'main session', 0), label: 'builder', role: 'builder' })
    log('builder', 'info', `Claude Code ${ev.claude_code_version ?? ''} · ${shortModel(ev.model ?? '')} · agents: ${(ev.agents ?? []).filter((x: string) => /scout|advisor/.test(x)).join(', ')}`)
    return
  }
  if (ev.type === 'system' && (ev.subtype === 'task_notification' || ev.subtype === 'task_updated')) {
    const id = ev.tool_use_id ?? ev.task?.tool_use_id
    const a = s.agents.find((x) => x.id === id)
    if (a && a.status === 'running' && /complet|done|finish|success/i.test(JSON.stringify(ev))) finish(s, a)
    return
  }
  if (ev.type === 'assistant') {
    const m = ev.message
    const id: string = ev.parent_tool_use_id ?? 'builder'
    const a = s.agents.find((x) => x.id === id)
    if (!a) return
    if (m.usage && seen[m.id] !== id + JSON.stringify(m.usage)) {
      const prev = (s as any)._u?.[m.id]
      const u = m.usage
      if (prev) { a.input -= prev.input_tokens ?? 0; a.output -= prev.output_tokens ?? 0; a.cacheRead -= prev.cache_read_input_tokens ?? 0; a.cacheWrite -= prev.cache_creation_input_tokens ?? 0 }
      a.input += u.input_tokens ?? 0; a.output += u.output_tokens ?? 0; a.cacheRead += u.cache_read_input_tokens ?? 0; a.cacheWrite += u.cache_creation_input_tokens ?? 0
      ;((s as any)._u ??= {})[m.id] = u
      seen[m.id] = id + JSON.stringify(u)
      if (m.model) a.model = m.model
    }
    for (const c of m.content ?? []) {
      if (c.type === 'text' && c.text.trim()) {
        a.lastText = c.text
        log(id, 'text', c.text)
        if (a.role === 'advisor') {
          const v = parseVerdict(c.text)
          if (v) {
            s.verdicts = s.verdicts.filter((x) => x.agentId !== a.id)
            s.verdicts.push({ ...v, checkpoint: a.checkpoint ?? (s.verdicts.length ? 3 : 1), agentId: a.id })
          }
        }
      } else if (c.type === 'tool_use') {
        a.tools++
        if (c.name === 'Agent' || c.name === 'Task') {
          const name = c.input?.subagent_type ?? 'general-purpose'
          const n = s.agents.filter((x) => x.name === name).length + 1
          const sub = newAgent(c.id, name, name === 'scout' ? 'haiku' : name === 'advisor' ? 'opus' : '', `${c.input?.description ?? ''}\n${c.input?.prompt ?? ''}`, n)
          s.agents.push(sub)
          log(id, 'tool', `→ ${sub.label}: ${c.input?.description ?? ''}`)
        } else if (c.name === 'Bash') {
          const cmd = String(c.input?.command ?? '')
          ;((s as any)._bash ??= {})[c.id] = cmd
          log(id, 'tool', `$ ${cmd}`)
        } else {
          const target = c.input?.file_path ?? c.input?.skill ?? c.input?.path ?? c.input?.pattern ?? ''
          log(id, 'tool', `${c.name} ${String(target).replace(s.agents.length ? /^.*?\/tiny-shop\// : /^$/, '')}`)
        }
      }
    }
    return
  }
  if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
    for (const c of ev.message.content) {
      if (c.type !== 'tool_result') continue
      const sub = s.agents.find((x) => x.id === c.tool_use_id)
      const text = Array.isArray(c.content) ? c.content.map((x: any) => x.text ?? '').join('\n') : String(c.content ?? '')
      if (sub && sub.status === 'running' && !/Async agent launched/i.test(text)) {
        if (text.trim()) sub.lastText = text
        if (sub.role === 'advisor' && !s.verdicts.some((v) => v.agentId === sub.id)) {
          const v = parseVerdict(text)
          if (v) s.verdicts.push({ ...v, checkpoint: sub.checkpoint ?? 3, agentId: sub.id })
        }
        finish(s, sub)
      }
      const cmd = (s as any)._bash?.[c.tool_use_id]
      if (cmd && test && cmd.includes(test.split(' ').slice(-1)[0]) && /\b(test|lint|typecheck)\b/.test(cmd)) {
        const ok = !c.is_error && !/\b[1-9]\d* fail\b|error:/i.test(text)
        log(ev.parent_tool_use_id ?? 'builder', 'test', `${cmd.slice(0, 60)}  ${ok ? 'passed' : 'failed'}`, ok)
      }
    }
    return
  }
  if (ev.type === 'result') {
    for (const a of s.agents) if (a.status === 'running') finish(s, a)
    s.costUsd = ev.total_cost_usd
    s.status = ev.is_error ? 'error' : 'done'
    if (ev.is_error) s.error = String(ev.result ?? ev.subtype ?? 'error').slice(0, 200)
    s.endedAt = now
  }
}

function finish(_s: RunState, a: AgentRun) { a.status = 'done'; a.endedAt = Date.now() }

export function startClaude(scan: RepoScan, prompt: string, emit: Emit, bin = 'claude'): Engine {
  const proc = Bun.spawn(claudeArgs(prompt, bin), { cwd: scan.root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: childEnv() })
  const done = (async () => {
    const dec = new TextDecoder()
    let buf = ''
    for await (const chunk of proc.stdout as any as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        if (!line.trim()) continue
        let ev: any
        try { ev = JSON.parse(line) } catch { continue }
        emit((s) => applyEvent(s, ev, scan.commands.test))
      }
    }
    const code = await proc.exited
    const err = await new Response(proc.stderr).text()
    emit((s) => {
      if (s.status === 'running') { s.status = code === 0 ? 'done' : 'error'; s.endedAt = Date.now(); if (code) s.error = err.trim().split('\n').slice(-1)[0] || `claude exited ${code}` }
      for (const a of s.agents) if (a.status === 'running') a.status = code === 0 ? 'done' : 'error'
    })
  })()
  return { stop: () => proc.kill(), done }
}

/** Plays back a recorded `claude -p --output-format stream-json` run (one event per `stepMs`). */
export function startReplay(file: string, emit: Emit, stepMs = 110): Engine {
  let stopped = false
  const done = (async () => {
    const lines = (await Bun.file(file).text()).split('\n').filter((l) => l.trim())
    for (const line of lines) {
      if (stopped) return
      let ev: any
      try { ev = JSON.parse(line) } catch { continue }
      emit((s) => applyEvent(s, ev, 'bun test'))
      if (ev.type === 'assistant' || ev.type === 'user') await Bun.sleep(stepMs)
    }
  })()
  return { stop: () => { stopped = true }, done }
}
