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
  type StyleDesc,
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
  type Status,
  type Step,
  type TranscriptEvent,
} from './data'
import { byRecent, filterSessions, formatDuration, reducer, type PanelTab, type State } from './state'
import { Icon, type IconName } from './icons'
import { C, nativeTheme, setTheme, type ThemeName } from './theme'
import type { DevinApi } from './api'
import { eventsFromMessages, sessionFromApi, statusLine } from './live'
import type { ApiPlaybook, ApiSession } from './api'
import { ActionMenu, AutomationsView, Btn, copyText, CustomizeView, Field, notificationsFor, NotificationsView, ReviewView, SecurityView, SettingsView, useSticky, WEB, type MenuAction, type View } from './views'
import { clearQuarantine, originalPath, previewPath, shotsFrom, type PreviewDeps, type Shot } from './computer'
import { loadPrefs, savePrefs, type Prefs } from './prefs'
import { getZoom, setZoom, stepZoom } from './zoom/scale'
import { EnvironmentView, PrReview, ReposView, SessionExtras, SessionsView, UsageView, type SessionsFilter } from './more'

export { C }

const SANS = 'Inter'
const MONO = 'Menlo'
const SIDEBAR_WIDTH = 288
const SIDEBAR_COMPACT = 232
const PANEL_WIDTH = 400
const TRAFFIC_LIGHT_HEIGHT = 40
const NO_REPO = 'No repository'
const MAX_PAGES = 20
const CLEAR = '#00000000'
const PLACEHOLDER = 'Ask Devin to build features, fix bugs, or work on your code'

function statusColor(s: Status): string {
  return s === 'running' ? C.blue : s === 'blocked' ? C.orange : s === 'finished' ? C.add : s === 'failed' ? C.del : C.ghost
}

let urlOpener = (url: string) => {
  if (typeof Bun === 'undefined') return
  try {
    Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' })
  } catch {}
}
/** Swaps how links open (tests record them instead of launching a browser). */
export function setUrlOpener(fn: (url: string) => void) {
  urlOpener = fn
}
function openUrl(url: string) {
  if (url) urlOpener(url)
}

/** Window-level key handler; `app.tsx` forwards `render({ onKeyDown })` here. */
let windowKeyHandler: ((event: KeyEvent, renderer: NativeRenderer) => void) | null = null
export function handleWindowKey(event: KeyEvent, renderer: NativeRenderer) {
  windowKeyHandler?.(event, renderer)
}

const row = (extra: StyleDesc = {}): StyleDesc => ({ display: 'flex', flexDirection: 'row', alignItems: 'center', ...extra })
const col = (extra: StyleDesc = {}): StyleDesc => ({ display: 'flex', flexDirection: 'column', ...extra })

function StatusDot({ status, size = 8 }: { status: Status; size?: number }) {
  const [dim, setDim] = useState(false)
  const running = status === 'running'
  return (
    <motion.div
      initial={false}
      animate={{ opacity: running && dim ? 0.3 : 1 }}
      transition={{ duration: 0.8, ease: 'easeInOut' }}
      onMotionComplete={() => running && setDim((d) => !d)}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: statusColor(status), flexShrink: 0, pointerEvents: 'none' }}
    />
  )
}

function IconButton({
  icon,
  onClick,
  testId,
  active,
  size = 16,
  box = 30,
  color,
  dot,
}: {
  icon: IconName
  onClick?: () => void
  testId?: string
  active?: boolean
  size?: number
  box?: number
  color?: string
  dot?: boolean
}) {
  return (
    <Button
      testId={testId}
      onClick={onClick}
      style={{ ...row({ justifyContent: 'center' }), position: 'relative', width: box, height: box, borderRadius: 8, cursor: 'pointer', backgroundColor: active ? C.selected : CLEAR, hover: { backgroundColor: C.hover } }}
    >
      <Icon name={icon} size={size} color={color ?? (active ? C.text : C.tertiary)} />
      {dot && <div style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: C.del, pointerEvents: 'none' }} />}
    </Button>
  )
}

/* ───────────────────────────── Sidebar ───────────────────────────── */

type TreeRow = { session: Session; depth: number; hasChildren: boolean; open: boolean }

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
    out.push({ session: s, depth, hasChildren: children.length > 0, open })
    if (open && depth < 3) for (const c of children) walk(c, depth + 1)
  }
  for (const s of top) walk(s, 0)
  return out
}

function prCount(s: Session): number {
  return s.live ? s.live.prs.length : s.events.filter((e) => e.kind === 'pr').length
}

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
  const showDot = s.status === 'running' || blocked || s.status === 'failed'
  return (
    <div style={{ width: '100%', paddingLeft: 8, paddingRight: 8 }}>
    <div
      style={{
        ...row({ alignItems: 'start' }),
        width: '100%',
        paddingLeft: 4 + item.depth * 18,
        paddingRight: 10,
        borderRadius: 8,
        backgroundColor: selected ? C.selected : C.sidebar,
        hover: { backgroundColor: selected ? C.selected : C.hover },
      }}
    >
      <div
        testId={`expand-${s.id}`}
        onClick={item.hasChildren ? () => onToggle(s.id, !item.open) : undefined}
        style={{ ...row({ justifyContent: 'center' }), width: 20, height: 34, flexShrink: 0, cursor: item.hasChildren ? 'pointer' : 'default' }}
      >
        {item.hasChildren ? (
          <Icon name={item.open ? 'chevronDown' : 'chevronRight'} size={13} color={C.tertiary} />
        ) : item.depth > 0 ? (
          <div style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C.borderStrong }} />
        ) : null}
      </div>
      <div
        testId={`session-${s.id}`}
        onClick={() => onSelect(s.id)}
        style={{ ...row({ alignItems: 'start', gap: 8 }), flexGrow: 1, minWidth: 0, paddingTop: 7, paddingBottom: 7, paddingLeft: 2, cursor: 'pointer' }}
      >
        <div style={col({ flexGrow: 1, minWidth: 0, gap: 2, pointerEvents: 'none' })}>
          <text style={{ fontFamily: SANS, color: C.text, fontSize: 13.5, lineHeight: 18, fontWeight: selected ? 500 : 400, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {s.title}
          </text>
          <div style={row({ gap: 5, minWidth: 0 })}>
            {blocked ? (
              <text style={{ fontFamily: SANS, color: C.orange, fontSize: 12, lineHeight: 16, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {s.live ? 'Waiting for you' : STATUS_LABEL.blocked}
              </text>
            ) : (
              <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12, lineHeight: 16, whiteSpace: 'nowrap' }}>{s.updated}</text>
            )}
            {prs > 0 && <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12, lineHeight: 16 }}>·</text>}
            {prs > 0 && <Icon name="pr" size={11} color={C.tertiary} />}
            {prs > 0 && <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12, lineHeight: 16 }}>{String(prs)}</text>}
          </div>
        </div>
        {showDot && (
          <div style={{ paddingTop: 6, pointerEvents: 'none' }}>
            <StatusDot status={s.status} size={7} />
          </div>
        )}
      </div>
    </div>
    </div>
  )
})

