import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  useGpuix,
  useWindowSize,
  type KeyEvent,
  type StyleDesc,
} from '@gpuix/react'
import { copyText } from './clipboard'
import { shellRefs, toCurl } from './curl'
import { METHODS, sendRequest, type Method, type Sender, type WireRequest, type WireResponse } from './http'
import { containerPaths, flattenJson, formatBytes, formatMs, parseJson, type JsonRow } from './json'
import {
  blankRequest,
  loadHistory,
  loadWorkspace,
  uid,
  writeJson,
  type HistoryEntry,
  type KV,
  type Paths,
  type RequestDraft,
  type Workspace,
} from './store'
import { C, METHOD_COLOR, MONO, PHASE_COLOR, THEME, statusColor } from './theme'
import { Button, T, Tab, relativeTime } from './ui'
import { interpolate, missingVars, type Vars } from './vars'

export interface AppProps {
  paths: Paths
  sender?: Sender
  /** From the command line: a request to open, sent right away when `autoSend`. */
  initial?: { request?: Partial<RequestDraft>; autoSend?: boolean; env?: string }
  copy?: (text: string) => string
}

type ResponseState =
  | { kind: 'idle' }
  | { kind: 'loading'; started: number; controller: AbortController }
  | { kind: 'done'; res: WireResponse; wire: WireRequest }
  | { kind: 'error'; message: string; ms: number; wire: WireRequest }

/** Window-level key handler, set by the mounted App; app entry wires it to render({ onKeyDown }). */
export const windowKeys: { current: ((e: KeyEvent) => void) | null } = { current: null }

const FONT_DIR = fileURLToPath(new URL('../fonts', import.meta.url))

