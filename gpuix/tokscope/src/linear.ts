import { estimateTokens } from './estimate'
import type { InputSegment, Item, Session, Usage } from './types'

/** One event in a linear transcript: content that joins the prompt, or a billed model call. */
export type LinearEvent =
  | { kind: 'item'; seg: InputSegment; text: string; label: string; tool?: string; callKey?: string }
  | { kind: 'request'; id: string; ts: number; model: string; usage: Usage; sidechain?: boolean; estSystem?: number; estTools?: number; shapeHash?: string }
  /** context was compacted: later requests no longer carry earlier items */
  | { kind: 'reset'; summary?: string }

/**
 * Build a Session from a harness that keeps one linear conversation (Codex, ATIF exports):
 * every request carries everything since the last compaction.
 */
export function buildLinear(meta: Pick<Session, 'id' | 'file' | 'project' | 'title' | 'mtime'> & { reportedCostUSD?: number }, events: LinearEvent[]): Session {
  const s: Session = { ...meta, start: 0, end: 0, models: [], requests: [], items: [], toolCalls: [], shapes: 0 }
  let live: Item[] = []
  let n = 0
  for (const e of events) {
    if (e.kind === 'reset') {
      live = []
      if (e.summary) push({ kind: 'item', seg: 'context', text: e.summary, label: 'compaction summary' })
      continue
    }
    if (e.kind === 'item') {
      push(e)
      continue
    }
    const index = s.requests.length
    for (const it of live) {
      if (it.firstReq >= 0) continue
      it.firstReq = index
      s.items.push(it)
      if (it.seg === 'toolResults' && it.callKey) {
        const c = it.callKey.indexOf(':')
        s.toolCalls.push({ name: it.tool ?? 'tool', key: it.callKey, input: it.callKey.slice(c + 1), resultTokens: it.estTokens, reqIndex: index, uuid: it.uuid })
      }
    }
    if (!s.models.includes(e.model)) s.models.push(e.model)
    if (e.ts) {
      s.start = s.start ? Math.min(s.start, e.ts) : e.ts
      s.end = Math.max(s.end, e.ts)
    }
    s.requests.push({
      id: e.id,
      index,
      ts: e.ts,
      model: e.model,
      sidechain: !!e.sidechain,
      usage: e.usage,
      chain: [...live],
      estSystem: e.estSystem ?? -1,
      estTools: e.estTools ?? -1,
      seg: { system: 0, tools: 0, history: 0, context: 0, toolResults: 0, output: 0 },
      segCost: { system: 0, tools: 0, history: 0, context: 0, toolResults: 0, output: 0 },
      cost: 0,
      shapeHash: e.shapeHash,
      newItems: live.filter((it) => it.firstReq === index).length,
    })
  }
  s.shapes = new Set(s.requests.map((r) => r.shapeHash).filter(Boolean)).size
  return s

  function push(e: Extract<LinearEvent, { kind: 'item' }>) {
    const est = estimateTokens(e.text)
    if (!est) return
    live.push({
      uuid: `${meta.id}#${n++}`,
      seg: e.seg,
      estTokens: est,
      label: e.label,
      preview: e.text.slice(0, 4000),
      tool: e.tool,
      callKey: e.callKey,
      firstReq: -1,
      carried: 0,
      carriedCost: 0,
      tokens: 0,
    })
  }
}

export function previewText(text: string, n = 160): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, n)
}

/** "Read src/app.ts" style label from a tool name and its arguments. */
export function toolLabel(name: string, input: unknown): string {
  let v: any = input
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return `${name} ${previewText(v, 90)}`
    }
  }
  if (!v || typeof v !== 'object') return name
  const cmd = Array.isArray(v.command) ? v.command.join(' ') : v.command ?? v.cmd
  const x = v.file_path ?? v.path ?? cmd ?? v.pattern ?? v.url ?? v.query ?? v.description ?? v.prompt
  return typeof x === 'string' ? `${name} ${previewText(x, 90)}` : name
}
