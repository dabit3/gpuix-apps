import { readFileSync, unwatchFile, watchFile, writeFileSync } from 'node:fs'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { isTerminal, useGpuix, useWindowSize } from '@gpuix/react'
import type { EventPayload } from '@gpuix/native'
import {
  type Json, type Row, type Seg, countNodes, flatten, formatBytes, getAt, isContainer, jqPath, leafText,
  pathKey, readSource, searchPaths, summary,
} from './json'
import { runQuery } from './query'
import { inferSchema, schemaRows } from './schema'
import { type DiffRow, diffJson } from './diff'
import { KIND_COLOR, MONO, T } from './theme'

export type Doc = { name: string; bytes: number; root: Json; path?: string }

type Instance = { id: number }

export const ROW_H = 22
const HEADER_H = 44
const FILTER_H = 42
const CRUMB_H = 30
const STATUS_H = 30
const SEARCH_H = 38
const SCHEMA_W = 360
const FS = 13

const FONT_FILES = ['JetBrainsMono-Regular.ttf', 'JetBrainsMono-Medium.ttf', 'JetBrainsMono-Bold.ttf']

/** Copy to the system clipboard: OSC 52 straight to the tty inside a terminal, pbcopy in a window. */
export function copyText(text: string) {
  if (isTerminal()) {
    try {
      writeFileSync('/dev/tty', `\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`)
      return
    } catch {}
  }
  try {
    Bun.spawn(['pbcopy'], { stdin: new Blob([text]) })
  } catch {}
}

/** Open the root, then follow objects down to the first collection so the data shows on launch. */
function defaultExpanded(root: Json): Set<string> {
  const s = new Set<string>()
  let cur: Json = root
  let path: Seg[] = []
  for (let depth = 0; depth < 6 && isContainer(cur); depth++) {
    s.add(pathKey(path))
    if (Array.isArray(cur)) {
      if (cur.length && isContainer(cur[0])) s.add(pathKey([...path, 0]))
      break
    }
    const obj: Record<string, Json> = cur
    const keys = Object.keys(obj)
    let next: string | undefined
    let best = 0
    for (const k of keys) {
      const n = isContainer(obj[k]) ? countNodes(obj[k]!) : 0
      if (n > best) { best = n; next = k }
    }
    if (next === undefined || (keys.length > 4 && !Array.isArray(obj[next]))) break
    for (const k of keys) if (isContainer(obj[k]) && keys.length <= 4 && k !== next && sizeOfSmall(obj[k])) s.add(pathKey([...path, k]))
    path = [...path, next]
    cur = obj[next]!
  }
  return s
}

const sizeOfSmall = (v: Json) => isContainer(v) && Object.keys(v).length <= 3

export type AppProps = {
  docs: Doc[]
  watch?: boolean
  initialFilter?: string
  initialSearch?: string
  onCopy?: (text: string) => void
}