function NavRow({ icon, label, hint, chevron, onClick, testId, active }: { icon: IconName; label: string; hint?: string; chevron?: boolean; onClick?: () => void; testId?: string; active?: boolean }) {
  return (
    <Button
      testId={testId}
      onClick={onClick}
      style={{ ...row({ gap: 11 }), height: 32, paddingLeft: 10, paddingRight: 10, marginLeft: 8, marginRight: 8, borderRadius: 8, cursor: 'pointer', backgroundColor: active ? C.selected : C.sidebar, hover: { backgroundColor: active ? C.selected : C.hover } }}
    >
      <Icon name={icon} size={16} color={C.secondary} />
      <text style={{ fontFamily: SANS, color: C.text, fontSize: 14, flexGrow: 1 }}>{label}</text>
      {hint && <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12 }}>{hint}</text>}
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
  const hasMore = live && !searching && allRows.filter((r) => r.depth === 0).length > limit
  const onToggle = useCallback((id: string, open: boolean) => setExpanded((e) => ({ ...e, [id]: open })), [])
  const running = state.sessions.filter((s) => s.status === 'running').length
  const macWindow = process.platform === 'darwin' && !isTerminal()
  const { renderer } = useGpuix()
  const narrow = width < SIDEBAR_WIDTH

  return (
    <div style={{ ...col(), width, height: '100%', flexShrink: 0, backgroundColor: C.sidebar, borderRightWidth: 1, borderColor: C.border }}>
      {macWindow && <div style={{ height: TRAFFIC_LIGHT_HEIGHT - 12, flexShrink: 0 }} />}
      <div style={row({ gap: 8, paddingLeft: 14, paddingRight: 8, height: 48, flexShrink: 0 })}>
        <div style={{ ...row({ justifyContent: 'center' }), width: 22, height: 22, borderRadius: 5, backgroundColor: C.selected, flexShrink: 0 }}>
          <text style={{ fontFamily: SANS, color: C.secondary, fontSize: 12, fontWeight: 600 }}>{userName.slice(0, 1).toUpperCase()}</text>
        </div>
        <text style={{ fontFamily: SANS, color: C.text, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>{userName}</text>
        <Icon name="chevronDown" size={13} color={C.tertiary} />
        <div style={{ flexGrow: 1 }} />
        <IconButton icon="search" testId="search-button" onClick={() => searchRef.current && renderer?.focusElement?.(searchRef.current.id)} />
        {!narrow && <IconButton icon="bell" testId="bell" dot={notifCount > 0} active={view === 'notifications'} onClick={() => onNav('notifications')} />}
        {!narrow && <IconButton icon="panelLeft" testId="hide-sidebar" onClick={onHideSidebar} />}
      </div>
      <div style={{ ...col({ gap: 1 }), flexShrink: 0 }}>
        <NavRow icon="plus" label="New session" hint="⇧⌘O" onClick={onNew} testId="new-session" active={state.selectedId === null && view === 'home'} />
        <NavRow icon="clock" label="Automations" testId="nav-automations" onClick={() => onNav('automations')} active={view === 'automations'} />
        <NavRow icon="shield" label="Security" testId="nav-security" onClick={() => onNav('security')} active={view === 'security'} />
        <NavRow icon="pr" label="Review" testId="nav-review" onClick={() => onNav('review')} active={view === 'review'} />
        <NavRow icon="shapes" label="Customize" testId="nav-customize" onClick={() => onNav('customize')} active={view === 'customize'} />
        <ActionMenu
          testId="nav-more"
          side="right"
          triggerStyle={{ justifyContent: 'flex-start', gap: 11, width: narrow ? width - 16 : SIDEBAR_WIDTH - 16, height: 32, paddingLeft: 10, paddingRight: 10, marginLeft: 8 }}
          items={[
            { id: 'sessions', label: 'All sessions', icon: 'list', run: () => onNav('sessions') },
            { id: 'usage', label: 'Usage', icon: 'zap', run: () => onNav('usage') },
            { id: 'repos', label: 'Repositories', icon: 'folder', run: () => onNav('repos') },
            { id: 'environment', label: 'Environment', icon: 'laptop', run: () => onNav('environment') },
            { id: 'wiki', label: 'DeepWiki', icon: 'library', run: () => openUrl(`${WEB}/wiki`) },
            { id: 'oncall', label: 'Oncall', icon: 'bell', run: () => openUrl(`${WEB}/oncall`) },
            { id: 'web', label: 'Open app.devin.ai', icon: 'share', run: () => openUrl(WEB) },
            { id: 'docs', label: 'Documentation', icon: 'help', run: () => openUrl('https://docs.devin.ai') },
          ]}
        >
          <Icon name="more" size={16} color={C.secondary} />
          <text style={{ fontFamily: SANS, color: C.text, fontSize: 14, flexGrow: 1 }}>More</text>
          <Icon name="chevronRight" size={13} color={C.ghost} />
        </ActionMenu>
      </div>
      <div style={row({ paddingLeft: 16, paddingRight: 8, marginTop: 16, height: 30, flexShrink: 0, gap: 8 })}>
        <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 13.5, fontWeight: 500, flexGrow: 1 }}>Sessions</text>
        <IconButton icon="plus" size={15} box={26} onClick={onNew} testId="sessions-new" />
        {!narrow && <IconButton icon="sliders" size={15} box={26} onClick={() => onNav('sessions', 'all')} testId="sessions-filter-open" />}
        {!narrow && (
          <ActionMenu
            testId="sessions-menu"
            items={[
              { id: 'collapse', label: 'Collapse all', icon: 'chevronRight', run: () => setExpanded({}) },
              { id: 'expand', label: 'Expand all', icon: 'chevronDown', run: () => setExpanded(Object.fromEntries(state.sessions.filter((x) => x.live?.childIds.length).map((x) => [x.id, true]))) },
              { id: 'all', label: 'View all sessions', icon: 'list', run: () => onNav('sessions', 'all') },
              { id: 'archived', label: 'Archived sessions', icon: 'folder', run: () => onNav('sessions', 'archived') },
              { id: 'notifications', label: 'Notifications', icon: 'bell', run: () => onNav('notifications') },
              { id: 'web', label: 'Open sessions on web', icon: 'share', run: () => openUrl(WEB) },
            ]}
          >
            <Icon name="more" size={15} color={C.tertiary} />
          </ActionMenu>
        )}
      </div>
      <div style={{ ...row({ gap: 8 }), marginLeft: 8, marginRight: 8, marginTop: 4, marginBottom: 6, height: 30, paddingLeft: 10, paddingRight: 8, borderRadius: 8, backgroundColor: C.hover, flexShrink: 0 }}>
        <Icon name="search" size={13} color={C.ghost} />
        <input
          ref={searchRef}
          testId="search"
          value={state.search}
          placeholder="Search sessions"
          onChange={(e) => onSearch(e.value ?? '')}
          style={{ flexGrow: 1, minWidth: 0, height: 28, fontSize: 13, color: C.text, backgroundColor: C.hover, fontFamily: SANS }}
          theme={{ caret: C.text, textMuted: C.ghost }}
        />
        <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 11 }}>⌘K</text>
      </div>
      <virtual-list testId="session-list" estimatedItemHeight={50} overdraw={400} style={{ flexGrow: 1, minHeight: 0, paddingBottom: 8 }}>
        {[
          ...(rows.length === 0
            ? [
                <div key="empty" style={{ padding: 18 }}>
                  <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5 }}>
                    {searching ? `No sessions match “${state.search}”` : live ? (liveError ? 'Couldn’t reach the Devin API' : 'Loading sessions…') : 'No sessions yet'}
                  </text>
                </div>,
              ]
            : rows.map((r) => <SessionRow key={r.session.id} item={r} selected={r.session.id === state.selectedId} onSelect={onSelect} onToggle={onToggle} />)),
          ...(live && hasMore && !searching
            ? [
                <div key="more" testId="load-more" onClick={onLoadMore} style={{ marginLeft: 8, marginRight: 8, paddingLeft: 24, height: 34, ...row(), borderRadius: 8, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
                  <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 13 }}>Load more…</text>
                </div>,
              ]
            : []),
        ]}
      </virtual-list>
      {liveError && (
        <div style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 6 }}>
          <text style={{ fontFamily: SANS, color: C.del, fontSize: 11.5, lineHeight: 15 }}>{liveError}</text>
        </div>
      )}
      <div style={{ ...row({ gap: 2 }), paddingLeft: 10, paddingRight: 10, height: 44, flexShrink: 0 }}>
        <ActionMenu
          testId="help"
          side="top"
          items={[
            { id: 'source', label: live ? 'Live · api.devin.ai' : 'Demo data', header: true },
            { id: 'docs', label: 'Documentation', icon: 'library', run: () => openUrl('https://docs.devin.ai') },
            { id: 'api', label: 'API reference', icon: 'zap', run: () => openUrl('https://docs.devin.ai/api-reference/overview') },
            { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'list', run: onShortcuts },
            { id: 'release', label: 'Release notes', icon: 'sparkle', run: () => openUrl('https://docs.devin.ai/release-notes/overview') },
          ]}
        >
          <Icon name="help" size={17} color={C.tertiary} />
        </ActionMenu>
        <IconButton icon="settings" size={17} testId="settings" active={view === 'settings'} onClick={() => onNav('settings')} />
        <div style={{ flexGrow: 1 }} />
        <text testId="session-count" style={{ fontFamily: SANS, color: C.ghost, fontSize: 11.5, marginRight: 4, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>
          {narrow ? `${running} running` : `${state.sessions.length} sessions · ${running} running`}
        </text>
        <IconButton icon={themeName === 'dark' ? 'sun' : 'moon'} size={16} testId="theme-toggle" onClick={onToggleTheme} />
      </div>
    </div>
  )
}

