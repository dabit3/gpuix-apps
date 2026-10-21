import { useEffect, useState, type ReactNode } from 'react'
import { render, useWindowSize } from '@gpuix/react'
import type { Controller, Tab } from './controller'
import type { QueryEvent, Status } from './dns/stats'
import { alpha, mix, type Theme } from './theme'
import { clock, layout, mmss, ms, n0, pct, qtypeName, truncate, uptime, type Layout } from './ui/format'

const MONO = 'Menlo'
export interface KeyLike { key?: string; keyChar?: string; modifiers?: { ctrl?: boolean; cmd?: boolean; shift?: boolean; alt?: boolean } }

/** Terminal mode can report a printable key as key "space" with the real character in keyChar. */
export function keyName(e: KeyLike): string {
  const k = (e.key ?? '').toLowerCase()
  const ch = e.keyChar
  if (ch && ch.length === 1 && ch !== ' ' && (k === 'space' || k === '')) return ch.toLowerCase()
  return k
}

export interface UiState { sel: number; typing: boolean }

/** Keyboard map shared by the app and the tests. Returns true when the key did something. */
export function handleKey(c: Controller, ui: UiState, e: KeyLike, rows: () => QueryEvent[]): boolean {
  const k = keyName(e)
  if (e.modifiers?.cmd || e.modifiers?.ctrl) return false
  if (ui.typing) {
    if (k === 'escape') { ui.typing = false; return true }
    return false
  }
  const list = rows()
  const pick = () => list[Math.min(ui.sel, list.length - 1)]
  switch (k) {
    case 'up': case 'k': ui.sel = Math.max(0, ui.sel - 1); return true
    case 'down': case 'j': ui.sel = Math.min(Math.max(0, list.length - 1), ui.sel + 1); return true
    case 'home': ui.sel = 0; return true
    case 'b': { const r = pick(); if (r) c.addRule('deny', r.name); return !!r }
    case 'a': { const r = pick(); if (r) c.addRule('allow', r.name); return !!r }
    case 'space': c.toggleBlocking(); return true
    case 'p': c.pause(c.dns.pausedFor > 0 ? 0 : 5); return true
    case 'm': c.toggleMode(); return true
    case 'c': c.toggleCache(); return true
    case 't': void c.runBench(1000); return true
    case 'u': void c.updateList(); return true
    case 'x': c.clearStats(); ui.sel = 0; return true
    case '1': c.setTab('live'); return true
    case '2': c.setTab('top'); return true
    case '3': c.setTab('rules'); return true
    case 'tab': c.setTab(c.tab === 'live' ? 'top' : c.tab === 'top' ? 'rules' : 'live'); return true
    case 'escape': if (c.filter) { c.setFilter(''); return true } return false
  }
  return false
}

export function visibleRows(c: Controller): QueryEvent[] {
  const f = c.filter.trim().toLowerCase()
  const out: QueryEvent[] = []
  const r = c.dns.stats.recent
  for (const e of r) {
    if (f && !e.name.includes(f) && e.status !== f) continue
    out.push(e)
  }
  return out
}

const statusColor = (t: Theme, s: Status) => (s === 'blocked' ? t.blocked : s === 'cached' ? t.cached : s === 'failed' ? t.failed : s === 'allowed' ? t.warn : t.forwarded)

function Txt({ c, s = 13, w = 400, mono = false, children, testId }: { c: string; s?: number; w?: number; mono?: boolean; children: ReactNode; testId?: string }) {
  return <text testId={testId} style={{ color: c, fontSize: s, fontWeight: w as never, ...(mono ? { fontFamily: MONO } : {}) }}>{children}</text>
}

function Button({ t, label, onClick, testId, active = false, tone, small = false }: { t: Theme; label: string; onClick: () => void; testId: string; active?: boolean; tone?: string; small?: boolean }) {
  const color = tone ?? t.accent
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        height: small ? 24 : 28, paddingLeft: small ? 9 : 12, paddingRight: small ? 9 : 12, borderRadius: 6,
        borderWidth: 1, borderColor: active ? alpha(color, 0.7) : t.line,
        backgroundColor: active ? alpha(color, 0.16) : t.panel, cursor: 'pointer',
        hover: { backgroundColor: active ? alpha(color, 0.26) : t.raised, borderColor: alpha(color, 0.6) },
      }}
    >
      <Txt c={active ? color : t.fg} s={small ? 12 : 13} w={600}>{label}</Txt>
    </div>
  )
}