export function App({ paths, sender = sendRequest, initial, copy = copyText }: AppProps) {
  const { renderer } = useGpuix()
  const { width } = useWindowSize()
  const [ws, setWs] = useState<Workspace>(() => {
    const w = loadWorkspace(paths.workspace)
    return initial?.env && w.environments.some((e) => e.name === initial.env) ? { ...w, activeEnv: initial.env } : w
  })
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory(paths.history))
  const [draft, setDraft] = useState<RequestDraft>(() =>
    initial?.request ? { ...blankRequest(), ...initial.request } : (ws.collections[0]?.requests[0] ?? blankRequest()),
  )
  const [response, setResponse] = useState<ResponseState>({ kind: 'idle' })
  const [reqTab, setReqTab] = useState<'params' | 'headers' | 'body'>('params')
  const [resTab, setResTab] = useState<'body' | 'headers' | 'timing'>('body')
  const [sideTab, setSideTab] = useState<'collections' | 'history'>('collections')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [raw, setRaw] = useState(false)
  const [toast, setToast] = useState<{ text: string; color: string } | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [envOpen, setEnvOpen] = useState(false)
  const [now, setNow] = useState(() => performance.now())

  const urlRef = useRef<{ id: number } | null>(null)
  const searchRef = useRef<{ id: number } | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const loadingRef = useRef(false)

  // JetBrains Mono matches Ghostty's default font, so req reads like the terminal around it.
  useEffect(() => {
    for (const f of ['JetBrainsMono-Regular.ttf', 'JetBrainsMono-Medium.ttf', 'JetBrainsMono-Bold.ttf']) {
      try {
        renderer?.registerFont?.(fs.readFileSync(path.join(FONT_DIR, f)))
      } catch {
        // Missing font files fall back to the system monospace.
      }
    }
  }, [renderer])

  useEffect(() => writeJson(paths.workspace, ws), [paths.workspace, ws])

  const flash = useCallback((text: string, color: string = C.green) => setToast({ text, color }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const env = ws.environments.find((e) => e.name === ws.activeEnv) ?? ws.environments[0]
  const vars: Vars = env?.vars ?? {}

  const buildWire = useCallback(
    (d: RequestDraft, processEnv?: NodeJS.ProcessEnv): WireRequest => {
      const headers: [string, string][] = d.headers
        .filter((h) => h.enabled && h.key.trim())
        .map((h) => [h.key.trim(), interpolate(h.value, vars, processEnv)])
      const hasBody = d.bodyType !== 'none' && d.body.trim() !== '' && !['GET', 'HEAD'].includes(d.method)
      if (hasBody && d.bodyType === 'json' && !headers.some(([k]) => k.toLowerCase() === 'content-type'))
        headers.push(['Content-Type', 'application/json'])
      return {
        method: d.method,
        url: interpolate(d.url.trim(), vars, processEnv),
        headers,
        body: hasBody ? interpolate(d.body, vars, processEnv) : undefined,
      }
    },
    [vars],
  )

  const send = useCallback(() => {
    if (loadingRef.current) return
    const d = draftRef.current
    const wire = buildWire(d)
    try {
      new URL(wire.url)
    } catch {
      setResponse({ kind: 'error', message: `Not a valid URL: ${wire.url || '(empty)'}`, ms: 0, wire })
      return
    }
    const controller = new AbortController()
    const started = performance.now()
    loadingRef.current = true
    setResponse({ kind: 'loading', started, controller })
    setNow(started)
    const record = (entry: Omit<HistoryEntry, 'id' | 'at' | 'request'>) =>
      setHistory((h) => {
        const next = [{ id: uid('x'), at: Date.now(), request: { ...d, origin: undefined }, ...entry }, ...h].slice(0, 200)
        writeJson(paths.history, next)
        return next
      })
    sender(wire, controller.signal)
      .then((res) => {
        setResponse({ kind: 'done', res, wire })
        setCollapsed(new Set())
        record({ status: res.status, ms: res.timings.total, size: res.size })
      })
      .catch((e: Error & { code?: string }) => {
        const ms = performance.now() - started
        const message = controller.signal.aborted ? 'Cancelled' : e.code ? `${e.code}: ${e.message}` : e.message
        setResponse({ kind: 'error', message, ms, wire })
        record({ status: null, ms, size: 0, error: message })
      })
      .finally(() => {
        loadingRef.current = false
      })
  }, [buildWire, sender, paths.history])

  const cancel = useCallback(() => {
    if (response.kind === 'loading') response.controller.abort()
  }, [response])

  useEffect(() => {
    if (response.kind !== 'loading') return
    const t = setInterval(() => setNow(performance.now()), 33)
    return () => clearInterval(t)
  }, [response.kind])

  const autoSent = useRef(false)
  useEffect(() => {
    if (initial?.autoSend && !autoSent.current) {
      autoSent.current = true
      setTimeout(send, 0)
    }
  }, [initial?.autoSend, send])

  const update = useCallback((patch: Partial<RequestDraft>) => setDraft((d) => ({ ...d, ...patch })), [])

  const open = useCallback((r: RequestDraft, origin?: RequestDraft['origin']) => {
    setDraft({ ...r, headers: r.headers.map((h) => ({ ...h })), origin })
    setReqTab(r.bodyType !== 'none' && r.method !== 'GET' ? 'body' : 'params')
  }, [])

  const saveTo = useCallback(
    (collectionId: string, name: string) => {
      const d = draftRef.current
      const requestId = d.origin?.collectionId === collectionId ? d.origin.requestId : uid()
      const saved: RequestDraft = { ...d, id: requestId, name, origin: undefined }
      setWs((w) => ({
        ...w,
        collections: w.collections.map((c) =>
          c.id !== collectionId
            ? c
            : {
                ...c,
                requests: c.requests.some((r) => r.id === requestId)
                  ? c.requests.map((r) => (r.id === requestId ? saved : r))
                  : [...c.requests, saved],
              },
        ),
      }))
      setDraft({ ...d, id: requestId, name, origin: { collectionId, requestId } })
      const col = ws.collections.find((c) => c.id === collectionId)
      flash(`Saved “${name}” to ${col?.name ?? 'collection'}`)
    },
    [ws.collections, flash],
  )

  const quickSave = useCallback(() => {
    const d = draftRef.current
    if (d.origin) saveTo(d.origin.collectionId, d.name)
    else setSaveOpen(true)
  }, [saveTo])

  const copyCurl = useCallback(() => {
    const cmd = toCurl(buildWire(draftRef.current, shellRefs))
    const via = copy(cmd)
    flash(via === 'osc52' ? 'Copied as curl · OSC 52' : 'Copied as curl')
  }, [buildWire, copy, flash])

  const focus = useCallback(
    (ref: { current: { id: number } | null }) => {
      const id = ref.current?.id
      if (id != null) renderer?.focusElement?.(id)
    },
    [renderer],
  )

  const findInResponse = useCallback(() => {
    setResTab('body')
    setRaw(false)
    setTimeout(() => focus(searchRef), 0)
  }, [focus])

  // One keystroke reaches both the root onKeyDown and render({ onKeyDown }); handle it once.
  const lastKey = useRef({ combo: '', at: 0 })
  const onKey = useCallback(
    (e: KeyEvent) => {
      const mod = !!(e.modifiers?.cmd || e.modifiers?.ctrl)
      const combo = `${mod ? 'mod+' : ''}${e.key}`
      const t = performance.now()
      if (lastKey.current.combo === combo && t - lastKey.current.at < 40) return
      lastKey.current = { combo, at: t }
      const focused = renderer?.getFocusedElementId?.()
      if (e.key === 'enter' && (mod || (focused != null && focused === urlRef.current?.id))) {
        e.preventDefault?.()
        send()
      } else if (mod && e.key === 's') {
        e.preventDefault?.()
        quickSave()
      } else if (mod && e.key === 'y') {
        e.preventDefault?.()
        copyCurl()
      } else if (mod && e.key === 'f') {
        e.preventDefault?.()
        findInResponse()
      } else if (mod && e.key === 'l') {
        e.preventDefault?.()
        focus(urlRef)
      } else if (e.modifiers?.ctrl && e.key === 'u' && focused != null && focused === urlRef.current?.id) {
        e.preventDefault?.()
        update({ url: '' })
      } else if (e.key === 'escape') {
        if (response.kind === 'loading') cancel()
        else if (query) setQuery('')
      }
    },
    [renderer, send, quickSave, copyCurl, findInResponse, focus, update, response.kind, cancel, query],
  )
  windowKeys.current = onKey

  const showSidebar = width >= 900
  const mainWidth = width - (showSidebar ? 256 : 0)
  const sideBySide = mainWidth >= 900

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKey}
      style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%', backgroundColor: C.bg }}
    >
      {showSidebar && (
        <Sidebar
          ws={ws}
          history={history}
          tab={sideTab}
          onTab={setSideTab}
          activeId={draft.origin?.requestId}
          onOpen={open}
          onEnv={(name) => setWs((w) => ({ ...w, activeEnv: name }))}
          onEditEnv={() => setEnvOpen(true)}
          onClearHistory={() => {
            setHistory([])
            writeJson(paths.history, [])
          }}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, height: '100%' }}>
        <RequestBar
          draft={draft}
          vars={vars}
          loading={response.kind === 'loading'}
          compact={mainWidth < 640}
          urlRef={urlRef}
          onMethod={(method) => update({ method })}
          onUrl={(url) => update({ url })}
          onSend={send}
          onCancel={cancel}
          onSave={quickSave}
          onCurl={copyCurl}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: sideBySide ? 'row' : 'column',
            flexGrow: 1,
            minHeight: 0,
            borderTopWidth: 1,
            borderColor: C.border,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
              ...(sideBySide
                ? { width: Math.round(mainWidth * 0.42), height: '100%', borderRightWidth: 1, borderColor: C.border }
                : { height: 236, flexShrink: 0, borderBottomWidth: 1, borderColor: C.border }),
            }}
          >
            <RequestEditor draft={draft} tab={reqTab} onTab={setReqTab} update={update} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
            <ResponsePane
              state={response}
              now={now}
              tab={resTab}
              onTab={setResTab}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              query={query}
              setQuery={setQuery}
              raw={raw}
              setRaw={setRaw}
              searchRef={searchRef}
              compact={mainWidth < 640}
            />
          </div>
        </div>
        <StatusBar env={ws.activeEnv} toast={toast} compact={mainWidth < 760} />
      </div>
      <SaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        initialName={draft.name === 'Untitled request' ? `${draft.method} ${shortPath(draft.url)}` : draft.name}
        collections={ws.collections.map((c) => ({ value: c.id, label: c.name }))}
        onSave={(collectionId, name) => {
          saveTo(collectionId, name)
          setSaveOpen(false)
        }}
      />
      <EnvDialog
        open={envOpen}
        onOpenChange={setEnvOpen}
        name={ws.activeEnv}
        vars={vars}
        onSave={(next) => {
          setWs((w) => ({
            ...w,
            environments: w.environments.map((e) => (e.name === w.activeEnv ? { ...e, vars: next } : e)),
          }))
          setEnvOpen(false)
          flash(`Updated ${ws.activeEnv} variables`)
        }}
      />
    </div>
  )
}

/* ───────────────────────── URL helpers ───────────────────────── */

