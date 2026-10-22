import { useEffect, useMemo, useRef, useState } from 'react'
import { useGpuix, useWindowSize, type KeyEvent } from '@gpuix/react'
import { writeFileSync } from 'node:fs'
import { repeatedCalls, sessionCost, topToolResults, totalInput, totals } from './analyze'
import { auditMarkdown, findFixes, fmt$, fmtK, projectedCost, type Fix } from './audit'
import { loadSessions } from './load'
import type { PriceSheet } from './prices'
import { C, MONO, SANS, SEG_COLOR, TEXT_THEME, mix, registerFonts } from './theme'
import { SEGMENTS, SEGMENT_LABEL, type Request, type Segment, type Session } from './types'

export type AppProps = {
  paths: string[]
  sheet: PriceSheet
  auditPath: string
  watch?: boolean
  initial?: { sessions: Session[]; files: number }
}

const TABS = ['Overview', 'Offenders', 'Fixes', 'AUDIT.md'] as const
type Tab = (typeof TABS)[number]

type TxtProps = {
  c?: string
  s?: number
  w?: number
  mono?: boolean
  children: React.ReactNode
  grow?: boolean
  testId?: string
  nowrap?: boolean
  align?: 'left' | 'right' | 'center'
  minW?: number
}

function Txt(p: TxtProps) {
  return (
    <text
      testId={p.testId}
      style={{
        color: p.c ?? C.fg,
        fontSize: p.s ?? 13,
        fontWeight: p.w ?? 400,
        fontFamily: p.mono ? MONO : SANS,
        flexGrow: p.grow ? 1 : 0,
        flexShrink: p.grow ? 1 : 0,
        textAlign: p.align,
        ...(p.minW ? { minWidth: p.minW } : {}),
        ...(p.nowrap ? { whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', minWidth: 0 } : {}),
      }}
    >
      {p.children}
    </text>
  )
}

/** Mono uppercase micro-label. */
function Label({ children, c }: { children: string; c?: string }) {
  return (
    <Txt c={c ?? C.fg3} s={11} mono>
      {children.toUpperCase()}
    </Txt>
  )
}

const row = { display: 'flex', flexDirection: 'row', alignItems: 'center' } as const
const col = { display: 'flex', flexDirection: 'column' } as const
const hair = { height: 1, backgroundColor: C.line, flexShrink: 0 } as const

function normKey(e: { key?: string; keyChar?: string }): string {
  const ch = e.keyChar
  if (ch && ch.length === 1 && ch !== ' ' && (e.key === 'space' || !e.key || e.key.length === 1)) return ch.toLowerCase()
  return (e.key ?? '').toLowerCase()
}

function shortPath(p: string): string {
  const cwd = process.cwd()
  if (p === cwd) return '.'
  if (p.startsWith(cwd + '/')) return p.slice(cwd.length + 1) + '/'
  return p.replace(process.env.HOME ?? '~', '~')
}

const cleanPath = (s: string) => s.replace('/Users/sam/code/', '').replace(process.env.HOME ?? '#', '~')
const pct = (a: number, b: number) => `${((a / (b || 1)) * 100).toFixed(1)}%`

export function App({ paths, sheet, auditPath, watch = true, initial }: AppProps) {
  const { renderer } = useGpuix()
  useEffect(() => registerFonts(renderer), [renderer])
  const win = useWindowSize()
  const width = win.width || 1200
  const height = win.height || 800
  const [data, setData] = useState(() => initial ?? loadSessions(paths, sheet))
  const [sel, setSel] = useState<string>('all')
  const [tab, setTab] = useState<Tab>('Overview')
  const [follow, setFollow] = useState(true)
  const [hoverReq, setHoverReq] = useState<number | null>(null)
  const [hoverSeg, setHoverSeg] = useState<Segment | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [fixCursor, setFixCursor] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [pulse, setPulse] = useState<{ id: string; at: number } | null>(null)
  const [updatedAt, setUpdatedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const followRef = useRef(follow)
  followRef.current = follow

  useEffect(() => {
    if (!watch) return
    const t = setInterval(() => {
      const next = loadSessions(paths, sheet)
      setNow(Date.now())
      if (!next.changed) return
      setData(next)
      setUpdatedAt(Date.now())
      const newest = [...next.sessions].sort((a, b) => b.mtime - a.mtime)[0]
      if (newest) {
        setPulse({ id: newest.id, at: Date.now() })
        if (followRef.current) {
          setSel(newest.id)
          setHoverReq(null)
        }
      }
    }, 500)
    return () => clearInterval(t)
  }, [paths.join('\0'), watch])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const sessions = data.sessions
  const current = sessions.find((s) => s.id === sel)
  const scope = current ? [current] : sessions
  const t = useMemo(() => totals(scope), [scope])
  const fixes = useMemo(() => findFixes(scope, sheet), [scope, sheet])
  const offenders = useMemo(() => topToolResults(scope, 30), [scope])
  const repeats = useMemo(() => repeatedCalls(scope).slice(0, 8), [scope])
  const auditMd = useMemo(() => (tab === 'AUDIT.md' ? auditMarkdown(scope, sheet, paths) : ''), [scope, tab])
  const tasks = scope.filter((s) => !s.id.includes('/')).length || scope.length
  const activeFixes = fixes.filter((f) => enabled.has(f.id))
  const after = projectedCost(t.cost, activeFixes)

  const narrow = width < 1000
  const compact = width < 700
  const ids = ['all', ...sessions.map((s) => s.id)]
  const step = (d: number) => {
    const i = Math.max(0, ids.indexOf(sel))
    setSel(ids[(i + d + ids.length) % ids.length]!)
    setFollow(false)
    setHoverReq(null)
  }
  const toggleFix = (id: string) =>
    setEnabled((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const writeAudit = () => {
    const md = auditMarkdown(sessions, sheet, paths)
    writeFileSync(auditPath, md)
    setToast(`Wrote ${auditPath.replace(process.cwd() + '/', './')} · ${findFixes(sessions, sheet).length} findings`)
  }

  const onKey = (e: KeyEvent) => {
    const k = normKey(e)
    if (e.modifiers?.ctrl || e.modifiers?.cmd) return
    if (k >= '1' && k <= '4') setTab(TABS[Number(k) - 1]!)
    else if (k === 'tab') setTab(TABS[(TABS.indexOf(tab) + (e.modifiers?.shift ? 3 : 1)) % 4]!)
    else if (k === 'j' || (k === 'down' && tab !== 'Fixes')) step(1)
    else if (k === 'k' || (k === 'up' && tab !== 'Fixes')) step(-1)
    else if (k === 'down') setFixCursor((c) => Math.min(fixes.length - 1, c + 1))
    else if (k === 'up') setFixCursor((c) => Math.max(0, c - 1))
    else if ((k === 'space' || k === 'enter') && tab === 'Fixes' && fixes[fixCursor]) toggleFix(fixes[fixCursor]!.id)
    else if (k === 'x' && tab === 'Fixes') setEnabled(enabled.size === fixes.length ? new Set() : new Set(fixes.map((f) => f.id)))
    else if (k === 'a') {
      setSel('all')
      setHoverReq(null)
    } else if (k === 'f') {
      setFollow((f) => !f)
      setToast(follow ? 'Follow off' : 'Following the newest transcript')
    } else if (k === 'w') writeAudit()
    else if (k === 'escape') {
      setOpen(null)
      setHoverReq(null)
    }
  }

  const live = updatedAt > 0 && now - updatedAt < 2500
  const padX = compact ? 16 : 28

  return (
    <div
      testId="root"
      tabIndex={-1}
      autoFocus
      onKeyDown={onKey}
      style={{ ...col, width: '100%', height: '100%', backgroundColor: C.bg, paddingLeft: padX, paddingRight: padX, paddingTop: 18, paddingBottom: 12 }}
    >
      {/* header */}
      <div style={{ ...row, gap: 14, flexShrink: 0, height: 30 }}>
        <Txt s={15} w={500}>
          tokscope
        </Txt>
        {!compact && (
          <Txt c={C.fg3} s={12} mono nowrap grow>
            {paths.map(shortPath).join('  ')}
          </Txt>
        )}
        {compact && <div style={{ flexGrow: 1 }} />}
        {watch && !compact && (
          <Txt testId="live" c={live ? C.fg : C.fg3} s={12} mono>
            {live ? 'updated just now' : follow ? `watching ${data.files} files` : 'follow paused'}
          </Txt>
        )}
        <div style={{ ...row, gap: 2, flexShrink: 0 }}>
          {TABS.map((name, i) => (
            <div
              key={name}
              testId={`tab-${i + 1}`}
              onClick={() => setTab(name)}
              style={{
                ...row,
                paddingLeft: compact ? 8 : 11,
                paddingRight: compact ? 8 : 11,
                height: 28,
                borderRadius: 6,
                cursor: 'pointer',
                backgroundColor: tab === name ? C.surfaceHi : C.bg,
                hover: { backgroundColor: tab === name ? C.surfaceHi : C.surface },
              }}
            >
              <Txt c={tab === name ? C.fg : C.fg3} s={13} w={tab === name ? 500 : 400}>
                {name}
              </Txt>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...hair, marginTop: 14 }} />
      <Kpis t={t} tasks={tasks} after={after} activeFixes={activeFixes.length} reported={current?.reportedCostUSD} compact={compact} narrow={narrow} />
      <div style={hair} />

      <div style={{ ...row, alignItems: 'stretch', flexGrow: 1, minHeight: 0 }}>
        {!narrow && <Sidebar sessions={sessions} sel={sel} onSel={(id) => (setSel(id), setFollow(false), setHoverReq(null))} pulse={pulse} now={now} />}
        <div style={{ ...col, flexGrow: 1, flexShrink: 1, minWidth: 0, paddingLeft: narrow ? 0 : 28, paddingTop: 20, gap: 16 }}>
          {narrow && (
            <Switcher
              title={current ? current.title : `All sessions · ${sessions.length}`}
              sub={current ? `${current.project} · ${current.requests.length} requests` : `${t.requests} requests`}
              cost={t.cost}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
            />
          )}
          {sessions.length === 0 ? (
            <Empty paths={paths} />
          ) : tab === 'Overview' ? (
            <Overview scope={scope} t={t} hoverReq={hoverReq} setHoverReq={setHoverReq} hoverSeg={hoverSeg} setHoverSeg={setHoverSeg} compact={compact} chartH={Math.max(64, Math.min(200, height - (narrow ? 640 : 580)))} />
          ) : tab === 'Offenders' ? (
            <Offenders offenders={offenders} repeats={repeats} open={open} setOpen={setOpen} total={t.cost} compact={compact} />
          ) : tab === 'Fixes' ? (
            <Fixes fixes={fixes} enabled={enabled} toggle={toggleFix} cursor={fixCursor} setCursor={setFixCursor} cost={t.cost} after={after} tasks={tasks} />
          ) : (
            <Audit md={auditMd} onWrite={writeAudit} path={auditPath} />
          )}
        </div>
      </div>

      {/* footer */}
      <div style={{ ...hair, marginBottom: 10 }} />
      <div style={{ ...row, gap: 18, flexShrink: 0, height: 16 }}>
        {(compact
          ? [['1-4', 'views'], ['j k', 'session'], ['w', 'write']]
          : [['1-4', 'views'], ['j k', 'session'], ['a', 'all'], ['space', 'toggle fix'], ['w', 'write AUDIT.md'], ['f', follow ? 'follow on' : 'follow off'], ['ctrl-c', 'quit']]
        ).map(([k, v]) => (
          <div key={k} style={{ ...row, gap: 6 }}>
            <Txt c={C.fg2} s={11} mono>
              {k}
            </Txt>
            <Txt c={C.fg3} s={11}>
              {v}
            </Txt>
          </div>
        ))}
        <div style={{ flexGrow: 1 }} />
        {toast && (
          <Txt testId="toast" c={C.fg} s={12} nowrap>
            {toast}
          </Txt>
        )}
      </div>
    </div>
  )
}

function Kpis({ t, tasks, after, activeFixes, reported, compact, narrow }: { t: ReturnType<typeof totals>; tasks: number; after: number; activeFixes: number; reported?: number; compact: boolean; narrow?: boolean }) {
  const all: Array<[string, string, string, string?]> = [
    ['Cost', fmt$(t.cost), reported != null ? `harness reported ${fmt$(reported)}` : `${t.requests} requests`],
    ['Per task', fmt$(t.cost / Math.max(1, tasks)), `${tasks} task${tasks === 1 ? '' : 's'} · ${(t.requests / Math.max(1, tasks)).toFixed(1)} turns`],
    ['Cache hit', `${(t.cacheHit * 100).toFixed(1)}%`, `${t.cacheBreaks} break${t.cacheBreaks === 1 ? '' : 's'}`],
    ['Input', fmtK(totalInput(t.usage)), `${fmtK(t.usage.cacheWrite)} written · ${fmtK(t.usage.input)} uncached`],
    ['Output', fmtK(t.usage.output), `${fmt$(t.segCost.output)} · ${((t.segCost.output / (t.cost || 1)) * 100).toFixed(0)}% of cost`],
    ['With fixes', activeFixes ? fmt$(after / Math.max(1, tasks)) : '—', activeFixes ? `per task · −${(((t.cost - after) / (t.cost || 1)) * 100).toFixed(0)}% with ${activeFixes}` : 'toggle fixes in view 3', activeFixes ? C.green : C.fg4],
  ]
  const items = narrow ? all.filter(([label]) => label !== 'Input' && label !== 'Output') : all
  return (
    <div style={{ ...row, flexShrink: 0, alignItems: 'stretch' }}>
      {items.map(([label, value, sub, color], i) => (
        <div
          key={label}
          testId={`kpi-${label.toLowerCase().replace(/ /g, '-')}`}
          style={{
            ...col,
            gap: 6,
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: i === 0 ? 0 : compact ? 14 : 20,
            paddingRight: 12,
            borderLeftWidth: i === 0 ? 0 : 1,
            borderColor: C.line,
          }}
        >
          <Label>{label}</Label>
          <Txt c={color ?? C.fg} s={compact ? 22 : 26} w={400}>
            {value}
          </Txt>
          <Txt c={C.fg3} s={12} nowrap>
            {sub}
          </Txt>
        </div>
      ))}
    </div>
  )
}

function Sidebar({ sessions, sel, onSel, pulse, now }: { sessions: Session[]; sel: string; onSel: (id: string) => void; pulse: { id: string; at: number } | null; now: number }) {
  const all = sessions.reduce((a, s) => a + sessionCost(s), 0)
  return (
    <div style={{ ...col, width: 300, flexShrink: 0, borderRightWidth: 1, borderColor: C.line, paddingTop: 20, paddingRight: 14, gap: 2, overflowY: 'scroll' }}>
      <div style={{ ...row, paddingLeft: 10, paddingRight: 10, marginBottom: 8, flexShrink: 0 }}>
        <Label>Sessions</Label>
        <div style={{ flexGrow: 1 }} />
        <Txt c={C.fg3} s={11} mono>
          {String(sessions.length)}
        </Txt>
      </div>
      <SideItem active={sel === 'all'} onClick={() => onSel('all')} title="All sessions" sub={`${sessions.length} transcripts`} cost={all} testId="session-all" />
      {sessions.map((s, i) => (
        <SideItem
          key={s.id}
          testId={`session-${i}`}
          active={sel === s.id}
          onClick={() => onSel(s.id)}
          title={s.title}
          sub={`${s.project} · ${s.requests.length} requests`}
          cost={sessionCost(s)}
          flash={pulse?.id === s.id && now - pulse.at < 1500}
          side={s.id.includes('/')}
        />
      ))}
    </div>
  )
}

function SideItem(p: { active: boolean; onClick: () => void; title: string; sub: string; cost: number; flash?: boolean; side?: boolean; testId: string }) {
  const bg = p.flash ? mix(C.fg, C.bg, 0.88) : p.active ? C.surfaceHi : C.bg
  return (
    <div
      testId={p.testId}
      onClick={p.onClick}
      style={{ ...col, gap: 3, paddingTop: 8, paddingBottom: 8, paddingRight: 10, paddingLeft: p.side ? 24 : 10, borderRadius: 6, cursor: 'pointer', flexShrink: 0, backgroundColor: bg, hover: { backgroundColor: p.active ? C.surfaceHi : C.surface } }}
    >
      <div style={{ ...row, gap: 10 }}>
        <Txt c={p.active ? C.fg : C.fg2} s={13} w={p.active ? 500 : 400} nowrap grow>
          {p.title}
        </Txt>
        <Txt c={p.active ? C.fg : C.fg3} s={13}>
          {fmt$(p.cost)}
        </Txt>
      </div>
      <Txt c={C.fg3} s={12} nowrap>
        {p.sub}
      </Txt>
    </div>
  )
}

function Switcher({ title, sub, cost, onPrev, onNext }: { title: string; sub: string; cost: number; onPrev: () => void; onNext: () => void }) {
  const btn = (label: string, f: () => void, id: string) => (
    <div testId={id} onClick={f} style={{ ...row, justifyContent: 'center', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', flexShrink: 0, borderWidth: 1, borderColor: C.line, hover: { backgroundColor: C.surfaceHi } }}>
      <Txt c={C.fg2} s={14}>
        {label}
      </Txt>
    </div>
  )
  return (
    <div style={{ ...row, gap: 12, flexShrink: 0 }}>
      {btn('‹', onPrev, 'prev')}
      <div style={{ ...col, flexGrow: 1, minWidth: 0, gap: 2 }}>
        <Txt c={C.fg} s={13} w={500} nowrap>
          {title}
        </Txt>
        <Txt c={C.fg3} s={12} nowrap>
          {sub}
        </Txt>
      </div>
      <Txt c={C.fg2} s={12} mono>
        {fmt$(cost)}
      </Txt>
      {btn('›', onNext, 'next')}
    </div>
  )
}

function Empty({ paths }: { paths: string[] }) {
  return (
    <div style={{ ...col, flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Txt c={C.fg} s={15} w={500}>
        Waiting for transcripts
      </Txt>
      <Txt c={C.fg3} s={12} mono>
        {`watching ${paths.join(', ')} for *.jsonl`}
      </Txt>
    </div>
  )
}

function Section({ title, right, children, testId }: { title: string; right?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div testId={testId} style={{ ...col, gap: 12, flexShrink: 0 }}>
      <div style={{ ...row, gap: 12, height: 16 }}>
        <Label>{title}</Label>
        <div style={{ flexGrow: 1 }} />
        {right}
      </div>
      {children}
    </div>
  )
}

function Overview(p: { scope: Session[]; t: ReturnType<typeof totals>; hoverReq: number | null; setHoverReq: (n: number | null) => void; hoverSeg: Segment | null; setHoverSeg: (s: Segment | null) => void; compact: boolean; chartH: number }) {
  const reqs: Request[] = p.scope.length === 1 ? p.scope[0]!.requests : p.scope.flatMap((s) => s.requests).sort((a, b) => a.ts - b.ts)
  const t = p.t
  const max = Math.max(1, ...reqs.map((r) => totalInput(r.usage) + r.usage.output))
  const hr = p.hoverReq != null ? reqs[p.hoverReq] : undefined
  const segColor = (s: Segment) => (p.hoverSeg && p.hoverSeg !== s ? mix(SEG_COLOR[s], C.bg, 0.7) : SEG_COLOR[s])
  const order: Segment[] = ['output', 'toolResults', 'context', 'history', 'tools', 'system']
  const gap = reqs.length > 60 ? 1 : 3
  return (
    <div style={{ ...col, gap: 28, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
      <Section title="Where the money goes" right={<Txt c={C.fg3} s={12}>{`${fmt$(t.cost)} across ${fmtK(totalInput(t.usage) + t.usage.output)} tokens`}</Txt>}>
        <div style={{ ...row, height: 8, gap: 2 }}>
          {SEGMENTS.map((s) => (
            <div key={s} style={{ height: 8, borderRadius: 2, flexGrow: Math.max(0.0001, t.segCost[s]), flexBasis: 0, backgroundColor: segColor(s) }} />
          ))}
        </div>
        <div style={{ ...col }}>
          {SEGMENTS.map((s, i) => (
            <div
              key={s}
              testId={`seg-${s}`}
              onMouseEnter={() => p.setHoverSeg(s)}
              onMouseLeave={() => p.setHoverSeg(null)}
              style={{ ...row, gap: 12, height: 30, paddingLeft: 8, paddingRight: 8, borderTopWidth: i === 0 ? 0 : 1, borderColor: C.line, backgroundColor: p.hoverSeg === s ? C.surface : C.bg }}
            >
              <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: SEG_COLOR[s], flexShrink: 0, borderWidth: s === 'system' ? 1 : 0, borderColor: C.lineHi }} />
              <Txt c={p.hoverSeg === s ? C.fg : C.fg2} s={13} grow nowrap>
                {SEGMENT_LABEL[s]}
              </Txt>
              {!p.compact && (
                <Txt c={C.fg3} s={12} mono align="right" minW={96}>
                  {`${fmtK(t.seg[s])} tok`}
                </Txt>
              )}
              <Txt c={C.fg} s={13} mono align="right" minW={64}>
                {fmt$(t.segCost[s])}
              </Txt>
              <Txt c={C.fg3} s={12} mono align="right" minW={52}>
                {pct(t.segCost[s], t.cost)}
              </Txt>
            </div>
          ))}
        </div>
      </Section>

      <Section
        testId="timeline"
        title={`Every request · ${reqs.length}`}
        right={
          <div style={{ ...row, gap: 8 }}>
            <div style={{ width: 10, height: 2, borderRadius: 1, backgroundColor: C.red }} />
            <Txt c={C.fg3} s={12}>
              cache break
            </Txt>
          </div>
        }
      >
        <div style={{ ...col, gap: 0 }}>
          <div style={{ ...row, alignItems: 'flex-end', height: p.chartH + 8, gap }} onMouseLeave={() => p.setHoverReq(null)}>
            {reqs.map((r, i) => {
              const total = totalInput(r.usage) + r.usage.output
              const h = (total / max) * p.chartH
              const dim = p.hoverReq != null && p.hoverReq !== i
              return (
                <div
                  key={r.id + i}
                  testId={`req-${i}`}
                  onMouseMove={() => p.hoverReq !== i && p.setHoverReq(i)}
                  style={{ ...col, flexGrow: 1, flexBasis: 0, minWidth: 2, maxWidth: 28, height: p.chartH + 8, justifyContent: 'flex-end' }}
                >
                  {r.cacheBreak ? <div style={{ height: 2, borderRadius: 1, backgroundColor: C.red, marginBottom: 3, flexShrink: 0, pointerEvents: 'none' }} /> : null}
                  <div style={{ ...col, height: Math.max(2, h), borderTopLeftRadius: 2, borderTopRightRadius: 2, overflow: 'hidden', flexShrink: 0, pointerEvents: 'none' }}>
                    {order.map((s) => (
                      <div key={s} style={{ flexGrow: Math.max(0, r.seg[s]), flexBasis: 0, pointerEvents: 'none', backgroundColor: dim ? mix(segColor(s), C.bg, 0.6) : segColor(s) }} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={hair} />
        </div>
        <div style={{ ...row, gap: 12, height: 18 }}>
          {hr ? (
            <>
              <Txt testId="req-readout" c={C.fg} s={12} w={500} mono>
                {`turn ${(p.hoverReq ?? 0) + 1}`}
              </Txt>
              <Txt c={C.fg3} s={12} mono nowrap grow>
                {`${hr.model.replace('claude-', '')}${hr.sidechain ? ' (sub-agent)' : ''} · in ${fmtK(totalInput(hr.usage))} = ${fmtK(hr.usage.cacheRead)} read + ${fmtK(hr.usage.cacheWrite)} write · out ${fmtK(hr.usage.output)}${hr.cacheBreak ? ` · ${hr.cacheBreak.reason}` : ''}`}
              </Txt>
              <Txt c={hr.cacheBreak ? C.red : C.fg} s={12} mono>
                {fmt$(hr.cost)}
              </Txt>
            </>
          ) : (
            <Txt c={C.fg3} s={12}>
              Hover a request to see what it carried. Every turn resends the prefix and all history.
            </Txt>
          )}
        </div>
      </Section>
    </div>
  )
}

function Offenders({ offenders, repeats, open, setOpen, total, compact }: { offenders: ReturnType<typeof topToolResults>; repeats: ReturnType<typeof repeatedCalls>; open: string | null; setOpen: (s: string | null) => void; total: number; compact: boolean }) {
  return (
    <div style={{ ...col, gap: 28, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
      <Section title="Tool results by carry cost" right={!compact ? <Txt c={C.fg3} s={12}>size × turns resent, billed at cache rates</Txt> : undefined}>
        <div style={{ ...col }}>
          {offenders.map((o, i) => {
            const isOpen = open === o.uuid
            return (
              <div key={o.uuid} style={{ ...col, flexShrink: 0, borderTopWidth: i === 0 ? 0 : 1, borderColor: C.line }}>
                <div
                  testId={`off-${i}`}
                  onClick={() => setOpen(isOpen ? null : o.uuid)}
                  style={{ ...row, gap: 14, height: 34, paddingLeft: 8, paddingRight: 8, borderRadius: 4, cursor: 'pointer', backgroundColor: isOpen ? C.surfaceHi : C.bg, hover: { backgroundColor: isOpen ? C.surfaceHi : C.surface } }}
                >
                  <Txt c={C.fg3} s={12} mono minW={40}>
                    {o.tool}
                  </Txt>
                  <Txt c={isOpen ? C.fg : C.fg2} s={12} mono nowrap grow>
                    {cleanPath(o.label.replace(/^\S+ /, ''))}
                  </Txt>
                  <Txt c={C.fg3} s={12} mono align="right" minW={90}>
                    {`${fmtK(o.tokens)} × ${o.carried}`}
                  </Txt>
                  <Txt c={C.fg} s={13} mono align="right" minW={60}>
                    {fmt$(o.cost)}
                  </Txt>
                </div>
                {isOpen && (
                  <div style={{ ...col, gap: 10, marginTop: 4, marginBottom: 12, marginLeft: 8, marginRight: 8, padding: 14, borderRadius: 6, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }}>
                    <Txt c={C.fg3} s={12}>
                      {`${o.session} · ${pct(o.cost, total)} of spend · fix: head/tail window, full copy on disk`}
                    </Txt>
                    <code code={o.preview.split('\n').slice(0, 14).join('\n')} language="ts" style={{ fontSize: 12, fontFamily: MONO, height: 14 * 17, overflow: 'hidden' }} theme={{ ...TEXT_THEME, bg: C.surface }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>
      {repeats.length > 0 && (
        <Section title="Repeated identical calls">
          <div style={{ ...col }}>
            {repeats.map((r, i) => (
              <div key={r.key} testId={`rep-${i}`} style={{ ...row, gap: 14, height: 32, paddingLeft: 8, paddingRight: 8, flexShrink: 0, borderTopWidth: i === 0 ? 0 : 1, borderColor: C.line }}>
                <Txt c={C.fg} s={12} mono minW={40}>
                  {`${r.count}×`}
                </Txt>
                <Txt c={C.fg2} s={12} mono nowrap grow>
                  {cleanPath(r.label)}
                </Txt>
                <Txt c={C.fg3} s={12} mono>
                  {`${fmtK(r.wastedTokens)} tok re-fetched`}
                </Txt>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Fixes({ fixes, enabled, toggle, cursor, setCursor, cost, after, tasks }: { fixes: Fix[]; enabled: Set<string>; toggle: (id: string) => void; cursor: number; setCursor: (n: number) => void; cost: number; after: number; tasks: number }) {
  return (
    <div style={{ ...col, gap: 20, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
      <div style={{ ...row, alignItems: 'flex-end', gap: 36, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ ...col, gap: 6 }}>
          <Label>Cost per task</Label>
          <Txt c={C.fg} s={26}>
            {fmt$(cost / Math.max(1, tasks))}
          </Txt>
        </div>
        <div style={{ ...col, gap: 6 }}>
          <Label>With selected fixes</Label>
          <Txt testId="fix-after" c={enabled.size ? C.green : C.fg4} s={26}>
            {fmt$(after / Math.max(1, tasks))}
          </Txt>
        </div>
        <div style={{ ...col, flexGrow: 1, flexShrink: 1, minWidth: 200, paddingBottom: 5 }}>
          <Txt c={C.fg3} s={12}>
            {enabled.size ? `${enabled.size} of ${fixes.length} fixes · projected from the recorded transcripts, confirm with an eval` : 'space toggles the selected fix · x toggles all'}
          </Txt>
        </div>
      </div>
      <div style={{ ...col }}>
        {fixes.map((f, i) => {
          const on = enabled.has(f.id)
          const cur = i === cursor
          return (
            <div
              key={f.id}
              testId={`fix-${f.id}`}
              onClick={() => (setCursor(i), toggle(f.id))}
              style={{ ...row, alignItems: 'flex-start', gap: 14, paddingTop: 14, paddingBottom: 14, paddingLeft: 12, paddingRight: 12, borderRadius: 6, flexShrink: 0, cursor: 'pointer', borderTopWidth: i === 0 ? 0 : 1, borderColor: C.line, backgroundColor: cur ? C.surfaceHi : C.bg, hover: { backgroundColor: cur ? C.surfaceHi : C.surface } }}
            >
              <div style={{ ...row, justifyContent: 'center', width: 16, height: 16, marginTop: 2, borderRadius: 4, flexShrink: 0, borderWidth: 1, borderColor: on ? C.fg : C.lineHi, backgroundColor: on ? C.fg : C.bg }}>
                {on && (
                  <Txt c={C.bg} s={11} w={600}>
                    ✓
                  </Txt>
                )}
              </div>
              <div style={{ ...col, gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                <div style={{ ...row, gap: 10 }}>
                  <Txt c={on || cur ? C.fg : C.fg2} s={14} w={500} nowrap grow>
                    {f.title}
                  </Txt>
                  <Badge l={f.ship === 'ship' ? 'ship' : 'flag'} />
                  <Txt c={C.green} s={13} mono align="right" minW={64}>
                    {`−${fmt$(f.savings)}`}
                  </Txt>
                </div>
                <Txt c={C.fg3} s={13}>
                  {f.change}
                </Txt>
                <div style={{ ...row, gap: 14 }}>
                  <Txt c={C.fg3} s={11} mono>
                    {f.flag}
                  </Txt>
                  <Txt c={C.fg4} s={11} mono>
                    {`${f.area.toLowerCase()} · ${pct(f.savings, cost)} of spend`}
                  </Txt>
                </div>
                {cur &&
                  f.evidence.slice(0, 3).map((e, k) => (
                    <Txt key={k} c={C.fg3} s={11} mono nowrap>
                      {cleanPath(e)}
                    </Txt>
                  ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Badge({ l }: { l: string }) {
  return (
    <div style={{ ...row, paddingLeft: 6, paddingRight: 6, height: 18, borderRadius: 4, borderWidth: 1, borderColor: C.lineHi, flexShrink: 0 }}>
      <Txt c={C.fg3} s={10} mono>
        {l.toUpperCase()}
      </Txt>
    </div>
  )
}

function Audit({ md, onWrite, path }: { md: string; onWrite: () => void; path: string }) {
  return (
    <div style={{ ...col, gap: 16, flexGrow: 1, minHeight: 0 }}>
      <div style={{ ...row, gap: 12, flexShrink: 0 }}>
        <Txt c={C.fg3} s={12} mono nowrap grow>
          {path.replace(process.cwd() + '/', './')}
        </Txt>
        <div testId="write-audit" onClick={onWrite} style={{ ...row, gap: 8, paddingLeft: 14, paddingRight: 14, height: 30, borderRadius: 15, cursor: 'pointer', backgroundColor: C.fg, hover: { backgroundColor: '#ffffff' } }}>
          <Txt c={C.bg} s={13} w={500}>
            Write AUDIT.md
          </Txt>
          <Txt c={mix(C.bg, C.fg, 0.45)} s={11} mono>
            w
          </Txt>
        </div>
      </div>
      <div style={hair} />
      <div style={{ ...col, flexGrow: 1, minHeight: 0, overflowY: 'scroll', paddingRight: 8 }}>
        <markdown source={md} theme={TEXT_THEME} style={{ fontSize: 13, fontFamily: SANS, flexShrink: 0, width: '100%', minWidth: 0 }} />
      </div>
    </div>
  )
}