function Panel({ t, title, right, children, grow = 1, testId }: { t: Theme; title: string; right?: ReactNode; children: ReactNode; grow?: number; testId?: string }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', flexGrow: grow, flexShrink: grow ? 1 : 0, ...(grow ? { flexBasis: 0 } : {}), minWidth: 0, minHeight: 0, backgroundColor: t.panel, borderRadius: 10, borderWidth: 1, borderColor: t.line, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, height: 40, paddingLeft: 14, paddingRight: 10, borderBottomWidth: 1, borderColor: t.line, flexShrink: 0 }}>
        <Txt c={t.dim} s={12} w={700}>{title.toUpperCase()}</Txt>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>{right}</div>
      </div>
      {children}
    </div>
  )
}

function Header({ c, t, L }: { c: Controller; t: Theme; L: Layout }) {
  const d = c.dns
  const paused = d.pausedFor > 0
  const state = !d.enabled ? { label: 'OFF', color: t.failed } : paused ? { label: `PAUSED ${mmss(d.pausedFor)}`, color: t.warn } : { label: 'BLOCKING', color: t.forwarded }
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: state.color }} />
        <Txt c={t.fg} s={L.kind === 'tiny' ? 17 : 20} w={800}>sinkhole</Txt>
        <Txt c={t.dim} s={13} mono testId="listen-addr">{`${d.host}:${d.port}`}</Txt>
        {L.kind === 'wide' ? <Txt c={t.faint} s={13}>ESP32-C3 DNS blocker design, emulated on macOS</Txt> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <div testId="block-state" onClick={() => c.toggleBlocking()} style={{ display: 'flex', alignItems: 'center', height: 28, paddingLeft: 12, paddingRight: 12, borderRadius: 14, backgroundColor: alpha(state.color, 0.16), borderWidth: 1, borderColor: alpha(state.color, 0.6), cursor: 'pointer', hover: { backgroundColor: alpha(state.color, 0.28) } }}>
          <Txt c={state.color} s={12} w={800} mono>{state.label}</Txt>
        </div>
        {L.kind === 'tiny' ? null : (
          <>
            <Button t={t} small testId="pause-5" label="5m" onClick={() => c.pause(5)} />
            <Button t={t} small testId="pause-30" label="30m" onClick={() => c.pause(30)} />
            <Button t={t} small testId="pause-60" label="60m" onClick={() => c.pause(60)} />
          </>
        )}
      </div>
    </div>
  )
}

function Card({ t, label, value, sub, color, testId }: { t: Theme; label: string; value: string; sub: string; color: string; testId: string }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 12, paddingLeft: 14, borderRadius: 10, backgroundColor: t.panel, borderWidth: 1, borderColor: t.line }}>
      <Txt c={t.dim} s={11} w={700}>{label.toUpperCase()}</Txt>
      <Txt c={color} s={26} w={800} mono>{value}</Txt>
      <Txt c={t.faint} s={12}>{sub}</Txt>
    </div>
  )
}

function Cards({ c, t, L }: { c: Controller; t: Theme; L: Layout }) {
  const s = c.dns.stats
  const lat = s.latency()
  const hit = c.dns.cache.hits + c.dns.cache.misses ? (c.dns.cache.hits / (c.dns.cache.hits + c.dns.cache.misses)) * 100 : 0
  const all = [
    <Card key="q" testId="card-total" t={t} label="Queries" value={n0(s.total)} sub={`up ${uptime(Date.now() - s.startedAt)}`} color={t.fg} />,
    <Card key="b" testId="card-blocked" t={t} label="Blocked" value={pct(s.blockedPct)} sub={`${n0(s.blocked)} sunk`} color={t.blocked} />,
    <Card key="r" testId="card-rate" t={t} label="Rate" value={`${s.qps(5).toFixed(1)}`} sub="queries / s" color={t.accent} />,
    <Card key="c" testId="card-cache" t={t} label="Cache" value={c.dns.cacheEnabled ? pct(hit) : 'off'} sub={`${c.dns.cache.size}/${c.dns.cache.capacity} entries`} color={t.cached} />,
    <Card key="u" testId="card-upstream" t={t} label="Upstream" value={lat.p50 ? ms(lat.p50) : '–'} sub={`p95 ${lat.p95 ? ms(lat.p95) : '–'} · ${c.dns.inFlight} in flight`} color={t.forwarded} />,
  ]
  return <div style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>{all.slice(0, L.cards)}</div>
}

