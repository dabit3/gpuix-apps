import { useSyncExternalStore, type ReactNode } from 'react'
import { useWindowSize, type StyleDesc } from '@gpuix/react'
import type { Store, View } from './store'
import { shortModel, tierTotals, tokensOf, type AgentRun, type Verdict } from './run'
import { T, SANS, MONO, ROLE_COLOR, VERDICT_COLOR, fmtTokens, fmtSecs } from './theme'

const row: StyleDesc = { display: 'flex', flexDirection: 'row', alignItems: 'center' }
const col: StyleDesc = { display: 'flex', flexDirection: 'column' }
const SPIN = ['◐', '◓', '◑', '◒']

function Txt({ children, size = 13, color = T.text, weight, mono, style }: { children: ReactNode; size?: number; color?: string; weight?: number; mono?: boolean; style?: StyleDesc }) {
  return <text style={{ fontSize: size, lineHeight: Math.round(size * 1.45), color, fontWeight: weight, fontFamily: mono ? MONO : SANS, ...style }}>{children}</text>
}

function Pill({ children, color, solid }: { children: ReactNode; color: string; solid?: boolean }) {
  return (
    <div style={{ ...row, paddingLeft: 7, paddingRight: 7, height: 20, borderRadius: 10, backgroundColor: solid ? color : `${color}1f`, borderWidth: 1, borderColor: `${color}55`, flexShrink: 0 }}>
      <Txt size={11} weight={600} color={solid ? T.bg : color} mono>{children}</Txt>
    </div>
  )
}

function Button({ label, hint, onClick, primary, testId, disabled }: { label: string; hint: string; onClick: () => void; primary?: boolean; testId: string; disabled?: boolean }) {
  return (
    <div testId={testId} onClick={disabled ? undefined : onClick} style={{
      ...row, gap: 8, height: 30, paddingLeft: 12, paddingRight: 10, borderRadius: 8, flexShrink: 0,
      backgroundColor: primary ? T.blue : T.raised, borderWidth: 1, borderColor: primary ? T.blue : T.lineStrong,
      opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
      hover: disabled ? undefined : { backgroundColor: primary ? '#91cbff' : T.hover },
    }}>
      <Txt size={13} weight={600} color={primary ? T.bg : T.text}>{label}</Txt>
      <div style={{ ...row, justifyContent: 'center', width: 18, height: 18, borderRadius: 4, backgroundColor: primary ? '#0a0c1033' : T.bg }}>
        <Txt size={11} mono color={primary ? T.bg : T.muted}>{hint}</Txt>
      </div>
    </div>
  )
}

function Section({ title, right, children, style }: { title: string; right?: ReactNode; children: ReactNode; style?: StyleDesc }) {
  return (
    <div style={{ ...col, gap: 8, ...style }}>
      <div style={{ ...row, justifyContent: 'space-between', height: 18 }}>
        <Txt size={11} weight={600} color={T.faint}>{title.toUpperCase()}</Txt>
        {right}
      </div>
      {children}
    </div>
  )
}

function Header({ s, narrow }: { s: Store; narrow: boolean }) {
  const r = s.run
  const running = r.status === 'running'
  const elapsed = r.startedAt ? (r.endedAt ?? Date.now()) - r.startedAt : 0
  const engine = s.opts.engine === 'api' ? 'Anthropic API' : s.opts.engine === 'replay' ? 'Claude Code · replay' : 'Claude Code'
  const status = running ? `${SPIN[Math.floor(Date.now() / 120) % 4]} running ${fmtSecs(elapsed)}` : r.status === 'done' ? `done in ${fmtSecs(elapsed)}` : r.status === 'error' ? 'failed' : s.written ? 'setup written' : 'setup not written'
  const statusColor = running ? T.blue : r.status === 'done' ? T.green : r.status === 'error' ? T.red : s.written ? T.green : T.orange
  return (
    <div style={{ ...col, gap: 10, paddingLeft: 20, paddingRight: 20, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1, borderColor: T.line, flexShrink: 0 }}>
      <div style={{ ...row, gap: 12, justifyContent: 'space-between' }}>
        <div style={{ ...row, gap: 10, minWidth: 0, flexShrink: 1 }}>
          <Txt size={17} weight={700}>advisor</Txt>
          <Txt size={14} color={T.muted} mono style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{s.scan.name}</Txt>
          {!narrow && s.scan.branch ? <Pill color={T.green}>{s.scan.branch}</Pill> : null}
          {!narrow ? <Pill color={T.muted}>{engine}</Pill> : null}
        </div>
        <div style={{ ...row, gap: 8, flexShrink: 0 }}>
          <Txt size={13} color={statusColor} mono>{status}</Txt>
          <Button testId="btn-write" label={narrow ? 'Write' : 'Write setup'} hint="w" onClick={() => s.write()} disabled={running} />
          <Button testId="btn-run" label={narrow ? 'Run' : 'Dry run'} hint="r" onClick={() => s.dryRun()} primary disabled={running} />
        </div>
      </div>
      <div style={{ ...row, gap: 8 }}>
        <Txt size={12} color={T.faint}>task</Txt>
        <Txt size={12} color={T.muted} style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>{s.task}</Txt>
      </div>
    </div>
  )
}

