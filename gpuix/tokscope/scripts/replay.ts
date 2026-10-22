#!/usr/bin/env bun
/**
 * Replays a transcript into a directory line by line, the way an agent writes it,
 * so `tokscope <dir>` can be watched updating live.
 *   bun scripts/replay.ts [transcript.jsonl] [dest-dir=live] [--speed 1]
 * With no arguments it replays the bundled flaky-test session into ./live.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { speed: { type: 'string', short: 's' } } })
const DEFAULT_SRC = join(import.meta.dir, '..', 'sample/projects/-Users-sam-code-api-server/63a31a41-09b4-4ddc-ab26-9a7580546ad3.jsonl')
const [src = DEFAULT_SRC, dest = 'live'] = positionals
if (positionals[0] === '-h' || positionals[0] === '--help') {
  console.log('usage: bun scripts/replay.ts [transcript.jsonl] [dest-dir=live] [--speed 1]')
  process.exit(0)
}
const speed = Number(values.speed ?? 1)
const raw = readFileSync(src, 'utf8').split('\n').filter(Boolean)
const oldId: string | undefined = raw.map((l) => JSON.parse(l).sessionId).find(Boolean)
const newId = crypto.randomUUID()
const lines = oldId ? raw.map((l) => l.replaceAll(oldId, newId)) : raw
const dir = join(dest, `-Users-sam-code-${JSON.parse(lines.find((l) => l.includes('"cwd"')) ?? '{}').cwd?.split('/').pop() ?? 'live'}`)
mkdirSync(dir, { recursive: true })
const out = join(dir, oldId ? basename(src).replace(oldId, newId) : basename(src))
writeFileSync(out, '')
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / speed))
console.log(dim(`replaying ${lines.length} lines → ${out}`))
const seen = new Set<string>()
const cols = process.stdout.columns || 100
for (const line of lines) {
  const d = JSON.parse(line)
  appendFileSync(out, line + '\n')
  const u = d.message?.usage
  if (d.type === 'assistant' && u) {
    const id: string = d.message.id ?? d.uuid
    if (seen.has(id)) continue
    seen.add(id)
    const block = d.message.content?.find((b: { type: string }) => b.type === 'tool_use') ?? d.message.content?.[0]
    const inp = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
    const hit = inp ? Math.round((u.cache_read_input_tokens / inp) * 100) : 0
    const color = hit > 70 ? 32 : hit > 0 ? 33 : 31
    const head = `${String(seen.size).padStart(3)}  in ${k(inp).padStart(6)}  cache ${String(hit).padStart(3)}%  out ${k(u.output_tokens).padStart(5)}  `
    const what = (block?.type === 'tool_use' ? `${block.name} ${JSON.stringify(block.input)}` : String(block?.text ?? block?.thinking ?? '')).replace(/\s+/g, ' ')
    const room = Math.max(8, cols - head.length - 1)
    console.log(`\x1b[1m${String(seen.size).padStart(3)}\x1b[0m  in ${k(inp).padStart(6)}  \x1b[${color}mcache ${String(hit).padStart(3)}%\x1b[0m  out ${k(u.output_tokens).padStart(5)}  ${dim(what.length > room ? what.slice(0, room - 1) + '…' : what)}`)
    await sleep(500)
  } else if (d.type === 'user' && Array.isArray(d.message?.content) && d.message.content[0]?.type === 'tool_result') {
    await sleep(250)
  } else await sleep(60)
}
console.log(dim('done'))
