import { useEffect, useMemo, useRef, useState } from 'react'
import { useWindowSize, type KeyEvent } from '@gpuix/react'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repeatedCalls, sessionCost, topToolResults, totalInput, totals } from './analyze'
import { auditMarkdown, findFixes, fmt$, fmtK, projectedCost, type Fix } from './audit'
import { loadSessions } from './load'
import type { PriceSheet } from './prices'
import { C, MONO, SEG_COLOR, mix } from './theme'
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

function Txt(p: { c?: string; s?: number; w?: number; mono?: boolean; children: React.ReactNode; grow?: boolean; testId?: string; nowrap?: boolean; align?: 'left' | 'right' | 'center' }) {
  return (
    <text
      testId={p.testId}
      style={{
        color: p.c ?? C.fg,
        fontSize: p.s ?? 13,
        fontWeight: p.w ?? 400,
        fontFamily: p.mono ? MONO : undefined,
        flexGrow: p.grow ? 1 : 0,
        flexShrink: p.grow ? 1 : 0,
        textAlign: p.align,
        ...(p.nowrap ? { whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', minWidth: 0 } : {}),
      }}
    >
      {p.children}
    </text>
  )
}

const row = { display: 'flex', flexDirection: 'row', alignItems: 'center' } as const
const col = { display: 'flex', flexDirection: 'column' } as const

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

export function App({ paths, sheet, auditPath, watch = true, initial }: AppProps) {
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
  const pad = compact ? 12 : 18

  return (
    <div
      testId="root"
      tabIndex={-1}
      autoFocus
      onKeyDown={onKey}
      style={{ ...col, width: '100%', height: '100%', backgroundColor: C.bg, padding: pad, gap: 12 }}
    >
      {/* header */}
      <div style={{ ...row, gap: 14, flexShrink: 0 }}>
        <div style={{ ...row, gap: 8, flexShrink: 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.yellow }} />
          <Txt s={16} w={700}>
            tokscope
          </Txt>
        </div>
        {!compact && (
          <Txt c={C.dim} s={12} mono nowrap grow>
            {paths.map(shortPath).join('  ')}
          </Txt>
        )}
        {compact && <div style={{ flexGrow: 1 }} />}
        {watch && (
          <div testId="live" style={{ ...row, gap: 6, flexShrink: 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live ? C.green : mix(C.green, C.bg, 0.55) }} />
            <Txt c={live ? C.green : C.dim} s={12}>
              {live ? 'updated' : follow ? `watching ${data.files} files` : 'paused follow'}
            </Txt>
          </div>
        )}
        <div style={{ ...row, gap: 2, flexShrink: 0, backgroundColor: C.panel, borderRadius: 8, padding: 3, borderWidth: 1, borderColor: C.line }}>
          {TABS.map((name, i) => (
            <div
              key={name}
              testId={`tab-${i + 1}`}
              onClick={() => setTab(name)}
              style={{
                ...row,
                gap: 6,
                paddingLeft: compact ? 8 : 12,
                paddingRight: compact ? 8 : 12,
                paddingTop: 4,
                paddingBottom: 4,
                borderRadius: 6,
                cursor: 'pointer',
                backgroundColor: tab === name ? C.panelHi : C.panel,
                hover: { backgroundColor: C.panelHi },
              }}
            >
              {!compact && (
                <Txt c={C.faint} s={11} mono>
                  {i + 1}
                </Txt>
              )}
              <Txt c={tab === name ? C.fg : C.muted} s={12} w={tab === name ? 600 : 400}>
                {name}
              </Txt>
            </div>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <Kpis t={t} tasks={tasks} after={after} activeFixes={activeFixes.length} reported={current?.reportedCostUSD} compact={compact} narrow={narrow} />

      <div style={{ ...row, alignItems: 'stretch', gap: 14, flexGrow: 1, minHeight: 0 }}>
        {!narrow && <Sidebar sessions={sessions} sel={sel} onSel={(id) => (setSel(id), setFollow(false), setHoverReq(null))} pulse={pulse} now={now} />}
        <div style={{ ...col, flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 10 }}>
          {narrow && <Switcher title={current ? current.title : `All sessions · ${sessions.length}`} sub={current ? `${current.project} · ${current.requests.length} requests` : `${t.requests} requests`} onPrev={() => step(-1)} onNext={() => step(1)} />}
          {sessions.length === 0 ? (
            <Empty paths={paths} />
          ) : tab === 'Overview' ? (
            <Overview scope={scope} t={t} hoverReq={hoverReq} setHoverReq={setHoverReq} hoverSeg={hoverSeg} setHoverSeg={setHoverSeg} compact={compact} chartH={Math.max(70, Math.min(220, height - (narrow ? 720 : 660)))} />
          ) : tab === 'Offenders' ? (
            <Offenders offenders={offenders} repeats={repeats} open={open} setOpen={setOpen} total={t.cost} />
          ) : tab === 'Fixes' ? (
            <Fixes fixes={fixes} enabled={enabled} toggle={toggleFix} cursor={fixCursor} setCursor={setFixCursor} cost={t.cost} after={after} tasks={tasks} />
          ) : (
            <Audit md={auditMd} onWrite={writeAudit} path={auditPath} />
          )}
        </div>
      </div>

      {/* footer */}
      <div style={{ ...row, gap: 16, flexShrink: 0, height: 18 }}>
        {(compact ? [['1-4', 'views'], ['j/k', 'session'], ['w', 'AUDIT.md']] : [['1-4', 'views'], ['j/k', 'session'], ['a', 'all'], ['space', 'toggle fix'], ['w', 'write AUDIT.md'], ['f', follow ? 'follow on' : 'follow off'], ['ctrl-c', 'quit']]).map(([k, v]) => (
          <div key={k} style={{ ...row, gap: 6 }}>
            <Txt c={C.muted} s={11} mono>
              {k}
            </Txt>
            <Txt c={C.faint} s={11}>
              {v}
            </Txt>
          </div>
        ))}
        <div style={{ flexGrow: 1 }} />
        {toast && (
          <Txt testId="toast" c={C.green} s={12} nowrap>
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
    ['Cache hit', `${(t.cacheHit * 100).toFixed(1)}%`, `${t.cacheBreaks} break${t.cacheBreaks === 1 ? '' : 's'}`, t.cacheHit > 0.8 ? C.green : t.cacheHit > 0.5 ? C.yellow : C.red],
    ['Input', fmtK(totalInput(t.usage)), `${fmtK(t.usage.cacheWrite)} written · ${fmtK(t.usage.input)} uncached`],
    ['Output', fmtK(t.usage.output), `${fmt$(t.segCost.output)} · ${((t.segCost.output / (t.cost || 1)) * 100).toFixed(0)}% of cost`],
    ['With fixes', activeFixes ? fmt$(after / Math.max(1, tasks)) : '—', activeFixes ? `per task · −${(((t.cost - after) / (t.cost || 1)) * 100).toFixed(0)}% with ${activeFixes}` : 'toggle fixes in view 3', activeFixes ? C.green : C.dim],
  ]
  const items = narrow ? all.filter(([label]) => label !== 'Input' && label !== 'Output') : all
  return (
    <div style={{ ...row, flexWrap: 'wrap', gap: 10, flexShrink: 0, alignItems: 'stretch' }}>
      {items.map(([label, value, sub, color]) => (
        <div
          key={label}
          testId={`kpi-${label.toLowerCase().replace(/ /g, '-')}`}
          style={{ ...col, gap: 3, flexGrow: 1, flexBasis: compact ? 140 : 160, minWidth: compact ? 130 : 150, backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, paddingLeft: 14, paddingRight: 14, paddingTop: 10, paddingBottom: 10 }}
        >
          <Txt c={C.dim} s={11} w={500}>
            {label.toUpperCase()}
          </Txt>
          <Txt c={color ?? C.fg} s={compact ? 20 : 24} w={600} mono>
            {value}
          </Txt>
          <Txt c={C.dim} s={11} nowrap>
            {sub}
          </Txt>
        </div>
      ))}
    </div>
  )
}

function Sidebar({ sessions, sel, onSel, pulse, now }: { sessions: Session[]; sel: string; onSel: (id: string) => void; pulse: { id: string; at: number } | null; now: number }) {
  const all = sessions.reduce((a, s) => a + sessionCost(s), 0)
  const max = Math.max(0.0001, ...sessions.map(sessionCost))
  return (
    <div style={{ ...col, width: 290, flexShrink: 0, backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 6, gap: 2, overflowY: 'scroll' }}>
      <SideItem active={sel === 'all'} onClick={() => onSel('all')} title={`All sessions`} sub={`${sessions.length} transcripts`} cost={all} frac={1} testId="session-all" />
      <div style={{ height: 1, backgroundColor: C.line, marginTop: 4, marginBottom: 4, flexShrink: 0 }} />
      {sessions.map((s, i) => (
        <SideItem
          key={s.id}
          testId={`session-${i}`}
          active={sel === s.id}
          onClick={() => onSel(s.id)}
          title={s.title}
          sub={`${s.project} · ${s.requests.length} req · ${s.models[0]?.replace('claude-', '') ?? ''}`}
          cost={sessionCost(s)}
          frac={sessionCost(s) / max}
          flash={pulse?.id === s.id && now - pulse.at < 1500}
          side={s.id.includes('/')}
          breaks={s.requests.filter((r) => r.cacheBreak).length}
        />
      ))}
    </div>
  )
}

function SideItem(p: { active: boolean; onClick: () => void; title: string; sub: string; cost: number; frac: number; flash?: boolean; side?: boolean; breaks?: number; testId: string }) {
  const bg = p.flash ? mix(C.green, C.panel, 0.82) : p.active ? C.panelHi : C.panel
  return (
    <div
      testId={p.testId}
      onClick={p.onClick}
      style={{ ...col, gap: 4, padding: 9, paddingLeft: p.side ? 22 : 10, borderRadius: 7, cursor: 'pointer', flexShrink: 0, backgroundColor: bg, borderWidth: 1, borderColor: p.active ? C.lineHi : bg, hover: { backgroundColor: C.panelHi } }}
    >
      <div style={{ ...row, gap: 8 }}>
        <Txt c={p.active ? C.fg : '#d5dbe2'} s={12} w={p.active ? 600 : 400} nowrap grow>
          {p.title}
        </Txt>
        <Txt c={C.fg} s={12} mono>
          {fmt$(p.cost)}
        </Txt>
      </div>
      <div style={{ ...row, gap: 8 }}>
        <Txt c={C.dim} s={11} nowrap grow>
          {p.sub}
        </Txt>
        {!!p.breaks && (
          <Txt c={C.red} s={11}>
            {`${p.breaks}× miss`}
          </Txt>
        )}
      </div>
      <div style={{ ...row, height: 3, borderRadius: 2, backgroundColor: C.line }}>
        <div style={{ width: `${Math.max(2, p.frac * 100)}%`, height: 3, borderRadius: 2, backgroundColor: p.active ? C.yellow : mix(C.yellow, C.panel, 0.45) }} />
      </div>
    </div>
  )
}

function Switcher({ title, sub, onPrev, onNext }: { title: string; sub: string; onPrev: () => void; onNext: () => void }) {
  const btn = (label: string, f: () => void, id: string) => (
    <div testId={id} onClick={f} style={{ ...row, justifyContent: 'center', width: 28, height: 28, borderRadius: 6, backgroundColor: C.panelHi, cursor: 'pointer', flexShrink: 0, hover: { backgroundColor: C.lineHi } }}>
      <Txt c={C.fg} s={14}>
        {label}
      </Txt>
    </div>
  )
  return (
    <div style={{ ...row, gap: 10, flexShrink: 0, backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 8 }}>
      {btn('‹', onPrev, 'prev')}
      <div style={{ ...col, flexGrow: 1, minWidth: 0 }}>
        <Txt c={C.fg} s={12} w={600} nowrap>
          {title}
        </Txt>
        <Txt c={C.dim} s={11} nowrap>
          {sub}
        </Txt>
      </div>
      {btn('›', onNext, 'next')}
    </div>
  )
}

function Empty({ paths }: { paths: string[] }) {
  return (
    <div style={{ ...col, flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Txt c={C.fg} s={15} w={600}>
        Waiting for transcripts
      </Txt>
      <Txt c={C.dim} s={12} mono>
        {`watching ${paths.join(', ')} for *.jsonl`}
      </Txt>
    </div>
  )
}

function Panel({ title, right, children, grow, testId }: { title: string; right?: React.ReactNode; children: React.ReactNode; grow?: boolean; testId?: string }) {
  return (
    <div testId={testId} style={{ ...col, gap: 10, backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 14, flexShrink: grow ? 1 : 0, flexGrow: grow ? 1 : 0, minHeight: 0 }}>
      <div style={{ ...row, gap: 10 }}>
        <Txt c={C.muted} s={11} w={600} grow>
          {title.toUpperCase()}
        </Txt>
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
  const segColor = (s: Segment) => (p.hoverSeg && p.hoverSeg !== s ? mix(SEG_COLOR[s], C.panel, 0.75) : SEG_COLOR[s])
  const order: Segment[] = ['output', 'toolResults', 'context', 'history', 'tools', 'system']
  return (
    <div style={{ ...col, gap: 10, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
      <Panel title="Where the money goes" right={<Txt c={C.dim} s={11}>{`${fmt$(t.cost)} across ${fmtK(totalInput(t.usage) + t.usage.output)} tokens`}</Txt>}>
        <div style={{ ...row, height: 14, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
          {SEGMENTS.map((s) => (
            <div key={s} style={{ height: 14, flexGrow: Math.max(0.0001, t.segCost[s]), flexBasis: 0, backgroundColor: segColor(s) }} />
          ))}
        </div>
        <div style={{ ...col, gap: 1 }}>
          {SEGMENTS.map((s) => (
            <div
              key={s}
              testId={`seg-${s}`}
              onMouseEnter={() => p.setHoverSeg(s)}
              onMouseLeave={() => p.setHoverSeg(null)}
              style={{ ...row, gap: 10, paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6, borderRadius: 6, backgroundColor: p.hoverSeg === s ? C.panelHi : C.panel }}
            >
              <div style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: SEG_COLOR[s], flexShrink: 0 }} />
              <Txt c={C.fg} s={12} nowrap grow>
                {SEGMENT_LABEL[s]}
              </Txt>
              {!p.compact && (
                <Txt c={C.dim} s={12} mono>
                  {`${fmtK(t.seg[s])} tok`.padStart(11)}
                </Txt>
              )}
              <Txt c={C.fg} s={12} mono>
                {fmt$(t.segCost[s]).padStart(7)}
              </Txt>
              <div style={{ ...row, width: p.compact ? 60 : 120, height: 4, borderRadius: 2, backgroundColor: C.line, flexShrink: 0 }}>
                <div style={{ height: 4, borderRadius: 2, width: `${Math.max(1, (t.segCost[s] / (t.cost || 1)) * 100)}%`, backgroundColor: SEG_COLOR[s] }} />
              </div>
              <Txt c={C.muted} s={12} mono>
                {`${((t.segCost[s] / (t.cost || 1)) * 100).toFixed(1)}%`.padStart(6)}
              </Txt>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        testId="timeline"
        title={`Every request · ${reqs.length}`}
        right={
          <div style={{ ...row, gap: 12 }}>
            <Legend c={C.green} l="cache read" />
            <Legend c={C.yellow} l="cache write" />
            <Legend c={C.red} l="cache break" />
          </div>
        }
      >
        <div style={{ ...row, alignItems: 'flex-end', height: p.chartH + 8, gap: reqs.length > 60 ? 1 : 3 }} onMouseLeave={() => p.setHoverReq(null)}>
          {reqs.map((r, i) => {
            const total = totalInput(r.usage) + r.usage.output
            const h = (total / max) * p.chartH
            const dim = p.hoverReq != null && p.hoverReq !== i
            return (
              <div
                key={r.id + i}
                testId={`req-${i}`}
                onMouseMove={() => p.hoverReq !== i && p.setHoverReq(i)}
                style={{ ...col, flexGrow: 1, flexBasis: 0, minWidth: 2, maxWidth: 34, height: p.chartH + 8, justifyContent: 'flex-end', gap: 0 }}
              >
                {r.cacheBreak ? <div style={{ height: 4, borderRadius: 2, backgroundColor: C.red, marginBottom: 3, flexShrink: 0, pointerEvents: 'none' }} /> : null}
                <div style={{ ...col, height: Math.max(2, h), borderRadius: 2, overflow: 'hidden', flexShrink: 0, pointerEvents: 'none' }}>
                  {order.map((s) => (
                    <div key={s} style={{ flexGrow: Math.max(0, r.seg[s]), flexBasis: 0, pointerEvents: 'none', backgroundColor: dim ? mix(segColor(s), C.panel, 0.6) : segColor(s) }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ ...row, height: 5, gap: reqs.length > 60 ? 1 : 3 }}>
          {reqs.map((r, i) => {
            const inp = totalInput(r.usage) || 1
            return (
              <div key={i} style={{ ...row, flexGrow: 1, flexBasis: 0, minWidth: 2, maxWidth: 34, height: 5, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: 5, flexGrow: r.usage.cacheRead / inp, flexBasis: 0, backgroundColor: C.green }} />
                <div style={{ height: 5, flexGrow: (r.usage.cacheWrite + r.usage.input) / inp, flexBasis: 0, backgroundColor: r.cacheBreak ? C.red : C.yellow }} />
              </div>
            )
          })}
        </div>
        <div style={{ ...row, gap: 10, height: 18 }}>
          {hr ? (
            <>
              <Txt testId="req-readout" c={C.fg} s={12} w={600} mono>
                {`turn ${(p.hoverReq ?? 0) + 1}`}
              </Txt>
              <Txt c={C.muted} s={12} mono nowrap grow>
                {`${hr.model.replace('claude-', '')}${hr.sidechain ? ' (sub-agent)' : ''} · in ${fmtK(totalInput(hr.usage))} = ${fmtK(hr.usage.cacheRead)} read + ${fmtK(hr.usage.cacheWrite)} write · out ${fmtK(hr.usage.output)}${hr.cacheBreak ? ` · ${hr.cacheBreak.reason}` : ''}`}
              </Txt>
              <Txt c={hr.cacheBreak ? C.red : C.fg} s={12} mono>
                {fmt$(hr.cost)}
              </Txt>
            </>
          ) : (
            <Txt c={C.dim} s={12}>
              Hover a request to see what it carried. Every turn resends the prefix and all history.
            </Txt>
          )}
        </div>
      </Panel>
    </div>
  )
}

function Legend({ c, l }: { c: string; l: string }) {
  return (
    <div style={{ ...row, gap: 5 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c }} />
      <Txt c={C.dim} s={11}>
        {l}
      </Txt>
    </div>
  )
}

function Offenders({ offenders, repeats, open, setOpen, total }: { offenders: ReturnType<typeof topToolResults>; repeats: ReturnType<typeof repeatedCalls>; open: string | null; setOpen: (s: string | null) => void; total: number }) {
  const max = Math.max(0.0001, ...offenders.map((o) => o.cost))
  return (
    <div style={{ ...col, gap: 10, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
      <Panel title="Tool results by what they cost to carry" right={<Txt c={C.dim} s={11}>size × turns resent, billed at cache rates</Txt>}>
        <div style={{ ...col, gap: 2 }}>
          {offenders.map((o, i) => (
            <div key={o.uuid} style={{ ...col, flexShrink: 0 }}>
              <div
                testId={`off-${i}`}
                onClick={() => setOpen(open === o.uuid ? null : o.uuid)}
                style={{ ...row, gap: 10, padding: 6, borderRadius: 6, cursor: 'pointer', backgroundColor: open === o.uuid ? C.panelHi : C.panel, hover: { backgroundColor: C.panelHi } }}
              >
                <Txt c={C.faint} s={11} mono>
                  {String(i + 1).padStart(2)}
                </Txt>
                <div style={{ ...row, paddingLeft: 6, paddingRight: 6, borderRadius: 4, backgroundColor: mix(C.yellow, C.panel, 0.85), flexShrink: 0 }}>
                  <Txt c={C.yellow} s={11} mono>
                    {o.tool}
                  </Txt>
                </div>
                <Txt c={C.fg} s={12} mono nowrap grow>
                  {o.label.replace(/^\S+ /, '').replace(process.env.HOME ?? '#', '~').replace('/Users/sam/code/', '')}
                </Txt>
                <Txt c={C.dim} s={12} mono>
                  {`${fmtK(o.tokens)} × ${o.carried}`.padStart(11)}
                </Txt>
                <div style={{ ...row, width: 80, height: 4, borderRadius: 2, backgroundColor: C.line, flexShrink: 0 }}>
                  <div style={{ height: 4, borderRadius: 2, width: `${(o.cost / max) * 100}%`, backgroundColor: C.yellow }} />
                </div>
                <Txt c={C.fg} s={12} mono>
                  {fmt$(o.cost).padStart(7)}
                </Txt>
              </div>
              {open === o.uuid && (
                <div style={{ ...col, gap: 6, marginLeft: 30, marginBottom: 6, padding: 10, borderRadius: 8, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line }}>
                  <Txt c={C.muted} s={11}>
                    {`${o.session} · ${((o.cost / (total || 1)) * 100).toFixed(1)}% of spend · fix: head/tail window + full copy on disk`}
                  </Txt>
                  <code code={o.preview.split('\n').slice(0, 14).join('\n')} language="ts" style={{ fontSize: 11, height: 14 * 15, overflow: 'hidden' }} theme={{ bg: C.bg, text: C.fg }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>
      {repeats.length > 0 && (
        <Panel title="Repeated identical calls">
          {repeats.map((r, i) => (
            <div key={r.key} testId={`rep-${i}`} style={{ ...row, gap: 10, padding: 4, flexShrink: 0 }}>
              <Txt c={C.red} s={12} mono>
                {`${r.count}×`}
              </Txt>
              <Txt c={C.fg} s={12} mono nowrap grow>
                {r.label}
              </Txt>
              <Txt c={C.dim} s={12} mono>
                {`${fmtK(r.wastedTokens)} tok re-fetched`}
              </Txt>
            </div>
          ))}
        </Panel>
      )}
    </div>
  )
}

function Fixes({ fixes, enabled, toggle, cursor, setCursor, cost, after, tasks }: { fixes: Fix[]; enabled: Set<string>; toggle: (id: string) => void; cursor: number; setCursor: (n: number) => void; cost: number; after: number; tasks: number }) {
  const max = Math.max(0.0001, ...fixes.map((f) => f.savings))
  return (
    <div style={{ ...col, gap: 10, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
      <div style={{ ...row, gap: 14, flexShrink: 0, paddingLeft: 4, paddingRight: 4, flexWrap: 'wrap' }}>
        <Txt c={C.muted} s={13}>
          Cost per task
        </Txt>
        <Txt c={C.fg} s={20} w={600} mono>
          {fmt$(cost / Math.max(1, tasks))}
        </Txt>
        <Txt c={C.dim} s={16}>
          →
        </Txt>
        <Txt testId="fix-after" c={enabled.size ? C.green : C.dim} s={20} w={600} mono>
          {fmt$(after / Math.max(1, tasks))}
        </Txt>
        <Txt c={C.dim} s={12} grow>
          {enabled.size ? `${enabled.size} of ${fixes.length} fixes · projection from replaying transcripts, confirm with an eval` : 'space toggles the selected fix · x toggles all'}
        </Txt>
      </div>
      {fixes.map((f, i) => {
        const on = enabled.has(f.id)
        const cur = i === cursor
        return (
          <div
            key={f.id}
            testId={`fix-${f.id}`}
            onClick={() => (setCursor(i), toggle(f.id))}
            style={{ ...row, alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 10, flexShrink: 0, cursor: 'pointer', backgroundColor: on ? mix(C.green, C.panel, 0.92) : C.panel, borderWidth: 1, borderColor: cur ? C.blue : on ? mix(C.green, C.panel, 0.55) : C.line, hover: { borderColor: C.lineHi } }}
          >
            <div style={{ ...row, justifyContent: 'center', width: 18, height: 18, marginTop: 1, borderRadius: 5, flexShrink: 0, borderWidth: 1.5, borderColor: on ? C.green : C.lineHi, backgroundColor: on ? C.green : C.panel }}>
              {on && (
                <Txt c={C.bg} s={12} w={700}>
                  ✓
                </Txt>
              )}
            </div>
            <div style={{ ...col, gap: 5, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
              <div style={{ ...row, gap: 8 }}>
                <Txt c={C.fg} s={13} w={600} nowrap grow>
                  {f.title}
                </Txt>
                <Pill c={f.ship === 'ship' ? C.green : C.blue} l={f.ship === 'ship' ? 'ship' : 'flag'} />
                <Txt c={C.green} s={14} w={600} mono>
                  {`−${fmt$(f.savings)}`}
                </Txt>
              </div>
              <div style={{ ...row, gap: 8 }}>
                <Txt c={C.dim} s={11} mono>
                  {f.area.toLowerCase()}
                </Txt>
                <Txt c={C.faint} s={11} mono nowrap>
                  {f.flag}
                </Txt>
                <div style={{ ...row, flexGrow: 1, height: 3, borderRadius: 2, backgroundColor: C.line }}>
                  <div style={{ height: 3, borderRadius: 2, width: `${(f.savings / max) * 100}%`, backgroundColor: C.green }} />
                </div>
                <Txt c={C.muted} s={11} mono>
                  {`${((f.savings / (cost || 1)) * 100).toFixed(1)}%`}
                </Txt>
              </div>
              <Txt c={C.muted} s={12}>
                {f.change}
              </Txt>
              {cur && f.evidence.slice(0, 3).map((e, k) => (
                <Txt key={k} c={C.dim} s={11} mono nowrap>
                  {`· ${e.replace('/Users/sam/code/', '')}`}
                </Txt>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Pill({ c, l }: { c: string; l: string }) {
  return (
    <div style={{ ...row, paddingLeft: 7, paddingRight: 7, paddingTop: 1, paddingBottom: 1, borderRadius: 9, borderWidth: 1, borderColor: mix(c, C.panel, 0.5), flexShrink: 0 }}>
      <Txt c={c} s={10} w={600}>
        {l.toUpperCase()}
      </Txt>
    </div>
  )
}

function Audit({ md, onWrite, path }: { md: string; onWrite: () => void; path: string }) {
  return (
    <div style={{ ...col, gap: 10, flexGrow: 1, minHeight: 0 }}>
      <div style={{ ...row, gap: 10, flexShrink: 0 }}>
        <Txt c={C.dim} s={12} mono nowrap grow>
          {path.replace(process.cwd() + '/', './')}
        </Txt>
        <div testId="write-audit" onClick={onWrite} style={{ ...row, gap: 6, paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 7, cursor: 'pointer', backgroundColor: C.blue, hover: { backgroundColor: mix(C.blue, C.fg, 0.25) } }}>
          <Txt c={C.bg} s={12} w={600}>
            Write AUDIT.md
          </Txt>
          <Txt c={mix(C.bg, C.blue, 0.4)} s={11} mono>
            w
          </Txt>
        </div>
      </div>
      <div style={{ ...col, flexGrow: 1, minHeight: 0, overflowY: 'scroll', backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 18 }}>
        <markdown source={md} theme={{ bg: C.panel, text: C.fg, textMuted: C.muted, accent: C.blue, border: C.line, codeWash: C.bg }} style={{ fontSize: 13, flexShrink: 0 }} />
      </div>
    </div>
  )
}