export function App({ docs: initialDocs, watch = false, initialFilter = '', initialSearch = '', onCopy }: AppProps): ReactElement {
  const ctx = useGpuix()
  const renderer = ctx.renderer
  const size = useWindowSize()
  const W = size.width || 1280, H = size.height || 800
  const term = isTerminal()

  useEffect(() => {
    for (const f of FONT_FILES) {
      try { renderer?.registerFont?.(readFileSync(new URL(`../assets/${f}`, import.meta.url))) } catch {}
    }
  }, [renderer])

  const [docs, setDocs] = useState(initialDocs)
  const diffMode = docs.length === 2
  const doc = docs[0]!

  const rootRef = useRef<Instance | null>(null)
  const filterRef = useRef<Instance | null>(null)
  const searchRef = useRef<Instance | null>(null)
  const focusRoot = useCallback(() => { if (rootRef.current) renderer?.focusElement?.(rootRef.current.id) }, [renderer])

  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'info' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = useCallback((text: string, tone: 'ok' | 'info' = 'ok') => {
    setToast({ text, tone })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }, [])

  // --- filter ---------------------------------------------------------------------------
  const [filter, setFilter] = useState(initialFilter)
  const query = useMemo(() => {
    const src = filter.trim()
    if (!src || src === '.') return { root: doc.root, count: null as number | null, error: null as string | null, ms: 0 }
    const t0 = performance.now()
    try {
      const out = runQuery(src, doc.root)
      return { root: (out.length === 1 ? out[0]! : out) as Json, count: out.length, error: null, ms: performance.now() - t0 }
    } catch (e) {
      return { root: doc.root, count: null, error: (e as Error).message, ms: 0 }
    }
  }, [filter, doc.root])
  const view = query.root

  const nodeCount = useMemo(() => countNodes(doc.root), [doc.root])

  // --- tree -----------------------------------------------------------------------------
  const [expanded, setExpanded] = useState(() => defaultExpanded(initialDocs[0]!.root))
  const viewKey = query.error ? '' : filter.trim()
  const prevViewKey = useRef(viewKey)
  useEffect(() => {
    if (prevViewKey.current === viewKey) return
    prevViewKey.current = viewKey
    setExpanded(defaultExpanded(view))
    setCursor(0)
    setTop(0)
  }, [viewKey, view])

  const rows = useMemo(() => flatten(view, expanded), [view, expanded])
  const [cursor, setCursor] = useState(0)
  const [top, setTop] = useState(0)
  const [hover, setHover] = useState(-1)
  const [showSchema, setShowSchema] = useState(true)

  const searchOpen = useRef(false)
  const [search, setSearch] = useState(initialSearch)
  const [searchActive, setSearchActive] = useState(!!initialSearch)
  searchOpen.current = searchActive

  const schemaVisible = showSchema && !diffMode && W >= 860
  const bodyH = H - HEADER_H - (diffMode ? 0 : FILTER_H + CRUMB_H) - STATUS_H - (searchActive ? SEARCH_H : 0)
  const visible = Math.max(1, Math.floor(bodyH / ROW_H))

  const curRow: Row | undefined = rows[Math.min(cursor, rows.length - 1)]

  const reveal = useCallback((idx: number, total: number, center = false) => {
    setTop((t) => {
      const maxTop = Math.max(0, total - visible)
      if (center) return Math.max(0, Math.min(maxTop, idx - Math.floor(visible / 2)))
      if (idx < t) return idx
      if (idx >= t + visible) return Math.min(maxTop, idx - visible + 1)
      return Math.min(t, maxTop)
    })
  }, [visible])

  const moveTo = useCallback((idx: number, total = rows.length) => {
    const i = Math.max(0, Math.min(total - 1, idx))
    setCursor(i)
    reveal(i, total)
  }, [rows.length, reveal])

  const toggle = useCallback((row: Row | undefined, open?: boolean) => {
    if (!row || !isContainer(row.value)) return
    const k = pathKey(row.path)
    setExpanded((s) => {
      const n = new Set(s)
      const want = open ?? !n.has(k)
      want ? n.add(k) : n.delete(k)
      return n
    })
  }, [])

  const expandDeep = useCallback((row: Row | undefined) => {
    if (!row || !isContainer(row.value)) return
    const add: string[] = []
    const walk = (v: Json, p: Seg[]) => {
      if (add.length > 3000 || !isContainer(v)) return
      add.push(pathKey(p))
      if (Array.isArray(v)) v.forEach((c, i) => walk(c, [...p, i]))
      else for (const k in v) walk(v[k], [...p, k])
    }
    walk(row.value, row.path)
    setExpanded((s) => new Set([...s, ...add]))
    flash(`Expanded ${add.length.toLocaleString()} nodes`, 'info')
  }, [flash])

  // --- search ---------------------------------------------------------------------------
  const matches = useMemo(() => (search.trim().length >= 2 ? searchPaths(view, search.trim()) : []), [view, search])
  const [matchIdx, setMatchIdx] = useState(-1)
  useEffect(() => { setMatchIdx(-1) }, [matches])

  const goToPath = useCallback((path: Seg[]) => {
    const add = path.map((_, i) => pathKey(path.slice(0, i)))
    const next = new Set([...expanded, ...add])
    setExpanded(next)
    const r = flatten(view, next)
    const k = pathKey(path)
    const idx = r.findIndex((row) => pathKey(row.path) === k)
    if (idx >= 0) { setCursor(idx); reveal(idx, r.length, true) }
  }, [expanded, view, reveal])

  const stepMatch = useCallback((dir: 1 | -1) => {
    if (!matches.length) return
    const i = (matchIdx + dir + matches.length) % matches.length
    setMatchIdx(i)
    goToPath(matches[i]!)
  }, [matches, matchIdx, goToPath])

  // --- schema ---------------------------------------------------------------------------
  const schema = useMemo(() => {
    if (!schemaVisible) return null
    const node = inferSchema(view)
    return { rows: schemaRows(node), label: Array.isArray(view) ? `${view.length.toLocaleString()} × ${view.length ? (isContainer(view[0]) ? (Array.isArray(view[0]) ? 'array' : 'object') : typeof view[0]) : 'empty'}` : summary(view) || typeof view }
  }, [view, schemaVisible])
  const [schemaTop, setSchemaTop] = useState(0)

  // --- diff -----------------------------------------------------------------------------
  const diff = useMemo(() => (diffMode ? diffJson(docs[0]!.root, docs[1]!.root) : null), [diffMode, docs])
  const diffRows: DiffRow[] = diff?.rows ?? []
  const changeIdx = useMemo(() => diffRows.flatMap((r, i) => (r.status !== 'same' && r.status !== 'open' ? [i] : [])), [diffRows])

  // --- live reload ----------------------------------------------------------------------
  const [reloaded, setReloaded] = useState<{ at: string; keys: Set<string>; pending?: boolean } | null>(null)
  const docsRef = useRef(docs)
  docsRef.current = docs
  useEffect(() => {
    if (!watch) return
    const paths = docsRef.current.map((d) => d.path).filter((p): p is string => !!p)
    const handlers = paths.map((p, i) => {
      const h = () => {
        try {
          const src = readSource(p)
          const root = JSON.parse(src.text) as Json
          const prev = docsRef.current[i]!
          const d = diffJson(prev.root, root)
          if (!d.stats.added && !d.stats.changed && !d.stats.removed) return
          setDocs((ds) => ds.map((x, j) => (j === i ? { ...x, root, bytes: src.bytes } : x)))
          setReloaded({ at: new Date().toLocaleTimeString([], { hour12: false }), keys: new Set(), pending: true })
          const n = d.stats.added + d.stats.changed + d.stats.removed
          flash(`Reloaded ${src.name} · ${n.toLocaleString()} ${n === 1 ? 'change' : 'changes'}`)
        } catch {}
      }
      watchFile(p, { interval: 250 }, h)
      return [p, h] as const
    })
    return () => { for (const [p, h] of handlers) unwatchFile(p, h) }
  }, [watch, flash])
  // Highlight what changed in the current view (filtered or not) after a reload.
  const prevView = useRef(view)
  useEffect(() => {
    const before = prevView.current
    prevView.current = view
    if (!reloaded?.pending || before === view) return
    const d = diffJson(before, view)
    const keys = new Set(d.rows.filter((r) => r.status === 'changed' || r.status === 'added').map((r) => pathKey(r.path)))
    setReloaded((r) => (r ? { ...r, keys, pending: false } : r))
  }, [view, reloaded])
  useEffect(() => {
    if (!reloaded || reloaded.pending) return
    const t = setTimeout(() => setReloaded((r) => (r ? { ...r, keys: new Set() } : r)), 2500)
    return () => clearTimeout(t)
  }, [reloaded?.at, reloaded?.pending])

  // --- copy -----------------------------------------------------------------------------
  const copy = useCallback((text: string, label: string) => {
    (onCopy ?? copyText)(text)
    flash(`Copied ${label}`)
  }, [onCopy, flash])

  // --- input ----------------------------------------------------------------------------
  const totalRows = diffMode ? diffRows.length : rows.length
  const scrollAcc = useRef(0)
  const onScroll = (e: EventPayload) => {
    const dy = (e.deltaY ?? 0) * (e.precise ? 1 : ROW_H * 1.5)
    scrollAcc.current += dy
    const steps = Math.trunc(scrollAcc.current / ROW_H)
    if (!steps) return
    scrollAcc.current -= steps * ROW_H
    setTop((t) => Math.max(0, Math.min(Math.max(0, totalRows - visible), t - steps)))
  }

  const onKeyDown = (e: EventPayload) => {
    const key = (e.key ?? '').toLowerCase()
    const m = e.modifiers
    const shift = !!m?.shift
    const focused = renderer?.getFocusedElementId?.()
    const inInput = focused != null && rootRef.current != null && focused !== rootRef.current.id
    if (inInput) {
      if (key === 'escape' || key === 'enter' || (key === 'down' && focused === filterRef.current?.id)) {
        if (focused === searchRef.current?.id && key === 'enter') { stepMatch(shift ? -1 : 1); return }
        if (focused === searchRef.current?.id && key === 'escape') { setSearchActive(false); setSearch('') }
        focusRoot()
      }
      return
    }
    if (m?.cmd || m?.ctrl) return
    const page = Math.max(1, visible - 2)
    if (diffMode) {
      if (key === 'down' || key === 'j') setTop((t) => Math.min(Math.max(0, totalRows - visible), t + 1))
      else if (key === 'up' || key === 'k') setTop((t) => Math.max(0, t - 1))
      else if (key === 'pagedown' || key === 'space') setTop((t) => Math.min(Math.max(0, totalRows - visible), t + page))
      else if (key === 'pageup') setTop((t) => Math.max(0, t - page))
      else if (key === 'n') {
        const next = shift ? [...changeIdx].reverse().find((i) => i < top) : changeIdx.find((i) => i > top + 1)
        if (next !== undefined) setTop(Math.max(0, Math.min(Math.max(0, totalRows - visible), next - 2)))
      } else if (key === 'q') process.exit(0)
      return
    }
    if (key === 'down' || key === 'j') moveTo(cursor + 1)
    else if (key === 'up' || key === 'k') moveTo(cursor - 1)
    else if (key === 'pagedown') moveTo(cursor + page)
    else if (key === 'pageup') moveTo(cursor - page)
    else if (key === 'home' || (key === 'g' && !shift)) moveTo(0)
    else if (key === 'end' || (key === 'g' && shift)) moveTo(rows.length - 1)
    else if (key === 'right' || key === 'l') {
      if (curRow && isContainer(curRow.value)) curRow.open ? moveTo(cursor + 1) : toggle(curRow, true)
    } else if (key === 'left' || key === 'h') {
      if (curRow?.open) toggle(curRow, false)
      else if (curRow && curRow.depth > 0) {
        for (let i = cursor - 1; i >= 0; i--) if (rows[i]!.depth < curRow.depth) { moveTo(i); break }
      }
    } else if (key === 'enter' || key === 'space') toggle(curRow)
    else if (key === 'e') expandDeep(curRow)
    else if (key === 'c') { setExpanded(new Set([pathKey([])])); moveTo(0, 1) }
    else if (key === '/' ) { setSearchActive(true); setTimeout(() => searchRef.current && renderer?.focusElement?.(searchRef.current.id), 0) }
    else if (key === 'f' || key === ':' || (key === ';' && shift)) { if (filterRef.current) renderer?.focusElement?.(filterRef.current.id) }
    else if (key === 'n') stepMatch(shift ? -1 : 1)
    else if (key === 'y' && curRow) shift ? copy(JSON.stringify(curRow.value, null, 2), `value (${formatBytes(JSON.stringify(curRow.value).length)})`) : copy(jqPath(curRow.path), jqPath(curRow.path))
    else if (key === 's') setShowSchema((v) => !v)
    else if (key === 'escape') { if (searchActive) { setSearchActive(false); setSearch('') } else if (filter) setFilter('') }
    else if (key === 'q') process.exit(0)
  }

  // --- render ---------------------------------------------------------------------------
  const leftPad = term ? 14 : 84
  const activeMatch = matchIdx >= 0 ? pathKey(matches[matchIdx]!) : null
  const treeW = W - (schemaVisible ? SCHEMA_W : 0)

  return (
    <div
      ref={rootRef as never}
      testId="app"
      tabIndex={-1}
      autoFocus
      onKeyDown={onKeyDown}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: T.bg, fontFamily: MONO, fontSize: FS }}
    >
      {/* header */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: HEADER_H, paddingLeft: leftPad, paddingRight: 14, gap: 12, borderBottomWidth: 1, borderColor: T.border, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: '#0f2a17' }}>
          <text style={{ color: T.green, fontWeight: 700, fontSize: 13 }}>jx</text>
        </div>
        {diffMode ? (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, overflow: 'hidden' }}>
            <text style={{ color: T.fg, fontWeight: 500, whiteSpace: 'nowrap' }}>{docs[0]!.name}</text>
            <text style={{ color: T.dim }}>⟷</text>
            <text style={{ color: T.fg, fontWeight: 500, whiteSpace: 'nowrap' }}>{docs[1]!.name}</text>
            <text testId="diff-stats" style={{ color: T.muted, whiteSpace: 'nowrap' }}>{`+${diff!.stats.added}  −${diff!.stats.removed}  ~${diff!.stats.changed}`}</text>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, overflow: 'hidden' }}>
            <text style={{ color: T.fg, fontWeight: 500, whiteSpace: 'nowrap' }}>{doc.name}</text>
            <text testId="doc-stats" style={{ color: T.dim, whiteSpace: 'nowrap' }}>{`${formatBytes(doc.bytes)} · ${summary(doc.root) || typeof doc.root} · ${nodeCount.toLocaleString()} nodes`}</text>
          </div>
        )}
        {watch && doc.path ? (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: reloaded?.keys.size ? T.yellow : T.green }} />
            <text testId="watch" style={{ color: T.muted, whiteSpace: 'nowrap' }}>{reloaded ? `reloaded ${reloaded.at}` : 'watching'}</text>
          </div>
        ) : null}
        {!diffMode && W >= 700 ? (
          <div onClick={() => setShowSchema((v) => !v)} style={{ display: 'flex', alignItems: 'center', height: 24, paddingLeft: 10, paddingRight: 10, borderRadius: 6, borderWidth: 1, borderColor: schemaVisible ? '#1f4a7a' : T.border, backgroundColor: schemaVisible ? '#0f1f33' : 'transparent', cursor: 'pointer', flexShrink: 0 }}>
            <text style={{ color: schemaVisible ? T.blue : T.muted, fontSize: 12 }}>schema</text>
          </div>
        ) : null}
      </div>

      {/* filter bar */}
      {!diffMode ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: FILTER_H, paddingLeft: 14, paddingRight: 14, gap: 10, flexShrink: 0, backgroundColor: T.panel, borderBottomWidth: 1, borderColor: T.border }}>
          <text style={{ color: T.green, fontWeight: 700 }}>jq</text>
          <text style={{ color: T.dim }}>›</text>
          <input
            ref={filterRef as never}
            testId="filter"
            value={filter}
            placeholder='.[] | select(.type == "PushEvent") | .repo.name'
            onChange={(e) => setFilter(e.value ?? '')}
            onSubmit={focusRoot}
            theme={{ caret: T.green }}
            style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, color: T.fg, fontFamily: MONO, fontSize: FS, backgroundColor: 'transparent' }}
          />
          {query.error ? (
            <text testId="filter-status" style={{ color: T.red, whiteSpace: 'nowrap' }}>{query.error}</text>
          ) : query.count !== null ? (
            <text testId="filter-status" style={{ color: T.muted, whiteSpace: 'nowrap' }}>{`${query.count.toLocaleString()} ${query.count === 1 ? 'result' : 'results'} · ${query.ms < 10 ? query.ms.toFixed(1) : Math.round(query.ms)} ms`}</text>
          ) : (
            <text style={{ color: T.dim, whiteSpace: 'nowrap' }}>f to filter</text>
          )}
        </div>
      ) : null}

      {/* breadcrumbs */}
      {!diffMode ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: CRUMB_H, paddingLeft: 14, paddingRight: 14, gap: 6, flexShrink: 0, borderBottomWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
          <Crumbs path={curRow?.path ?? []} onPick={(p) => goToPath(p)} />
          <div style={{ flexGrow: 1 }} />
          {treeW >= 640 ? <text testId="path" style={{ color: T.dim, whiteSpace: 'nowrap' }}>{curRow ? jqPath(curRow.path) : '.'}</text> : null}
        </div>
      ) : null}

      {/* body */}
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <div testId="tree" onScroll={onScroll} highlight={searchActive && search.trim().length >= 2 ? { query: search.trim(), color: '#f0b72f40' } : null} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, height: bodyH, overflow: 'hidden', position: 'relative' }}>
          {diffMode
            ? diffRows.slice(top, top + visible + 1).map((r, i) => <DiffLine key={top + i} row={r} width={W} />)
            : rows.slice(top, top + visible + 1).map((r, i) => {
                const idx = top + i
                const k = pathKey(r.path)
                return (
                  <TreeRow
                    key={k}
                    row={r}
                    selected={idx === cursor}
                    hovered={idx === hover}
                    active={k === activeMatch}
                    changed={!!reloaded?.keys.has(k)}
                    onHover={(h) => setHover(h ? idx : -1)}
                    onPress={(count, onCaret) => {
                      setCursor(idx)
                      if (count >= 2 || onCaret) toggle(r)
                    }}
                  />
                )
              })}
          <Scrollbar total={totalRows} top={top} visible={visible} height={bodyH} onJump={(t) => setTop(Math.max(0, Math.min(Math.max(0, totalRows - visible), t)))} />
        </div>
        {schemaVisible && schema ? (
          <SchemaPanel
            rows={schema.rows}
            label={schema.label}
            height={bodyH}
            top={schemaTop}
            setTop={setSchemaTop}
            onPick={(p) => { setFilter(p); flash(`Filter ${p}`, 'info') }}
          />
        ) : null}
      </div>

      {/* search */}
      {searchActive ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: SEARCH_H, paddingLeft: 14, paddingRight: 14, gap: 10, flexShrink: 0, backgroundColor: T.panel, borderTopWidth: 1, borderColor: T.border }}>
          <text style={{ color: T.yellow, fontWeight: 700 }}>/</text>
          <input
            ref={searchRef as never}
            testId="search"
            value={search}
            placeholder="search keys and values"
            onChange={(e) => setSearch(e.value ?? '')}
            onSubmit={() => stepMatch(1)}
            theme={{ caret: T.yellow }}
            style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, color: T.fg, fontFamily: MONO, fontSize: FS, backgroundColor: 'transparent' }}
          />
          <text testId="search-status" style={{ color: matches.length ? T.muted : T.dim, whiteSpace: 'nowrap' }}>
            {search.trim().length < 2 ? '' : matches.length ? `${matchIdx >= 0 ? matchIdx + 1 : 0}/${matches.length >= 5000 ? '5000+' : matches.length.toLocaleString()}` : 'no matches'}
          </text>
          <text style={{ color: T.dim, whiteSpace: 'nowrap' }}>⏎ next · esc close</text>
        </div>
      ) : null}

      {/* status bar */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: STATUS_H, paddingLeft: 14, paddingRight: 14, gap: 16, flexShrink: 0, borderTopWidth: 1, borderColor: T.border, overflow: 'hidden' }}>
        {(diffMode
          ? [['↑↓', 'scroll'], ['n N', 'next change'], ['q', 'quit']]
          : [['↑↓', 'move'], ['←→', 'fold'], ['f', 'filter'], ['/', 'search'], ['y', 'copy path'], ['Y', 'copy value'], ['e', 'expand'], ['s', 'schema'], ['q', 'quit']]
        ).filter((_, i) => W >= 760 || i < 5).map(([k, label]) => (
          <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <text style={{ color: T.text, fontWeight: 500 }}>{k}</text>
            <text style={{ color: T.dim }}>{label}</text>
          </div>
        ))}
        <div style={{ flexGrow: 1 }} />
        <text testId="position" style={{ color: T.dim, whiteSpace: 'nowrap' }}>{diffMode ? `${diffRows.length.toLocaleString()} rows` : `${Math.min(cursor + 1, rows.length).toLocaleString()}/${rows.length.toLocaleString()}`}</text>
      </div>

      {toast ? (
        <div style={{ position: 'absolute', right: 16, bottom: STATUS_H + (searchActive ? SEARCH_H : 0) + 12, display: 'flex', alignItems: 'center', height: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 8, backgroundColor: T.raised, borderWidth: 1, borderColor: toast.tone === 'ok' ? '#1d5c2c' : T.border, pointerEvents: 'none' }}>
          <text testId="toast" style={{ color: toast.tone === 'ok' ? T.greenSoft : T.text, whiteSpace: 'nowrap' }}>{toast.text}</text>
        </div>
      ) : null}
    </div>
  )
}

