import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { RunResult } from './runner'

export interface HistoryEntry {
  at: number
  durationMs: number
  pass: number
  fail: number
  skip: number
  partial: boolean
}

const MAX = 40

export function historyPath(dir: string): string {
  const base = process.env.TESTDECK_HOME ?? join(homedir(), '.cache/testdeck')
  return join(base, createHash('sha1').update(dir).digest('hex').slice(0, 12) + '.json')
}

export function loadHistory(dir: string): HistoryEntry[] {
  try {
    return JSON.parse(readFileSync(historyPath(dir), 'utf8')) as HistoryEntry[]
  } catch {
    return []
  }
}

export function appendHistory(dir: string, prev: HistoryEntry[], run: RunResult): HistoryEntry[] {
  const next = [...prev, { at: run.startedAt, durationMs: run.durationMs, pass: run.counts.pass, fail: run.counts.fail, skip: run.counts.skip + run.counts.todo, partial: run.partial }].slice(-MAX)
  try {
    const p = historyPath(dir)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, JSON.stringify(next))
  } catch {}
  return next
}