export function shortPath(url: string) {
  const noVars = url.replace(/^\{\{[^}]+\}\}/, '')
  try {
    const u = new URL(noVars)
    return u.pathname + u.search
  } catch {
    return noVars || '/'
  }
}

export function parseQuery(url: string): { key: string; value: string }[] {
  const i = url.indexOf('?')
  if (i < 0) return []
  return url
    .slice(i + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const dec = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, ' '))
        } catch {
          return s
        }
      }
      return eq < 0 ? { key: dec(pair), value: '' } : { key: dec(pair.slice(0, eq)), value: dec(pair.slice(eq + 1)) }
    })
}

export function withQuery(url: string, params: { key: string; value: string }[]) {
  const base = url.split('?')[0]!
  const enc = (s: string) => s.replace(/[ &=#?]/g, (c) => encodeURIComponent(c))
  const q = params.filter((p) => p.key || p.value).map((p) => (p.value ? `${enc(p.key)}=${enc(p.value)}` : enc(p.key)))
  return q.length ? `${base}?${q.join('&')}` : base
}

/* ───────────────────────── Sidebar ───────────────────────── */

function Sidebar({
  ws,
  history,
  tab,
  onTab,
  activeId,
  onOpen,
  onEnv,
  onEditEnv,
  onClearHistory,
}: {
  ws: Workspace
  history: HistoryEntry[]
  tab: 'collections' | 'history'
  onTab: (t: 'collections' | 'history') => void
  activeId?: string
  onOpen: (r: RequestDraft, origin?: RequestDraft['origin']) => void
  onEnv: (name: string) => void
  onEditEnv: () => void
  onClearHistory: () => void
}) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 256,
        flexShrink: 0,
        height: '100%',
        backgroundColor: C.panel,
        borderRightWidth: 1,
        borderColor: C.border,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingLeft: 16, paddingRight: 12 }}>
        <T size={15} weight={700} mono color={C.green}>
          ❯
        </T>
        <T size={15} weight={700} mono color={C.text}>
          req
        </T>
        <T size={11.5} mono color={C.ghost}>
          v0.1
        </T>
        <div style={{ flexGrow: 1 }} />
        <EnvPicker value={ws.activeEnv} names={ws.environments.map((e) => e.name)} onChange={onEnv} />
        <div
          testId="edit-env"
          onClick={onEditEnv}
          style={{ display: 'flex', paddingLeft: 6, paddingRight: 6, height: 26, alignItems: 'center', borderRadius: 6, cursor: 'pointer', hover: { backgroundColor: C.hover } }}
        >
          <T size={12} mono color={C.faint}>
            {'{…}'}
          </T>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 16, paddingLeft: 16, borderBottomWidth: 1, borderColor: C.border }}>
        <Tab label="Collections" active={tab === 'collections'} onClick={() => onTab('collections')} testId="side-collections" />
        <Tab label="History" count={history.length} active={tab === 'history'} onClick={() => onTab('history')} testId="side-history" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'scroll', paddingTop: 6, paddingBottom: 12 }}>
        {tab === 'collections'
          ? ws.collections.map((col) => (
              <div key={col.id} style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  testId={`collection-${col.id}`}
                  onClick={() =>
                    setClosed((s) => {
                      const n = new Set(s)
                      n.has(col.id) ? n.delete(col.id) : n.add(col.id)
                      return n
                    })
                  }
                  style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingLeft: 12, paddingRight: 14, cursor: 'pointer', userSelect: 'none' }}
                >
                  <T size={8} color={C.faint} style={{ width: 12 }}>
                    {closed.has(col.id) ? '▶' : '▼'}
                  </T>
                  <T size={12.5} weight={600} color={C.dim} style={{ flexGrow: 1 }}>
                    {col.name}
                  </T>
                  <T size={11} mono color={C.ghost}>
                    {String(col.requests.length)}
                  </T>
                </div>
                {!closed.has(col.id) &&
                  col.requests.map((r, i) => (
                    <SideRow
                      key={r.id}
                      testId={`req-${col.id}-${i}`}
                      active={activeId === r.id}
                      method={r.method}
                      label={r.name}
                      onClick={() => onOpen(r, { collectionId: col.id, requestId: r.id })}
                    />
                  ))}
              </div>
            ))
          : history.length === 0
            ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 16, paddingTop: 16 }}>
                  <T size={12.5} color={C.faint}>
                    No requests yet
                  </T>
                  <T size={11.5} color={C.ghost}>
                    Everything you send shows up here.
                  </T>
                </div>
              )
            : [
                ...history.slice(0, 80).map((h, i) => (
                  <SideRow
                    key={h.id}
                    testId={`history-${i}`}
                    method={h.request.method}
                    label={shortPath(h.request.url)}
                    detail={`${h.status ?? 'ERR'} · ${formatMs(h.ms)} · ${relativeTime(h.at)}`}
                    detailColor={statusColor(h.status)}
                    onClick={() => onOpen(h.request)}
                  />
                )),
                <div
                  key="clear"
                  testId="clear-history"
                  onClick={onClearHistory}
                  style={{ display: 'flex', paddingLeft: 16, paddingTop: 10, cursor: 'pointer' }}
                >
                  <T size={11.5} color={C.ghost} style={{ hover: { color: C.red } }}>
                    Clear history
                  </T>
                </div>,
              ]}
      </div>
    </div>
  )
}

function SideRow({
  method,
  label,
  detail,
  detailColor,
  active,
  onClick,
  testId,
}: {
  method: Method
  label: string
  detail?: string
  detailColor?: string
  active?: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: detail ? 'flex-start' : 'center',
        gap: 8,
        minHeight: 30,
        paddingTop: detail ? 6 : 0,
        paddingBottom: detail ? 6 : 0,
        paddingLeft: 30,
        paddingRight: 12,
        marginLeft: 6,
        marginRight: 6,
        borderRadius: 6,
        cursor: 'pointer',
        userSelect: 'none',
        backgroundColor: active ? C.selected : '#00000000',
        hover: { backgroundColor: active ? C.selected : C.hover },
      }}
    >
      <T size={10.5} weight={700} mono color={METHOD_COLOR[method] ?? C.dim} style={{ width: 38, flexShrink: 0 }}>
        {method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method}
      </T>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <T size={12.5} color={active ? C.text : C.dim} style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>
          {label}
        </T>
        {detail && (
          <T size={11} mono color={detailColor ?? C.faint}>
            {detail}
          </T>
        )}
      </div>
    </div>
  )
}

