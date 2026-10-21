import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ScoreEntry { initials: string; score: number; level: number; date: string }

export const DEFAULT_SCORES: ScoreEntry[] = [
  { initials: 'ZED', score: 42000, level: 5, date: '2026-10-01' },
  { initials: 'GPU', score: 30500, level: 4, date: '2026-10-02' },
  { initials: 'MTL', score: 21800, level: 3, date: '2026-10-03' },
  { initials: 'NEO', score: 12400, level: 2, date: '2026-10-04' },
  { initials: 'ARC', score: 6200, level: 1, date: '2026-10-05' },
]

export const MAX_SCORES = 8

export function scoresPath() {
  return process.env.NEON_BREAKOUT_SCORES ?? join(homedir(), 'Library', 'Application Support', 'Neon Breakout', 'scores.json')
}

export function loadScores(path = scoresPath()): ScoreEntry[] {
  try {
    if (!existsSync(path)) return DEFAULT_SCORES.slice()
    const data = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(data)) return DEFAULT_SCORES.slice()
    return data
      .filter((e) => typeof e?.score === 'number' && typeof e?.initials === 'string')
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES)
  } catch {
    return DEFAULT_SCORES.slice()
  }
}

export function qualifies(scores: ScoreEntry[], score: number) {
  return score > 0 && (scores.length < MAX_SCORES || score > scores[scores.length - 1]!.score)
}

export function cleanInitials(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
}

export function addScore(scores: ScoreEntry[], entry: ScoreEntry, path = scoresPath()): ScoreEntry[] {
  const next = [...scores, entry].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2))
  return next
}
