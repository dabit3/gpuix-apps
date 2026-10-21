import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyEvent, NativeRenderer } from '@gpuix/react'
import { useGpuixRequired } from '@gpuix/react'
import * as G from './git'
import { buildGraph, type Graph } from './graph'
import { GraphCell, graphWidth, ROW_H } from './GraphView'
import { absoluteDate, buildTree, filterCommits, hashColor, initials, languageFor, relativeTime, toSplitRows, type SplitRow } from './format'
import { AVATAR_COLORS, C, MONO, nativeTheme } from './theme'
import { Button, DiffStat, SectionLabel, Segmented, StatusBadge, Txt } from './ui'

export const DEFAULT_REPO = join(homedir(), '.cache', 'git-lens', 'gpuix')
const DEFAULT_REMOTE = 'https://github.com/remorses/gpuix.git'

type Mode = 'history' | 'changes' | 'readme'
type ViewerTab = 'diff' | 'file' | 'blame'
type DiffMode = 'unified' | 'split'
type Pane = 'sidebar' | 'commits' | 'files' | 'viewer' | 'message'

export interface OpenStats {
  commits: number
  logMs: number
  graphMs: number
  totalMs: number
}

/** The window-level key handler lives outside React so `render({ onKeyDown })` can reach it. */
export const keyBridge: { current: ((event: KeyEvent, renderer: NativeRenderer) => void) | null } = { current: null }

const WINDOW = 140
const LINE_H = 20

function VList<T>({ items, rowHeight, renderRow, listRef, onRange, testKey }: { items: T[]; rowHeight: number; renderRow: (item: T, index: number) => React.ReactNode; listRef?: React.RefObject<{ id: number } | null>; onRange?: (start: number, end: number) => void; testKey?: string }) {
  const [start, setStart] = useState(0)
  const end = Math.min(items.length, start + WINDOW)
  return (
    <virtual-list
      key={testKey}
      ref={listRef as any}
      itemCount={items.length}
      windowStart={start}
      estimatedItemHeight={rowHeight}
      style={{ flexGrow: 1, minHeight: 0 }}
      onVisibleRange={(event) => {
        const s = Math.floor(event.startIndex ?? 0)
        onRange?.(s, Math.floor(event.endIndex ?? s))
        setStart(Math.max(0, s - WINDOW / 4))
      }}
    >
      {items.slice(start, end).map((item, i) => renderRow(item, start + i))}
    </virtual-list>
  )
}

const warn = (e: unknown) => console.warn('[git-lens]', (e as Error)?.message ?? e)