const MENU: StyleDesc = {
  paddingTop: 4,
  paddingBottom: 4,
  paddingLeft: 4,
  paddingRight: 4,
  borderRadius: 8,
  backgroundColor: C.raised,
  borderWidth: 1,
  borderColor: C.borderStrong,
}

function EnvPicker({ value, names, onChange }: { value: string; names: string[]; onChange: (n: string) => void }) {
  const items = names.map((n) => ({ value: n, label: n }))
  return (
    <Select items={items} value={value} onValueChange={onChange}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <SelectTrigger
          testId="env-picker"
          style={(s) => ({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 26,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: 6,
            cursor: 'pointer',
            backgroundColor: s.open ? C.hover : C.raised,
            hover: { backgroundColor: C.hover },
          })}
        >
          <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: value === 'dev' ? C.green : C.yellow }} />
          <T size={12} mono color={C.text} testId="env-label">
            {value}
          </T>
        </SelectTrigger>
        <SelectContent sideOffset={6} style={{ ...MENU, minWidth: 140 }}>
          {names.map((n) => (
            <SelectItem
              key={n}
              value={n}
              testId={`env-${n}`}
              style={(s) => ({
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                height: 30,
                paddingLeft: 10,
                paddingRight: 10,
                borderRadius: 6,
                cursor: 'pointer',
                backgroundColor: s.highlighted ? C.hover : '#00000000',
              })}
            >
              {(s) => (
                <>
                  <T size={12.5} mono color={C.text} style={{ flexGrow: 1 }}>
                    {n}
                  </T>
                  {s.selected && (
                    <T size={12} color={C.blue}>
                      ✓
                    </T>
                  )}
                </>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </div>
    </Select>
  )
}

/* ───────────────────────── Request bar ───────────────────────── */

function RequestBar({
  draft,
  vars,
  loading,
  compact,
  urlRef,
  onMethod,
  onUrl,
  onSend,
  onCancel,
  onSave,
  onCurl,
}: {
  draft: RequestDraft
  vars: Vars
  loading: boolean
  compact: boolean
  urlRef: React.RefObject<{ id: number } | null>
  onMethod: (m: Method) => void
  onUrl: (u: string) => void
  onSend: () => void
  onCancel: () => void
  onSave: () => void
  onCurl: () => void
}) {
  const hasVars = /\{\{/.test(draft.url)
  const missing = missingVars(draft.url, vars)
  const resolved = interpolate(draft.url, vars)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 12, paddingBottom: hasVars ? 8 : 12, paddingLeft: 14, paddingRight: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.borderStrong,
            backgroundColor: C.panel,
          }}
        >
          <MethodPicker value={draft.method} onChange={onMethod} />
          <div style={{ width: 1, height: 20, backgroundColor: C.border }} />
          <input
            ref={urlRef as never}
            testId="url"
            value={draft.url}
            placeholder="https://api.example.com/v1/…   or   {{base}}/path"
            theme={THEME}
            onChange={(e) => onUrl(e.value ?? '')}
            onSubmit={onSend}
            style={{
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              height: 36,
              paddingLeft: 10,
              paddingRight: 10,
              fontSize: 13.5,
              fontFamily: MONO,
              color: C.text,
              backgroundColor: '#00000000',
              borderWidth: 0,
            }}
          />
        </div>
        {loading ? (
          <Button testId="cancel" onClick={onCancel} style={{ height: 38, paddingLeft: 16, paddingRight: 16 }}>
            <T size={13} weight={600} color={C.red}>
              Cancel
            </T>
          </Button>
        ) : (
          <Button testId="send" primary onClick={onSend} style={{ height: 38, paddingLeft: 18, paddingRight: 16 }}>
            <T size={13} weight={700} color={C.bg}>
              Send
            </T>
            <T size={12} mono color="#0a0c10aa">
              ↵
            </T>
          </Button>
        )}
        <Button testId="save" onClick={onSave} style={{ height: 38 }}>
          <T size={12.5} weight={500} color={C.dim}>
            Save
          </T>
        </Button>
        <Button testId="copy-curl" onClick={onCurl} style={{ height: 38 }}>
          <T size={12.5} mono color={C.dim}>
            {compact ? 'curl' : '$ curl'}
          </T>
        </Button>
      </div>
      {hasVars && (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, paddingLeft: 4, minWidth: 0 }}>
          <T size={11.5} mono color={C.ghost}>
            →
          </T>
          <T testId="resolved-url" size={11.5} mono color={missing.length ? C.red : C.faint} style={{ overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>
            {missing.length ? `missing ${missing.map((m) => `{{${m}}}`).join(', ')}` : resolved}
          </T>
        </div>
      )}
    </div>
  )
}

function MethodPicker({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  const items = METHODS.map((m) => ({ value: m, label: m }))
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(v as Method)}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <SelectTrigger
          testId="method"
          style={(s) => ({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 36,
            width: 96,
            paddingLeft: 12,
            paddingRight: 8,
            borderRadius: 7,
            cursor: 'pointer',
            backgroundColor: s.open ? C.hover : '#00000000',
            hover: { backgroundColor: C.hover },
          })}
        >
          <T testId="method-label" size={13} weight={700} mono color={METHOD_COLOR[value] ?? C.text} style={{ flexGrow: 1 }}>
            {value}
          </T>
          <T size={9} color={C.faint}>
            ▼
          </T>
        </SelectTrigger>
        <SelectContent sideOffset={6} style={{ ...MENU, minWidth: 130 }}>
          {METHODS.map((m) => (
            <SelectItem
              key={m}
              value={m}
              testId={`method-${m}`}
              style={(s) => ({
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                height: 30,
                paddingLeft: 10,
                paddingRight: 10,
                borderRadius: 6,
                cursor: 'pointer',
                backgroundColor: s.highlighted ? C.hover : '#00000000',
              })}
            >
              <T size={12.5} weight={700} mono color={METHOD_COLOR[m] ?? C.text}>
                {m}
              </T>
            </SelectItem>
          ))}
        </SelectContent>
      </div>
    </Select>
  )
}

/* ───────────────────────── Request editor ───────────────────────── */

function RequestEditor({
  draft,
  tab,
  onTab,
  update,
}: {
  draft: RequestDraft
  tab: 'params' | 'headers' | 'body'
  onTab: (t: 'params' | 'headers' | 'body') => void
  update: (p: Partial<RequestDraft>) => void
}) {
  // GPUI's editor sizes its scroll viewport from rows, not from the laid-out box, so cap rows to what fits.
  const [editorRows, setEditorRows] = useState(0)
  const params = parseQuery(draft.url)
  const bodyCheck = draft.bodyType === 'json' && draft.body.trim() ? parseJson(draft.body) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 18, paddingLeft: 16, paddingRight: 12, borderBottomWidth: 1, borderColor: C.border }}>
        <Tab label="Params" count={params.length} active={tab === 'params'} onClick={() => onTab('params')} testId="tab-params" />
        <Tab label="Headers" count={draft.headers.filter((h) => h.enabled && h.key).length} active={tab === 'headers'} onClick={() => onTab('headers')} testId="tab-headers" />
        <Tab label="Body" active={tab === 'body'} onClick={() => onTab('body')} testId="tab-body" />
        <div style={{ flexGrow: 1 }} />
        {tab === 'body' && (
          <div style={{ display: 'flex', flexDirection: 'row', gap: 2, padding: 2, borderRadius: 6, backgroundColor: C.raised }}>
            {(['json', 'text', 'none'] as const).map((t) => (
              <div
                key={t}
                testId={`body-${t}`}
                onClick={() => update({ bodyType: t })}
                style={{ display: 'flex', paddingLeft: 8, paddingRight: 8, height: 22, alignItems: 'center', borderRadius: 4, cursor: 'pointer', backgroundColor: draft.bodyType === t ? C.selected : '#00000000' }}
              >
                <T size={11} mono color={draft.bodyType === t ? C.text : C.faint}>
                  {t === 'json' ? 'JSON' : t === 'text' ? 'Text' : 'None'}
                </T>
              </div>
            ))}
          </div>
        )}
      </div>
      {tab === 'params' && (
        <KVTable
          testPrefix="param"
          rows={params.map((p, i) => ({ id: `p${i}`, key: p.key, value: p.value, enabled: true }))}
          keyPlaceholder="query param"
          onChange={(rows) => update({ url: withQuery(draft.url, rows) })}
          empty="Query parameters stay in sync with the URL."
        />
      )}
      {tab === 'headers' && (
        <KVTable
          testPrefix="header"
          toggles
          rows={draft.headers}
          keyPlaceholder="Header"
          onChange={(rows) => update({ headers: rows })}
          empty="Use {{variables}} from the active environment."
        />
      )}
      {tab === 'body' &&
        (draft.bodyType === 'none' ? (
          <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
            <T size={12.5} color={C.faint}>
              This request has no body
            </T>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
            <div
              onLayout={(e) => setEditorRows(Math.max(2, Math.floor(((e.height ?? 0) - 10) / 20)))}
              style={{ display: 'flex', position: 'relative', flexGrow: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden' }}
            >
              <textarea
                testId="body"
                value={draft.body}
                placeholder={draft.bodyType === 'json' ? '{\n  "key": "value"\n}' : 'Request body'}
                theme={THEME}
                minRows={editorRows ? Math.min(4, editorRows) : 4}
                maxRows={editorRows || undefined}
                onChange={(e) => update({ body: e.value ?? '' })}
                style={{ position: 'absolute', top: 10, left: 8, right: 8, fontSize: 13, lineHeight: 20, fontFamily: MONO, color: C.text, backgroundColor: '#00000000', borderWidth: 0, paddingLeft: 8, paddingRight: 8 }}
              />
            </div>
            {draft.bodyType === 'json' && (
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 34, paddingLeft: 16, paddingRight: 12, borderTopWidth: 1, borderColor: C.border }}>
                <T testId="body-status" size={11.5} mono color={bodyCheck == null ? C.faint : bodyCheck.ok ? C.green : C.red} style={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {bodyCheck == null ? 'empty' : bodyCheck.ok ? '✓ valid JSON' : `✕ ${bodyCheck.error}`}
                </T>
                <div
                  testId="format-body"
                  onClick={() => bodyCheck?.ok && update({ body: JSON.stringify(bodyCheck.value, null, 2) })}
                  style={{ display: 'flex', paddingLeft: 8, paddingRight: 8, height: 24, alignItems: 'center', borderRadius: 5, cursor: 'pointer', hover: { backgroundColor: C.hover } }}
                >
                  <T size={11.5} color={C.dim}>
                    Format
                  </T>
                </div>
              </div>
            )}
          </div>
        ))}
    </div>
  )
}