function Spark({ c, t, L }: { c: Controller; t: Theme; L: Layout }) {
  const series = c.dns.stats.series(L.kind === 'tiny' ? 60 : 120)
  const max = Math.max(4, ...series.map((b) => b.total))
  const H = L.spark
  return (
    <div testId="sparkline" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, paddingBottom: 10, borderRadius: 10, backgroundColor: t.panel, borderWidth: 1, borderColor: t.line }}>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt c={t.dim} s={11} w={700}>{`QUERIES / SECOND · LAST ${series.length}S`}</Txt>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
          <Txt c={t.forwarded} s={11} w={700}>■ forwarded</Txt>
          <Txt c={t.cached} s={11} w={700}>■ cached</Txt>
          <Txt c={t.blocked} s={11} w={700}>■ blocked</Txt>
          <Txt c={t.faint} s={11} mono>{`peak ${max}`}</Txt>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: H }}>
        {series.map((b, i) => {
          const scale = (v: number) => (v / max) * H
          const other = b.total - b.blocked - b.cached
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', flexGrow: 1, flexBasis: 0, height: H, minWidth: 1 }}>
              {b.total === 0 ? <div style={{ height: 2, backgroundColor: t.line, borderRadius: 1 }} /> : null}
              {b.blocked ? <div style={{ height: scale(b.blocked), backgroundColor: t.blocked, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} /> : null}
              {b.cached ? <div style={{ height: scale(b.cached), backgroundColor: t.cached }} /> : null}
              {other > 0 ? <div style={{ height: scale(other), backgroundColor: t.forwarded }} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Chip({ t, status }: { t: Theme; status: Status }) {
  const col = statusColor(t, status)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 82, height: 20, borderRadius: 4, backgroundColor: alpha(col, 0.14), flexShrink: 0 }}>
      <Txt c={col} s={11} w={800} mono>{status.toUpperCase()}</Txt>
    </div>
  )
}

function LogRow({ c, t, e, selected, onSelect, L, index }: { c: Controller; t: Theme; e: QueryEvent; selected: boolean; onSelect: () => void; L: Layout; index: number }) {
  const ruled = c.dns.matcher.allow.has(e.name) ? 'allow' : c.dns.matcher.deny.has(e.name) ? 'deny' : null
  return (
    <div
      testId={`log-row-${index}`}
      onClick={onSelect}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 30, paddingLeft: 12, paddingRight: 8, flexShrink: 0, backgroundColor: selected ? alpha(t.accent, 0.14) : undefined, borderLeftWidth: 2, borderColor: selected ? t.accent : 'transparent', cursor: 'pointer', hover: { backgroundColor: selected ? alpha(t.accent, 0.18) : t.raised } }}
    >
      <Txt c={t.faint} s={12} mono>{clock(e.ts)}</Txt>
      <Chip t={t} status={e.status} />
      <div style={{ width: 42, flexShrink: 0 }}><Txt c={t.dim} s={12} mono>{qtypeName(e.qtype)}</Txt></div>
      <div style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden' }}><Txt c={e.status === 'blocked' ? t.blocked : t.fg} s={13} mono>{truncate(e.name, L.logName)}</Txt></div>
      {L.kind !== 'tiny' ? <Txt c={t.faint} s={12} mono>{truncate(e.answer, L.kind === 'wide' ? 22 : 14)}</Txt> : null}
      <div style={{ width: 56, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}><Txt c={t.dim} s={12} mono>{e.status === 'blocked' || e.status === 'cached' ? '0 ms' : ms(e.ms)}</Txt></div>
      {selected ? (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
          {ruled !== 'deny' && e.status !== 'blocked' ? <Button t={t} small tone={t.blocked} active testId="row-block" label="Block" onClick={() => c.addRule('deny', e.name)} /> : null}
          {ruled !== 'allow' && e.status === 'blocked' ? <Button t={t} small tone={t.forwarded} active testId="row-allow" label="Allow" onClick={() => c.addRule('allow', e.name)} /> : null}
          {ruled ? <Button t={t} small testId="row-unrule" label={`Un-${ruled}`} onClick={() => c.removeRule(ruled, e.name)} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function LiveLog({ c, t, L, ui, rows, setSel, setTyping }: { c: Controller; t: Theme; L: Layout; ui: UiState; rows: QueryEvent[]; setSel: (i: number) => void; setTyping: (b: boolean) => void }) {
  const filter = (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 26, width: L.kind === 'tiny' ? 120 : 200, paddingLeft: 10, paddingRight: 6, borderRadius: 6, backgroundColor: t.bg, borderWidth: 1, borderColor: ui.typing ? t.accent : t.line }}>
      <input
        testId="filter-input"
        value={c.filter}
        placeholder="filter  /"
        onChange={(ev) => c.setFilter(ev.value ?? '')}
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
        onSubmit={() => setTyping(false)}
        style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: t.fg, fontFamily: MONO }}
      />
    </div>
  )
  return (
    <Panel t={t} title={`Live queries${c.filter ? ` · ${rows.length} match` : ''}`} right={filter} grow={L.kind === 'wide' ? 3 : 1} testId="live-panel">
      {rows.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 18 }}>
          <Txt c={t.dim} s={14}>{c.filter ? 'Nothing matches the filter.' : 'Waiting for queries…'}</Txt>
          <Txt c={t.faint} s={13} mono>{`dig @127.0.0.1 -p ${c.dns.port} doubleclick.net`}</Txt>
        </div>
      ) : (
        <div testId="log-scroll" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'scroll', scrollbarColor: alpha(t.fg, 0.2), scrollbarWidth: 5, paddingTop: 4, paddingBottom: 4 }}>
          {rows.map((e, i) => <LogRow key={e.seq} c={c} t={t} e={e} index={i} L={L} selected={i === ui.sel} onSelect={() => setSel(i)} />)}
        </div>
      )}
    </Panel>
  )
}