export function App({ initialRepo, onOpened }: { initialRepo?: string; onOpened?: (stats: OpenStats) => void }) {
  const renderer = useGpuixRequired()
  const [repo, setRepo] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>('Opening repository…')
  const [error, setError] = useState<string | null>(null)
  const [refs, setRefs] = useState<G.Ref[]>([])
  const [branch, setBranch] = useState('HEAD')
  const [selectedRef, setSelectedRef] = useState('HEAD')
  const [commits, setCommits] = useState<G.Commit[]>([])
  const [graph, setGraph] = useState<Graph>({ rows: [], width: 1 })
  const [stats, setStats] = useState<OpenStats | null>(null)
  const [query, setQuery] = useState('')
  const [selectedSha, setSelectedSha] = useState<string | null>(null)
  const [detail, setDetail] = useState<G.CommitDetail | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<ViewerTab>('diff')
  const [diffMode, setDiffMode] = useState<DiffMode>('unified')
  const [patch, setPatch] = useState('')
  const [fileText, setFileText] = useState<string | null>(null)
  const [blameLines, setBlameLines] = useState<G.BlameLine[]>([])
  const [mode, setMode] = useState<Mode>('history')
  const [readme, setReadme] = useState<{ path: string; text: string } | null>(null)
  const [statusEntries, setStatusEntries] = useState<G.StatusEntry[]>([])
  const [change, setChange] = useState<{ path: string; staged: boolean } | null>(null)
  const [changePatch, setChangePatch] = useState<G.ParsedPatch | null>(null)
  const [message, setMessage] = useState('')
  const [pane, setPane] = useState<Pane>('commits')
  const [typingState, setTyping] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [showRemotes, setShowRemotes] = useState(false)
  const [showTags, setShowTags] = useState(false)

  const searchRef = useRef<{ id: number } | null>(null)
  const messageRef = useRef<{ id: number } | null>(null)
  const commitListRef = useRef<{ id: number } | null>(null)
  const visible = useRef({ start: 0, end: 0 })
  const loadToken = useRef(0)

  const flash = useCallback((text: string) => {
    setToast(text)
    setTimeout(() => setToast((t) => (t === text ? null : t)), 2600)
  }, [])

  const filtered = useMemo(() => filterCommits(commits, query), [commits, query])
  const searching = query.trim().length > 0
  const position = useMemo(() => filtered.findIndex((i) => commits[i]?.sha === selectedSha), [filtered, commits, selectedSha])
  const gWidth = searching ? 12 : graphWidth(graph.width)

  const loadHistory = useCallback(
    async (root: string, ref: string, firstOpen: boolean) => {
      const token = ++loadToken.current
      const t0 = performance.now()
      const list = await G.log(root, ref)
      const t1 = performance.now()
      const g = buildGraph(list)
      const t2 = performance.now()
      if (token !== loadToken.current) return
      const s = { commits: list.length, logMs: Math.round(t1 - t0), graphMs: Math.round(t2 - t1), totalMs: 0 }
      setCommits(list)
      setGraph(g)
      setSelectedSha(list[0]?.sha ?? null)
      visible.current = { start: 0, end: 0 }
      return { s, firstOpen }
    },
    [],
  )

  const refreshStatus = useCallback(async (root: string) => {
    const entries = await G.status(root)
    setStatusEntries(entries)
    return entries
  }, [])

  const openRepo = useCallback(
    async (path: string) => {
      const t0 = performance.now()
      setError(null)
      try {
        if (path === DEFAULT_REPO && !existsSync(join(path, '.git'))) {
          setLoading('Cloning remorses/gpuix…')
          mkdirSync(dirname(path), { recursive: true })
          await G.git(dirname(path), ['clone', '--quiet', DEFAULT_REMOTE, basename(path)])
        }
        setLoading('Reading history…')
        const root = await G.repoRoot(path)
        const [refList, current] = await Promise.all([G.refs(root), G.currentBranch(root)])
        setDetail(null)
        setSelectedSha(null)
        setSelectedPath(null)
        setPatch('')
        setRepo(root)
        setRefs(refList)
        setBranch(current)
        setSelectedRef('HEAD')
        setQuery('')
        setMode('history')
        setChange(null)
        const res = await loadHistory(root, 'HEAD', true)
        const total = Math.round(performance.now() - t0)
        if (res) {
          const s = { ...res.s, totalMs: total }
          setStats(s)
          onOpened?.(s)
          console.log(`[git-lens] opened ${root}: ${s.commits} commits, git log ${s.logMs} ms, graph ${s.graphMs} ms, total ${s.totalMs} ms`)
        }
        setLoading(null)
        void G.readme(root).then(setReadme).catch(warn)
        void refreshStatus(root)
      } catch (e) {
        setLoading(null)
        setError(String((e as Error).message ?? e))
      }
    },
    [loadHistory, refreshStatus, onOpened],
  )

  useEffect(() => {
    void openRepo(initialRepo ?? DEFAULT_REPO)
  }, [initialRepo, openRepo])

  // Commit detail
  useEffect(() => {
    if (!repo || !selectedSha) {
      setDetail(null)
      return
    }
    let live = true
    void G.commitDetail(repo, selectedSha).then((d) => {
      if (!live) return
      setDetail(d)
      setCollapsedDirs(new Set())
      setSelectedPath((p) => (p && d.files.some((f) => f.path === p) ? p : (d.files[0]?.path ?? null)))
    }).catch(warn)
    return () => {
      live = false
    }
  }, [repo, selectedSha])

  const selectedFile = useMemo(() => detail?.files.find((f) => f.path === selectedPath) ?? null, [detail, selectedPath])

  // Viewer content
  useEffect(() => {
    if (!repo || !detail || !selectedFile) {
      setPatch('')
      setFileText(null)
      setBlameLines([])
      return
    }
    let live = true
    if (tab === 'diff') {
      void G.commitFileDiff(repo, detail, selectedFile).then((p) => live && setPatch(p)).catch(warn)
    } else if (tab === 'file') {
      void G.fileAt(repo, detail.sha, selectedFile.path).then((t) => live && setFileText(t)).catch(warn)
    } else {
      if (selectedFile.status === 'D') setBlameLines([])
      else void G.blame(repo, detail.sha, selectedFile.path).then((b) => live && setBlameLines(b)).catch(() => live && setBlameLines([]))
    }
    return () => {
      live = false
    }
  }, [repo, detail, selectedFile, tab])

  // Working-changes diff
  const statusEntry = useMemo(() => (change ? (statusEntries.find((e) => e.path === change.path) ?? null) : null), [change, statusEntries])
  useEffect(() => {
    if (!repo || !change || !statusEntry) {
      setChangePatch(null)
      return
    }
    let live = true
    void G.workingDiff(repo, statusEntry, change.staged).then((p) => live && setChangePatch(G.splitPatch(p))).catch(warn)
    return () => {
      live = false
    }
  }, [repo, change, statusEntry])

  const staged = useMemo(() => statusEntries.filter((e) => e.staged), [statusEntries])
  const unstaged = useMemo(() => statusEntries.filter((e) => e.unstaged), [statusEntries])
  const changeRows = useMemo(() => [...staged.map((e) => ({ e, staged: true })), ...unstaged.map((e) => ({ e, staged: false }))], [staged, unstaged])

  // Keep a change selected when the lists shift after staging.
  useEffect(() => {
    if (mode !== 'changes') return
    if (change && changeRows.some((r) => r.e.path === change.path && r.staged === change.staged)) return
    const same = change && changeRows.find((r) => r.e.path === change.path)
    const next = same ?? changeRows[0]
    setChange(next ? { path: next.e.path, staged: next.staged } : null)
  }, [mode, changeRows, change])

  const selectRef = useCallback(
    async (ref: string) => {
      if (!repo) return
      setSelectedRef(ref)
      setMode('history')
      setQuery('')
      const res = await loadHistory(repo, ref, false)
      if (res) setStats((s) => (s ? { ...s, commits: res.s.commits, logMs: res.s.logMs, graphMs: res.s.graphMs } : s))
    },
    [repo, loadHistory],
  )

  const revealPosition = useCallback(
    (pos: number) => {
      const list = commitListRef.current
      if (!list) return
      const { start, end } = visible.current
      if (pos < start + 1 || pos >= end - 1) renderer.scrollToItem?.(list.id, Math.max(0, pos - 3))
    },
    [renderer],
  )

  const moveCommit = useCallback(
    (delta: number) => {
      if (!filtered.length) return
      const pos = Math.min(filtered.length - 1, Math.max(0, (position < 0 ? -1 : position) + delta))
      setSelectedSha(commits[filtered[pos]].sha)
      revealPosition(pos)
    },
    [filtered, position, commits, revealPosition],
  )

  const treeRows = useMemo(() => (detail ? buildTree(detail.files, collapsedDirs) : []), [detail, collapsedDirs])
  const fileRows = useMemo(() => treeRows.filter((r) => !r.dir), [treeRows])

  const moveFile = useCallback(
    (delta: number) => {
      if (!fileRows.length) return
      const i = fileRows.findIndex((r) => r.file?.path === selectedPath)
      const next = fileRows[Math.min(fileRows.length - 1, Math.max(0, i + delta))]
      setSelectedPath(next.file!.path)
    },
    [fileRows, selectedPath],
  )

  const moveChange = useCallback(
    (delta: number) => {
      if (!changeRows.length) return
      const i = changeRows.findIndex((r) => change && r.e.path === change.path && r.staged === change.staged)
      const next = changeRows[Math.min(changeRows.length - 1, Math.max(0, i + delta))]
      setChange({ path: next.e.path, staged: next.staged })
    },
    [changeRows, change],
  )

  const toggleStage = useCallback(
    async (path: string, isStaged: boolean) => {
      if (!repo) return
      if (isStaged) await G.unstageFile(repo, path)
      else await G.stageFile(repo, path)
      setChange({ path, staged: !isStaged })
      await refreshStatus(repo)
    },
    [repo, refreshStatus],
  )

  const toggleHunk = useCallback(
    async (hunk: G.Hunk) => {
      if (!repo || !changePatch || !change) return
      try {
        await G.applyHunk(repo, changePatch, hunk, change.staged)
        const entries = await refreshStatus(repo)
        flash(change.staged ? 'Hunk unstaged' : 'Hunk staged')
        const e = entries.find((x) => x.path === change.path)
        if (e && !(change.staged ? e.staged : e.unstaged)) setChange({ path: change.path, staged: !change.staged })
        else if (e) setChange({ ...change })
      } catch (err) {
        flash(String((err as Error).message).slice(0, 120))
      }
    },
    [repo, changePatch, change, refreshStatus, flash],
  )

  const doCommit = useCallback(async () => {
    if (!repo || !staged.length || !message.trim()) return
    try {
      const sha = await G.commit(repo, message.trim())
      setMessage('')
      await refreshStatus(repo)
      setRefs(await G.refs(repo))
      await loadHistory(repo, selectedRef, false)
      setSelectedSha(sha)
      flash(`Committed ${sha.slice(0, 7)} to ${branch}`)
    } catch (err) {
      flash(String((err as Error).message).slice(0, 140))
    }
  }, [repo, staged, message, refreshStatus, loadHistory, selectedRef, branch, flash])

  const pickFolder = useCallback(async () => {
    const paths = await renderer.promptForPaths?.({ directories: true, files: false, multiple: false, prompt: 'Open Repository' })
    if (paths?.[0]) void openRepo(paths[0])
  }, [renderer, openRepo])

  const panes: Pane[] = mode === 'changes' ? ['sidebar', 'commits', 'viewer', 'message'] : mode === 'readme' ? ['sidebar', 'viewer'] : ['sidebar', 'commits', 'files', 'viewer']

  useEffect(() => {
    const out = process.env.GIT_LENS_PERF_OUT
    if (!out) return
    const t = setInterval(() => {
      const m = process.memoryUsage()
      writeFileSync(out, JSON.stringify({ open: stats, frame: renderer.getDebugFrameOverlayStats?.(), rssMb: m.rss / 1048576, heapMb: m.heapUsed / 1048576, patchLines: patch ? patch.split('\n').length : 0 }))
    }, 250)
    return () => clearInterval(t)
  }, [stats, patch, renderer])

  useEffect(() => {
    if (!patch || !process.env.GIT_LENS_PERF_OUT) return
    const t = setTimeout(() => renderer.resetDebugFrameOverlayStats?.(), 1000)
    return () => clearTimeout(t)
  }, [patch, renderer])

  keyBridge.current = (event, r) => {
    const key = event.key ?? ''
    const cmd = !!event.modifiers?.cmd
    const focusedId = r.getFocusedElementId?.() ?? null
    const typing = typingState || (focusedId != null && (focusedId === searchRef.current?.id || focusedId === messageRef.current?.id))
    if (cmd && key === 'f') {
      event.preventDefault()
      setMode('history')
      setPane('commits')
      setTimeout(() => searchRef.current && r.focusElement?.(searchRef.current.id), 0)
      return
    }
    if (cmd && key === 'o') return void pickFolder()
    if (cmd && key === 'enter' && mode === 'changes') return void doCommit()
    if (cmd && event.modifiers?.shift && key === 'd') return void r.cycleDebugFrameOverlay?.()
    if (cmd && key === '1') return setMode('history')
    if (cmd && key === '2') return setMode('changes')
    if (cmd && key === '3') return setMode('readme')
    if (key === 'tab') {
      event.preventDefault()
      const i = panes.indexOf(pane)
      const next = panes[(i + (event.modifiers?.shift ? panes.length - 1 : 1)) % panes.length]
      setPane(next)
      if (next === 'message' && messageRef.current) r.focusElement?.(messageRef.current.id)
      else if (typing) r.blur?.()
      return
    }
    if (key === 'escape') {
      if (typing) r.blur?.()
      return
    }
    if (typing || cmd) return
    const down = key === 'j' || key === 'down'
    const up = key === 'k' || key === 'up'
    if (mode === 'history') {
      if (down || up) {
        if (pane === 'files') moveFile(down ? 1 : -1)
        else moveCommit(down ? 1 : -1)
        return
      }
      if (key === 'd') setTab('diff')
      else if (key === 'f') setTab('file')
      else if (key === 'b') setTab('blame')
      else if (key === 's') {
        setTab('diff')
        setDiffMode((m) => (m === 'split' ? 'unified' : 'split'))
      } else if (key === 'g') moveCommit(-1e9)
      else if (key === 'G' || (key === 'g' && event.modifiers?.shift)) moveCommit(1e9)
    } else if (mode === 'changes') {
      if (down || up) moveChange(down ? 1 : -1)
      else if (key === 'space' && change) void toggleStage(change.path, change.staged)
    }
  }

  useEffect(
    () => () => {
      keyBridge.current = null
    },
    [],
  )

  const currentRefLabel = selectedRef === 'HEAD' ? branch : selectedRef === '--all' ? 'All branches' : selectedRef
  const heads = refs.filter((r) => r.kind === 'head')
  const remotes = refs.filter((r) => r.kind === 'remote')
  const tags = refs.filter((r) => r.kind === 'tag')

  // ---------- render pieces ----------

  const paneHeader = (title: string, id: Pane, right?: React.ReactNode) => (
    <div style={{ display: 'flex', height: 38, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 10, gap: 8, borderBottomWidth: 1, borderColor: C.borderSoft, flexShrink: 0 }}>
      <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pane === id ? C.accent : 'transparent' }} />
      <Txt size={12} weight={600} color={pane === id ? C.text : C.text2} grow>
        {title}
      </Txt>
      {right}
    </div>
  )

  const sidebarItem = (label: string, active: boolean, onClick: () => void, opts: { testId?: string; badge?: string; dot?: boolean; muted?: boolean; mono?: boolean } = {}) => (
    <div
      key={label + (opts.testId ?? '')}
      testId={opts.testId}
      onClick={() => {
        setPane('sidebar')
        onClick()
      }}
      style={{
        display: 'flex',
        height: 26,
        marginLeft: 8,
        marginRight: 8,
        paddingLeft: 10,
        paddingRight: 8,
        borderRadius: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: active ? (pane === 'sidebar' ? C.accent : C.selectInactive) : undefined,
        hover: active ? undefined : { backgroundColor: '#262629' },
        cursor: 'pointer',
      }}
    >
      <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: opts.dot ? (active && pane === 'sidebar' ? '#FFFFFF' : C.green) : 'transparent' }} />
      <Txt size={12.5} color={active ? '#FFFFFF' : opts.muted ? C.text2 : C.text} weight={active ? 600 : 400} grow>
        {label}
      </Txt>
      {opts.badge && (
        <Txt size={11} color={active ? '#FFFFFFCC' : C.text3} mono>
          {opts.badge}
        </Txt>
      )}
    </div>
  )

  const sidebar = (
    <div style={{ display: 'flex', width: 232, flexShrink: 0, backgroundColor: C.sidebar, borderRightWidth: 1, borderColor: C.border, flexDirection: 'column' }}>
      <div style={{ height: 52, flexShrink: 0 }} />
      <div style={{ display: 'flex', paddingLeft: 16, paddingRight: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: 30, height: 30, borderRadius: 8, backgroundColor: '#2C2C30', alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={13} weight={700} color={C.accent}>
            {initials(repo ? basename(repo) : '?')}
          </Txt>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 1 }}>
          <Txt size={13.5} weight={700} color={C.text} testId="repo-name" style={{}}>
            {repo ? basename(repo) : 'No repository'}
          </Txt>
          <Txt size={11} color={C.text3} grow>
            {repo ? repo.replace(homedir(), '~') : ''}
          </Txt>
        </div>
      </div>
      <div style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 6 }}>
        <Button label="Open Repository…" onClick={pickFolder} small testId="open-repo" />
      </div>
      <div style={{ display: 'flex', flexGrow: 1, minHeight: 0, overflowY: 'scroll', flexDirection: 'column', paddingBottom: 16 }}>
        <SectionLabel>Workspace</SectionLabel>
        {sidebarItem('History', mode === 'history', () => setMode('history'), { testId: 'nav-history', badge: commits.length ? commits.length.toLocaleString('en-US') : undefined })}
        {sidebarItem('Working Changes', mode === 'changes', () => setMode('changes'), { testId: 'nav-changes', badge: statusEntries.length ? String(statusEntries.length) : undefined })}
        {sidebarItem(readme?.path ?? 'README', mode === 'readme', () => setMode('readme'), { testId: 'nav-readme' })}
        <SectionLabel>Branches</SectionLabel>
        {sidebarItem('All branches', mode === 'history' && selectedRef === '--all', () => void selectRef('--all'), { testId: 'ref-all', muted: true })}
        {heads.map((h) =>
          sidebarItem(h.short, mode === 'history' && (selectedRef === h.short || (selectedRef === 'HEAD' && h.current)), () => void selectRef(h.current ? 'HEAD' : h.short), {
            testId: `branch-${h.short}`,
            dot: h.current,
            badge: h.track.replace(/[\[\]]/g, '').replace('ahead ', '↑').replace('behind ', '↓') || undefined,
          }),
        )}
        {remotes.length > 0 && <SectionLabel right={<Txt size={11} color={C.text3}>{showRemotes ? 'Hide' : `${remotes.length}`}</Txt>}>Remotes</SectionLabel>}
        {remotes.length > 0 && !showRemotes && sidebarItem(`Show ${remotes.length} remote branches`, false, () => setShowRemotes(true), { muted: true })}
        {showRemotes && remotes.map((r) => sidebarItem(r.short, mode === 'history' && selectedRef === r.short, () => void selectRef(r.short), { muted: true }))}
        {tags.length > 0 && <SectionLabel right={<Txt size={11} color={C.text3}>{String(tags.length)}</Txt>}>Tags</SectionLabel>}
        {tags.length > 0 && !showTags && sidebarItem(`Show ${tags.length} tags`, false, () => setShowTags(true), { muted: true })}
        {showTags && tags.map((t) => sidebarItem(t.short, mode === 'history' && selectedRef === t.short, () => void selectRef(t.short), { muted: true, testId: `tag-${t.short}` }))}
      </div>
    </div>
  )

  const refChip = (r: string) => {
    const isTag = r.startsWith('tag: ')
    const label = isTag ? r.slice(5) : r
    const remote = !isTag && label.includes('/')
    const color = isTag ? C.yellow : remote ? C.text2 : C.accent
    return (
      <div key={r} style={{ display: 'flex', flexDirection: 'column', height: 17, paddingLeft: 6, paddingRight: 6, borderRadius: 4, backgroundColor: color + '24', justifyContent: 'center', flexShrink: 0 }}>
        <Txt size={10.5} weight={600} color={color}>
          {label}
        </Txt>
      </div>
    )
  }

  const commitRow = (index: number, pos: number) => {
    const c = commits[index]
    const selected = c.sha === selectedSha
    const strong = selected && pane === 'commits'
    return (
      <div
        key={c.sha}
        testId={pos < 40 ? `commit-${pos}` : undefined}
        onClick={() => {
          setPane('commits')
          setSelectedSha(c.sha)
        }}
        style={{
          display: 'flex',
          height: ROW_H,
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: selected ? (strong ? C.accent : C.selectInactive) : undefined,
          hover: selected ? undefined : { backgroundColor: '#252528' },
          cursor: 'pointer',
        }}
      >
        {searching ? <div style={{ width: gWidth }} /> : <GraphCell row={graph.rows[index]} width={gWidth} merge={c.parents.length > 1} selected={strong} />}
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, paddingRight: 14, gap: 4, justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {c.refs.slice(0, 3).map(refChip)}
            <Txt size={13} weight={500} color={strong ? '#FFFFFF' : C.text} grow>
              {c.subject}
            </Txt>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Txt size={11.5} color={strong ? '#FFFFFFD9' : C.text2}>
              {c.author}
            </Txt>
            <Txt size={11.5} color={strong ? '#FFFFFFA6' : C.text3} grow>
              {relativeTime(c.time)}
            </Txt>
            <Txt size={11} mono color={strong ? '#FFFFFFA6' : C.text3}>
              {c.sha.slice(0, 7)}
            </Txt>
          </div>
        </div>
      </div>
    )
  }

  const historyColumn = (
    <div style={{ display: 'flex', width: 500, flexShrink: 0, backgroundColor: C.pane, borderRightWidth: 1, borderColor: C.border, flexDirection: 'column' }}>
      <div style={{ display: 'flex', height: 52, flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 12, gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <Txt size={14} weight={700} color={C.text} grow>
            {currentRefLabel}
          </Txt>
          <Txt size={11} color={C.text3} testId="commit-count">
            {searching ? `${filtered.length.toLocaleString('en-US')} of ${commits.length.toLocaleString('en-US')} commits` : `${commits.length.toLocaleString('en-US')} commits`}
          </Txt>
        </div>
      </div>
      <div style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 10, borderBottomWidth: 1, borderColor: C.borderSoft }}>
        <input
          ref={searchRef as any}
          testId="search"
          value={query}
          placeholder="Search message, author or hash   ⌘F"
          onChange={(e) => {
            setQuery(e.value ?? '')
            visible.current = { start: 0, end: 0 }
          }}
          onFocus={() => {
            setTyping(true)
            setPane('commits')
          }}
          onBlur={() => setTyping(false)}
          onKeyDown={(e) => {
            if (e.key === 'enter' || e.key === 'down') {
              const first = filtered[0]
              if (first !== undefined) setSelectedSha(commits[first].sha)
              renderer.blur?.()
            }
          }}
          theme={nativeTheme}
          style={{ height: 30, paddingLeft: 10, paddingRight: 10, borderRadius: 7, backgroundColor: '#29292C', borderWidth: 1, borderColor: typingState && pane === 'commits' ? C.accent : '#333336', color: C.text, fontSize: 12.5 }}
        />
      </div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={13} color={C.text2}>
            {loading}
          </Txt>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={13} color={C.text3}>
            No commits match “{query}”
          </Txt>
        </div>
      ) : (
        <VList
          testKey={`${repo}:${selectedRef}:${query}`}
          items={filtered}
          rowHeight={ROW_H}
          listRef={commitListRef}
          onRange={(start, end) => {
            visible.current = { start, end }
          }}
          renderRow={(index, pos) => commitRow(index, pos)}
        />
      )}
    </div>
  )

  const avatar = (name: string, size: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', width: size, height: size, borderRadius: size / 2, backgroundColor: hashColor(name, AVATAR_COLORS), alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Txt size={size * 0.38} weight={700} color="#FFFFFF">
        {initials(name)}
      </Txt>
    </div>
  )

  const commitHeader = detail && (
    <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 20, paddingRight: 20, paddingTop: 14, paddingBottom: 14, gap: 10, borderBottomWidth: 1, borderColor: C.border, flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {avatar(detail.author, 34)}
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 2 }}>
          <Txt size={13} weight={600} color={C.text} grow testId="detail-author">
            {detail.author}
          </Txt>
          <Txt size={11.5} color={C.text3} grow>
            {`${detail.email} · ${absoluteDate(detail.authorTime)}`}
          </Txt>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: 20, paddingLeft: 8, paddingRight: 8, borderRadius: 5, backgroundColor: '#2C2C30', justifyContent: 'center' }}>
            <Txt size={11.5} mono color={C.text} testId="detail-sha">
              {detail.sha.slice(0, 10)}
            </Txt>
          </div>
          <Txt size={11} color={C.text3}>
            {detail.parents.length > 1 ? `merge of ${detail.parents.map((p) => p.slice(0, 7)).join(' + ')}` : detail.parents[0] ? `parent ${detail.parents[0].slice(0, 7)}` : 'root commit'}
          </Txt>
        </div>
      </div>
      <div style={{ display: 'flex', maxHeight: 132, overflow: 'hidden', flexDirection: 'column' }}>
        <markdown source={commitMarkdown(detail.message)} theme={nativeTheme} />
      </div>
    </div>
  )

  const filesColumn = detail && (
    <div style={{ display: 'flex', width: 290, flexShrink: 0, borderRightWidth: 1, borderColor: C.border, flexDirection: 'column', backgroundColor: C.pane }}>
      {paneHeader(
        `${detail.files.length} changed file${detail.files.length === 1 ? '' : 's'}`,
        'files',
        <DiffStat additions={detail.files.reduce((a, f) => a + f.additions, 0)} deletions={detail.files.reduce((a, f) => a + f.deletions, 0)} />,
      )}
      <div style={{ display: 'flex', flexGrow: 1, minHeight: 0, overflowY: 'scroll', flexDirection: 'column', paddingTop: 4, paddingBottom: 8 }}>
        {treeRows.map((row) => {
          const active = !row.dir && row.file?.path === selectedPath
          const strong = active && pane === 'files'
          return (
            <div
              key={row.key}
              testId={row.dir ? `dir-${row.key}` : `file-${row.key}`}
              onClick={() => {
                setPane('files')
                if (row.dir) {
                  setCollapsedDirs((s) => {
                    const n = new Set(s)
                    if (n.has(row.key)) n.delete(row.key)
                    else n.add(row.key)
                    return n
                  })
                } else setSelectedPath(row.file!.path)
              }}
              style={{
                display: 'flex',
                height: 26,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                marginLeft: 6,
                marginRight: 6,
                borderRadius: 5,
                paddingLeft: 8 + row.depth * 14,
                paddingRight: 8,
                backgroundColor: active ? (strong ? C.accent : C.selectInactive) : undefined,
                hover: active ? undefined : { backgroundColor: '#29292C' },
                cursor: 'pointer',
              }}
            >
              {row.dir ? (
                <Txt size={10} color={C.text3} style={{ width: 16 }}>
                  {collapsedDirs.has(row.key) ? '▸' : '▾'}
                </Txt>
              ) : (
                <StatusBadge status={row.file!.status} />
              )}
              <Txt size={12.5} color={strong ? '#FFFFFF' : row.dir ? C.text2 : C.text} weight={row.dir ? 500 : 400} grow>
                {row.name}
              </Txt>
              {row.file?.binary ? <Txt size={10.5} color={C.text3}>bin</Txt> : strong ? <Txt size={11} mono color="#FFFFFFCC">{`+${row.additions} −${row.deletions}`}</Txt> : <DiffStat additions={row.additions} deletions={row.deletions} />}
            </div>
          )
        })}
      </div>
    </div>
  )

  const splitRows = useMemo(() => (diffMode === 'split' && tab === 'diff' ? toSplitRows(patch) : []), [diffMode, tab, patch])

  const splitRow = (row: SplitRow, i: number) => {
    if (row.kind === 'hunk') {
      return (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', height: 26, width: '100%', backgroundColor: C.hunkBg, justifyContent: 'center', paddingLeft: 12 }}>
          <Txt size={11.5} mono color="#7FA7D9">
            {row.header ?? ''}
          </Txt>
        </div>
      )
    }
    const half = (side: SplitRow['left'] | SplitRow['right'], isLeft: boolean) => {
      const bg = !side ? '#1A1A1C' : side.type === 'del' ? C.delBg : side.type === 'add' ? C.addBg : undefined
      return (
        <div style={{ display: 'flex', flexDirection: 'row', flexBasis: 0, flexGrow: 1, minWidth: 0, height: LINE_H, alignItems: 'center', backgroundColor: bg, borderRightWidth: isLeft ? 1 : 0, borderColor: C.border, overflow: 'hidden' }}>
          <Txt size={11} mono color={C.text3} style={{ width: 44, textAlign: 'right', paddingRight: 8 }}>
            {side ? String(side.no) : ''}
          </Txt>
          <Txt size={11} mono color={side?.type === 'del' ? '#FF8A80' : side?.type === 'add' ? '#7EE2A0' : C.text3} style={{ width: 14 }}>
            {side?.type === 'del' ? '−' : side?.type === 'add' ? '+' : ''}
          </Txt>
          <Txt size={12} mono color="#D6D6DA" grow>
            {side ? side.text.replace(/\t/g, '  ') || ' ' : ''}
          </Txt>
        </div>
      )
    }
    return (
      <div key={i} style={{ display: 'flex', flexDirection: 'row', height: LINE_H, width: '100%' }}>
        {half(row.left, true)}
        {half(row.right, false)}
      </div>
    )
  }

  const blameRow = (line: G.BlameLine, i: number) => {
    const age = Math.min(1, Math.max(0, (Date.now() / 1000 - line.time) / (86400 * 365)))
    const heat = age < 0.08 ? C.orange : age < 0.3 ? C.accent : age < 0.7 ? '#3A6EA5' : '#3A3A3D'
    return (
      <div key={i} style={{ display: 'flex', flexDirection: 'row', height: LINE_H, width: '100%', alignItems: 'center', borderTopWidth: line.chunkStart && i > 0 ? 1 : 0, borderColor: C.borderSoft }}>
        <div style={{ width: 3, height: LINE_H, backgroundColor: heat }} />
        <div style={{ display: 'flex', width: 260, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, backgroundColor: C.paneAlt, height: LINE_H }}>
          {line.chunkStart ? (
            <>
              <Txt size={11} mono color={C.accent}>
                {line.sha.slice(0, 7)}
              </Txt>
              <Txt size={11.5} color={C.text2} grow>
                {line.summary}
              </Txt>
              <Txt size={11} color={C.text3}>
                {relativeTime(line.time)}
              </Txt>
            </>
          ) : null}
        </div>
        <Txt size={11} mono color={C.text3} style={{ width: 48, textAlign: 'right', paddingRight: 10 }}>
          {String(line.lineNo)}
        </Txt>
        <Txt size={12} mono color="#D6D6DA" grow>
          {line.text.replace(/\t/g, '  ') || ' '}
        </Txt>
      </div>
    )
  }

  const viewer = (
    <div style={{ display: 'flex', flexGrow: 1, minWidth: 0, flexDirection: 'column', backgroundColor: C.pane }}>
      {paneHeader(
        selectedFile ? selectedFile.path : 'No file selected',
        'viewer',
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {tab === 'diff' && (
            <Segmented
              testPrefix="diffmode"
              value={diffMode}
              onChange={setDiffMode}
              options={[
                { value: 'unified', label: 'Unified' },
                { value: 'split', label: 'Split' },
              ]}
            />
          )}
          <Segmented
            testPrefix="tab"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'diff', label: 'Diff' },
              { value: 'file', label: 'File' },
              { value: 'blame', label: 'Blame' },
            ]}
          />
        </div>,
      )}
      {!selectedFile ? (
        <Empty text="Select a file" />
      ) : tab === 'diff' ? (
        selectedFile.binary ? (
          <Empty text="Binary file changed" />
        ) : diffMode === 'unified' ? (
          <diff key={`${detail?.sha}:${selectedFile.path}`} testId="diff-view" patch={patch} scroll wordDiff theme={nativeTheme} style={{ flexGrow: 1, minHeight: 0 }} />
        ) : (
          <VList testKey={`split:${detail?.sha}:${selectedFile.path}`} items={splitRows} rowHeight={LINE_H} renderRow={splitRow} />
        )
      ) : tab === 'file' ? (
        fileText === null ? (
          <Empty text={selectedFile.status === 'D' ? 'File deleted in this commit' : 'Loading…'} />
        ) : (
          <div key={`file:${detail?.sha}:${selectedFile.path}`} style={{ display: 'flex', flexGrow: 1, minHeight: 0, overflowY: 'scroll', flexDirection: 'column' }}>
            <code code={fileText} path={selectedFile.path} language={languageFor(selectedFile.path)} showLineNumbers theme={nativeTheme} />
          </div>
        )
      ) : blameLines.length === 0 ? (
        <Empty text={selectedFile.status === 'D' ? 'File deleted in this commit' : 'Loading blame…'} />
      ) : (
        <VList testKey={`blame:${detail?.sha}:${selectedFile.path}`} items={blameLines} rowHeight={LINE_H} renderRow={blameRow} />
      )}
    </div>
  )

  const historyDetail = (
    <div style={{ display: 'flex', flexGrow: 1, minWidth: 0, flexDirection: 'column', backgroundColor: C.pane }}>
      <div style={{ display: 'flex', height: 52, flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 16, gap: 12, borderBottomWidth: 1, borderColor: C.border }}>
        <Txt size={14} weight={700} color={C.text} grow testId="detail-subject">
          {detail ? detail.message.split('\n')[0] : ''}
        </Txt>
        {stats && (
          <Txt size={11} color={C.text3} testId="open-stats">
            {`opened in ${stats.totalMs} ms · git log ${stats.logMs} ms · graph ${stats.graphMs} ms`}
          </Txt>
        )}
      </div>
      {commitHeader}
      <div style={{ display: 'flex', flexGrow: 1, minHeight: 0, flexDirection: 'row' }}>
        {filesColumn}
        {viewer}
      </div>
    </div>
  )

  // ---------- working changes ----------

  const changeRow = (e: G.StatusEntry, isStaged: boolean) => {
    const active = change?.path === e.path && change.staged === isStaged
    const strong = active && pane === 'commits'
    const st = (isStaged ? e.staged : e.unstaged) ?? 'M'
    const slash = e.path.lastIndexOf('/')
    return (
      <div
        key={(isStaged ? 's:' : 'u:') + e.path}
        testId={`${isStaged ? 'staged' : 'unstaged'}-${e.path}`}
        onClick={() => {
          setPane('commits')
          setChange({ path: e.path, staged: isStaged })
        }}
        style={{
          display: 'flex',
          height: 30,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginLeft: 8,
          marginRight: 8,
          paddingLeft: 8,
          paddingRight: 6,
          borderRadius: 6,
          backgroundColor: active ? (strong ? C.accent : C.selectInactive) : undefined,
          hover: active ? undefined : { backgroundColor: '#29292C' },
          cursor: 'pointer',
        }}
      >
        <StatusBadge status={st} />
        <Txt size={12.5} color={strong ? '#FFFFFF' : C.text}>
          {e.path.slice(slash + 1)}
        </Txt>
        <Txt size={11.5} color={strong ? '#FFFFFFA6' : C.text3} grow>
          {slash > 0 ? e.path.slice(0, slash) : ''}
        </Txt>
        <div
          testId={`${isStaged ? 'unstage' : 'stage'}-${e.path}`}
          onClick={() => {
            void toggleStage(e.path, isStaged)
          }}
          style={{ display: 'flex', flexDirection: 'column', height: 20, paddingLeft: 7, paddingRight: 7, borderRadius: 5, justifyContent: 'center', backgroundColor: strong ? '#FFFFFF33' : '#333336', hover: { backgroundColor: strong ? '#FFFFFF55' : '#45454A' }, cursor: 'pointer' }}
        >
          <Txt size={11} weight={600} color={strong ? '#FFFFFF' : C.text2}>
            {isStaged ? 'Unstage' : 'Stage'}
          </Txt>
        </div>
      </div>
    )
  }

  const changesColumn = (
    <div style={{ display: 'flex', width: 500, flexShrink: 0, backgroundColor: C.pane, borderRightWidth: 1, borderColor: C.border, flexDirection: 'column' }}>
      <div style={{ display: 'flex', height: 52, flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 12, gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <Txt size={14} weight={700} color={C.text}>
            Working Changes
          </Txt>
          <Txt size={11} color={C.text3} testId="changes-summary">
            {`${staged.length} staged · ${unstaged.length} unstaged`}
          </Txt>
        </div>
        <Button label="Refresh" small onClick={() => repo && void refreshStatus(repo)} testId="refresh-status" />
      </div>
      <div style={{ display: 'flex', flexGrow: 1, minHeight: 0, overflowY: 'scroll', flexDirection: 'column', paddingBottom: 8, borderTopWidth: 1, borderColor: C.borderSoft }}>
        <SectionLabel
          right={
            staged.length > 0 ? (
              <div testId="unstage-all" onClick={async () => { if (repo) { for (const e of staged) await G.unstageFile(repo, e.path); await refreshStatus(repo) } }} style={{ cursor: 'pointer' }}>
                <Txt size={11} color={C.accent}>Unstage all</Txt>
              </div>
            ) : undefined
          }
        >{`Staged · ${staged.length}`}</SectionLabel>
        {staged.length === 0 && (
          <div style={{ paddingLeft: 16, paddingBottom: 6 }}>
            <Txt size={12} color={C.text3}>Nothing staged yet</Txt>
          </div>
        )}
        {staged.map((e) => changeRow(e, true))}
        <SectionLabel
          right={
            unstaged.length > 0 ? (
              <div testId="stage-all" onClick={async () => { if (repo) { await G.git(repo, ['add', '-A']); await refreshStatus(repo) } }} style={{ cursor: 'pointer' }}>
                <Txt size={11} color={C.accent}>Stage all</Txt>
              </div>
            ) : undefined
          }
        >{`Changes · ${unstaged.length}`}</SectionLabel>
        {unstaged.length === 0 && (
          <div style={{ paddingLeft: 16 }}>
            <Txt size={12} color={C.text3}>Working tree clean</Txt>
          </div>
        )}
        {unstaged.map((e) => changeRow(e, false))}
      </div>
      <div style={{ display: 'flex', borderTopWidth: 1, borderColor: C.border, padding: 12, gap: 10, flexDirection: 'column', backgroundColor: pane === 'message' ? '#212124' : C.pane }}>
        <textarea
          ref={messageRef as any}
          testId="commit-message"
          value={message}
          placeholder="Commit message"
          minRows={3}
          maxRows={6}
          onChange={(e) => setMessage(e.value ?? '')}
          onFocus={() => {
            setTyping(true)
            setPane('message')
          }}
          onBlur={() => setTyping(false)}
          theme={nativeTheme}
          style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderRadius: 7, backgroundColor: '#29292C', borderWidth: 1, borderColor: pane === 'message' ? C.accent : '#333336', color: C.text, fontSize: 12.5 }}
        />
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Txt size={11} color={C.text3} grow>
            ⌘↩ to commit
          </Txt>
          <Button
            primary
            testId="commit-button"
            disabled={!staged.length || !message.trim()}
            label={`Commit ${staged.length} file${staged.length === 1 ? '' : 's'} to ${branch}`}
            onClick={() => void doCommit()}
          />
        </div>
      </div>
    </div>
  )

  const changesViewer = (
    <div style={{ display: 'flex', flexGrow: 1, minWidth: 0, flexDirection: 'column', backgroundColor: C.pane }}>
      <div style={{ display: 'flex', height: 52, flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 16, gap: 10, borderBottomWidth: 1, borderColor: C.border }}>
        <Txt size={14} weight={700} color={C.text} grow>
          {change ? change.path : 'No changes'}
        </Txt>
        {change && (
          <Txt size={11.5} color={C.text3}>
            {change.staged ? 'Staged changes' : 'Unstaged changes'}
          </Txt>
        )}
      </div>
      {!changePatch || changePatch.hunks.length === 0 ? (
        <Empty text={change ? 'No textual changes' : 'Nothing to review. Edit a file in this repository and it shows up here.'} />
      ) : (
        <div style={{ display: 'flex', flexGrow: 1, minHeight: 0, overflowY: 'scroll', flexDirection: 'column', padding: 16, gap: 14 }}>
          {changePatch.hunks.map((h, i) => (
            <div key={`${change?.path}:${change?.staged}:${i}:${h.header}`} style={{ display: 'flex', flexDirection: 'column', borderRadius: 8, borderWidth: 1, borderColor: C.border, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ display: 'flex', height: 34, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 8, gap: 10, backgroundColor: C.paneAlt, borderBottomWidth: 1, borderColor: C.border }}>
                <Txt size={11.5} mono color="#7FA7D9" grow>
                  {h.header}
                </Txt>
                <DiffStat additions={h.additions} deletions={h.deletions} />
                <Button small label={change?.staged ? 'Unstage hunk' : 'Stage hunk'} onClick={() => void toggleHunk(h)} testId={`hunk-${i}`} />
              </div>
              <diff patch={changePatch.header + h.body} wordDiff theme={nativeTheme} />
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const readmeView = (
    <div style={{ display: 'flex', flexGrow: 1, minWidth: 0, flexDirection: 'column', backgroundColor: C.pane }}>
      <div style={{ display: 'flex', height: 52, flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingLeft: 24, borderBottomWidth: 1, borderColor: C.border }}>
        <Txt size={14} weight={700} color={C.text}>
          {readme?.path ?? 'README'}
        </Txt>
      </div>
      <div style={{ display: 'flex', flexGrow: 1, minHeight: 0, overflowY: 'scroll', flexDirection: 'column', alignItems: 'center', paddingTop: 28, paddingBottom: 60 }}>
        <div style={{ display: 'flex', width: 760, flexDirection: 'column' }}>
          {readme ? <markdown source={readme.text} theme={nativeTheme} /> : <Txt color={C.text3}>This repository has no README.</Txt>}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', flexDirection: 'row', backgroundColor: C.window }}>
      {sidebar}
      {error ? (
        <Empty text={error} />
      ) : mode === 'history' ? (
        <>
          {historyColumn}
          {historyDetail}
        </>
      ) : mode === 'changes' ? (
        <>
          {changesColumn}
          {changesViewer}
        </>
      ) : (
        readmeView
      )}
      {toast && (
        <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', bottom: 22, right: 22, paddingLeft: 14, paddingRight: 14, height: 34, borderRadius: 9, backgroundColor: '#2E2E32', borderWidth: 1, borderColor: '#3A3A3E', justifyContent: 'center', boxShadow: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: '#00000080' } }}>
          <Txt size={12.5} weight={500} color={C.text} testId="toast">
            {toast}
          </Txt>
        </div>
      )}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Txt size={13} color={C.text3} style={{ whiteSpace: 'normal', textAlign: 'center' }}>
        {text}
      </Txt>
    </div>
  )
}

function commitMarkdown(message: string): string {
  const [, ...rest] = message.split('\n')
  const body = rest.join('\n').trim()
  return body || '_No description._'
}
