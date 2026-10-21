export type Role = 'builder' | 'scout' | 'advisor' | 'other'
export type VerdictKind = 'approve' | 'revise' | 'block'
export interface Verdict { checkpoint: 1 | 2 | 3; verdict: VerdictKind; issues: string[]; fix: string; agentId: string }
export interface AgentRun {
  id: string; role: Role; name: string; model: string; label: string; task: string
  status: 'running' | 'done' | 'error'; startedAt: number; endedAt?: number
  input: number; output: number; cacheRead: number; cacheWrite: number; tools: number
  lastText: string; checkpoint?: 1 | 2 | 3
}
export interface LogLine { t: number; agentId: string; role: Role; kind: 'tool' | 'text' | 'info' | 'test' | 'error'; text: string; ok?: boolean }
export interface RunState {
  status: 'idle' | 'running' | 'done' | 'error'; engine: 'claude' | 'api'; startedAt: number; endedAt?: number
  agents: AgentRun[]; log: LogLine[]; verdicts: Verdict[]; costUsd?: number; error?: string; branch?: string
}

export const emptyRun = (engine: RunState['engine']): RunState => ({ status: 'idle', engine, startedAt: 0, agents: [], log: [], verdicts: [] })

export function roleOf(name: string, model = ''): Role {
  if (/advisor/i.test(name)) return 'advisor'
  if (/scout/i.test(name)) return 'scout'
  if (/builder|main/i.test(name)) return 'builder'
  if (/haiku/.test(model)) return 'scout'
  if (/opus/.test(model)) return 'advisor'
  return 'other'
}

export function shortModel(model: string): string {
  const m = model.match(/(opus|sonnet|haiku|fable)[-_ ]?([\d-]*)/i)
  if (!m) return model || 'inherit'
  const v = m[2].replace(/-\d{8}$/, '').replace(/-/g, '.').replace(/^\.|\.$/g, '')
  return v ? `${m[1].toLowerCase()} ${v}` : m[1].toLowerCase()
}

export function checkpointOf(text: string): 1 | 2 | 3 | undefined {
  const m = text.match(/checkpoint\s*#?\s*([123])/i)
  if (m) return Number(m[1]) as 1 | 2 | 3
  if (/plan[- ]review/i.test(text)) return 1
  if (/root[- ]cause/i.test(text)) return 2
  if (/final[- ]review/i.test(text)) return 3
  return undefined
}

export function parseVerdict(text: string): Omit<Verdict, 'checkpoint' | 'agentId'> | null {
  const v = text.match(/VERDICT\s*[:\-]?\s*\**\s*(approve|revise|block)/i)
  if (!v) return null
  const issues: string[] = []
  const after = text.slice(text.search(/ISSUES/i) >= 0 ? text.search(/ISSUES/i) : text.length)
  for (const line of after.split('\n').slice(1)) {
    if (/MOST IMPORTANT FIX/i.test(line)) break
    const m = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.+)/)
    if (m && !/^none\.?$/i.test(m[1].trim())) issues.push(m[1].trim().replace(/\*\*/g, ''))
    if (issues.length >= 5) break
  }
  const fix = (text.match(/MOST IMPORTANT FIX\s*[:\-]?\s*\**\s*([\s\S]+?)(\n\s*\n|$)/i)?.[1] ?? '').replace(/\*\*/g, '').trim()
  return { verdict: v[1].toLowerCase() as VerdictKind, issues, fix }
}

export function newAgent(id: string, name: string, model: string, task: string, n: number): AgentRun {
  const role = roleOf(name, model)
  const checkpoint = role === 'advisor' ? checkpointOf(task) : undefined
  const label = role === 'advisor' ? `advisor${checkpoint ? ` · CP${checkpoint}` : ''}` : role === 'scout' ? `scout ${n}` : name
  return { id, role, name, model, label, task, status: 'running', startedAt: Date.now(), input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tools: 0, lastText: '', checkpoint }
}

export const tokensOf = (a: AgentRun) => a.input + a.output + a.cacheRead + a.cacheWrite

export function tierTotals(run: RunState) {
  const t: Record<'builder' | 'scout' | 'advisor', { tokens: number; output: number; calls: number }> = {
    builder: { tokens: 0, output: 0, calls: 0 }, scout: { tokens: 0, output: 0, calls: 0 }, advisor: { tokens: 0, output: 0, calls: 0 },
  }
  for (const a of run.agents) {
    const k = a.role === 'other' ? 'builder' : a.role
    t[k].tokens += tokensOf(a); t[k].output += a.output; t[k].calls += 1
  }
  return t
}
