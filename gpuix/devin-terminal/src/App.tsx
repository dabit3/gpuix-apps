import React, { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  Button,
  isTerminal,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  useGpuix,
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
  STATUS_COLOR,
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
import { filterSessions, formatDuration, reducer, type PanelTab, type State } from './state'
import { Icon, type IconName } from './icons'

export const C = {
  canvas: '#101113',
  sidebar: '#0b0c0e',
  raised: '#17181b',
  card: '#141518',
  cardHead: '#1a1c1f',
  menu: '#1c1e22',
  hover: '#1d1f23',
  selected: '#22252a',
  border: '#24262b',
  borderStrong: '#2f3238',
  text: '#e8e9eb',
  secondary: '#b4b7bd',
  tertiary: '#83878f',
  ghost: '#5d6168',
  accent: '#2cb5a8',
  accentSoft: '#2cb5a81f',
  blue: '#3ea6ff',
  add: '#3fbf8a',
  del: '#ef6461',
  userBubble: '#1f2226',
}

const MONO = 'Menlo'
const SIDEBAR_WIDTH = 272
const PANEL_WIDTH = 420
const TRAFFIC_LIGHT_HEIGHT = 40

const NATIVE_THEME = {
  appearance: 'dark' as const,
  accent: C.accent,
  text: C.text,
  textMuted: C.secondary,
  bg: C.card,
  border: C.border,
  diffAdd: C.add,
  diffDel: C.del,
  codeText: '#8fd9cf',
  codeWash: '#2cb5a817',
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
      transition={{ duration: 0.7, ease: 'easeInOut' }}
      onMotionComplete={() => running && setDim((d) => !d)}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: STATUS_COLOR[status], flexShrink: 0, pointerEvents: 'none' }}
    />
  )
}

function DevinMark({ size = 22 }: { size?: number }) {
  return (
    <div style={{ ...row({ justifyContent: 'center' }), width: size, height: size, borderRadius: size * 0.3, backgroundColor: C.accent, flexShrink: 0, pointerEvents: 'none' }}>
      <text style={{ color: '#06201d', fontSize: size * 0.58, fontWeight: 700 }}>D</text>
    </div>
  )
}

/* ───────────────────────────── Sidebar ───────────────────────────── */

type SidebarRowData = { type: 'header'; label: string } | { type: 'session'; session: Session }

