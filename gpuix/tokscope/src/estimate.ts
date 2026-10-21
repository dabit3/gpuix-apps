/** Rough tokenizer-free estimate: ~3.7 characters per token for mixed code and prose. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.round(text.length / 3.7))
}

export function contentText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(contentText).join('\n')
  if (typeof content === 'object') {
    const c = content as Record<string, unknown>
    if (typeof c.text === 'string') return c.text
    if (typeof c.thinking === 'string') return c.thinking
    if (c.content !== undefined) return contentText(c.content)
    if (c.input !== undefined) return JSON.stringify(c.input)
    if (c.type === 'image') return 'x'.repeat(5600)
  }
  return ''
}
