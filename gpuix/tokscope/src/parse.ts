import { basename, dirname } from 'node:path'
import { contentText, estimateTokens } from './estimate'
import type { InputSegment, Item, Request, Session, ToolCall, Usage } from './types'

type Node = {
  uuid: string
  parent: string | null
  items: Item[]
  sidechain: boolean
}

type Raw = Record<string, any>

const RETRIEVAL_HINT = /^<system-reminder>|^<command-|^Caveat:|CLAUDE\.md|^# (gitStatus|Environment)/

function preview(text: string, n = 160): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, n)
}

function toolLabel(name: string, input: any): string {
  if (!input || typeof input !== 'object') return name
  const v = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt
  return typeof v === 'string' ? `${name} ${preview(v, 90)}` : name
}

/** Parse one Claude Code transcript (JSONL). Unknown line types are ignored. */
export function parseTranscript(text: string, file: string, mtime = 0): Session[] {
  const nodes = new Map<string, Node>()
  const shapes = new Map<string, { system: number; tools: number }>()
  const toolNames = new Map<string, { name: string; key: string; input: string; label: string }>()
  const assistants: Array<{ raw: Raw; order: number }> = []
  const sessionsSeen = new Map<string, { title: string; summary?: string; start: number; end: number; cost?: number }>()
  let currentShape: string | undefined
  const requestShape = new Map<number, string | undefined>()
  let order = 0
  let fileSummary: string | undefined

  const lines = text.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    let d: Raw
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    order++
    const sid: string | undefined = d.sessionId
    if (d.type === 'summary' && typeof d.summary === 'string') fileSummary = d.summary
    const ts = d.timestamp ? Date.parse(d.timestamp) : NaN
    if (sid) {
      let s = sessionsSeen.get(sid)
      if (!s) sessionsSeen.set(sid, (s = { title: '', start: Infinity, end: 0 }))
      if (!Number.isNaN(ts)) {
        s.start = Math.min(s.start, ts)
        s.end = Math.max(s.end, ts)
      }
      if (d.type === 'cost-state' && typeof d.totalCostUSD === 'number') s.cost = d.totalCostUSD
      if (d.type === 'summary' && typeof d.summary === 'string') s.summary = d.summary
    }
    if (d.type === 'api-request-shape' && d.shape) {
      const sys = contentText(d.shape.system)
      const tools = JSON.stringify(d.shape.tools ?? [])
      shapes.set(d.shapeHash, { system: estimateTokens(sys), tools: estimateTokens(tools) })
      continue
    }
    if (d.type === 'api-request') {
      currentShape = d.shapeHash
      continue
    }
    if (!d.uuid || !['user', 'assistant', 'attachment', 'system'].includes(d.type)) continue

    const node: Node = { uuid: d.uuid, parent: d.parentUuid ?? null, items: [], sidechain: !!d.isSidechain }
    nodes.set(d.uuid, node)
    const add = (seg: InputSegment, txt: string, label: string, extra: Partial<Item> = {}) => {
      const est = estimateTokens(txt)
      if (!est) return
      node.items.push({
        uuid: `${d.uuid}#${node.items.length}`,
        seg,
        estTokens: est,
        label,
        preview: txt.slice(0, 4000),
        firstReq: -1,
        carried: 0,
        carriedCost: 0,
        tokens: 0,
        ...extra,
      })
    }

    if (d.type === 'attachment') {
      const txt = contentText(d.rendered)
      if (txt) add('context', txt, `${d.attachment?.type ?? 'attachment'}`)
      continue
    }
    if (d.type === 'system') {
      if (d.subtype === 'compact_boundary') node.parent = null
      const txt = contentText(d.content)
      if (txt && d.subtype !== 'compact_boundary') add('context', txt, `system ${d.subtype ?? ''}`.trim())
      continue
    }
    const msg = d.message ?? {}
    if (d.type === 'assistant') {
      requestShape.set(order, currentShape)
      assistants.push({ raw: d, order })
      for (const b of Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: contentText(msg.content) }]) {
        if (b.type === 'tool_use') {
          const input = JSON.stringify(b.input ?? {})
          const key = `${b.name}:${input}`
          toolNames.set(b.id, { name: b.name, key, input, label: toolLabel(b.name, b.input) })
          add('history', `${b.name} ${input}`, `call ${toolLabel(b.name, b.input)}`, { tool: b.name })
        } else {
          const t = contentText(b)
          add('history', t, b.type === 'thinking' ? 'thinking' : 'assistant text')
        }
      }
      continue
    }
    // user
    const content = msg.content
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: contentText(content) }]
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const t = toolNames.get(b.tool_use_id)
        const txt = contentText(b.content)
        add('toolResults', txt, t ? t.label : 'tool result', { tool: t?.name ?? 'tool', callKey: t?.key })
      } else {
        const t = contentText(b)
        const injected = d.isMeta || d.isCompactSummary || RETRIEVAL_HINT.test(t.trimStart())
        add(injected ? 'context' : 'history', t, d.isCompactSummary ? 'compaction summary' : injected ? 'injected context' : 'user prompt')
        if (!injected && sid) {
          const s = sessionsSeen.get(sid)!
          if (!s.title && t.trim()) s.title = preview(t, 80)
        }
      }
    }
  }

  // Group assistant lines into API responses by message id.
  type Resp = { id: string; first: Raw; last: Raw; order: number; uuids: Set<string> }
  const resps = new Map<string, Resp>()
  for (const { raw, order: o } of assistants) {
    const id = raw.message?.id ?? raw.requestId ?? raw.uuid
    const r = resps.get(id)
    if (r) {
      r.last = raw
      r.uuids.add(raw.uuid)
    } else resps.set(id, { id, first: raw, last: raw, order: o, uuids: new Set([raw.uuid]) })
  }

  const bySession = new Map<string, Session>()
  const sessionOf = (sid: string) => {
    let s = bySession.get(sid)
    if (!s) {
      const meta = sessionsSeen.get(sid)
      s = {
        id: sid,
        file,
        project: basename(dirname(file)).replace(/^-Users-[^-]+-/, '').replace(/^-/, '') || basename(dirname(file)),
        title: meta?.summary || fileSummary || meta?.title || 'untitled session',
        start: meta && Number.isFinite(meta.start) ? meta.start : 0,
        end: meta?.end ?? 0,
        models: [],
        requests: [],
        items: [],
        toolCalls: [],
        reportedCostUSD: meta?.cost,
        shapes: 0,
        mtime,
      }
      bySession.set(sid, s)
    }
    return s
  }

  const itemOwner = new Map<string, Session>()
  for (const r of [...resps.values()].sort((a, b) => a.order - b.order)) {
    const raw = r.first
    const u = raw.message?.usage
    if (!u) continue
    const usage: Usage = {
      input: u.input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    }
    const s = sessionOf(raw.sessionId ?? 'unknown')
    const chain: Item[] = []
    const seen = new Set<string>()
    let cur: string | null = raw.parentUuid ?? null
    const stack: Node[] = []
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const n = nodes.get(cur)
      if (!n) break
      stack.push(n)
      cur = n.parent
    }
    for (let i = stack.length - 1; i >= 0; i--) chain.push(...stack[i]!.items)
    const index = s.requests.length
    for (const it of chain) {
      if (it.firstReq < 0) {
        it.firstReq = index
        if (!itemOwner.has(it.uuid)) {
          itemOwner.set(it.uuid, s)
          s.items.push(it)
          if (it.seg === 'toolResults' && it.callKey) {
            const call = it.callKey.indexOf(':')
            s.toolCalls.push({
              name: it.tool ?? 'tool',
              key: it.callKey,
              input: it.callKey.slice(call + 1),
              resultTokens: it.estTokens,
              reqIndex: index,
              uuid: it.uuid,
            })
          }
        }
      }
    }
    const model: string = raw.message?.model ?? 'unknown'
    if (!s.models.includes(model) && model !== '<synthetic>') s.models.push(model)
    const shapeHash = requestShape.get(r.order)
    const shape = shapeHash ? shapes.get(shapeHash) : undefined
    s.requests.push({
      id: r.id,
      index,
      ts: raw.timestamp ? Date.parse(raw.timestamp) : 0,
      model,
      sidechain: !!raw.isSidechain,
      usage,
      chain,
      estSystem: shape?.system ?? -1,
      estTools: shape?.tools ?? -1,
      seg: { system: 0, tools: 0, history: 0, context: 0, toolResults: 0, output: 0 },
      segCost: { system: 0, tools: 0, history: 0, context: 0, toolResults: 0, output: 0 },
      cost: 0,
      shapeHash,
      newItems: chain.filter((c) => c.firstReq === index).length,
    })
    // later lines of the same response add output blocks to the chain of the next request via parentUuid
  }
  for (const s of bySession.values()) s.shapes = new Set(s.requests.map((r) => r.shapeHash).filter(Boolean)).size
  return [...bySession.values()].filter((s) => s.requests.length > 0)
}