/* ───────────────────────────── Transcript ───────────────────────────── */

/** Avatar + name + time above each message, like the web app's transcript. */
function Sender({ who, name, time, children }: { who: 'user' | 'devin'; name?: string; time?: string; children: React.ReactNode }) {
  return (
    <div style={row({ gap: 10, alignItems: 'flex-start' })}>
      {who === 'devin' ? (
        <div style={{ ...row({ justifyContent: 'center' }), width: 24, height: 24, borderRadius: 6, backgroundColor: C.text, flexShrink: 0 }}>
          <Icon name="devin" size={14} color={C.canvas} />
        </div>
      ) : (
        <div style={{ ...row({ justifyContent: 'center' }), width: 24, height: 24, borderRadius: 12, backgroundColor: C.selected, flexShrink: 0 }}>
          <text style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 600, color: C.secondary }}>{(name || 'You')[0]!.toUpperCase()}</text>
        </div>
      )}
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
      <div style={{ maxWidth: '100%', paddingLeft: 13, paddingRight: 13, paddingTop: 9, paddingBottom: 9, borderRadius: 12, backgroundColor: C.userBubble }}>
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

function PlanCard({ items }: { items: PlanItem[] }) {
  const done = items.filter((i) => i.done).length
  return (
    <div style={{ ...col(), borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <div style={{ ...row({ gap: 8 }), paddingLeft: 14, paddingRight: 14, height: 36, borderBottomWidth: 1, borderColor: C.border }}>
        <Icon name="listChecks" size={14} color={C.secondary} />
        <text style={{ fontFamily: SANS, color: C.text, fontSize: 13, fontWeight: 500, flexGrow: 1 }}>Plan</text>
        <text testId="plan-progress" style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12 }}>{`${done}/${items.length} done`}</text>
      </div>
      <div style={col({ gap: 8, paddingLeft: 14, paddingRight: 14, paddingTop: 11, paddingBottom: 13 })}>
        {items.map((item, i) => (
          <div key={i} style={row({ gap: 10 })}>
            <div style={{ ...row({ justifyContent: 'center' }), width: 16, height: 16, borderRadius: 8, borderWidth: item.done ? 0 : 1.5, borderColor: C.borderStrong, backgroundColor: item.done ? C.text : C.card }}>
              {item.done && <Icon name="check" size={10} color={C.canvas} />}
            </div>
            <text style={{ fontFamily: SANS, color: item.done ? C.tertiary : C.text, fontSize: 13.5 }}>{item.text}</text>
          </div>
        ))}
      </div>
    </div>
  )
}

function CardHeader({ icon, children, right }: { icon: IconName; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ ...row({ gap: 8 }), paddingLeft: 12, paddingRight: 12, height: 34, backgroundColor: C.cardHead, borderBottomWidth: 1, borderColor: C.border }}>
      <Icon name={icon} size={13} color={C.tertiary} />
      <div style={{ ...row({ gap: 6 }), flexGrow: 1, minWidth: 0 }}>{children}</div>
      {right}
    </div>
  )
}

