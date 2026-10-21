import { Dialog, DialogBackdrop, DialogPopup, DialogPortal, DialogTitle } from '@gpuix/react'
import type { KeyEvent } from '@gpuix/native/host'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { highlightRuns } from './fuzzy'
import { GLYPH, type GlyphName } from './icons'
import { buildClipboard, buildRoot, flatItems, type Item, type Section, type Sources } from './model'
import type { Store } from './store'
import type * as System from './system'

export const WIDTH = 760
export const HEIGHT = 476
const SEARCH_H = 62
const FOOTER_H = 40
const LIST_H = HEIGHT - SEARCH_H - FOOTER_H - 1
const ROW_H = 44
const HEADER_H = 30

export interface Deps {
  apps: System.AppEntry[]
  fileIcons: Sources['fileIcons']
  store: Store
  sys: {
    searchFiles: typeof System.searchFiles
    readClipboard: typeof System.readClipboard
    writeClipboard: typeof System.writeClipboard
    isDarkMode: typeof System.isDarkMode
    openPath: (p: string) => unknown
    revealInFinder: (p: string) => unknown
    openWith: (app: string, p: string) => unknown
    quickLook: (p: string) => unknown
    quitApp: (name: string) => unknown
    commands: {
      toggleDarkMode: () => unknown
      lockScreen: () => unknown
      sleepDisplay: () => unknown
      emptyTrash: () => unknown
      trashCount: () => Promise<number>
    }
  }
  clipboardPollMs?: number
  fileDebounceMs?: number
  initialDark?: boolean
  onClose?: () => void
}

interface Action {
  title: string
  shortcut?: string
  run: () => unknown
  destructive?: boolean
}

interface Theme {
  dark: boolean
  panel: string
  text: string
  sub: string
  faint: string
  divider: string
  selected: string
  accent: string
  card: string
  overlay: string
  overlaySel: string
  kbd: string
}

const DARK: Theme = {
  dark: true, panel: '#1C1C1ED0', text: '#F5F5F7', sub: '#98989F', faint: '#6E6E73', divider: '#FFFFFF14',
  selected: '#FFFFFF17', accent: '#0A84FF', card: '#FFFFFF0D', overlay: '#2A2A2D', overlaySel: '#3A3A3E', kbd: '#FFFFFF1A',
}
const LIGHT: Theme = {
  dark: false, panel: '#F5F5F7D8', text: '#1D1D1F', sub: '#6E6E73', faint: '#8E8E93', divider: '#0000000F',
  selected: '#0000000D', accent: '#0071E3', card: '#00000008', overlay: '#FFFFFF', overlaySel: '#E8E8ED', kbd: '#0000000F',
}

const rel = (at: number) => {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function Glyph({ name, color, size = 16 }: { name: GlyphName; color: string; size?: number }) {
  return <svg source={GLYPH[name]} style={{ width: size, height: size, color }} />
}

function Kbd({ t, children }: { t: Theme; children: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 20, minWidth: 20, paddingLeft: 6, paddingRight: 6, borderRadius: 5, backgroundColor: t.kbd, alignItems: 'center', justifyContent: 'center' }}>
      <text style={{ color: t.sub, fontSize: 11, fontWeight: 600 }}>{children}</text>
    </div>
  )
}

function Highlighted({ text, matches, t, size = 14, weight = 500 }: { text: string; matches: number[]; t: Theme; size?: number; weight?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexShrink: 1, overflow: 'hidden' }}>
      {highlightRuns(text, matches).map((r, i) => (
        <text key={i} style={{ color: r.match ? t.accent : t.text, fontSize: size, fontWeight: r.match ? 700 : weight, whiteSpace: 'nowrap' }}>
          {r.text}
        </text>
      ))}
    </div>
  )
}

