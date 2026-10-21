import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTerminal, useGpuixRequired, useWindowSize, type KeyEvent, type NativeRenderer } from '@gpuix/react'
import { mergeRun, runTests, type RunResult, type Status, type TestCase } from './runner'
import { appendHistory, loadHistory, type HistoryEntry } from './history'
import { watchProject } from './watch'
import { MONO, P } from './theme'
import type { GpuixTheme } from '@gpuix/native/host'
import { Button, Col, Kbd, Row, STATUS_ICON, Txt, fmtMs, statusColor } from './ui'

type Filter = 'all' | 'fail' | 'pass' | 'skip'
type TreeRow =
  | { kind: 'file'; key: string; file: string; counts: Record<Status, number>; timeMs: number }
  | { kind: 'suite'; key: string; name: string; depth: number }
  | { kind: 'test'; key: string; test: TestCase; depth: number }

export const keyBridge: { current: ((e: KeyEvent, r: NativeRenderer) => void) | null } = { current: null }

const nativeTheme: GpuixTheme = {
  appearance: 'dark',
  bg: P.bg,
  border: P.border,
  text: P.text,
  textMuted: P.text2,
  textFaint: P.text3,
  accent: P.blue,
  caret: P.blue,
  codeText: P.text,
  diffAdd: P.green,
  diffDel: P.red,
  fontMono: MONO,
  syntax: { keyword: P.red, string: '#addcff', function: '#91cbff', number: P.blue, boolean: P.blue, comment: P.text3, typeName: '#ffb757', variable: P.text, property: P.blue, punctuation: P.text2, constant: P.blue, operator: P.red, parameter: P.text, constructor: '#ffb757' },
}
const LINE_H = 20

export interface AppProps {
  dir: string
  watch?: boolean
  namePattern?: string
  initialFilter?: Filter
}

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fonts')

function useMonoFont() {
  const renderer = useGpuixRequired()
  useEffect(() => {
    for (const w of ['Regular', 'SemiBold', 'Bold']) {
      try {
        renderer.registerFont?.(readFileSync(join(FONT_DIR, `JetBrainsMono-${w}.ttf`)))
      } catch {}
    }
  }, [renderer])
}

