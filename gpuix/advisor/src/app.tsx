import { useSyncExternalStore, type ReactNode } from 'react'
import { useWindowSize, type StyleDesc } from '@gpuix/react'
import type { Store, View } from './store'
import { shortModel, tierTotals, tokensOf, type AgentRun, type Verdict } from './run'
import { T, SANS, MONO, ROLE_COLOR, VERDICT_COLOR, fmtTokens, fmtSecs } from './theme'

const row: StyleDesc = { display: 'flex', flexDirection: 'row', alignItems: 'center' }
const col: StyleDesc = { display: 'flex', flexDirection: 'column' }
const SPIN = ['◐', '◓', '◑', '◒']

function Txt({ children, size = 13, color = T.text, weight, mono, style }: { children: ReactNode; size?: number; color?: string; weight?: number; mono?: boolean; style?: StyleDesc }) {
  return <text style={{ fontSize: size, lineHeight: Math.round(size * 1.5), color, fontWeight: weight, fontFamily: mono ? MONO : SANS, ...style }}>{children}</text>
}

const clip: StyleDesc = { whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }

/** Mono uppercase micro-label, the only "badge" style in the app. */
function Label({ children, color = T.faint, style }: { children: string; color?: string; style?: StyleDesc }) {
  return <Txt size={10.5} mono color={color} style={{ whiteSpace: 'nowrap', ...style }}>{children.toUpperCase()}</Txt>
}

function Button({ label, hint, onClick, primary, testId, disabled }: { label: string; hint: string; onClick: () => void; primary?: boolean; testId: string; disabled?: boolean }) {
  return (
    <div testId={testId} onClick={disabled ? undefined : onClick} style={{
      ...row, gap: 8, height: 30, paddingLeft: 14, paddingRight: 12, borderRadius: 15, flexShrink: 0,
      backgroundColor: primary ? T.text : '#00000000', borderWidth: 1, borderColor: primary ? T.text : T.lineStrong,
      opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer',
      hover: disabled ? undefined : { backgroundColor: primary ? '#ffffff' : T.raised },
    }}>
      <Txt size={13} weight={500} color={primary ? T.bg : T.text}>{label}</Txt>
      <Txt size={11} mono color={primary ? '#0a0c1080' : T.faint}>{hint}</Txt>
    </div>
  )
}

function Section({ title, right, children, style }: { title: string; right?: ReactNode; children: ReactNode; style?: StyleDesc }) {
  return (
    <div style={{ ...col, gap: 10, ...style }}>
      <div style={{ ...row, justifyContent: 'space-between', gap: 12, height: 16, flexShrink: 0 }}>
        <Label>{title}</Label>
        {right}
      </div>
      {children}
    </div>
  )
}

const spin = () => SPIN[Math.floor(Date.now() / 120) % 4]

function Header({ s, narrow }: { s: Store; narrow: boolean }) {
  const r = s.run
  const running = r.status === 'running'
  const elapsed = r.startedAt ? (r.endedAt ?? Date.now()) - r.startedAt : 0
  const engine = s.opts.engine === 'api' ? 'Anthropic API' : s.opts.engine === 'replay' ? 'Claude Code replay' : 'Claude Code'
  const status = running ? `${spin()} running ${fmtSecs(elapsed)}` : r.status === 'done' ? `done in ${fmtSecs(elapsed)}` : r.status === 'error' ? 'failed' : s.written ? 'setup written' : 'setup not written'
  const statusColor = running ? T.blue : r.status === 'error' ? T.red : T.muted
  return (
    <div style={{ ...col, gap: 4, paddingLeft: 24, paddingRight: 24, paddingTop: 16, paddingBottom: 14, borderBottomWidth: 1, borderColor: T.line, flexShrink: 0 }}>
      <div style={{ ...row, gap: 12, justifyContent: 'space-between' }}>
        <div style={{ ...row, gap: 8, minWidth: 0, flexShrink: 1 }}>
          <Txt size={15} weight={600}>advisor</Txt>
          <Txt size={15} color={T.faint}>/</Txt>
          <Txt size={15} color={T.muted} style={clip}>{s.scan.name}</Txt>
          {!narrow ? <Txt size={12} mono color={T.faint} style={{ ...clip, paddingLeft: 10 }}>{[s.scan.branch, engine].filter(Boolean).join('  ·  ')}</Txt> : null}
        </div>
        <div style={{ ...row, gap: 10, flexShrink: 0 }}>
          <Txt size={12} color={statusColor} mono style={{ paddingRight: 6 }}>{status}</Txt>
          <Button testId="btn-write" label={narrow ? 'Write' : 'Write setup'} hint="w" onClick={() => s.write()} disabled={running} />
          <Button testId="btn-run" label={narrow ? 'Run' : 'Dry run'} hint="r" onClick={() => s.dryRun()} primary disabled={running} />
        </div>
      </div>
      <Txt size={13} color={T.faint} style={clip}>{s.task}</Txt>
    </div>
  )
}