const SessionRow = memo(function SessionRow({ session, selected, onSelect }: { session: Session; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
    <div
      testId={`session-${session.id}`}
      onClick={() => onSelect(session.id)}
      style={{
        ...row({ gap: 10, alignItems: 'start' }),
        marginLeft: 8,
        marginRight: 8,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: 8,
        cursor: 'pointer',
        backgroundColor: selected ? C.selected : C.sidebar,
        hover: { backgroundColor: selected ? C.selected : C.hover },
      }}
    >
      <div style={{ paddingTop: 5, pointerEvents: 'none' }}>
        <StatusDot status={session.status} />
      </div>
      <div style={col({ flexGrow: 1, minWidth: 0, gap: 2 })}>
        <text style={{ color: selected ? C.text : C.secondary, fontSize: 13, lineHeight: 17, fontWeight: selected ? 500 : 400, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {session.title}
        </text>
        <div style={row({ gap: 6, minWidth: 0 })}>
          <text style={{ color: C.ghost, fontSize: 11.5, lineHeight: 14, whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>{session.repo}</text>
          <text style={{ color: C.ghost, fontSize: 11.5, lineHeight: 14, flexShrink: 0 }}>{`· ${session.updated}`}</text>
        </div>
      </div>
    </div>
    </motion.div>
  )
})

function SidebarButton({ icon, label, hint, onClick, testId, active }: { icon: IconName; label: string; hint?: string; onClick?: () => void; testId?: string; active?: boolean }) {
  return (
    <Button
      testId={testId}
      onClick={onClick}
      style={{
        ...row({ gap: 10 }),
        height: 34,
        paddingLeft: 10,
        paddingRight: 10,
        marginLeft: 8,
        marginRight: 8,
        borderRadius: 8,
        cursor: 'pointer',
        backgroundColor: active ? C.selected : C.sidebar,
        hover: { backgroundColor: C.hover },
      }}
    >
      <Icon name={icon} size={15} color={C.secondary} />
      <text style={{ color: C.text, fontSize: 13, flexGrow: 1 }}>{label}</text>
      {hint && <text style={{ color: C.ghost, fontSize: 11.5 }}>{hint}</text>}
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
}: {
  state: State
  visible: Session[]
  onSelect: (id: string) => void
  onNew: () => void
  onSearch: (value: string) => void
  searchRef: React.RefObject<PublicInstance | null>
}) {
  const rows = useMemo(() => {
    const out: SidebarRowData[] = []
    let group = ''
    for (const s of visible) {
      if (s.group !== group) {
        group = s.group
        out.push({ type: 'header', label: group })
      }
      out.push({ type: 'session', session: s })
    }
    return out
  }, [visible])
  const running = state.sessions.filter((s) => s.status === 'running').length
  const macWindow = process.platform === 'darwin' && !isTerminal()

  return (
    <div style={{ ...col(), width: SIDEBAR_WIDTH, height: '100%', flexShrink: 0, backgroundColor: C.sidebar, borderRightWidth: 1, borderColor: C.border }}>
      {macWindow && <div style={{ height: TRAFFIC_LIGHT_HEIGHT - 8, flexShrink: 0 }} />}
      <div style={row({ gap: 9, paddingLeft: 18, paddingRight: 14, paddingTop: 14, paddingBottom: 12 })}>
        <DevinMark />
        <text style={{ color: C.text, fontSize: 15, fontWeight: 600, flexGrow: 1 }}>Devin</text>
        <text testId="session-count" style={{ color: C.ghost, fontSize: 11.5 }}>
          {`${state.sessions.length} sessions · ${running} running`}
        </text>
      </div>
      <SidebarButton icon="compose" label="New session" hint="⌘N" onClick={onNew} testId="new-session" active={state.selectedId === null} />
      <div style={{ ...row({ gap: 8 }), marginLeft: 8, marginRight: 8, marginTop: 8, marginBottom: 6, height: 32, paddingLeft: 10, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.raised }}>
        <Icon name="search" size={13} color={C.tertiary} />
        <input
          ref={searchRef}
          testId="search"
          value={state.search}
          placeholder="Search sessions"
          onChange={(e) => onSearch(e.value ?? '')}
          style={{ flexGrow: 1, minWidth: 0, height: 30, fontSize: 13, color: C.text, backgroundColor: C.raised }}
          theme={{ caret: C.accent, textMuted: C.ghost }}
        />
        <div style={{ ...row({ justifyContent: 'center' }), height: 18, paddingLeft: 5, paddingRight: 5, borderRadius: 4, backgroundColor: C.hover }}>
          <text style={{ color: C.tertiary, fontSize: 10.5 }}>⌘K</text>
        </div>
      </div>
      <virtual-list testId="session-list" estimatedItemHeight={52} overdraw={400} style={{ flexGrow: 1, minHeight: 0, paddingBottom: 8 }}>
        {rows.length === 0 ? (
          <div key="empty" style={{ padding: 18 }}>
            <text style={{ color: C.tertiary, fontSize: 12.5 }}>{`No sessions match “${state.search}”`}</text>
          </div>
        ) : (
          rows.map((r) =>
            r.type === 'header' ? (
              <div key={`h-${r.label}`} style={{ paddingLeft: 18, paddingTop: 14, paddingBottom: 6 }}>
                <text style={{ color: C.ghost, fontSize: 11.5, fontWeight: 500 }}>{r.label}</text>
              </div>
            ) : (
              <SessionRow key={r.session.id} session={r.session} selected={r.session.id === state.selectedId} onSelect={onSelect} />
            ),
          )
        )}
      </virtual-list>
      <div style={{ ...col({ gap: 2 }), paddingTop: 8, paddingBottom: 10, borderTopWidth: 1, borderColor: C.border }}>
        <SidebarButton icon="library" label="Knowledge" />
        <SidebarButton icon="settings" label="Settings" />
        <div style={{ ...row({ gap: 10 }), marginLeft: 8, marginRight: 8, paddingLeft: 10, paddingRight: 10, height: 42, borderRadius: 8, hover: { backgroundColor: C.hover }, cursor: 'pointer' }}>
          <div style={{ ...row({ justifyContent: 'center' }), width: 26, height: 26, borderRadius: 13, backgroundColor: '#2a6f9e', pointerEvents: 'none' }}>
            <text style={{ color: '#ffffff', fontSize: 12, fontWeight: 600 }}>ND</text>
          </div>
          <div style={col({ flexGrow: 1, minWidth: 0 })}>
            <text style={{ color: C.text, fontSize: 12.5 }}>Nader Dabit</text>
            <text style={{ color: C.ghost, fontSize: 11 }}>Acme Corp · Team plan</text>
          </div>
          <Icon name="more" size={14} color={C.tertiary} />
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────── Transcript ───────────────────────────── */

function UserBubble({ text, at }: { text: string; at: string }) {
  return (
    <div style={col({ alignItems: 'end', gap: 4 })}>
      <div style={{ maxWidth: 560, paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 10, borderRadius: 14, backgroundColor: C.userBubble, borderWidth: 1, borderColor: C.border }}>
        <text style={{ color: C.text, fontSize: 14, lineHeight: 21 }}>{text}</text>
      </div>
      <text style={{ color: C.ghost, fontSize: 11 }}>{`You · ${at}`}</text>
    </div>
  )
}

function DevinMessage({ md, streaming }: { md: string; streaming?: boolean }) {
  return (
    <div style={row({ gap: 12, alignItems: 'start' })}>
      <DevinMark size={24} />
      <div style={col({ flexGrow: 1, minWidth: 0, gap: 4, paddingTop: 2 })}>
        <markdown source={md + (streaming ? ' ▍' : '')} theme={NATIVE_THEME} style={{ width: '100%', minWidth: 0, color: C.text, fontSize: 14, lineHeight: 22 }} />
      </div>
    </div>
  )
}

function PlanCard({ items }: { items: PlanItem[] }) {
  const done = items.filter((i) => i.done).length
  return (
    <div style={{ ...col(), marginLeft: 36, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <div style={{ ...row({ gap: 8 }), paddingLeft: 12, paddingRight: 12, height: 34, backgroundColor: C.cardHead }}>
        <Icon name="list" size={13} color={C.accent} />
        <text style={{ color: C.text, fontSize: 12.5, fontWeight: 500, flexGrow: 1 }}>Plan</text>
        <text testId="plan-progress" style={{ color: C.tertiary, fontSize: 11.5 }}>{`${done}/${items.length} done`}</text>
      </div>
      <div style={col({ gap: 7, paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 12 })}>
        {items.map((item, i) => (
          <div key={i} style={row({ gap: 9 })}>
            <div style={{ ...row({ justifyContent: 'center' }), width: 15, height: 15, borderRadius: 8, borderWidth: item.done ? 0 : 1, borderColor: C.borderStrong, backgroundColor: item.done ? C.accent : C.card }}>
              {item.done && <Icon name="check" size={10} color="#06201d" />}
            </div>
            <text style={{ color: item.done ? C.tertiary : C.secondary, fontSize: 13 }}>{item.text}</text>
          </div>
        ))}
      </div>
    </div>
  )
}

function CardHeader({ icon, children, right }: { icon: IconName; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ ...row({ gap: 8 }), paddingLeft: 12, paddingRight: 10, height: 32, backgroundColor: C.cardHead, borderBottomWidth: 1, borderColor: C.border }}>
      <Icon name={icon} size={13} color={C.tertiary} />
      <div style={{ ...row({ gap: 6 }), flexGrow: 1, minWidth: 0 }}>{children}</div>
      {right}
    </div>
  )
}

function ShellCard({ step }: { step: Extract<Step, { kind: 'shell' }> }) {
  const exitColor = step.exit === undefined ? C.blue : step.exit === 0 ? C.add : C.del
  return (
    <div style={{ ...col(), borderRadius: 9, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <CardHeader
        icon="laptop"
        right={
          <text style={{ color: exitColor, fontSize: 11, fontFamily: MONO }}>
            {step.exit === undefined ? 'running…' : `exit ${step.exit}`}
          </text>
        }
      >
        <text style={{ color: C.accent, fontSize: 12, fontFamily: MONO }}>$</text>
        <text style={{ color: C.text, fontSize: 12, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{step.cmd}</text>
      </CardHeader>
      {step.output.length > 0 && (
        <code code={step.output} language="log" theme={NATIVE_THEME} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 10, fontSize: 12, lineHeight: 17, color: C.secondary, fontFamily: MONO }} />
      )}
    </div>
  )
}

function EditCard({ step }: { step: Extract<Step, { kind: 'edit' }> }) {
  return (
    <div style={{ ...col(), borderRadius: 9, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <CardHeader
        icon="pencil"
        right={
          <div style={row({ gap: 6 })}>
            <text style={{ color: C.add, fontSize: 11.5, fontFamily: MONO }}>{`+${step.additions}`}</text>
            <text style={{ color: C.del, fontSize: 11.5, fontFamily: MONO }}>{`-${step.deletions}`}</text>
          </div>
        }
      >
        <text style={{ color: C.secondary, fontSize: 12 }}>Edited</text>
        <text style={{ color: C.text, fontSize: 12, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{step.path}</text>
      </CardHeader>
      <diff patch={step.patch} wordDiff maxLines={28} theme={NATIVE_THEME} style={{ fontSize: 12 }} />
    </div>
  )
}

function BrowserCard({ step, large }: { step: Extract<Step, { kind: 'browser' }>; large?: boolean }) {
  return (
    <div style={{ ...col(), borderRadius: 9, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' }}>
      <div style={{ ...row({ gap: 8 }), paddingLeft: 10, paddingRight: 10, height: 34, backgroundColor: C.cardHead, borderBottomWidth: 1, borderColor: C.border }}>
        <div style={row({ gap: 5 })}>
          {['#ef6461', '#f2b84b', '#3fbf8a'].map((c) => (
            <div key={c} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c, opacity: 0.8 }} />
          ))}
        </div>
        <Icon name="arrowLeft" size={12} color={C.ghost} />
        <Icon name="arrowRight" size={12} color={C.ghost} />
        <Icon name="retry" size={11} color={C.ghost} />
        <div style={{ ...row(), flexGrow: 1, minWidth: 0, height: 22, paddingLeft: 9, borderRadius: 6, backgroundColor: C.canvas }}>
          <text style={{ color: C.secondary, fontSize: 11.5, fontFamily: MONO, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{step.url}</text>
        </div>
      </div>
      <div style={{ ...col({ gap: 10 }), padding: 14, backgroundColor: '#f4f5f7', height: large ? 280 : undefined }}>
        <div style={row({ gap: 8 })}>
          <div style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: '#1f2937' }} />
          <text style={{ color: '#111827', fontSize: 13, fontWeight: 600 }}>{step.title}</text>
        </div>
        <div style={row({ gap: 8 })}>
          {[0.9, 0.55, 0.7].map((w, i) => (
            <div key={i} style={{ height: 34, flexGrow: w, borderRadius: 6, backgroundColor: i === 1 ? '#2cb5a8' : '#e5e7eb' }} />
          ))}
        </div>
        <div style={{ height: 8, width: '70%', borderRadius: 4, backgroundColor: '#d1d5db' }} />
        <div style={{ height: 8, width: '45%', borderRadius: 4, backgroundColor: '#d1d5db' }} />
      </div>
      <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 9, borderTopWidth: 1, borderColor: C.border }}>
        <text style={{ color: C.secondary, fontSize: 12.5, lineHeight: 18 }}>{step.note}</text>
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
      return <text style={{ color: C.tertiary, fontSize: 13 }}>{step.text}</text>
  }
}

function WorkGroup({ event, onToggle }: { event: Extract<TranscriptEvent, { kind: 'work' }>; onToggle: () => void }) {
  const label = event.active ? `Working for ${formatDuration(event.seconds)}` : `Worked for ${formatDuration(event.seconds)}`
  return (
    <div style={col({ marginLeft: 36, gap: 8 })}>
      <div
        testId={`work-${event.id}`}
        onClick={onToggle}
        style={{ ...row({ gap: 7 }), alignSelf: 'start', height: 26, paddingLeft: 6, paddingRight: 8, marginLeft: -6, borderRadius: 6, cursor: 'pointer', hover: { backgroundColor: C.hover } }}
      >
        <Icon name={event.open ? 'chevronDown' : 'chevronRight'} size={12} color={C.tertiary} />
        {event.active && <StatusDot status="running" size={7} />}
        <text style={{ color: event.active ? C.blue : C.tertiary, fontSize: 12.5 }}>{label}</text>
        <text style={{ color: C.ghost, fontSize: 12.5 }}>{`· ${event.steps.length} ${event.steps.length === 1 ? 'step' : 'steps'}`}</text>
      </div>
      {event.open && (
        <div style={{ ...col({ gap: 10 }), paddingLeft: 14, borderLeftWidth: 1, borderColor: C.borderStrong }}>
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
  const color = state === 'pass' ? C.add : state === 'fail' ? C.del : '#f2b84b'
  return (
    <div style={{ ...row({ justifyContent: 'center' }), width: 14, height: 14, borderRadius: 7, backgroundColor: state === 'pending' ? C.card : color, borderWidth: state === 'pending' ? 2 : 0, borderColor: color }}>
      {state === 'pass' && <Icon name="check" size={9} color="#06201d" />}
    </div>
  )
}

function PRCard({ event }: { event: Extract<TranscriptEvent, { kind: 'pr' }> }) {
  const passed = event.checks.filter((c) => c.state === 'pass').length
  const stateColor = event.state === 'merged' ? C.blue : C.add
  return (
    <div testId={`pr-${event.number}`} style={{ ...col(), marginLeft: 36, borderRadius: 10, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.card, overflow: 'hidden' }}>
      <div style={col({ gap: 6, paddingLeft: 14, paddingRight: 14, paddingTop: 12, paddingBottom: 12 })}>
        <div style={row({ gap: 8 })}>
          <Icon name="gitBranch" size={14} color={stateColor} />
          <text style={{ color: C.text, fontSize: 14, fontWeight: 600, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{event.title}</text>
          <div style={{ ...row(), height: 20, paddingLeft: 8, paddingRight: 8, borderRadius: 10, backgroundColor: event.state === 'merged' ? '#3ea6ff22' : '#3fbf8a22' }}>
            <text style={{ color: stateColor, fontSize: 11, fontWeight: 600 }}>{event.state === 'merged' ? 'Merged' : 'Open'}</text>
          </div>
        </div>
        <div style={row({ gap: 8 })}>
          <text style={{ color: C.tertiary, fontSize: 12 }}>{`${event.repo} #${event.number}`}</text>
          <text style={{ color: C.ghost, fontSize: 12 }}>·</text>
          <text style={{ color: C.tertiary, fontSize: 12, fontFamily: MONO }}>{event.branch}</text>
          <text style={{ color: C.ghost, fontSize: 12 }}>·</text>
          <text style={{ color: C.add, fontSize: 12, fontFamily: MONO }}>{`+${event.additions}`}</text>
          <text style={{ color: C.del, fontSize: 12, fontFamily: MONO }}>{`-${event.deletions}`}</text>
          <text style={{ color: C.ghost, fontSize: 12 }}>{`· ${event.files} files`}</text>
        </div>
      </div>
      <div style={{ ...col({ gap: 6 }), paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.cardHead }}>
        <text testId={`checks-${event.number}`} style={{ color: C.secondary, fontSize: 12, fontWeight: 500 }}>
          {passed === event.checks.length ? `All checks passed (${passed}/${event.checks.length})` : `Checks running (${passed}/${event.checks.length} passed)`}
        </text>
        {event.checks.map((c) => (
          <div key={c.name} style={row({ gap: 8 })}>
            <CheckDot state={c.state} />
            <text style={{ color: C.secondary, fontSize: 12, flexGrow: 1 }}>{c.name}</text>
            <text style={{ color: C.ghost, fontSize: 11.5 }}>{c.detail}</text>
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
      body = <UserBubble text={event.text} at={event.at} />
      break
    case 'devin':
      body = <DevinMessage md={event.md} streaming={event.streaming} />
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
    <div style={{ ...col({ alignItems: 'center' }), width: '100%', minWidth: 0, paddingLeft: 28, paddingRight: 28, paddingTop: 10, paddingBottom: 10 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} style={{ ...col(), width: '100%', minWidth: 0, maxWidth: 780 }}>
        {body}
      </motion.div>
    </div>
  )
})

/* ───────────────────────────── Composer ───────────────────────────── */

const MENU: StyleDesc = { minWidth: 230, padding: 4, backgroundColor: C.menu, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 10 }

function menuItemStyle(state: { selected: boolean; highlighted: boolean }): StyleDesc {
  return { ...row({ gap: 10 }), width: '100%', paddingLeft: 9, paddingRight: 9, paddingTop: 6, paddingBottom: 6, borderRadius: 7, cursor: 'pointer', backgroundColor: state.highlighted ? '#2a2d33' : C.menu, hover: { backgroundColor: '#2a2d33' } }
}

const MODE_ICON: Record<AgentMode, IconName> = { normal: 'sparkle', fast: 'zap', ultra: 'sliders' }

function ChipSelect({
  value,
  onChange,
  items,
  icon,
  label,
  testId,
  side = 'top',
  children,
  accent,
}: {
  value: string
  onChange: (v: string) => void
  items: { value: string; label: string }[]
  icon: IconName
  label: string
  testId: string
  side?: 'top' | 'bottom'
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <Select items={items} value={value} onValueChange={onChange} style={{ flexShrink: 0 }}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <SelectTrigger
          testId={testId}
          style={(s) => ({ ...row({ gap: 6 }), height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: 7, cursor: 'pointer', backgroundColor: s.open ? C.hover : C.raised, hover: { backgroundColor: C.hover } })}
        >
          <Icon name={icon} size={13} color={accent ? C.accent : C.tertiary} />
          <text testId={`${testId}-label`} style={{ color: accent ? C.accent : C.secondary, fontSize: 12.5, whiteSpace: 'nowrap' }}>{label}</text>
          <Icon name="chevronDown" size={11} color={C.ghost} />
        </SelectTrigger>
        <SelectContent side={side} sideOffset={6} style={MENU}>
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
        <text style={{ color: C.text, fontSize: 13 }}>{label}</text>
        {description && <text style={{ color: C.tertiary, fontSize: 11.5 }}>{description}</text>}
      </div>
      {selected && <Icon name="check" size={12} color={C.accent} />}
    </>
  )
}

function ModePicker({ value, onChange }: { value: AgentMode; onChange: (m: AgentMode) => void }) {
  const current = MODES.find((m) => m.value === value) ?? MODES[0]!
  return (
    <ChipSelect value={value} onChange={(v) => onChange(v as AgentMode)} items={MODES} icon={MODE_ICON[value]} label={current.label} testId="mode-picker" accent={value === 'ultra'}>
      {MODES.map((m) => (
        <SelectItem key={m.value} value={m.value} testId={`mode-${m.value}`} style={(s) => menuItemStyle(s)}>
          {(s) => <MenuRow label={m.label} description={m.description} icon={MODE_ICON[m.value]} selected={s.selected} />}
        </SelectItem>
      ))}
    </ChipSelect>
  )
}

function RepoPicker({ value, onChange }: { value: string; onChange: (r: string) => void }) {
  return (
    <ChipSelect value={value} onChange={onChange} items={REPOS.map((r) => ({ value: r, label: r }))} icon="folder" label={value} testId="repo-picker">
      {REPOS.map((r) => (
        <SelectItem key={r} value={r} testId={`repo-${r.split('/')[1]}`} style={(s) => menuItemStyle(s)}>
          {(s) => <MenuRow label={r} icon="folder" selected={s.selected} />}
        </SelectItem>
      ))}
    </ChipSelect>
  )
}

function Composer({
  draft,
  setDraft,
  onSubmit,
  mode,
  onMode,
  repo,
  onRepo,
  placeholder,
  composerRef,
  big,
}: {
  draft: string
  setDraft: (v: string) => void
  onSubmit: (text: string) => void
  mode: AgentMode
  onMode: (m: AgentMode) => void
  repo?: string
  onRepo?: (r: string) => void
  placeholder: string
  composerRef: React.RefObject<PublicInstance | null>
  big?: boolean
}) {
  const canSend = draft.trim().length > 0
  return (
    <div style={{ ...col({ gap: 8 }), width: '100%', maxWidth: 780, paddingLeft: 14, paddingRight: 10, paddingTop: 12, paddingBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.raised, boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: '#00000066' } }}>
      <textarea
        ref={composerRef}
        testId="composer"
        value={draft}
        placeholder={placeholder}
        minRows={big ? 3 : 1}
        maxRows={8}
        onChange={(e) => setDraft(e.value ?? '')}
        onSubmit={(e) => onSubmit(e.value ?? draft)}
        style={{ fontSize: 14, lineHeight: 21, color: C.text, backgroundColor: C.raised }}
        theme={{ caret: C.accent, textMuted: C.ghost }}
      />
      <div style={row({ gap: 6 })}>
        {repo && onRepo && <RepoPicker value={repo} onChange={onRepo} />}
        <ModePicker value={mode} onChange={onMode} />
        <div style={{ flexGrow: 1 }} />
        <text style={{ color: C.ghost, fontSize: 11.5, marginRight: 6 }}>⏎ to send</text>
        <Button
          testId="send"
          onClick={() => canSend && onSubmit(draft)}
          style={{ ...row({ justifyContent: 'center' }), width: 30, height: 30, borderRadius: 15, cursor: 'pointer', backgroundColor: canSend ? C.accent : C.hover, hover: { backgroundColor: canSend ? '#3cc9bb' : C.selected } }}
        >
          <Icon name="send" size={15} color={canSend ? '#06201d' : C.ghost} />
        </Button>
      </div>
    </div>
  )
}

/* ───────────────────────────── Right panel ───────────────────────────── */

const TABS: { id: PanelTab; label: string; icon: IconName }[] = [
  { id: 'shell', label: 'Shell', icon: 'laptop' },
  { id: 'editor', label: 'Editor', icon: 'pencil' },
  { id: 'browser', label: 'Browser', icon: 'search' },
  { id: 'planner', label: 'Planner', icon: 'list' },
]

function allSteps(s: Session): Step[] {
  return s.events.flatMap((e) => (e.kind === 'work' ? e.steps : []))
}

function RightPanel({ session, tab, onTab }: { session: Session; tab: PanelTab; onTab: (t: PanelTab) => void }) {
  const steps = allSteps(session)
  const shells = steps.filter((s): s is Extract<Step, { kind: 'shell' }> => s.kind === 'shell')
  const edits = steps.filter((s): s is Extract<Step, { kind: 'edit' }> => s.kind === 'edit')
  const browsers = steps.filter((s): s is Extract<Step, { kind: 'browser' }> => s.kind === 'browser')
  const plan = [...session.events].reverse().find((e): e is Extract<TranscriptEvent, { kind: 'plan' }> => e.kind === 'plan')
  const log = shells.map((s) => `${s.cwd} $ ${s.cmd}\n${s.output}`).join('\n\n')
  return (
    <div style={{ ...col(), width: PANEL_WIDTH, height: '100%', backgroundColor: C.sidebar, borderLeftWidth: 1, borderColor: C.border }}>
      <div style={{ ...row({ gap: 2 }), height: 44, paddingLeft: 8, paddingRight: 8, borderBottomWidth: 1, borderColor: C.border, flexShrink: 0 }}>
        {TABS.map((t) => (
          <div
            key={t.id}
            testId={`tab-${t.id}`}
            onClick={() => onTab(t.id)}
            style={{ ...row({ gap: 6 }), height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 7, cursor: 'pointer', backgroundColor: tab === t.id ? C.selected : C.sidebar, hover: { backgroundColor: tab === t.id ? C.selected : C.hover } }}
          >
            <Icon name={t.icon} size={12} color={tab === t.id ? C.accent : C.tertiary} />
            <text style={{ color: tab === t.id ? C.text : C.tertiary, fontSize: 12.5 }}>{t.label}</text>
          </div>
        ))}
      </div>
      <div style={{ ...col({ gap: 12 }), flexGrow: 1, minHeight: 0, overflowY: 'scroll', padding: 14, scrollbarColor: C.borderStrong }}>
        {tab === 'shell' &&
          (shells.length ? (
            <code testId="panel-shell" code={log} language="log" theme={NATIVE_THEME} style={{ fontSize: 11.5, lineHeight: 16, color: C.secondary, fontFamily: MONO }} />
          ) : (
            <Empty text="No shell activity yet" />
          ))}
        {tab === 'editor' &&
          (edits.length ? (
            edits.map((e) => (
              <div key={e.id} style={col({ gap: 6 })}>
                <text style={{ color: C.secondary, fontSize: 12, fontFamily: MONO }}>{e.path}</text>
                <diff patch={e.patch} wordDiff theme={NATIVE_THEME} style={{ fontSize: 11.5, borderRadius: 8, borderWidth: 1, borderColor: C.border }} />
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
              <text style={{ color: C.text, fontSize: 13, fontWeight: 500 }}>{STATUS_LABEL[session.status]}</text>
              <text style={{ color: C.ghost, fontSize: 12 }}>{`· ${session.acus} ACUs`}</text>
            </div>
            {plan ? <PlanCard items={plan.items} /> : <Empty text="No plan for this session" />}
          </div>
        )}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ ...row({ justifyContent: 'center' }), height: 120 }}>
      <text style={{ color: C.ghost, fontSize: 12.5 }}>{text}</text>
    </div>
  )
}

/* ───────────────────────────── Main panes ───────────────────────────── */

function IconButton({ icon, onClick, testId, active }: { icon: IconName; onClick?: () => void; testId?: string; active?: boolean }) {
  return (
    <Button testId={testId} onClick={onClick} style={{ ...row({ justifyContent: 'center' }), width: 30, height: 30, borderRadius: 7, cursor: 'pointer', backgroundColor: active ? C.selected : C.canvas, hover: { backgroundColor: C.hover } }}>
      <Icon name={icon} size={15} color={active ? C.text : C.tertiary} />
    </Button>
  )
}

function SessionHeader({ session, panelOpen, onTogglePanel }: { session: Session; panelOpen: boolean; onTogglePanel: () => void }) {
  return (
    <div style={{ ...row({ gap: 10 }), height: 52, paddingLeft: 20, paddingRight: 12, borderBottomWidth: 1, borderColor: C.border, flexShrink: 0 }}>
      <div style={col({ flexGrow: 1, minWidth: 0, gap: 2 })}>
        <text testId="session-title" style={{ color: C.text, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{session.title}</text>
        <div style={row({ gap: 6 })}>
          <Icon name="folder" size={11} color={C.ghost} />
          <text style={{ color: C.tertiary, fontSize: 11.5 }}>{session.repo}</text>
          <Icon name="gitBranch" size={11} color={C.ghost} />
          <text style={{ color: C.tertiary, fontSize: 11.5, fontFamily: MONO }}>{session.branch}</text>
        </div>
      </div>
      <div style={{ ...row({ gap: 6 }), height: 24, paddingLeft: 9, paddingRight: 10, borderRadius: 12, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border }}>
        <StatusDot status={session.status} size={7} />
        <text testId="session-status" style={{ color: C.secondary, fontSize: 11.5 }}>{STATUS_LABEL[session.status]}</text>
      </div>
      <div style={{ ...row({ gap: 5 }), height: 24, paddingLeft: 8, paddingRight: 9, borderRadius: 12, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border }}>
        <Icon name={MODE_ICON[session.mode]} size={11} color={session.mode === 'ultra' ? C.accent : C.tertiary} />
        <text testId="session-mode" style={{ color: C.secondary, fontSize: 11.5 }}>{MODES.find((m) => m.value === session.mode)?.label ?? ''}</text>
      </div>
      <IconButton icon="share" />
      <IconButton icon="panelRight" testId="toggle-panel" onClick={onTogglePanel} active={panelOpen} />
    </div>
  )
}

const SUGGESTIONS = [
  { icon: 'wrench' as IconName, title: 'Add dark mode to the settings page', repo: 'northwind/storefront' },
  { icon: 'zap' as IconName, title: 'Speed up the slowest API endpoint', repo: 'acme-corp/payments-api' },
  { icon: 'check' as IconName, title: 'Raise test coverage for billing to 90%', repo: 'acme-corp/billing' },
]

function HomeView(props: React.ComponentProps<typeof Composer> & { onSuggest: (text: string, repo: string) => void }) {
  const { onSuggest, ...composer } = props
  return (
    <div style={{ ...col({ alignItems: 'center', justifyContent: 'center', gap: 22 }), flexGrow: 1, paddingLeft: 40, paddingRight: 40, paddingBottom: 60 }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} style={col({ alignItems: 'center', gap: 10 })}>
        <DevinMark size={40} />
        <text testId="home-title" style={{ color: C.text, fontSize: 26, fontWeight: 600 }}>What should Devin work on?</text>
        <text style={{ color: C.tertiary, fontSize: 14 }}>Describe a task. Devin plans it, writes the code, tests it, and opens a PR.</text>
      </motion.div>
      <Composer {...composer} big />
      <div style={{ ...row({ gap: 10 }), width: '100%', maxWidth: 780 }}>
        {SUGGESTIONS.map((s) => (
          <div
            key={s.title}
            testId={`suggest-${slugify(s.title).slice(0, 16)}`}
            onClick={() => onSuggest(s.title, s.repo)}
            style={{ ...col({ gap: 8 }), flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, cursor: 'pointer', hover: { backgroundColor: C.hover, borderColor: C.borderStrong } }}
          >
            <Icon name={s.icon} size={14} color={C.accent} />
            <text style={{ color: C.secondary, fontSize: 12.5, lineHeight: 17 }}>{s.title}</text>
            <text style={{ color: C.ghost, fontSize: 11 }}>{s.repo}</text>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────── App ───────────────────────────── */

export function DevinApp({ speed = 1, initialSelected = 's-rate-limit' }: { speed?: number; initialSelected?: string | null }) {
  const [state, dispatch] = useReducer(reducer, undefined, (): State => ({
    sessions: initialSessions(),
    selectedId: initialSelected,
    search: '',
    mode: 'normal',
    panelOpen: true,
    panelTab: 'shell',
    repo: REPOS[1]!,
  }))
  const [draft, setDraft] = useState('')
  const { renderer } = useGpuix()
  const searchRef = useRef<PublicInstance | null>(null)
  const composerRef = useRef<PublicInstance | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const runCount = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state

  const visible = useMemo(() => filterSessions(state.sessions, state.search), [state.sessions, state.search])
  const selected = state.sessions.find((s) => s.id === state.selectedId) ?? null

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'tick', seconds: 7 }), 1000)
    return () => {
      clearInterval(id)
      timers.current.forEach(clearTimeout)
    }
  }, [])

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
        mode: stateRef.current.mode,
        events: [{ kind: 'user', id: `${id}-u`, text: prompt, at: 'Just now' }],
      }
      dispatch({ type: 'create', session })
      setDraft('')
      schedule(id, buildRun(prompt, repo, n))
    },
    [schedule],
  )

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
      dispatch({ type: 'append', sessionId: current.id, event: { kind: 'user', id: `fu-${n}`, text: prompt, at: 'Just now' } })
      setDraft('')
      schedule(current.id, buildFollowUp(prompt, current, n))
    },
    [createSession, schedule],
  )

  const rootRef = useRef<PublicInstance | null>(null)
  const lastKeystroke = useRef<number | undefined>(undefined)
  const select = useCallback(
    (id: string | null) => {
      dispatch({ type: 'select', id })
      if (rootRef.current) renderer?.focusElement?.(rootRef.current.id)
    },
    [renderer],
  )
  const onToggleWork = useCallback((sessionId: string, workId: string) => dispatch({ type: 'toggle-work', sessionId, workId }), [])
  const newSession = useCallback(() => {
    dispatch({ type: 'select', id: null })
    focusComposer()
  }, [focusComposer])

  windowKeyHandler = (event, r) => {
    const key = event.key
    if (event.keystrokeId === lastKeystroke.current) return
    lastKeystroke.current = event.keystrokeId
    const mod = event.modifiers?.cmd || event.modifiers?.ctrl
    const focused = r.getFocusedElementId?.()
    if (mod && key === 'k') {
      event.preventDefault()
      if (searchRef.current) r.focusElement?.(searchRef.current.id)
      return
    }
    if (mod && key === 'n') {
      event.preventDefault()
      newSession()
      return
    }
    if (key === 'escape') {
      if (focused != null && focused === searchRef.current?.id) {
        dispatch({ type: 'search', value: '' })
        r.blur?.()
      }
      return
    }
    if ((key === 'up' || key === 'down') && focused !== composerRef.current?.id) {
      const list = filterSessions(stateRef.current.sessions, stateRef.current.search)
      if (list.length === 0) return
      const idx = list.findIndex((s) => s.id === stateRef.current.selectedId)
      const next = idx < 0 ? 0 : Math.max(0, Math.min(list.length - 1, idx + (key === 'down' ? 1 : -1)))
      event.preventDefault()
      dispatch({ type: 'select', id: list[next]!.id })
    }
  }

  const composerProps = {
    draft,
    setDraft,
    onSubmit: submit,
    mode: state.mode,
    onMode: (mode: AgentMode) => dispatch({ type: 'mode', mode }),
    composerRef,
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      autoFocus
      onKeyDown={(event) => renderer && windowKeyHandler?.(event, renderer)}
      style={{ ...row({ alignItems: 'stretch' }), width: '100%', height: '100%', backgroundColor: C.canvas }}
    >
      <Sidebar state={state} visible={visible} onSelect={select} onNew={newSession} onSearch={(value) => dispatch({ type: 'search', value })} searchRef={searchRef} />
      <div style={{ ...col(), flexGrow: 1, minWidth: 0, height: '100%' }}>
        {selected ? (
          <>
            <SessionHeader session={selected} panelOpen={state.panelOpen} onTogglePanel={() => dispatch({ type: 'panel', open: !state.panelOpen })} />
            <virtual-list key={selected.id} testId="transcript" alignment="top" followTail estimatedItemHeight={160} overdraw={600} style={{ flexGrow: 1, minHeight: 0, paddingTop: 12, paddingBottom: 12 }}>
              {selected.events.map((e) => (
                <EventView key={e.id} event={e} sessionId={selected.id} onToggleWork={onToggleWork} />
              ))}
            </virtual-list>
            <div style={{ ...row({ justifyContent: 'center' }), paddingLeft: 28, paddingRight: 28, paddingTop: 6, paddingBottom: 16, flexShrink: 0 }}>
              <Composer {...composerProps} placeholder={selected.status === 'running' ? 'Message Devin while it works…' : 'Reply to Devin…'} />
            </div>
          </>
        ) : (
          <HomeView {...composerProps} placeholder="e.g. Add dark mode to the settings page and persist the choice" repo={state.repo} onRepo={(repo) => dispatch({ type: 'repo', repo })} onSuggest={(text, repo) => createSession(text, repo)} />
        )}
      </div>
      {selected && (
        <motion.div initial={false} animate={{ width: state.panelOpen ? PANEL_WIDTH : 0 }} transition={{ duration: 0.25, ease: 'easeOut' }} style={{ height: '100%', overflow: 'hidden', flexShrink: 0 }}>
          <RightPanel session={selected} tab={state.panelTab} onTab={(tab) => dispatch({ type: 'panel', tab })} />
        </motion.div>
      )}
    </div>
  )
}
