import { isAbsolute, resolve, dirname } from 'node:path'

export type BlockKind = 'md' | 'heading' | 'code' | 'img' | 'tasks'

export type Task = { checked: boolean; text: string; line: number }

export type Block = {
  /** Stable while the block's content and its occurrence index are unchanged. */
  key: string
  kind: BlockKind
  src: string
  /** 0-based first source line. */
  line: number
  level?: number
  title?: string
  slug?: string
  lang?: string
  alt?: string
  path?: string
  tasks?: Task[]
}

export type Heading = { key: string; level: number; title: string; slug: string; line: number }

const FENCE = /^ {0,3}(```+|~~~+)\s*([\w+#.-]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/
const IMAGE = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\s*$/

function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

export function stripInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, '$1$2')
}

export function slugify(s: string): string {
  return stripInline(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

/**
 * Split a document into render blocks: headings, fenced code, standalone images,
 * and runs of markdown separated by blank lines. Each block is its own native
 * element, so the app can measure it (TOC, scroll-follow) and React can keep
 * unchanged blocks mounted across reloads.
 */
export function parseBlocks(source: string, baseDir = '.'): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: Omit<Block, 'key'>[] = []
  let i = 0
  // YAML front matter
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l))
    if (end > 0) i = end + 1
  }
  let buf: string[] = []
  let bufStart = i
  const flush = () => {
    // Split into runs so task items render as checkboxes even when they sit
    // directly under an ordinary list or paragraph.
    let run: string[] = []
    let runStart = bufStart
    let runIsTasks = false
    const emit = () => {
      while (run.length && !run[run.length - 1]!.trim()) run.pop()
      if (run.some((l) => l.trim())) {
        if (runIsTasks) {
          const tasks = run
            .map((l, j) => ({ m: l.match(TASK), line: runStart + j }))
            .filter((x) => x.m)
            .map((x) => ({ checked: x.m![1] !== ' ', text: x.m![2]!, line: x.line }))
          out.push({ kind: 'tasks', src: run.join('\n'), line: runStart, tasks })
        } else out.push({ kind: 'md', src: run.join('\n'), line: runStart })
      }
      run = []
    }
    buf.forEach((l, j) => {
      if (!l.trim()) {
        if (run.length) run.push(l)
        return
      }
      const isTask = TASK.test(l)
      if (run.length && isTask !== runIsTasks) emit()
      if (!run.length) {
        runStart = bufStart + j
        runIsTasks = isTask
      }
      run.push(l)
    })
    emit()
    buf = []
  }
  for (; i < lines.length; i++) {
    const l = lines[i]!
    const fence = l.match(FENCE)
    if (fence) {
      flush()
      const marker = fence[1]!
      const start = i
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) body.push(lines[i++]!)
      out.push({ kind: 'code', src: body.join('\n'), lang: fence[2] || undefined, line: start })
      bufStart = i + 1
      continue
    }
    const h = l.match(HEADING)
    if (h) {
      flush()
      const title = h[2]!
      out.push({ kind: 'heading', src: l.trim(), level: h[1]!.length, title: stripInline(title), slug: slugify(title), line: i })
      bufStart = i + 1
      continue
    }
    const img = l.match(IMAGE)
    if (img) {
      flush()
      const raw = img[2]!
      const path = /^(https?:|data:)/.test(raw) ? raw : isAbsolute(raw) ? raw : resolve(baseDir, decodeURI(raw))
      out.push({ kind: 'img', src: l.trim(), alt: img[1]!, path, line: i })
      bufStart = i + 1
      continue
    }
    if (!l.trim()) {
      // Blank lines end a block, except inside a list (a loose list stays one block).
      const next = lines.slice(i + 1).find((x) => x.trim())
      const inList = buf.length > 0 && /^\s*([-*+]|\d+[.)])\s/.test(buf[0]!) && next !== undefined && /^(\s+|\s*([-*+]|\d+[.)])\s)/.test(next)
      if (inList) {
        buf.push(l)
        continue
      }
      flush()
      bufStart = i + 1
      continue
    }
    if (!buf.length) bufStart = i
    buf.push(l)
  }
  flush()
  const seen = new Map<string, number>()
  return out.map((b) => {
    const base = `${b.kind}:${hash(b.src + (b.lang ?? ''))}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { ...b, key: `${base}:${n}` }
  })
}

export function headings(blocks: Block[], maxLevel = 3): Heading[] {
  return blocks
    .filter((b) => b.kind === 'heading' && (b.level ?? 9) <= maxLevel)
    .map((b) => ({ key: b.key, level: b.level!, title: b.title!, slug: b.slug!, line: b.line }))
}

/**
 * The block to follow after an edit: the last block of the changed region
 * (common prefix and suffix removed). For a pure deletion, the block right
 * after the removed range. `null` when nothing changed.
 */
export function changedBlock(prev: Block[], next: Block[]): number | null {
  let a = 0
  while (a < prev.length && a < next.length && prev[a]!.key === next[a]!.key) a++
  if (a === prev.length && a === next.length) return null
  let b = 0
  while (
    b < prev.length - a &&
    b < next.length - a &&
    prev[prev.length - 1 - b]!.key === next[next.length - 1 - b]!.key
  )
    b++
  const end = next.length - b - 1
  if (end >= a) return end
  return Math.min(a, next.length - 1)
}

export type Stats = { words: number; minutes: number; headings: number; codeBlocks: number }

export const WORDS_PER_MINUTE = 230

export function stats(blocks: Block[]): Stats {
  let words = 0
  for (const b of blocks) {
    if (b.kind === 'code' || b.kind === 'img') continue
    const text = stripInline(b.kind === 'heading' ? b.title! : b.src)
      .replace(/^\s*([-*+]|\d+[.)]|>|\|)\s*/gm, ' ')
      .replace(/\[[ xX]\]/g, ' ')
      .replace(/[|#>*_~`]+|(?<![\p{L}\p{N}])-+|-+(?![\p{L}\p{N}])/gu, ' ')
    words += text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  }
  return {
    words,
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    headings: blocks.filter((b) => b.kind === 'heading').length,
    codeBlocks: blocks.filter((b) => b.kind === 'code').length,
  }
}

/** Text a block paints, for counting find matches per block. */
export function searchableText(b: Block): string {
  if (b.kind === 'code') return b.src
  if (b.kind === 'img') return ''
  if (b.kind === 'heading') return b.title!
  return stripInline(b.src)
    .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*>\s?/gm, '')
}

/** Flip the checkbox of the task list item on 0-based `line`. */
export function toggleTask(source: string, line: number): string {
  const lines = source.split('\n')
  const l = lines[line]
  if (l === undefined || !TASK.test(l.replace(/\r$/, ''))) return source
  lines[line] = l.replace(/\[([ xX])\]/, (_, c: string) => (c === ' ' ? '[x]' : '[ ]'))
  return lines.join('\n')
}

export const docDir = (file: string) => dirname(resolve(file))
