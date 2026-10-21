#!/usr/bin/env -S RUST_LOG=error bun
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const HELP = `tokscope — token-efficiency audit for agent transcripts, rendered in your terminal

usage
  tokscope [paths...]           open the dashboard (Ghostty or kitty)
  tokscope --audit [paths...]   write AUDIT.md and exit, no UI

paths   Claude Code transcript dirs or .jsonl files.
        default: ~/.claude/projects if it exists, else the bundled sample/

options
  -o, --out <file>      where AUDIT.md is written      (default ./AUDIT.md)
  -p, --prices <file>   price sheet JSON (USD / 1M tokens, see prices.json)
      --no-watch        don't tail the transcripts for new lines
  -a, --audit           headless: write the report and print a summary
  -h, --help            show this help

keys
  1-4 views · j/k or ↑/↓ sessions · a all sessions · space toggle fix
  w write AUDIT.md · f follow newest · ctrl-c quit

examples
  tokscope ~/.claude/projects
  tokscope sample/
  tokscope live/ & bun scripts/replay.ts sample/... live/   # watch a log grow`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    prices: { type: 'string', short: 'p' },
    'no-watch': { type: 'boolean' },
    audit: { type: 'boolean', short: 'a' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log(HELP)
  process.exit(0)
}

const root = resolve(import.meta.dir, '..')
const claude = join(homedir(), '.claude', 'projects')
const paths = positionals.length ? positionals.map((p) => resolve(p.replace(/^~(?=$|\/)/, homedir()))) : [existsSync(claude) ? claude : join(root, 'sample')]
const auditPath = resolve(values.out ?? 'AUDIT.md')

const { loadPrices } = await import('../src/prices')
const sheet = await loadPrices(values.prices ?? (existsSync(join(root, 'prices.json')) ? join(root, 'prices.json') : undefined))

if (values.audit) {
  const { loadSessions } = await import('../src/load')
  const { auditMarkdown, findFixes, fmt$ } = await import('../src/audit')
  const { totals } = await import('../src/analyze')
  const { sessions } = loadSessions(paths, sheet)
  writeFileSync(auditPath, auditMarkdown(sessions, sheet, paths))
  const t = totals(sessions)
  console.log(`${sessions.length} transcripts · ${t.requests} requests · ${fmt$(t.cost)} · cache hit ${(t.cacheHit * 100).toFixed(1)}%`)
  for (const f of findFixes(sessions, sheet)) console.log(`  −${fmt$(f.savings).padEnd(7)} ${f.title}`)
  console.log(`wrote ${auditPath}`)
  process.exit(0)
}

if (!process.stdin.isTTY) {
  console.error('tokscope: stdin is not a terminal. Pass transcript paths as arguments instead of piping.')
  process.exit(1)
}

const React = await import('react')
const { render } = await import('@gpuix/react')
const { App } = await import('../src/app')
const terminal = process.env.GPUIX_WINDOW !== '1'
render(React.createElement(App, { paths, sheet, auditPath, watch: !values['no-watch'] }), { terminal })