interface Row {
  id: string
  key: string
  value: string
  enabled: boolean
}

function KVTable({
  rows,
  onChange,
  toggles,
  keyPlaceholder,
  empty,
  testPrefix,
}: {
  rows: Row[]
  onChange: (rows: KV[]) => void
  toggles?: boolean
  keyPlaceholder: string
  empty: string
  testPrefix: string
}) {
  // The blank row's key becomes the new row's id, so its input keeps focus while you type.
  const blankId = useRef(uid('h'))
  if (rows.some((r) => r.id === blankId.current)) blankId.current = uid('h')
  const blankKey = testPrefix === 'param' ? `p${rows.length}` : blankId.current
  const all: (Row & { blank?: boolean })[] = [...rows, { id: blankKey, key: '', value: '', enabled: true, blank: true }]
  const set = (id: string, patch: Partial<Row>) => {
    const exists = rows.some((r) => r.id === id)
    onChange(exists ? rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) : [...rows, { id, key: '', value: '', enabled: true, ...patch }])
  }
  const field: StyleDesc = {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 30,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 12.5,
    fontFamily: MONO,
    color: C.text,
    backgroundColor: '#00000000',
    borderWidth: 0,
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'scroll', paddingTop: 6, paddingLeft: 8, paddingRight: 8 }}>
      {all.map((r, i) => (
        <div
          key={r.id}
          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, borderBottomWidth: 1, borderColor: C.border, opacity: r.enabled || r.blank ? 1 : 0.45 }}
        >
          {toggles && (
            <div
              testId={`${testPrefix}-toggle-${i}`}
              onClick={() => !r.blank && set(r.id, { enabled: !r.enabled })}
              style={{ display: 'flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <div
                style={{
                  display: 'flex',
                  width: 13,
                  height: 13,
                  borderRadius: 3,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: r.enabled && !r.blank ? C.blue : C.borderStrong,
                  backgroundColor: r.enabled && !r.blank ? C.blue : '#00000000',
                }}
              >
                {r.enabled && !r.blank && (
                  <T size={9} weight={700} color={C.bg}>
                    ✓
                  </T>
                )}
              </div>
            </div>
          )}
          <input
            testId={`${testPrefix}-key-${i}`}
            value={r.key}
            placeholder={r.blank ? keyPlaceholder : ''}
            theme={THEME}
            onChange={(e) => set(r.id, { key: e.value ?? '' })}
            style={{ ...field, color: C.blue }}
          />
          <input
            testId={`${testPrefix}-value-${i}`}
            value={r.value}
            placeholder={r.blank ? 'value' : ''}
            theme={THEME}
            onChange={(e) => set(r.id, { value: e.value ?? '' })}
            style={{ ...field, flexGrow: 1.5 }}
          />
          <div
            testId={`${testPrefix}-remove-${i}`}
            onClick={() => !r.blank && onChange(rows.filter((x) => x.id !== r.id))}
            style={{ display: 'flex', width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 5, cursor: r.blank ? 'default' : 'pointer', hover: r.blank ? undefined : { backgroundColor: C.hover } }}
          >
            <T size={13} color={r.blank ? '#00000000' : C.faint}>
              ×
            </T>
          </div>
        </div>
      ))}
      {rows.length === 0 && (
        <T size={11.5} color={C.ghost} style={{ paddingLeft: 10, paddingTop: 10 }}>
          {empty}
        </T>
      )}
    </div>
  )
}