function ShellCard({ step }: { step: Extract<Step, { kind: 'shell' }> }) {
  const exitColor = step.exit === undefined ? C.blue : step.exit === 0 ? C.add : C.del
  return (
    <div style={{ ...col(), borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <CardHeader icon="laptop" right={<text style={{ color: exitColor, fontSize: 11.5, fontFamily: MONO }}>{step.exit === undefined ? 'running…' : `exit ${step.exit}`}</text>}>
        <text style={{ color: C.ghost, fontSize: 12, fontFamily: MONO }}>$</text>
        <text style={{ color: C.text, fontSize: 12, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{step.cmd}</text>
      </CardHeader>
      {step.output.length > 0 && (
        <code code={step.output} language="log" theme={nativeTheme()} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 9, paddingBottom: 10, fontSize: 12, lineHeight: 17, color: C.secondary, fontFamily: MONO }} />
      )}
    </div>
  )
}

function EditCard({ step }: { step: Extract<Step, { kind: 'edit' }> }) {
  return (
    <div style={{ ...col(), borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <CardHeader
        icon="pencil"
        right={
          <div style={row({ gap: 6 })}>
            <text style={{ color: C.add, fontSize: 11.5, fontFamily: MONO }}>{`+${step.additions}`}</text>
            <text style={{ color: C.del, fontSize: 11.5, fontFamily: MONO }}>{`-${step.deletions}`}</text>
          </div>
        }
      >
        <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12 }}>Edited</text>
        <text style={{ color: C.text, fontSize: 12, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{step.path}</text>
      </CardHeader>
      <diff patch={step.patch} wordDiff maxLines={28} theme={nativeTheme()} style={{ fontSize: 12 }} />
    </div>
  )
}

function BrowserCard({ step, large }: { step: Extract<Step, { kind: 'browser' }>; large?: boolean }) {
  return (
    <div style={{ ...col(), borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <div style={{ ...row({ gap: 8 }), paddingLeft: 10, paddingRight: 10, height: 34, backgroundColor: C.cardHead, borderBottomWidth: 1, borderColor: C.border }}>
        <Icon name="arrowLeft" size={12} color={C.ghost} />
        <Icon name="arrowRight" size={12} color={C.ghost} />
        <Icon name="retry" size={11} color={C.ghost} />
        <div style={{ ...row(), flexGrow: 1, minWidth: 0, height: 22, paddingLeft: 9, borderRadius: 6, backgroundColor: C.canvas, borderWidth: 1, borderColor: C.border }}>
          <text style={{ color: C.secondary, fontSize: 11.5, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{step.url}</text>
        </div>
      </div>
      <div style={{ ...col({ gap: 10 }), padding: 14, backgroundColor: '#f6f7f9', height: large ? 280 : undefined }}>
        <div style={row({ gap: 8 })}>
          <div style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: '#1f2937' }} />
          <text style={{ fontFamily: SANS, color: '#111827', fontSize: 13, fontWeight: 600 }}>{step.title}</text>
        </div>
        <div style={row({ gap: 8 })}>
          {[0.9, 0.55, 0.7].map((w, i) => (
            <div key={i} style={{ height: 34, flexGrow: w, borderRadius: 6, backgroundColor: i === 1 ? '#2f6fde' : '#e5e7eb' }} />
          ))}
        </div>
        <div style={{ height: 8, width: '70%', borderRadius: 4, backgroundColor: '#d1d5db' }} />
        <div style={{ height: 8, width: '45%', borderRadius: 4, backgroundColor: '#d1d5db' }} />
      </div>
      <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 9, borderTopWidth: 1, borderColor: C.border }}>
        <text style={{ fontFamily: SANS, color: C.secondary, fontSize: 12.5, lineHeight: 18 }}>{step.note}</text>
      </div>
    </div>
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
        style={{ ...row({ gap: 7 }), alignSelf: 'start', height: 26, paddingLeft: 4, paddingRight: 8, marginLeft: -4, borderRadius: 6, cursor: expandable ? 'pointer' : 'default', hover: { backgroundColor: expandable ? C.hover : C.canvas } }}
      >
        <Icon name={event.open ? 'chevronDown' : 'chevronRight'} size={13} color={C.ghost} />
        {event.active && <StatusDot status="running" size={7} />}
        <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 13.5 }}>{label}</text>
        {expandable && <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 13 }}>{`· ${event.steps.length} ${event.steps.length === 1 ? 'step' : 'steps'}`}</text>}
      </div>
      {event.open && (
        <div style={{ ...col({ gap: 10 }), paddingLeft: 14, borderLeftWidth: 1, borderColor: C.border }}>
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
    <div style={{ ...row({ justifyContent: 'center' }), width: 14, height: 14, borderRadius: 7, backgroundColor: state === 'pending' ? C.card : color, borderWidth: state === 'pending' ? 2 : 0, borderColor: color }}>
      {state === 'pass' && <Icon name="check" size={9} color="#ffffff" />}
    </div>
  )
}

function PRCard({ event }: { event: Extract<TranscriptEvent, { kind: 'pr' }> }) {
  const passed = event.checks.filter((c) => c.state === 'pass').length
  const merged = event.state === 'merged'
  return (
    <div testId={`pr-${event.number}`} style={{ ...col(), borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <div style={col({ gap: 6, paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 12 })}>
        <div style={row({ gap: 8 })}>
          <Icon name={merged ? 'merge' : 'pr'} size={15} color={merged ? C.blue : C.add} />
          <text style={{ fontFamily: SANS, color: C.text, fontSize: 14, fontWeight: 600, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{event.title}</text>
          <div style={{ ...row(), height: 22, paddingLeft: 9, paddingRight: 9, borderRadius: 11, backgroundColor: C.chip }}>
            <text style={{ fontFamily: SANS, color: C.chipText, fontSize: 11.5, fontWeight: 500 }}>{merged ? 'Merged' : 'Open'}</text>
          </div>
        </div>
        <div style={row({ gap: 8 })}>
          <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5 }}>{`${event.repo} #${event.number}`}</text>
          <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5 }}>·</text>
          <text style={{ color: C.tertiary, fontSize: 12, fontFamily: MONO }}>{event.branch}</text>
          <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5 }}>·</text>
          <text style={{ color: C.add, fontSize: 12, fontFamily: MONO }}>{`+${event.additions}`}</text>
          <text style={{ color: C.del, fontSize: 12, fontFamily: MONO }}>{`-${event.deletions}`}</text>
        </div>
      </div>
      <div style={{ ...col({ gap: 6 }), paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderColor: C.border }}>
        <text testId={`checks-${event.number}`} style={{ fontFamily: SANS, color: C.secondary, fontSize: 12.5, fontWeight: 500 }}>
          {passed === event.checks.length ? `All checks passed (${passed}/${event.checks.length})` : `Checks running (${passed}/${event.checks.length} passed)`}
        </text>
        {event.checks.map((c) => (
          <div key={c.name} style={row({ gap: 8 })}>
            <CheckDot state={c.state} />
            <text style={{ fontFamily: SANS, color: C.secondary, fontSize: 12.5, flexGrow: 1 }}>{c.name}</text>
            <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12 }}>{c.detail}</text>
          </div>
        ))}
      </div>
    </div>
  )
}

const EventView = memo(function EventView({ event, sessionId, onToggleWork }: { event: TranscriptEvent; sessionId: string; onToggleWork: (sessionId: string, workId: string) => void }) {
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
  return (
    <div style={{ ...col({ alignItems: 'center' }), width: '100%', minWidth: 0, paddingLeft: 32, paddingRight: 32, paddingTop: 9, paddingBottom: 9 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ ...col(), width: '100%', minWidth: 0, maxWidth: 740, paddingLeft: event.kind === 'user' || event.kind === 'devin' ? 0 : 34 }}>
        {body}
      </motion.div>
    </div>
  )
})

/* ───────────────────────────── Composer ───────────────────────────── */

function menuStyle(): StyleDesc {
  return {
    minWidth: 220,
    padding: 4,
    backgroundColor: C.menu,
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 12,
    boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: C.name === 'light' ? '#0000001f' : '#00000080' },
  }
}

