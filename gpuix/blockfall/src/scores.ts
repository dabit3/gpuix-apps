import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ScoreEntry { name: string; score: number; lines: number; level: number; date: string }
export const MAX_SCORES = 10

export function scoresPath() {
  if (process.env.BLOCKFALL_SCORES) return process.env.BLOCKFALL_SCORES
  const base = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support') : process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share')
  return join(base, 'blockfall', 'scores.json')
}

export function loadScores(path = scoresPath()): ScoreEntry[] {
  try {
    if (!existsSync(path)) return []
    const data = JSON.parse(readFileSync(path, 'utf8')) as ScoreEntry[]
    return Array.isArray(data) ? data.filter((e) => typeof e.score === 'number').sort((a, b) => b.score - a.score).slice(0, MAX_SCORES) : []
  } catch {
    return []
  }
}

export function qualifies(scores: ScoreEntry[], score: number) {
  return score > 0 && (scores.length < MAX_SCORES || score > scores[scores.length - 1]!.score)
}

export function cleanInitials(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
}

/** Inserts and writes atomically; returns the new table and the entry's rank (0-based, -1 if it fell off). */
export function addScore(scores: ScoreEntry[], entry: ScoreEntry, path = scoresPath()) {
  const next = [...scores, entry].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, path)
  return { scores: next, rank: next.indexOf(entry) }
}
