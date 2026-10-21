import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { deserialize, serialize, type GameState } from './engine/game'

export const HOME = process.env.WASTELAND_HOME ?? join(homedir(), '.wasteland')
export const paths = {
  save: join(HOME, 'save.json'),
  log: join(HOME, 'log.txt'),
  radio: join(HOME, 'radio.txt'),
}
const ensure = (p: string) => mkdirSync(dirname(p), { recursive: true })

export function writeSave(s: GameState, p = paths.save) { ensure(p); writeFileSync(p, serialize(s)) }
export function readSave(p = paths.save): GameState | null {
  if (!existsSync(p)) return null
  return deserialize(readFileSync(p, 'utf8'))
}
export function appendLog(lines: string[], p = paths.log) { if (!lines.length) return; ensure(p); appendFileSync(p, lines.join('\n') + '\n') }
export function sendBroadcast(text: string, p = paths.radio) { ensure(p); appendFileSync(p, text.replace(/\n/g, ' ') + '\n') }

/** Polls the broadcast inbox; returns lines appended since the last call. */
export function broadcastReader(p = paths.radio) {
  let offset = existsSync(p) ? statSync(p).size : 0
  return () => {
    if (!existsSync(p)) return []
    const size = statSync(p).size
    if (size < offset) offset = 0
    if (size === offset) return []
    const buf = readFileSync(p).subarray(offset, size).toString('utf8')
    offset = size
    return buf.split('\n').map((l) => l.trim()).filter(Boolean)
  }
}