function ItemIcon({ item, size = 28 }: { item: Item; size?: number }) {
  if (item.icon) return <img src={item.icon} objectFit="contain" style={{ width: size, height: size }} />
  if (item.glyph)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: size - 4, height: size - 4, margin: 2, borderRadius: 6, backgroundColor: item.tint ?? '#8E8E93', alignItems: 'center', justifyContent: 'center' }}>
        <Glyph name={item.glyph} color="#FFFFFF" size={size - 12} />
      </div>
    )
  return <div style={{ display: 'flex', flexDirection: 'column', width: size, height: size }} />
}

function rowHeight(item: Item) {
  return item.kind === 'calc' ? 104 : item.kind === 'color' ? 136 : ROW_H
}

export function Launcher({ deps }: { deps: Deps }) {
  const { store, sys } = deps
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'root' | 'clipboard'>('root')
  const [selected, setSelected] = useState(0)
  const [files, setFiles] = useState<System.FileHit[]>([])
  const [clipVersion, setClipVersion] = useState(0)
  const [usageVersion, setUsageVersion] = useState(0)
  const [dark, setDark] = useState(deps.initialDark ?? true)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionSel, setActionSel] = useState(0)
  const [confirmTrash, setConfirmTrash] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const scroll = useRef(0)
  const closeArmed = useRef(0)
  const t = dark ? DARK : LIGHT

  const flash = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 1800)
  }, [])

  // Appearance follows the system, so Toggle Dark Mode restyles the launcher too.
  useEffect(() => {
    let alive = true
    const check = () => void sys.isDarkMode().then((d) => alive && setDark(d))
    check()
    const id = setInterval(check, 2500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sys])

  // Clipboard history: poll pbpaste.
  useEffect(() => {
    let alive = true
    const poll = async () => {
      const text = await sys.readClipboard()
      if (alive && store.pushClip(text)) setClipVersion((v) => v + 1)
    }
    void poll()
    const id = setInterval(poll, deps.clipboardPollMs ?? 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sys, store, deps.clipboardPollMs])

  // Debounced Spotlight file search.
  useEffect(() => {
    if (view !== 'root' || query.trim().length < 2) {
      setFiles([])
      return
    }
    let alive = true
    const id = setTimeout(() => {
      void sys.searchFiles(query).then((hits) => alive && setFiles(hits))
    }, deps.fileDebounceMs ?? 140)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, view, sys, deps.fileDebounceMs])

  const sections: Section[] = useMemo(() => {
    if (view === 'clipboard') return buildClipboard(query, store.data.clipboard)
    return buildRoot(query, { apps: deps.apps, files, fileIcons: deps.fileIcons, clips: store.data.clipboard, boost: (id) => store.boost(id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, view, files, clipVersion, usageVersion, deps.apps])
  const items = useMemo(() => flatItems(sections), [sections])
  const sel = Math.min(selected, Math.max(0, items.length - 1))
  const current = items[sel] as Item | undefined

  useEffect(() => {
    setSelected(0)
    setActionsOpen(false)
  }, [query, view])

  const record = (item: Item) => {
    store.recordOpen(item.id)
    setUsageVersion((v) => v + 1)
  }

  const copy = async (text: string, label = 'Copied to Clipboard') => {
    await sys.writeClipboard(text)
    if (store.pushClip(text)) setClipVersion((v) => v + 1)
    flash(label)
  }

  const runCommand = async (item: Item) => {
    record(item)
    switch (item.command) {
      case 'clipboard':
        setQuery('')
        setView('clipboard')
        return
      case 'colors':
        setQuery('#0A84FF')
        return
      case 'darkmode':
        await sys.commands.toggleDarkMode()
        setDark(await sys.isDarkMode())
        flash('Appearance toggled')
        return
      case 'lock':
        await sys.commands.lockScreen()
        return
      case 'sleep':
        await sys.commands.sleepDisplay()
        return
      case 'trash':
        setConfirmTrash(await sys.commands.trashCount())
        return
    }
  }

  const actionsFor = (item: Item | undefined): Action[] => {
    if (!item) return []
    switch (item.kind) {
      case 'app':
        return [
          { title: 'Open Application', shortcut: '↵', run: () => (record(item), sys.openPath(item.path!), flash(`Opened ${item.title}`), setQuery('')) },
          { title: 'Show in Finder', shortcut: '⌘↵', run: () => (record(item), sys.revealInFinder(item.path!), flash('Revealed in Finder'), setQuery('')) },
          { title: 'Copy Path', run: () => copy(item.path!) },
          { title: `Quit ${item.title}`, destructive: true, run: () => (sys.quitApp(item.title), flash(`Asked ${item.title} to quit`)) },
        ]
      case 'file':
        return [
          { title: 'Open', shortcut: '↵', run: () => (record(item), sys.openPath(item.path!), flash(`Opened ${item.title}`), setQuery('')) },
          { title: 'Show in Finder', shortcut: '⌘↵', run: () => (record(item), sys.revealInFinder(item.path!), flash('Revealed in Finder'), setQuery('')) },
          { title: 'Open with TextEdit', run: () => (record(item), sys.openWith('TextEdit', item.path!), flash('Opened in TextEdit'), setQuery('')) },
          { title: 'Quick Look', run: () => sys.quickLook(item.path!) },
          { title: 'Copy Path', run: () => copy(item.path!) },
        ]
      case 'command':
      case 'extension':
        return [{ title: item.kind === 'command' ? 'Run Command' : 'Open Extension', shortcut: '↵', run: () => runCommand(item) }]
      case 'calc':
        return [
          { title: 'Copy Answer', shortcut: '↵', run: () => copy(item.calc!.value.replace(/[^\d.,\-e]/g, '').replace(/,/g, '') || item.calc!.value, `Copied ${item.calc!.value}`) },
          { title: 'Copy Answer with Unit', run: () => copy(item.calc!.value, `Copied ${item.calc!.value}`) },
          { title: 'Copy Equation', run: () => copy(`${item.calc!.expression} = ${item.calc!.value}`) },
        ]
      case 'color':
        return [
          { title: 'Copy HEX', shortcut: '↵', run: () => copy(item.color!.hex, `Copied ${item.color!.hex}`) },
          { title: 'Copy RGB', run: () => copy(item.color!.rgbText, `Copied ${item.color!.rgbText}`) },
          { title: 'Copy HSL', run: () => copy(item.color!.hsl, `Copied ${item.color!.hsl}`) },
          { title: 'Copy OKLCH', run: () => copy(item.color!.oklch, 'Copied OKLCH') },
        ]
      case 'clip':
        return [
          { title: 'Copy to Clipboard', shortcut: '↵', run: () => copy(item.clip!.text) },
          { title: 'Delete Entry', destructive: true, run: () => (store.removeClip(item.clip!.text), setClipVersion((v) => v + 1), flash('Entry deleted')) },
          { title: 'Clear History', destructive: true, run: () => (store.clearClips(), setClipVersion((v) => v + 1), flash('History cleared')) },
        ]
    }
  }

  const actions = actionsFor(current)

  const runAction = (a: Action | undefined) => {
    setActionsOpen(false)
    if (a) void a.run()
  }

  // Enter arrives as a raw keydown in the live window and as the input's submit action in
  // the test renderer; both route here, deduped so one press never runs twice.
  const lastSubmit = useRef(0)
  const submit = (cmd: boolean) => {
    const now = performance.now()
    if (now - lastSubmit.current < 60) return
    lastSubmit.current = now
    if (cmd && current?.path) runAction(actions.find((a) => a.shortcut === '⌘↵'))
    else runAction(actions[0])
  }

  const onKeyDown = (e: KeyEvent) => {
    if (confirmTrash !== null) return
    const key = e.key
    const cmd = !!e.modifiers?.cmd
    if (actionsOpen) {
      if (key === 'down' || key === 'up') {
        e.preventDefault()
        setActionSel((s) => (s + (key === 'down' ? 1 : actions.length - 1)) % Math.max(1, actions.length))
      } else if (key === 'enter') {
        e.preventDefault()
        runAction(actions[actionSel])
      } else if (key === 'escape' || key === 'tab' || (cmd && key === 'k')) {
        e.preventDefault()
        setActionsOpen(false)
      }
      return
    }
    if (key === 'down' || key === 'up') {
      e.preventDefault()
      if (items.length) setSelected((s) => (Math.min(s, items.length - 1) + (key === 'down' ? 1 : items.length - 1)) % items.length)
    } else if (key === 'enter') {
      e.preventDefault()
      submit(cmd)
    } else if (key === 'tab' || (cmd && key === 'k')) {
      e.preventDefault()
      if (actions.length) {
        setActionSel(0)
        setActionsOpen(true)
      }
    } else if (key === 'escape') {
      e.preventDefault()
      if (query) setQuery('')
      else if (view !== 'root') setView('root')
      else if (closeArmed.current && Date.now() - closeArmed.current < 1600) deps.onClose?.()
      else {
        closeArmed.current = Date.now()
        flash('Press Esc again to close')
      }
    }
  }

  // Keep the selection inside the clipped list viewport.
  const rows: { key: string; h: number; node: ReactNode; idx?: number }[] = []
  let idx = 0
  for (const s of sections) {
    if (!s.items.length) continue
    rows.push({ key: `h:${s.title}`, h: HEADER_H, node: <SectionHeader title={s.title} t={t} /> })
    for (const item of s.items) rows.push({ key: item.id, h: rowHeight(item), idx: idx++, node: null })
  }
  let y = 0
  let selTop = 0
  let selBottom = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    if (row.idx === sel) {
      selTop = rows[r - 1]?.idx === undefined ? y - (rows[r - 1]?.h ?? 0) : y
      selBottom = y + row.h
    }
    y += row.h
  }
  const viewH = view === 'clipboard' ? LIST_H : LIST_H
  if (selTop < scroll.current) scroll.current = Math.max(0, selTop)
  if (selBottom > scroll.current + viewH - 6) scroll.current = selBottom - viewH + 6
  scroll.current = Math.max(0, Math.min(scroll.current, Math.max(0, y - viewH + 6)))

  const renderItem = (item: Item, i: number, compact = false) => {
    const on = i === sel
    const click = () => (setSelected(i), setActionsOpen(false), on && runAction(actionsFor(item)[0]))
    if (item.kind === 'calc') return <CalcCard key={item.id} item={item} on={on} t={t} onClick={click} />
    if (item.kind === 'color') return <ColorCard key={item.id} item={item} on={on} t={t} onClick={click} />
    return (
      <div
        key={item.id}
        testId={`row-${i}`}
        onClick={click}
        style={{ display: 'flex', height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 10, paddingRight: 12, marginLeft: 8, marginRight: 8, borderRadius: 9, backgroundColor: on ? t.selected : 'transparent' }}
      >
        <ItemIcon item={item} size={compact ? 22 : 28} />
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}>
          <Highlighted text={item.title} matches={item.matches} t={t} size={compact ? 13 : 14} />
          {item.subtitle && !compact ? <text style={{ color: t.faint, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 1 }}>{item.subtitle}</text> : null}
        </div>
        {compact && item.clip ? <text style={{ color: t.faint, fontSize: 11 }}>{rel(item.clip.at)}</text> : null}
        {item.accessory ? <text style={{ color: t.faint, fontSize: 12 }}>{item.accessory}</text> : null}
      </div>
    )
  }

  let n = 0
  const list = (
    <div style={{ display: 'flex', flexDirection: 'column', height: viewH, overflow: 'hidden', flexGrow: view === 'clipboard' ? 0 : 1, width: view === 'clipboard' ? 300 : undefined }}>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: -scroll.current, paddingTop: 4 }}>
        {sections.map((s) =>
          s.items.length ? (
            <div key={s.title} style={{ display: 'flex', flexDirection: 'column' }}>
              <SectionHeader title={s.title} t={t} />
              {s.items.map((item) => renderItem(item, n++, view === 'clipboard'))}
            </div>
          ) : null,
        )}
        {!items.length ? <EmptyState t={t} view={view} query={query} /> : null}
      </div>
    </div>
  )

  return (
    <div
      testId="launcher"
      onKeyDown={onKeyDown}
      style={{ display: 'flex', width: '100%', height: '100%', flexDirection: 'column', backgroundColor: t.panel, borderRadius: 12, borderWidth: 1, borderColor: t.dark ? '#FFFFFF1F' : '#0000001A', overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', height: SEARCH_H, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 20, paddingRight: 18 }}>
        {view === 'clipboard' ? (
          <div onClick={() => setView('root')} style={{ display: 'flex', width: 26, height: 26, borderRadius: 7, backgroundColor: t.kbd, alignItems: 'center', justifyContent: 'center' }}>
            <Glyph name="back" color={t.sub} size={14} />
          </div>
        ) : (
          <Glyph name="search" color={t.sub} size={20} />
        )}
        <input
          testId="search"
          autoFocus
          value={query}
          placeholder={view === 'clipboard' ? 'Search clipboard history…' : 'Search apps, files, commands, or type math…'}
          onChange={(e) => setQuery(e.value ?? '')}
          onSubmit={(e) => {
            if (confirmTrash !== null) return
            if (actionsOpen) runAction(actions[actionSel])
            else submit(!!e.modifiers?.cmd)
          }}
          style={{ flexGrow: 1, minWidth: 0, height: 36, fontSize: 21, color: t.text }}
        />
        {view === 'clipboard' ? (
          <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 8, paddingRight: 8, height: 22, borderRadius: 6, backgroundColor: '#34C75926', justifyContent: 'center' }}>
            <text style={{ color: '#34C759', fontSize: 12, fontWeight: 600 }}>Clipboard History</text>
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', height: 1, backgroundColor: t.divider }} />
      <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1 }}>
        {list}
        {view === 'clipboard' ? <ClipPreview item={current} t={t} /> : null}
      </div>
      <Footer t={t} toast={toast} current={current} primary={actions[0]?.title} onActions={() => actions.length && (setActionSel(0), setActionsOpen((o) => !o))} />
      {actionsOpen ? <ActionPanel t={t} actions={actions} sel={actionSel} title={current?.title ?? ''} onPick={(i) => runAction(actions[i])} /> : null}
      <Dialog open={confirmTrash !== null} onOpenChange={(o) => !o && setConfirmTrash(null)}>
        <DialogPortal>
          <DialogBackdrop style={{ backgroundColor: '#00000066' }} />
          <DialogPopup
            testId="trash-dialog"
            onKeyDown={(e) => {
              if (e.key === 'enter') {
                e.preventDefault()
                void sys.commands.emptyTrash()
                setConfirmTrash(null)
                flash('Trash emptied')
              }
            }}
            style={{ display: 'flex', width: 340, padding: 22, borderRadius: 14, backgroundColor: t.overlay, borderWidth: 1, borderColor: t.divider, flexDirection: 'column', alignItems: 'center', gap: 10 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', width: 44, height: 44, borderRadius: 11, backgroundColor: '#FF453A', alignItems: 'center', justifyContent: 'center' }}>
              <Glyph name="trash" color="#FFFFFF" size={24} />
            </div>
            <DialogTitle style={{ color: t.text, fontSize: 15, fontWeight: 700 }}>Empty Trash?</DialogTitle>
            <text style={{ color: t.sub, fontSize: 13, textAlign: 'center' }}>
              {confirmTrash === 0 ? 'The Trash is already empty.' : `${confirmTrash} item${confirmTrash === 1 ? '' : 's'} will be permanently erased. You can’t undo this.`}
            </text>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 10, marginTop: 8, width: '100%' }}>
              <DialogButton t={t} testId="trash-cancel" label="Cancel" hint="esc" onClick={() => setConfirmTrash(null)} />
              <DialogButton t={t} testId="trash-confirm" label="Empty Trash" hint="↵" danger onClick={() => (void sys.commands.emptyTrash(), setConfirmTrash(null), flash('Trash emptied'))} />
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </div>
  )
}

