export const SEGMENTS = ['system', 'tools', 'history', 'context', 'toolResults', 'output'] as const
export type Segment = (typeof SEGMENTS)[number]
export type InputSegment = Exclude<Segment, 'output'>
export const INPUT_SEGMENTS: InputSegment[] = ['system', 'tools', 'history', 'context', 'toolResults']

export const SEGMENT_LABEL: Record<Segment, string> = {
  system: 'System prompt',
  tools: 'Tool schemas',
  history: 'History',
  context: 'Retrieved context',
  toolResults: 'Tool results',
  output: 'Output',
}

export type Usage = { input: number; cacheWrite: number; cacheRead: number; output: number }

export type Price = { input: number; output: number; cacheWrite: number; cacheRead: number }

/** One piece of conversation content that is resent on every later request of its chain. */
export type Item = {
  uuid: string
  seg: InputSegment
  estTokens: number
  label: string
  preview: string
  tool?: string
  callKey?: string
  /** index (within session.requests) of the first request that carried this item */
  firstReq: number
  /** how many requests carried it */
  carried: number
  /** $ spent sending it across all of those requests */
  carriedCost: number
  /** tokens as billed (scaled) on its first request */
  tokens: number
}

export type Request = {
  id: string
  index: number
  ts: number
  model: string
  sidechain: boolean
  usage: Usage
  /** chain of items in prompt order (excluding system and tools) */
  chain: Item[]
  /** estimated system / tools tokens before scaling */
  estSystem: number
  estTools: number
  /** scaled tokens per segment (inputs sum to the billed input) */
  seg: Record<Segment, number>
  segCost: Record<Segment, number>
  cost: number
  shapeHash?: string
  cacheBreak?: { reason: string; lostTokens: number }
  prevId?: string
  newItems: number
}

export type ToolCall = { name: string; key: string; input: string; resultTokens: number; reqIndex: number; uuid: string }

export type Session = {
  id: string
  file: string
  project: string
  title: string
  start: number
  end: number
  models: string[]
  requests: Request[]
  items: Item[]
  toolCalls: ToolCall[]
  reportedCostUSD?: number
  shapes: number
  mtime: number
}

export type Totals = {
  requests: number
  usage: Usage
  seg: Record<Segment, number>
  segCost: Record<Segment, number>
  cost: number
  cacheHit: number
  cacheBreaks: number
}