export function App({ dir, watch = true, namePattern, initialFilter = 'all' }: AppProps) {
  useMonoFont()
  const project = useMemo(() => {
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name ?? basename(dir)
    } catch {
      return basename(dir)
    }
  }, [dir])
  const [run, setRun] = useState<RunResult | null>(null)
  const [running, setRunning] = useState<'all' | 'failed' | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory(dir))
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [watching, setWatching] = useState(watch)
  const [changed, setChanged] = useState<string | null>(null)
  const [frameIdx, setFrameIdx] = useState(0)
  const [tick, setTick] = useState(0)
  const searchRef = useRef<{ id: number } | null>(null)
  const typing = useRef(false)
  const runRef = useRef<RunResult | null>(null)
  const busy = useRef(false)
  const queued = useRef(false)
  const { width } = useWindowSize()
  const narrow = width < 1000
  const compact = width < 760
  const term = isTerminal()

  const execute = useCallback(async (mode: 'all' | 'failed') => {
    if (busy.current) {
      queued.current = true
      return
    }
    busy.current = true
    setRunning(mode)
    try {
      const prev = runRef.current
      let next: RunResult
      if (mode === 'failed' && prev && prev.counts.fail > 0) {
        const failed = prev.tests.filter((t) => t.status === 'fail')
        const files = [...new Set(failed.map((t) => t.file))]
        const pattern = failed.map((t) => `^${[...t.suites, t.name].map(esc).join(' ')}$`).join('|')
        next = mergeRun(prev, await runTests(dir, { files, namePattern: pattern }))
      } else {
        next = await runTests(dir, { namePattern })
      }
      runRef.current = next
      setRun(next)
      setHistory((h) => appendHistory(dir, h, next))
      setSelectedId((id) => {
        const firstFail = next.tests.find((t) => t.status === 'fail')
        if (id && next.tests.some((t) => t.id === id) && !(firstFail && mode === 'all' && next.tests.find((t) => t.id === id)?.status !== 'fail')) return id
        return firstFail?.id ?? id ?? next.tests[0]?.id ?? null
      })
      setFrameIdx(0)
    } finally {
      busy.current = false
      setRunning(null)
      if (queued.current) {
        queued.current = false
        void execute('all')
      }
    }
  }, [dir, namePattern])

  useEffect(() => {
    void execute('all')
  }, [execute])

  useEffect(() => {
    if (!watching) return
    return watchProject(dir, (paths) => {
      setChanged(paths[0] ?? null)
      void execute('all')
    })
  }, [dir, watching, execute])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTick((n) => n + 1), 120)
    return () => clearInterval(t)
  }, [running])

  const tests = run?.tests ?? []
  const maxTime = useMemo(() => Math.max(1, ...tests.map((t) => t.timeMs)), [tests])
  const visibleTests = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tests.filter((t) => {
      if (filter === 'fail' && t.status !== 'fail') return false
      if (filter === 'pass' && t.status !== 'pass') return false
      if (filter === 'skip' && t.status !== 'skip' && t.status !== 'todo') return false
      if (q && !t.id.toLowerCase().includes(q)) return false
      return true
    })
  }, [tests, filter, query])

  const rows = useMemo(() => {
    const out: TreeRow[] = []
    const byFile = new Map<string, TestCase[]>()
    for (const t of visibleTests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t])
    const failing = (f: string) => (tests.some((t) => t.file === f && t.status === 'fail') ? 0 : 1)
    const ordered = [...byFile].sort((a, b) => failing(a[0]) - failing(b[0]))
    for (const [file, list] of ordered) {
      const counts: Record<Status, number> = { pass: 0, fail: 0, skip: 0, todo: 0 }
      let timeMs = 0
      for (const t of tests) if (t.file === file) {
        counts[t.status]++
        timeMs += t.timeMs
      }
      out.push({ kind: 'file', key: `file:${file}`, file, counts, timeMs })
      if (collapsed.has(file) && !query) continue
      let prevSuites: string[] = []
      for (const t of list) {
        t.suites.forEach((s, i) => {
          if (prevSuites[i] !== s || prevSuites.slice(0, i).join() !== t.suites.slice(0, i).join()) out.push({ kind: 'suite', key: `suite:${file}:${t.suites.slice(0, i + 1).join('›')}`, name: s, depth: i })
        })
        prevSuites = t.suites
        out.push({ kind: 'test', key: t.id, test: t, depth: t.suites.length })
      }
    }
    return out
  }, [visibleTests, tests, collapsed, query])

  const testRows = useMemo(() => rows.filter((r): r is Extract<TreeRow, { kind: 'test' }> => r.kind === 'test'), [rows])
  const selected = tests.find((t) => t.id === selectedId) ?? null

  const move = useCallback((delta: number) => {
    if (!testRows.length) return
    const i = testRows.findIndex((r) => r.test.id === selectedId)
    const next = Math.max(0, Math.min(testRows.length - 1, (i < 0 ? (delta > 0 ? -1 : testRows.length) : i) + delta))
    setSelectedId(testRows[next].test.id)
    setFrameIdx(0)
  }, [testRows, selectedId])

  const toggleFile = (file: string) => setCollapsed((s) => {
    const n = new Set(s)
    if (n.has(file)) n.delete(file)
    else n.add(file)
    return n
  })

  keyBridge.current = (event, r) => {
    const key = event.key ?? ''
    const mods = event.modifiers ?? ({} as NonNullable<KeyEvent['modifiers']>)
    const focused = r.getFocusedElementId?.() ?? null
    const inSearch = typing.current || (focused != null && focused === searchRef.current?.id)
    if (key === 'escape') {
      if (query) setQuery('')
      r.blur?.()
      typing.current = false
      return
    }
    if (inSearch) {
      if (key === 'enter' || key === 'down') {
        r.blur?.()
        typing.current = false
        if (testRows[0]) setSelectedId(testRows[0].test.id)
      }
      return
    }
    if (mods.cmd || mods.ctrl || mods.alt) return
    if (key === '/' ) {
      if (searchRef.current) r.focusElement?.(searchRef.current.id)
      typing.current = true
    } else if (key === 'j' || key === 'down') move(1)
    else if (key === 'k' || key === 'up') move(-1)
    else if (key === 'g') move(mods.shift ? 1e9 : -1e9)
    else if (key === 'f' || key === 'F') void execute('failed')
    else if (key === 'r' || key === 'R') void execute('all')
    else if (key === 'w') setWatching((w) => !w)
    else if (key === '1') setFilter('all')
    else if (key === '2') setFilter('fail')
    else if (key === '3') setFilter('pass')
    else if (key === '4') setFilter('skip')
    else if (key === 'n' && selected?.failure) setFrameIdx((i) => (i + 1) % Math.max(1, selected.failure!.frames.length))
    else if ((key === 'enter' || key === 'space') && selected) toggleFile(selected.file)
  }

  const counts = run?.counts ?? { pass: 0, fail: 0, skip: 0, todo: 0 }
  const allGreen = run != null && counts.fail === 0 && !run.error
  const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[tick % 10]

  const header = (
    <Row gap={14} style={{ height: 54, paddingLeft: term ? 18 : 86, paddingRight: 16, borderBottomWidth: 1, borderColor: P.border, flexShrink: 0 }}>
      <Row gap={9}>
        <div style={{ display: 'flex', width: 22, height: 22, borderRadius: 6, backgroundColor: run == null ? P.raised : allGreen ? P.green : P.red, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={13} weight={800} color={P.bg} testId="badge">{run == null ? '·' : allGreen ? '✓' : '✕'}</Txt>
        </div>
        <Txt size={15} weight={700}>testdeck</Txt>
        {!compact && <Txt size={13} color={P.text3}>/</Txt>}
        {!compact && <Txt size={13.5} weight={500} color={P.text2} testId="project">{project}</Txt>}
      </Row>
      <div style={{ flexGrow: 1 }} />
      <Row gap={14}>
        <Stat testId="count-pass" n={counts.pass} label="passed" color={P.green} />
        <Stat testId="count-fail" n={counts.fail} label="failed" color={counts.fail ? P.red : P.text3} />
        {!compact && <Stat testId="count-skip" n={counts.skip + counts.todo} label="skipped" color={P.yellow} />}
        <Txt size={12.5} mono color={P.text2} testId="duration">{run ? fmtMs(run.durationMs) : '—'}</Txt>
      </Row>
      {!narrow && <Sparkline history={history} />}
    </Row>
  )

  const filters: { value: Filter; label: string; n: number; key: string }[] = [
    { value: 'all', label: 'All', n: tests.length, key: '1' },
    { value: 'fail', label: 'Failed', n: counts.fail, key: '2' },
    { value: 'pass', label: 'Passed', n: counts.pass, key: '3' },
    { value: 'skip', label: 'Skipped', n: counts.skip + counts.todo, key: '4' },
  ]

  const toolbar = (
    <Row gap={10} style={{ height: 48, paddingLeft: 14, paddingRight: 14, flexShrink: 0, borderBottomWidth: 1, borderColor: P.border, backgroundColor: P.panel }}>
      <input
        ref={searchRef as never}
        testId="search"
        value={query}
        placeholder="Filter tests   /"
        onChange={(e) => setQuery(e.value ?? '')}
        onFocus={() => (typing.current = true)}
        onBlur={() => (typing.current = false)}
        theme={nativeTheme}
        style={{ width: compact ? 150 : 230, height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 7, backgroundColor: P.bg, borderWidth: 1, borderColor: P.border, color: P.text, fontSize: 12.5 }}
      />
      <Row gap={2} style={{ backgroundColor: P.bg, borderRadius: 8, padding: 2, borderWidth: 1, borderColor: P.border }}>
        {filters.map((f) => {
          const active = f.value === filter
          return (
            <Row key={f.value} gap={6} testId={`filter-${f.value}`} onClick={() => setFilter(f.value)} style={{ height: 24, paddingLeft: 9, paddingRight: 9, borderRadius: 6, backgroundColor: active ? P.raised : undefined, cursor: 'pointer', hover: active ? undefined : { backgroundColor: P.hover } }}>
              <Txt size={12} weight={active ? 650 : 500} color={active ? P.text : P.text2}>{f.label}</Txt>
              {!compact && <Txt size={11} mono color={f.value === 'fail' && f.n ? P.red : P.text3}>{String(f.n)}</Txt>}
            </Row>
          )
        })}
      </Row>
      <div style={{ flexGrow: 1 }} />
      {!compact && <Button testId="rerun-failed" label="Rerun failed" hint="f" tone={counts.fail ? P.red : undefined} disabled={!counts.fail} onClick={() => void execute('failed')} />}
      <Button testId="run-all" label={compact ? 'Run' : 'Run all'} hint="r" onClick={() => void execute('all')} />
    </Row>
  )

  const tree = (
    <div testId="tree" style={{ display: 'flex', flexDirection: 'column', flexGrow: narrow ? 0 : 0, flexShrink: 0, width: narrow ? undefined : Math.min(520, Math.max(380, width * 0.36)), height: narrow ? '46%' : undefined, minHeight: 0, borderRightWidth: narrow ? 0 : 1, borderBottomWidth: narrow ? 1 : 0, borderColor: P.border }}>
      {run == null ? (
        <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }} gap={6}>
          <Txt size={13} color={P.text2}>{`${spinner} Running bun test…`}</Txt>
        </Col>
      ) : rows.length === 0 ? (
        <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }} gap={6}>
          <Txt size={13} color={P.text2} testId="empty">{filter === 'fail' ? 'No failing tests' : 'No tests match'}</Txt>
        </Col>
      ) : (
        <virtual-list estimatedItemHeight={30} style={{ flexGrow: 1, minHeight: 0, paddingTop: 4, paddingBottom: 8 }}>
          {rows.map((row) => <TreeRowView key={row.key} row={row} maxTime={maxTime} selected={row.kind === 'test' && row.test.id === selectedId} collapsed={row.kind === 'file' && collapsed.has(row.file)} onSelect={(id) => { setSelectedId(id); setFrameIdx(0) }} onToggle={toggleFile} narrow={compact} />)}
        </virtual-list>
      )}
    </div>
  )

  const footer = (
    <Row gap={12} style={{ height: 30, paddingLeft: 16, paddingRight: 16, borderTopWidth: 1, borderColor: P.border, flexShrink: 0, backgroundColor: P.panel }}>
      {running ? (
        <Txt size={12} color={P.yellow} testId="status">{`${spinner} ${running === 'failed' ? 'Re-running failed tests' : changed ? `${changed} changed · running` : 'Running'}…`}</Txt>
      ) : (
        <Txt size={12} color={watching ? P.green : P.text3} testId="status">{watching ? '● watching' : '○ watch off'}</Txt>
      )}
      {!compact && run && <Txt size={12} color={P.text3}>{`${run.tests.length} tests · ${run.files.length} files · ${new Date(run.startedAt).toLocaleTimeString('en-US', { hour12: false })}`}</Txt>}
      <div style={{ flexGrow: 1 }} />
      {!narrow && (
        <Row gap={10}>
          {[['j k', 'move'], ['/', 'filter'], ['f', 'rerun failed'], ['w', 'watch'], ['⌃C', 'quit']].map(([k, l]) => (
            <Row key={k} gap={5}>
              <Kbd>{k}</Kbd>
              <Txt size={11.5} color={P.text3}>{l}</Txt>
            </Row>
          ))}
        </Row>
      )}
    </Row>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: P.bg }}>
      {header}
      {toolbar}
      {run?.error && (
        <Col style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10, backgroundColor: P.red + '1f', borderBottomWidth: 1, borderColor: P.red + '55', flexShrink: 0 }} gap={4}>
          <Txt size={12.5} weight={650} color={P.red} testId="run-error">bun test could not load every file</Txt>
          <Txt size={11.5} mono color={P.text2} style={{ whiteSpace: 'normal' }}>{run.error.split('\n').filter((l) => /error|Error/.test(l)).slice(0, 3).join('\n') || run.error.split('\n').slice(-3).join('\n')}</Txt>
        </Col>
      )}
      <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', flexGrow: 1, minHeight: 0 }}>
        {tree}
        <Detail dir={dir} test={selected} maxTime={maxTime} frameIdx={frameIdx} setFrameIdx={setFrameIdx} allGreen={allGreen} counts={counts} />
      </div>
      {footer}
    </div>
  )
}

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function Stat({ n, label, color, testId }: { n: number; label: string; color: string; testId: string }) {
  return (
    <Row gap={6}>
      <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Txt size={13} weight={700} mono color={color === P.text3 ? P.text2 : P.text} testId={testId}>{String(n)}</Txt>
      <Txt size={12.5} color={P.text3}>{label}</Txt>
    </Row>
  )
}