function menuItemStyle(state: { selected: boolean; highlighted: boolean }): StyleDesc {
  return { ...row({ gap: 10 }), width: '100%', paddingLeft: 9, paddingRight: 9, paddingTop: 7, paddingBottom: 7, borderRadius: 8, cursor: 'pointer', backgroundColor: state.highlighted ? C.hover : C.menu, hover: { backgroundColor: C.hover } }
}

const MODE_ICON: Record<AgentMode, IconName> = { fusion: 'link', ultra: 'sliders', normal: 'sparkle', lite: 'list', fast: 'zap' }

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
    <Select items={items} value={value} onValueChange={onChange} style={{ flexShrink: 0 }}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <SelectTrigger
          testId={testId}
          style={(s) => ({ ...row({ gap: 5 }), height: 30, paddingLeft: 8, paddingRight: 7, borderRadius: 8, cursor: 'pointer', backgroundColor: s.open ? C.hover : CLEAR, hover: { backgroundColor: C.hover } })}
        >
          {icon && <Icon name={icon} size={14} color={C.tertiary} />}
          <text testId={`${testId}-label`} style={{ fontFamily: SANS, color: C.secondary, fontSize: 13.5, whiteSpace: 'nowrap' }}>{label}</text>
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
      {icon && <Icon name={icon} size={14} color={C.tertiary} />}
      <div style={col({ flexGrow: 1, minWidth: 0, pointerEvents: 'none' })}>
        <text style={{ fontFamily: SANS, color: C.text, fontSize: 13.5 }}>{label}</text>
        {description && <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12 }}>{description}</text>}
      </div>
      {selected && <Icon name="check" size={13} color={C.text} />}
    </>
  )
}

function ModePicker({ value, onChange }: { value: AgentMode; onChange: (m: AgentMode) => void }) {
  const current = MODES.find((m) => m.value === value) ?? MODES[0]!
  return (
    <TextSelect value={value} onChange={(v) => onChange(v as AgentMode)} items={MODES} label={current.label} testId="mode-picker">
      {MODES.map((m) => (
        <SelectItem key={m.value} value={m.value} testId={`mode-${m.value}`} style={(s) => menuItemStyle(s)}>
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
          {(s) => <MenuRow label={r} icon="folder" selected={s.selected} />}
        </SelectItem>
      ))}
    </TextSelect>
  )
}

