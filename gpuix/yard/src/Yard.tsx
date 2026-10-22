import { spawn } from 'node:child_process'
import { realpathSync, statfsSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { isTerminal, motion, useGpuix, useWindowSize } from '@gpuix/react'
import {
  copyInto,
  kindOf,
  listDir,
  makeDir,
  moveInto,
  readClip,
  renameEntry,
  trash,
  walk,
  writeClip,
  formatSize,
  imageSize,
  type Clip,
  type Entry,
} from './fs'
import { fuzzyMatch, highlightRuns } from './fuzzy'
import { ICON } from './icons'
import { EntryIcon, exposureLine, Icon, Preview } from './Preview'
import { gitInfo, type GitCode, type GitInfo } from './git'
import { readExif } from './media'
import { T } from './theme'

export const ROW = 30
const TOP = 44
const BOTTOM = 34

export interface YardProps {
  start: string
  showHidden?: boolean
  home?: string
  onQuit?: () => void
  openFile?: (path: string) => void
  clipPollMs?: number
}

type Mode = { kind: 'browse' } | { kind: 'look' } | { kind: 'jump' } | { kind: 'rename'; target: Entry } | { kind: 'mkdir' } | { kind: 'trash'; targets: string[] }
type KeyEvt = { key?: string; keyChar?: string; modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean }; stopPropagation?: () => void; preventDefault?: () => void }
type Toast = { text: string; tone: 'ok' | 'err' | 'info'; at: number }

const isPhoto = (e: Entry | undefined) => !!e && e.kind === 'image' && !e.name.toLowerCase().endsWith('.svg')
const realDir = (d: string | null) => {
  if (!d) return ''
  try {
    return realpathSync(d)
  } catch {
    return d
  }
}
const GIT_COLOR: Record<GitCode, string> = { M: T.orange, A: T.green, R: T.green, '?': T.green, D: T.red }
const GIT_LABEL: Record<GitCode, string> = { M: 'Modified', A: 'Added', R: 'Renamed', '?': 'New', D: 'Deleted' }

const defaultOpen = (p: string) => spawn('open', [p], { detached: true, stdio: 'ignore' }).unref()