function Sparkline({ history }: { history: HistoryEntry[] }) {
  const last = history.slice(-28)
  const max = Math.max(1, ...last.map((h) => h.durationMs))
  return (
    <Row gap={8} testId="sparkline">
      <Row gap={2} style={{ height: 26, alignItems: 'flex-end' }}>
        {last.map((h, i) => (
          <div key={`${h.at}:${i}`} style={{ width: 4, height: Math.max(3, Math.round((h.durationMs / max) * 26)), borderRadius: 1.5, backgroundColor: h.fail ? P.red : P.green, opacity: i === last.length - 1 ? 1 : 0.7 }} />
        ))}
      </Row>
      <Txt size={11.5} mono color={P.text3} testId="run-count">{`${history.length} runs`}</Txt>
    </Row>
  )
}

function TreeRowView({ row, maxTime, selected, collapsed, onSelect, onToggle, narrow }: { row: TreeRow; maxTime: number; selected: boolean; collapsed: boolean; onSelect: (id: string) => void; onToggle: (f: string) => void; narrow: boolean }) {
  if (row.kind === 'file') {
    const failed = row.counts.fail > 0
    return (
      <div style={{ display: 'flex', width: '100%', paddingTop: 6 }}>
        <Row gap={8} testId={`file-${row.file}`} onClick={() => onToggle(row.file)} style={{ width: '100%', height: 30, paddingLeft: 12, paddingRight: 14, flexGrow: 1, cursor: 'pointer', hover: { backgroundColor: P.hover } }}>
          <Txt size={12} color={P.text3} style={{ width: 10 }}>{collapsed ? '▸' : '▾'}</Txt>
          <Txt size={12} weight={800} color={failed ? P.red : P.green}>{failed ? STATUS_ICON.fail : STATUS_ICON.pass}</Txt>
          <Txt size={13} weight={650} grow mono>{row.file}</Txt>
          <Txt size={11.5} mono color={failed ? P.red : P.text3}>{failed ? `${row.counts.fail}/${row.counts.pass + row.counts.fail}` : String(row.counts.pass)}</Txt>
          {!narrow && <Txt size={11.5} mono color={P.text3}>{fmtMs(row.timeMs)}</Txt>}
        </Row>
      </div>
    )
  }
  if (row.kind === 'suite') {
    return (
      <Row style={{ width: '100%', height: 24, paddingLeft: 34 + row.depth * 16, paddingRight: 14 }}>
        <Txt size={12} weight={600} color={P.text2} grow>{row.name}</Txt>
      </Row>
    )
  }
  const t = row.test
  const c = statusColor(t.status)
  const frac = t.timeMs / maxTime
  return (
    <Row gap={8} testId={`test-${t.name}`} onClick={() => onSelect(t.id)} style={{ width: '100%', height: 28, paddingLeft: 34 + row.depth * 16, paddingRight: 14, backgroundColor: selected ? P.selected : undefined, borderLeftWidth: 2, borderColor: selected ? P.blue : P.bg + '00', cursor: 'pointer', hover: selected ? undefined : { backgroundColor: P.hover } }}>
      <Txt size={12} weight={800} color={c}>{STATUS_ICON[t.status]}</Txt>
      <Txt size={12.5} grow color={t.status === 'skip' || t.status === 'todo' ? P.text3 : t.status === 'fail' ? P.text : P.text}>{t.name}</Txt>
      {!narrow && t.status !== 'skip' && t.status !== 'todo' && (
        <div style={{ display: 'flex', width: 64, height: 4, borderRadius: 2, backgroundColor: P.raised, flexShrink: 0 }}>
          <div style={{ width: Math.max(2, Math.round(frac * 64)), height: 4, borderRadius: 2, backgroundColor: t.status === 'fail' ? P.red : frac > 0.5 ? P.yellow : P.blue }} />
        </div>
      )}
      <Txt size={11} mono color={t.timeMs > maxTime * 0.5 ? P.yellow : P.text3} style={{ width: 52, textAlign: 'right' }}>{t.status === 'skip' || t.status === 'todo' ? t.status : fmtMs(t.timeMs)}</Txt>
    </Row>
  )
}