function SendButton({ canSend, onClick, split }: { canSend: boolean; onClick: () => void; split?: boolean }) {
  const bg = canSend ? C.sendBg : C.selected
  const fg = canSend ? C.sendFg : C.ghost
  return (
    <Button
      testId="send"
      onClick={onClick}
      style={{ ...row({ justifyContent: 'center', gap: 6 }), marginLeft: 4, width: split ? 58 : 32, height: 32, borderRadius: 16, cursor: 'pointer', backgroundColor: bg, hover: { opacity: canSend ? 0.85 : 1 } }}
    >
      <Icon name="send" size={16} color={fg} />
      {split && <div style={{ width: 1, height: 16, backgroundColor: canSend ? C.sendFg : C.borderStrong, opacity: 0.25 }} />}
      {split && <Icon name="chevronDown" size={12} color={fg} />}
    </Button>
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
  return (
    <div
      style={{
        ...col({ gap: 10 }),
        width: '100%',
        maxWidth: big ? 716 : 760,
        paddingLeft: 16,
        paddingRight: 10,
        paddingTop: 14,
        paddingBottom: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: C.borderStrong,
        backgroundColor: C.raised,
        boxShadow: { offsetX: 0, offsetY: 2, blurRadius: 12, spreadRadius: 0, color: C.name === 'light' ? '#0000000f' : '#00000040' },
      }}
    >
      {chips && chips.length > 0 && (
        <div style={row({ gap: 6, flexWrap: 'wrap' })}>
          {chips.map((c) => (
            <div key={c.id} testId={`chip-${c.id}`} style={{ ...row({ gap: 6 }), height: 24, paddingLeft: 8, paddingRight: 4, borderRadius: 6, backgroundColor: C.chip }}>
              <Icon name={c.icon} size={12} color={C.chipText} />
              <text style={{ fontFamily: SANS, fontSize: 12, color: C.chipText, whiteSpace: 'nowrap' }}>{c.label}</text>
              <div testId={`chip-${c.id}-x`} onClick={c.onRemove} style={{ ...row({ justifyContent: 'center' }), width: 16, height: 16, borderRadius: 4, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
                <text style={{ fontFamily: SANS, fontSize: 12, color: C.chipText }}>×</text>
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
        style={{ fontSize: 15, lineHeight: 22, color: C.text, backgroundColor: C.raised, fontFamily: SANS }}
        theme={{ caret: C.text, textMuted: C.ghost }}
      />
      <div style={row({ gap: 2 })}>
        {plusMenu && (
          <ActionMenu testId="composer-plus" side="top" items={plusMenu}>
            <Icon name="plus" size={17} color={C.tertiary} />
          </ActionMenu>
        )}
        {slashMenu && (
          <ActionMenu testId="composer-slash" side="top" items={slashMenu}>
            <Icon name="slash" size={16} color={C.tertiary} />
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
  { id: 'shell', label: 'Shell', icon: 'laptop' },
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
  return (
    <div style={{ ...row({ gap: 2 }), height: 48, paddingLeft: 10, paddingRight: 10, flexShrink: 0, borderBottomWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
      {tabs.map((t) => {
        const tight = tabs.length > 3
        const active = t.id === tab
        return (
          <div
            key={t.id}
            testId={`tab-${t.id}`}
            onClick={() => onTab(t.id)}
            style={{ ...row({ gap: tight ? 5 : 6 }), height: 28, paddingLeft: tight ? 8 : 10, paddingRight: tight ? 8 : 10, borderRadius: 8, cursor: 'pointer', flexShrink: 0, backgroundColor: active ? C.selected : C.canvas, hover: { backgroundColor: active ? C.selected : C.hover } }}
          >
            <Icon name={t.icon} size={14} color={active ? C.text : C.tertiary} />
            <text style={{ fontFamily: SANS, color: active ? C.text : C.tertiary, fontSize: 13, fontWeight: active ? 500 : 400, whiteSpace: 'nowrap' }}>{t.label}</text>
          </div>
        )
      })}
    </div>
  )
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
      <div style={{ ...col({ gap: 10 }), flexGrow: 1, minHeight: 0, padding: 14, overflow: 'scroll' }}>
        {tab === 'shell' &&
          (shells.length ? (
            shells.map((s) => <ShellCard key={s.id} step={s} />)
          ) : (
            <Empty text="No commands yet" />
          ))}
        {tab === 'editor' &&
          (edits.length ? (
            edits.map((e) => (
              <div key={e.id} style={col({ gap: 6 })}>
                <text style={{ color: C.secondary, fontSize: 12, fontFamily: MONO }}>{e.path}</text>
                <diff patch={e.patch} wordDiff theme={nativeTheme()} style={{ fontSize: 11.5, borderRadius: 8, borderWidth: 1, borderColor: C.border }} />
              </div>
            ))
          ) : (
            <Empty text="No files edited yet" />
          ))}
        {tab === 'browser' && (browsers.length ? <BrowserCard step={browsers[browsers.length - 1]!} large /> : <Empty text="Browser idle" />)}
        {tab === 'planner' && (
          <div style={col({ gap: 12 })}>
            <div style={row({ gap: 8 })}>
              <StatusDot status={session.status} />
              <text style={{ fontFamily: SANS, color: C.text, fontSize: 13.5, fontWeight: 500 }}>{STATUS_LABEL[session.status]}</text>
              <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5 }}>{`· ${session.acus} ACUs`}</text>
            </div>
            {plan ? <PlanCard items={plan.items} /> : <Empty text="No plan for this session" />}
          </div>
        )}
      </div>
    </>
  )
}

function prLabel(url: string) {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  return m ? { repo: m[1]!, number: m[2]! } : { repo: url, number: '' }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ ...row({ gap: 10, alignItems: 'start' }), paddingTop: 9, paddingBottom: 9, borderBottomWidth: 1, borderColor: C.border }}>
      <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 13, width: 92, flexShrink: 0 }}>{label}</text>
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
  return (
    <>
      <PanelTabs tabs={tabs} tab={current} onTab={onTab} />
      {current === 'computer' ? (
        <ComputerPanel key={session.id} session={session} client={client} pollMs={pollMs} previews={previews} />
      ) : (
      <div style={{ ...col(), flexGrow: 1, minHeight: 0, paddingLeft: 18, paddingRight: 18, paddingTop: 8, overflow: 'scroll' }}>
        {pr ? (
          <div style={col({ gap: 12, paddingTop: 8 })}>
            <div style={row({ gap: 8 })}>
              <div style={{ ...row({ gap: 6 }), height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 13, backgroundColor: C.chip }}>
                <Icon name={pr.state === 'merged' ? 'merge' : 'pr'} size={13} color={C.chipText} />
                <text style={{ fontFamily: SANS, color: C.chipText, fontSize: 13, fontWeight: 500 }}>{pr.state ? pr.state[0]!.toUpperCase() + pr.state.slice(1) : 'Open'}</text>
              </div>
            </div>
            <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 13 }}>{`${prLabel(pr.url).repo} · #${prLabel(pr.url).number}`}</text>
            <text style={{ color: C.secondary, fontSize: 12.5, fontFamily: MONO, lineHeight: 18 }}>{pr.url}</text>
            <Button testId="open-pr" onClick={() => openUrl(pr.url)} style={{ ...row({ gap: 6, justifyContent: 'center' }), alignSelf: 'start', height: 32, paddingLeft: 12, paddingRight: 12, borderRadius: 8, borderWidth: 1, borderColor: C.borderStrong, cursor: 'pointer', backgroundColor: C.raised, hover: { backgroundColor: C.hover } }}>
              <Icon name="link" size={13} color={C.secondary} />
              <text style={{ fontFamily: SANS, color: C.text, fontSize: 13 }}>Open on GitHub</text>
            </Button>
            <PrReview key={pr.url} url={pr.url} client={client} canRun={(pr.state ?? 'open') === 'open'} />
          </div>
        ) : (
          <>
            <DetailRow label="Status">
              <StatusDot status={session.status} size={7} />
              <text testId="detail-status" style={{ fontFamily: SANS, color: C.text, fontSize: 13 }}>{statusLine(session) ?? STATUS_LABEL[session.status]}</text>
            </DetailRow>
            <DetailRow label="Mode">
              <text style={{ fontFamily: SANS, color: C.text, fontSize: 13 }}>{MODES.find((m) => m.value === session.mode)?.label ?? 'Normal'}</text>
            </DetailRow>
            <DetailRow label="ACUs">
              <text style={{ fontFamily: SANS, color: C.text, fontSize: 13 }}>{String(session.acus)}</text>
            </DetailRow>
            <DetailRow label="Updated">
              <text style={{ fontFamily: SANS, color: C.text, fontSize: 13 }}>{session.updated}</text>
            </DetailRow>
            <DetailRow label="Link">
              <div onClick={() => openUrl(live.url)} style={{ cursor: 'pointer', minWidth: 0, flexShrink: 1 }}>
                <text style={{ fontFamily: SANS, color: C.accent, fontSize: 13, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{live.url ? live.url.replace('https://', '') : 'Starting…'}</text>
              </div>
            </DetailRow>
            <SessionExtras session={session} client={client} />
            {children.length > 0 && (
              <div style={col({ gap: 2, paddingTop: 14 })}>
                <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5, paddingBottom: 6 }}>{`Child sessions · ${children.length}`}</text>
                {children.map((c) => (
                  <div key={c.id} onClick={() => onSelect(c.id)} style={{ ...row({ gap: 8 }), height: 32, paddingLeft: 8, paddingRight: 8, marginLeft: -8, borderRadius: 8, cursor: 'pointer', hover: { backgroundColor: C.hover } }}>
                    <StatusDot status={c.status} size={7} />
                    <text style={{ fontFamily: SANS, color: C.text, fontSize: 13, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.title}</text>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
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
  if (error && !shots) return <Empty text={error.slice(0, 80)} />
  if (!shots) return <Empty text="Loading Devin's screenshots…" />
  if (!shot)
    return (
      <div style={{ ...col({ gap: 8, alignItems: 'center', justifyContent: 'center' }), flexGrow: 1, padding: 28 }}>
        <Icon name="monitor" size={22} color={C.ghost} />
        <text testId="computer-empty" style={{ fontFamily: SANS, color: C.text, fontSize: 13.5, fontWeight: 500 }}>No screenshots yet</text>
        <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5, lineHeight: 18, textAlign: 'center' }}>
          Devin's screen shows up here whenever Devin posts a screenshot or recording in this session.
        </text>
      </div>
    )
  const recent = shots.map((s, i) => ({ s, i })).slice(-6).reverse()
  return (
    <div style={{ ...col({ gap: 10 }), flexGrow: 1, minHeight: 0, padding: 14 }}>
      <div style={{ ...row({ gap: 6 }), flexShrink: 0 }}>
        <text testId="computer-name" style={{ fontFamily: MONO, color: C.secondary, fontSize: 12, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{shot.name}</text>
        <text testId="computer-count" style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5, flexShrink: 0 }}>{`${idx + 1} / ${n}`}</text>
        <IconButton icon="arrowLeft" testId="computer-prev" size={14} box={26} onClick={() => idx > 0 && go(idx - 1)} color={idx > 0 ? C.secondary : C.ghost} />
        <IconButton icon="arrowRight" testId="computer-next" size={14} box={26} onClick={() => idx < n - 1 && go(idx + 1)} color={idx < n - 1 ? C.secondary : C.ghost} />
      </div>
      <Button
        testId="computer-stage"
        onClick={() => openOriginal(shot)}
        style={{ ...col({ alignItems: 'center', justifyContent: 'center' }), position: 'relative', flexGrow: 1, minHeight: 200, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden', cursor: 'pointer' }}
      >
        {ready?.path ? (
          <img testId="computer-image" src={ready.path} objectFit="contain" alt={shot.name} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
        ) : (
          <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 13, pointerEvents: 'none' }}>{ready ? 'No preview here. Click to open it in the browser.' : 'Loading preview…'}</text>
        )}
        {shot.kind === 'video' && (
          <div style={{ ...row({ gap: 5 }), position: 'absolute', top: 10, left: 10, height: 24, paddingLeft: 9, paddingRight: 9, borderRadius: 12, backgroundColor: C.sendBg, pointerEvents: 'none' }}>
            <text testId="computer-video-badge" style={{ fontFamily: SANS, color: C.sendFg, fontSize: 12, fontWeight: 500 }}>▶ Recording</text>
          </div>
        )}
      </Button>
      <div style={{ ...row({ gap: 8 }), flexShrink: 0 }}>
        {following ? (
          <>
            <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: running ? C.add : C.ghost }} />
            <text testId="computer-following" style={{ fontFamily: SANS, color: C.tertiary, fontSize: 12.5, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{running ? 'Showing the latest · updates as Devin posts' : 'Latest from this session'}</text>
          </>
        ) : (
          <div style={{ flexGrow: 1 }}>
            <Btn label="Jump to latest" testId="computer-latest" small onClick={() => setPick(-1)} />
          </div>
        )}
        <Btn label={opening ? 'Opening…' : 'Open'} icon="link" testId="computer-open" small onClick={() => !opening && openOriginal(shot)} />
      </div>
      <div style={{ ...col({ gap: 1 }), flexShrink: 0 }}>
        {recent.map(({ s, i }) => (
          <div
            key={s.attachment_id}
            testId={`computer-item-${i}`}
            onClick={() => go(i)}
            style={{ ...row({ gap: 8 }), height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: 8, cursor: 'pointer', backgroundColor: i === idx ? C.selected : C.canvas, hover: { backgroundColor: i === idx ? C.selected : C.hover } }}
          >
            <Icon name={s.kind === 'video' ? 'laptop' : 'monitor'} size={13} color={i === idx ? C.text : C.ghost} />
            <text style={{ fontFamily: MONO, color: i === idx ? C.text : C.tertiary, fontSize: 11.5, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{s.name}</text>
            <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 11.5, flexShrink: 0 }}>{s.kind === 'video' ? 'Recording' : 'Screenshot'}</text>
          </div>
        ))}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ ...row({ justifyContent: 'center' }), height: 120 }}>
      <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 13 }}>{text}</text>
    </div>
  )
}

/* ───────────────────────────── Main panes ───────────────────────────── */

function SessionHeader({ session, panelOpen, onTogglePanel, compact = false, menu, onChecklist, renaming, onRename }: { session: Session; panelOpen: boolean; onTogglePanel: () => void; compact?: boolean; menu: MenuAction[]; onChecklist: () => void; renaming: boolean; onRename: (title: string | null) => void }) {
  const prs = prCount(session)
  const [name, setName] = useState(session.title)
  if (renaming)
    return (
      <div style={{ ...row({ gap: 8 }), height: 48, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderColor: C.border, flexShrink: 0 }}>
        <div style={{ flexGrow: 1, maxWidth: 420 }}>
          <Field testId="rename-input" value={name} onChange={setName} placeholder="Session name" />
        </div>
        <Btn small primary testId="rename-save" label="Save" disabled={!name.trim()} onClick={() => onRename(name.trim())} />
        <Btn small testId="rename-cancel" label="Cancel" onClick={() => onRename(null)} />
      </div>
    )
  return (
    <div style={{ ...row({ gap: 8 }), height: 48, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderColor: C.border, flexShrink: 0 }}>
      <Icon name="gitBranch" size={14} color={C.tertiary} />
      <text testId="session-title" style={{ fontFamily: SANS, color: C.text, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>{session.title}</text>
      {prs > 0 && <Icon name="pr" size={13} color={C.tertiary} />}
      {prs > 0 && <text style={{ fontFamily: SANS, color: C.tertiary, fontSize: 13 }}>{String(prs)}</text>}
      <div style={{ ...row({ gap: 6 }), height: 22, paddingLeft: 9, paddingRight: 10, borderRadius: 11, backgroundColor: C.chip, flexShrink: 0 }}>
        <StatusDot status={session.status} size={6} />
        <text testId="session-status" style={{ fontFamily: SANS, color: C.chipText, fontSize: 12, whiteSpace: 'nowrap' }}>{STATUS_LABEL[session.status]}</text>
      </div>
      <text testId="session-mode" style={{ fontFamily: SANS, color: C.ghost, fontSize: 12.5, flexShrink: 0 }}>{MODES.find((m) => m.value === session.mode)?.label ?? ''}</text>
      <div style={{ flexGrow: 1 }} />
      {!compact && <IconButton icon="listChecks" testId="checklist" onClick={onChecklist} />}
      <ActionMenu testId="session-menu" items={menu}>
        <Icon name="more" size={16} color={C.tertiary} />
      </ActionMenu>
      {!compact && <IconButton icon="panelRight" testId="toggle-panel" onClick={onTogglePanel} active={panelOpen} />}
    </div>
  )
}

function StatusFooter({ session }: { session: Session }) {
  const line = statusLine(session)
  if (!line) return null
  return (
    <div style={{ ...row({ gap: 9 }), width: '100%', maxWidth: 760, paddingLeft: 6, paddingBottom: 10 }}>
      <StatusDot status={session.status} size={7} />
      <text testId="status-line" style={{ fontFamily: SANS, color: C.tertiary, fontSize: 13.5 }}>{line}</text>
    </div>
  )
}

function Segmented({ value, onChange }: { value: 'agent' | 'ask'; onChange: (v: 'agent' | 'ask') => void }) {
  return (
    <div style={{ ...row({ gap: 2 }), padding: 3, borderRadius: 10, backgroundColor: C.hover }}>
      {(['agent', 'ask'] as const).map((v) => {
        const active = v === value
        return (
          <div
            key={v}
            testId={`kind-${v}`}
            onClick={() => onChange(v)}
            style={{ ...row({ justifyContent: 'center' }), height: 28, paddingLeft: 13, paddingRight: 13, borderRadius: 8, cursor: 'pointer', backgroundColor: active ? C.raised : C.hover, borderWidth: 1, borderColor: active ? C.border : C.hover }}
          >
            <text style={{ fontFamily: SANS, color: active ? C.text : C.tertiary, fontSize: 13.5 }}>{v === 'agent' ? 'Agent' : 'Ask'}</text>
          </div>
        )
      })}
    </div>
  )
}

function HomeView({ composer, kind, onKind }: { composer: ComposerProps; kind: 'agent' | 'ask'; onKind: (k: 'agent' | 'ask') => void }) {
  return (
    <div style={{ ...col({ alignItems: 'center', justifyContent: 'center' }), flexGrow: 1, paddingLeft: 32, paddingRight: 32, paddingBottom: 90 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} style={{ ...col({ gap: 14 }), width: '100%', maxWidth: 716 }}>
        <div style={row({ gap: 9, paddingLeft: 6 })}>
          <Icon name="devin" size={26} color={C.text} />
          <text testId="home-title" style={{ fontFamily: SANS, color: C.text, fontSize: 27, fontWeight: 600 }}>Devin</text>
          <div style={{ flexGrow: 1 }} />
          <Segmented value={kind} onChange={onKind} />
        </div>
        <Composer {...composer} big />
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
  const [settingsKey, setSettingsKey] = useState(0)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [toast, setToast] = useState<string | null>(initialToast)
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
  const { width: rawWidth } = useWindowSize()
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

  windowKeyHandler = (event, r) => {
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
    { id: 'h-s', label: 'Devin sessions', header: true },
    ...byRecent(state.sessions)
      .filter((x) => !x.id.startsWith('pending-'))
      .slice(0, 5)
      .map((x) => ({ id: `s:${x.id}`, label: x.title, icon: 'compose' as IconName, run: () => linkSession(x) })),
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
        { id: 'copy', label: 'Copy session link', icon: 'link', run: () => (copyText(sessionUrl(selected)), setToast('Session link copied')) },
        { id: 'open', label: 'Open in Devin web app', icon: 'share', run: () => openUrl(sessionUrl(selected)) },
        ...(selected.live?.prs[0] ? [{ id: 'pr', label: 'Open pull request', icon: 'pr' as IconName, run: () => openUrl(selected.live!.prs[0]!.url) }] : []),
        { id: 'child', label: 'New linked session', icon: 'plus', run: () => linkSession(selected) },
        { id: 'rename', label: 'Rename', icon: 'pencil', run: () => setRenaming(true) },
        { id: 'archive', label: 'Archive', icon: 'folder', run: () => archive(selected) },
        ...(selected.status === 'running' || selected.status === 'blocked' ? [{ id: 'terminate', label: 'Stop session', icon: 'retry' as IconName, danger: true, run: () => terminate(selected) }] : []),
      ]
    : []
  const archive = (x: Session) => {
    const done = () => {
      dispatch({ type: 'remove', id: x.id })
      setToast(`Archived “${x.title}”`)
    }
    if (client?.archiveSession && x.live) client.archiveSession(x.id).then(done).catch((e: Error) => setToast(e.message))
    else done()
  }
  const terminate = (x: Session) => {
    const done = () => {
      dispatch({ type: 'patch', id: x.id, patch: { status: 'sleeping' } })
      setToast(`Stopped “${x.title}”`)
    }
    if (client?.terminateSession && x.live) client.terminateSession(x.id).then(done).catch((e: Error) => setToast(e.message))
    else done()
  }
  const rename = (t: string | null) => {
    setRenaming(false)
    if (!t || !selected) return
    dispatch({ type: 'patch', id: selected.id, patch: { title: t } })
    updatePrefs({ titles: { ...(prefs.titles ?? {}), [selected.id]: t } })
    setToast('Renamed (saved on this machine)')
  }
  const notifs = useMemo(() => notificationsFor(state.sessions, prefs.readAt ?? 0), [state.sessions, prefs.readAt])
  const unread = notifs.filter((n) => n.unread).length
  const openSettings = (page?: string) => {
    if (page === 'shortcuts') setSettingsKey((k) => k + 1000)
    setView('settings')
  }
  const changeZoom = (z: number) => {
    setZoom(z)
    setZoomState(getZoom())
    updatePrefs({ zoom: getZoom() })
  }
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
        key={settingsKey}
        instance={settingsKey}
        initialPage={settingsKey >= 1000 ? 'shortcuts' : settingsKey === 0 ? initialSettingsPage : undefined}
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

  return (
    <div
      key={`${themeName}-${zoom}`}
      ref={rootRef}
      tabIndex={-1}
      autoFocus
      onKeyDown={(event) => renderer && windowKeyHandler?.(event, renderer)}
      style={{ ...row({ alignItems: 'stretch' }), width: '100%', height: '100%', backgroundColor: C.canvas, fontFamily: SANS }}
    >
      {!tiny && !sidebarHidden && (
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
        />
      )}
      <div style={{ ...col(), flexGrow: 1, minWidth: 0, height: '100%' }}>
        {(sidebarHidden || tiny) && (
          <div style={{ ...row({ gap: 4 }), height: 40, paddingLeft: 8, flexShrink: 0 }}>
            {!tiny && <IconButton icon="panelLeft" testId="show-sidebar" onClick={() => setSidebarHidden(false)} />}
            {view !== 'home' && <IconButton icon="arrowLeft" testId="back-home" onClick={() => setView('home')} />}
          </div>
        )}
        {view !== 'home' ? (
          viewEl
        ) : selected ? (
          <>
            <SessionHeader
              key={`${selected.id}-${renaming}`}
              compact={compact}
              session={selected}
              panelOpen={state.panelOpen}
              onTogglePanel={() => dispatch({ type: 'panel', open: !state.panelOpen })}
              menu={sessionMenu}
              onChecklist={() => dispatch({ type: 'panel', open: true, tab: selected.live ? 'details' : 'planner' })}
              renaming={renaming}
              onRename={rename}
            />
            <virtual-list key={selected.id} testId="transcript" alignment="top" followTail estimatedItemHeight={160} overdraw={600} style={{ flexGrow: 1, minHeight: 0, paddingTop: 14, paddingBottom: 12 }}>
              {selected.live && !selected.live.loaded && selected.events.length === 0
                ? [
                    <div key="loading" style={{ ...row({ justifyContent: 'center' }), height: 80 }}>
                      <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 13.5 }}>Loading conversation…</text>
                    </div>,
                  ]
                : selected.events.map((e) => <EventView key={e.id} event={e} sessionId={selected.id} onToggleWork={onToggleWork} />)}
            </virtual-list>
            <div style={{ ...col({ alignItems: 'center' }), paddingLeft: 28, paddingRight: 28, paddingTop: 4, paddingBottom: 16, flexShrink: 0 }}>
              <StatusFooter session={selected} />
              <Composer {...composer} />
            </div>
          </>
        ) : (
          <HomeView composer={{ ...composer, chips, repo: state.repo, repos, onRepo: (repo) => dispatch({ type: 'repo', repo }) }} kind={kind} onKind={setKind} />
        )}
      </div>
      {selected && view === 'home' && !compact && (
        <motion.div initial={false} animate={{ width: state.panelOpen ? panelWidth : 0 }} transition={{ duration: 0.25, ease: 'easeOut' }} style={{ height: '100%', overflow: 'hidden', flexShrink: 0 }}>
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
        <div style={{ position: 'absolute', bottom: 22, left: 0, right: 0, ...row({ justifyContent: 'center' }), pointerEvents: 'none' }}>
          <div style={{ ...row({ gap: 8 }), height: 34, paddingLeft: 14, paddingRight: 14, borderRadius: 17, backgroundColor: C.sendBg }}>
            <text testId="toast" style={{ fontFamily: SANS, color: C.sendFg, fontSize: 13 }}>{toast}</text>
          </div>
        </div>
      )}
    </div>
  )
}
