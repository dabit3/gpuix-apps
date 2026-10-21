import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Attachment {
  name: string
  path: string
  content: string
  lines: number
}

export interface ReplyMeta {
  model: string
  firstTokenMs: number | null
  thinkingMs?: number | null
  totalMs: number
  inputTokens: number
  outputTokens: number
  stopReason: string | null
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  attachments?: Attachment[]
  meta?: ReplyMeta
  error?: string
}

export interface Thread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

export interface Settings {
  model: string
  systemPrompt: string
  thinking: boolean
}

export interface StoreData {
  version: 1
  activeId: string | null
  threads: Thread[]
  settings: Settings
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are Claude, running inside Claude Desk, a native macOS chat app. Use GitHub-flavoured markdown: tables for comparisons, fenced code blocks with a language tag, and unified diffs in ```diff fences (with --- and +++ headers) when showing changes to code.'

export function defaultDataDir(): string {
  return process.env.CLAUDE_DESK_DATA_DIR ?? path.join(os.homedir(), 'Library', 'Application Support', 'Claude Desk')
}

export function storeFile(dir = defaultDataDir()): string {
  return path.join(dir, 'threads.json')
}

export function emptyStore(): StoreData {
  return {
    version: 1,
    activeId: null,
    threads: [],
    settings: { model: 'claude-sonnet-5-5', systemPrompt: DEFAULT_SYSTEM_PROMPT, thinking: false },
  }
}

export function loadStore(file: string): StoreData {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as StoreData
    if (parsed.version !== 1 || !Array.isArray(parsed.threads)) return emptyStore()
    return { ...emptyStore(), ...parsed, settings: { ...emptyStore().settings, ...parsed.settings } }
  } catch {
    return emptyStore()
  }
}

/** Atomic write: a crash mid-write never leaves a truncated threads.json. */
export function saveStore(file: string, data: StoreData): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const TEXT_EXTENSIONS = /\.(txt|md|markdown|ts|tsx|js|jsx|mjs|cjs|json|py|rs|go|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|css|scss|html|xml|yml|yaml|toml|ini|sh|zsh|bash|sql|csv|log|env|gitignore|dockerfile|lock)$/i
const MAX_ATTACHMENT_BYTES = 256 * 1024

export function readAttachment(file: string): Attachment {
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a file`)
  if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error(`${path.basename(file)} is larger than 256 KB`)
  const buf = fs.readFileSync(file)
  if (!TEXT_EXTENSIONS.test(file) && buf.includes(0)) throw new Error(`${path.basename(file)} is not a text file`)
  const content = buf.toString('utf8')
  return { name: path.basename(file), path: file, content, lines: content.split('\n').length }
}

/** What the API sees for a user turn: attached files first, then the question. */
export function apiContent(message: Message): string {
  if (!message.attachments?.length) return message.content
  const files = message.attachments
    .map((a) => `<file name="${a.name}">\n${a.content}\n</file>`)
    .join('\n\n')
  return `${files}\n\n${message.content}`
}
