#!/usr/bin/env bun
/**
 * Replays a transcript into a directory line by line, the way an agent writes it,
 * so `tokscope <dir>` can be watched updating live.
 *   bun scripts/replay.ts <transcript.jsonl> <dest-dir> [--speed 1]
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { speed: { type: 'string', short: 's' } } })
const [src, dest] = positionals
if (!src || !dest) {
  console.log('usage: bun scripts/replay.ts <transcript.jsonl> <dest-dir> [--speed 1]')
  process.exit(1)
}
const speed = Number(values.speed ?? 1)
const lines = readFileSync(src, 'utf8').split('\n').filter(Boolean)
const dir = join(dest, `-Users-sam-code-${JSON.parse(lines.find((l) => l.includes('"cwd"')) ?? '{}').cwd?.split('/').pop() ?? 'live'}`)
mkdirSync(dir, { recursive: true })
const out = join(dir, basename(src))
writeFileSync(out, '')
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms / speed))
console.log(dim(`replaying ${lines.length} lines → ${out}`))
let req = 0
for (const line of lines) {
  const d = JSON.parse(line)
  appendFileSync(out, line + '\n')
  const u = d.message?.usage
  if (d.type === 'assistant' && u) {
    const block = d.message.content?.[0]
    const what = block?.type === 'tool_use' ? `${block.name} ${JSON.stringify(block.input).slice(0, 48)}` : (block?.text ?? '').slice(0, 56)
    const inp = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
    const hit = inp ? Math.round((u.cache_read_input_tokens / inp) * 100) : 0
    const color = hit > 70 ? 32 : hit > 0 ? 33 : 31
    if (block?.type === 'tool_use' || block?.text) {
      req++
      console.log(`\x1b[1m${String(req).padStart(3)}\x1b[0m  in ${k(inp).padStart(6)}  \x1b[${color}mcache ${String(hit).padStart(3)}%\x1b[0m  out ${k(u.output_tokens).padStart(5)}  ${dim(what)}`)
    }
    await sleep(900)
  } else if (d.type === 'user' && Array.isArray(d.message?.content) && d.message.content[0]?.type === 'tool_result') {
    await sleep(250)
  } else await sleep(60)
}
console.log(dim('done'))