/* ───────────────────────── Response ───────────────────────── */

function ResponsePane({
  state,
  now,
  tab,
  onTab,
  collapsed,
  setCollapsed,
  query,
  setQuery,
  raw,
  setRaw,
  searchRef,
  compact,
}: {
  state: ResponseState
  now: number
  tab: 'body' | 'headers' | 'timing'
  onTab: (t: 'body' | 'headers' | 'timing') => void
  collapsed: Set<string>
  setCollapsed: (s: Set<string>) => void
  query: string
  setQuery: (q: string) => void
  raw: boolean
  setRaw: (r: boolean) => void
  searchRef: React.RefObject<{ id: number } | null>
  compact: boolean
}) {
  if (state.kind === 'idle') {
    return (
      <Centered>
        <T size={28} weight={700} mono color={C.ghost}>
          ❯ req
        </T>
        <T size={13} color={C.faint} style={{ marginTop: 10 }}>
          Pick a request on the left, or type a URL and press ↵
        </T>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 18 }}>
          {[
            ['⌃↵', 'send from anywhere'],
            ['⌃S', 'save to a collection'],
            ['⌃Y', 'copy as curl (OSC 52)'],
            ['⌃F', 'search the response'],
          ].map(([k, label]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
              <T size={12} mono color={C.blue} style={{ width: 28 }}>
                {k!}
              </T>
              <T size={12} color={C.faint}>
                {label!}
              </T>
            </div>
          ))}
        </div>
      </Centered>
    )
  }
  if (state.kind === 'loading') {
    return (
      <Centered>
        <T testId="loading" size={13} mono color={C.blue}>
          {'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(now / 80) % 10]} sending…
        </T>
        <T size={28} weight={700} mono color={C.text} style={{ marginTop: 8 }}>
          {formatMs(now - state.started)}
        </T>
        <T size={12} color={C.faint} style={{ marginTop: 6 }}>
          esc to cancel
        </T>
      </Centered>
    )
  }
  if (state.kind === 'error') {
    const refused = /ECONNREFUSED|Connection refused|Failed to connect/i.test(state.message)
    return (
      <Centered>
        <T size={13} weight={700} mono color={C.red}>
          ✕ Request failed
        </T>
        <T testId="error-message" size={12.5} mono color={C.dim} style={{ marginTop: 8, whiteSpace: 'normal', maxWidth: 520 }}>
          {state.message}
        </T>
        {refused && (
          <T size={12} color={C.faint} style={{ marginTop: 12 }}>
            Is the server up? Split the pane (⌘D) and run  bun server.ts
          </T>
        )}
      </Centered>
    )
  }
  const { res } = state
  const type = res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, height: 44, paddingLeft: 16, paddingRight: 14, borderBottomWidth: 1, borderColor: C.border }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, paddingLeft: 8, paddingRight: 9, borderRadius: 6, backgroundColor: statusColor(res.status) + '22' }}>
          <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor(res.status) }} />
          <T testId="status" size={12.5} weight={700} mono color={statusColor(res.status)}>
            {`${res.status} ${res.statusText}`}
          </T>
        </div>
        <T testId="total-time" size={12.5} mono color={C.text}>
          {formatMs(res.timings.total)}
        </T>
        <T testId="size" size={12.5} mono color={C.faint}>
          {formatBytes(res.size)}
        </T>
        <div style={{ flexGrow: 1 }} />
        {!compact && <MiniWaterfall res={res} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 18, paddingLeft: 16, paddingRight: 12, borderBottomWidth: 1, borderColor: C.border }}>
        <Tab label="Body" active={tab === 'body'} onClick={() => onTab('body')} testId="res-body" />
        <Tab label="Headers" count={res.headers.length} active={tab === 'headers'} onClick={() => onTab('headers')} testId="res-headers" />
        <Tab label="Timing" active={tab === 'timing'} onClick={() => onTab('timing')} testId="res-timing" />
      </div>
      {tab === 'body' && (
        <BodyView
          body={res.body}
          contentType={type}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          query={query}
          setQuery={setQuery}
          raw={raw}
          setRaw={setRaw}
          searchRef={searchRef}
        />
      )}
      {tab === 'headers' && (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'scroll', paddingTop: 6, paddingLeft: 16, paddingRight: 16 }}>
          <T size={11.5} mono color={C.faint} style={{ paddingTop: 4, paddingBottom: 8 }}>
            {`HTTP/${res.httpVersion} ${res.status} ${res.statusText} · ${res.remoteAddress}`}
          </T>
          {res.headers.map(([k, v], i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'row', gap: 14, paddingTop: 5, paddingBottom: 5, borderBottomWidth: 1, borderColor: C.border }}>
              <T size={12.5} mono color={C.blue} style={{ width: 210, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {k}
              </T>
              <T size={12.5} mono color={C.text} style={{ whiteSpace: 'normal', flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                {v}
              </T>
            </div>
          ))}
        </div>
      )}
      {tab === 'timing' && <TimingView res={res} url={state.wire.url} />}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 }}>
      {children}
    </div>
  )
}

const PHASES = [
  ['dns', 'DNS lookup'],
  ['connect', 'TCP connect'],
  ['tls', 'TLS handshake'],
  ['ttfb', 'Waiting (TTFB)'],
  ['download', 'Download'],
] as const

function MiniWaterfall({ res }: { res: WireResponse }) {
  const total = Math.max(res.timings.total, 0.001)
  const W = 150
  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: W, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: C.raised }}>
      {PHASES.map(([k]) => {
        const w = (res.timings[k] / total) * W
        return w > 0.5 ? <div key={k} style={{ width: w, height: 6, backgroundColor: PHASE_COLOR[k] }} /> : null
      })}
    </div>
  )
}