function readSource(dir: string, file: string): string[] | null {
  const p = file.startsWith('/') ? file : join(dir, file)
  if (!existsSync(p)) return null
  try {
    return readFileSync(p, 'utf8').split('\n')
  } catch {
    return null
  }
}

function Excerpt({ dir, file, line, tone, testId }: { dir: string; file: string; line: number; tone: string; testId: string }) {
  const src = readSource(dir, file)
  if (!src) return null
  const start = Math.max(1, line - 5)
  const end = Math.min(src.length, line + 6)
  const code = src.slice(start - 1, end).join('\n')
  const idx = line - start
  return (
    <Col style={{ borderRadius: 9, borderWidth: 1, borderColor: P.border, overflow: 'hidden', flexShrink: 0 }} testId={testId}>
      <Row style={{ height: 30, paddingLeft: 12, paddingRight: 12, backgroundColor: P.panel, borderBottomWidth: 1, borderColor: P.border }}>
        <Txt size={12} mono color={P.text2} grow>{`${file}:${line}`}</Txt>
      </Row>
      <div style={{ display: 'flex', flexDirection: 'row', position: 'relative', paddingTop: 8, paddingBottom: 8, backgroundColor: P.bg }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 8 + idx * LINE_H, height: LINE_H, backgroundColor: tone + '26', borderLeftWidth: 2, borderColor: tone }} />
        <Col style={{ width: 46, flexShrink: 0, paddingRight: 10 }}>
          {Array.from({ length: end - start + 1 }, (_, i) => (
            <Txt key={i} size={12} mono color={i === idx ? tone : P.text3} style={{ height: LINE_H, lineHeight: LINE_H, textAlign: 'right' }}>{String(start + i)}</Txt>
          ))}
        </Col>
        <code code={code} path={file} theme={nativeTheme} style={{ flexGrow: 1, minWidth: 0, fontFamily: MONO, fontSize: 12.5, lineHeight: LINE_H }} />
      </div>
    </Col>
  )
}