function Tiers({ s, compact }: { s: Store; compact?: boolean }) {
  const totals = tierTotals(s.run)
  const tiers = [
    { role: 'builder' as const, name: 'Builder', model: 'sonnet', note: 'main session · high effort · writes diffs', tools: 'all tools' },
    { role: 'scout' as const, name: 'Scouts', model: s.agents.scout?.model ?? 'haiku', note: 'parallel · read-only exploration', tools: s.agents.scout ? `${s.agents.scout.tools.length} read tools` : 'not written' },
    { role: 'advisor' as const, name: 'Advisor', model: s.agents.advisor?.model ?? 'opus', note: 'read-only · checkpoints 1 · 2 · 3', tools: s.agents.advisor ? `${s.agents.advisor.tools.length} read tools` : 'not written' },
  ]
  return (
    <Section title="Tiers">
      {tiers.map((t) => {
        const wrong = (t.role === 'scout' && t.model !== 'haiku') || (t.role === 'advisor' && t.model !== 'opus')
        return (
          <div key={t.role} testId={`tier-${t.role}`} style={{ ...row, gap: 12, padding: 10, borderRadius: 10, backgroundColor: T.panel, borderWidth: 1, borderColor: wrong ? T.red : T.line }}>
            <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: ROLE_COLOR[t.role] }} />
            <div style={{ ...col, gap: 2, flexGrow: 1, minWidth: 0 }}>
              <div style={{ ...row, gap: 8 }}>
                <Txt size={14} weight={600}>{t.name}</Txt>
                <Pill color={wrong ? T.red : ROLE_COLOR[t.role]}>{t.model}</Pill>
              </div>
              {compact ? null : <Txt size={12} color={T.muted}>{t.note}</Txt>}
            </div>
            <div style={{ ...col, alignItems: 'end', flexShrink: 0 }}>
              <Txt size={13} mono color={totals[t.role].tokens ? T.text : T.faint}>{fmtTokens(totals[t.role].tokens)}</Txt>
              <Txt size={11} color={T.faint}>{totals[t.role].calls ? `${totals[t.role].calls} run${totals[t.role].calls > 1 ? 's' : ''}` : t.tools}</Txt>
            </div>
          </div>
        )
      })}
    </Section>
  )
}

const STATUS_COLOR = { new: T.green, update: T.orange, same: T.faint } as const