function DialogButton({ t, label, hint, danger, onClick, testId }: { t: Theme; label: string; hint: string; danger?: boolean; onClick: () => void; testId: string }) {
  return (
    <div testId={testId} onClick={onClick} style={{ display: 'flex', flexGrow: 1, flexBasis: 0, height: 32, borderRadius: 8, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? '#FF453A' : t.kbd }}>
      <text style={{ color: danger ? '#FFFFFF' : t.text, fontSize: 13, fontWeight: 600 }}>{label}</text>
      <text style={{ color: danger ? '#FFFFFFB3' : t.faint, fontSize: 11 }}>{hint}</text>
    </div>
  )
}

function SectionHeader({ title, t }: { title: string; t: Theme }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: HEADER_H, justifyContent: 'flex-end', paddingLeft: 20, paddingBottom: 6 }}>
      <text style={{ color: t.faint, fontSize: 12, fontWeight: 600 }}>{title}</text>
    </div>
  )
}

function EmptyState({ t, view, query }: { t: Theme; view: string; query: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 220, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <text style={{ color: t.sub, fontSize: 14, fontWeight: 600 }}>{view === 'clipboard' && !query ? 'Nothing copied yet' : 'No Results'}</text>
      <text style={{ color: t.faint, fontSize: 12 }}>{view === 'clipboard' ? 'Copy something and it shows up here' : `Nothing matches “${query}”`}</text>
    </div>
  )
}