function TimingView({ res, url }: { res: WireResponse; url: string }) {
  const [track, setTrack] = useState(0)
  const total = Math.max(res.timings.total, 0.001)
  let offset = 0
  const secure = url.startsWith('https:')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, paddingTop: 18, paddingLeft: 18, paddingRight: 18, gap: 4 }}>
      {PHASES.map(([k, label]) => {
        const d = res.timings[k]
        const start = offset
        offset += d
        const skip = k === 'tls' && !secure
        return (
          <div key={k} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, height: 30 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: skip ? C.ghost : PHASE_COLOR[k] }} />
            <T size={12.5} color={skip ? C.ghost : C.dim} style={{ width: 112, flexShrink: 0 }}>
              {label}
            </T>
            <div onLayout={(e) => setTrack(e.width ?? 0)} style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, flexBasis: 0, minWidth: 0, height: 14, borderRadius: 3, backgroundColor: '#ffffff06' }}>
              <div style={{ width: (start / total) * track, height: 14 }} />
              {!skip && <div style={{ width: Math.max(2, (d / total) * track), height: 14, borderRadius: 3, backgroundColor: PHASE_COLOR[k] }} />}
            </div>
            <T testId={`timing-${k}`} size={12.5} mono color={skip ? C.ghost : C.text} style={{ width: 76, flexShrink: 0, textAlign: 'right' }}>
              {skip ? '—' : formatMs(d)}
            </T>
          </div>
        )
      })}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, height: 36, marginTop: 6, borderTopWidth: 1, borderColor: C.border }}>
        <div style={{ width: 8 }} />
        <T size={12.5} weight={600} color={C.text} style={{ width: 112 }}>
          Total
        </T>
        <div style={{ flexGrow: 1 }} />
        <T size={12.5} weight={700} mono color={C.text} style={{ width: 76, textAlign: 'right' }}>
          {formatMs(total)}
        </T>
      </div>
      <T size={11.5} mono color={C.faint} style={{ marginTop: 10 }}>
        {`${res.remoteAddress} · HTTP/${res.httpVersion}${secure ? ' · TLS' : ''} · ${formatBytes(res.size)} on the wire`}
      </T>
    </div>
  )
}

function BodyView({
  body,
  contentType,
  collapsed,
  setCollapsed,
  query,
  setQuery,
  raw,
  setRaw,
  searchRef,
}: {
  body: string
  contentType: string
  collapsed: Set<string>
  setCollapsed: (s: Set<string>) => void
  query: string
  setQuery: (q: string) => void
  raw: boolean
  setRaw: (r: boolean) => void
  searchRef: React.RefObject<{ id: number } | null>
}) {
  const parsed = useMemo(() => (body.trim() ? parseJson(body) : null), [body])
  const isJson = parsed?.ok === true
  const tree = useMemo(() => (isJson ? flattenJson(parsed.value, collapsed, query) : null), [isJson, parsed, collapsed, query])
  const toggle = (p: string) => {
    const n = new Set(collapsed)
    n.has(p) ? n.delete(p) : n.add(p)
    setCollapsed(n)
  }
  const lang = /html/.test(contentType) ? 'html' : /xml/.test(contentType) ? 'xml' : isJson ? 'json' : undefined
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      {isJson && (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 12, paddingRight: 12, borderBottomWidth: 1, borderColor: C.border }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexGrow: 1, flexBasis: 0, minWidth: 0, height: 28, paddingLeft: 8, borderRadius: 6, backgroundColor: C.panel, borderWidth: 1, borderColor: query ? C.blue : C.border }}>
            <T size={12} color={C.faint}>
              ⌕
            </T>
            <input
              ref={searchRef as never}
              testId="json-search"
              value={query}
              placeholder="Filter keys and values   ⌃F"
              theme={THEME}
              onChange={(e) => setQuery(e.value ?? '')}
              style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 26, paddingLeft: 6, paddingRight: 6, fontSize: 12.5, fontFamily: MONO, color: C.text, backgroundColor: '#00000000', borderWidth: 0 }}
            />
            {query && (
              <T testId="match-count" size={11.5} mono color={tree?.matches ? C.yellow : C.red} style={{ paddingRight: 8 }}>
                {tree?.matches ? `${tree.matches} match${tree.matches === 1 ? '' : 'es'}` : 'no matches'}
              </T>
            )}
          </div>
          <Pill testId="expand-all" label="Expand" onClick={() => setCollapsed(new Set())} />
          <Pill testId="collapse-all" label="Collapse" onClick={() => parsed.ok && setCollapsed(new Set(containerPaths(parsed.value)))} />
          <Pill testId="raw-toggle" label={raw ? 'Tree' : 'Raw'} onClick={() => setRaw(!raw)} />
        </div>
      )}
      {isJson && !raw && tree ? (
        <div highlight={query ? { query, color: C.find } : undefined} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
          <virtual-list testId="json-tree" estimatedItemHeight={22} style={{ flexGrow: 1, minHeight: 0, paddingTop: 6, paddingBottom: 12 }}>
            {tree.rows.map((row) => (
              <JsonLine key={row.path} row={row} onToggle={toggle} />
            ))}
          </virtual-list>
        </div>
      ) : body ? (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'scroll', paddingTop: 8, paddingLeft: 12, paddingRight: 12 }}>
          <code testId="raw-body" language={lang} theme={THEME} style={{ fontSize: 12.5, lineHeight: 19, fontFamily: MONO, width: '100%' }}>
            {isJson ? JSON.stringify(parsed.value, null, 2) : body.slice(0, 200_000)}
          </code>
        </div>
      ) : (
        <Centered>
          <T size={12.5} color={C.faint}>
            Empty body
          </T>
        </Centered>
      )}
    </div>
  )
}

function Pill({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', height: 26, paddingLeft: 9, paddingRight: 9, borderRadius: 6, cursor: 'pointer', userSelect: 'none', backgroundColor: C.raised, hover: { backgroundColor: C.hover } }}
    >
      <T size={11.5} color={C.dim}>
        {label}
      </T>
    </div>
  )
}

const VALUE_COLOR: Record<string, string> = {
  string: C.green,
  number: C.yellow,
  boolean: C.red,
  null: C.red,
}