function Files({ s }: { s: Store }) {
  const pending = s.files.filter((f) => f.status !== 'same').length
  return (
    <Section title="Files" right={<Txt size={11} color={pending ? T.orange : T.green}>{pending ? `${pending} to write` : 'in sync'}</Txt>}>
      <div style={{ ...col, gap: 2 }}>
        {s.files.map((f, i) => {
          const sel = i === s.selected && s.view === 'setup'
          return (
            <div key={f.path} testId={`file-${f.path}`} onClick={() => s.select(i)} style={{
              ...row, gap: 8, height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 6, cursor: 'pointer',
              backgroundColor: sel ? T.selected : '#00000000', hover: { backgroundColor: sel ? T.selected : T.hover },
            }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: STATUS_COLOR[f.status], flexShrink: 0 }} />
              <Txt size={12} mono color={sel ? T.text : T.muted} style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{f.path}</Txt>
              <Txt size={11} color={STATUS_COLOR[f.status]}>{f.status === 'same' ? 'ok' : f.status}</Txt>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function Checks({ s }: { s: Store }) {
  return (
    <Section title="Acceptance">
      <div style={{ ...col, gap: 4 }}>
        {s.checks().map((c) => (
          <div key={c.id} testId={`check-${c.id}`} style={{ ...row, gap: 8, height: 22 }}>
            <Txt size={13} mono color={c.ok === true ? T.green : c.ok === false ? T.red : T.faint}>{c.ok === true ? '✓' : c.ok === false ? '✗' : '○'}</Txt>
            <Txt size={12} color={c.ok === false ? T.red : T.text} style={{ flexGrow: 1 }}>{c.label}</Txt>
            <Txt size={11} color={T.faint} mono>{c.detail}</Txt>
          </div>
        ))}
      </div>
    </Section>
  )
}

function Preview({ s }: { s: Store }) {
  const f = s.files[s.selected]
  if (!f) return null
  return (
    <div style={{ ...col, flexGrow: 1, minHeight: 0, borderRadius: 10, borderWidth: 1, borderColor: T.line, backgroundColor: T.panel, overflow: 'hidden' }}>
      <div style={{ ...row, gap: 10, height: 36, paddingLeft: 12, paddingRight: 12, borderBottomWidth: 1, borderColor: T.line, flexShrink: 0 }}>
        <Txt size={13} mono weight={600}>{f.path}</Txt>
        <Pill color={STATUS_COLOR[f.status]}>{f.status === 'same' ? 'written' : f.status === 'new' ? 'will create' : 'will update'}</Pill>
      </div>
      <div testId="preview" style={{ ...col, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
        <code code={f.content} path={f.path} showLineNumbers style={{ padding: 12, fontSize: 12.5, lineHeight: 19, minWidth: 0 }} theme={{ appearance: 'dark', bg: T.panel, accent: T.blue }} />
      </div>
    </div>
  )
}

function Lane({ a, t0, span }: { a: AgentRun; t0: number; span: number }) {
  const color = ROLE_COLOR[a.role]
  const end = a.endedAt ?? Date.now()
  const left = Math.max(0, (a.startedAt - t0) / span)
  const width = Math.max(0.012, (end - a.startedAt) / span)
  return (
    <div testId={`lane-${a.label}`} style={{ ...row, gap: 10, height: 30 }}>
      <div style={{ ...row, gap: 8, width: 132, flexShrink: 0 }}>
        <Txt size={13} mono color={a.status === 'running' ? color : a.status === 'error' ? T.red : T.green}>{a.status === 'running' ? SPIN[Math.floor(Date.now() / 120) % 4] : a.status === 'error' ? '✗' : '✓'}</Txt>
        <Txt size={13} weight={600} color={color} style={{ whiteSpace: 'nowrap' }}>{a.label}</Txt>
      </div>
      <Txt size={11} mono color={T.faint} style={{ width: 82, flexShrink: 0 }}>{shortModel(a.model)}</Txt>
      <div style={{ ...row, flexGrow: 1, minWidth: 40, height: 10, borderRadius: 5, backgroundColor: T.raised, overflow: 'hidden' }}>
        <div style={{ flexGrow: left * 1000, flexBasis: 0, height: 10 }} />
        <div style={{ flexGrow: Math.min(width, 1 - left) * 1000, flexBasis: 0, height: 10, borderRadius: 5, backgroundColor: a.status === 'running' ? `${color}aa` : color }} />
        <div style={{ flexGrow: Math.max(0, 1 - left - width) * 1000, flexBasis: 0, height: 10 }} />
      </div>
      <Txt size={12} mono color={T.text} style={{ width: 62, flexShrink: 0, textAlign: 'right' }}>{fmtTokens(tokensOf(a))}</Txt>
      <Txt size={11} mono color={T.faint} style={{ width: 48, flexShrink: 0, textAlign: 'right' }}>{fmtSecs(end - a.startedAt)}</Txt>
    </div>
  )
}

function Timeline({ s }: { s: Store }) {
  const r = s.run
  if (!r.agents.length) {
    return (
      <div style={{ ...col, gap: 6, padding: 16, borderRadius: 10, borderWidth: 1, borderColor: T.line, backgroundColor: T.panel }}>
        <Txt size={14} weight={600}>No dry run yet</Txt>
        <Txt size={13} color={T.muted}>Press r to run the task through builder → scouts → advisor checkpoints.</Txt>
      </div>
    )
  }
  const t0 = Math.min(...r.agents.map((a) => a.startedAt))
  const span = Math.max(1000, (r.endedAt ?? Date.now()) - t0)
  return (
    <Section title="Agents" right={<Txt size={11} color={T.faint} mono style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{`${r.agents.length} runs · ${fmtTokens(r.agents.reduce((n, a) => n + tokensOf(a), 0))} tokens${r.costUsd ? ` · $${r.costUsd.toFixed(2)}` : ''}`}</Txt>}>
      <div style={{ ...col, gap: 2, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.line, backgroundColor: T.panel }}>
        {r.agents.map((a) => <Lane key={a.id} a={a} t0={t0} span={span} />)}
      </div>
    </Section>
  )
}

function Log({ s, limit }: { s: Store; limit: number }) {
  const lines = s.run.log.slice(-Math.max(3, limit))
  return (
    <Section title="Activity" style={{ flexGrow: 1, minHeight: 0 }} right={s.run.error ? <Txt size={11} color={T.red}>{s.run.error}</Txt> : undefined}>
      <div testId="log" style={{ ...col, gap: 1, flexGrow: 1, minHeight: 0, overflow: 'hidden', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: T.line, backgroundColor: T.panel }}>
        {lines.map((l, i) => {
          const a = s.run.agents.find((x) => x.id === l.agentId)
          const color = l.kind === 'test' ? (l.ok ? T.green : T.red) : l.kind === 'text' ? T.text : l.kind === 'info' ? T.faint : T.muted
          return (
            <div key={`${s.run.log.length - lines.length + i}`} style={{ ...row, gap: 10, alignItems: 'start' }}>
              <Txt size={12} mono color={ROLE_COLOR[a?.role ?? l.role]} style={{ width: 106, flexShrink: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{a?.label ?? l.role}</Txt>
              <Txt size={12} mono color={color} style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{l.text.replaceAll(`${s.scan.root}/`, '')}</Txt>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

const CP_TITLE = { 1: 'Plan review', 2: 'Root cause', 3: 'Final review' } as const

function VerdictCard({ cp, v, rounds, waiting }: { cp: 1 | 2 | 3; v?: Verdict; rounds: number; waiting: boolean }) {
  const color = v ? VERDICT_COLOR[v.verdict] : T.faint
  return (
    <div testId={`verdict-${cp}`} style={{ ...col, gap: 8, padding: 12, borderRadius: 10, backgroundColor: T.panel, borderWidth: 1, borderColor: v ? `${color}66` : T.line }}>
      <div style={{ ...row, gap: 8, justifyContent: 'space-between' }}>
        <div style={{ ...row, gap: 8 }}>
          <Txt size={11} mono color={T.faint} style={{ whiteSpace: 'nowrap' }}>{`CP${cp}`}</Txt>
          <Txt size={14} weight={600}>{CP_TITLE[cp]}</Txt>
          {rounds > 1 ? <Txt size={11} color={T.faint}>{rounds} rounds</Txt> : null}
        </div>
        {v ? <Pill color={color} solid>{v.verdict.toUpperCase()}</Pill> : <Txt size={12} color={T.faint}>{waiting ? `${SPIN[Math.floor(Date.now() / 120) % 4]} reviewing` : cp === 2 ? 'only on repeat failures' : 'not run'}</Txt>}
      </div>
      {v ? (
        <div style={{ ...col, gap: 5 }}>
          {v.issues.slice(0, 4).map((issue, i) => (
            <div key={i} style={{ ...row, gap: 8, alignItems: 'start' }}>
              <Txt size={12} mono color={color} style={{ width: 14, flexShrink: 0 }}>{i + 1}</Txt>
              <Txt size={12} color={T.muted} style={{ flexGrow: 1, minWidth: 0, lineClamp: 2, textOverflow: 'ellipsis' }}>{issue.replace(/^\/\S*?\/([^/\s]+\/)/, '$1')}</Txt>
            </div>
          ))}
          {v.issues.length === 0 ? <Txt size={12} color={T.muted}>No issues.</Txt> : null}
          {v.fix ? (
            <div style={{ ...row, gap: 8, alignItems: 'start', paddingTop: 4, borderTopWidth: 1, borderColor: T.line }}>
              <Txt size={11} weight={700} color={color} style={{ flexShrink: 0 }}>FIX</Txt>
              <Txt size={12} color={T.text} style={{ flexGrow: 1, minWidth: 0, lineClamp: 3, textOverflow: 'ellipsis' }}>{v.fix}</Txt>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Verdicts({ s }: { s: Store }) {
  const r = s.run
  return (
    <Section title="Advisor verdicts">
      {([1, 2, 3] as const).map((cp) => {
        const all = r.verdicts.filter((v) => v.checkpoint === cp)
        const waiting = r.agents.some((a) => a.role === 'advisor' && a.status === 'running' && (a.checkpoint ?? 0) === cp)
        return <VerdictCard key={cp} cp={cp} v={all.at(-1)} rounds={all.length} waiting={waiting} />
      })}
    </Section>
  )
}

function Tokens({ s }: { s: Store }) {
  const t = tierTotals(s.run)
  const max = Math.max(1, t.builder.tokens, t.scout.tokens, t.advisor.tokens)
  return (
    <Section title="Tokens by tier">
      <div style={{ ...col, gap: 8, padding: 12, borderRadius: 10, backgroundColor: T.panel, borderWidth: 1, borderColor: T.line }}>
        {(['builder', 'scout', 'advisor'] as const).map((k) => (
          <div key={k} style={{ ...row, gap: 10 }}>
            <Txt size={12} color={ROLE_COLOR[k]} style={{ width: 56 }}>{k}</Txt>
            <div style={{ flexGrow: 1, height: 8, borderRadius: 4, backgroundColor: T.raised, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${((t[k].tokens / max) * 100).toFixed(1)}%`, backgroundColor: ROLE_COLOR[k], borderRadius: 4, pointerEvents: 'none' }} />
            </div>
            <Txt size={12} mono style={{ width: 60, textAlign: 'right' }}>{fmtTokens(t[k].tokens)}</Txt>
            <Txt size={11} mono color={T.faint} style={{ width: 70, textAlign: 'right', whiteSpace: 'nowrap' }}>{`${fmtTokens(t[k].output)} out`}</Txt>
          </div>
        ))}
      </div>
    </Section>
  )
}

function Diff({ s }: { s: Store }) {
  if (!s.diff) return null
  return (
    <Section title="Builder diff" style={{ flexShrink: 0 }}>
      <diff patch={s.diff} wordDiff maxLines={40} style={{ borderRadius: 10, borderWidth: 1, borderColor: T.line, overflow: 'hidden' }} theme={{ appearance: 'dark', bg: T.panel, accent: T.blue }} />
    </Section>
  )
}

function Tabs({ s }: { s: Store }) {
  const tabs: [View, string, string][] = [['setup', 'Setup', '1'], ['run', 'Run', '2'], ['review', 'Review', '3']]
  return (
    <div style={{ ...row, gap: 4, padding: 3, borderRadius: 9, backgroundColor: T.panel, borderWidth: 1, borderColor: T.line, flexShrink: 0 }}>
      {tabs.map(([v, label, key]) => (
        <div key={v} testId={`tab-${v}`} onClick={() => s.setView(v)} style={{
          ...row, gap: 6, flexGrow: 1, justifyContent: 'center', height: 26, borderRadius: 6, cursor: 'pointer',
          backgroundColor: s.view === v ? T.selected : '#00000000', hover: { backgroundColor: s.view === v ? T.selected : T.hover },
        }}>
          <Txt size={13} weight={600} color={s.view === v ? T.text : T.muted}>{label}</Txt>
          <Txt size={11} mono color={T.faint}>{key}</Txt>
        </div>
      ))}
    </div>
  )
}

/** Activity rows that fit under the header, tabs and agent lanes, so the newest line is always visible. */
export function logRows(height: number, agents: number, extra: number) {
  const used = 96 + 36 + 50 + (agents ? 64 + agents * 32 : 90) + 64 + extra
  return Math.floor((height - used) / 18.4)
}

export function App({ store, size: fixed }: { store: Store; size?: { width: number; height: number } }) {
  useSyncExternalStore(store.subscribe, store.snapshot)
  const live = useWindowSize()
  const size = fixed ?? live
  const s = store
  const wide = size.width >= 1180
  const body: StyleDesc = { ...row, alignItems: 'stretch', gap: 18, flexGrow: 1, minHeight: 0, padding: 18 }
  return (
    <div testId="app-root" tabIndex={-1} autoFocus style={{ ...col, width: size.width, height: size.height, backgroundColor: T.bg, overflow: 'hidden' }}>
      <Header s={s} narrow={size.width < 760} />
      {wide ? (
        <div style={body}>
          <div style={{ ...col, gap: 18, width: 340, flexShrink: 0, overflowY: 'scroll' }}>
            <Tiers s={s} />
            <Files s={s} />
            <Checks s={s} />
          </div>
          <div style={{ ...col, gap: 14, flexGrow: 1, minWidth: 0 }}>
            <Tabs s={s} />
            {s.view === 'setup' ? <Preview s={s} /> : s.view === 'run' ? (
              <div style={{ ...col, gap: 14, flexGrow: 1, minHeight: 0 }}><Timeline s={s} /><Log s={s} limit={logRows(size.height, s.run.agents.length, 0)} /></div>
            ) : (
              <div testId="review" style={{ ...col, gap: 14, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
                <Timeline s={s} />
                {s.diff ? <Diff s={s} /> : <Txt size={13} color={T.muted}>The builder's diff appears here after the dry run.</Txt>}
              </div>
            )}
          </div>
          <div style={{ ...col, gap: 18, width: 380, flexShrink: 0, overflowY: 'scroll' }}>
            <Verdicts s={s} />
            <Tokens s={s} />
          </div>
        </div>
      ) : (
        <div style={{ ...col, gap: 14, flexGrow: 1, minHeight: 0, padding: 14 }}>
          <Tabs s={s} />
          {s.view === 'setup' ? (
            <div style={{ ...col, gap: 14, flexGrow: 1, minHeight: 0 }}>
              <Tiers s={s} compact />
              <div style={{ ...row, alignItems: 'stretch', gap: 14, flexGrow: 1, minHeight: 0 }}>
                {size.width >= 900 ? <div style={{ ...col, width: 300, flexShrink: 0 }}><Files s={s} /></div> : null}
                <Preview s={s} />
              </div>
            </div>
          ) : s.view === 'run' ? (
            <div style={{ ...col, gap: 14, flexGrow: 1, minHeight: 0 }}><Timeline s={s} /><Log s={s} limit={logRows(size.height, s.run.agents.length, 40)} /></div>
          ) : (
            <div testId="review" style={{ ...col, gap: 14, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
              <Verdicts s={s} />
              <Checks s={s} />
              <Tokens s={s} />
              <Diff s={s} />
            </div>
          )}
        </div>
      )}
      {s.notice ? (
        <div style={{ position: 'absolute', right: 18, bottom: 14, ...row, paddingLeft: 10, paddingRight: 10, height: 26, borderRadius: 6, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineStrong, pointerEvents: 'none' }}>
          <Txt size={12} color={T.green}>{s.notice}</Txt>
        </div>
      ) : null}
    </div>
  )
}

export interface KeyLike { key?: string; keyChar?: string; text?: string; modifiers?: { ctrl?: boolean; cmd?: boolean; shift?: boolean; alt?: boolean } }

/** Window-level keys. Terminal mode can report a letter as key "space" with the letter elsewhere, so read every field. */
export function handleKey(s: Store, e: KeyLike): boolean {
  const raw = [e.key, e.keyChar, e.text].find((k) => k && k.length === 1 && k !== ' ') ?? e.key ?? ''
  const k = raw.toLowerCase()
  if (e.modifiers?.cmd) return false
  if (k === 'c' && e.modifiers?.ctrl) { s.dispose(); process.exit(0) }
  if (k === 'q') { s.dispose(); process.exit(0) }
  if (k === 'w') { if (s.run.status !== 'running') s.write(); return true }
  if (k === 'r') { s.dryRun(); return true }
  if (k === '1') { s.setView('setup'); return true }
  if (k === '2') { s.setView('run'); return true }
  if (k === '3') { s.setView('review'); return true }
  if (k === 'tab') { const order = ['setup', 'run', 'review'] as const; s.setView(order[(order.indexOf(s.view) + 1) % 3]); return true }
  if (k === 'down' || k === 'j') { s.select(s.selected + 1); return true }
  if (k === 'up' || k === 'k') { s.select(s.selected - 1); return true }
  if (k === 'escape') { s.notice = ''; s.changed(); return true }
  return false
}