function Crumbs({ path, onPick }: { path: Seg[]; onPick: (p: Seg[]) => void }) {
  const segs = path.length > 6 ? [null, ...path.slice(-5)] : path
  const offset = path.length > 6 ? path.length - 5 : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
      <div onClick={() => onPick([])} style={{ cursor: 'pointer' }}><text style={{ color: T.blue }}>$</text></div>
      {segs.map((s, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <text style={{ color: T.dim }}>›</text>
          {s === null ? (
            <text style={{ color: T.dim }}>…</text>
          ) : (
            <div onClick={() => onPick(path.slice(0, offset + i - (offset ? 1 : 0) + 1))} style={{ cursor: 'pointer' }}>
              <text style={{ color: i === segs.length - 1 ? T.fg : T.muted, whiteSpace: 'nowrap' }}>{typeof s === 'number' ? `[${s}]` : s}</text>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function TreeRow({ row, selected, hovered, active, changed, onHover, onPress }: {
  row: Row; selected: boolean; hovered: boolean; active: boolean; changed: boolean
  onHover: (h: boolean) => void; onPress: (clicks: number, onCaret: boolean) => void
}) {
  const container = isContainer(row.value)
  const indent = 14 + row.depth * 18
  const bg = changed ? '#3a2e0b' : selected ? T.select : active ? '#2a230f' : hovered ? T.hover : 'transparent'
  const open = Array.isArray(row.value) ? '[' : '{'
  const close = Array.isArray(row.value) ? ']' : '}'
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onMouseDown={(e) => onPress(e.clickCount ?? 1, (e.x ?? 0) < indent + 18)}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: ROW_H, flexShrink: 0, paddingLeft: indent, paddingRight: 14, backgroundColor: bg, overflow: 'hidden' }}
    >
      {selected ? <div style={{ position: 'absolute', left: 0, top: 0, width: 2, height: ROW_H, backgroundColor: T.blue, pointerEvents: 'none' }} /> : null}
      <div style={{ width: 18, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {container ? <text style={{ color: selected ? T.fg : T.dim, fontSize: 11 }}>{row.open ? '▾' : '▸'}</text> : null}
      </div>
      {row.key !== null ? (
        <text style={{ color: typeof row.key === 'number' ? T.dim : T.blue, whiteSpace: 'nowrap', flexShrink: 0 }}>{typeof row.key === 'number' ? String(row.key) : row.key}</text>
      ) : (
        <text style={{ color: T.dim, flexShrink: 0 }}>$</text>
      )}
      <text style={{ color: T.dim, flexShrink: 0, marginRight: 8 }}>:</text>
      {container ? (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <text style={{ color: T.text, whiteSpace: 'nowrap' }}>{row.open ? open : `${open}…${close}`}</text>
          <text style={{ color: T.dim, whiteSpace: 'nowrap' }}>{summary(row.value)}</text>
        </div>
      ) : (
        <text style={{ color: KIND_COLOR[row.kind], whiteSpace: 'nowrap' }}>{leafText(row.value)}</text>
      )}
    </div>
  )
}

function Scrollbar({ total, top, visible, height, onJump }: { total: number; top: number; visible: number; height: number; onJump: (top: number) => void }) {
  if (total <= visible) return null
  const thumbH = Math.max(28, (height * visible) / total)
  const y = ((height - thumbH) * top) / Math.max(1, total - visible)
  const jump = (e: EventPayload, base: number) => onJump(Math.round((((e.y ?? 0) - base) / height) * total - visible / 2))
  return (
    <div onMouseDown={(e) => jump(e, HEADER_H + FILTER_H + CRUMB_H)} style={{ position: 'absolute', right: 0, top: 0, width: 10, height, cursor: 'pointer' }}>
      <div style={{ position: 'absolute', right: 2, top: y, width: 5, height: thumbH, borderRadius: 3, backgroundColor: '#3a434e', pointerEvents: 'none' }} />
    </div>
  )
}

function DiffLine({ row, width }: { row: DiffRow; width: number }) {
  const half = Math.floor(width / 2)
  const indent = 14 + row.depth * 16
  const tint = { same: 'transparent', open: 'transparent', changed: '#2b2410', added: '#0f2a17', removed: '#341a1c' }[row.status]
  const leftBg = row.status === 'added' ? 'transparent' : tint
  const rightBg = row.status === 'removed' ? 'transparent' : tint
  const mark = { same: ' ', open: ' ', changed: '~', added: '+', removed: '−' }[row.status]
  const markColor = { same: T.dim, open: T.dim, changed: T.yellow, added: T.green, removed: T.red }[row.status]
  const key = row.key === null ? '$' : String(row.key)
  const side = (text: string | null, bg: string, testId?: string) => (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', width: half, height: ROW_H, paddingLeft: indent, paddingRight: 12, gap: 0, backgroundColor: bg, overflow: 'hidden', borderRightWidth: 1, borderColor: T.border }}>
      {text === null ? null : (
        <>
          <text style={{ color: typeof row.key === 'number' ? T.dim : T.blue, whiteSpace: 'nowrap', flexShrink: 0 }}>{key}</text>
          <text style={{ color: T.dim, flexShrink: 0, marginRight: 8 }}>:</text>
          <text testId={testId} style={{ color: row.status === 'same' || row.status === 'open' ? T.text : T.fg, whiteSpace: 'nowrap' }}>{text}</text>
        </>
      )}
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: ROW_H, flexShrink: 0 }}>
      {side(row.left, leftBg)}
      {side(row.right, rightBg)}
      <div style={{ position: 'absolute', left: 2, top: 0, width: 10, height: ROW_H, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
        <text style={{ color: markColor, fontWeight: 700 }}>{mark}</text>
      </div>
    </div>
  )
}

function SchemaPanel({ rows, label, height, top, setTop, onPick }: {
  rows: ReturnType<typeof schemaRows>; label: string; height: number; top: number; setTop: (t: number) => void; onPick: (path: string) => void
}) {
  const head = 40
  const vis = Math.max(1, Math.floor((height - head) / ROW_H))
  const acc = useRef(0)
  const [hover, setHover] = useState(-1)
  return (
    <div
      testId="schema"
      onScroll={(e) => {
        acc.current += (e.deltaY ?? 0) * (e.precise ? 1 : ROW_H * 1.5)
        const steps = Math.trunc(acc.current / ROW_H)
        if (!steps) return
        acc.current -= steps * ROW_H
        setTop(Math.max(0, Math.min(Math.max(0, rows.length - vis), top - steps)))
      }}
      style={{ display: 'flex', flexDirection: 'column', width: SCHEMA_W, flexShrink: 0, height, borderLeftWidth: 1, borderColor: T.border, backgroundColor: T.panel, overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: head, paddingLeft: 14, paddingRight: 14, gap: 8, flexShrink: 0 }}>
        <text style={{ color: T.fg, fontWeight: 700 }}>Schema</text>
        <text style={{ color: T.dim, whiteSpace: 'nowrap' }}>{label}</text>
      </div>
      {rows.slice(top, top + vis).map((r, i) => (
        <div
          key={top + i}
          onMouseEnter={() => setHover(top + i)}
          onMouseLeave={() => setHover(-1)}
          onClick={() => onPick(r.path)}
          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: ROW_H, flexShrink: 0, paddingLeft: 14 + r.depth * 14, paddingRight: 14, gap: 8, cursor: 'pointer', backgroundColor: hover === top + i ? T.hover : 'transparent', overflow: 'hidden' }}
        >
          <text style={{ color: T.blue, whiteSpace: 'nowrap', flexShrink: 0 }}>{r.name}</text>
          <text style={{ color: KIND_COLOR[r.kind], whiteSpace: 'nowrap', flexShrink: 0, fontSize: 12 }}>{r.type.length > 22 ? r.type.slice(0, 21) + '…' : r.type}</text>
          <div style={{ flexGrow: 1 }} />
          <text style={{ color: r.pct === 100 ? T.dim : T.yellow, whiteSpace: 'nowrap', flexShrink: 0, fontSize: 12 }}>{`${r.pct}%`}</text>
        </div>
      ))}
    </div>
  )
}

export { getAt }
