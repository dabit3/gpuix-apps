/**
 * sq: a SQLite studio that lives in the terminal. Schema sidebar, highlighted SQL
 * editor with completion, virtualized results grid, cell inspector, plan, chart,
 * history, and live refresh when another process writes to the database.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isTerminal, useGpuixRequired, type EventPayload, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { formatCell, quoteIdent, type PlanRow, type QueryResult, type SqDb, type TableInfo } from './db'
import { complete, tokenize, wordAt, type Completion, type TokKind } from './sql'
import { MONO, T, fmtMs, fmtN } from './theme'

export const windowHandlers: { onKeyDown?: (e: KeyEvent) => void } = {}

export const ROW_H = 24
const WINDOW = 90
const LEAD = 24
/** The grid scrolls a page of at most PAGE rows (GPUIX 0.11 leaks per itemCount change). */
export const PAGE = 20_000
const FONT = 14
const LINE_H = 20
const CW = 8.43
const PAD = 12
const GUTTER = 64

type Tab = 'results' | 'plan' | 'chart' | 'history'
interface HistoryItem { sql: string; rows: number; ms: number; at: number; error?: string }

const TOK_COLOR: Record<TokKind, string> = {
  kw: T.red, fn: T.blue, str: '#a5d6ff', num: T.cyan, cmt: T.muted, id: T.fg, op: T.dim, ws: T.fg,
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n))

/** Highlighted copy of the editor text, drawn under a transparent native textarea. */
const Highlight = memo(function Highlight({ src }: { src: string }) {
  const lines: Array<Array<{ kind: TokKind; text: string }>> = [[]]
  for (const t of tokenize(src)) {
    const parts = t.text.split('\n')
    parts.forEach((p, i) => {
      if (i > 0) lines.push([])
      if (p) lines[lines.length - 1]!.push({ kind: t.kind, text: p })
    })
  }
  return (
    <div style={{ position: 'absolute', left: PAD, top: PAD, right: PAD, display: 'flex', flexDirection: 'column' }}>
      {lines.map((toks, li) => (
        <div key={li} style={{ display: 'flex', flexDirection: 'row', height: LINE_H, alignItems: 'center' }}>
          {toks.map((t, ti) =>
            t.kind === 'ws' ? (
              <div key={ti} style={{ width: t.text.replace(/\t/g, '  ').length * CW, flexShrink: 0 }} />
            ) : (
              <text key={ti} style={{ fontFamily: MONO, fontSize: FONT, lineHeight: LINE_H, color: TOK_COLOR[t.kind], fontWeight: t.kind === 'kw' ? 700 : 400, flexShrink: 0 }}>
                {t.text}
              </text>
            ),
          )}
        </div>
      ))}
    </div>
  )
})

function Button({ label, onClick, testId, primary, hint }: { label: string; onClick: () => void; testId?: string; primary?: boolean; hint?: string }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 28, paddingLeft: 12, paddingRight: 12, borderRadius: 7, cursor: 'pointer',
        backgroundColor: primary ? T.green : T.raised, borderWidth: 1, borderColor: primary ? T.green : T.border,
        hover: { backgroundColor: primary ? '#3fdc62' : T.hover },
      }}
    >
      <text style={{ fontSize: 12.5, fontWeight: 600, color: primary ? T.bg : T.fg }}>{label}</text>
      {hint && <text style={{ fontSize: 11.5, fontFamily: MONO, color: primary ? '#0a0c10a0' : T.muted }}>{hint}</text>}
    </div>
  )
}

function TabButton({ id, label, tab, setTab, badge }: { id: Tab; label: string; tab: Tab; setTab: (t: Tab) => void; badge?: string }) {
  const on = tab === id
  return (
    <div
      testId={`tab-${id}`}
      onClick={() => setTab(id)}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingLeft: 4, paddingRight: 4, cursor: 'pointer', borderBottomWidth: 2, borderColor: on ? T.blue : 'transparent' }}
    >
      <text style={{ fontSize: 12.5, fontWeight: on ? 600 : 500, color: on ? T.fg : T.dim }}>{label}</text>
      {badge && <text style={{ fontSize: 11, fontFamily: MONO, color: T.muted }}>{badge}</text>}
    </div>
  )
}

