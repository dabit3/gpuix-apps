/** @jsxImportSource #zoom */
import React, { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { readFileSync } from 'fs'
import {
  Button,
  isTerminal,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  useGpuix,
  useWindowSize,
  type KeyEvent,
  type NativeRenderer,
  type PublicInstance,
} from '@gpuix/react'
import {
  buildFollowUp,
  buildRun,
  initialSessions,
  MODES,
  REPOS,
  STATUS_LABEL,
  titleFromPrompt,
  slugify,
  type AgentMode,
  type Check,
  type PlanItem,
  type RunAction,
  type Session,
  type Step,
  type TranscriptEvent,
} from './data'
import { byRecent, filterSessions, formatDuration, reducer, type PanelTab, type State } from './state'
import { Icon, type IconName } from './icons'
import { C, nativeTheme, setTheme, type ThemeName } from './theme'
import type { DevinApi } from './api'
import { eventsFromMessages, sessionFromApi, statusLine } from './live'
import type { ApiPlaybook, ApiSession } from './api'
import { AutomationsView, copyText, CustomizeView, notificationsFor, NotificationsView, ReviewView, SecurityView, SettingsView, useSticky, type View } from './views'
import { clearQuarantine, originalPath, previewPath, shotsFrom, type PreviewDeps, type Shot } from './computer'
import { loadPrefs, savePrefs, type Prefs } from './prefs'
import { getZoom, setZoom, stepZoom } from './zoom/scale'
import { applyFontChange, cellSize, readTerminalGrid, TerminalFontTracker } from './zoom/terminal-font'
import { EnvironmentView, PrReview, ReposView, SessionExtras, SessionsView, UsageView, type SessionsFilter } from './more'
import { ActionMenu, Avatar, Badge, Btn, CLEAR, col, Empty, EmptyState, Field, IconButton, Kbd, menuItemStyle, menuStyle, MONO, openUrl, popoverShadow, raisedShadow, row, SANS, Segmented, StatusDot, StatusPill, Tip, WEB, type MenuAction } from './ui'

export { C }
export { setUrlOpener } from './ui'

const SIDEBAR_WIDTH = 280
const SIDEBAR_COMPACT = 232
const PANEL_WIDTH = 400
const TRAFFIC_LIGHT_HEIGHT = 40
const NO_REPO = 'No repository'
const MAX_PAGES = 20
const PLACEHOLDER = 'Ask Devin to build features, fix bugs, or work on your code'

/** Window-level key handler; `app.tsx` forwards `render({ onKeyDown })` here. */
let windowKeyHandler: ((event: KeyEvent, renderer: NativeRenderer) => void) | null = null
export function handleWindowKey(event: KeyEvent, renderer: NativeRenderer) {
  windowKeyHandler?.(event, renderer)
}

/* ───────────────────────────── Sidebar ───────────────────────────── */

type TreeRow = { session: Session; depth: number; hasChildren: boolean; open: boolean; kids: number }
type ListItem = { kind: 'group'; label: string; first: boolean } | { kind: 'row'; row: TreeRow }

function buildTree(visible: Session[], expanded: Record<string, boolean>, searching: boolean): TreeRow[] {
  const ids = new Set(visible.map((s) => s.id))
  const kids = new Map<string, Session[]>()
  const top: Session[] = []
  for (const s of visible) {
    const p = s.live?.parentId
    if (p && ids.has(p) && !searching) kids.set(p, [...(kids.get(p) ?? []), s])
    else top.push(s)
  }
  const out: TreeRow[] = []
  const walk = (s: Session, depth: number) => {
    const children = kids.get(s.id) ?? []
    const open = expanded[s.id] ?? false
    out.push({ session: s, depth, hasChildren: children.length > 0, open, kids: children.length })
    if (open && depth < 3) for (const c of children) walk(c, depth + 1)
  }
  for (const s of top) walk(s, 0)
  return out
}

function withGroups(rows: TreeRow[]): ListItem[] {
  const out: ListItem[] = []
  let group: string | null = null
  for (const r of rows) {
    if (r.depth === 0 && r.session.group !== group) {
      out.push({ kind: 'group', label: r.session.group, first: group === null })
      group = r.session.group
    }
    out.push({ kind: 'row', row: r })
  }
  return out
}

function prCount(s: Session): number {
  return s.live ? s.live.prs.length : s.events.filter((e) => e.kind === 'pr').length
}

const META = { fontFamily: SANS, fontSize: 12, lineHeight: 16, whiteSpace: 'nowrap' } as const

const SessionRow = memo(function SessionRow({
  item,
  selected,
  onSelect,
  onToggle,
}: {
  item: TreeRow
  selected: boolean
  onSelect: (id: string) => void
  onToggle: (id: string, open: boolean) => void
}) {
  const s = item.session
  const prs = prCount(s)
  const blocked = s.status === 'blocked'
  const failed = s.status === 'failed'
  const idle = s.status === 'finished' || s.status === 'sleeping'
  const indent = item.depth * 16
  return (
    <div style={{ width: '100%', paddingLeft: 8, paddingRight: 8 }}>
      <div
        style={{
          ...row({ alignItems: 'flex-start' }),
          position: 'relative',
          width: '100%',
          paddingRight: 6,
          borderRadius: 8,
          backgroundColor: selected ? C.selected : CLEAR,
          hover: { backgroundColor: selected ? C.selected : C.hover },
        }}
      >
        {item.depth > 0 && <div style={{ position: 'absolute', left: indent - 3, top: 0, bottom: 0, width: 1, backgroundColor: C.borderStrong, pointerEvents: 'none' }} />}
        <div
          testId={`session-${s.id}`}
          onClick={() => onSelect(s.id)}
          style={{ ...row({ alignItems: 'flex-start', gap: 8 }), flexGrow: 1, minWidth: 0, paddingLeft: 8 + indent, paddingTop: 7, paddingBottom: 7, cursor: 'pointer' }}
        >
          <div style={{ ...row({ justifyContent: 'center' }), width: 10, height: 18, flexShrink: 0, pointerEvents: 'none' }}>
            <StatusDot status={s.status} size={7} color={idle ? C.borderStrong : undefined} />
          </div>
          <div style={col({ flexGrow: 1, minWidth: 0, gap: 1, pointerEvents: 'none' })}>
            <text style={{ fontFamily: SANS, color: C.text, fontSize: 13.5, lineHeight: 18, fontWeight: selected ? 500 : 400, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{s.title}</text>
            <div style={row({ gap: 5, minWidth: 0 })}>
              {blocked ? (
                <text style={{ ...META, color: C.orange, textOverflow: 'ellipsis' }}>{s.live ? 'Waiting for you' : STATUS_LABEL.blocked}</text>
              ) : failed ? (
                <text style={{ ...META, color: C.del }}>{`Failed · ${s.updated}`}</text>
              ) : (
                <text style={{ ...META, color: C.ghost }}>{s.updated}</text>
              )}
              {prs > 0 && <text style={{ ...META, color: C.ghost }}>·</text>}
              {prs > 0 && <Icon name="pr" size={11} color={C.ghost} />}
              {prs > 0 && <text style={{ ...META, color: C.tertiary }}>{String(prs)}</text>}
            </div>
          </div>
        </div>
        {item.hasChildren && (
          <div
            testId={`expand-${s.id}`}
            onClick={() => onToggle(s.id, !item.open)}
            style={{ ...row({ gap: 2, justifyContent: 'center' }), marginTop: 7, height: 20, paddingLeft: 6, paddingRight: 3, borderRadius: 6, flexShrink: 0, cursor: 'pointer', backgroundColor: item.open ? C.selected : CLEAR, hover: { backgroundColor: C.selected } }}
          >
            <text style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 500, color: C.tertiary, pointerEvents: 'none' }}>{String(item.kids)}</text>
            <Icon name={item.open ? 'chevronDown' : 'chevronRight'} size={12} color={C.tertiary} />
          </div>
        )}
      </div>
    </div>
  )
})

function NavRow({ icon, label, hint, chevron, onClick, testId, active }: { icon: IconName; label: string; hint?: string; chevron?: boolean; onClick?: () => void; testId?: string; active?: boolean }) {
  return (
    <Button
      testId={testId}
      onClick={onClick}
      style={{ ...row({ gap: 10 }), height: 32, paddingLeft: 10, paddingRight: 8, marginLeft: 8, marginRight: 8, borderRadius: 8, cursor: 'pointer', backgroundColor: active ? C.selected : CLEAR, hover: { backgroundColor: active ? C.selected : C.hover }, active: { backgroundColor: C.selected } }}
    >
      <Icon name={icon} size={16} color={active ? C.text : C.tertiary} />
      <text style={{ fontFamily: SANS, color: C.text, fontSize: 13.5, fontWeight: active ? 500 : 400, flexGrow: 1, pointerEvents: 'none' }}>{label}</text>
      {hint && <Kbd keys={hint} subtle />}
      {chevron && <Icon name="chevronRight" size={13} color={C.ghost} />}
    </Button>
  )
}

function Sidebar({
  state,
  visible,
  onSelect,
  onNew,
  onSearch,
  searchRef,
  width = SIDEBAR_WIDTH,
  themeName,
  onToggleTheme,
  live,
  liveError,
  limit,
  onLoadMore,
  userName,
  view,
  onNav,
  notifCount,
  onHideSidebar,
  onShortcuts,
  onApiSettings,
}: {
  width?: number
  state: State
  visible: Session[]
  onSelect: (id: string) => void
  onNew: () => void
  onSearch: (value: string) => void
  searchRef: React.RefObject<PublicInstance | null>
  themeName: ThemeName
  onToggleTheme: () => void
  live: boolean
  liveError: string | null
  limit: number
  onLoadMore: () => void
  userName: string
  view: View
  onNav: (v: View, tab?: string) => void
  notifCount: number
  onHideSidebar: () => void
  onShortcuts: () => void
  onApiSettings: () => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const searching = state.search.trim().length > 0
  const allRows = useMemo(() => buildTree(visible, expanded, searching), [visible, expanded, searching])
  const rows = useMemo(() => {
    if (searching || !live) return allRows
    let top = 0
    const out: TreeRow[] = []
    for (const r of allRows) {
      if (r.depth === 0 && ++top > limit) break
      out.push(r)
    }
    return out
  }, [allRows, searching, live, limit])
  const items = useMemo(() => withGroups(rows), [rows])
  const hasMore = live && !searching && allRows.filter((r) => r.depth === 0).length > limit
  const onToggle = useCallback((id: string, open: boolean) => setExpanded((e) => ({ ...e, [id]: open })), [])
  const running = state.sessions.filter((s) => s.status === 'running').length
  const macWindow = process.platform === 'darwin' && !isTerminal()
  const { renderer } = useGpuix()
  const narrow = width < SIDEBAR_WIDTH
  const [searchFocused, setSearchFocused] = useState(false)
  const source = live ? (liveError ? 'Couldn’t reach api.devin.ai' : 'Live · api.devin.ai') : 'Demo data'

  return (
    <div style={{ ...col(), width, height: '100%', flexShrink: 0, backgroundColor: C.sidebar, borderRightWidth: 1, borderColor: C.border }}>
      {macWindow && <div style={{ height: TRAFFIC_LIGHT_HEIGHT - 12, flexShrink: 0 }} />}
      <div style={row({ gap: 4, paddingLeft: 8, paddingRight: 8, height: 52, flexShrink: 0 })}>
        <ActionMenu
          testId="workspace"
          triggerStyle={{ justifyContent: 'flex-start', gap: 9, height: 34, paddingLeft: 6, paddingRight: 8, flexShrink: 1, minWidth: 0 }}
          items={[
            { id: 'h', label: source, header: true },
            { id: 'settings', label: 'Settings', icon: 'settings', run: () => onNav('settings') },
            { id: 'api', label: 'Devin API', icon: 'key', run: onApiSettings },
            { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'list', run: onShortcuts },
            { id: 'theme', label: themeName === 'dark' ? 'Light mode' : 'Dark mode', icon: themeName === 'dark' ? 'sun' : 'moon', hint: '⇧⌘L', run: onToggleTheme },
            { id: 'web', label: 'Open app.devin.ai', icon: 'external', run: () => openUrl(WEB) },
          ]}
        >
          <Avatar name={userName} size={24} />
          <text style={{ fontFamily: SANS, color: C.text, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>{userName}</text>
          <Icon name="updown" size={13} color={C.ghost} />
        </ActionMenu>
        <div style={{ flexGrow: 1 }} />
        <IconButton icon="search" size={15} box={28} testId="search-button" tip="Search" kbd="⌘K" onClick={() => searchRef.current && renderer?.focusElement?.(searchRef.current.id)} />
        {!narrow && <IconButton icon="bell" size={15} box={28} testId="bell" tip="Notifications" dot={notifCount > 0} active={view === 'notifications'} onClick={() => onNav('notifications')} />}
        {!narrow && <IconButton icon="panelLeft" size={15} box={28} testId="hide-sidebar" tip="Hide sidebar" kbd="⌘B" onClick={onHideSidebar} />}
      </div>
      <div style={{ ...col({ gap: 1 }), flexShrink: 0 }}>
        <NavRow icon="compose" label="New session" hint={narrow ? undefined : '⇧⌘O'} onClick={onNew} testId="new-session" active={state.selectedId === null && view === 'home'} />
        <NavRow icon="clock" label="Automations" testId="nav-automations" onClick={() => onNav('automations')} active={view === 'automations'} />
        <NavRow icon="shield" label="Security" testId="nav-security" onClick={() => onNav('security')} active={view === 'security'} />
        <NavRow icon="pr" label="Review" testId="nav-review" onClick={() => onNav('review')} active={view === 'review'} />
        <NavRow icon="shapes" label="Customize" testId="nav-customize" onClick={() => onNav('customize')} active={view === 'customize'} />
        <ActionMenu
          testId="nav-more"
          side="right"
          triggerStyle={{ justifyContent: 'flex-start', gap: 10, width: width - 16, height: 32, paddingLeft: 10, paddingRight: 8, marginLeft: 8, borderRadius: 8 }}
          items={[
            { id: 'h-w', label: 'Workspace', header: true },
            { id: 'sessions', label: 'All sessions', icon: 'list', run: () => onNav('sessions') },
            { id: 'usage', label: 'Usage', icon: 'zap', run: () => onNav('usage') },
            { id: 'repos', label: 'Repositories', icon: 'folder', run: () => onNav('repos') },
            { id: 'environment', label: 'Environment', icon: 'laptop', run: () => onNav('environment') },
            { id: 'h-web', label: 'On the web', header: true },
            { id: 'wiki', label: 'DeepWiki', icon: 'library', run: () => openUrl(`${WEB}/wiki`) },
            { id: 'oncall', label: 'Oncall', icon: 'bell', run: () => openUrl(`${WEB}/oncall`) },
            { id: 'web', label: 'Open app.devin.ai', icon: 'external', run: () => openUrl(WEB) },
            { id: 'docs', label: 'Documentation', icon: 'book', run: () => openUrl('https://docs.devin.ai') },
          ]}
        >
          <Icon name="more" size={16} color={C.tertiary} />
          <text style={{ fontFamily: SANS, color: C.text, fontSize: 13.5, flexGrow: 1 }}>More</text>
          <Icon name="chevronRight" size={13} color={C.ghost} />
        </ActionMenu>
      </div>
      <div style={row({ paddingLeft: 18, paddingRight: 10, marginTop: 18, height: 28, flexShrink: 0, gap: 2 })}>
        <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5, fontWeight: 600, flexGrow: 1 }}>Sessions</text>
        {!narrow && <IconButton icon="listFilter" size={14} box={26} tip="All sessions" onClick={() => onNav('sessions', 'all')} testId="sessions-filter-open" />}
        {!narrow && (
          <ActionMenu
            testId="sessions-menu"
            items={[
              { id: 'collapse', label: 'Collapse all', icon: 'chevronRight', run: () => setExpanded({}) },
              { id: 'expand', label: 'Expand all', icon: 'chevronDown', run: () => setExpanded(Object.fromEntries(state.sessions.filter((x) => x.live?.childIds.length).map((x) => [x.id, true]))) },
              { id: 'h-v', label: 'View', header: true },
              { id: 'all', label: 'All sessions', icon: 'list', run: () => onNav('sessions', 'all') },
              { id: 'archived', label: 'Archived sessions', icon: 'archive', run: () => onNav('sessions', 'archived') },
              { id: 'notifications', label: 'Notifications', icon: 'bell', run: () => onNav('notifications') },
              { id: 'web', label: 'Open sessions on web', icon: 'external', run: () => openUrl(WEB) },
            ]}
          >
            <Icon name="more" size={14} color={C.tertiary} />
          </ActionMenu>
        )}
      </div>
      <div style={{ ...row({ gap: 8 }), marginLeft: 8, marginRight: 8, marginTop: 4, marginBottom: 4, height: 32, paddingLeft: 10, paddingRight: 6, borderRadius: 8, borderWidth: 1, borderColor: searchFocused ? C.focus : C.border, backgroundColor: C.input, flexShrink: 0, hover: { borderColor: searchFocused ? C.focus : C.borderStrong } }}>
        <Icon name="search" size={13} color={C.ghost} />
        <input
          ref={searchRef}
          testId="search"
          value={state.search}
          placeholder="Search sessions"
          onChange={(e) => onSearch(e.value ?? '')}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          style={{ flexGrow: 1, minWidth: 0, height: 28, fontSize: 13, color: C.text, backgroundColor: C.input, fontFamily: SANS }}
          theme={{ caret: C.text, textMuted: C.ghost }}
        />
        {searching ? (
          <div onClick={() => onSearch('')} style={{ ...row({ justifyContent: 'center' }), width: 20, height: 20, borderRadius: 6, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
            <Icon name="x" size={12} color={C.tertiary} />
          </div>
        ) : (
          <Kbd keys="⌘K" subtle />
        )}
      </div>
      <virtual-list testId="session-list" estimatedItemHeight={48} overdraw={400} style={{ flexGrow: 1, minHeight: 0, paddingBottom: 8 }}>
        {[
          ...(rows.length === 0
            ? [
                <div key="empty" style={{ ...col({ alignItems: 'center', gap: 6 }), paddingTop: 28, paddingLeft: 20, paddingRight: 20 }}>
                  <Icon name={searching ? 'search' : live && liveError ? 'circleAlert' : 'list'} size={16} color={C.ghost} />
                  <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5, textAlign: 'center' }}>
                    {searching ? `No sessions match “${state.search}”` : live ? (liveError ? 'Couldn’t reach the Devin API' : 'Loading sessions…') : 'No sessions yet'}
                  </text>
                </div>,
              ]
            : items.map((it) =>
                it.kind === 'group' ? (
                  <div key={`g-${it.label}`} style={{ ...row(), height: it.first ? 26 : 34, paddingLeft: 18, paddingTop: it.first ? 2 : 10 }}>
                    <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 11.5, fontWeight: 500 }}>{it.label}</text>
                  </div>
                ) : (
                  <SessionRow key={it.row.session.id} item={it.row} selected={it.row.session.id === state.selectedId} onSelect={onSelect} onToggle={onToggle} />
                ),
              )),
          ...(live && hasMore && !searching
            ? [
                <div key="more" testId="load-more" onClick={onLoadMore} style={{ ...row({ gap: 8 }), marginLeft: 8, marginRight: 8, marginTop: 2, paddingLeft: 10, height: 32, borderRadius: 8, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
                  <Icon name="chevronDown" size={13} color={C.ghost} />
                  <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5, pointerEvents: 'none' }}>Load more</text>
                </div>,
              ]
            : []),
        ]}
      </virtual-list>
      {liveError && (
        <div style={{ ...row({ gap: 8, alignItems: 'flex-start' }), marginLeft: 10, marginRight: 10, marginBottom: 6, padding: 9, borderRadius: 8, backgroundColor: C.redSoft }}>
          <Icon name="circleAlert" size={13} color={C.del} />
          <text style={{ fontFamily: SANS, color: C.del, fontSize: 11.5, lineHeight: 15, flexGrow: 1, flexShrink: 1, minWidth: 0, lineClamp: 3 }}>{liveError}</text>
        </div>
      )}
      <div style={{ ...row({ gap: 2 }), paddingLeft: 10, paddingRight: 10, height: 46, flexShrink: 0, borderTopWidth: 1, borderColor: C.border }}>
        <ActionMenu
          testId="help"
          side="top"
          items={[
            { id: 'source', label: source, header: true },
            { id: 'docs', label: 'Documentation', icon: 'book', run: () => openUrl('https://docs.devin.ai') },
            { id: 'api', label: 'API reference', icon: 'zap', run: () => openUrl('https://docs.devin.ai/api-reference/overview') },
            { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'list', run: onShortcuts },
            { id: 'release', label: 'Release notes', icon: 'sparkle', run: () => openUrl('https://docs.devin.ai/release-notes/overview') },
          ]}
        >
          <Icon name="help" size={16} color={C.tertiary} />
        </ActionMenu>
        <IconButton icon="settings" size={16} box={28} testId="settings" tip="Settings" active={view === 'settings'} onClick={() => onNav('settings')} />
        <div style={{ flexGrow: 1 }} />
        <Tip label={source} side="top">
          <div style={{ ...row({ gap: 7 }), height: 28, paddingLeft: 6, paddingRight: 6, borderRadius: 7, minWidth: 0, flexShrink: 1 }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, backgroundColor: !live ? C.ghost : liveError ? C.del : C.add }} />
            <text testId="session-count" style={{ fontFamily: SANS, color: C.ghost, fontSize: 11.5, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>
              {narrow ? `${running} running` : `${state.sessions.length} sessions · ${running} running`}
            </text>
          </div>
        </Tip>
        <IconButton icon={themeName === 'dark' ? 'sun' : 'moon'} size={15} box={28} testId="theme-toggle" tip={themeName === 'dark' ? 'Light mode' : 'Dark mode'} kbd="⇧⌘L" tipSide="top" onClick={onToggleTheme} />
      </div>
    </div>
  )
}

/* ───────────────────────────── Transcript ───────────────────────────── */

function DevinAvatar({ size = 24 }: { size?: number }) {
  return (
    <div style={{ ...row({ justifyContent: 'center' }), width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: C.text, flexShrink: 0 }}>
      <Icon name="devin" size={Math.round(size * 0.58)} color={C.canvas} />
    </div>
  )
}

/** Avatar + name + time above each message, like the web app's transcript. */
function Sender({ who, name, time, children }: { who: 'user' | 'devin'; name?: string; time?: string; children: React.ReactNode }) {
  return (
    <div style={row({ gap: 10, alignItems: 'flex-start' })}>
      {who === 'devin' ? <DevinAvatar /> : <Avatar name={name || 'You'} size={24} round />}
      <div style={col({ gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 })}>
        <div style={row({ gap: 8, height: 24 })}>
          <text testId={who === 'devin' ? undefined : 'sender-name'} style={{ fontFamily: SANS, fontSize: 13.5, fontWeight: 600, color: C.text }}>{who === 'devin' ? 'Devin' : name || 'You'}</text>
          {time && <text style={{ fontFamily: SANS, fontSize: 12, color: C.ghost }}>{time}</text>}
        </div>
        {children}
      </div>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div style={col({ alignItems: 'start' })}>
      <div style={{ maxWidth: '100%', paddingLeft: 14, paddingRight: 14, paddingTop: 9, paddingBottom: 10, borderRadius: 14, borderTopLeftRadius: 4, backgroundColor: C.userBubble, borderWidth: 1, borderColor: C.border }}>
        <text style={{ fontFamily: SANS, color: C.text, fontSize: 14.5, lineHeight: 22 }}>{text.length > 1200 ? `${text.slice(0, 1200)}…` : text}</text>
      </div>
    </div>
  )
}

function DevinMessage({ id, md, streaming, fresh }: { id: string; md: string; streaming?: boolean; fresh?: boolean }) {
  const [shown, setShown] = useState(fresh ? 0 : md.length)
  useEffect(() => {
    if (!fresh) {
      setShown(md.length)
      return
    }
    const total = md.length
    const step = Math.max(3, Math.ceil(total / 50))
    const id = setInterval(() => {
      setShown((n) => {
        const next = Math.min(total, n + step)
        if (next >= total) clearInterval(id)
        return next
      })
    }, 30)
    return () => clearInterval(id)
  }, [fresh, md])
  const typing = streaming || shown < md.length
  const source = shown >= md.length ? md : md.slice(0, shown)
  return (
    <markdown
      testId={`msg-${id}`}
      source={source + (typing ? ' ▍' : '')}
      theme={nativeTheme()}
      style={{ width: '100%', minWidth: 0, color: C.text, fontSize: 14.5, lineHeight: 23, fontFamily: SANS }}
    />
  )
}

function Surface({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div testId={testId} style={{ ...col(), borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      {children}
    </div>
  )
}

function PlanCard({ items }: { items: PlanItem[] }) {
  const done = items.filter((i) => i.done).length
  return (
    <Surface>
      <CardHeader icon="listChecks" right={<text testId="plan-progress" style={{ fontFamily: SANS, color: done === items.length ? C.add : C.tertiary, fontSize: 12, fontWeight: 500 }}>{`${done}/${items.length} done`}</text>}>
        <text style={{ fontFamily: SANS, color: C.text, fontSize: 13, fontWeight: 600 }}>Plan</text>
      </CardHeader>
      <div style={{ height: 2, backgroundColor: C.hover }}>
        <div style={{ width: `${(done / Math.max(1, items.length)) * 100}%`, height: 2, backgroundColor: done === items.length ? C.add : C.accent }} />
      </div>
      <div style={col({ gap: 9, paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 13 })}>
        {items.map((item, i) => (
          <div key={i} style={row({ gap: 10 })}>
            <div style={{ ...row({ justifyContent: 'center' }), width: 16, height: 16, borderRadius: 8, borderWidth: item.done ? 0 : 1.5, borderColor: C.borderStrong, backgroundColor: item.done ? C.add : CLEAR, flexShrink: 0 }}>
              {item.done && <Icon name="check" size={10} color="#ffffff" />}
            </div>
            <text style={{ fontFamily: SANS, color: item.done ? C.tertiary : C.text, fontSize: 13.5 }}>{item.text}</text>
          </div>
        ))}
      </div>
    </Surface>
  )
}

function CardHeader({ icon, children, right }: { icon: IconName; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ ...row({ gap: 8 }), paddingLeft: 12, paddingRight: 12, height: 36, backgroundColor: C.cardHead, borderBottomWidth: 1, borderColor: C.border }}>
      <Icon name={icon} size={14} color={C.tertiary} />
      <div style={{ ...row({ gap: 6 }), flexGrow: 1, minWidth: 0 }}>{children}</div>
      {right}
    </div>
  )
}

function ExitBadge({ exit }: { exit?: number }) {
  if (exit === undefined)
    return (
      <div style={row({ gap: 6 })}>
        <StatusDot status="running" size={6} />
        <text style={{ color: C.blue, fontSize: 11.5, fontFamily: MONO }}>running</text>
      </div>
    )
  const ok = exit === 0
  return (
    <div style={row({ gap: 4 })}>
      <Icon name={ok ? 'check' : 'x'} size={12} color={ok ? C.add : C.del} />
      <text style={{ color: ok ? C.add : C.del, fontSize: 11.5, fontFamily: MONO }}>{`exit ${exit}`}</text>
    </div>
  )
}

function ShellCard({ step }: { step: Extract<Step, { kind: 'shell' }> }) {
  return (
    <Surface>
      <CardHeader icon="terminal" right={<ExitBadge exit={step.exit} />}>
        <text style={{ color: C.ghost, fontSize: 12, fontFamily: MONO }}>$</text>
        <text style={{ color: C.text, fontSize: 12, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{step.cmd}</text>
      </CardHeader>
      {step.output.length > 0 && (
        <code code={step.output} language="log" theme={nativeTheme()} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 11, fontSize: 12, lineHeight: 17, color: C.secondary, fontFamily: MONO }} />
      )}
    </Surface>
  )
}

function EditCard({ step }: { step: Extract<Step, { kind: 'edit' }> }) {
  return (
    <Surface testId={`edit-${step.id}`}>
      <diff patch={step.patch} wordDiff maxLines={28} theme={nativeTheme()} style={{ fontSize: 12 }} />
    </Surface>
  )
}

function BrowserCard({ step, large }: { step: Extract<Step, { kind: 'browser' }>; large?: boolean }) {
  return (
    <Surface>
      <div style={{ ...row({ gap: 10 }), paddingLeft: 12, paddingRight: 10, height: 36, backgroundColor: C.cardHead, borderBottomWidth: 1, borderColor: C.border }}>
        <div style={row({ gap: 5 })}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <div key={c} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c, opacity: 0.85 }} />
          ))}
        </div>
        <div style={{ ...row({ gap: 6 }), flexGrow: 1, minWidth: 0, height: 22, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: C.input, borderWidth: 1, borderColor: C.border }}>
          <Icon name="lock" size={10} color={C.ghost} />
          <text style={{ color: C.secondary, fontSize: 11.5, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>{step.url}</text>
        </div>
        <Icon name="retry" size={12} color={C.ghost} />
      </div>
      <div style={{ ...col({ gap: 10 }), padding: 16, backgroundColor: '#f6f7f9', height: large ? 280 : undefined }}>
        <div style={row({ gap: 8 })}>
          <div style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: '#1f2937' }} />
          <text style={{ fontFamily: SANS, color: '#111827', fontSize: 13, fontWeight: 600 }}>{step.title}</text>
        </div>
        <div style={row({ gap: 8 })}>
          {[0.9, 0.55, 0.7].map((w, i) => (
            <div key={i} style={{ height: 34, flexGrow: w, borderRadius: 7, backgroundColor: i === 1 ? '#2f6fde' : '#e5e7eb' }} />
          ))}
        </div>
        <div style={{ height: 8, width: '70%', borderRadius: 4, backgroundColor: '#d9dce1' }} />
        <div style={{ height: 8, width: '45%', borderRadius: 4, backgroundColor: '#d9dce1' }} />
      </div>
      <div style={{ ...row({ gap: 8, alignItems: 'flex-start' }), paddingLeft: 12, paddingRight: 12, paddingTop: 9, paddingBottom: 10, borderTopWidth: 1, borderColor: C.border }}>
        <div style={{ paddingTop: 2 }}>
          <Icon name="circleCheck" size={13} color={C.add} />
        </div>
        <text style={{ fontFamily: SANS, color: C.secondary, fontSize: 12.5, lineHeight: 18, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{step.note}</text>
      </div>
    </Surface>
  )
}