function CalcCard({ item, on, t, onClick }: { item: Item; on: boolean; t: Theme; onClick: () => void }) {
  const c = item.calc!
  const pane = (big: string, small: string, testId: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <text testId={testId} style={{ color: t.text, fontSize: 26, fontWeight: 600 }}>{big}</text>
      <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 8, paddingRight: 8, height: 20, borderRadius: 5, backgroundColor: t.kbd, justifyContent: 'center' }}>
        <text style={{ color: t.sub, fontSize: 11 }}>{small}</text>
      </div>
    </div>
  )
  return (
    <div testId="calc-card" onClick={onClick} style={{ display: 'flex', height: 96, marginLeft: 8, marginRight: 8, marginBottom: 8, borderRadius: 11, flexDirection: 'row', alignItems: 'center', backgroundColor: on ? t.selected : t.card, borderWidth: 1, borderColor: on ? t.accent : 'transparent' }}>
      {pane(c.expression, c.caption.startsWith('Static') ? 'Expression' : c.caption, 'calc-expression')}
      <Glyph name="arrow" color={t.faint} size={18} />
      {pane(c.value, c.caption.startsWith('Static') ? c.caption : 'Result', 'calc-value')}
    </div>
  )
}

function ColorCard({ item, on, t, onClick }: { item: Item; on: boolean; t: Theme; onClick: () => void }) {
  const c = item.color!
  const row = (k: string, v: string) => (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
      <text style={{ color: t.faint, fontSize: 12, width: 46 }}>{k}</text>
      <text style={{ color: t.text, fontSize: 12, fontWeight: 500 }}>{v}</text>
    </div>
  )
  return (
    <div testId="color-card" onClick={onClick} style={{ display: 'flex', height: 128, marginLeft: 8, marginRight: 8, marginBottom: 8, padding: 12, gap: 16, borderRadius: 11, flexDirection: 'row', backgroundColor: on ? t.selected : t.card, borderWidth: 1, borderColor: on ? t.accent : 'transparent' }}>
      <div style={{ display: 'flex', flexDirection: 'column', width: 104, height: 104, borderRadius: 10, backgroundColor: c.hex, borderWidth: 1, borderColor: t.divider }} />
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: 5, justifyContent: 'center' }}>
        <text testId="color-hex" style={{ color: t.text, fontSize: 18, fontWeight: 700 }}>{c.hex}</text>
        {row('RGB', c.rgbText)}
        {row('HSL', c.hsl)}
        {row('OKLCH', c.oklch)}
        <div style={{ display: 'flex', flexDirection: 'row', gap: 3, marginTop: 4 }}>
          {c.shades.map((s) => (
            <div key={s} style={{ display: 'flex', flexDirection: 'column', width: 28, height: 12, borderRadius: 3, backgroundColor: s }} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ClipPreview({ item, t }: { item: Item | undefined; t: Theme }) {
  const c = item?.clip
  return (
    <div style={{ display: 'flex', flexGrow: 1, flexDirection: 'column', borderLeftWidth: 1, borderColor: t.divider }}>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 18, overflow: 'hidden' }}>
        <text testId="clip-preview" style={{ color: t.text, fontSize: 13, lineHeight: 19 }}>{c ? c.text.slice(0, 1200) : ''}</text>
      </div>
      {c ? (
        <div style={{ display: 'flex', flexDirection: 'column', borderTopWidth: 1, borderColor: t.divider, padding: 14, paddingLeft: 18, gap: 6 }}>
          {[
            ['Copied', rel(c.at)],
            ['Characters', String(c.text.length)],
            ['Words', String(c.text.trim().split(/\s+/).length)],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
              <text style={{ color: t.faint, fontSize: 12 }}>{k}</text>
              <text style={{ color: t.sub, fontSize: 12 }}>{v}</text>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Footer({ t, toast, current, primary, onActions }: { t: Theme; toast: string | null; current: Item | undefined; primary?: string; onActions: () => void }) {
  return (
    <div style={{ display: 'flex', height: FOOTER_H, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 12, gap: 10, borderTopWidth: 1, borderColor: t.divider, backgroundColor: t.dark ? '#00000014' : '#FFFFFF40' }}>
      {toast ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759' }} />
          <text testId="toast" style={{ color: t.text, fontSize: 12, fontWeight: 600 }}>{toast}</text>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1 }}>
          <Glyph name="search" color={t.faint} size={13} />
          <text style={{ color: t.faint, fontSize: 12 }}>{current ? current.accessory ?? (current.kind === 'clip' ? 'Clipboard' : 'Result') : 'Spotlight'}</text>
        </div>
      )}
      {primary ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <text style={{ color: t.text, fontSize: 12, fontWeight: 600 }}>{primary}</text>
          <Kbd t={t}>↵</Kbd>
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', width: 1, height: 14, backgroundColor: t.divider }} />
      <div testId="actions-button" onClick={onActions} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <text style={{ color: t.sub, fontSize: 12 }}>Actions</text>
        <Kbd t={t}>⌘</Kbd>
        <Kbd t={t}>K</Kbd>
      </div>
    </div>
  )
}

function ActionPanel({ t, actions, sel, title, onPick }: { t: Theme; actions: Action[]; sel: number; title: string; onPick: (i: number) => void }) {
  return (
    <div
      testId="action-panel"
      style={{ display: 'flex', position: 'absolute', right: 12, bottom: FOOTER_H + 6, width: 300, padding: 6, borderRadius: 12, backgroundColor: t.overlay, borderWidth: 1, borderColor: t.dark ? '#FFFFFF1F' : '#0000001F', flexDirection: 'column', pointerEvents: 'auto', boxShadow: [{ offsetX: 0, offsetY: 10, blurRadius: 30, spreadRadius: 0, color: '#00000066' }] }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: 26, justifyContent: 'center', paddingLeft: 10 }}>
        <text style={{ color: t.faint, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{title.length > 36 ? `${title.slice(0, 35)}…` : title}</text>
      </div>
      {actions.map((a, i) => (
        <div
          key={a.title}
          testId={`action-${i}`}
          onClick={() => onPick(i)}
          style={{ display: 'flex', height: 32, flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 8, borderRadius: 7, backgroundColor: i === sel ? t.overlaySel : t.overlay }}
        >
          <text style={{ color: a.destructive ? '#FF453A' : t.text, fontSize: 13, flexGrow: 1 }}>{a.title}</text>
          {a.shortcut ? <Kbd t={t}>{a.shortcut}</Kbd> : null}
        </div>
      ))}
    </div>
  )
}
