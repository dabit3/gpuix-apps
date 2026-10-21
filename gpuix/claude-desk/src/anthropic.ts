export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface StreamRequest {
  model: string
  system?: string
  messages: ChatMessage[]
  maxTokens?: number
  /** Extended thinking. Mapped per model family by `thinkingParam`. */
  thinking?: boolean
  signal?: AbortSignal
}

export interface StreamUsage {
  inputTokens: number
  outputTokens: number
  stopReason: string | null
}

export interface StreamCallbacks {
  onText: (delta: string) => void
  onThinking?: (delta: string) => void
  onUsage?: (usage: Partial<StreamUsage>) => void
}

export type Streamer = (request: StreamRequest, callbacks: StreamCallbacks) => Promise<StreamUsage>
export type Titler = (firstMessage: string, reply: string) => Promise<string | null>

export type ThinkingMode = 'toggle' | 'always' | 'budget' | 'none'

/**
 * Sonnet 5.5 thinks by default and turns it off with `between_tools`; Opus 5.5
 * always thinks; Haiku 5.5 takes no thinking config; 4.x uses a token budget.
 */
export function thinkingMode(model: string): ThinkingMode {
  if (/^claude-sonnet-5/.test(model)) return 'toggle'
  if (/^claude-opus-5/.test(model)) return 'always'
  if (/^claude-(sonnet|opus)-4/.test(model)) return 'budget'
  return 'none'
}

export function thinkingParam(model: string, on: boolean): object | undefined {
  switch (thinkingMode(model)) {
    case 'toggle':
      return on ? { type: 'adaptive', display: 'summarized' } : { type: 'between_tools' }
    case 'always':
      return { type: 'adaptive', display: 'summarized' }
    case 'budget':
      return on ? { type: 'enabled', budget_tokens: 4096 } : undefined
    default:
      return undefined
  }
}

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

function apiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in the environment.')
  return key
}

async function errorFrom(res: Response): Promise<Error> {
  const body = await res.text()
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    if (parsed.error?.message) return new Error(`${res.status}: ${parsed.error.message}`)
  } catch {}
  return new Error(`${res.status}: ${body.slice(0, 200)}`)
}

/** Messages API with `stream: true`, parsed from raw server-sent events. */
export const anthropicStreamer: Streamer = async (request, callbacks) => {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey(),
      'anthropic-version': API_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens ?? 16000,
      system: request.system?.trim() ? request.system : undefined,
      thinking: thinkingParam(request.model, request.thinking ?? false),
      messages: request.messages,
      stream: true,
    }),
    signal: request.signal,
  })
  if (!res.ok || !res.body) throw await errorFrom(res)

  const usage: StreamUsage = { inputTokens: 0, outputTokens: 0, stopReason: null }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handle = (data: string) => {
    const event = JSON.parse(data) as any
    switch (event.type) {
      case 'message_start': {
        const u = event.message?.usage ?? {}
        usage.inputTokens =
          (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        usage.outputTokens = u.output_tokens ?? 0
        callbacks.onUsage?.({ inputTokens: usage.inputTokens })
        break
      }
      case 'content_block_delta':
        if (event.delta?.type === 'text_delta' && event.delta.text) callbacks.onText(event.delta.text)
        else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) callbacks.onThinking?.(event.delta.thinking)
        break
      case 'message_delta':
        if (event.usage?.output_tokens != null) usage.outputTokens = event.usage.output_tokens
        if (event.delta?.stop_reason) usage.stopReason = event.delta.stop_reason
        callbacks.onUsage?.({ outputTokens: usage.outputTokens })
        break
      case 'error':
        throw new Error(event.error?.message ?? 'Stream error')
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let split: number
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) handle(line.slice(5).trim())
      }
    }
  }
  return usage
}

/** A short thread title from the first exchange, using the fastest model. */
export const anthropicTitler: Titler = async (firstMessage, reply) => {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey(),
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 24,
        system:
          'Write a 2-5 word title for this chat. Sentence case, no quotes, no trailing punctuation. Reply with the title only.',
        messages: [
          { role: 'user', content: `User: ${firstMessage.slice(0, 600)}\n\nAssistant: ${reply.slice(0, 600)}` },
        ],
      }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { content?: { type: string; text?: string }[] }
    const text = body.content?.find((block) => block.type === 'text')?.text?.trim()
    return text ? text.replace(/^["']|["'.]$/g, '').slice(0, 48) : null
  } catch {
    return null
  }
}
