/**
 * Synthetic Codex CLI rollout + Devin CLI ATIF export for the bundled sample.
 * Same planted problems as the Claude Code sample (huge reads, repeats, a retry loop),
 * shaped like the real formats. No real system prompts or provider text.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = import.meta.dir
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const lorem = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}: ${['const', 'return', 'if', 'await', 'export'][i % 5]} value_${Math.floor(rnd() * 999)} = handler(${i});`).join('\n')

type Turn = { think?: string; say?: string; tool?: string; args: Record<string, unknown>; result: string; out: number }

const turns: Turn[] = [
  { tool: 'exec', args: { cmd: 'rg --files src | head -50' }, result: lorem(40, 'src/file'), out: 60 },
  { tool: 'exec', args: { cmd: 'cat src/billing/invoice.ts' }, result: lorem(420, 'invoice.ts'), out: 80 },
  { think: 'The rounding happens before tax is applied.', tool: 'exec', args: { cmd: 'cat src/billing/tax.ts' }, result: lorem(260, 'tax.ts'), out: 140 },
  { tool: 'exec', args: { cmd: 'npm test -- billing' }, result: lorem(180, 'FAIL billing.test.ts'), out: 70 },
  { tool: 'apply_patch', args: { patch: '*** Update File: src/billing/invoice.ts\n-  total = round(sub) + tax\n+  total = round(sub + tax)' }, result: 'Done', out: 520 },
  { tool: 'exec', args: { cmd: 'npm test -- billing' }, result: lorem(180, 'FAIL billing.test.ts'), out: 60 },
  { tool: 'exec', args: { cmd: 'cat src/billing/invoice.ts' }, result: lorem(420, 'invoice.ts'), out: 60 },
  { tool: 'apply_patch', args: { patch: '*** Update File: src/billing/tax.ts\n-  rate * amount\n+  Math.round(rate * amount * 100) / 100' }, result: 'Done', out: 610 },
  { tool: 'exec', args: { cmd: 'npm test -- billing' }, result: lorem(30, 'PASS billing.test.ts'), out: 50 },
  { say: 'Fixed the invoice total: tax is now rounded per line and the total is rounded once. Billing tests pass.', args: {}, result: '', out: 120 },
]

/** cumulative prompt sizes with prefix caching: each turn reads what the last one sent */
function usage(prev: number, added: number, out: number, bust = false) {
  const total = prev + added
  const read = bust ? 0 : prev
  return { total, read, write: total - read - 3, out }
}

function codex() {
  const id = '01a1600e-5c2a-7b41-9d0e-6f3a2b1c9e10'
  const t0 = Date.parse('2026-10-20T16:02:00Z')
  const L: object[] = []
  let ord = 0
  const line = (ms: number, type: string, payload: object) => L.push({ timestamp: new Date(t0 + ms).toISOString(), ordinal: ++ord, type, payload })
  line(0, 'session_meta', { session_id: id, id, timestamp: new Date(t0).toISOString(), cwd: '/Users/sam/code/billing-service', originator: 'codex_exec', cli_version: '0.163.0', source: 'exec', model_provider: 'openai', base_instructions: { text: 'You are a coding agent working in the user\'s repository. (synthetic stand-in for the harness instructions)\n' + lorem(160, 'instruction') } })
  line(5, 'turn_context', { turn_id: 't1', cwd: '/Users/sam/code/billing-service', approval_policy: 'never', model: 'gpt-6.1-sol' })
  line(6, 'world_state', { full: true, state: { current_date: '2026-10-20', filesystem: lorem(60, 'tree') } })
  line(7, 'response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions>\n' + lorem(70, 'rule') }] })
  line(8, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Invoices are off by a cent on multi-line orders. Find the rounding bug in src/billing and fix it, then run the billing tests.' }] })
  let prev = 0
  let ms = 1000
  let added = 9800
  turns.forEach((t, i) => {
    ms += 4000 + Math.floor(rnd() * 9000)
    if (i === 6) ms += 7 * 60_000 // idle gap: the cache expires
    const call = `call_${i}`
    if (t.think) line(ms - 500, 'response_item', { type: 'reasoning', summary: [{ type: 'summary_text', text: t.think }] })
    if (t.say) line(ms - 200, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t.say }] })
    else line(ms - 100, 'response_item', { type: 'custom_tool_call', call_id: call, name: t.tool, input: t.tool === 'exec' ? `text(await tools.exec_command(${JSON.stringify(t.args)}));` : String(t.args.patch) })
    const u = usage(prev, added, t.out, i === 6)
    line(ms, 'token_usage_record', { session_id: id, turn_id: 't1', response_id: `resp_${i}`, usage: { input_tokens: u.total, cached_input_tokens: u.read, cache_write_input_tokens: u.write, output_tokens: u.out, reasoning_output_tokens: 0, total_tokens: u.total + u.out } })
    if (!t.say) line(ms + 300, 'response_item', { type: 'custom_tool_call_output', call_id: call, output: [{ type: 'input_text', text: t.result }] })
    prev = u.total
    added = t.out + Math.round(t.result.length / 3.7) + 20
  })
  const dir = join(root, 'codex', 'sessions', '2026', '10', '20')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `rollout-2026-10-20T09-02-00-${id}.jsonl`), L.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

