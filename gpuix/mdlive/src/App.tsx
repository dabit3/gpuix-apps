import {
  findRanges,
  isTerminal,
  motion,
  useGpuixRequired,
  useTextSearch,
  type GpuixTheme,
  type KeyEvent,
  type PublicInstance,
} from '@gpuix/react'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { changedBlock, docDir, headings, parseBlocks, searchableText, stats, toggleTask, type Block, type Task } from './doc'
import { imageSize } from './imagesize'
import { loadPalette, uiTheme, alpha, type Palette, type UiTheme } from './theme'
import { readSnapshot, watchDocument } from './watch'

export type AppProps = {
  file: string
  wide?: boolean
  toc?: boolean
  follow?: boolean
  palette?: Palette
}

/** Window-level key events land here (terminal + native window), and tests call it directly. */
export const keyBus: { handler: ((e: KeyEvent) => void) | null } = { handler: null }

const NARROW_COL = 760
const TOC_W = 236
const TOC_MIN_WINDOW = 860
const BAR_H = 40

const tildify = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p)

function ago(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 2) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

function mdTheme(t: UiTheme): GpuixTheme {
  return {
    appearance: 'dark',
    bg: t.bg,
    border: t.hairline,
    text: t.text,
    textMuted: t.text2,
    textFaint: t.text3,
    textDim: t.text3,
    accent: t.blue,
    caret: t.blue,
    codeText: t.text,
    codeWash: t.raised,
    syntax: {
      comment: '#9ea7b3',
      keyword: t.red,
      string: '#addcff',
      stringSpecial: '#addcff',
      escape: t.cyan,
      number: '#91cbff',
      boolean: '#91cbff',
      constant: '#91cbff',
      typeName: t.yellow,
      typeBuiltin: t.yellow,
      function: t.cyan,
      functionBuiltin: t.cyan,
      property: '#91cbff',
      tag: t.green,
      attribute: '#91cbff',
      operator: t.text,
      punctuation: t.text2,
      variable: t.text,
    } as GpuixTheme['syntax'],
    metrics: {
      mdTextSize: 15,
      mdLineHeight: 25,
      mdBlockGap: 14,
      mdHeadingSizes: [30, 23, 18, 16],
      mdHeadingLineHeights: [40, 32, 26, 24],
      codeTextSize: 13.5,
      codeLineHeight: 21,
      mdTableCellPadding: 10,
      mdCodeRadius: 8,
    },
  }
}

