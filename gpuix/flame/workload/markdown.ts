import { highlightCode } from './highlight.ts'

export type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'table'; rows: string[][] }

export function parseMarkdown(source: string): Block[] {
  const lines = source.split('\n')
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('```')) {
      const lang = line.slice(3)
      const body: string[] = []
      while (++i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i]!)
      blocks.push({ kind: 'code', lang, code: body.join('\n') })
    } else if (line.startsWith('#')) {
      const level = line.match(/^#+/)![0].length
      blocks.push({ kind: 'h', level, text: line.slice(level + 1) })
    } else if (line.startsWith('- ')) {
      const items = [line.slice(2)]
      while (lines[i + 1]?.startsWith('- ')) items.push(lines[++i]!.slice(2))
      blocks.push({ kind: 'ul', items })
    } else if (line.startsWith('|')) {
      const rows = [line]
      while (lines[i + 1]?.startsWith('|')) rows.push(lines[++i]!)
      blocks.push({
        kind: 'table',
        rows: rows.filter((r) => !r.includes('---')).map((r) => r.split('|').slice(1, -1).map((c) => c.trim())),
      })
    } else if (line.trim()) {
      blocks.push({ kind: 'p', text: line })
    }
  }
  return blocks
}

// Slow path: five full-string passes, each with a fresh RegExp.
function escapeHtmlSlow(s: string): string {
  return s
    .replace(new RegExp('&', 'g'), '&amp;')
    .replace(new RegExp('<', 'g'), '&lt;')
    .replace(new RegExp('>', 'g'), '&gt;')
    .replace(new RegExp('"', 'g'), '&quot;')
    .replace(new RegExp("'", 'g'), '&#39;')
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const ESC_RE = /[&<>"']/g
function escapeHtmlFast(s: string): string {
  return ESC_RE.test(s) ? s.replace(ESC_RE, (c) => ESC[c]!) : s
}

function parseInline(text: string, escape: (s: string) => string): string {
  return escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

export function renderHtml(blocks: Block[], fast: boolean): string {
  const escape = fast ? escapeHtmlFast : escapeHtmlSlow
  const out: string[] = []
  for (const b of blocks) {
    switch (b.kind) {
      case 'h':
        out.push(`<h${b.level} id="${slugify(b.text)}">${parseInline(b.text, escape)}</h${b.level}>`)
        break
      case 'p':
        out.push(`<p>${parseInline(b.text, escape)}</p>`)
        break
      case 'ul':
        out.push(`<ul>${b.items.map((i) => `<li>${parseInline(i, escape)}</li>`).join('')}</ul>`)
        break
      case 'code':
        out.push(`<pre class="${b.lang}">${highlightCode(b.code, fast, escape)}</pre>`)
        break
      case 'table':
        out.push(`<table>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${parseInline(c, escape)}</td>`).join('')}</tr>`).join('')}</table>`)
        break
    }
  }
  return out.join('\n')
}