function Detail({ dir, test, maxTime, frameIdx, setFrameIdx, allGreen, counts }: { dir: string; test: TestCase | null; maxTime: number; frameIdx: number; setFrameIdx: (n: number) => void; allGreen: boolean; counts: Record<Status, number> }) {
  if (!test) {
    return (
      <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }} gap={8}>
        <Txt size={14} color={P.text2}>{allGreen ? `All ${counts.pass} tests pass` : 'Select a test'}</Txt>
      </Col>
    )
  }
  const f = test.failure
  const c = statusColor(test.status)
  const frames = f?.frames.length ? f.frames : [{ file: test.file, line: test.line, col: 1 }]
  const frame = frames[Math.min(frameIdx, frames.length - 1)]
  return (
    <div testId="detail" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: 'scroll', padding: 20, gap: 16 }}>
      <Col gap={6} style={{ flexShrink: 0 }}>
        <Row gap={10}>
          <div style={{ display: 'flex', paddingLeft: 8, paddingRight: 8, height: 22, borderRadius: 11, backgroundColor: c + '24', alignItems: 'center' }}>
            <Txt size={11.5} weight={700} color={c} testId="detail-status">{`${STATUS_ICON[test.status]} ${test.status === 'pass' ? 'PASSED' : test.status === 'fail' ? 'FAILED' : test.status === 'todo' ? 'TODO' : 'SKIPPED'}`}</Txt>
          </div>
          <Txt size={12} mono color={P.text3}>{fmtMs(test.timeMs)}</Txt>
          {test.status !== 'skip' && test.status !== 'todo' && <Txt size={12} color={P.text3}>{`· ${Math.round((test.timeMs / maxTime) * 100)}% of slowest`}</Txt>}
        </Row>
        <Txt size={18} weight={700} testId="detail-name" style={{ whiteSpace: 'normal' }}>{test.name}</Txt>
        <Txt size={12.5} mono color={P.text2}>{[test.file, ...test.suites].join('  ›  ')}</Txt>
      </Col>
      {f ? (
        <>
          <Col gap={8} style={{ flexShrink: 0 }}>
            <Txt size={11} weight={700} color={P.text3}>ASSERTION</Txt>
            <Txt size={13.5} mono weight={600} color={P.red} testId="failure-headline" style={{ whiteSpace: 'normal' }}>{f.headline}</Txt>
            {f.expected != null && (
              <Row gap={18}>
                <Row gap={6}><Txt size={12} color={P.text3}>Expected</Txt><Txt size={12.5} mono weight={600} color={P.green} testId="expected">{f.expected}</Txt></Row>
                <Row gap={6}><Txt size={12} color={P.text3}>Received</Txt><Txt size={12.5} mono weight={600} color={P.red} testId="received">{f.received ?? ''}</Txt></Row>
              </Row>
            )}
          </Col>
          {f.patch && (
            <div testId="failure-diff" style={{ display: 'flex', flexDirection: 'column', borderRadius: 9, borderWidth: 1, borderColor: P.border, overflow: 'hidden', flexShrink: 0 }}>
              <diff key={test.id} patch={f.patch} wordDiff theme={nativeTheme} />
            </div>
          )}
          {!f.patch && f.message.split('\n').length > 1 && (
            <Txt size={12} mono color={P.text2} style={{ whiteSpace: 'normal' }}>{f.message.split('\n').slice(1).join('\n').trim()}</Txt>
          )}
          <Col gap={6} style={{ flexShrink: 0 }}>
            <Txt size={11} weight={700} color={P.text3}>STACK</Txt>
            {frames.map((fr, i) => (
              <Row key={`${fr.file}:${fr.line}:${i}`} gap={8} testId={`frame-${i}`} onClick={() => setFrameIdx(i)} style={{ height: 24, paddingLeft: 8, borderRadius: 6, backgroundColor: fr === frame ? P.raised : undefined, cursor: 'pointer', hover: { backgroundColor: P.hover } }}>
                <Txt size={12} color={P.text3}>at</Txt>
                <Txt size={12.5} mono color={fr === frame ? P.blue : P.text2}>{`${fr.file}:${fr.line}:${fr.col}`}</Txt>
              </Row>
            ))}
          </Col>
          <Excerpt key={`${frame.file}:${frame.line}`} dir={dir} file={frame.file} line={frame.line} tone={P.red} testId="source" />
        </>
      ) : (
        <Col gap={8} style={{ flexShrink: 0 }}>
          <Txt size={11} weight={700} color={P.text3}>SOURCE</Txt>
          <Excerpt key={`${test.file}:${test.line}`} dir={dir} file={test.file} line={test.line} tone={c} testId="source" />
        </Col>
      )}
    </div>
  )
}