export function App({ file, wide: wideInit = false, toc: tocInit = true, follow: followInit = true, palette }: AppProps) {
  const renderer = useGpuixRequired()
  const path = resolve(file)
  const t = useMemo(() => uiTheme(palette ?? loadPalette()), [palette])
  const theme = useMemo(() => mdTheme(t), [t])

  const [snap, setSnap] = useState(() => readSnapshot(path))
  const [updatedAt, setUpdatedAt] = useState(() => snap?.mtime ?? Date.now())
  const [reloads, setReloads] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [wide, setWide] = useState(wideInit)
  const [tocOpen, setTocOpen] = useState(tocInit)
  const [follow, setFollow] = useState(followInit)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(null)
  const [winW, setWinW] = useState(1200)
  const [winH, setWinH] = useState(800)
  const [colW, setColW] = useState(700)

  const baseDir = docDir(path)
  const blocks = useMemo(() => parseBlocks(snap?.text ?? '', baseDir), [snap?.text, baseDir])
  const toc = useMemo(() => headings(blocks), [blocks])
  const st = useMemo(() => stats(blocks), [blocks])
  const prevBlocks = useRef(blocks)

  const scrollRef = useRef<PublicInstance | null>(null)
  const blockRefs = useRef(new Map<string, PublicInstance>())
  const findRef = useRef<PublicInstance | null>(null)
  const rootRef = useRef<PublicInstance | null>(null)

  // live reload
  useEffect(
    () =>
      watchDocument(path, (s) => {
        setSnap(s)
        setUpdatedAt(Date.now())
        setReloads((n) => n + 1)
      }),
    [path],
  )
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const geometry = useCallback(
    (key: string) => {
      const sc = scrollRef.current
      const el = blockRefs.current.get(key)
      if (!sc || !el) return null
      const vb = renderer.getElementBounds?.(sc.id)
      const eb = renderer.getElementBounds?.(el.id)
      if (!vb || !eb) return null
      const off = renderer.getScrollOffset?.(sc.id)?.[1] ?? 0
      return { top: eb.y - vb.y, contentY: eb.y - vb.y - off, height: eb.height, viewport: vb.height }
    },
    [renderer],
  )

  const scrollToBlock = useCallback(
    (key: string, align = 0.3, onlyIfHidden = false) => {
      const g = geometry(key)
      const sc = scrollRef.current
      if (!g || !sc) return false
      if (onlyIfHidden && g.top >= 24 && g.top + Math.min(g.height, 120) <= g.viewport - 24) return true
      const target = Math.max(0, g.contentY - (align === 0 ? 20 : g.viewport * align))
      renderer.scrollTo?.(sc.id, 0, -target)
      return true
    },
    [geometry, renderer],
  )

  const scrollBy = useCallback(
    (dy: number) => {
      const sc = scrollRef.current
      if (!sc) return
      const off = renderer.getScrollOffset?.(sc.id)?.[1] ?? 0
      renderer.scrollTo?.(sc.id, 0, Math.min(0, off - dy))
    },
    [renderer],
  )

  const updateActive = useCallback(() => {
    let best: string | null = toc[0]?.key ?? null
    for (const h of toc) {
      const g = geometry(h.key)
      if (g && g.top <= 72) best = h.key
    }
    setActiveKey(best)
  }, [geometry, toc])

  // scroll-follow: after a reload, jump to the last edited block and flash it
  useEffect(() => {
    const prev = prevBlocks.current
    prevBlocks.current = blocks
    if (prev === blocks) return
    const idx = changedBlock(prev, blocks)
    if (idx === null) return
    const b = blocks[idx]
    if (!b) return
    setFlash((f) => ({ key: b.key, n: (f?.n ?? 0) + 1 }))
    if (!follow) return
    const tm = setTimeout(() => {
      scrollToBlock(b.key, 0.3, true)
      setTimeout(updateActive, 60)
    }, 50)
    return () => clearTimeout(tm)
  }, [blocks, follow, scrollToBlock, updateActive])

  useEffect(() => {
    const tm = setTimeout(updateActive, 80)
    return () => clearTimeout(tm)
  }, [updateActive, wide, tocOpen, winW])

  const onToggleTask = useCallback(
    (line: number) => {
      try {
        const src = readFileSync(file, 'utf8')
        const next = toggleTask(src, line)
        if (next !== src) writeFileSync(file, next)
      } catch {}
    },
    [file],
  )

  // find-in-page
  const perBlock = useMemo(
    () => blocks.map((b) => (query ? findRanges({ text: searchableText(b), query }).length : 0)),
    [blocks, query],
  )
  const matchTotal = useMemo(() => perBlock.reduce((a, b) => a + b, 0), [perBlock])
  const search = useTextSearch({
    query: findOpen ? query : '',
    matches: { total: matchTotal, indexOffset: 0 },
  })
  useEffect(() => {
    if (!findOpen || !query || search.total === 0) return
    let n = search.active
    for (let i = 0; i < blocks.length; i++) {
      n -= perBlock[i]!
      if (n < 0) {
        scrollToBlock(blocks[i]!.key, 0.35, true)
        break
      }
    }
  }, [search.active, search.total, findOpen, query, blocks, perBlock, scrollToBlock])

  const lastNext = useRef(0)
  const findNext = useCallback(
    (back = false) => {
      if (Date.now() - lastNext.current < 60) return
      lastNext.current = Date.now()
      if (back) search.previous()
      else search.next()
    },
    [search],
  )

  const openFind = useCallback(() => {
    setFindOpen(true)
    setTimeout(() => findRef.current && renderer.focusElement?.(findRef.current.id), 40)
  }, [renderer])
  const closeFind = useCallback(() => {
    setFindOpen(false)
    setTimeout(() => rootRef.current && renderer.focusElement?.(rootRef.current.id), 20)
  }, [renderer])

  const typing = useCallback(
    () => findOpen && !!findRef.current && renderer.getFocusedElementId?.() === findRef.current.id,
    [findOpen, renderer],
  )

  const onKey = useCallback(
    (e: KeyEvent) => {
      const k = (e.key ?? '').toLowerCase()
      const m = (e as { modifiers?: { shift?: boolean; ctrl?: boolean; cmd?: boolean } }).modifiers ?? {}
      if (k === 'escape') {
        if (findOpen) closeFind()
        return
      }
      if (typing()) {
        if (k === 'enter') findNext(!!m.shift)
        return
      }
      if ((k === 'f' && (m.ctrl || m.cmd)) || k === '/') return openFind()
      if (m.ctrl || m.cmd) return
      const vh = scrollRef.current ? (renderer.getElementBounds?.(scrollRef.current.id)?.height ?? 600) : 600
      switch (k) {
        case 'w':
          setWide((v) => !v)
          break
        case 't':
          setTocOpen((v) => !v)
          break
        case 'f':
          setFollow((v) => !v)
          break
        case 'n':
          if (findOpen && query) findNext(!!m.shift)
          break
        case 'j':
        case 'down':
          scrollBy(72)
          break
        case 'k':
        case 'up':
          scrollBy(-72)
          break
        case 'space':
        case 'pagedown':
        case 'd':
          scrollBy(vh * (m.shift && k === 'space' ? -0.85 : 0.85))
          break
        case 'pageup':
        case 'u':
          scrollBy(-vh * 0.85)
          break
        case 'g':
        case 'home':
        case 'end': {
          const toEnd = k === 'end' || (k === 'g' && m.shift) || e.key === 'G'
          if (toEnd) scrollBy(1e7)
          else if (scrollRef.current) renderer.scrollTo?.(scrollRef.current.id, 0, 0)
          setTimeout(updateActive, 60)
          break
        }
        case ']':
        case '[': {
          const i = Math.max(0, toc.findIndex((h) => h.key === activeKey))
          const next = toc[k === ']' ? Math.min(toc.length - 1, i + 1) : Math.max(0, i - 1)]
          if (next) {
            scrollToBlock(next.key, 0)
            setActiveKey(next.key)
          }
          break
        }
        case 'q':
          process.exit(0)
      }
    },
    [activeKey, closeFind, findNext, findOpen, openFind, query, renderer, scrollBy, scrollToBlock, toc, typing, updateActive],
  )
  useEffect(() => {
    keyBus.handler = onKey
    return () => {
      if (keyBus.handler === onKey) keyBus.handler = null
    }
  }, [onKey])

  const showToc = tocOpen && toc.length > 0 && winW >= TOC_MIN_WINDOW
  const compact = winW < 640
  const padX = compact ? 20 : wide ? 48 : 40
  const term = isTerminal()
  const macWindow = process.platform === 'darwin' && !term

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      autoFocus
      onKeyDown={(e) => onKey(e as KeyEvent)}
      onLayout={(e) => {
        setWinW(e.width ?? 1200)
        setWinH(e.height ?? 800)
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: t.bg,
      }}
    >
      {/* top bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          height: BAR_H,
          flexShrink: 0,
          paddingLeft: macWindow ? 86 : 16,
          paddingRight: 12,
          gap: 10,
          borderBottomWidth: 1,
          borderColor: t.hairline,
          userSelect: 'none',
        }}
      >
        <LiveDot t={t} pulse={reloads} />
        <text testId="file-name" style={{ color: t.text, fontSize: 13.5, fontWeight: 600 }}>
          {basename(path)}
        </text>
        {!compact && (
          <text style={{ color: t.text3, fontSize: 12.5, flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {tildify(dirname(path))}
          </text>
        )}
        <div style={{ flexGrow: 1 }} />
        <text testId="word-count" style={{ color: t.text2, fontSize: 12.5 }}>
          {`${st.words.toLocaleString('en-US')} words`}
        </text>
        <text style={{ color: t.text3, fontSize: 12.5 }}>·</text>
        <text testId="read-time" style={{ color: t.text2, fontSize: 12.5 }}>
          {`${st.minutes} min read`}
        </text>
        {!compact && (
          <>
            <div style={{ width: 6 }} />
            <Segmented
              t={t}
              testId="width-toggle"
              options={['Narrow', 'Wide']}
              value={wide ? 'Wide' : 'Narrow'}
              onChange={(v) => setWide(v === 'Wide')}
            />
            <IconButton t={t} testId="toc-toggle" label="Contents" active={showToc} onClick={() => setTocOpen((v) => !v)} glyph="≡" />
          </>
        )}
        <IconButton t={t} testId="find-toggle" label="Find" active={findOpen} onClick={() => (findOpen ? closeFind() : openFind())} glyph="⌕" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        {/* TOC */}
        <motion.div
          initial={false}
          animate={{ width: showToc ? TOC_W : 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{ overflow: 'hidden', flexShrink: 0, display: 'flex', flexDirection: 'row' }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: TOC_W,
              flexShrink: 0,
              paddingTop: 18,
              paddingLeft: 14,
              paddingRight: 10,
              gap: 1,
              borderRightWidth: 1,
              borderColor: t.hairline,
              userSelect: 'none',
              overflow: 'scroll',
            }}
          >
            <text style={{ color: t.text3, fontSize: 11, fontWeight: 600, paddingLeft: 10, paddingBottom: 8 }}>
              CONTENTS
            </text>
            {toc.map((h) => (
              <TocRow
                key={h.key}
                t={t}
                title={h.title}
                slug={h.slug}
                level={h.level}
                active={h.key === activeKey}
                onClick={() => {
                  scrollToBlock(h.key, 0)
                  setActiveKey(h.key)
                }}
              />
            ))}
          </div>
        </motion.div>

        {/* document */}
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, position: 'relative' }}>
          <div
            ref={scrollRef}
            testId="doc-scroll"
            onScrollChange={updateActive}
            style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflow: 'scroll', alignItems: 'center' }}
          >
            <div
              testId="doc"
              {...search.props}
              onLayout={(e) => setColW(e.width ?? 700)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                maxWidth: wide ? 100000 : NARROW_COL + padX * 2,
                paddingLeft: padX,
                paddingRight: padX,
                paddingTop: 28,
                paddingBottom: Math.max(160, winH - BAR_H * 2 - 120),
              }}
            >
              {!snap && (
                <text testId="missing" style={{ color: t.text2, fontSize: 15 }}>
                  {`Waiting for ${basename(path)} to appear…`}
                </text>
              )}
              {blocks.map((b) => (
                <BlockView
                  key={b.key}
                  block={b}
                  t={t}
                  theme={theme}
                  maxW={Math.max(120, colW - padX * 2)}
                  flashN={flash?.key === b.key ? flash.n : 0}
                  onToggleTask={onToggleTask}
                  registerRef={(el) => {
                    if (el) blockRefs.current.set(b.key, el)
                    else blockRefs.current.delete(b.key)
                  }}
                />
              ))}
            </div>
          </div>

          {findOpen && (
            <FindBar
              t={t}
              inputRef={findRef}
              query={query}
              setQuery={setQuery}
              total={search.total}
              active={search.active}
              onNext={() => findNext(false)}
              onPrev={() => findNext(true)}
              onClose={closeFind}
              onKey={onKey}
            />
          )}
        </div>
      </div>

      {/* status bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          height: 28,
          flexShrink: 0,
          paddingLeft: 16,
          paddingRight: 16,
          gap: 14,
          borderTopWidth: 1,
          borderColor: t.hairline,
          userSelect: 'none',
        }}
      >
        <text testId="status-updated" style={{ color: t.text3, fontSize: 12 }}>
          {snap ? `Updated ${ago(now - updatedAt)}` : 'Not found'}
        </text>
        <text testId="status-follow" style={{ color: follow ? t.green : t.text3, fontSize: 12 }}>
          {follow ? 'Follow edits' : 'Follow off'}
        </text>
        {!compact && (
          <text style={{ color: t.text3, fontSize: 12 }}>{`${st.headings} sections · ${st.codeBlocks} code ${st.codeBlocks === 1 ? 'block' : 'blocks'}`}</text>
        )}
        <div style={{ flexGrow: 1 }} />
        {winW >= 900 && (
          <text style={{ color: t.text3, fontSize: 12 }}>
            {'/ find   w width   t contents   f follow   j k scroll   [ ] sections   ^C quit'}
          </text>
        )}
      </div>
    </div>
  )
}

function LiveDot({ t, pulse }: { t: UiTheme; pulse: number }) {
  return (
    <div style={{ display: 'flex', width: 14, height: 14, alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <motion.div
        key={pulse}
        initial={pulse ? { width: 6, height: 6, opacity: 0.9, borderRadius: 3 } : false}
        animate={{ width: 14, height: 14, opacity: 0, borderRadius: 7 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
        style={{ position: 'absolute', backgroundColor: t.green, pointerEvents: 'none' }}
      />
      <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.green }} />
    </div>
  )
}

function Segmented({
  t,
  options,
  value,
  onChange,
  testId,
}: {
  t: UiTheme
  options: string[]
  value: string
  onChange: (v: string) => void
  testId: string
}) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'row', padding: 2, borderRadius: 7, backgroundColor: t.surface, borderWidth: 1, borderColor: t.hairline }}>
      {options.map((o) => (
        <div
          key={o}
          testId={`${testId}-${o.toLowerCase()}`}
          onClick={() => onChange(o)}
          style={{
            display: 'flex',
            paddingLeft: 9,
            paddingRight: 9,
            height: 22,
            alignItems: 'center',
            borderRadius: 5,
            backgroundColor: o === value ? t.raised : undefined,
            cursor: 'pointer',
          }}
        >
          <text style={{ color: o === value ? t.text : t.text3, fontSize: 12, fontWeight: o === value ? 600 : 400 }}>{o}</text>
        </div>
      ))}
    </div>
  )
}

function IconButton({ t, glyph, label, active, onClick, testId }: { t: UiTheme; glyph: string; label: string; active: boolean; onClick: () => void; testId: string }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 26,
        paddingLeft: 8,
        paddingRight: 9,
        borderRadius: 7,
        backgroundColor: active ? alpha(t.blue, 0.16) : hover ? t.surface : undefined,
        cursor: 'pointer',
      }}
    >
      <text style={{ color: active ? t.blue : t.text2, fontSize: 14, fontWeight: 600 }}>{glyph}</text>
      <text style={{ color: active ? t.blue : t.text2, fontSize: 12 }}>{label}</text>
    </div>
  )
}

function TocRow({ t, title, slug, level, active, onClick }: { t: UiTheme; title: string; slug: string; level: number; active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      testId={`toc-${slug}`}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 28,
        paddingLeft: 10 + (level - 1) * 12,
        paddingRight: 8,
        borderRadius: 6,
        backgroundColor: active ? alpha(t.blue, 0.13) : hover ? t.surface : undefined,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <div style={{ width: 2, height: 14, borderRadius: 1, marginRight: 8, backgroundColor: active ? t.blue : '#00000000' }} />
      <text
        style={{
          color: active ? t.blue : level === 1 ? t.text : t.text2,
          fontSize: 13,
          fontWeight: active || level === 1 ? 600 : 400,
          flexShrink: 1,
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </text>
    </div>
  )
}

const BlockView = memo(function BlockView({
  block: b,
  t,
  theme,
  maxW,
  flashN,
  registerRef,
  onToggleTask,
}: {
  block: Block
  t: UiTheme
  theme: GpuixTheme
  maxW: number
  flashN: number
  registerRef: (el: PublicInstance | null) => void
  onToggleTask: (line: number) => void
}) {
  const refCb = useRef(registerRef)
  refCb.current = registerRef
  const ref = useCallback((el: PublicInstance | null) => refCb.current(el), [])
  const gapTop = b.kind === 'heading' ? (b.level === 1 ? 8 : 22) : 0
  return (
    <div
      ref={ref}
      testId={b.kind === 'heading' ? `h-${b.slug}` : undefined}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, paddingTop: gapTop, paddingBottom: 14, position: 'relative', flexShrink: 0 }}
    >
      {flashN > 0 && (
        <motion.div
          key={flashN}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.6, delay: 0.5, ease: 'easeOut' }}
          style={{ position: 'absolute', left: -16, top: gapTop, bottom: 14, width: 3, borderRadius: 2, backgroundColor: t.green, pointerEvents: 'none' }}
        />
      )}
      {b.kind === 'code' ? (
        <CodeCard b={b} t={t} theme={theme} />
      ) : b.kind === 'img' ? (
        <ImageBlock b={b} t={t} maxW={maxW} />
      ) : b.kind === 'tasks' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0 }}>
          {b.tasks!.map((task) => (
            <TaskRow key={task.line} task={task} t={t} theme={theme} onToggle={onToggleTask} />
          ))}
        </div>
      ) : (
        <markdown source={b.src} theme={theme} style={{ width: '100%', minWidth: 0 }} />
      )}
      {b.kind === 'heading' && b.level! <= 2 && (
        <div style={{ height: 1, marginTop: 8, backgroundColor: t.hairline }} />
      )}
    </div>
  )
})

const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function TaskRow({ task, t, theme, onToggle }: { task: Task; t: UiTheme; theme: GpuixTheme; onToggle: (line: number) => void }) {
  const [hover, setHover] = useState(false)
  const slug = task.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 10, width: '100%', minWidth: 0 }}>
      <div
        testId={`task-${slug}`}
        onClick={() => onToggle(task.line)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 17,
          height: 17,
          marginTop: 3,
          flexShrink: 0,
          borderRadius: 5,
          borderWidth: task.checked ? 0 : 1.5,
          borderColor: hover ? t.green : t.text3,
          backgroundColor: task.checked ? t.green : hover ? alpha(t.green, 0.12) : undefined,
          cursor: 'pointer',
        }}
      >
        {task.checked && (
          <svg source={CHECK_SVG} style={{ width: 11, height: 11, color: t.bg }} />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0, opacity: task.checked ? 0.6 : 1 }}>
        <markdown source={task.checked ? `~~${task.text}~~` : task.text} theme={theme} style={{ width: '100%', minWidth: 0 }} />
      </div>
    </div>
  )
}

function CodeCard({ b, t, theme }: { b: Block; t: UiTheme; theme: GpuixTheme }) {
  const lines = b.src.split('\n').length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0, borderRadius: 9, borderWidth: 1, borderColor: t.hairline, backgroundColor: t.surface, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 30, paddingLeft: 14, paddingRight: 12, borderBottomWidth: 1, borderColor: t.hairline, userSelect: 'none' }}>
        <text style={{ color: t.text2, fontSize: 12, fontWeight: 600, fontFamily: 'Menlo' }}>{b.lang ?? 'text'}</text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ color: t.text3, fontSize: 11.5 }}>{`${lines} ${lines === 1 ? 'line' : 'lines'}`}</text>
      </div>
      <code code={b.src} language={b.lang} showLineNumbers={lines > 3} theme={theme} style={{ paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14, minWidth: 0, fontFamily: 'Menlo' }} />
    </div>
  )
}

function ImageBlock({ b, t, maxW }: { b: Block; t: UiTheme; maxW: number }) {
  const size = useMemo(() => (b.path && !/^(https?:|data:)/.test(b.path) ? imageSize(b.path) : null), [b.path])
  if (!size) {
    return (
      <div style={{ display: 'flex', height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: t.hairline }}>
        <text style={{ color: t.text3, fontSize: 13 }}>{`Image not found: ${b.alt || basename(b.path ?? '')}`}</text>
      </div>
    )
  }
  const w = Math.min(size.width, maxW)
  const h = Math.round((w / size.width) * size.height)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <img src={b.path!} style={{ width: w, height: h, borderRadius: 9 }} />
      {b.alt && <text style={{ color: t.text3, fontSize: 12.5 }}>{b.alt}</text>}
    </div>
  )
}

function FindBar({
  t,
  inputRef,
  query,
  setQuery,
  total,
  active,
  onNext,
  onPrev,
  onClose,
  onKey,
}: {
  t: UiTheme
  inputRef: React.RefObject<PublicInstance | null>
  query: string
  setQuery: (q: string) => void
  total: number
  active: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  onKey: (e: KeyEvent) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, top: 0 }}
      animate={{ opacity: 1, top: 12 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      style={{
        position: 'absolute',
        right: 16,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 40,
        width: 340,
        paddingLeft: 12,
        paddingRight: 6,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: t.hairline,
        backgroundColor: t.raised,
        boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: '#00000088' }],
        userSelect: 'none',
      }}
    >
      <text style={{ color: t.text3, fontSize: 14 }}>⌕</text>
      <input
        ref={inputRef}
        testId="find-input"
        autoFocus
        value={query}
        placeholder="Find in document"
        onChange={(e) => setQuery(e.value ?? '')}
        onSubmit={onNext}
        onKeyDown={(e) => {
          const k = (e.key ?? '').toLowerCase()
          if (k === 'escape') {
            e.stopPropagation?.()
            onClose()
          }
          void onKey
        }}
        style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, height: 28, color: t.text, fontSize: 13.5, backgroundColor: '#00000000' }}
      />
      <text testId="find-count" style={{ color: total ? t.text2 : query ? t.red : t.text3, fontSize: 12, flexShrink: 0 }}>
        {query ? (total ? `${active + 1}/${total}` : 'No results') : ''}
      </text>
      <FindBtn t={t} glyph="↑" testId="find-prev" onClick={onPrev} />
      <FindBtn t={t} glyph="↓" testId="find-next" onClick={onNext} />
      <FindBtn t={t} glyph="✕" testId="find-close" onClick={onClose} />
    </motion.div>
  )
}

function FindBtn({ t, glyph, onClick, testId }: { t: UiTheme; glyph: string; onClick: () => void; testId: string }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      testId={testId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: hover ? t.surface : undefined, cursor: 'pointer', flexShrink: 0 }}
    >
      <text style={{ color: t.text2, fontSize: 13 }}>{glyph}</text>
    </div>
  )
}