function devin() {
  const t0 = Date.parse('2026-10-21T18:40:00Z')
  const tools = ['exec', 'read', 'edit', 'grep', 'glob', 'web_fetch', 'todo', 'subagent', 'mcp_call', 'ask_user'].map((n) => ({ name: n, description: `${n} tool. ` + lorem(6, 'param'), parameters: { type: 'object', properties: { arg: { type: 'string' } } } }))
  const steps: any[] = [
    { step_id: 1, timestamp: new Date(t0).toISOString(), source: 'system', message: 'You are Devin, a software engineer. (synthetic stand-in for the CLI system prompt)\n' + lorem(120, 'guideline') },
    { step_id: 2, timestamp: new Date(t0 + 1000).toISOString(), source: 'user', message: 'Add pagination to GET /v1/orders in the orders API (cursor based, default 50) and update the OpenAPI spec.' },
  ]
  let prev = 0
  let added = 7600
  let ms = 2000
  const work: Turn[] = [
    { tool: 'grep', args: { pattern: 'orders', path: 'src' }, result: lorem(90, 'match'), out: 70 },
    { tool: 'read', args: { file_path: 'src/routes/orders.ts' }, result: lorem(300, 'orders.ts'), out: 60 },
    { tool: 'read', args: { file_path: 'openapi.yaml' }, result: lorem(900, 'openapi.yaml'), out: 60 },
    { tool: 'edit', args: { file_path: 'src/routes/orders.ts' }, result: 'Edited src/routes/orders.ts', out: 700 },
    { tool: 'read', args: { file_path: 'openapi.yaml' }, result: lorem(900, 'openapi.yaml'), out: 50 },
    { tool: 'edit', args: { file_path: 'openapi.yaml' }, result: 'Edited openapi.yaml', out: 480 },
    { tool: 'exec', args: { command: 'npm test' }, result: lorem(120, 'PASS'), out: 60 },
    { say: 'GET /v1/orders now takes `cursor` and `limit` (default 50, max 200) and returns `next_cursor`. The spec and tests are updated.', args: {}, result: '', out: 140 },
  ]
  let cost = 0
  work.forEach((t, i) => {
    ms += 5000 + Math.floor(rnd() * 8000)
    const u = usage(prev, added, t.out)
    const c = (u.read * 0.5 + u.write * 6.25 + 3 * 5 + u.out * 25) / 1e6
    cost += c
    steps.push({
      step_id: steps.length + 1,
      timestamp: new Date(t0 + ms).toISOString(),
      source: 'agent',
      model_name: 'claude-opus-5-5',
      message: t.say ?? '',
      tool_calls: t.say ? [] : [{ tool_call_id: `tc_${i}`, function_name: t.tool, arguments: t.args }],
      observation: t.say ? undefined : { results: [{ source_call_id: `tc_${i}`, content: t.result }] },
      metrics: { prompt_tokens: u.total, completion_tokens: u.out, cached_tokens: u.read, cost_usd: Number(c.toFixed(6)), extra: { cache_creation_input_tokens: u.write } },
    })
    prev = u.total
    added = t.out + Math.round(t.result.length / 3.7) + 20
  })
  const doc = {
    schema_version: 'ATIF-v1.7',
    session_id: 'devin-cli-7b2e91',
    agent: { name: 'devin', version: '3000.11.92', model_name: 'claude-opus-5-5', tool_definitions: tools },
    steps,
    final_metrics: { total_steps: steps.length, total_cost_usd: Number(cost.toFixed(6)) },
  }
  const dir = join(root, 'devin', 'exports')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'orders-pagination.json'), JSON.stringify(doc, null, 2) + '\n')
}

codex()
devin()
