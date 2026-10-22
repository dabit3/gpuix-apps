import { basename } from 'node:path'
import { contentText, estimateTokens } from './estimate'
import { buildLinear, previewText, toolLabel, type LinearEvent } from './linear'
import type { Session } from './types'

type Raw = Record<string, any>

export function isAtif(head: string): boolean {
  return /"schema_version"\s*:\s*"ATIF-/.test(head)
}

/**
 * Parse an ATIF trajectory (Agent Trajectory Interchange Format, used by `devin --export`
 * and Harbor agents). `prompt_tokens` includes `cached_tokens`; cache writes, when the
 * producer records them, sit in `metrics.extra.cache_creation_input_tokens`.
 */
export function parseAtif(text: string, file: string, mtime = 0): Session[] {
  let doc: Raw
  try {
    doc = JSON.parse(text)
  } catch {
    return []
  }
  if (!doc || typeof doc.schema_version !== 'string' || !doc.schema_version.startsWith('ATIF')) return []
  const out: Session[] = []
  const rootId = String(doc.session_id ?? doc.trajectory_id ?? basename(file).replace(/\.json$/, ''))
  walk(doc, rootId, false)
  return out

  function walk(t: Raw, id: string, sidechain: boolean) {
    const agent = t.agent ?? {}
    const toolsEst = agent.tool_definitions ? estimateTokens(JSON.stringify(agent.tool_definitions)) : -1
    const calls = new Map<string, { name: string; key: string; label: string }>()
    const events: LinearEvent[] = []
    let systemEst = -1
    let title = ''
    let sawAgent = false
    let cost = 0
    let hasCost = false
    for (const st of Array.isArray(t.steps) ? t.steps : []) {
      const msg = contentText(st.message)
      if (st.source === 'system') {
        if (!sawAgent && msg) systemEst = (systemEst > 0 ? systemEst : 0) + estimateTokens(msg)
        else if (msg) events.push({ kind: 'item', seg: 'context', text: msg, label: 'system message' })
      } else if (st.source === 'user') {
        if (msg) {
          events.push({ kind: 'item', seg: 'history', text: msg, label: 'user prompt' })
          if (!title) title = previewText(msg, 80)
        }
      } else if (st.source === 'agent') {
        sawAgent = true
        const m = st.metrics
        if (m && (m.prompt_tokens != null || m.completion_tokens != null)) {
          const prompt = Number(m.prompt_tokens ?? 0)
          const cacheRead = Number(m.cached_tokens ?? 0)
          const cacheWrite = Number(m.extra?.cache_creation_input_tokens ?? m.extra?.cache_creation_tokens ?? 0)
          events.push({
            kind: 'request',
            id: `${id}:${st.step_id ?? events.length}`,
            ts: st.timestamp ? Date.parse(st.timestamp) || 0 : 0,
            model: String(st.model_name ?? agent.model_name ?? 'unknown'),
            usage: { input: Math.max(0, prompt - cacheRead - cacheWrite), cacheRead, cacheWrite, output: Number(m.completion_tokens ?? 0) },
            sidechain,
            estSystem: systemEst,
            estTools: toolsEst,
          })
          if (typeof m.cost_usd === 'number') {
            cost += m.cost_usd
            hasCost = true
          }
        }
        if (st.reasoning_content) events.push({ kind: 'item', seg: 'history', text: contentText(st.reasoning_content), label: 'reasoning' })
        if (msg) events.push({ kind: 'item', seg: 'history', text: msg, label: 'assistant text' })
        for (const c of Array.isArray(st.tool_calls) ? st.tool_calls : []) {
          const args = typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {})
          const name = String(c.function_name ?? 'tool')
          const info = { name, key: `${name}:${args}`, label: toolLabel(name, c.arguments) }
          if (c.tool_call_id) calls.set(c.tool_call_id, info)
          events.push({ kind: 'item', seg: 'history', text: `${name} ${args}`, label: `call ${info.label}`, tool: name })
        }
      }
      for (const r of Array.isArray(st.observation?.results) ? st.observation.results : []) {
        const txt = contentText(r.content)
        if (!txt) continue
        const call = r.source_call_id ? calls.get(r.source_call_id) : undefined
        events.push({ kind: 'item', seg: 'toolResults', text: txt, label: call?.label ?? 'tool result', tool: call?.name ?? 'tool', callKey: call?.key })
      }
    }
    const final = t.final_metrics?.total_cost_usd
    const s = buildLinear(
      { id, file, project: (agent.extra?.cwd ? basename(String(agent.extra.cwd)) : '') || basename(file).replace(/\.json$/, '') || 'atif', title: title || 'untitled trajectory', mtime, reportedCostUSD: typeof final === 'number' ? final : hasCost ? cost : undefined },
      events,
    )
    s.agent = agent.name ? String(agent.name) : undefined
    if (s.requests.length) out.push(s)
    for (const sub of Array.isArray(t.subagent_trajectories) ? t.subagent_trajectories : []) {
      walk(sub, `${rootId}/${sub.trajectory_id ?? sub.session_id ?? out.length}`, true)
    }
  }
}
