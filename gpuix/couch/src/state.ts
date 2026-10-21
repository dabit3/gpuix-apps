import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface Resume { pos: number; dur: number; at: number }
export interface ProfileState { resume: Record<string, Resume>; watched: Record<string, number> }
export interface SavedState { lastProfile?: string; profiles: Record<string, ProfileState> }

export const statePath = () => process.env.COUCH_STATE ?? join(homedir(), '.config/couch/state.json')

export function loadState(path = statePath()): SavedState {
  try {
    if (existsSync(path)) {
      const s = JSON.parse(readFileSync(path, 'utf8'))
      if (s && typeof s === 'object' && s.profiles) return s
    }
  } catch {}
  return { profiles: {} }
}

export function saveState(s: SavedState, path = statePath()) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path + '.tmp', JSON.stringify(s, null, 2))
    renameSync(path + '.tmp', path)
  } catch {}
}

export function profileState(s: SavedState, name: string): ProfileState {
  return (s.profiles[name] ??= { resume: {}, watched: {} })
}

/** Records a stop position: near the end counts as watched and clears resume; the first 20 s don't count. */
export function recordPosition(p: ProfileState, id: string, pos: number, dur: number, now = Date.now()) {
  if (dur > 0 && pos >= dur * 0.95 - 2) {
    delete p.resume[id]
    p.watched[id] = now
  } else if (pos >= Math.min(20, dur * 0.1)) {
    p.resume[id] = { pos, dur, at: now }
  }
}

export function progressOf(p: ProfileState | undefined, id: string): number {
  const r = p?.resume[id]
  return r && r.dur > 0 ? Math.min(1, r.pos / r.dur) : 0
}