function TopList({ c, t, kind, n, testId }: { c: Controller; t: Theme; kind: 'blocked' | 'allowed'; n: number; testId: string }) {
  const top = c.dns.stats.top(kind, n)
  const max = Math.max(1, ...top.map((x) => x.count))
  const col = kind === 'blocked' ? t.blocked : t.forwarded
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, paddingTop: 10 }}>
      {top.length === 0 ? <Txt c={t.faint} s={13}>none yet</Txt> : null}
      {top.map((x) => (
        <div key={x.name} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Txt c={t.fg} s={13} mono>{truncate(x.name, 34)}</Txt>
            <Txt c={t.dim} s={12} mono>{n0(x.count)}</Txt>
          </div>
          <div style={{ height: 4, borderRadius: 2, backgroundColor: t.line }}>
            <div style={{ width: `${Math.max(2, (x.count / max) * 100)}%`, height: 4, borderRadius: 2, backgroundColor: col }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Rules({ c, t, L }: { c: Controller; t: Theme; L: Layout }) {
  const rules = c.rules()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, flexGrow: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexGrow: 1, minWidth: 0, height: 28, paddingLeft: 10, paddingRight: 6, borderRadius: 6, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line }}>
          <input testId="rule-input" value={c.draft} placeholder="example.com" onChange={(ev) => c.setDraft(ev.value ?? '')} onSubmit={() => c.submitDraft('deny')} style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: t.fg, fontFamily: MONO }} />
        </div>
        <Button t={t} small tone={t.blocked} active testId="rule-deny" label="Block" onClick={() => c.submitDraft('deny')} />
        <Button t={t} small tone={t.forwarded} active testId="rule-allow" label="Allow" onClick={() => c.submitDraft('allow')} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'scroll', flexGrow: 1, minHeight: 0 }}>
        {rules.length === 0 ? <Txt c={t.faint} s={13}>No custom rules. Select a query and press b or a.</Txt> : null}
        {rules.map((r) => (
          <div key={r.kind + r.domain} testId={`rule-${r.domain}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 28, paddingLeft: 4, flexShrink: 0 }}>
            <div style={{ width: 50, flexShrink: 0 }}><Txt c={r.kind === 'deny' ? t.blocked : t.forwarded} s={11} w={800} mono>{r.kind.toUpperCase()}</Txt></div>
            <div style={{ flexGrow: 1, minWidth: 0 }}><Txt c={t.fg} s={13} mono>{truncate(r.domain, L.kind === 'wide' ? 30 : 40)}</Txt></div>
            <div testId={`unrule-${r.domain}`} onClick={() => c.removeRule(r.kind, r.domain)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 5, cursor: 'pointer', hover: { backgroundColor: t.raised } }}>
              <Txt c={t.dim} s={14}>×</Txt>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Controls({ c, t }: { c: Controller; t: Theme }) {
  const b = c.bench
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 }}>
      <Button t={t} small testId="toggle-blocking" active={c.dns.enabled} tone={t.forwarded} label={c.dns.enabled ? 'Blocking on' : 'Blocking off'} onClick={() => c.toggleBlocking()} />
      <Button t={t} small testId="toggle-mode" label={c.dns.blockMode === 'null' ? 'Answer 0.0.0.0' : 'Answer NXDOMAIN'} onClick={() => c.toggleMode()} />
      <Button t={t} small testId="toggle-cache" active={c.dns.cacheEnabled} tone={t.cached} label={c.dns.cacheEnabled ? 'Cache on' : 'Cache off'} onClick={() => c.toggleCache()} />
      <Button t={t} small testId="run-bench" active={b.running} label={b.running ? `Bench ${b.done}/${b.total}` : 'Bench 1k'} onClick={() => void c.runBench(1000)} />
      <Button t={t} small testId="update-list" active={c.update.running} label={c.update.running ? 'Updating…' : 'Update list'} onClick={() => void c.updateList()} />
      <Button t={t} small testId="clear-stats" label="Clear" onClick={() => c.clearStats()} />
    </div>
  )
}

function Side({ c, t, L }: { c: Controller; t: Theme; L: Layout }) {
  const tall = L.h > 760
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexGrow: 2, flexBasis: 0, minWidth: 0, minHeight: 0 }}>
      <Panel t={t} title="Top blocked" grow={0} testId="top-blocked-panel"><TopList c={c} t={t} kind="blocked" n={tall ? 6 : 4} testId="top-blocked" /></Panel>
      <Panel t={t} title="Controls" grow={0}><Controls c={c} t={t} /></Panel>
      <Panel t={t} title="Allow / deny" grow={1} testId="rules-panel"><Rules c={c} t={t} L={L} /></Panel>
    </div>
  )
}

function Tabs({ c, t }: { c: Controller; t: Theme }) {
  const tabs: [Tab, string][] = [['live', '1 Live'], ['top', '2 Top'], ['rules', '3 Rules']]
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
      {tabs.map(([k, label]) => <Button key={k} t={t} small testId={`tab-${k}`} active={c.tab === k} label={label} onClick={() => c.setTab(k)} />)}
    </div>
  )
}

function Footer({ c, t, L }: { c: Controller; t: Theme; L: Layout }) {
  const d = c.dns
  const info = `${n0(c.meta.domains)} hashed domains · ${(c.meta.bytes / 1024).toFixed(0)} KB · upstream ${d.upstreams.map((u) => u.label).join(', ')} · ${d.blockMode === 'null' ? '0.0.0.0 / ::' : 'NXDOMAIN'}`
  const keys = L.kind === 'wide' ? '↑↓ select · b block · a allow · space toggle · p pause · t bench · ctrl-c quit' : 'b block · a allow · space toggle · ctrl-c quit'
  return (
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
      <Txt c={c.flash ? t.accent : t.faint} s={12} testId="flash">{c.flash || info}</Txt>
      {L.kind === 'tiny' ? null : <Txt c={t.faint} s={12}>{keys}</Txt>}
    </div>
  )
}

export function Dashboard({ c, t, size, ui, setSel, setTyping }: { c: Controller; t: Theme; size: { width: number; height: number }; ui: UiState; setSel: (i: number) => void; setTyping: (b: boolean) => void }) {
  const L = layout(size.width, size.height)
  const rows = visibleRows(c)
  const live = <LiveLog c={c} t={t} L={L} ui={ui} rows={rows} setSel={setSel} setTyping={setTyping} />
  let main: ReactNode
  if (L.showSide) main = <div style={{ display: 'flex', flexDirection: 'row', gap: 12, flexGrow: 1, minHeight: 0 }}>{live}<Side c={c} t={t} L={L} /></div>
  else if (c.tab === 'top') main = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexGrow: 1, minHeight: 0 }}>
      <Panel t={t} title="Top blocked" testId="top-blocked-panel"><TopList c={c} t={t} kind="blocked" n={8} testId="top-blocked" /></Panel>
      <Panel t={t} title="Top resolved"><TopList c={c} t={t} kind="allowed" n={6} testId="top-allowed" /></Panel>
    </div>
  )
  else if (c.tab === 'rules') main = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flexGrow: 1, minHeight: 0 }}>
      <Panel t={t} title="Controls" grow={0}><Controls c={c} t={t} /></Panel>
      <Panel t={t} title="Allow / deny" testId="rules-panel"><Rules c={c} t={t} L={L} /></Panel>
    </div>
  )
  else main = live
  return (
    <div testId="app-root" style={{ display: 'flex', flexDirection: 'column', gap: 12, width: size.width, height: size.height, padding: L.pad, paddingTop: L.pad - 4, paddingBottom: 10, backgroundColor: t.bg, overflow: 'hidden' }}>
      <Header c={c} t={t} L={L} />
      <Cards c={c} t={t} L={L} />
      {L.h > 520 ? <Spark c={c} t={t} L={L} /> : null}
      {L.showSide ? null : <Tabs c={c} t={t} />}
      {main}
      <Footer c={c} t={t} L={L} />
    </div>
  )
}

/** Live wrapper: re-renders on DNS events (throttled) and once a second for the sparkline and pause countdown. */
export function App({ controller: c, theme, size: fixed, tickMs = 1000 }: { controller: Controller; theme: Theme; size?: { width: number; height: number }; tickMs?: number }) {
  const live = useWindowSize()
  const size = fixed ?? live
  const [, setRev] = useState(0)
  const [ui] = useState<UiState>(() => uiState)
  useEffect(() => {
    let queued: ReturnType<typeof setTimeout> | null = null
    const off = c.subscribe(() => {
      if (queued) return
      queued = setTimeout(() => { queued = null; setRev((r) => r + 1) }, 40)
    })
    const tick = tickMs > 0 ? setInterval(() => setRev((r) => r + 1), tickMs) : null
    return () => { off(); if (tick) clearInterval(tick); if (queued) clearTimeout(queued) }
  }, [c, tickMs])
  return (
    <Dashboard
      c={c}
      t={theme}
      size={size}
      ui={ui}
      setSel={(i) => { ui.sel = i; setRev((r) => r + 1) }}
      setTyping={(b) => { ui.typing = b; setRev((r) => r + 1) }}
    />
  )
}

export const uiState: UiState = { sel: 0, typing: false }

export function keyHandlers(c: Controller, ui: UiState = uiState) {
  return {
    onKeyDown: (e: KeyLike) => { if (handleKey(c, ui, e, () => visibleRows(c))) c.ping() },
  }
}

export function start(c: Controller, theme: Theme, opts: { terminal: boolean }) {
  render(<App controller={c} theme={theme} />, { terminal: opts.terminal, title: 'sinkhole', width: 1400, height: 880, ...keyHandlers(c) } as never)
}
