/** Tiny SQL tokenizer for highlighting and identifier-aware autocomplete. */
export type TokKind = 'kw' | 'fn' | 'str' | 'num' | 'cmt' | 'id' | 'op' | 'ws'
export interface Tok { kind: TokKind; text: string; start: number }

export const KEYWORDS = new Set('select from where group by order having limit offset join left right inner outer cross on as and or not null is in like glob between case when then else end distinct union all insert into values update set delete create table view index drop alter add primary key references default with recursive asc desc exists explain query plan pragma begin commit rollback returning over partition window cast collate unique check foreign replace ignore'.split(' '))
export const FUNCTIONS = new Set('count sum avg min max round abs length lower upper substr trim ltrim rtrim coalesce ifnull nullif date time datetime julianday strftime printf instr random total group_concat json_extract typeof iif row_number rank dense_rank lag lead'.split(' '))

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    const start = i
    if (/\s/.test(c)) { while (i < src.length && /\s/.test(src[i]!)) i++; out.push({ kind: 'ws', text: src.slice(start, i), start }); continue }
    if (c === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') i++; out.push({ kind: 'cmt', text: src.slice(start, i), start }); continue }
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < src.length) {
        if (src[i] === c && src[i + 1] === c) i += 2
        else if (src[i] === c) break
        else i++
      }
      i = Math.min(src.length, i + 1)
      out.push({ kind: c === "'" ? 'str' : 'id', text: src.slice(start, i), start }); continue
    }
    if (/[0-9]/.test(c)) { while (i < src.length && /[0-9.]/.test(src[i]!)) i++; out.push({ kind: 'num', text: src.slice(start, i), start }); continue }
    if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++
      const w = src.slice(start, i)
      const lw = w.toLowerCase()
      out.push({ kind: KEYWORDS.has(lw) ? 'kw' : FUNCTIONS.has(lw) && src[i] === '(' ? 'fn' : 'id', text: w, start }); continue
    }
    i++
    out.push({ kind: 'op', text: c, start })
  }
  return out
}

/** The identifier fragment ending at the caret, and its start offset. */
export function wordAt(src: string, caret: number): { word: string; start: number } {
  let s = caret
  while (s > 0 && /[A-Za-z0-9_.]/.test(src[s - 1]!)) s--
  return { word: src.slice(s, caret), start: s }
}

export interface Completion { label: string; detail: string; kind: 'table' | 'view' | 'column' | 'keyword' }

/** Suggestions for `word`: `table.` prefixes complete that table's columns. */
export function complete(word: string, schema: Array<{ name: string; kind: 'table' | 'view'; columns: Array<{ name: string; type: string }> }>, limit = 8): Completion[] {
  if (!word) return []
  const lw = word.toLowerCase()
  const dot = lw.indexOf('.')
  if (dot >= 0) {
    const t = schema.find((s) => s.name.toLowerCase() === lw.slice(0, dot))
    const rest = lw.slice(dot + 1)
    return (t?.columns ?? []).filter((c) => c.name.toLowerCase().startsWith(rest)).slice(0, limit).map((c) => ({ label: `${t!.name}.${c.name}`, detail: c.type, kind: 'column' }))
  }
  const out: Completion[] = []
  const tables = schema.filter((t) => t.name.toLowerCase().startsWith(lw)).sort((x, y) => x.name.length - y.name.length || x.name.localeCompare(y.name))
  for (const t of tables) out.push({ label: t.name, detail: t.kind, kind: t.kind })
  const seen = new Set<string>()
  for (const t of schema) for (const c of t.columns) if (c.name.toLowerCase().startsWith(lw) && !seen.has(c.name)) { seen.add(c.name); out.push({ label: c.name, detail: `${t.name} · ${c.type}`, kind: 'column' }) }
  for (const k of KEYWORDS) if (k.startsWith(lw) && k !== lw && lw.length >= 2) out.push({ label: k.toUpperCase(), detail: 'keyword', kind: 'keyword' })
  return out.filter((c) => c.label.toLowerCase() !== lw).slice(0, limit)
}