function JsonLine({ row, onToggle }: { row: JsonRow; onToggle: (path: string) => void }) {
  const container = row.kind === 'open'
  const brackets = row.type === 'array' ? ['[', ']'] : ['{', '}']
  const comma = row.comma ? (
    <T size={12.5} mono color={C.ghost}>
      ,
    </T>
  ) : null
  const key =
    row.key !== null && row.kind !== 'close' ? (
      <T size={12.5} mono color={typeof row.key === 'number' ? C.faint : C.blue}>
        {typeof row.key === 'number' ? `${row.key}: ` : `"${row.key}": `}
      </T>
    ) : null
  return (
    <div
      testId={container ? `node-${row.path}` : undefined}
      onClick={container && row.count > 0 ? () => onToggle(row.path) : undefined}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        height: 22,
        paddingLeft: 12 + row.depth * 18,
        paddingRight: 12,
        cursor: container && row.count > 0 ? 'pointer' : 'default',
        hover: { backgroundColor: '#ffffff08' },
      }}
    >
      <T size={8} color={C.faint} style={{ width: 14, flexShrink: 0 }}>
        {container && row.count > 0 ? (row.collapsed ? '▶' : '▼') : ' '}
      </T>
      {key}
      {row.kind === 'leaf' && (
        <T size={12.5} mono color={VALUE_COLOR[row.type] ?? C.text} style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.text}
        </T>
      )}
      {row.kind === 'open' && row.collapsed && (
        <>
          <T size={12.5} mono color={C.dim}>
            {row.count === 0 ? brackets.join('') : `${brackets[0]} … ${brackets[1]}`}
          </T>
          {comma}
          {row.count > 0 && (
            <T size={11.5} mono color={C.ghost} style={{ marginLeft: 8 }}>
              {row.type === 'array' ? `${row.count} items` : `${row.count} keys`}
            </T>
          )}
        </>
      )}
      {row.kind === 'open' && !row.collapsed && (
        <T size={12.5} mono color={C.dim}>
          {brackets[0]!}
        </T>
      )}
      {row.kind === 'close' && (
        <T size={12.5} mono color={C.dim}>
          {brackets[1]!}
        </T>
      )}
      {(row.kind === 'leaf' || row.kind === 'close') && comma}
    </div>
  )
}

/* ───────────────────────── Status bar + dialogs ───────────────────────── */

function StatusBar({ env, toast, compact }: { env: string; toast: { text: string; color: string } | null; compact: boolean }) {
  const hints = compact
    ? [['↵', 'send'], ['⌃C', 'quit']]
    : [['↵', 'send'], ['⌃S', 'save'], ['⌃Y', 'curl'], ['⌃F', 'find'], ['⌃C', 'quit']]
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, height: 28, paddingLeft: 14, paddingRight: 14, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.panel, userSelect: 'none' }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: env === 'dev' ? C.green : C.yellow }} />
      <T size={11.5} mono color={C.dim}>
        {env}
      </T>
      {toast ? (
        <T testId="toast" size={11.5} mono color={toast.color} style={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {`● ${toast.text}`}
        </T>
      ) : (
        <div style={{ flexGrow: 1 }} />
      )}
      {hints.map(([k, l]) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
          <T size={11.5} mono color={C.blue}>
            {k!}
          </T>
          <T size={11.5} color={C.faint}>
            {l!}
          </T>
        </div>
      ))}
    </div>
  )
}

const POPUP: StyleDesc = {
  width: 460,
  padding: 20,
  borderRadius: 12,
  backgroundColor: C.raised,
  borderWidth: 1,
  borderColor: C.borderStrong,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const FIELD: StyleDesc = {
  height: 34,
  paddingLeft: 10,
  paddingRight: 10,
  borderRadius: 7,
  borderWidth: 1,
  borderColor: C.borderStrong,
  backgroundColor: C.bg,
  fontSize: 13,
  fontFamily: MONO,
  color: C.text,
}

function SaveDialog({
  open,
  onOpenChange,
  initialName,
  collections,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initialName: string
  collections: { value: string; label: string }[]
  onSave: (collectionId: string, name: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [col, setCol] = useState(collections[0]?.value ?? '')
  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop style={{ backgroundColor: '#000000aa' }} />
        <DialogPopup testId="save-dialog" style={POPUP}>
          <DialogTitle>
            <T size={15} weight={600}>
              Save request
            </T>
          </DialogTitle>
          <T size={12} color={C.faint}>
            Name
          </T>
          <input testId="save-name" value={name} theme={THEME} onChange={(e) => setName(e.value ?? '')} onSubmit={() => onSave(col, name)} style={FIELD} />
          <T size={12} color={C.faint}>
            Collection
          </T>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {collections.map((c) => (
              <div
                key={c.value}
                testId={`save-col-${c.value}`}
                onClick={() => setCol(c.value)}
                style={{ display: 'flex', alignItems: 'center', height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 6, cursor: 'pointer', borderWidth: 1, borderColor: col === c.value ? C.blue : C.border, backgroundColor: col === c.value ? C.blueSoft : '#00000000' }}
              >
                <T size={12.5} color={col === c.value ? C.text : C.dim}>
                  {c.label}
                </T>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <DialogClose testId="save-cancel">
              <Button>
                <T size={12.5} color={C.dim}>
                  Cancel
                </T>
              </Button>
            </DialogClose>
            <Button testId="save-confirm" primary onClick={() => onSave(col, name.trim() || 'Untitled request')}>
              <T size={12.5} weight={700} color={C.bg}>
                Save
              </T>
            </Button>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}

function EnvDialog({
  open,
  onOpenChange,
  name,
  vars,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  name: string
  vars: Vars
  onSave: (v: Vars) => void
}) {
  const [rows, setRows] = useState<KV[]>([])
  useEffect(() => {
    if (open) setRows(Object.entries(vars).map(([k, v]) => ({ id: uid('v'), key: k, value: v, enabled: true })))
  }, [open, vars])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop style={{ backgroundColor: '#000000aa' }} />
        <DialogPopup testId="env-dialog" style={{ ...POPUP, width: 560, height: 420 }}>
          <DialogTitle>
            <T size={15} weight={600}>
              {`Environment · ${name}`}
            </T>
          </DialogTitle>
          <T size={12} color={C.faint}>
            {'Reference with {{name}}. A value like $GITHUB_PAT reads your shell env and is never saved.'}
          </T>
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg }}>
            <KVTable testPrefix="var" rows={rows} keyPlaceholder="variable" empty="" onChange={setRows} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <DialogClose testId="env-cancel">
              <Button>
                <T size={12.5} color={C.dim}>
                  Cancel
                </T>
              </Button>
            </DialogClose>
            <Button testId="env-save" primary onClick={() => onSave(Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value])))}>
              <T size={12.5} weight={700} color={C.bg}>
                Save
              </T>
            </Button>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