function Sidebar({ schema, deltas, expanded, toggle, open }: { schema: TableInfo[]; deltas: Record<string, number>; expanded: Set<string>; toggle: (n: string) => void; open: (n: string) => void }) {
  const tables = schema.filter((t) => t.kind === 'table')
  const views = schema.filter((t) => t.kind === 'view')
  const section = (title: string, items: TableInfo[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <text style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, paddingLeft: 10, paddingBottom: 4 }}>{title}</text>
      {items.map((t) => {
        const isOpen = expanded.has(t.name)
        const d = deltas[t.name]
        return (
          <div key={t.name} style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              testId={`table-${t.name}`}
              onClick={(e: EventPayload) => ((e.clickCount ?? 1) >= 2 ? open(t.name) : toggle(t.name))}
              style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 6, cursor: 'pointer', hover: { backgroundColor: T.hover } }}
            >
              <text style={{ fontSize: 10, color: T.muted, width: 10 }}>{isOpen ? '▾' : '▸'}</text>
              <text style={{ fontSize: 13, color: T.fg, flexGrow: 1, fontFamily: MONO }}>{t.name}</text>
              {d ? (
                <text testId={`delta-${t.name}`} style={{ fontSize: 11, fontFamily: MONO, color: d > 0 ? T.green : T.red, fontWeight: 700 }}>{`${d > 0 ? '+' : ''}${d}`}</text>
              ) : null}
              <text testId={`count-${t.name}`} style={{ fontSize: 11, fontFamily: MONO, color: T.muted }}>{t.rows == null ? 'view' : compact(t.rows)}</text>
            </div>
            {isOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 28, paddingBottom: 4 }}>
                {t.columns.map((c) => (
                  <div key={c.name} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 21, paddingRight: 10 }}>
                    <text style={{ fontSize: 12, fontFamily: MONO, color: c.pk ? T.yellow : T.dim, flexGrow: 1 }}>{c.pk ? `${c.name}  pk` : c.name}</text>
                    <text style={{ fontSize: 10.5, fontFamily: MONO, color: T.muted }}>{c.type.toLowerCase()}</text>
                  </div>
                ))}
                <div onClick={() => open(t.name)} style={{ height: 22, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <text style={{ fontSize: 11.5, color: T.blue }}>Open rows →</text>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
  return (
    <div testId="sidebar" style={{ width: 236, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 12, paddingLeft: 6, paddingRight: 6, borderRightWidth: 1, borderColor: T.border, overflow: 'scroll', scrollbarColor: '#ffffff22', scrollbarWidth: 6 }}>
      {section('TABLES', tables)}
      {views.length > 0 && section('VIEWS', views)}
    </div>
  )
}

const Grid = memo(function Grid({ res, order, widths, pageStart, start, sel, onPick, listRef, onVisibleRange, gen, fresh }: {
  res: QueryResult; order: Uint32Array | null; widths: number[]; pageStart: number; start: number; sel: [number, number] | null
  onPick: (r: number, c: number) => void; listRef: React.RefObject<PublicInstance | null>; onVisibleRange: (e: EventPayload) => void; gen: number; fresh: Set<unknown> | null
}) {
  const total = res.rows.length
  const count = Math.min(PAGE, total - pageStart)
  const end = Math.min(count, start + WINDOW)
  const rows = []
  for (let i = start; i < end; i++) {
    const vi = pageStart + i
    const ri = order ? order[vi]! : vi
    const row = res.rows[ri]!
    const isNew = !!fresh && fresh.has(row[0])
    rows.push(
      <div key={vi % WINDOW} testId={`row-${vi}`} style={{ display: 'flex', flexDirection: 'row', width: '100%', height: ROW_H, alignItems: 'center', backgroundColor: isNew ? '#26cd4d1f' : vi % 2 ? '#ffffff05' : 'transparent', hover: { backgroundColor: isNew ? '#26cd4d2c' : '#ffffff0d' } }}>
        <text style={{ width: GUTTER, flexShrink: 0, paddingRight: 12, textAlign: 'right', fontFamily: MONO, fontSize: 11.5, color: isNew ? T.green : T.muted }}>{String(vi + 1)}</text>
        {row.map((v, ci) => {
          const s = formatCell(v)
          const on = sel && sel[0] === ri && sel[1] === ci
          return (
            <div
              key={ci}
              testId={`cell-${vi}-${ci}`}
              onClick={() => onPick(ri, ci)}
              style={{ width: widths[ci] ?? 120, flexShrink: 0, height: ROW_H, paddingLeft: 10, paddingRight: 10, display: 'flex', alignItems: 'center', overflow: 'hidden', cursor: 'pointer', borderLeftWidth: 1, borderColor: on ? T.blue : T.border, backgroundColor: on ? T.blueSoft : 'transparent', borderWidth: on ? 1 : undefined }}
            >
              <text style={{ fontFamily: MONO, fontSize: 12.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: v === null ? T.muted : typeof v === 'number' ? T.cyan : T.fg }}>{s}</text>
            </div>
          )
        })}
      </div>,
    )
  }
  return (
    <virtual-list
      ref={listRef}
      key={gen}
      itemCount={count}
      windowStart={start}
      estimatedItemHeight={ROW_H}
      overdraw={ROW_H * 6}
      onVisibleRange={onVisibleRange}
      style={{ flexGrow: 1, minHeight: 0, scrollbarColor: '#ffffff30', scrollbarWidth: 8 }}
    >
      {rows}
    </virtual-list>
  )
})

function Inspector({ res, sel, onClose }: { res: QueryResult; sel: [number, number]; onClose: () => void }) {
  const [ri, ci] = sel
  const row = res.rows[ri]
  if (!row) return null
  const v = row[ci]
  const s = formatCell(v)
  let json: string | null = null
  if (typeof v === 'string' && /^[[{]/.test(v.trim())) {
    try { json = JSON.stringify(JSON.parse(v), null, 2) } catch {}
  }
  const type = v === null ? 'NULL' : typeof v === 'number' ? (Number.isInteger(v) ? 'INTEGER' : 'REAL') : v instanceof Uint8Array ? 'BLOB' : 'TEXT'
  return (
    <div testId="inspector" style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeftWidth: 1, borderColor: T.border, backgroundColor: T.panel }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 40, paddingLeft: 14, paddingRight: 8, gap: 8, borderBottomWidth: 1, borderColor: T.border }}>
        <text style={{ fontSize: 13, fontWeight: 600, color: T.fg, flexGrow: 1 }}>Cell</text>
        <text style={{ fontSize: 11, fontFamily: MONO, color: T.muted }}>{`row ${ri + 1}`}</text>
        <div testId="inspector-close" onClick={onClose} style={{ width: 24, height: 24, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', hover: { backgroundColor: T.hover } }}>
          <text style={{ fontSize: 13, color: T.dim }}>✕</text>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderBottomWidth: 1, borderColor: T.border }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <text testId="inspector-column" style={{ fontSize: 13, fontFamily: MONO, color: T.blue, fontWeight: 600 }}>{res.columns[ci] ?? ''}</text>
          <div style={{ paddingLeft: 6, paddingRight: 6, height: 18, borderRadius: 4, backgroundColor: T.raised, display: 'flex', alignItems: 'center' }}>
            <text style={{ fontSize: 10, fontFamily: MONO, color: T.dim }}>{type}</text>
          </div>
        </div>
        {json ? (
          <code language="json" style={{ fontSize: 12, maxHeight: 220 }}>{json}</code>
        ) : (
          <text testId="inspector-value" style={{ fontSize: 15, fontFamily: MONO, color: T.fg, userSelect: 'text' }}>{s}</text>
        )}
      </div>
      <text style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, paddingLeft: 14, paddingTop: 12, paddingBottom: 6 }}>ROW</text>
      <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 14, paddingRight: 14, overflow: 'scroll', flexGrow: 1, minHeight: 0 }}>
        {res.columns.map((c, i) => (
          <div key={c + i} style={{ display: 'flex', flexDirection: 'row', gap: 10, minHeight: 22, alignItems: 'center' }}>
            <text style={{ width: 110, flexShrink: 0, fontSize: 12, fontFamily: MONO, color: i === ci ? T.blue : T.muted }}>{c}</text>
            <text style={{ fontSize: 12, fontFamily: MONO, color: T.fg, whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexGrow: 1, flexBasis: 0, minWidth: 0 }}>{formatCell(row[i])}</text>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlanView({ plan, sql }: { plan: PlanRow[] | null; sql: string }) {
  if (!plan) return <Empty text="Explain a query to see its plan" />
  const depth = new Map<number, number>([[0, -1]])
  return (
    <div testId="plan" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 18, flexGrow: 1 }}>
      <text style={{ fontSize: 11, fontFamily: MONO, color: T.muted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{`EXPLAIN QUERY PLAN ${sql.replace(/\s+/g, ' ').trim()}`}</text>
      {plan.map((p) => {
        const d = (depth.get(p.parent) ?? -1) + 1
        depth.set(p.id, d)
        const scan = /^SCAN/.test(p.detail) && !/COVERING|USING INDEX/.test(p.detail)
        const color = scan ? T.yellow : /^SEARCH|USING.*INDEX/.test(p.detail) ? T.green : /TEMP B-TREE/.test(p.detail) ? T.red : T.fg
        return (
          <div key={p.id} testId={`plan-${p.id}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: d * 22, height: 28 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
            <text style={{ fontSize: 13.5, fontFamily: MONO, color }}>{p.detail}</text>
            {scan && <text style={{ fontSize: 11.5, color: T.muted }}>full table scan</text>}
          </div>
        )
      })}
    </div>
  )
}

function ChartView({ res }: { res: QueryResult | null }) {
  const [hover, setHover] = useState(-1)
  if (!res || !res.rows.length) return <Empty text="Run a query to chart it" />
  const first = res.rows[0]!
  const valCol = first.findIndex((v, i) => typeof v === 'number' && i > 0 && !/id$/i.test(res.columns[i] ?? '')) // prefer a measure
  const vi = valCol >= 0 ? valCol : first.findIndex((v) => typeof v === 'number')
  const li = first.findIndex((v, i) => i !== vi && typeof v === 'string')
  if (vi < 0) return <Empty text="Chart needs a numeric column" />
  const data = res.rows.slice(0, 160)
  const vals = data.map((r) => Number(r[vi]) || 0)
  const max = Math.max(...vals, 1)
  const label = (i: number) => (li >= 0 ? formatCell(data[i]![li]) : `#${i + 1}`)
  const h = hover >= 0 ? hover : vals.length - 1
  return (
    <div testId="chart" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 18, gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        <text style={{ fontSize: 12, color: T.muted, fontFamily: MONO }}>{`${res.columns[vi]}${li >= 0 ? ` by ${res.columns[li]}` : ''}`}</text>
        <text testId="chart-readout" style={{ fontSize: 20, fontWeight: 600, color: T.fg, fontFamily: MONO }}>{fmtN(vals[h] ?? 0)}</text>
        <text style={{ fontSize: 12, color: T.blue, fontFamily: MONO }}>{label(h)}</text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 2, flexGrow: 1, minHeight: 0, borderBottomWidth: 1, borderColor: T.borderStrong }} onMouseLeave={() => setHover(-1)}>
        {vals.map((v, i) => (
          <div key={i} onMouseEnter={() => setHover(i)} style={{ flexGrow: 1, flexBasis: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <div style={{ height: `${Math.max(0.5, (v / max) * 100)}%`, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: i === h ? T.green : T.blue, opacity: i === h ? 1 : 0.75 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
        <text style={{ fontSize: 11, color: T.muted, fontFamily: MONO }}>{label(0)}</text>
        <text style={{ fontSize: 11, color: T.muted, fontFamily: MONO }}>{label(vals.length - 1)}</text>
      </div>
    </div>
  )
}

function HistoryView({ items, pick }: { items: HistoryItem[]; pick: (s: string) => void }) {
  if (!items.length) return <Empty text="Queries you run show up here" />
  return (
    <div testId="history" style={{ display: 'flex', flexDirection: 'column', padding: 10, gap: 2, overflow: 'scroll', flexGrow: 1 }}>
      {items.map((h, i) => (
        <div key={h.at + ':' + i} testId={`history-${i}`} onClick={() => pick(h.sql)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, height: 30, paddingLeft: 10, paddingRight: 10, borderRadius: 6, cursor: 'pointer', hover: { backgroundColor: T.hover } }}>
          <text style={{ fontSize: 11, fontFamily: MONO, color: T.muted, width: 64 }}>{new Date(h.at).toTimeString().slice(0, 8)}</text>
          <text style={{ fontSize: 12.5, fontFamily: MONO, color: h.error ? T.red : T.fg, flexGrow: 1, flexBasis: 0, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{h.sql.replace(/\s+/g, ' ').trim()}</text>
          <text style={{ fontSize: 11.5, fontFamily: MONO, color: T.dim }}>{h.error ? 'error' : `${fmtN(h.rows)} rows · ${fmtMs(h.ms)}`}</text>
        </div>
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <text style={{ fontSize: 13, color: T.muted }}>{text}</text>
    </div>
  )
}

function autoWidths(res: QueryResult): number[] {
  return res.columns.map((c, ci) => {
    let w = c.length
    for (let r = 0; r < Math.min(200, res.rows.length); r++) w = Math.max(w, formatCell(res.rows[r]![ci]).length)
    return Math.round(Math.min(320, Math.max(64, w * 7.6 + 30)))
  })
}

export const DEFAULT_SQL = `SELECT c.country, COUNT(*) AS orders, ROUND(SUM(o.total), 2) AS revenue
FROM orders o JOIN customers c ON c.id = o.customer_id
GROUP BY c.country
ORDER BY revenue DESC;`

export function SqApp({ db, initialSql, pollMs = 250 }: { db: SqDb; initialSql?: string; pollMs?: number }) {
  const renderer = useGpuixRequired()
  const term = isTerminal()
  // Ghostty keeps ⌘↵, ⌘A and ⌘1–9 for itself, so the terminal build uses ⌃.
  const MOD = term ? '⌃' : '⌘'
  const [schema, setSchema] = useState<TableInfo[]>(() => db.schema())
  const [sql, setSql] = useState(initialSql || DEFAULT_SQL)
  const [caret, setCaret] = useState((initialSql || DEFAULT_SQL).length)
  const [res, setRes] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('results')
  const [plan, setPlan] = useState<PlanRow[] | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null)
  const [widths, setWidths] = useState<number[]>([])
  const [sel, setSel] = useState<[number, number] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['orders']))
  const [deltas, setDeltas] = useState<Record<string, number>>({})
  const [live, setLive] = useState<{ at: number; text: string } | null>(null)
  const [fresh, setFresh] = useState<Set<unknown> | null>(null)
  const [pageStart, setPageStart] = useState(0)
  const [start, setStart] = useState(0)
  const [gen, setGen] = useState(0)
  const [compIdx, setCompIdx] = useState(0)
  const [dismissed, setDismissed] = useState('')
  const listRef = useRef<PublicInstance | null>(null)
  const editorRef = useRef<PublicInstance | null>(null)
  const lastRun = useRef<string>('')
  const prevSql = useRef(sql)
  const resRef = useRef(res)
  resRef.current = res
  const drag = useRef<{ col: number; x: number; w: number } | null>(null)

  const execute = useCallback((text: string, opts: { silent?: boolean; keepView?: boolean } = {}) => {
    const q = text.trim()
    if (!q) return
    try {
      const r = db.run(q)
      if (!r.isSelect) {
        setSchema(db.schema())
        setHistory((h) => [{ sql: q, rows: r.changes, ms: r.ms, at: Date.now() }, ...h].slice(0, 200))
        setLive({ at: Date.now(), text: `${fmtN(r.changes)} row${r.changes === 1 ? '' : 's'} changed` })
        if (lastRun.current) execute(lastRun.current, { silent: true, keepView: true })
        return
      }
      const prev = resRef.current
      let grew: Set<unknown> | null = null
      if (opts.keepView && prev && prev.sql === r.sql && r.rows.length <= 200_000) {
        const seen = new Set(prev.rows.map((row) => row[0]))
        grew = new Set(r.rows.filter((row) => !seen.has(row[0])).map((row) => row[0]))
        if (!grew.size) grew = null
      }
      lastRun.current = q
      setRes(r)
      setError(null)
      if (!opts.keepView) {
        setWidths(autoWidths(r))
        setSort(null)
        setSel(null)
        setPageStart(0)
        setStart(0)
        setGen((g) => g + 1)
        setFresh(null)
      } else if (grew) {
        setFresh(grew)
      }
      if (!opts.silent) {
        setHistory((h) => [{ sql: q, rows: r.rows.length, ms: r.ms, at: Date.now() }, ...h].slice(0, 200))
        setTab((t) => (t === 'history' || t === 'plan' ? 'results' : t))
        try { setPlan(db.plan(q)) } catch { setPlan(null) }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      if (!opts.silent) setHistory((h) => [{ sql: q, rows: 0, ms: 0, at: Date.now(), error: msg }, ...h].slice(0, 200))
    }
  }, [db])

  useEffect(() => { execute(sql) }, [])

  // Live refresh: PRAGMA data_version changes when another connection commits.
  useEffect(() => {
    const id = setInterval(() => {
      let next: TableInfo[]
      try {
        if (!db.changedExternally()) return
        next = db.schema()
      } catch {
        return // file briefly locked or gone; try again next tick
      }
      const before = new Map(schema.map((t) => [t.name, t.rows ?? 0]))
      const d: Record<string, number> = {}
      for (const t of next) if (t.rows != null && before.has(t.name) && t.rows !== before.get(t.name)) d[t.name] = t.rows - before.get(t.name)!
      setSchema(next)
      const changed = Object.keys(d)
      if (changed.length) {
        setDeltas(d)
        setLive({ at: Date.now(), text: changed.map((n) => `${n} ${d[n]! > 0 ? '+' : ''}${fmtN(d[n]!)}`).join(' · ') })
      } else {
        // WAL checkpoints and in-place updates change the file without changing counts.
        setLive((l) => (l && Date.now() - l.at < 4000 ? l : { at: Date.now(), text: 'database changed' }))
      }
      if (lastRun.current) execute(lastRun.current, { silent: true, keepView: true })
    }, pollMs)
    return () => clearInterval(id)
  }, [db, schema, execute, pollMs])

  useEffect(() => {
    if (!live) return
    const id = setTimeout(() => { setDeltas({}); setFresh(null) }, 6000)
    return () => clearTimeout(id)
  }, [live])

  const order = useMemo(() => {
    if (!res || !sort) return null
    const n = res.rows.length
    const idx = new Uint32Array(n)
    for (let i = 0; i < n; i++) idx[i] = i
    const c = sort.col
    const s = sort.desc ? -1 : 1
    const arr = Array.from(idx)
    arr.sort((a, b) => {
      const x = res.rows[a]![c] as number | string | null
      const y = res.rows[b]![c] as number | string | null
      if (x === y) return a - b
      if (x === null) return 1
      if (y === null) return -1
      return (x < y ? -1 : 1) * s
    })
    return Uint32Array.from(arr)
  }, [res, sort])

  const word = useMemo(() => wordAt(sql, caret), [sql, caret])
  const completions: Completion[] = useMemo(() => (word.word.length >= 2 && word.word !== dismissed ? complete(word.word, schema) : []), [word, schema, dismissed])
  const accept = (c: Completion) => {
    const next = sql.slice(0, word.start) + c.label + sql.slice(caret)
    prevSql.current = next
    setSql(next)
    setCaret(word.start + c.label.length)
    setCompIdx(0)
  }

  const onEdit = (e: EventPayload) => {
    const next = e.value ?? ''
    const prev = prevSql.current
    let i = 0
    while (i < prev.length && i < next.length && prev[i] === next[i]) i++
    let j = 0
    while (j < prev.length - i && j < next.length - i && prev[prev.length - 1 - j] === next[next.length - 1 - j]) j++
    prevSql.current = next
    setSql(next)
    setCaret(next.length - j)
    setCompIdx(0)
  }

  const runNow = () => {
    let q = prevSql.current
    execute(q)
  }
  const explain = () => {
    try { setPlan(db.plan(prevSql.current.trim().replace(/;\s*$/, ''))); setError(null) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setTab('plan')
  }

  windowHandlers.onKeyDown = (e: KeyEvent) => {
    const k = e.key
    const m = e.modifiers
    const mod = !!(m?.cmd || m?.ctrl)
    if (mod && (k === 'enter' || k === 'r')) {
      // ⌘↵ may already have inserted a newline at the caret; drop it again.
      const cur = prevSql.current
      if (k === 'enter' && cur.endsWith('\n') && !sql.endsWith('\n')) { prevSql.current = sql }
      e.preventDefault()
      runNow()
    } else if (mod && k === 'l') {
      e.preventDefault()
      prevSql.current = ''
      setSql('')
      setCaret(0)
      if (editorRef.current) renderer.focusElement?.(editorRef.current.id)
    } else if (mod && k === 'e') {
      e.preventDefault()
      explain()
    } else if (mod && ['1', '2', '3', '4'].includes(k ?? '')) {
      setTab((['results', 'plan', 'chart', 'history'] as Tab[])[Number(k) - 1]!)
    } else if (k === 'escape') {
      if (completions.length) setDismissed(word.word)
      else setSel(null)
    }
  }

  const onEditorKey = (e: KeyEvent) => {
    if (e.key === 'tab' && completions.length) {
      e.preventDefault()
      accept(completions[Math.min(compIdx, completions.length - 1)]!)
    } else if (e.key === 'down' && completions.length) {
      e.preventDefault()
      setCompIdx((i) => (i + 1) % completions.length)
    } else if (e.key === 'up' && completions.length) {
      e.preventDefault()
      setCompIdx((i) => (i - 1 + completions.length) % completions.length)
    }
  }

  const openTable = (name: string) => {
    const q = `SELECT * FROM ${/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : quoteIdent(name)};`
    prevSql.current = q
    setSql(q)
    setCaret(q.length)
    execute(q)
  }

  const onVisibleRange = useCallback((e: EventPayload) => {
    const si = Math.floor(e.startIndex ?? 0)
    const ei = Math.floor(e.endIndex ?? 0)
    setStart((cur) => (si < cur + 4 || ei > cur + WINDOW - 4 ? Math.max(0, si - LEAD) : cur))
  }, [])

  const total = res?.rows.length ?? 0
  const pageEnd = Math.min(total, pageStart + PAGE)
  const goPage = (d: number) => {
    const n = Math.max(0, Math.min(Math.floor((total - 1) / PAGE) * PAGE, pageStart + d * PAGE))
    setPageStart(n)
    setStart(0)
    setGen((g) => g + 1)
  }
  const toggleSort = (c: number) => {
    setSort((s) => (s?.col === c ? (s.desc ? null : { col: c, desc: true }) : { col: c, desc: false }))
    setPageStart(0)
    setStart(0)
    setGen((g) => g + 1)
  }

  const lines = sql.split('\n')
  const caretLine = sql.slice(0, caret).split('\n').length - 1
  const caretCol = caret - (sql.lastIndexOf('\n', caret - 1) + 1)
  const editorH = Math.max(4, Math.min(9, lines.length + 1)) * LINE_H + PAD * 2
  const liveAge = live ? Date.now() - live.at : Infinity

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: T.bg }}>
      {/* top bar */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, height: 40, flexShrink: 0, paddingLeft: term ? 14 : 84, paddingRight: 14, borderBottomWidth: 1, borderColor: T.border }}>
        <text style={{ fontSize: 15, fontWeight: 800, color: T.green, fontFamily: MONO }}>sq</text>
        <text testId="db-name" style={{ fontSize: 13, color: T.fg, fontFamily: MONO }}>{db.path.split('/').pop() ?? db.path}</text>
        <text style={{ fontSize: 12, color: T.muted }}>{`${schema.filter((t) => t.kind === 'table').length} tables · ${fmtN(schema.reduce((a, t) => a + (t.rows ?? 0), 0))} rows`}</text>
        <div style={{ flexGrow: 1 }} />
        {live && liveAge < 6000 && (
          <div testId="live-badge" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 24, paddingLeft: 10, paddingRight: 10, borderRadius: 12, backgroundColor: '#26cd4d22', borderWidth: 1, borderColor: '#26cd4d66' }}>
            <text style={{ fontSize: 11.5, fontWeight: 700, color: T.green }}>LIVE</text>
            <text testId="live-text" style={{ fontSize: 11.5, fontFamily: MONO, color: T.fg }}>{live.text}</text>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: T.green }} />
          <text style={{ fontSize: 11.5, color: T.dim }}>watching</text>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <Sidebar schema={schema} deltas={deltas} expanded={expanded} toggle={(n) => setExpanded((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x })} open={openTable} />
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          {/* editor */}
          <div style={{ position: 'relative', height: editorH, flexShrink: 0, borderBottomWidth: 1, borderColor: T.border, backgroundColor: T.panel }}>
            <Highlight src={sql} />
            <textarea
              ref={editorRef}
              testId="editor"
              value={sql}
              onChange={onEdit}
              onKeyDown={onEditorKey}
              theme={{ caret: T.blue }}
              style={{ position: 'absolute', left: PAD, top: PAD, right: PAD, bottom: PAD, fontFamily: MONO, fontSize: FONT, lineHeight: LINE_H, color: '#00000000', backgroundColor: 'transparent', borderWidth: 0, padding: 0 }}
            />
            {completions.length > 0 && (
              <div testId="completions" style={{ position: 'absolute', left: PAD + Math.max(0, caretCol - word.word.length) * CW - 8, top: PAD + (caretLine + 1) * LINE_H + 2, width: 300, display: 'flex', flexDirection: 'column', padding: 4, borderRadius: 8, backgroundColor: T.raised, borderWidth: 1, borderColor: T.borderStrong, boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: '#000000a0' } }}>
                {completions.map((c, i) => (
                  <div key={`${c.kind}:${c.label}:${i}`} testId={`completion-${i}`} onClick={() => accept(c)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 5, cursor: 'pointer', backgroundColor: i === compIdx ? T.blueSoft : 'transparent', hover: { backgroundColor: T.hover } }}>
                    <text style={{ fontSize: 10, fontWeight: 700, width: 14, color: c.kind === 'column' ? T.cyan : c.kind === 'keyword' ? T.red : T.yellow, fontFamily: MONO }}>{c.kind === 'column' ? 'c' : c.kind === 'keyword' ? 'k' : 't'}</text>
                    <text style={{ fontSize: 13, fontFamily: MONO, color: T.fg, flexGrow: 1 }}>{c.label}</text>
                    <text style={{ fontSize: 11, fontFamily: MONO, color: T.muted }}>{c.detail}</text>
                  </div>
                ))}
              </div>
            )}
            <div style={{ position: 'absolute', right: 12, bottom: 10, display: 'flex', flexDirection: 'row', gap: 8 }}>
              <Button testId="explain" label="Explain" hint={`${MOD}E`} onClick={explain} />
              <Button testId="run" label="Run" hint={`${MOD}↵`} primary onClick={runNow} />
            </div>
          </div>
          {/* tabs */}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 18, height: 36, flexShrink: 0, paddingLeft: 14, paddingRight: 14, borderBottomWidth: 1, borderColor: T.border }}>
            <TabButton id="results" label="Results" tab={tab} setTab={setTab} badge={res ? compact(res.rows.length) : undefined} />
            <TabButton id="plan" label="Plan" tab={tab} setTab={setTab} />
            <TabButton id="chart" label="Chart" tab={tab} setTab={setTab} />
            <TabButton id="history" label="History" tab={tab} setTab={setTab} badge={history.length ? String(history.length) : undefined} />
            <div style={{ flexGrow: 1 }} />
            {res && !error && (
              <text testId="status" style={{ fontSize: 12, fontFamily: MONO, color: T.dim }}>{`${fmtN(res.rows.length)} rows${res.truncated ? '+' : ''} · ${res.columns.length} cols · ${fmtMs(res.ms)}`}</text>
            )}
          </div>
          {error && (
            <div testId="error" style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center', paddingLeft: 14, paddingRight: 14, height: 34, flexShrink: 0, backgroundColor: '#ff949218', borderBottomWidth: 1, borderColor: '#ff949244' }}>
              <text style={{ fontSize: 12, fontWeight: 700, color: T.red }}>Error</text>
              <text testId="error-text" style={{ fontSize: 12.5, fontFamily: MONO, color: T.fg, whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexGrow: 1, flexBasis: 0, minWidth: 0 }}>{error}</text>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
            <div
              onMouseMove={(e: EventPayload) => {
                const d = drag.current
                if (!d) return
                if (!e.pressedButton) { drag.current = null; return }
                const w = Math.max(48, Math.round(d.w + (e.x ?? 0) - d.x))
                setWidths((ws) => { const n = ws.slice(); n[d.col] = w; return n })
              }}
              onMouseUp={() => { drag.current = null }}
              style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0 }}
            >
              {tab === 'results' && res && (
                <>
                  <div testId="grid-header" style={{ display: 'flex', flexDirection: 'row', height: 30, flexShrink: 0, alignItems: 'center', borderBottomWidth: 1, borderColor: T.borderStrong, backgroundColor: T.panel, overflow: 'hidden' }}>
                    <div style={{ width: GUTTER, flexShrink: 0 }} />
                    {res.columns.map((c, ci) => (
                      <div key={c + ci} style={{ width: widths[ci] ?? 120, flexShrink: 0, height: 30, display: 'flex', flexDirection: 'row', alignItems: 'center', borderLeftWidth: 1, borderColor: T.border }}>
                        <div testId={`col-${c}`} onClick={() => toggleSort(ci)} style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 30, paddingLeft: 10, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, cursor: 'pointer', hover: { backgroundColor: T.hover } }}>
                          <text style={{ fontSize: 12, fontWeight: 600, fontFamily: MONO, color: sort?.col === ci ? T.blue : T.fg, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c}</text>
                          {sort?.col === ci && <text testId="sort-arrow" style={{ fontSize: 10, color: T.blue }}>{sort.desc ? '▼' : '▲'}</text>}
                        </div>
                        <div
                          testId={`resize-${c}`}
                          onMouseDown={(e: EventPayload) => { drag.current = { col: ci, x: e.x ?? 0, w: widths[ci] ?? 120 } }}
                          style={{ width: 7, height: 30, cursor: 'col-resize', hover: { backgroundColor: '#71b7ff55' } }}
                        />
                      </div>
                    ))}
                  </div>
                  <Grid res={res} order={order} widths={widths} pageStart={pageStart} start={start} sel={sel} onPick={(r, c) => setSel([r, c])} listRef={listRef} onVisibleRange={onVisibleRange} gen={gen} fresh={fresh} />
                  {total > PAGE && (
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 30, flexShrink: 0, paddingLeft: 14, paddingRight: 10, borderTopWidth: 1, borderColor: T.border }}>
                      <text testId="page-label" style={{ fontSize: 11.5, fontFamily: MONO, color: T.dim, flexGrow: 1 }}>{`rows ${fmtN(pageStart + 1)}–${fmtN(pageEnd)} of ${fmtN(total)}`}</text>
                      <Button testId="page-prev" label="‹" onClick={() => goPage(-1)} />
                      <Button testId="page-next" label="›" onClick={() => goPage(1)} />
                    </div>
                  )}
                </>
              )}
              {tab === 'results' && !res && <Empty text="Run a query" />}
              {tab === 'plan' && <PlanView plan={plan} sql={lastRun.current || sql} />}
              {tab === 'chart' && <ChartView res={res} />}
              {tab === 'history' && <HistoryView items={history} pick={(q) => { prevSql.current = q; setSql(q); setCaret(q.length); execute(q) }} />}
            </div>
            {sel && res && tab === 'results' && <Inspector res={res} sel={sel} onClose={() => setSel(null)} />}
          </div>
        </div>
      </div>
      {/* footer */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, height: 26, flexShrink: 0, paddingLeft: 14, paddingRight: 14, borderTopWidth: 1, borderColor: T.border, backgroundColor: T.panel }}>
        {[[`${MOD}↵`, 'run'], [`${MOD}E`, 'explain'], ['tab', 'complete'], [`${MOD}L`, 'clear'], [`${MOD}1–4`, 'tabs'], ...(term ? [['⌃C', 'quit']] : [])].map(([k, l]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <text style={{ fontSize: 11, fontFamily: MONO, color: T.fg }}>{k}</text>
            <text style={{ fontSize: 11, color: T.muted }}>{l}</text>
          </div>
        ))}
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 11, fontFamily: MONO, color: T.muted }}>{`Ln ${caretLine + 1}, Col ${caretCol + 1}`}</text>
      </div>
    </div>
  )
}
