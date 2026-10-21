#!/usr/bin/env bun
/** sq: a SQLite studio that runs inside your terminal (kitty graphics) or a native window. */
const args = process.argv.slice(2)
if (args.includes('-h') || args.includes('--help') || args.length === 0) {
  console.log(`sq — SQLite studio for the terminal, powered by GPUIX

Usage
  sq <file.db> [-e "<sql>"] [--window]

Options
  -e, --execute <sql>   open with this query in the editor and run it
  -w, --window          open a native window instead of rendering in the terminal
  -h, --help            show this help

Keys: ⌃↵ run · ⌃E explain · Tab accept completion · ⌃L clear · ⌃1–4 tabs · Esc close inspector · ⌃C quit
      (in --window mode ⌘ works too)
Runs inside Ghostty or kitty (kitty graphics protocol). Not supported inside tmux.`)
  process.exit(args.length === 0 ? 1 : 0)
}
// GPUIX holds native logs on stderr and flushes them when the app quits, which
// would bury the restored prompt. Run the app as a child whose stderr goes to a
// log file, and only show that log when the app fails.
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.cache', 'sq')
mkdirSync(dir, { recursive: true })
const log = join(dir, 'sq.log')
const child = Bun.spawn([process.execPath, join(import.meta.dir, '../src/main.tsx'), ...args], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: Bun.file(log),
  env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? 'error' },
})
process.on('SIGINT', () => {})
process.on('SIGTERM', () => child.kill('SIGTERM'))
const code = await child.exited
if (code !== 0 && code !== 130 && child.signalCode !== 'SIGINT') {
  const tail = readFileSync(log, 'utf8').split('\n').filter((l) => !/ (INFO|WARN) /.test(l)).slice(-20).join('\n')
  console.error(tail.trim() || `sq exited with code ${code}`)
}
process.exit(code === 130 ? 0 : code)