function Tiers({ s, compact }: { s: Store; compact?: boolean }) {
  const totals = tierTotals(s.run)
  const tiers = [
    { role: 'builder' as const, name: 'Builder', model: 'sonnet', note: 'Main session, high effort, writes diffs', tools: 'all tools' },
    { role: 'scout' as const, name: 'Scouts', model: s.agents.scout?.model ?? 'haiku', note: 'Parallel, read-only exploration', tools: s.agents.scout ? `${s.agents.scout.tools.length} read tools` : 'not written' },
    { role: 'advisor' as const, name: 'Advisor', model: s.agents.advisor?.model ?? 'opus', note: 'Read-only, checkpoints 1, 2, 3', tools: s.agents.advisor ? `${s.agents.advisor.tools.length} read tools` : 'not written' },
  ]
  return (
    <Section title="Models">
      <div style={{ ...col }}>
        {tiers.map((t, i) => {
          const wrong = (t.role === 'scout' && t.model !== 'haiku') || (t.role === 'advisor' && t.model !== 'opus')
          const n = totals[t.role]
          return (
            <div key={t.role} testId={`tier-${t.role}`} style={{ ...row, gap: 12, paddingTop: compact ? 7 : 10, paddingBottom: compact ? 7 : 10, borderTopWidth: i ? 1 : 0, borderColor: T.line }}>
              <div style={{ ...col, gap: 1, flexGrow: 1, minWidth: 0 }}>
                <div style={{ ...row, gap: 8 }}>
                  <Txt size={13.5} weight={500}>{t.name}</Txt>
                  <Txt size={12} mono color={wrong ? T.red : t.role === 'advisor' ? T.blue : T.muted}>{t.model}</Txt>
                </div>
                {compact ? null : <Txt size={12} color={T.faint} style={clip}>{t.note}</Txt>}
              </div>
              <div style={{ ...col, alignItems: 'end', flexShrink: 0 }}>
                <Txt size={13} mono color={n.tokens ? T.text : T.faint}>{fmtTokens(n.tokens)}</Txt>
                {compact ? null : <Txt size={11} color={T.faint}>{n.calls ? `${n.calls} run${n.calls > 1 ? 's' : ''}` : t.tools}</Txt>}
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

const STATUS_TEXT = { new: 'new', update: 'changed', same: '' } as const

function Files({ s }: { s: Store }) {
  const pending = s.files.filter((f) => f.status !== 'same').length
  return (
    <Section title="Files" right={<Txt size={11} mono color={pending ? T.muted : T.faint}>{pending ? `${pending} to write` : 'in sync'}</Txt>}>
      <div style={{ ...col, gap: 1 }}>
        {s.files.map((f, i) => {
          const sel = i === s.selected && s.view === 'setup'
          return (
            <div key={f.path} testId={`file-${f.path}`} onClick={() => s.select(i)} style={{
              ...row, gap: 10, height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 4, cursor: 'pointer',
              backgroundColor: sel ? T.selected : '#00000000', hover: { backgroundColor: sel ? T.selected : T.hover },
            }}>
              <Txt size={12} mono color={sel ? T.text : f.status === 'same' ? T.muted : T.text} style={{ ...clip, flexGrow: 1 }}>{f.path}</Txt>
              {f.status === 'same' ? <Txt size={12} color={T.faint}>✓</Txt> : <Label color={T.yellow}>{STATUS_TEXT[f.status]}</Label>}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function Checks({ s }: { s: Store }) {
  const checks = s.checks()
  const passed = checks.filter((c) => c.ok === true).length
  return (
    <Section title="Acceptance" right={<Txt size={11} mono color={T.faint}>{`${passed}/${checks.length}`}</Txt>}>
      <div style={{ ...col, gap: 2 }}>
        {checks.map((c) => (
          <div key={c.id} testId={`check-${c.id}`} style={{ ...row, gap: 10, height: 24 }}>
            <Txt size={12} color={c.ok === true ? T.green : c.ok === false ? T.red : T.faint} style={{ width: 12, flexShrink: 0 }}>{c.ok === true ? '✓' : c.ok === false ? '✕' : '–'}</Txt>
            <Txt size={12.5} color={c.ok === false ? T.red : c.ok === true ? T.text : T.muted} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{c.label}</Txt>
            <Txt size={11} color={T.faint} mono style={{ ...clip, flexGrow: 1, flexShrink: 1, textAlign: 'right' }}>{c.detail}</Txt>
          </div>
        ))}
      </div>
    </Section>
  )
}

const card: StyleDesc = { borderRadius: 6, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, overflow: 'hidden' }

function Preview({ s }: { s: Store }) {
  const f = s.files[s.selected]
  if (!f) return null
  return (
    <div style={{ ...col, ...card, flexGrow: 1, minHeight: 0 }}>
      <div style={{ ...row, gap: 10, height: 40, paddingLeft: 16, paddingRight: 16, justifyContent: 'space-between', borderBottomWidth: 1, borderColor: T.line, flexShrink: 0 }}>
        <Txt size={12.5} mono style={clip}>{f.path}</Txt>
        <Label color={f.status === 'same' ? T.faint : T.yellow}>{f.status === 'same' ? 'written' : f.status === 'new' ? 'will create' : 'will update'}</Label>
      </div>
      <div testId="preview" style={{ ...col, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
        <code code={f.content} path={f.path} showLineNumbers style={{ paddingTop: 14, paddingBottom: 14, paddingLeft: 16, paddingRight: 16, fontSize: 12.5, lineHeight: 20, minWidth: 0 }} theme={{ appearance: 'dark', bg: T.surface, accent: T.blue }} />
      </div>
    </div>
  )
}

function Lane({ a, t0, span }: { a: AgentRun; t0: number; span: number }) {
  const color = ROLE_COLOR[a.role]
  const end = a.endedAt ?? Date.now()
  const left = Math.max(0, (a.startedAt - t0) / span)
  const width = Math.max(0.012, (end - a.startedAt) / span)
  const running = a.status === 'running'
  return (
    <div testId={`lane-${a.label}`} style={{ ...row, gap: 12, height: 32 }}>
      <Txt size={12} color={running ? T.blue : a.status === 'error' ? T.red : T.faint} style={{ width: 12, flexShrink: 0 }}>{running ? spin() : a.status === 'error' ? '✕' : '✓'}</Txt>
      <Txt size={13} weight={500} color={a.role === 'scout' ? T.muted : T.text} style={{ width: 112, flexShrink: 0, whiteSpace: 'nowrap' }}>{a.label}</Txt>
      <Txt size={11.5} mono color={T.faint} style={{ width: 78, flexShrink: 0 }}>{shortModel(a.model)}</Txt>
      <div style={{ ...row, flexGrow: 1, minWidth: 40, height: 4, borderRadius: 2, backgroundColor: T.line, overflow: 'hidden' }}>
        <div style={{ flexGrow: left * 1000, flexBasis: 0, height: 4 }} />
        <div style={{ flexGrow: Math.min(width, 1 - left) * 1000, flexBasis: 0, height: 4, borderRadius: 2, backgroundColor: running ? `${color}99` : color }} />
        <div style={{ flexGrow: Math.max(0, 1 - left - width) * 1000, flexBasis: 0, height: 4 }} />
      </div>
      <Txt size={12} mono color={T.text} style={{ width: 54, flexShrink: 0, textAlign: 'right' }}>{fmtTokens(tokensOf(a))}</Txt>
      <Txt size={12} mono color={T.faint} style={{ width: 46, flexShrink: 0, textAlign: 'right' }}>{fmtSecs(end - a.startedAt)}</Txt>
    </div>
  )
}

function Timeline({ s }: { s: Store }) {
  const r = s.run
  if (!r.agents.length) {
    return (
      <div style={{ ...col, ...card, gap: 4, paddingLeft: 20, paddingRight: 20, paddingTop: 18, paddingBottom: 18, flexShrink: 0 }}>
        <Txt size={14} weight={500}>No dry run yet</Txt>
        <Txt size={13} color={T.muted}>Press r to send the task through the builder, scouts and advisor checkpoints.</Txt>
      </div>
    )
  }
  const t0 = Math.min(...r.agents.map((a) => a.startedAt))
  const span = Math.max(1000, (r.endedAt ?? Date.now()) - t0)
  return (
    <Section title="Agents" style={{ flexShrink: 0 }} right={<Txt size={11} color={T.faint} mono style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{`${r.agents.length} runs  ·  ${fmtTokens(r.agents.reduce((n, a) => n + tokensOf(a), 0))} tokens${r.costUsd ? `  ·  $${r.costUsd.toFixed(2)}` : ''}`}</Txt>}>
      <div style={{ ...col, ...card, paddingLeft: 16, paddingRight: 16, paddingTop: 6, paddingBottom: 6 }}>
        {r.agents.map((a) => <Lane key={a.id} a={a} t0={t0} span={span} />)}
      </div>
    </Section>
  )
}

function Log({ s, limit }: { s: Store; limit: number }) {
  const lines = s.run.log.slice(-Math.max(3, limit))
  return (
    <Section title="Activity" style={{ flexGrow: 1, minHeight: 0 }} right={s.run.error ? <Txt size={11} color={T.red} style={clip}>{s.run.error}</Txt> : undefined}>
      <div testId="log" style={{ ...col, ...card, gap: 1, flexGrow: 1, minHeight: 0, paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10 }}>
        {lines.map((l, i) => {
          const a = s.run.agents.find((x) => x.id === l.agentId)
          const color = l.kind === 'test' ? (l.ok ? T.green : T.red) : l.kind === 'text' ? T.text : l.kind === 'info' ? T.faint : T.muted
          return (
            <div key={`${s.run.log.length - lines.length + i}`} style={{ ...row, gap: 12, alignItems: 'start' }}>
              <Txt size={12} mono color={(a?.role ?? l.role) === 'advisor' ? T.blue : T.faint} style={{ ...clip, width: 104, flexShrink: 0 }}>{a?.label ?? l.role}</Txt>
              <Txt size={12} mono color={color} style={{ ...clip, flexGrow: 1 }}>{l.text.replaceAll(`${s.scan.root}/`, '')}</Txt>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

const CP_TITLE = { 1: 'Plan review', 2: 'Root cause', 3: 'Final review' } as const

const rel = (text: string, root: string) => text.replaceAll(`${root}/`, '')

function Issue({ text }: { text: string }) {
  const t = text
  const m = t.match(/^(\S+:\d+\S*)\s+([\s\S]*)$/)
  return (
    <div style={{ ...col, gap: 1 }}>
      {m ? <Txt size={11.5} mono color={T.text} style={clip}>{m[1]}</Txt> : null}
      <Txt size={12.5} color={T.muted} style={{ minWidth: 0, lineClamp: 2, textOverflow: 'ellipsis' }}>{m ? m[2] : t}</Txt>
    </div>
  )
}

function VerdictCard({ cp, v, rounds, waiting, root }: { cp: 1 | 2 | 3; v?: Verdict; rounds: number; waiting: boolean; root: string }) {
  const color = v ? VERDICT_COLOR[v.verdict] : T.faint
  const idle = !v
  return (
    <div testId={`verdict-${cp}`} style={{ ...col, ...card, gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 14, paddingBottom: idle ? 14 : 16, backgroundColor: idle ? '#00000000' : T.surface }}>
      <div style={{ ...row, gap: 8, justifyContent: 'space-between' }}>
        <div style={{ ...row, gap: 10, minWidth: 0 }}>
          <Label>{`CP${cp}`}</Label>
          <Txt size={14} weight={500} color={idle ? T.muted : T.text}>{CP_TITLE[cp]}</Txt>
          {rounds > 1 ? <Txt size={11} color={T.faint}>{`${rounds} rounds`}</Txt> : null}
        </div>
        {v ? <Label color={color}>{v.verdict}</Label> : <Txt size={12} color={waiting ? T.blue : T.faint}>{waiting ? `${spin()} reviewing` : cp === 2 ? 'only on repeat failures' : 'not run'}</Txt>}
      </div>
      {v ? (
        <div style={{ ...col, gap: 10 }}>
          {v.issues.slice(0, 4).map((issue, i) => <Issue key={i} text={rel(issue, root)} />)}
          {v.issues.length === 0 ? <Txt size={12.5} color={T.muted}>No issues.</Txt> : null}
          {v.fix ? (
            <div style={{ ...col, gap: 4, paddingTop: 12, borderTopWidth: 1, borderColor: T.line }}>
              <Label>Most important fix</Label>
              <Txt size={12.5} color={T.text} style={{ minWidth: 0, lineClamp: 3, textOverflow: 'ellipsis' }}>{rel(v.fix, root)}</Txt>
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
      <div style={{ ...col, gap: 10 }}>
        {([1, 2, 3] as const).map((cp) => {
          const all = r.verdicts.filter((v) => v.checkpoint === cp)
          const waiting = r.agents.some((a) => a.role === 'advisor' && a.status === 'running' && (a.checkpoint ?? 0) === cp)
          return <VerdictCard key={cp} cp={cp} v={all.at(-1)} rounds={all.length} waiting={waiting} root={s.scan.root} />
        })}
      </div>
    </Section>
  )
}

function Tokens({ s }: { s: Store }) {
  const t = tierTotals(s.run)
  const max = Math.max(1, t.builder.tokens, t.scout.tokens, t.advisor.tokens)
  return (
    <Section title="Tokens by tier">
      <div style={{ ...col, gap: 10 }}>
        {(['builder', 'scout', 'advisor'] as const).map((k) => (
          <div key={k} style={{ ...row, gap: 12 }}>
            <Txt size={12.5} color={T.muted} style={{ width: 56, flexShrink: 0 }}>{k}</Txt>
            <div style={{ flexGrow: 1, height: 4, borderRadius: 2, backgroundColor: T.line, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${((t[k].tokens / max) * 100).toFixed(1)}%`, backgroundColor: ROLE_COLOR[k], borderRadius: 2, pointerEvents: 'none' }} />
            </div>
            <Txt size={12} mono style={{ width: 54, textAlign: 'right', flexShrink: 0 }}>{fmtTokens(t[k].tokens)}</Txt>
            <Txt size={11.5} mono color={T.faint} style={{ width: 70, textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0 }}>{`${fmtTokens(t[k].output)} out`}</Txt>
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
      <diff patch={s.diff} wordDiff maxLines={40} style={{ borderRadius: 6, borderWidth: 1, borderColor: T.line, overflow: 'hidden' }} theme={{ appearance: 'dark', bg: T.surface, accent: T.blue }} />
    </Section>
  )
}

function Tabs({ s }: { s: Store }) {
  const tabs: [View, string, string][] = [['setup', 'Setup', '1'], ['run', 'Run', '2'], ['review', 'Review', '3']]
  return (
    <div style={{ ...row, gap: 24, height: 36, borderBottomWidth: 1, borderColor: T.line, flexShrink: 0 }}>
      {tabs.map(([v, label, key]) => {
        const on = s.view === v
        return (
          <div key={v} testId={`tab-${v}`} onClick={() => s.setView(v)} style={{
            ...row, gap: 6, height: 36, borderBottomWidth: 2, borderColor: on ? T.text : '#00000000', cursor: 'pointer',
            hover: { borderColor: on ? T.text : T.lineStrong },
          }}>
            <Txt size={13} weight={500} color={on ? T.text : T.muted}>{label}</Txt>
            <Txt size={11} mono color={T.faint}>{key}</Txt>
          </div>
        )
      })}
    </div>
  )
}

/** Activity rows that fit under the header, tabs and agent lanes, so the newest line is always visible. */
export function logRows(height: number, agents: number, extra: number) {
  const used = 82 + 36 + 72 + (agents ? 54 + agents * 32 : 90) + 72 + extra
  return Math.floor((height - used) / 18)
}

export function App({ store, size: fixed }: { store: Store; size?: { width: number; height: number } }) {
  useSyncExternalStore(store.subscribe, store.snapshot)
  const live = useWindowSize()
  const size = fixed ?? live
  const s = store
  const wide = size.width >= 1180
  const body: StyleDesc = { ...row, alignItems: 'stretch', gap: 32, flexGrow: 1, minHeight: 0, paddingLeft: 24, paddingRight: 24, paddingTop: 20, paddingBottom: 20 }
  return (
    <div testId="app-root" tabIndex={-1} autoFocus style={{ ...col, width: size.width, height: size.height, backgroundColor: T.bg, overflow: 'hidden' }}>
      <Header s={s} narrow={size.width < 760} />
      {wide ? (
        <div style={body}>
          <div style={{ ...col, gap: 28, width: 320, flexShrink: 0, overflowY: 'scroll' }}>
            <Tiers s={s} />
            <Files s={s} />
            <Checks s={s} />
          </div>
          <div style={{ ...col, gap: 20, flexGrow: 1, minWidth: 0 }}>
            <Tabs s={s} />
            {s.view === 'setup' ? <Preview s={s} /> : s.view === 'run' ? (
              <div style={{ ...col, gap: 20, flexGrow: 1, minHeight: 0 }}><Timeline s={s} /><Log s={s} limit={logRows(size.height, s.run.agents.length, 0)} /></div>
            ) : (
              <div testId="review" style={{ ...col, gap: 20, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
                <Timeline s={s} />
                {s.diff ? <Diff s={s} /> : <Txt size={13} color={T.muted}>The builder's diff appears here after the dry run.</Txt>}
              </div>
            )}
          </div>
          <div style={{ ...col, gap: 28, width: 380, flexShrink: 0, overflowY: 'scroll' }}>
            <Verdicts s={s} />
            <Tokens s={s} />
          </div>
        </div>
      ) : (
        <div style={{ ...col, gap: 18, flexGrow: 1, minHeight: 0, paddingLeft: 20, paddingRight: 20, paddingTop: 12, paddingBottom: 16 }}>
          <Tabs s={s} />
          {s.view === 'setup' ? (
            <div style={{ ...col, gap: 20, flexGrow: 1, minHeight: 0 }}>
              <Tiers s={s} compact />
              <div style={{ ...row, alignItems: 'stretch', gap: 20, flexGrow: 1, minHeight: 0 }}>
                {size.width >= 900 ? <div style={{ ...col, width: 300, flexShrink: 0 }}><Files s={s} /></div> : null}
                <Preview s={s} />
              </div>
            </div>
          ) : s.view === 'run' ? (
            <div style={{ ...col, gap: 20, flexGrow: 1, minHeight: 0 }}><Timeline s={s} /><Log s={s} limit={logRows(size.height, s.run.agents.length, 40)} /></div>
          ) : (
            <div testId="review" style={{ ...col, gap: 20, flexGrow: 1, minHeight: 0, overflowY: 'scroll' }}>
              <Verdicts s={s} />
              <Checks s={s} />
              <Tokens s={s} />
              <Diff s={s} />
            </div>
          )}
        </div>
      )}
      {s.notice ? (
        <div style={{ position: 'absolute', right: 24, bottom: 18, ...row, paddingLeft: 14, paddingRight: 14, height: 32, borderRadius: 16, backgroundColor: T.raised, borderWidth: 1, borderColor: T.lineStrong, pointerEvents: 'none' }}>
          <Txt size={12.5} color={T.text}>{s.notice}</Txt>
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
