import { basename } from 'node:path'
import { contentText, estimateTokens } from './estimate'
import { buildLinear, previewText, toolLabel, type LinearEvent } from './linear'
import type { Session, Usage } from './types'

type Raw = Record<string, any>

/** First line of a Codex CLI rollout (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`). */
export function isCodex(firstLine: string): boolean {
  // the first line (session_meta + base instructions) is often longer than the sniffed head
  const h = firstLine.slice(0, 400)
  return /"payload"\s*:/.test(firstLine) && /"type"\s*:\s*"(session_meta|response_item|event_msg|turn_context|world_state|token_usage_record|compacted)"/.test(h)
}

const ENV_HINT = /^<(environment_context|user_instructions|permissions|skills_instructions|collaboration_mode|apps_instructions|INSTRUCTIONS)/

function usageOf(u: Raw | undefined): Usage | undefined {
  if (!u) return undefined
  const cacheRead = Number(u.cached_input_tokens ?? 0)
  const cacheWrite = Number(u.cache_write_input_tokens ?? 0)
  // input_tokens is the whole prompt: cached reads and cache writes are inside it
  return { input: Math.max(0, Number(u.input_tokens ?? 0) - cacheRead - cacheWrite), cacheRead, cacheWrite, output: Number(u.output_tokens ?? 0) }
}

/**
 * Parse one Codex CLI rollout. Per-response usage comes from `token_usage_record` lines
 * (newer Codex) or, failing that, `event_msg` `token_count.last_token_usage`.
 */
export function parseCodex(text: string, file: string, mtime = 0): Session[] {
  const lines = text.split('\n')
  const rows: Raw[] = []
  for (const l of lines) {
    if (!l.trim()) continue
    try {
      rows.push(JSON.parse(l))
    } catch {}
  }
  const hasRecords = rows.some((r) => r.type === 'token_usage_record')
  let id = basename(file).replace(/^rollout-.*?-([0-9a-f-]{36})\.jsonl$/, '$1')
  let parent: string | undefined
  let project = 'codex'
  let title = ''
  let model = 'unknown'
  let estSystem = -1
  let lastCount = ''
  const calls = new Map<string, { name: string; key: string; label: string }>()
  const events: LinearEvent[] = []
  let pending: LinearEvent[] = []
  const flush = () => {
    events.push(...pending)
    pending = []
  }
  const input = (e: LinearEvent) => {
    flush()
    events.push(e)
  }

  for (const d of rows) {
    const p: Raw = d.payload ?? {}
    const ts = d.timestamp ? Date.parse(d.timestamp) || 0 : 0
    if (d.type === 'session_meta') {
      id = String(p.id ?? p.session_id ?? id)
      parent = p.parent_thread_id ?? p.forked_from_id ?? undefined
      if (p.cwd) project = basename(String(p.cwd))
      const bi = contentText(p.base_instructions?.text ?? p.base_instructions ?? p.instructions)
      if (bi) estSystem = estimateTokens(bi)
      continue
    }
    if (d.type === 'turn_context') {
      if (p.model) model = String(p.model)
      continue
    }
    if (d.type === 'world_state') {
      input({ kind: 'item', seg: 'context', text: JSON.stringify(p.state ?? p), label: 'world state' })
      continue
    }
    if (d.type === 'compacted') {
      flush()
      events.push({ kind: 'reset', summary: contentText(p.message ?? p.summary) })
      continue
    }
    const req = (u: Usage | undefined, rid: string) => {
      if (!u) return
      events.push({ kind: 'request', id: rid, ts, model, usage: u, sidechain: !!parent, estSystem })
      flush()
    }
    if (d.type === 'token_usage_record') {
      req(usageOf(p.usage), String(p.response_id ?? `${id}:${events.length}`))
      continue
    }
    if (d.type === 'event_msg') {
      if (p.type === 'thread_settings_applied' && p.thread_settings?.model) model = String(p.thread_settings.model)
      if (p.type === 'token_count' && !hasRecords && p.info?.last_token_usage) {
        const k = JSON.stringify(p.info.total_token_usage ?? p.info.last_token_usage)
        if (k !== lastCount) req(usageOf(p.info.last_token_usage), `${id}:${events.length}`)
        lastCount = k
      }
      continue
    }
    if (d.type !== 'response_item') continue
    if (p.type === 'message') {
      const txt = contentText(p.content)
      if (!txt) continue
      if (p.role === 'assistant') pending.push({ kind: 'item', seg: 'history', text: txt, label: 'assistant text' })
      else if (p.role === 'developer' || p.role === 'system' || ENV_HINT.test(txt.trimStart())) input({ kind: 'item', seg: 'context', text: txt, label: p.role === 'user' ? 'injected context' : `${p.role} instructions` })
      else {
        input({ kind: 'item', seg: 'history', text: txt, label: 'user prompt' })
        if (!title) title = previewText(txt, 80)
      }
    } else if (p.type === 'reasoning') {
      const txt = contentText(p.summary) || ''
      // encrypted reasoning is resent too; size it from the ciphertext (base64 ≈ 4/3 of the bytes)
      const est = txt || (p.encrypted_content ? 'x'.repeat(Math.round(String(p.encrypted_content).length * 0.75)) : '')
      if (est) pending.push({ kind: 'item', seg: 'history', text: est, label: 'reasoning' })
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call' || p.type === 'web_search_call') {
      const name = String(p.name ?? p.type.replace(/_call$/, ''))
      const args = typeof p.arguments === 'string' ? p.arguments : typeof p.input === 'string' ? p.input : JSON.stringify(p.action ?? p.arguments ?? p.input ?? {})
      const info = { name, key: `${name}:${args}`, label: toolLabel(name, codexArgs(args)) }
      if (p.call_id) calls.set(p.call_id, info)
      pending.push({ kind: 'item', seg: 'history', text: `${name} ${args}`, label: `call ${info.label}`, tool: name })
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output' || p.type === 'local_shell_call_output') {
      const out = typeof p.output === 'string' ? p.output : contentText(p.output?.content ?? p.output)
      const call = p.call_id ? calls.get(p.call_id) : undefined
      input({ kind: 'item', seg: 'toolResults', text: out, label: call?.label ?? 'tool result', tool: call?.name ?? 'tool', callKey: call?.key })
    }
  }
  flush()
  if (!title) {
    const um = rows.find((r) => r.type === 'event_msg' && r.payload?.type === 'item_completed' && r.payload?.item?.type === 'UserMessage')
    title = um ? previewText(contentText(um.payload.item.content), 80) : 'untitled session'
  }
  const s = buildLinear({ id: parent ? `${parent}/${id}` : id, file, project, title, mtime }, events)
  return s.requests.length ? [s] : []
}

/** Codex's `exec` tool wraps commands in JS (`tools.exec_command({cmd:"..."})`); pull the command out for labels. */
function codexArgs(args: string): unknown {
  const m = args.match(/cmd\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (m) {
    try {
      return { command: JSON.parse(`"${m[1]}"`) }
    } catch {}
  }
  return args
}