export function Yard({ start, showHidden: initialHidden = false, home = homedir(), onQuit, openFile = defaultOpen, clipPollMs = 400 }: YardProps) {
  const { renderer } = useGpuix()
  const win = useWindowSize()
  const width = win?.width || 1200
  const height = win?.height || 760
  const chromeTop = isTerminal() || process.platform !== 'darwin' ? 0 : 28

  const [cwd, setCwd] = useState(start)
  const [hidden, setHidden] = useState(initialHidden)
  const [version, bump] = useReducer((x: number) => x + 1, 0)
  const [cursor, setCursor] = useState<Record<string, string>>({})
  const [marks, setMarks] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<Mode>({ kind: 'browse' })
  const [draft, setDraft] = useState('')
  const [jumpSel, setJumpSel] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const [clip, setClip] = useState<Clip | null>(() => readClip())
  const [hover, setHover] = useState<string | null>(null)
  const [git, setGit] = useState<GitInfo | null>(null)
  const rootRef = useRef<{ id: number } | null>(null)
  const offsets = useRef<Record<string, number>>({})
  const wheelAcc = useRef(0)
  const lastSubmit = useRef(0)

  const entries = useMemo(() => listDir(cwd, hidden), [cwd, hidden, version])
  const parent = cwd === sep ? null : dirname(cwd)
  const parentEntries = useMemo(() => (parent ? listDir(parent, hidden) : []), [parent, hidden, version])
  const selName = cursor[cwd]
  const idx = Math.max(0, entries.findIndex((e) => e.name === selName))
  const current = entries[idx]

  const photos = useMemo(() => entries.filter(isPhoto), [entries])
  const realCwd = useMemo(() => realDir(cwd), [cwd])
  const realParent = useMemo(() => realDir(parent), [parent])
  useEffect(() => {
    let alive = true
    gitInfo(cwd).then((g) => alive && setGit(g))
    return () => {
      alive = false
    }
  }, [cwd, version])
  const free = useMemo(() => {
    try {
      const s = statfsSync(cwd)
      return s.bavail * s.bsize
    } catch {
      return null
    }
  }, [cwd, version])
  const totalBytes = useMemo(() => entries.reduce((n, e) => n + (e.isDir ? 0 : e.size), 0), [entries])

  const showParent = width >= 900 && !!parent
  const showPreview = width >= 520
  const listH = height - chromeTop - TOP - BOTTOM - 12
  const visible = Math.max(3, Math.floor(listH / ROW))

  // Keep the cursor inside the window of rows for the current column.
  let off = offsets.current[cwd] ?? 0
  if (idx < off) off = idx
  if (idx >= off + visible) off = idx - visible + 1
  off = Math.max(0, Math.min(off, Math.max(0, entries.length - visible)))
  offsets.current[cwd] = off

  const flash = (text: string, tone: Toast['tone'] = 'ok') => setToast({ text, tone, at: Date.now() })
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast((cur) => (cur === toast ? null : cur)), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // Live refresh: changes from another split, a shell, or Finder land immediately.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const ping = () => {
      clearTimeout(timer)
      timer = setTimeout(bump, 60)
    }
    const watchers: FSWatcher[] = []
    for (const d of [cwd, parent, current?.isDir ? current.path : null]) {
      if (!d) continue
      try {
        watchers.push(watch(d, ping))
      } catch {}
    }
    return () => {
      clearTimeout(timer)
      watchers.forEach((w) => w.close())
    }
  }, [cwd, parent, current?.path])

  useEffect(() => {
    const t = setInterval(() => {
      const c = readClip()
      setClip((prev) => (prev?.at === c?.at ? prev : c))
    }, clipPollMs)
    return () => clearInterval(t)
  }, [clipPollMs])

  const focusRoot = () => setTimeout(() => rootRef.current && (renderer as unknown as { focusElement?: (id: number) => void } | null)?.focusElement?.(rootRef.current.id), 0)
  const close = () => {
    setMode({ kind: 'browse' })
    setDraft('')
    focusRoot()
  }

  const select = (name: string | undefined, dir = cwd) => name !== undefined && setCursor((c) => ({ ...c, [dir]: name }))
  const move = (d: number) => entries.length && select(entries[Math.max(0, Math.min(entries.length - 1, idx + d))]!.name)
  const goto = (dir: string, pick?: string) => {
    setCwd(dir)
    if (pick) select(pick, dir)
  }
  const up = () => parent && goto(parent, basename(cwd))
  const enter = (e = current) => {
    if (!e) return
    if (e.isDir) goto(e.path)
    else if (isPhoto(e)) {
      select(e.name)
      setMode({ kind: 'look' })
    } else {
      openFile(e.path)
      flash(`Opened ${e.name}`, 'info')
    }
  }
  const toggleMark = (e = current) => {
    if (!e) return
    setMarks((m) => {
      const n = new Set(m)
      n.has(e.path) ? n.delete(e.path) : n.add(e.path)
      return n
    })
  }
  const targets = () => (marks.size ? [...marks] : current ? [current.path] : [])
  const yank = (kind: Clip['mode']) => {
    const paths = targets()
    if (!paths.length) return
    const c = { mode: kind, paths, at: Date.now() }
    writeClip(c)
    setClip(c)
    setMarks(new Set())
    flash(`${kind === 'copy' ? 'Copied' : 'Cut'} ${plural(paths.length, 'item')} · press p to paste`, 'info')
  }
  const paste = () => {
    const c = readClip()
    if (!c) return flash('Clipboard is empty', 'err')
    try {
      const done = c.mode === 'copy' ? copyInto(c.paths, cwd) : moveInto(c.paths, cwd)
      if (c.mode === 'cut') {
        writeClip(null)
        setClip(null)
      }
      bump()
      select(basename(done[0] ?? ''))
      flash(`${c.mode === 'copy' ? 'Pasted' : 'Moved'} ${plural(done.length, 'item')} into ${basename(cwd)}`)
    } catch (err) {
      flash((err as Error).message, 'err')
    }
  }
  const doTrash = (paths: string[]) => {
    try {
      const n = trash(paths)
      const nextIdx = Math.min(idx, entries.length - 1 - n)
      const remaining = entries.filter((e) => !paths.includes(e.path))
      select(remaining[Math.max(0, Math.min(nextIdx, remaining.length - 1))]?.name)
      setMarks(new Set())
      bump()
      flash(`Moved ${plural(n, 'item')} to Trash`)
    } catch (err) {
      flash((err as Error).message, 'err')
    }
    close()
  }

  const jumpRoot = start
  const jumpIndex = useMemo(() => (mode.kind === 'jump' ? walk(jumpRoot, hidden) : []), [mode.kind === 'jump', jumpRoot, hidden, version])
  const jumpResults = useMemo(() => {
    if (mode.kind !== 'jump') return []
    const q = draft.trim()
    const scored: { rel: string; score: number; indices: number[]; onName: boolean }[] = []
    for (const rel of jumpIndex) {
      if (!q) {
        if (scored.length < 9) scored.push({ rel, score: 0, indices: [], onName: true })
        continue
      }
      const name = basename(rel)
      const m = fuzzyMatch(q, name)
      if (m) scored.push({ rel, score: m.score + 25 - rel.split(sep).length, indices: m.indices, onName: true })
      else {
        const full = fuzzyMatch(q, rel)
        if (full) scored.push({ rel, score: full.score - 10, indices: [], onName: false })
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 9)
  }, [mode.kind, draft, jumpIndex])

  const submit = () => {
    const now = performance.now()
    if (now - lastSubmit.current < 80) return
    lastSubmit.current = now
    if (mode.kind === 'jump') {
      const hit = jumpResults[Math.min(jumpSel, jumpResults.length - 1)]
      if (hit) {
        const abs = join(jumpRoot, hit.rel)
        goto(dirname(abs), basename(abs))
        flash(`Jumped to ${hit.rel}`, 'info')
      }
      close()
    } else if (mode.kind === 'rename') {
      try {
        const out = renameEntry(mode.target.path, draft)
        if (marks.has(mode.target.path)) setMarks(new Set([...marks].filter((p) => p !== mode.target.path)))
        bump()
        select(basename(out))
        flash(`Renamed to ${basename(out)}`)
        close()
      } catch (err) {
        flash((err as Error).message, 'err')
      }
    } else if (mode.kind === 'mkdir') {
      try {
        const out = makeDir(cwd, draft)
        bump()
        select(basename(out))
        flash(`Created ${basename(out)}`)
        close()
      } catch (err) {
        flash((err as Error).message, 'err')
      }
    } else if (mode.kind === 'trash') doTrash(mode.targets)
  }

  const quit = () => (onQuit ? onQuit() : process.exit(0))

  const onKeyDown = (e: KeyEvt) => {
    const key = e.key ?? ''
    const ch = e.keyChar ?? ''
    const m = e.modifiers ?? {}
    if (m.ctrl && key === 'c') return quit()
    if (mode.kind === 'look') {
      const c = ch || key
      const i = Math.max(0, photos.findIndex((p) => p.path === current?.path))
      const step = (d: number) => photos.length && select(photos[(i + d + photos.length) % photos.length]!.name)
      if (key === 'right' || key === 'down' || c === 'l' || c === 'j') step(1)
      else if (key === 'left' || key === 'up' || c === 'h' || c === 'k') step(-1)
      else if (key === 'escape' || key === 'enter' || key === 'space' || c === ' ' || c === 'q') close()
      else if (c === 'o' && current) openFile(current.path)
      return
    }
    if (mode.kind !== 'browse') {
      if (key === 'escape') return close()
      if (key === 'enter') return submit()
      // Ghostty binds cmd-a to select_all, so offer the readline way to clear a prompt.
      if (m.ctrl && key === 'u') return setDraft('')
      if (mode.kind === 'trash') {
        if (ch === 'y') return submit()
        if (ch === 'n') return close()
      }
      if (mode.kind === 'jump') {
        if (key === 'down' || (m.ctrl && key === 'n')) setJumpSel((s) => Math.min(s + 1, Math.max(0, jumpResults.length - 1)))
        if (key === 'up' || (m.ctrl && key === 'p')) setJumpSel((s) => Math.max(0, s - 1))
      }
      return
    }
    if (m.cmd) return
    const c = ch || key
    if (key === 'down' || c === 'j') move(1)
    else if (key === 'up' || c === 'k') move(-1)
    else if (key === 'right' || key === 'enter' || c === 'l') enter()
    else if (key === 'left' || key === 'backspace' || c === 'h') up()
    else if (c === 'G' || (key === 'g' && m.shift)) move(entries.length)
    else if (c === 'g') move(-entries.length)
    else if (key === 'pagedown' || (m.ctrl && key === 'd')) move(visible - 1)
    else if (key === 'pageup' || (m.ctrl && key === 'u')) move(-(visible - 1))
    else if (key === 'space' || c === ' ') {
      toggleMark()
      move(1)
    } else if (c === 'a') setMarks(marks.size === entries.length ? new Set() : new Set(entries.map((x) => x.path)))
    else if (key === 'escape') {
      if (marks.size) setMarks(new Set())
    } else if (c === 'y') yank('copy')
    else if (c === 'x') yank('cut')
    else if (c === 'p') paste()
    else if (c === 'r' && current) {
      setDraft(current.name)
      setMode({ kind: 'rename', target: current })
    } else if (c === 'd' || key === 'delete') {
      const t = targets()
      if (t.length) setMode({ kind: 'trash', targets: t })
    } else if (c === 'n') {
      setDraft('')
      setMode({ kind: 'mkdir' })
    } else if (c === '/' || c === 'f') {
      setDraft('')
      setJumpSel(0)
      setMode({ kind: 'jump' })
    } else if (c === '.') {
      setHidden((h) => !h)
      flash(hidden ? 'Hiding dotfiles' : 'Showing dotfiles', 'info')
    } else if (c === '~') goto(home)
    else if (c === 'o' && current) {
      openFile(current.path)
      flash(`Opened ${current.name}`, 'info')
    } else if (c === 'q') quit()
  }

  const onWheel = (deltaY: number, precise: boolean | undefined) => {
    wheelAcc.current += precise ? deltaY / ROW : deltaY
    const steps = Math.trunc(wheelAcc.current)
    if (!steps) return
    wheelAcc.current -= steps
    move(-steps)
  }

  const clickRow = (e: Entry, i: number, clicks: number) => {
    if (clicks >= 2 || (e.isDir && i === idx)) return enter(e)
    select(e.name)
  }

  const crumbs = useMemo(() => {
    const rel = cwd === home || cwd.startsWith(home + sep) ? relative(home, cwd) : null
    const parts: { label: string; path: string }[] = []
    if (rel !== null) {
      parts.push({ label: '~', path: home })
      let acc = home
      for (const seg of rel ? rel.split(sep) : []) parts.push({ label: seg, path: (acc = join(acc, seg)) })
    } else {
      parts.push({ label: '/', path: sep })
      let acc: string = sep
      for (const seg of cwd.split(sep).filter(Boolean)) parts.push({ label: seg, path: (acc = join(acc, seg)) })
    }
    const keep = width < 700 ? 2 : width < 1000 ? 4 : 8
    return parts.length > keep + 1 ? [parts[0]!, { label: '…', path: '' }, ...parts.slice(-keep)] : parts
  }, [cwd, home, width])

  return (
    <div
      ref={rootRef as never}
      testId="yard"
      autoFocus
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: T.bg, paddingTop: chromeTop, userSelect: 'none' }}
    >
      {/* Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', height: TOP, paddingLeft: 12, paddingRight: 16, gap: 4, flexShrink: 0 }}>
        <div testId="breadcrumbs" style={{ display: 'flex', alignItems: 'center', gap: 2, flexGrow: 1, minWidth: 0 }}>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <div key={c.path + i} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexShrink: last ? 1 : 0 }}>
                {i > 0 && <text style={{ color: T.faint, fontSize: 13 }}>/</text>}
                <div
                  testId={`crumb-${i}`}
                  onClick={() => c.path && goto(c.path, crumbs[i + 1]?.path ? basename(crumbs[i + 1]!.path) : undefined)}
                  style={{ display: 'flex', paddingLeft: 6, paddingRight: 6, height: 26, alignItems: 'center', borderRadius: 6, cursor: c.path ? 'pointer' : 'default', hover: c.path ? { backgroundColor: T.raised } : undefined, minWidth: 0 }}
                >
                  <text style={{ color: last ? T.fg : T.dim, fontSize: 13, fontWeight: last ? 500 : 400, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.label}</text>
                </div>
              </div>
            )
          })}
        </div>
        {git?.branch && (
          <div testId="git-branch" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, paddingLeft: 8, paddingRight: 8, flexShrink: 0 }}>
            <svg source={ICON.branch} style={{ width: 12, height: 12, color: T.faint }} />
            <text style={{ color: T.dim, fontSize: 12, whiteSpace: 'nowrap' }}>{git.branch.length > 28 ? git.branch.slice(0, 27) + '…' : git.branch}</text>
            {git.status.size > 0 && <div style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: T.orange }} />}
          </div>
        )}
        <div
          testId="toggle-hidden"
          onClick={() => setHidden((h) => !h)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 6, cursor: 'pointer', flexShrink: 0, hover: { backgroundColor: T.raised } }}
        >
          <svg source={ICON.eye} style={{ width: 13, height: 13, color: hidden ? T.blue : T.dim }} />
          <text style={{ color: hidden ? T.blue : T.dim, fontSize: 12 }}>{hidden ? 'Hidden files' : 'Hidden'}</text>
        </div>
      </div>

      {/* Miller columns */}
      <div style={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
        {showParent && (
          <Column
            testId="parent"
            entries={parentEntries}
            cursor={parentEntries.findIndex((e) => e.path === cwd)}
            offset={Math.max(0, Math.min(parentEntries.findIndex((e) => e.path === cwd) - Math.floor(visible / 2), parentEntries.length - visible))}
            visible={visible}
            active={false}
            marks={marks}
            hover={hover}
            setHover={setHover}
            flex={2}
            git={git?.status}
            realDir={realParent}
            onClick={(e) => (e.isDir ? goto(e.path) : parent && goto(parent, e.name))}
            onWheel={() => {}}
          />
        )}
        <Column
          testId="current"
          entries={entries}
          cursor={idx}
          offset={off}
          visible={visible}
          active
          marks={marks}
          clipPaths={clip?.mode === 'cut' ? clip.paths : undefined}
          hover={hover}
          setHover={setHover}
          flex={3}
          git={git?.status}
          realDir={realCwd}
          onClick={(e, i, clicks) => clickRow(e, i, clicks)}
          onAux={(e) => toggleMark(e)}
          onWheel={onWheel}
        />
        {showPreview && (
          <div style={{ display: 'flex', flexGrow: 5, flexBasis: 0, minWidth: 0 }}>
            <Preview entry={current} width={(width * 5) / (showParent ? 10 : 8)} height={listH} showHidden={hidden} version={version} siblings={photos} onPick={(n) => select(n)} />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div testId="status" style={{ display: 'flex', alignItems: 'center', height: BOTTOM, paddingLeft: 20, paddingRight: 20, gap: 16, flexShrink: 0 }}>
        <text testId="position" style={{ color: T.dim, fontSize: 12 }}>{entries.length ? `${idx + 1}/${entries.length}` : '0/0'}</text>
        {!toast && !marks.size && !clip && (
          <text testId="summary" style={{ color: T.faint, fontSize: 12, whiteSpace: 'nowrap' }}>
            {[totalBytes ? formatSize(totalBytes) : '', free !== null ? `${formatSize(free)} available` : ''].filter(Boolean).join('  ·  ')}
          </text>
        )}
        {marks.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg source={ICON.check} style={{ width: 12, height: 12, color: T.green }} />
            <text testId="marked" style={{ color: T.green, fontSize: 12, fontWeight: 600 }}>{`${marks.size} selected`}</text>
          </div>
        )}
        {clip && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg source={clip.mode === 'copy' ? ICON.copy : ICON.cut} style={{ width: 12, height: 12, color: clip.mode === 'copy' ? T.blue : T.yellow }} />
            <text testId="clip" style={{ color: clip.mode === 'copy' ? T.blue : T.yellow, fontSize: 12 }}>
              {`${plural(clip.paths.length, 'item')} ${clip.mode === 'copy' ? 'copied' : 'cut'}`}
            </text>
          </div>
        )}
        {toast && (
          <motion.div key={toast.at} initial={{ opacity: 0, left: -6 }} animate={{ opacity: 1, left: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }} style={{ display: 'flex', position: 'relative', minWidth: 0, flexShrink: 1 }}>
          <text testId="toast" style={{ color: toast.tone === 'err' ? T.red : toast.tone === 'ok' ? T.green : T.fg, fontSize: 12, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>
            {toast.text}
          </text>
          </motion.div>
        )}
        <div style={{ flexGrow: 1 }} />
        <Hints width={width} />
      </div>

      {mode.kind === 'look' && current && isPhoto(current) && (
          <Viewer key="viewer" entry={current} index={photos.findIndex((p) => p.path === current.path)} count={photos.length} width={width} height={height - chromeTop} top={chromeTop} onClose={close} onStep={(d) => {
            const i = Math.max(0, photos.findIndex((p) => p.path === current.path))
            select(photos[(i + d + photos.length) % photos.length]!.name)
          }} />
        )}
      {mode.kind !== 'browse' && mode.kind !== 'look' && (
        <Overlay
          mode={mode}
          width={width}
          draft={draft}
          setDraft={(v) => {
            setDraft(v)
            setJumpSel(0)
          }}
          submit={submit}
          close={close}
          jumpResults={jumpResults}
          jumpSel={jumpSel}
          setJumpSel={setJumpSel}
          pickJump={(i) => {
            setJumpSel(i)
            const hit = jumpResults[i]
            if (hit) {
              const abs = join(jumpRoot, hit.rel)
              goto(dirname(abs), basename(abs))
            }
            close()
          }}
        />
      )}
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function Column(props: {
  testId: string
  entries: Entry[]
  cursor: number
  offset: number
  visible: number
  active: boolean
  marks: Set<string>
  clipPaths?: string[]
  hover: string | null
  setHover: (p: string | null) => void
  flex: number
  git?: Map<string, GitCode>
  realDir: string
  onClick: (e: Entry, i: number, clicks: number) => void
  onAux?: (e: Entry) => void
  onWheel: (deltaY: number, precise: boolean | undefined) => void
}) {
  const { entries, cursor, offset, visible, active, marks, hover } = props
  const rows = entries.slice(offset, offset + visible)
  const inView = cursor >= offset && cursor < offset + visible && cursor < entries.length
  const selMarked = inView && marks.has(entries[cursor]!.path)
  return (
    <div
      testId={`col-${props.testId}`}
      onScroll={(e: { deltaY?: number; precise?: boolean }) => props.onWheel(e.deltaY ?? 0, e.precise)}
      style={{ display: 'flex', flexDirection: 'column', flexGrow: props.flex, flexBasis: 0, minWidth: 0, paddingTop: 4, paddingLeft: 8, paddingRight: 8, position: 'relative' }}
    >
      {inView && (
        <motion.div
          initial={false}
          animate={{ top: 4 + (cursor - offset) * ROW }}
          transition={{ duration: 0.14, ease: [0.25, 0.8, 0.25, 1] }}
          style={{ position: 'absolute', left: 8, right: 8, height: ROW, borderRadius: 7, backgroundColor: active ? (selMarked ? T.greenSoft : T.blueSoft) : T.raised }}
        />
      )}
      {entries.length === 0 && (
        <div style={{ display: 'flex', padding: 14 }}>
          <text style={{ color: T.faint, fontSize: 13 }}>Empty folder</text>
        </div>
      )}
      {rows.map((e, k) => {
        const i = offset + k
        const sel = i === cursor
        const marked = marks.has(e.path)
        const cut = props.clipPaths?.includes(e.path)
        const solid = sel && active
        const fg = marked ? T.green : solid || sel ? T.fg : e.hidden || cut ? T.faint : active ? T.fg : T.muted
        const g = props.git?.get(join(props.realDir, e.name))
        return (
          <div
            key={e.path}
            testId={`${props.testId}-row-${i}`}
            onClick={(ev: { clickCount?: number }) => props.onClick(e, i, ev.clickCount ?? 1)}
            onAuxClick={() => props.onAux?.(e)}
            onMouseEnter={() => props.setHover(e.path)}
            onMouseLeave={() => hover === e.path && props.setHover(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: ROW,
              flexShrink: 0,
              paddingLeft: 10,
              paddingRight: 10,
              borderRadius: 7,
              cursor: 'pointer',
              backgroundColor: !sel && hover === e.path ? '#0f131a' : undefined,
              opacity: cut ? 0.5 : 1,
            }}
          >
            <EntryIcon entry={e} size={15} color={solid && !e.isDir ? T.fg : undefined} />
            <text style={{ color: fg, fontSize: 13.5, fontWeight: solid ? 500 : 400, flexGrow: 1, flexBasis: 0, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{e.name}</text>
            {g && (
              <div testId={`git-${e.name}`} style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                {solid && active && <text style={{ color: GIT_COLOR[g], fontSize: 11 }}>{GIT_LABEL[g]}</text>}
                <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GIT_COLOR[g] }} />
              </div>
            )}
            {marked && <svg source={ICON.check} style={{ width: 13, height: 13, color: T.green, flexShrink: 0 }} />}
            {active && (
              <text style={{ color: solid ? T.muted : T.faint, fontSize: 12, flexShrink: 0 }}>{e.isDir ? (e.children !== undefined ? String(e.children) : '') : formatSize(e.size)}</text>
            )}
            {!active && e.isDir && <svg source={ICON.chevron} style={{ width: 10, height: 10, color: T.faint, flexShrink: 0 }} />}
          </div>
        )
      })}
    </div>
  )
}

function Viewer(props: { entry: Entry; index: number; count: number; width: number; height: number; top: number; onClose: () => void; onStep: (d: number) => void }) {
  const { entry, width, height } = props
  const dims = useMemo(() => imageSize(entry.path), [entry.path])
  const exif = useMemo(() => readExif(entry.path), [entry.path])
  const ratio = dims ? dims.width / dims.height : 1.5
  const maxW = width - 96
  const maxH = height - 150
  const w = Math.round(Math.min(maxW, maxH * ratio))
  const h = Math.round(w / ratio)
  const info = [exif?.camera, exposureLine(exif).replace(/ {3}/g, '  ·  ')].filter(Boolean).join('  ·  ')
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      style={{ position: 'absolute', top: props.top, left: 0, right: 0, bottom: 0, display: 'flex' }}
    >
    <div
      testId="viewer"
      onClick={props.onClose}
      onScroll={(e: { deltaY?: number }) => {
        if (Math.abs(e.deltaY ?? 0) > 2) props.onStep((e.deltaY ?? 0) < 0 ? 1 : -1)
      }}
      style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 22, backgroundColor: '#05070af5' }}
    >
      <motion.div key={entry.path} initial={{ opacity: 0.25 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: 'easeOut' }} style={{ display: 'flex' }}>
        <img testId="viewer-image" src={entry.path} objectFit="cover" style={{ width: w, height: h, borderRadius: 12 }} />
      </motion.div>
      <div style={{ display: 'flex', alignItems: 'center', width: w, gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          <text testId="viewer-title" style={{ color: T.fg, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{entry.name}</text>
          <text style={{ color: T.dim, fontSize: 12, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{info || (dims ? `${dims.width} × ${dims.height}` : '')}</text>
        </div>
        <text testId="viewer-index" style={{ color: T.dim, fontSize: 12, flexShrink: 0 }}>{`${props.index + 1} of ${props.count}`}</text>
        <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
          <Key k="← →" label="browse" />
          <Key k="esc" label="close" />
        </div>
      </div>
    </div>
    </motion.div>
  )
}

function Key({ k, label }: { k: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <text style={{ color: T.muted, fontSize: 12, fontWeight: 600 }}>{k}</text>
      <text style={{ color: T.faint, fontSize: 12 }}>{label}</text>
    </div>
  )
}

function Hints({ width }: { width: number }) {
  const all: [string, string][] = [
    ['space', 'select'],
    ['y', 'copy'],
    ['p', 'paste'],
    ['r', 'rename'],
    ['d', 'trash'],
    ['/', 'jump'],
    ['.', 'hidden'],
  ]
  const n = width >= 1200 ? 7 : width >= 980 ? 5 : width >= 760 ? 3 : 0
  return (
    <div style={{ display: 'flex', gap: 18, flexShrink: 0 }}>
      {all.slice(0, n).map(([k, l]) => (
        <Key key={k} k={k} label={l} />
      ))}
    </div>
  )
}

function Overlay(props: {
  mode: Mode
  width: number
  draft: string
  setDraft: (v: string) => void
  submit: () => void
  close: () => void
  jumpResults: { rel: string; indices: number[]; onName: boolean }[]
  jumpSel: number
  setJumpSel: (i: number) => void
  pickJump: (i: number) => void
}) {
  const { mode } = props
  const cardW = Math.min(640, props.width - 48)
  const title = mode.kind === 'jump' ? 'Jump to' : mode.kind === 'rename' ? `Rename ${mode.target.name}` : mode.kind === 'mkdir' ? 'New folder' : 'Move to Trash?'
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex' }}
    >
    <div
      testId="overlay"
      onClick={props.close}
      style={{ display: 'flex', flexGrow: 1, justifyContent: 'center', alignItems: 'start', paddingTop: 80, backgroundColor: '#0a0c10c8' }}
    >
      <motion.div
        onClick={() => {}}
        initial={{ top: -10 }}
        animate={{ top: 0 }}
        transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
        style={{ display: 'flex', flexDirection: 'column', position: 'relative', width: cardW, borderRadius: 14, borderWidth: 1, borderColor: T.line, backgroundColor: T.panel, boxShadow: { offsetX: 0, offsetY: 18, blurRadius: 48, spreadRadius: 0, color: '#000000aa' } }}
      >
        {mode.kind === 'trash' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg source={ICON.trash} style={{ width: 18, height: 18, color: T.red }} />
              <text style={{ color: T.fg, fontSize: 16, fontWeight: 600 }}>{`Move ${plural(mode.targets.length, 'item')} to Trash?`}</text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {mode.targets.slice(0, 4).map((p) => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon entry={{ kind: kindOf(basename(p), false) }} size={13} />
                  <text style={{ color: T.muted, fontSize: 13 }}>{basename(p)}</text>
                </div>
              ))}
              {mode.targets.length > 4 && <text style={{ color: T.dim, fontSize: 12 }}>{`and ${mode.targets.length - 4} more`}</text>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'end', gap: 8, paddingTop: 4 }}>
              <div testId="trash-cancel" onClick={props.close} style={{ display: 'flex', paddingLeft: 14, paddingRight: 14, height: 30, alignItems: 'center', borderRadius: 7, backgroundColor: T.raised, cursor: 'pointer' }}>
                <text style={{ color: T.fg, fontSize: 13 }}>Cancel  esc</text>
              </div>
              <div testId="trash-confirm" onClick={props.submit} style={{ display: 'flex', paddingLeft: 14, paddingRight: 14, height: 30, alignItems: 'center', borderRadius: 7, backgroundColor: T.red, cursor: 'pointer' }}>
                <text style={{ color: T.bg, fontSize: 13, fontWeight: 600 }}>Move to Trash  ↵</text>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 16, height: 50, borderBottomWidth: 1, borderColor: T.line }}>
              <svg source={mode.kind === 'jump' ? ICON.search : mode.kind === 'mkdir' ? ICON.dir : ICON.text} style={{ width: 16, height: 16, color: T.blue }} />
              <input
                testId="prompt"
                autoFocus
                value={props.draft}
                placeholder={mode.kind === 'jump' ? 'Fuzzy jump to any file or folder…' : title}
                onChange={(e: { value?: string }) => props.setDraft(e.value ?? '')}
                onSubmit={props.submit}
                theme={{ caret: T.blue }}
                style={{ flexGrow: 1, fontSize: 16, color: T.fg, backgroundColor: T.panel }}
              />
              <text style={{ color: T.dim, fontSize: 12 }}>{mode.kind === 'jump' ? 'esc' : `${title}  ↵`}</text>
            </div>
            {mode.kind === 'jump' && (
              <div testId="jump-results" style={{ display: 'flex', flexDirection: 'column', padding: 6 }}>
                {props.jumpResults.length === 0 && (
                  <div style={{ display: 'flex', padding: 12 }}>
                    <text style={{ color: T.dim, fontSize: 13 }}>No matches</text>
                  </div>
                )}
                {props.jumpResults.map((r, i) => {
                  const name = basename(r.rel)
                  const dir = dirname(r.rel)
                  const sel = i === props.jumpSel
                  const isDir = !name.includes('.') && kindOf(name, false) === 'other'
                  return (
                    <div
                      key={r.rel}
                      testId={`jump-${i}`}
                      onClick={() => props.pickJump(i)}
                      onMouseEnter={() => props.setJumpSel(i)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, paddingLeft: 10, paddingRight: 10, borderRadius: 7, backgroundColor: sel ? T.blueSoft : T.panel, cursor: 'pointer' }}
                    >
                      <Icon entry={{ kind: isDir ? 'dir' : kindOf(name, false) }} size={15} />
                      <div style={{ display: 'flex', minWidth: 0 }}>
                        {highlightRuns(name, r.onName ? r.indices : []).map((run, k) => (
                          <text key={k} style={{ color: run.match ? T.blue : T.fg, fontSize: 14, fontWeight: run.match ? 700 : 400 }}>{run.text}</text>
                        ))}
                      </div>
                      <text style={{ color: T.dim, fontSize: 12, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{dir === '.' ? '' : dir}</text>
                      {sel && <text style={{ color: T.dim, fontSize: 12 }}>↵</text>}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
    </motion.div>
  )
}