function StepView({ step }: { step: Step }) {
  switch (step.kind) {
    case 'shell':
      return <ShellCard step={step} />
    case 'edit':
      return <EditCard step={step} />
    case 'browser':
      return <BrowserCard step={step} />
    case 'think':
      return <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 13.5 }}>{step.text}</text>
  }
}

function WorkGroup({ event, onToggle }: { event: Extract<TranscriptEvent, { kind: 'work' }>; onToggle: () => void }) {
  const label = event.active ? `Working for ${formatDuration(event.seconds)}` : `Worked for ${formatDuration(event.seconds)}`
  const expandable = event.steps.length > 0
  return (
    <div style={col({ gap: 8 })}>
      <div
        testId={`work-${event.id}`}
        onClick={expandable ? onToggle : undefined}
        style={{ ...row({ gap: 7 }), alignSelf: 'start', height: 28, paddingLeft: 6, paddingRight: 10, marginLeft: -6, borderRadius: 7, cursor: expandable ? 'pointer' : 'default', hover: { backgroundColor: expandable ? C.hover : CLEAR } }}
      >
        {expandable ? <Icon name={event.open ? 'chevronDown' : 'chevronRight'} size={13} color={C.ghost} /> : <Icon name="clock" size={13} color={C.ghost} />}
        {event.active && <StatusDot status="running" size={7} />}
        <text style={{ fontFamily: SANS, color: event.active ? C.secondary : C.tertiary, fontSize: 13, fontWeight: 500 }}>{label}</text>
        {expandable && <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5 }}>{`· ${event.steps.length} ${event.steps.length === 1 ? 'step' : 'steps'}`}</text>}
      </div>
      {event.open && (
        <div style={{ ...col({ gap: 10 }), marginLeft: 6, paddingLeft: 16, borderLeftWidth: 1, borderColor: C.border }}>
          {event.steps.map((step) => (
            <motion.div key={step.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              <StepView step={step} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

function CheckDot({ state }: { state: Check['state'] }) {
  const color = state === 'pass' ? C.add : state === 'fail' ? C.del : C.orange
  return (
    <div style={{ ...row({ justifyContent: 'center' }), width: 15, height: 15, borderRadius: 8, backgroundColor: state === 'pending' ? CLEAR : color, borderWidth: state === 'pending' ? 2 : 0, borderColor: color, flexShrink: 0 }}>
      {state !== 'pending' && <Icon name={state === 'pass' ? 'check' : 'x'} size={9} color="#ffffff" />}
    </div>
  )
}

function PRCard({ event }: { event: Extract<TranscriptEvent, { kind: 'pr' }> }) {
  const passed = event.checks.filter((c) => c.state === 'pass').length
  const merged = event.state === 'merged'
  const all = passed === event.checks.length
  return (
    <div testId={`pr-${event.number}`} style={{ ...col(), borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <div style={col({ gap: 6, paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 12 })}>
        <div style={row({ gap: 9 })}>
          <Icon name={merged ? 'merge' : 'pr'} size={16} color={merged ? C.purple : C.add} />
          <text style={{ fontFamily: SANS, color: C.text, fontSize: 14, fontWeight: 600, flexGrow: 1, flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{event.title}</text>
          <Badge label={merged ? 'Merged' : 'Open'} tone={merged ? 'purple' : 'green'} icon={merged ? 'merge' : 'pr'} />
        </div>
        <div style={{ ...row({ gap: 7 }), paddingLeft: 25, minWidth: 0 }}>
          <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5, flexShrink: 0 }}>{`${event.repo} #${event.number}`}</text>
          <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5, flexShrink: 0 }}>·</text>
          <text style={{ color: C.tertiary, fontSize: 12, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{event.branch}</text>
          <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5, flexShrink: 0 }}>·</text>
          <text style={{ color: C.add, fontSize: 12, fontFamily: MONO, flexShrink: 0 }}>{`+${event.additions}`}</text>
          <text style={{ color: C.del, fontSize: 12, fontFamily: MONO, flexShrink: 0 }}>{`−${event.deletions}`}</text>
        </div>
      </div>
      <div style={{ ...col({ gap: 7 }), paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.cardHead }}>
        <div style={row({ gap: 7 })}>
          <Icon name={all ? 'circleCheck' : 'clock'} size={14} color={all ? C.add : C.orange} />
          <text testId={`checks-${event.number}`} style={{ fontFamily: SANS, color: C.secondary, fontSize: 12.5, fontWeight: 500 }}>
            {all ? `All checks passed (${passed}/${event.checks.length})` : `Checks running (${passed}/${event.checks.length} passed)`}
          </text>
        </div>
        {event.checks.map((c) => (
          <div key={c.name} style={{ ...row({ gap: 8 }), paddingLeft: 1 }}>
            <CheckDot state={c.state} />
            <text style={{ fontFamily: SANS, color: C.secondary, fontSize: 12.5, flexGrow: 1 }}>{c.name}</text>
            <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12 }}>{c.detail}</text>
          </div>
        ))}
      </div>
    </div>
  )
}

const EventView = memo(function EventView({ event, sessionId, onToggleWork, narrow }: { event: TranscriptEvent; sessionId: string; onToggleWork: (sessionId: string, workId: string) => void; narrow?: boolean }) {
  let body: React.ReactNode
  switch (event.kind) {
    case 'user':
      body = (
        <Sender who="user" name={event.name} time={event.time}>
          <UserBubble text={event.text} />
        </Sender>
      )
      break
    case 'devin':
      body = (
        <Sender who="devin" time={event.time}>
          <DevinMessage id={event.id} md={event.md} streaming={event.streaming} fresh={event.fresh} />
        </Sender>
      )
      break
    case 'plan':
      body = <PlanCard items={event.items} />
      break
    case 'work':
      body = <WorkGroup event={event} onToggle={() => onToggleWork(sessionId, event.id)} />
      break
    case 'pr':
      body = <PRCard event={event} />
      break
  }
  const message = event.kind === 'user' || event.kind === 'devin'
  return (
    <div style={{ ...col({ alignItems: 'center' }), width: '100%', minWidth: 0, paddingLeft: narrow ? 16 : 32, paddingRight: narrow ? 16 : 32, paddingTop: message ? 10 : 5, paddingBottom: message ? 10 : 5 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ ...col(), width: '100%', minWidth: 0, maxWidth: 720, paddingLeft: message ? 0 : 34 }}>
        {body}
      </motion.div>
    </div>
  )
})

/* ───────────────────────────── Composer ───────────────────────────── */

const MODE_ICON: Record<AgentMode, IconName> = { fusion: 'shapes', ultra: 'listChecks', normal: 'sparkle', lite: 'compose', fast: 'zap' }

function TextSelect({
  value,
  onChange,
  items,
  label,
  testId,
  icon,
  children,
}: {
  value: string
  onChange: (v: string) => void
  items: { value: string; label: string }[]
  label: string
  testId: string
  icon?: IconName
  children: React.ReactNode
}) {
  return (
    <Select items={items} value={value} onValueChange={onChange} style={{ flexShrink: 1, minWidth: 0 }}>
      <div style={{ position: 'relative', display: 'flex', minWidth: 0 }}>
        <SelectTrigger
          testId={testId}
          style={(s) => ({ ...row({ gap: 6 }), height: 30, paddingLeft: 8, paddingRight: 7, borderRadius: 8, cursor: 'pointer', minWidth: 0, backgroundColor: s.open ? C.selected : CLEAR, hover: { backgroundColor: s.open ? C.selected : C.hover } })}
        >
          {icon && <Icon name={icon} size={14} color={C.tertiary} />}
          <text testId={`${testId}-label`} style={{ fontFamily: SANS, color: C.secondary, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1, maxWidth: 220 }}>{label}</text>
          <Icon name="chevronDown" size={12} color={C.ghost} />
        </SelectTrigger>
        <SelectContent side="top" sideOffset={6} style={menuStyle()}>
          {children}
        </SelectContent>
      </div>
    </Select>
  )
}

function MenuRow({ label, description, icon, selected }: { label: string; description?: string; icon?: IconName; selected: boolean }) {
  return (
    <>
      {icon && (
        <div style={{ ...row({ justifyContent: 'center' }), width: 26, height: 26, borderRadius: 7, backgroundColor: selected ? C.selected : C.hover, flexShrink: 0, pointerEvents: 'none' }}>
          <Icon name={icon} size={14} color={selected ? C.text : C.tertiary} />
        </div>
      )}
      <div style={col({ flexGrow: 1, minWidth: 0, pointerEvents: 'none' })}>
        <text style={{ fontFamily: SANS, color: C.text, fontSize: 13.5, fontWeight: selected ? 500 : 400 }}>{label}</text>
        {description && <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12 }}>{description}</text>}
      </div>
      {selected && <Icon name="check" size={14} color={C.accent} />}
    </>
  )
}

function ModePicker({ value, onChange }: { value: AgentMode; onChange: (m: AgentMode) => void }) {
  const current = MODES.find((m) => m.value === value) ?? MODES[0]!
  return (
    <TextSelect value={value} onChange={(v) => onChange(v as AgentMode)} items={MODES} label={current.label} icon={MODE_ICON[current.value]} testId="mode-picker">
      {MODES.map((m) => (
        <SelectItem key={m.value} value={m.value} testId={`mode-${m.value}`} style={(s) => ({ ...menuItemStyle(s), minWidth: 260 })}>
          {(s) => <MenuRow label={m.label} description={m.description} icon={MODE_ICON[m.value]} selected={s.selected} />}
        </SelectItem>
      ))}
    </TextSelect>
  )
}

function RepoPicker({ value, onChange, repos }: { value: string; onChange: (r: string) => void; repos: string[] }) {
  return (
    <TextSelect value={value} onChange={onChange} items={repos.map((r) => ({ value: r, label: r }))} icon="folder" label={value} testId="repo-picker">
      {repos.map((r) => (
        <SelectItem key={r} value={r} testId={`repo-${r.split('/')[1] ?? 'none'}`} style={(s) => menuItemStyle(s)}>
          {(s) => (
            <>
              <Icon name="folder" size={14} color={C.tertiary} />
              <text style={{ fontFamily: SANS, color: C.text, fontSize: 13.5, flexGrow: 1, pointerEvents: 'none' }}>{r}</text>
              {s.selected && <Icon name="check" size={14} color={C.accent} />}
            </>
          )}
        </SelectItem>
      ))}
    </TextSelect>
  )
}

function SendButton({ canSend, onClick }: { canSend: boolean; onClick: () => void }) {
  return (
    <Tip label="Send" kbd="↵" side="top">
      <Button
        testId="send"
        onClick={onClick}
        style={{ ...row({ justifyContent: 'center' }), marginLeft: 4, width: 32, height: 32, borderRadius: 16, cursor: canSend ? 'pointer' : 'default', backgroundColor: canSend ? C.sendBg : C.selected, hover: { opacity: canSend ? 0.88 : 1 }, active: { opacity: canSend ? 0.76 : 1 } }}
      >
        <Icon name="send" size={16} color={canSend ? C.sendFg : C.ghost} />
      </Button>
    </Tip>
  )
}

type ComposerProps = {
  draft: string
  setDraft: (v: string) => void
  onSubmit: (text: string) => void
  mode: AgentMode
  onMode: (m: AgentMode) => void
  repo?: string
  onRepo?: (r: string) => void
  repos?: string[]
  placeholder: string
  composerRef: React.RefObject<PublicInstance | null>
  big?: boolean
  plusMenu?: MenuAction[]
  slashMenu?: MenuAction[]
  chips?: { id: string; label: string; icon: IconName; onRemove: () => void }[]
}

function Composer({ draft, setDraft, onSubmit, mode, onMode, repo, onRepo, repos, placeholder, composerRef, big, plusMenu, slashMenu, chips }: ComposerProps) {
  const canSend = draft.trim().length > 0
  const [focused, setFocused] = useState(false)
  return (
    <div
      style={{
        ...col({ gap: 10 }),
        width: '100%',
        maxWidth: big ? 720 : 760,
        paddingLeft: 14,
        paddingRight: 10,
        paddingTop: 13,
        paddingBottom: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: focused ? C.focus : C.borderStrong,
        backgroundColor: C.raised,
        boxShadow: raisedShadow(),
      }}
    >
      {chips && chips.length > 0 && (
        <div style={row({ gap: 6, flexWrap: 'wrap' })}>
          {chips.map((c) => (
            <div key={c.id} testId={`chip-${c.id}`} style={{ ...row({ gap: 6 }), height: 26, paddingLeft: 8, paddingRight: 4, borderRadius: 8, backgroundColor: C.chip, borderWidth: 1, borderColor: C.border }}>
              <Icon name={c.icon} size={12} color={C.chipText} />
              <text style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 500, color: C.chipText, whiteSpace: 'nowrap' }}>{c.label}</text>
              <div testId={`chip-${c.id}-x`} onClick={c.onRemove} style={{ ...row({ justifyContent: 'center' }), width: 18, height: 18, borderRadius: 5, cursor: 'pointer', hover: { backgroundColor: C.selected } }}>
                <Icon name="x" size={11} color={C.tertiary} />
              </div>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={composerRef}
        testId="composer"
        value={draft}
        placeholder={placeholder}
        minRows={big ? 3 : 1}
        maxRows={8}
        onChange={(e) => setDraft(e.value ?? '')}
        onSubmit={(e) => onSubmit(e.value ?? draft)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ fontSize: 14.5, lineHeight: 22, paddingLeft: 2, color: C.text, backgroundColor: C.raised, fontFamily: SANS }}
        theme={{ caret: C.text, textMuted: C.ghost }}
      />
      <div style={row({ gap: 2 })}>
        {plusMenu && (
          <ActionMenu testId="composer-plus" side="top" items={plusMenu} triggerStyle={{ width: 30, height: 30, borderRadius: 8 }}>
            <Icon name="plus" size={16} color={C.tertiary} />
          </ActionMenu>
        )}
        {slashMenu && (
          <ActionMenu testId="composer-slash" side="top" items={slashMenu} triggerStyle={{ width: 30, height: 30, borderRadius: 8 }}>
            <text style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: C.tertiary }}>/</text>
          </ActionMenu>
        )}
        {big && repo && onRepo && repos && <RepoPicker value={repo} onChange={onRepo} repos={repos} />}
        <div style={{ flexGrow: 1 }} />
        <ModePicker value={mode} onChange={onMode} />
        <SendButton canSend={canSend} onClick={() => canSend && onSubmit(draft)} />
      </div>
    </div>
  )
}

/* ───────────────────────────── Right panel ───────────────────────────── */

const TABS: { id: PanelTab; label: string; icon: IconName }[] = [
  { id: 'shell', label: 'Shell', icon: 'terminal' },
  { id: 'editor', label: 'Editor', icon: 'pencil' },
  { id: 'browser', label: 'Browser', icon: 'monitor' },
  { id: 'planner', label: 'Planner', icon: 'listChecks' },
]

function allSteps(s: Session): Step[] {
  return s.events.flatMap((e) => (e.kind === 'work' ? e.steps : []))
}

/** Newest PRs that get their own tab; older ones stay reachable from the Session tab and the session ⋯ menu. */
const MAX_PR_TABS = 3

function PanelTabs({ tabs, tab, onTab }: { tabs: { id: string; label: string; icon: IconName }[]; tab: string; onTab: (t: string) => void }) {
  const tight = tabs.length > 3
  return (
    <div style={{ ...row({ gap: 2 }), height: 48, paddingLeft: 10, paddingRight: 10, flexShrink: 0, borderBottomWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
      {tabs.map((t) => {
        const active = t.id === tab
        return (
          <div
            key={t.id}
            testId={`tab-${t.id}`}
            onClick={() => onTab(t.id)}
            style={{ ...row({ gap: tight ? 5 : 6 }), height: 28, paddingLeft: tight ? 8 : 10, paddingRight: tight ? 8 : 10, borderRadius: 7, cursor: 'pointer', flexShrink: 0, backgroundColor: active ? C.selected : CLEAR, hover: { backgroundColor: active ? C.selected : C.hover } }}
          >
            <Icon name={t.icon} size={14} color={active ? C.text : C.ghost} />
            <text style={{ fontFamily: SANS, color: active ? C.text : C.tertiary, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{t.label}</text>
          </div>
        )
      })}
    </div>
  )
}

function PanelScroll({ children, padding = 14 }: { children: React.ReactNode; padding?: number }) {
  return <div style={{ ...col({ gap: 10 }), flexGrow: 1, minHeight: 0, padding, overflowY: 'scroll', scrollbarColor: C.borderStrong }}>{children}</div>
}

function DemoPanel({ session, tab, onTab }: { session: Session; tab: PanelTab; onTab: (t: PanelTab) => void }) {
  const steps = allSteps(session)
  const shells = steps.filter((s): s is Extract<Step, { kind: 'shell' }> => s.kind === 'shell')
  const edits = steps.filter((s): s is Extract<Step, { kind: 'edit' }> => s.kind === 'edit')
  const browsers = steps.filter((s): s is Extract<Step, { kind: 'browser' }> => s.kind === 'browser')
  const plan = [...session.events].reverse().find((e): e is Extract<TranscriptEvent, { kind: 'plan' }> => e.kind === 'plan')
  return (
    <>
      <PanelTabs tabs={TABS} tab={tab} onTab={onTab} />
      <PanelScroll>
        {tab === 'shell' &&
          (shells.length ? (
            shells.map((s) => <ShellCard key={s.id} step={s} />)
          ) : (
            <EmptyState compact icon="terminal" title="No commands yet" body="Commands Devin runs show up here." />
          ))}
        {tab === 'editor' &&
          (edits.length ? (
            edits.map((e) => <EditCard key={e.id} step={e} />)
          ) : (
            <EmptyState compact icon="pencil" title="No files edited yet" body="Every file Devin changes shows up here as a diff." />
          ))}
        {tab === 'browser' && (browsers.length ? <BrowserCard step={browsers[browsers.length - 1]!} large /> : <EmptyState compact icon="monitor" title="Browser idle" body="Pages Devin opens show up here." />)}
        {tab === 'planner' && (
          <div style={col({ gap: 12 })}>
            <div style={{ ...row({ gap: 10 }), padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
              <StatusPill status={session.status} />
              <div style={{ flexGrow: 1 }} />
              <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5 }}>{`${session.acus} ACUs`}</text>
            </div>
            {plan ? <PlanCard items={plan.items} /> : <EmptyState compact icon="listChecks" title="No plan for this session" />}
          </div>
        )}
      </PanelScroll>
    </>
  )
}

function prLabel(url: string) {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  return m ? { repo: m[1]!, number: m[2]! } : { repo: url, number: '' }
}

function DetailRow({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ ...row({ gap: 12 }), minHeight: 40, paddingTop: 9, paddingBottom: 9, borderBottomWidth: last ? 0 : 1, borderColor: C.border }}>
      <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5, width: 84, flexShrink: 0 }}>{label}</text>
      <div style={{ ...row({ gap: 7 }), flexGrow: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function LivePanel({ session, sessions, tab, onTab, onSelect, client, pollMs, previews }: { session: Session; sessions: Session[]; tab: PanelTab; onTab: (t: PanelTab) => void; onSelect: (id: string) => void; client: DevinApi | null; pollMs: number; previews?: Omit<PreviewDeps, 'resolve'> }) {
  const live = session.live!
  const tabs = [{ id: 'computer', label: 'Computer', icon: 'monitor' as IconName }, { id: 'details', label: 'Session', icon: 'list' as IconName }, ...live.prs.map((p, i) => ({ id: `pr-${i}`, label: `#${prLabel(p.url).number}`, icon: 'pr' as IconName })).slice(-MAX_PR_TABS)]
  const current = tabs.some((t) => t.id === tab) ? tab : 'computer'
  const children = sessions.filter((s) => s.live?.parentId === session.id)
  const pr = current.startsWith('pr-') ? live.prs[Number(current.slice(3))] : undefined
  const prState = (pr?.state ?? 'open').toLowerCase()
  return (
    <>
      <PanelTabs tabs={tabs} tab={current} onTab={onTab} />
      {current === 'computer' ? (
        <ComputerPanel key={session.id} session={session} client={client} pollMs={pollMs} previews={previews} />
      ) : (
        <PanelScroll padding={18}>
          {pr ? (
            <div style={col({ gap: 14 })}>
              <div style={{ ...col({ gap: 10 }), padding: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
                <div style={row({ gap: 8 })}>
                  <Badge big label={prState[0]!.toUpperCase() + prState.slice(1)} tone={prState === 'merged' ? 'purple' : prState === 'open' ? 'green' : 'neutral'} icon={prState === 'merged' ? 'merge' : 'pr'} />
                  <text style={{ fontFamily: SANS, color: C.secondary, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{`${prLabel(pr.url).repo} #${prLabel(pr.url).number}`}</text>
                </div>
                <text style={{ color: C.tertiary, fontSize: 12, fontFamily: MONO, lineHeight: 18, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>{pr.url.replace('https://', '')}</text>
                <div style={row()}>
                  <Btn testId="open-pr" icon="external" label="Open on GitHub" onClick={() => openUrl(pr.url)} />
                </div>
              </div>
              <PrReview key={pr.url} url={pr.url} client={client} canRun={(pr.state ?? 'open') === 'open'} />
            </div>
          ) : (
            <div style={col()}>
              <DetailRow label="Status">
                <StatusDot status={session.status} size={7} />
                <text testId="detail-status" style={{ fontFamily: SANS, color: C.text, fontSize: 13 }}>{statusLine(session) ?? STATUS_LABEL[session.status]}</text>
              </DetailRow>
              <DetailRow label="Mode">
                <Icon name={MODE_ICON[session.mode]} size={13} color={C.tertiary} />
                <text style={{ fontFamily: SANS, color: C.text, fontSize: 13 }}>{MODES.find((m) => m.value === session.mode)?.label ?? 'Normal'}</text>
              </DetailRow>
              <DetailRow label="ACUs">
                <text style={{ fontFamily: SANS, color: C.text, fontSize: 13 }}>{String(session.acus)}</text>
              </DetailRow>
              <DetailRow label="Updated">
                <text style={{ fontFamily: SANS, color: C.text, fontSize: 13 }}>{session.updated}</text>
              </DetailRow>
              <DetailRow label="Link" last>
                <div onClick={() => openUrl(live.url)} style={{ ...row({ gap: 4 }), cursor: 'pointer', minWidth: 0, flexShrink: 1 }}>
                  <text style={{ fontFamily: SANS, color: C.accent, fontSize: 13, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{live.url ? live.url.replace('https://', '') : 'Starting…'}</text>
                  {live.url && <Icon name="external" size={12} color={C.accent} />}
                </div>
              </DetailRow>
              <SessionExtras session={session} client={client} />
              {children.length > 0 && (
                <div style={col({ gap: 2, paddingTop: 18 })}>
                  <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12, fontWeight: 500, paddingBottom: 6 }}>{`Child sessions · ${children.length}`}</text>
                  {children.map((c) => (
                    <div key={c.id} onClick={() => onSelect(c.id)} style={{ ...row({ gap: 9 }), height: 32, paddingLeft: 8, paddingRight: 8, marginLeft: -8, marginRight: -8, borderRadius: 7, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
                      <StatusDot status={c.status} size={7} />
                      <text style={{ fontFamily: SANS, color: C.text, fontSize: 13, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{c.title}</text>
                      <Icon name="chevronRight" size={12} color={C.ghost} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </PanelScroll>
      )}
    </>
  )
}

/** Devin's computer, as far as the public API shows it: the screenshots and recordings Devin posts, newest first. */
function ComputerPanel({ session, client, pollMs, previews }: { session: Session; client: DevinApi | null; pollMs: number; previews?: Omit<PreviewDeps, 'resolve'> }) {
  const [shots, setShots] = useState<Shot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useSticky<number>(`computer-${session.id}`, -1)
  const [preview, setPreview] = useState<{ id: string; path: string | null } | null>(null)
  const running = session.status === 'running' || session.status === 'blocked'
  useEffect(() => {
    if (!client?.listAttachments) return
    let alive = true
    const load = () =>
      client.listAttachments!(session.id)
        .then((list) => {
          if (!alive) return
          const next = shotsFrom(list)
          setShots((prev) => (prev && prev.length === next.length && prev.at(-1)?.attachment_id === next.at(-1)?.attachment_id ? prev : next))
          setError(null)
        })
        .catch((e: Error) => alive && setError(e.message))
    load()
    const timer = running ? setInterval(load, pollMs) : null
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [client, session.id, running, pollMs])
  const n = shots?.length ?? 0
  const idx = n ? (pick < 0 || pick >= n ? n - 1 : pick) : -1
  const shot = idx >= 0 ? shots![idx]! : null
  const following = pick < 0 || pick >= n - 1
  useEffect(() => {
    if (!shot || !client?.attachmentUrl) return
    let alive = true
    previewPath(shot, { ...previews, resolve: (a) => client.attachmentUrl!(a) }).then((path) => alive && setPreview({ id: shot.attachment_id, path }))
    return () => {
      alive = false
    }
  }, [shot?.attachment_id, client])
  const go = (i: number) => setPick(i >= n - 1 ? -1 : Math.max(0, i))
  const [opening, setOpening] = useState(false)
  // app.devin.ai attachment links need a web-app login and S3 serves them as downloads, so fetch the original and open it locally.
  const openOriginal = (s: Shot) => {
    const fallback = () => openUrl(session.live?.url ?? s.url)
    if (!client?.attachmentUrl) return fallback()
    setOpening(true)
    originalPath(s, { ...previews, resolve: (a) => client.attachmentUrl!(a) })
      .then((file) => (file ? (clearQuarantine(file), openUrl(file)) : fallback()))
      .finally(() => setOpening(false))
  }
  const ready = preview && shot && preview.id === shot.attachment_id ? preview : null
  if (error && !shots) return <EmptyState icon="circleAlert" title="Couldn’t load attachments" body={error.slice(0, 120)} />
  if (!shots) return <Empty text="Loading Devin's screenshots…" />
  if (!shot)
    return (
      <div style={{ ...col({ justifyContent: 'center' }), flexGrow: 1 }}>
        <EmptyState testId="computer-empty" icon="monitor" title="No screenshots yet" body="Devin's screen shows up here whenever Devin posts a screenshot or recording in this session." />
      </div>
    )
  const recent = shots.map((s, i) => ({ s, i })).slice(-6).reverse()
  return (
    <div style={{ ...col({ gap: 10 }), flexGrow: 1, minHeight: 0, padding: 14 }}>
      <div style={{ ...row({ gap: 4 }), flexShrink: 0 }}>
        <Icon name={shot.kind === 'video' ? 'laptop' : 'monitor'} size={13} color={C.ghost} />
        <text testId="computer-name" style={{ fontFamily: MONO, color: C.secondary, fontSize: 12, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', paddingLeft: 4 }}>{shot.name}</text>
        <text testId="computer-count" style={{ fontFamily: SANS, color: C.ghost, fontSize: 12, fontWeight: 500, flexShrink: 0, paddingRight: 4 }}>{`${idx + 1} / ${n}`}</text>
        <IconButton icon="arrowLeft" testId="computer-prev" size={14} box={26} tip="Older" onClick={() => idx > 0 && go(idx - 1)} color={idx > 0 ? C.secondary : C.ghost} />
        <IconButton icon="arrowRight" testId="computer-next" size={14} box={26} tip="Newer" onClick={() => idx < n - 1 && go(idx + 1)} color={idx < n - 1 ? C.secondary : C.ghost} />
      </div>
      <Button
        testId="computer-stage"
        onClick={() => openOriginal(shot)}
        style={{ ...col({ alignItems: 'center', justifyContent: 'center' }), position: 'relative', flexGrow: 1, minHeight: 200, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden', cursor: 'pointer', hover: { borderColor: C.borderStrong } }}
      >
        {ready?.path ? (
          <img testId="computer-image" src={ready.path} objectFit="contain" alt={shot.name} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
        ) : (
          <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 13, pointerEvents: 'none' }}>{ready ? 'No preview here. Click to open it in the browser.' : 'Loading preview…'}</text>
        )}
        {shot.kind === 'video' && (
          <div style={{ ...row({ gap: 6 }), position: 'absolute', top: 10, left: 10, height: 24, paddingLeft: 10, paddingRight: 10, borderRadius: 12, backgroundColor: '#000000b3', pointerEvents: 'none' }}>
            <text testId="computer-video-badge" style={{ fontFamily: SANS, color: '#ffffff', fontSize: 12, fontWeight: 500 }}>▶ Recording</text>
          </div>
        )}
      </Button>
      <div style={{ ...row({ gap: 8 }), flexShrink: 0 }}>
        {following ? (
          <>
            {running ? <StatusDot status="running" size={7} color={C.add} /> : <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.ghost }} />}
            <text testId="computer-following" style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{running ? 'Showing the latest · updates as Devin posts' : 'Latest from this session'}</text>
          </>
        ) : (
          <div style={{ flexGrow: 1 }}>
            <Btn label="Jump to latest" icon="arrowRight" testId="computer-latest" small onClick={() => setPick(-1)} />
          </div>
        )}
        <Btn label={opening ? 'Opening…' : 'Open'} icon="external" testId="computer-open" small onClick={() => !opening && openOriginal(shot)} />
      </div>
      <div style={{ ...col({ gap: 1 }), flexShrink: 0, paddingTop: 4, borderTopWidth: 1, borderColor: C.border }}>
        <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12, fontWeight: 500, paddingTop: 6, paddingBottom: 4, paddingLeft: 2 }}>Recent</text>
        {recent.map(({ s, i }) => (
          <div
            key={s.attachment_id}
            testId={`computer-item-${i}`}
            onClick={() => go(i)}
            style={{ ...row({ gap: 8 }), height: 30, paddingLeft: 8, paddingRight: 8, borderRadius: 7, cursor: 'pointer', backgroundColor: i === idx ? C.selected : CLEAR, hover: { backgroundColor: i === idx ? C.selected : C.hover } }}
          >
            <Icon name={s.kind === 'video' ? 'laptop' : 'monitor'} size={13} color={i === idx ? C.text : C.ghost} />
            <text style={{ fontFamily: MONO, color: i === idx ? C.text : C.tertiary, fontSize: 11.5, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis', pointerEvents: 'none' }}>{s.name}</text>
            <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 11.5, flexShrink: 0, pointerEvents: 'none' }}>{s.kind === 'video' ? 'Recording' : 'Screenshot'}</text>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────── Main panes ───────────────────────────── */

function SessionHeader({ session, panelOpen, onTogglePanel, compact = false, tiny = false, menu, onChecklist, renaming, onRename, leading }: { session: Session; panelOpen: boolean; onTogglePanel: () => void; compact?: boolean; tiny?: boolean; menu: MenuAction[]; onChecklist: () => void; renaming: boolean; onRename: (title: string | null) => void; leading?: React.ReactNode }) {
  const prs = prCount(session)
  const [name, setName] = useState(session.title)
  if (renaming)
    return (
      <div style={{ ...row({ gap: 8 }), height: 48, paddingLeft: leading ? 8 : 20, paddingRight: 10, borderBottomWidth: 1, borderColor: C.border, flexShrink: 0 }}>
        {leading}
        <div style={{ flexGrow: 1, maxWidth: 420 }}>
          <Field testId="rename-input" value={name} onChange={setName} placeholder="Session name" />
        </div>
        <Btn small primary testId="rename-save" label="Save" disabled={!name.trim()} onClick={() => onRename(name.trim())} />
        <Btn small ghost testId="rename-cancel" label="Cancel" onClick={() => onRename(null)} />
      </div>
    )
  return (
    <div style={{ ...row({ gap: 10 }), height: 48, paddingLeft: leading ? 8 : 20, paddingRight: 10, borderBottomWidth: 1, borderColor: C.border, flexShrink: 0 }}>
      {leading}
      <text testId="session-title" style={{ fontFamily: SANS, color: C.text, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>{session.title}</text>
      <StatusPill status={session.status} testId="session-status" />
      {prs > 0 && (
        <div style={{ ...row({ gap: 4 }), flexShrink: 0 }}>
          <Icon name="pr" size={13} color={C.tertiary} />
          <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5, fontWeight: 500 }}>{String(prs)}</text>
        </div>
      )}
      {!tiny && (
        <div style={{ ...row({ gap: 5 }), flexShrink: 0 }}>
          <Icon name={MODE_ICON[session.mode]} size={13} color={C.ghost} />
          <text testId="session-mode" style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5 }}>{MODES.find((m) => m.value === session.mode)?.label ?? ''}</text>
        </div>
      )}
      <div style={{ flexGrow: 1 }} />
      {!compact && <IconButton icon="listChecks" testId="checklist" tip={session.live ? 'Session details' : 'Plan'} onClick={onChecklist} />}
      <ActionMenu testId="session-menu" items={menu} triggerStyle={{ width: 30, height: 30, borderRadius: 8 }}>
        <Icon name="more" size={16} color={C.tertiary} />
      </ActionMenu>
      {!compact && <IconButton icon="panelRight" testId="toggle-panel" tip={panelOpen ? 'Hide panel' : 'Show panel'} kbd="⌘." onClick={onTogglePanel} active={panelOpen} />}
    </div>
  )
}

function StatusFooter({ session }: { session: Session }) {
  const line = statusLine(session)
  if (!line) return null
  const blocked = session.status === 'blocked'
  return (
    <div style={{ ...row({ gap: 9 }), width: '100%', maxWidth: 760, paddingLeft: 8, paddingBottom: 10 }}>
      <StatusDot status={session.status} size={7} />
      <text testId="status-line" style={{ fontFamily: SANS, color: blocked ? C.orange : C.tertiary, fontSize: 13, fontWeight: blocked ? 500 : 400 }}>{line}</text>
    </div>
  )
}

type Suggestion = { icon: IconName; label: string; prompt: string }
const SUGGESTIONS: Record<'agent' | 'ask', Suggestion[]> = {
  agent: [
    { icon: 'bug', label: 'Fix a bug', prompt: 'Fix the bug where ' },
    { icon: 'flask', label: 'Write tests', prompt: 'Add tests for ' },
    { icon: 'pr', label: 'Review a PR', prompt: 'Review this pull request and point out bugs, risky changes and missing tests: ' },
    { icon: 'book', label: 'Explain the codebase', prompt: 'Explain how this repository is structured and where to start reading.' },
  ],
  ask: [
    { icon: 'book', label: 'How does it work?', prompt: 'How does ' },
    { icon: 'search', label: 'Find where…', prompt: 'Where in the codebase do we ' },
    { icon: 'pr', label: 'Summarize recent PRs', prompt: 'Summarize the pull requests merged this week.' },
  ],
}

function HomeView({ composer, kind, onKind, onSuggest }: { composer: ComposerProps; kind: 'agent' | 'ask'; onKind: (k: 'agent' | 'ask') => void; onSuggest: (prompt: string) => void }) {
  return (
    <div style={{ ...col({ alignItems: 'center', justifyContent: 'center' }), flexGrow: 1, paddingLeft: 32, paddingRight: 32, paddingBottom: 72 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} style={{ ...col({ gap: 16 }), width: '100%', maxWidth: 720 }}>
        <div style={row({ gap: 12, paddingLeft: 4, paddingRight: 2 })}>
          <DevinAvatar size={32} />
          <text testId="home-title" style={{ fontFamily: SANS, color: C.text, fontSize: 26, fontWeight: 600 }}>Devin</text>
          <div style={{ flexGrow: 1 }} />
          <Segmented testId="kind" value={kind} onChange={onKind} items={[{ value: 'agent', label: 'Agent' }, { value: 'ask', label: 'Ask' }]} />
        </div>
        <Composer {...composer} big />
        <div style={{ ...row({ gap: 8, flexWrap: 'wrap' }), paddingLeft: 2 }}>
          {SUGGESTIONS[kind].map((s) => (
            <div key={s.label} testId={`suggest-${slugify(s.label)}`} onClick={() => onSuggest(s.prompt)} style={{ ...row({ gap: 7 }), height: 30, paddingLeft: 10, paddingRight: 12, borderRadius: 15, borderWidth: 1, borderColor: C.border, cursor: 'pointer', hover: { backgroundColor: C.hover, borderColor: C.borderStrong } }}>
              <Icon name={s.icon} size={13} color={C.tertiary} />
              <text style={{ fontFamily: SANS, color: C.secondary, fontSize: 13, pointerEvents: 'none' }}>{s.label}</text>
            </div>
          ))}
        </div>
        <div style={{ ...row({ gap: 14, flexWrap: 'wrap' }), paddingLeft: 4, paddingTop: 6 }}>
          {[
            ['↵', 'send'],
            ['⇧↵', 'new line'],
            ['/', 'commands'],
            ['⌘K', 'search sessions'],
          ].map(([k, label]) => (
            <div key={k} style={row({ gap: 6 })}>
              <Kbd keys={k!} subtle />
              <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12 }}>{label}</text>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}

/* ───────────────────────────── App ───────────────────────────── */

export interface DevinAppProps {
  keySource?: string | null
  onSaveKey?: (c: { apiKey: string; orgId: string }) => Promise<string>
  onRemoveKey?: () => Promise<void>
  initialView?: View
  initialSettingsPage?: string
  initialToast?: string | null
  verifyKey?: (c: { apiKey: string; orgId: string; baseUrl: string }) => Promise<unknown>
  orgId?: string | null
  baseUrl?: string
  keyHint?: string | null
  speed?: number
  initialSelected?: string | null
  initialMode?: AgentMode
  /** Starts a new session with this prompt on launch (the CLI's positional argument). */
  initialPrompt?: string
  /** Real Devin API client. Without one the app runs on scripted demo data. */
  client?: DevinApi | null
  /** Overrides for where attachment previews are cached and how video posters are made (tests). */
  previews?: Omit<PreviewDeps, 'resolve'>
  /** Live mode: select the first session matching this query once the list loads. */
  sessionQuery?: string
  theme?: ThemeName
  userName?: string
  pollMs?: number
  /** Terminal mode: turn the terminal's own font-size shortcuts (Ghostty ⌘+ / ⌘− / ⌘0) into app zoom. */
  followTerminalFont?: boolean
  /** Repository preselected for new sessions. */
  initialRepo?: string
}

export function DevinApp({
  speed = 1,
  initialSelected = 's-rate-limit',
  initialMode = 'normal',
  initialPrompt,
  client = null,
  previews,
  sessionQuery,
  theme = 'dark',
  userName = 'Nader Dabit',
  pollMs = 3000,
  followTerminalFont = false,
  orgId = null,
  baseUrl = 'https://api.devin.ai',
  keyHint = null,
  keySource = null,
  onSaveKey,
  onRemoveKey,
  initialView,
  initialSettingsPage,
  initialToast = null,
  verifyKey,
  initialRepo,
}: DevinAppProps) {
  const live = client !== null
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    setTheme(theme)
    return theme
  })
  const [state, dispatch] = useReducer(reducer, undefined, (): State => ({
    sessions: live ? [] : initialSessions(),
    selectedId: live ? null : initialSelected,
    search: '',
    mode: initialMode,
    panelOpen: true,
    panelTab: live ? 'computer' : 'shell',
    repo: initialRepo ?? (live ? NO_REPO : REPOS[1]!),
  }))
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<'agent' | 'ask'>('agent')
  const [liveError, setLiveError] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(40)
  const [view, setView] = useState<View>(initialView ?? 'home')
  const viewRef = useRef(view)
  viewRef.current = view
  const [customizeTab, setCustomizeTab] = useState<'playbooks' | 'knowledge'>('playbooks')
  const [sessionsTab, setSessionsTab] = useState<{ filter: SessionsFilter; n: number }>({ filter: 'all', n: 0 })
  const [extraRepos, setExtraRepos] = useState<string[]>([])
  const [settingsReq, setSettingsReq] = useState<{ n: number; page?: string }>({ n: 0 })
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(initialToast ? { text: initialToast } : null)
  const notify = useCallback((text: string, error?: boolean) => setToast({ text, error }), [])
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const titlesRef = useRef<Record<string, string>>({})
  titlesRef.current = prefs.titles ?? {}
  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }, [])
  const [playbooks, setPlaybooks] = useState<ApiPlaybook[]>([])
  type Attach = { playbook?: { id: string; title: string }; links?: { url: string; title: string }[] }
  const [attach, setAttach] = useState<Attach>({})
  const attachRef = useRef(attach)
  attachRef.current = attach
  const kindRef = useRef<'agent' | 'ask'>('agent')
  const fromApi = (s: ApiSession): Session => {
    const x = sessionFromApi(s)
    const t = titlesRef.current[x.id]
    return t ? { ...x, title: t } : x
  }
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    client?.listPlaybooks?.().then(setPlaybooks).catch(() => {})
  }, [client])
  const { renderer } = useGpuix()
  const searchRef = useRef<PublicInstance | null>(null)
  const composerRef = useRef<PublicInstance | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const runCount = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state

  // Reflow for narrow hosts (a Ghostty split): drop the right panel, then shrink and finally hide the sidebar.
  const [zoom, setZoomState] = useState(getZoom())
  const { width: rawWidth, height: rawHeight } = useWindowSize()
  // Layout breakpoints work in zoomed points, like browser zoom.
  const hostWidth = rawWidth / zoom
  const compact = hostWidth > 0 && hostWidth < 1080
  const tiny = hostWidth > 0 && hostWidth < 600
  const panelWidth = live && (state.panelTab === 'computer' || !state.panelTab) && hostWidth >= 1360 ? 520 : PANEL_WIDTH
  const visible = useMemo(() => filterSessions(state.sessions, state.search), [state.sessions, state.search])
  const selected = state.sessions.find((s) => s.id === state.selectedId) ?? null
  const repos = useMemo(() => {
    if (!live) return REPOS
    const set = new Set<string>()
    for (const s of state.sessions) for (const p of s.live?.prs ?? []) set.add(prLabel(p.url).repo)
    if (initialRepo) set.add(initialRepo)
    for (const r of extraRepos) set.add(r)
    return [NO_REPO, ...[...set].filter((r) => r.includes('/')).sort()]
  }, [live, state.sessions, initialRepo, extraRepos])

  useEffect(() => {
    const r = renderer as unknown as { registerFont?: (bytes: Uint8Array) => void } | null
    for (const w of ['Regular', 'Medium', 'SemiBold']) {
      try {
        r?.registerFont?.(readFileSync(new URL(`../assets/fonts/Inter-${w}.ttf`, import.meta.url)))
      } catch {}
    }
  }, [renderer])

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'tick', seconds: live ? 1 : 7 }), 1000)
    return () => {
      clearInterval(id)
      timers.current.forEach(clearTimeout)
    }
  }, [live])

  // Live: page through the account's sessions once (the API lists by creation time, the sidebar sorts by activity),
  // then keep the newest page fresh in the background.
  const pendingQuery = useRef(sessionQuery)
  useEffect(() => {
    if (!client) return
    let alive = true
    const applyQuery = (all: Session[]) => {
      if (!pendingQuery.current) return
      const match = filterSessions(byRecent(all), pendingQuery.current)[0]
      if (match) {
        pendingQuery.current = undefined
        dispatch({ type: 'select', id: match.id })
      }
    }
    const loadAll = async () => {
      const all: Session[] = []
      let cursor: string | undefined
      try {
        for (let page = 0; page < MAX_PAGES && alive; page++) {
          const res = await client.listSessions(100, cursor)
          all.push(...res.items.map((s) => fromApi(s)))
          dispatch({ type: page === 0 ? 'load' : 'merge', sessions: page === 0 ? [...all] : res.items.map((s) => fromApi(s)) })
          setLiveError(null)
          applyQuery(all)
          if (!res.hasMore || !res.cursor) break
          cursor = res.cursor
        }
      } catch (error) {
        if (alive) setLiveError((error as Error).message)
      }
    }
    const refresh = async () => {
      try {
        const res = await client.listSessions(100)
        if (alive) dispatch({ type: 'merge', sessions: res.items.map((s) => fromApi(s)) })
        // Sessions archived elsewhere (web app, Slack) after launch drop out of the sidebar.
        const gone = client.listArchived ? await client.listArchived(100) : []
        if (alive && gone.length) dispatch({ type: 'prune', ids: gone.map((s) => s.session_id.replace(/^devin-/, '')) })
      } catch (error) {
        if (alive) setLiveError((error as Error).message)
      }
    }
    void loadAll()
    const id = setInterval(refresh, Math.max(pollMs * 3, 3000))
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [client, pollMs])

  // Live: the open session's messages and status, polled while it is selected.
  useEffect(() => {
    const id = state.selectedId
    if (!client || !id || id.startsWith('pending-')) return
    let alive = true
    const poll = async () => {
      try {
        const [messages, s] = await Promise.all([client.listMessages(id), client.getSession(id)])
        if (!alive) return
        const session = fromApi(s)
        dispatch({ type: 'upsert', session })
        dispatch({ type: 'events', id, events: eventsFromMessages(messages, { running: session.status === 'running' }) })
      } catch (error) {
        if (alive) setLiveError((error as Error).message)
      }
    }
    void poll()
    const timer = setInterval(poll, pollMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [client, state.selectedId, pollMs])

  const schedule = useCallback(
    (sessionId: string, actions: RunAction[]) => {
      for (const action of actions) {
        timers.current.push(setTimeout(() => dispatch({ type: 'run', sessionId, action }), action.at / speed))
      }
    },
    [speed],
  )

  const focusComposer = useCallback(() => {
    setTimeout(() => {
      if (composerRef.current) renderer?.focusElement?.(composerRef.current.id)
    }, 30)
  }, [renderer])

  const createSession = useCallback(
    (text: string, repo: string) => {
      const prompt = text.trim()
      if (!prompt) return
      const n = ++runCount.current
      const s = stateRef.current
      if (client) {
        const tmp = `pending-${n}`
        dispatch({
          type: 'create',
          session: {
            id: tmp,
            title: titleFromPrompt(prompt),
            repo: repo === NO_REPO ? NO_REPO : repo,
            branch: '',
            status: 'running',
            group: 'Today',
            updated: 'now',
            acus: 0,
            mode: s.mode,
            events: [
              { kind: 'user', id: `${tmp}-u`, text: prompt, at: 'now' },
              { kind: 'work', id: 'w-live', seconds: 0, steps: [], open: false, active: true },
            ],
            live: { url: '', statusDetail: 'working', prs: [], parentId: null, childIds: [], updatedAt: Date.now() / 1000, loaded: true },
          },
        })
        setDraft('')
        setTimeout(() => setAttach({}), 0)
        client
          .createSession(kindRef.current === 'ask' ? `Answer this question only. Don't change code or open pull requests.\n\n${prompt}` : prompt, {
            mode: s.mode,
            repos: repo !== NO_REPO ? [repo] : undefined,
            playbookId: attachRef.current.playbook?.id,
            sessionLinks: attachRef.current.links?.map((l) => l.url),
            tags: kindRef.current === 'ask' ? ['devin-tui', 'ask'] : undefined,
          })
          .then((api) => dispatch({ type: 'rekey', from: tmp, session: fromApi(api) }))
          .catch((error: Error) => {
            dispatch({ type: 'patch', id: tmp, patch: { status: 'failed' } })
            dispatch({ type: 'append', sessionId: tmp, event: { kind: 'devin', id: `${tmp}-err`, md: `Couldn’t start the session: ${error.message}` } })
          })
        return
      }
      const id = `new-${n}-${slugify(prompt).slice(0, 12)}`
      const session: Session = {
        id,
        title: titleFromPrompt(prompt),
        repo,
        branch: `devin/${slugify(titleFromPrompt(prompt)).slice(0, 24)}`,
        status: 'running',
        group: 'Today',
        updated: 'now',
        acus: 0.1,
        mode: s.mode,
        events: [{ kind: 'user', id: `${id}-u`, text: prompt, at: 'Just now' }],
      }
      dispatch({ type: 'create', session })
      setDraft('')
      schedule(id, buildRun(prompt, repo, n))
    },
    [client, schedule],
  )

  const launched = useRef(false)
  useEffect(() => {
    if (launched.current || !initialPrompt) return
    launched.current = true
    createSession(initialPrompt, stateRef.current.repo)
  }, [initialPrompt, createSession])

  const submit = useCallback(
    (text: string) => {
      const prompt = text.trim()
      if (!prompt) return
      const s = stateRef.current
      const current = s.sessions.find((x) => x.id === s.selectedId)
      if (!current) {
        createSession(prompt, s.repo)
        return
      }
      const n = ++runCount.current
      setDraft('')
      if (client && current.live) {
        dispatch({ type: 'append', sessionId: current.id, event: { kind: 'user', id: `local-${n}`, text: prompt, at: 'now' } })
        dispatch({ type: 'patch', id: current.id, patch: { status: 'running' } })
        client.sendMessage(current.id, prompt).catch((error: Error) => {
          dispatch({ type: 'append', sessionId: current.id, event: { kind: 'devin', id: `local-err-${n}`, md: `Couldn’t send: ${error.message}` } })
        })
        return
      }
      dispatch({ type: 'append', sessionId: current.id, event: { kind: 'user', id: `fu-${n}`, text: prompt, at: 'Just now' } })
      schedule(current.id, buildFollowUp(prompt, current, n))
    },
    [client, createSession, schedule],
  )

  const rootRef = useRef<PublicInstance | null>(null)
  const lastKeystroke = useRef<number | undefined>(undefined)
  const select = useCallback(
    (id: string | null) => {
      dispatch({ type: 'select', id })
      setView('home')
      setRenaming(false)
      if (rootRef.current) renderer?.focusElement?.(rootRef.current.id)
    },
    [renderer],
  )
  const onToggleWork = useCallback((sessionId: string, workId: string) => dispatch({ type: 'toggle-work', sessionId, workId }), [])
  const newSession = useCallback(() => {
    dispatch({ type: 'select', id: null })
    setView('home')
    focusComposer()
  }, [focusComposer])
  const toggleTheme = useCallback(() => {
    setThemeName((t) => {
      const next: ThemeName = t === 'dark' ? 'light' : 'dark'
      setTheme(next)
      return next
    })
  }, [])

  const onKey = useRef<(event: KeyEvent, r: NativeRenderer) => void>(() => {})
  useEffect(() => {
    const forward = (event: KeyEvent, r: NativeRenderer) => onKey.current(event, r)
    windowKeyHandler = forward
    return () => {
      if (windowKeyHandler === forward) windowKeyHandler = null
    }
  }, [])
  onKey.current = (event, r) => {
    const key = event.key
    if (event.keystrokeId === lastKeystroke.current) return
    lastKeystroke.current = event.keystrokeId
    const mod = event.modifiers?.cmd || event.modifiers?.ctrl
    const shift = event.modifiers?.shift
    const focused = r.getFocusedElementId?.()
    if (mod && key === 'k') {
      event.preventDefault()
      if (searchRef.current) r.focusElement?.(searchRef.current.id)
      return
    }
    if (mod && (key === 'n' || (shift && key === 'o'))) {
      event.preventDefault()
      newSession()
      return
    }
    if (mod && shift && key === 'l') {
      event.preventDefault()
      toggleTheme()
      return
    }
    if (mod && (key === '=' || key === '+' || key === '-' || key === '0')) {
      event.preventDefault()
      changeZoom(key === '0' ? 1 : stepZoom(getZoom(), key === '-' ? -1 : 1))
      return
    }
    if (mod && key === ',') {
      event.preventDefault()
      setView('settings')
      return
    }
    if (mod && key === 'b') {
      event.preventDefault()
      setSidebarHidden((h) => !h)
      return
    }
    if (mod && key === '.') {
      event.preventDefault()
      dispatch({ type: 'panel', open: !stateRef.current.panelOpen })
      return
    }
    if (key === 'escape') {
      if (focused != null && focused === searchRef.current?.id) {
        dispatch({ type: 'search', value: '' })
        r.blur?.()
      } else if (viewRef.current !== 'home') setView('home')
      return
    }
    if ((key === 'up' || key === 'down') && focused !== composerRef.current?.id && viewRef.current === 'home') {
      const list = filterSessions(stateRef.current.sessions, stateRef.current.search)
      if (list.length === 0) return
      const idx = list.findIndex((s) => s.id === stateRef.current.selectedId)
      const next = idx < 0 ? 0 : Math.max(0, Math.min(list.length - 1, idx + (key === 'down' ? 1 : -1)))
      event.preventDefault()
      dispatch({ type: 'select', id: list[next]!.id })
    }
  }

  kindRef.current = kind
  const sessionUrl = (x: Session) => x.live?.url || `${WEB}/sessions/${x.id.replace(/^devin-/, '')}`
  const attachPlaybook = (pb: ApiPlaybook) => {
    setAttach((a) => ({ ...a, playbook: { id: pb.playbook_id, title: pb.title } }))
    if (stateRef.current.selectedId || viewRef.current !== 'home') newSession()
  }
  const linkSession = (x: Session) => {
    setAttach((a) => ({ ...a, links: [...(a.links ?? []).filter((l) => l.url !== sessionUrl(x)), { url: sessionUrl(x), title: x.title }] }))
    if (stateRef.current.selectedId) newSession()
  }
  const plusMenu: MenuAction[] = [
    { id: 'h-repo', label: 'Repositories', header: true },
    ...repos.slice(0, 6).map((r) => ({ id: `repo:${r}`, label: r, icon: 'folder' as IconName, hint: state.repo === r ? '✓' : undefined, run: () => dispatch({ type: 'repo', repo: r }) })),
    ...(playbooks.length ? [{ id: 'h-pb', label: 'Playbooks', header: true }] : []),
    ...playbooks.slice(0, 6).map((pb) => ({ id: `pb:${pb.playbook_id}`, label: pb.title, icon: 'library' as IconName, hint: pb.macro ?? undefined, run: () => attachPlaybook(pb) })),
    { id: 'h-s', label: 'Link a Devin session', header: true },
    ...byRecent(state.sessions)
      .filter((x) => !x.id.startsWith('pending-'))
      .slice(0, 5)
      .map((x) => ({ id: `s:${x.id}`, label: x.title, icon: 'link' as IconName, run: () => linkSession(x) })),
    { id: 'h-more', label: 'More', header: true },
    { id: 'knowledge', label: 'Knowledge & playbooks', icon: 'shapes', run: () => setView('customize') },
    { id: 'secrets', label: 'Secrets', icon: 'shield', run: () => setView('security') },
  ]
  const slashMenu: MenuAction[] = [
    { id: 'h-c', label: 'Commands', header: true },
    { id: 'new', label: '/new', hint: 'New session', icon: 'plus', run: newSession },
    { id: 'ask', label: kind === 'ask' ? '/agent' : '/ask', hint: kind === 'ask' ? 'Back to Agent' : 'Question only, no code', icon: 'help', run: () => setKind((k) => (k === 'ask' ? 'agent' : 'ask')) },
    { id: 'theme', label: '/theme', hint: themeName === 'dark' ? 'Light mode' : 'Dark mode', icon: themeName === 'dark' ? 'sun' : 'moon', run: toggleTheme },
    { id: 'automate', label: '/automate', hint: 'Schedule this', icon: 'clock', run: () => setView('automations') },
    { id: 'review', label: '/review', hint: 'Review a PR', icon: 'pr', run: () => setView('review') },
    { id: 'settings', label: '/settings', hint: '⌘,', icon: 'settings', run: () => setView('settings') },
    ...(playbooks.some((p) => p.macro) ? [{ id: 'h-p', label: 'Playbooks', header: true }] : []),
    ...playbooks
      .filter((p) => p.macro)
      .slice(0, 8)
      .map((p) => ({ id: `m:${p.playbook_id}`, label: p.macro!, hint: p.title, icon: 'zap' as IconName, run: () => attachPlaybook(p) })),
  ]
  const chips = [
    ...(attach.playbook ? [{ id: 'playbook', label: `Playbook · ${attach.playbook.title}`, icon: 'library' as IconName, onRemove: () => setAttach((a) => ({ ...a, playbook: undefined })) }] : []),
    ...(attach.links ?? []).map((l, i) => ({ id: `link-${i}`, label: `Linked · ${l.title}`, icon: 'link' as IconName, onRemove: () => setAttach((a) => ({ ...a, links: (a.links ?? []).filter((x) => x.url !== l.url) })) })),
    ...(kind === 'ask' ? [{ id: 'ask', label: 'Ask · no code changes', icon: 'help' as IconName, onRemove: () => setKind('agent') }] : []),
  ]
  const sessionMenu: MenuAction[] = selected
    ? [
        { id: 'copy', label: 'Copy session link', icon: 'link', run: () => (copyText(sessionUrl(selected)), notify('Session link copied')) },
        { id: 'open', label: 'Open in Devin web app', icon: 'external', run: () => openUrl(sessionUrl(selected)) },
        ...(selected.live?.prs[0] ? [{ id: 'pr', label: 'Open pull request', icon: 'pr' as IconName, run: () => openUrl(selected.live!.prs[0]!.url) }] : []),
        { id: 'child', label: 'New linked session', icon: 'plus', run: () => linkSession(selected) },
        { id: 'h-e', label: 'Manage', header: true },
        { id: 'rename', label: 'Rename', icon: 'pencil', run: () => setRenaming(true) },
        { id: 'archive', label: 'Archive', icon: 'archive', run: () => archive(selected) },
        ...(selected.status === 'running' || selected.status === 'blocked' ? [{ id: 'terminate', label: 'Stop session', icon: 'stop' as IconName, danger: true, run: () => terminate(selected) }] : []),
      ]
    : []
  const archive = (x: Session) => {
    const done = () => {
      dispatch({ type: 'remove', id: x.id })
      notify(`Archived “${x.title}”`)
    }
    if (client?.archiveSession && x.live) client.archiveSession(x.id).then(done).catch((e: Error) => notify(e.message, true))
    else done()
  }
  const terminate = (x: Session) => {
    const done = () => {
      dispatch({ type: 'patch', id: x.id, patch: { status: 'sleeping' } })
      notify(`Stopped “${x.title}”`)
    }
    if (client?.terminateSession && x.live) client.terminateSession(x.id).then(done).catch((e: Error) => notify(e.message, true))
    else done()
  }
  const rename = (t: string | null) => {
    setRenaming(false)
    if (!t || !selected) return
    dispatch({ type: 'patch', id: selected.id, patch: { title: t } })
    updatePrefs({ titles: { ...(prefs.titles ?? {}), [selected.id]: t } })
    notify('Renamed (saved on this machine)')
  }
  const notifs = useMemo(() => notificationsFor(state.sessions, prefs.readAt ?? 0), [state.sessions, prefs.readAt])
  const unread = notifs.filter((n) => n.unread).length
  const openSettings = (page?: string) => {
    if (page) setSettingsReq((r) => ({ n: r.n + 1, page }))
    setView('settings')
  }
  const changeZoom = (z: number) => {
    setZoom(z)
    setZoomState(getZoom())
    updatePrefs({ zoom: getZoom() })
  }
  const fontTracker = useRef<TerminalFontTracker | null>(null)
  useEffect(() => {
    if (!followTerminalFont) return
    const grid = readTerminalGrid()
    const cell = grid && cellSize({ width: rawWidth, height: rawHeight }, grid)
    if (!cell) return
    if (!fontTracker.current) {
      fontTracker.current = new TerminalFontTracker(cell)
      return
    }
    const change = fontTracker.current.update(cell)
    if (change) changeZoom(applyFontChange(getZoom(), change))
  }, [followTerminalFont, rawWidth, rawHeight])
  const navigate = (v: View, tab?: string) => {
    if (v === 'customize' && (tab === 'knowledge' || tab === 'playbooks')) setCustomizeTab(tab)
    if (v === 'sessions') setSessionsTab((s) => ({ filter: (tab as SessionsFilter) ?? 'all', n: s.n + 1 }))
    setView(v)
  }
  const viewEl =
    view === 'sessions' ? (
      <SessionsView
        key={sessionsTab.n}
        sessions={byRecent(state.sessions)}
        api={client}
        fromApi={fromApi}
        initialFilter={sessionsTab.filter}
        narrow={tiny}
        onOpen={(id) => (setView('home'), select(id))}
        onUnarchived={(s) => (dispatch({ type: 'unhide', id: s.id }), dispatch({ type: 'merge', sessions: [s] }))}
      />
    ) : view === 'environment' ? (
      <EnvironmentView api={client} narrow={tiny} />
    ) : view === 'usage' ? (
      <UsageView api={client} narrow={tiny} />
    ) : view === 'repos' ? (
      <ReposView
        api={client}
        narrow={tiny}
        onStart={(repo) => {
          setExtraRepos((r) => (r.includes(repo) ? r : [...r, repo]))
          dispatch({ type: 'repo', repo })
          newSession()
        }}
      />
    ) : view === 'automations' ? (
      <AutomationsView api={client} narrow={tiny} />
    ) : view === 'security' ? (
      <SecurityView api={client} sessions={state.sessions} narrow={tiny} />
    ) : view === 'review' ? (
      <ReviewView
        sessions={byRecent(state.sessions)}
        narrow={tiny}
        onOpenSession={select}
        onReview={(url) => {
          newSession()
          createSession(`Review this pull request and point out bugs, risky changes and missing tests: ${url}`, NO_REPO)
        }}
      />
    ) : view === 'customize' ? (
      <CustomizeView api={client} tab={customizeTab} onTab={setCustomizeTab} onUsePlaybook={attachPlaybook} narrow={tiny} />
    ) : view === 'notifications' ? (
      <NotificationsView items={notifs} onOpen={select} onMarkAll={() => updatePrefs({ readAt: Math.floor(Date.now() / 1000) })} narrow={tiny} />
    ) : view === 'settings' ? (
      <SettingsView
        key={settingsReq.n}
        instance={settingsReq.n}
        initialPage={settingsReq.page ?? (settingsReq.n === 0 ? initialSettingsPage : undefined)}
        keySource={keySource}
        onSaveKey={onSaveKey}
        onRemoveKey={onRemoveKey}
        verifyKey={verifyKey}
        api={client}
        orgId={orgId}
        baseUrl={baseUrl}
        keyHint={keyHint}
        zoom={zoom}
        onZoom={changeZoom}
        themeName={themeName}
        onTheme={(t) => {
          if (t !== themeName) toggleTheme()
          updatePrefs({ theme: t })
        }}
        mode={state.mode}
        modes={MODES.map((m) => ({ value: m.value, label: m.label }))}
        onMode={(m) => {
          dispatch({ type: 'mode', mode: m as AgentMode })
          updatePrefs({ mode: m })
        }}
        repo={state.repo}
        repos={repos}
        onRepo={(r) => {
          dispatch({ type: 'repo', repo: r })
          updatePrefs({ repo: r })
        }}
        onNavigate={navigate}
        renamedCount={Object.keys(prefs.titles ?? {}).length}
        onResetTitles={() => updatePrefs({ titles: {} })}
        narrow={compact}
      />
    ) : null

  const composer: ComposerProps = {
    draft,
    setDraft,
    onSubmit: submit,
    mode: state.mode,
    onMode: (mode: AgentMode) => dispatch({ type: 'mode', mode }),
    composerRef,
    placeholder: kind === 'ask' ? 'Ask a question about your code' : PLACEHOLDER,
    plusMenu,
    slashMenu,
  }

  const showSidebar = !tiny && !sidebarHidden
  const leading =
    tiny || sidebarHidden ? (
      <>
        {!tiny && <IconButton icon="panelLeft" testId="show-sidebar" tip="Show sidebar" kbd="⌘B" onClick={() => setSidebarHidden(false)} />}
        {tiny && <IconButton icon="list" testId="open-sessions" tip="Sessions" onClick={() => navigate('sessions')} />}
        {tiny && <IconButton icon="compose" testId="tiny-new" tip="New session" onClick={newSession} />}
      </>
    ) : null
  const pageBar = (tiny || sidebarHidden) && (view !== 'home' || !selected)

  return (
    <div
      key={`${themeName}-${zoom}`}
      ref={rootRef}
      tabIndex={-1}
      autoFocus
      onKeyDown={(event) => renderer && onKey.current(event, renderer)}
      style={{ ...row({ alignItems: 'stretch' }), width: '100%', height: '100%', backgroundColor: C.canvas, fontFamily: SANS }}
    >
      {showSidebar && (
        <Sidebar
          width={compact ? SIDEBAR_COMPACT : SIDEBAR_WIDTH}
          state={state}
          visible={visible}
          onSelect={select}
          onNew={newSession}
          onSearch={(value) => dispatch({ type: 'search', value })}
          searchRef={searchRef}
          themeName={themeName}
          onToggleTheme={toggleTheme}
          live={live}
          liveError={liveError}
          limit={pageSize}
          onLoadMore={() => setPageSize((n) => n + 40)}
          userName={userName}
          view={view}
          onNav={navigate}
          notifCount={unread}
          onHideSidebar={() => setSidebarHidden(true)}
          onShortcuts={() => openSettings('shortcuts')}
          onApiSettings={() => openSettings('api')}
        />
      )}
      <div style={{ ...col(), flexGrow: 1, minWidth: 0, height: '100%' }}>
        {pageBar && (
          <div style={{ ...row({ gap: 2 }), height: 44, paddingLeft: 8, flexShrink: 0, borderBottomWidth: view === 'home' ? 0 : 1, borderColor: C.border }}>
            {leading}
            {view !== 'home' && <IconButton icon="arrowLeft" testId="back-home" tip="Back" onClick={() => setView('home')} />}
          </div>
        )}
        {view !== 'home' ? (
          viewEl
        ) : selected ? (
          <>
            <SessionHeader
              key={`${selected.id}-${renaming}`}
              compact={compact}
              tiny={tiny}
              leading={leading}
              session={selected}
              panelOpen={state.panelOpen}
              onTogglePanel={() => dispatch({ type: 'panel', open: !state.panelOpen })}
              menu={sessionMenu}
              onChecklist={() => dispatch({ type: 'panel', open: true, tab: selected.live ? 'details' : 'planner' })}
              renaming={renaming}
              onRename={rename}
            />
            <virtual-list key={selected.id} testId="transcript" alignment="top" followTail estimatedItemHeight={160} overdraw={600} style={{ flexGrow: 1, minHeight: 0, paddingTop: 16, paddingBottom: 12 }}>
              {selected.live && !selected.live.loaded && selected.events.length === 0
                ? [
                    <div key="loading" style={{ ...row({ justifyContent: 'center', gap: 8 }), height: 80 }}>
                      <StatusDot status="running" size={7} color={C.ghost} />
                      <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 13 }}>Loading conversation…</text>
                    </div>,
                  ]
                : selected.events.map((e) => <EventView key={e.id} event={e} sessionId={selected.id} onToggleWork={onToggleWork} narrow={tiny} />)}
            </virtual-list>
            <div style={{ ...col({ alignItems: 'center' }), paddingLeft: tiny ? 12 : 28, paddingRight: tiny ? 12 : 28, paddingTop: 4, paddingBottom: 16, flexShrink: 0 }}>
              <StatusFooter session={selected} />
              <Composer {...composer} />
            </div>
          </>
        ) : (
          <HomeView
            composer={{ ...composer, chips, repo: state.repo, repos, onRepo: (repo) => dispatch({ type: 'repo', repo }) }}
            kind={kind}
            onKind={setKind}
            onSuggest={(p) => {
              setDraft(p)
              focusComposer()
            }}
          />
        )}
      </div>
      {selected && view === 'home' && !compact && (
        <motion.div initial={false} animate={{ width: state.panelOpen ? panelWidth * zoom : 0 }} transition={{ duration: 0.25, ease: 'easeOut' }} style={{ height: '100%', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ ...col(), width: panelWidth, height: '100%', backgroundColor: C.canvas, borderLeftWidth: 1, borderColor: C.border }}>
            {selected.live ? (
              <LivePanel session={selected} sessions={state.sessions} tab={state.panelTab} onTab={(tab) => dispatch({ type: 'panel', tab })} onSelect={select} client={client} pollMs={pollMs} previews={previews} />
            ) : (
              <DemoPanel session={selected} tab={state.panelTab} onTab={(tab) => dispatch({ type: 'panel', tab })} />
            )}
          </div>
        </motion.div>
      )}
      {toast && (
        <div style={{ position: 'absolute', top: 60, left: 0, right: 0, ...row({ justifyContent: 'center' }), pointerEvents: 'none' }}>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} style={{ ...row({ gap: 8 }), height: 36, paddingLeft: 12, paddingRight: 14, borderRadius: 10, backgroundColor: C.sendBg, boxShadow: popoverShadow() }}>
            <Icon name={toast.error ? 'circleAlert' : 'circleCheck'} size={15} color={toast.error ? C.del : C.sendFg} />
            <text testId="toast" style={{ fontFamily: SANS, color: C.sendFg, fontSize: 13, fontWeight: 500 }}>{toast.text}</text>
          </motion.div>
        </div>
      )}
    </div>
  )
}
