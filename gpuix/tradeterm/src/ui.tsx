import type { EventPayload } from '@gpuix/react'
import { existsSync } from 'node:fs'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { BacktestResult, Sweep, walkForward } from './backtest'
import { drawEquity, fmtPrice, fmtTime, T } from './chart'
import { ICONS, type IconName } from './icons'
import { Canvas } from './raster'
import type { Bar } from './types'

const SF_DIR = '/System/Applications/Utilities/Terminal.app/Contents/Resources/Fonts'
/** SF Mono ships inside Terminal.app on every Mac; GPUIX registers it at startup. */
export const MONO_FILES = ['Regular', 'Medium', 'Semibold', 'Bold'].map((w) => `${SF_DIR}/SF-Mono-${w}.otf`).filter((p) => existsSync(p))
export const MONO = MONO_FILES.length ? 'SF Mono' : 'Menlo'

export const NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', HYPE: 'Hyperliquid', XRP: 'XRP', DOGE: 'Dogecoin', LINK: 'Chainlink', ADA: 'Cardano', AVAX: 'Avalanche',
  DOT: 'Polkadot', LTC: 'Litecoin', BNB: 'BNB', BCH: 'Bitcoin Cash', ATOM: 'Cosmos', NEAR: 'NEAR Protocol', ARB: 'Arbitrum', OP: 'Optimism',
  SUI: 'Sui', APT: 'Aptos', TRX: 'TRON', SHIB: 'Shiba Inu', PEPE: 'Pepe', UNI: 'Uniswap', AAVE: 'Aave', TON: 'Toncoin', FIL: 'Filecoin',
}
export const nameOf = (sym: string) => NAMES[sym.split('-')[0] ?? ''] ?? sym.split('-')[0] ?? sym
export const pct = (v: number, d = 2) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`
export const FEE_BPS = 10
export const SLIP_BPS = 5
export const CAPITAL = 10_000
export const SIDEBAR_W = 340
export const STRATEGY_SHORT: Record<string, string> = { sma: 'SMA Cross', rsi: 'RSI Revert', donchian: 'Breakout' }

export function fmtDur(sec: number) {
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  const d = Math.floor(sec / 86400)
  const h = Math.round((sec - d * 86400) / 3600)
  return d >= 10 || !h ? `${d}d` : `${d}d ${h}h`
}

export function useHover() {
  const [hot, setHot] = useState(false)
  return [hot, { onMouseEnter: () => setHot(true), onMouseLeave: () => setHot(false) }] as const
}

export function Icon({ name, size = 16, color }: { name: IconName; size?: number; color: string }) {
  return <svg source={ICONS[name]} style={{ width: size, height: size, color, flexShrink: 0 }} />
}

export function Kbd({ k, dark }: { k: string; dark?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, paddingLeft: 5, paddingRight: 5, borderRadius: 4, backgroundColor: dark ? T.bg : T.raised, borderWidth: 1, borderColor: T.border, flexShrink: 0 }}>
      <text style={{ color: T.dim, fontSize: 10, fontFamily: MONO }}>{k}</text>
    </div>
  )
}

/** iOS-style segmented control. */
export function Segmented<V extends string>({ items, value, onChange, mono, grow }: { items: { id: V; label: string; testId?: string }[]; value: V; onChange: (v: V) => void; mono?: boolean; grow?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 2, padding: 2, borderRadius: 8, backgroundColor: T.panel, borderWidth: 1, borderColor: T.border, flexShrink: 0 }}>
      {items.map((it) => (
        <Segment key={it.id} label={it.label} testId={it.testId} active={it.id === value} onClick={() => onChange(it.id)} mono={mono} grow={grow} />
      ))}
    </div>
  )
}

function Segment({ label, active, onClick, testId, mono, grow }: { label: string; active: boolean; onClick: () => void; testId?: string; mono?: boolean; grow?: boolean }) {
  const [hot, hov] = useHover()
  return (
    <div
      testId={testId}
      onClick={onClick}
      {...hov}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 24, paddingLeft: 9, paddingRight: 9, borderRadius: 6, backgroundColor: active ? T.borderHi : 'transparent', cursor: 'pointer', flexShrink: 0, ...(grow ? { flexGrow: 1, flexBasis: 0 } : {}) }}
    >
      <text style={{ color: active ? T.fg : hot ? T.fg : T.dim, fontSize: 12, fontFamily: mono ? MONO : undefined, fontWeight: active ? 600 : 'normal' }}>{label}</text>
    </div>
  )
}

/** Toolbar button: optional icon, label, key hint and disclosure chevron. */
export function Button({ icon, label, active, onClick, testId, chevron, badge, onLayout }: { icon?: IconName; label?: string; active?: boolean; onClick: () => void; testId?: string; chevron?: boolean; badge?: string; onLayout?: (e: EventPayload) => void }) {
  const [hot, hov] = useHover()
  const color = active ? T.blue : hot ? T.fg : T.dim
  return (
    <div
      testId={testId}
      onClick={onClick}
      onLayout={onLayout}
      {...hov}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingLeft: label ? 9 : 6, paddingRight: label ? (chevron ? 6 : 10) : 6, borderRadius: 7, backgroundColor: active ? '#71b7ff1f' : hot ? T.raised : 'transparent', cursor: 'pointer', flexShrink: 0 }}
    >
      {icon ? <Icon name={icon} color={color} /> : null}
      {label ? <text style={{ color: active ? T.blue : hot ? T.fg : '#c9d1d9', fontSize: 12.5 }}>{label}</text> : null}
      {badge ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 16, height: 16, paddingLeft: 4, paddingRight: 4, borderRadius: 8, backgroundColor: T.raised }}>
          <text style={{ color: T.dim, fontSize: 10, fontFamily: MONO }}>{badge}</text>
        </div>
      ) : null}
      {chevron ? <Icon name="chevron" size={12} color={T.faint} /> : null}
    </div>
  )
}

export function Sep() {
  return <div style={{ width: 1, height: 18, backgroundColor: T.border, marginLeft: 4, marginRight: 4, flexShrink: 0 }} />
}

/** Full-window layer above everything (menus, palette, sheets). The backdrop is a sibling so clicks inside never dismiss. */
export function Overlay({ children, onClose, dim = 'transparent', testId, center }: { children: ReactNode; onClose: () => void; dim?: string; testId?: string; center?: boolean }) {
  return (
    <anchored fill="window" deferred priority={0} occlude style={{ backgroundColor: 'transparent' }}>
      <div testId={testId} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: center ? 'center' : 'start' }}>
        <div onClick={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: dim, pointerEvents: 'auto' }} />
        {children}
      </div>
    </anchored>
  )
}

export type MenuEntry = { id: string; label: string; checked?: boolean; hint?: string; testId?: string; onSelect: () => void } | { section: string } | { divider: true }

export function Menu({ x, y, entries, onClose, width = 236 }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void; width?: number }) {
  return (
    <Overlay onClose={onClose}>
      <div testId="menu" style={{ position: 'absolute', left: x, top: y, width, display: 'flex', flexDirection: 'column', paddingTop: 5, paddingBottom: 5, borderRadius: 10, backgroundColor: T.raised, borderWidth: 1, borderColor: T.borderHi, boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 28, spreadRadius: 0, color: '#00000099' }] }}>
        {entries.map((e, k) =>
          'divider' in e ? (
            <div key={`d${k}`} style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: 10, marginRight: 10, backgroundColor: T.border }} />
          ) : 'section' in e ? (
            <text key={`s${k}`} style={{ color: T.faint, fontSize: 10.5, fontWeight: 600, marginLeft: 14, marginTop: k ? 6 : 2, marginBottom: 2 }}>{e.section.toUpperCase()}</text>
          ) : (
            <MenuRow key={e.id} entry={e} />
          ),
        )}
      </div>
    </Overlay>
  )
}

function MenuRow({ entry }: { entry: Extract<MenuEntry, { id: string }> }) {
  const [hot, hov] = useHover()
  return (
    <div testId={entry.testId} onClick={entry.onSelect} {...hov} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 26, marginLeft: 5, marginRight: 5, paddingLeft: 8, paddingRight: 8, borderRadius: 6, backgroundColor: hot ? '#71b7ff2e' : 'transparent', cursor: 'pointer' }}>
      <div style={{ width: 14, display: 'flex', alignItems: 'center' }}>{entry.checked ? <Icon name="check" size={14} color={T.blue} /> : null}</div>
      <text style={{ color: T.fg, fontSize: 12.5 }}>{entry.label}</text>
      <div style={{ flexGrow: 1 }} />
      {entry.hint ? <text style={{ color: T.faint, fontSize: 11, fontFamily: MONO }}>{entry.hint}</text> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Command palette

export type Cmd = { id: string; title: string; sub: string; icon: IconName; hint?: string; keywords: string; run: () => void; rank?: number }

export function Palette({ query, items, selected, onPick, onHover, onClose, width }: { query: string; items: Cmd[]; selected: number; onPick: (c: Cmd) => void; onHover: (i: number) => void; onClose: () => void; width: number }) {
  const w = Math.min(600, width - 32)
  return (
    <Overlay onClose={onClose} dim="#05070acc" testId="palette">
      <div style={{ marginTop: 72, width: w, display: 'flex', flexDirection: 'column', borderRadius: 14, backgroundColor: T.panel, borderWidth: 1, borderColor: T.borderHi, overflow: 'hidden', boxShadow: [{ offsetX: 0, offsetY: 18, blurRadius: 48, spreadRadius: 0, color: '#000000cc' }] }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, height: 54, paddingLeft: 18, paddingRight: 18, borderBottomWidth: 1, borderColor: T.border }}>
          <Icon name="search" size={18} color={T.dim} />
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
            {query ? <text testId="palette-query" style={{ color: T.fg, fontSize: 17 }}>{query}</text> : null}
            <div style={{ width: 2, height: 20, marginLeft: 1, backgroundColor: T.blue, borderRadius: 1 }} />
            {!query ? <text style={{ color: T.faint, fontSize: 17, marginLeft: 6 }}>Symbol, timeframe, indicator or action</text> : null}
          </div>
          <Kbd k="esc" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 6, paddingBottom: 6 }}>
          {items.length === 0 ? (
            <text style={{ color: T.dim, fontSize: 13, marginLeft: 20, marginTop: 14, marginBottom: 14 }}>{`No results for “${query}”`}</text>
          ) : (
            items.map((c, i) => <PaletteRow key={c.id} c={c} active={i === selected} onPick={() => onPick(c)} onHover={() => onHover(i)} />)
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14, height: 34, paddingLeft: 18, paddingRight: 18, borderTopWidth: 1, borderColor: T.border, backgroundColor: T.bg }}>
          <Hint keys="↑↓" text="navigate" />
          <Hint keys="↵" text="open" />
          <div style={{ flexGrow: 1 }} />
          <text style={{ color: T.faint, fontSize: 11 }}>Try “eth 4h”, “rsi”, “fib”, “sweep”</text>
        </div>
      </div>
    </Overlay>
  )
}

function Hint({ keys, text }: { keys: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Kbd k={keys} dark />
      <text style={{ color: T.faint, fontSize: 11 }}>{text}</text>
    </div>
  )
}

function PaletteRow({ c, active, onPick, onHover }: { c: Cmd; active: boolean; onPick: () => void; onHover: () => void }) {
  return (
    <div testId={`cmd-${c.id}`} onClick={onPick} onMouseMove={onHover} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, marginLeft: 8, marginRight: 8, paddingLeft: 12, paddingRight: 12, borderRadius: 9, backgroundColor: active ? '#71b7ff26' : 'transparent', cursor: 'pointer' }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: active ? '#71b7ff33' : T.raised, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={c.icon} size={15} color={active ? T.blue : T.dim} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexGrow: 1, minWidth: 0 }}>
        <text style={{ color: T.fg, fontSize: 13.5, fontWeight: active ? 600 : 'normal' }}>{c.title}</text>
        <text style={{ color: T.faint, fontSize: 11 }}>{c.sub}</text>
      </div>
      {active ? <Icon name="enter" size={14} color={T.dim} /> : c.hint ? <Kbd k={c.hint} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Inspector: watchlist + backtest

export function Raster({ w, h, draw, drawKey, testId }: { w: number; h: number; draw: (cv: Canvas) => void; drawKey: unknown[]; testId: string }) {
  const img = useRef<import('@gpuix/react').ImgInstance>(null)
  const cv = useRef(new Canvas())
  useLayoutEffect(() => {
    cv.current.resize(w, h)
    draw(cv.current)
    img.current?.setImagePixels(cv.current.w, cv.current.h, cv.current.buf, { format: 'bgra' })
  }, drawKey)
  return <img ref={img} testId={testId} objectFit="fill" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }} />
}

export function ChangePill({ v, testId, size = 11 }: { v: number; testId?: string; size?: number }) {
  const ok = Number.isFinite(v)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 64, height: size + 9, paddingLeft: 6, paddingRight: 6, borderRadius: 5, backgroundColor: !ok ? T.raised : v < 0 ? '#ff6a69' : '#26cd4d', flexShrink: 0 }}>
      <text testId={testId} style={{ color: ok ? T.bg : T.faint, fontSize: size, fontFamily: MONO, fontWeight: 600 }}>{ok ? pct(v) : '—'}</text>
    </div>
  )
}

export function Inspector(props: {
  sym: string
  watchlist: string[]
  tickers: Record<string, { last: number; change: number }>
  current: { sym: string; last: number; change: number }
  onPick: (s: string) => void
  bt: BacktestResult | null
  bars: Bar[]
  strategies: { id: string; label: string }[]
  strategyId: string
  params: Record<string, number>
  onStrategy: (id: string) => void
  hlTrade: number | null
  onTrade: (k: number) => void
  animate: boolean
  revealKey: string
}) {
  const m = props.bt?.metrics
  const trades = props.bt?.trades ?? []
  const w = SIDEBAR_W
  const eqW = w - 32
  const hl = props.hlTrade != null ? trades[props.hlTrade] : null
  const hold = props.bars.length > 1 ? props.bars[props.bars.length - 1]!.c / props.bars[0]!.c - 1 : NaN
  const maxAbs = Math.max(1e-9, ...trades.map((t) => Math.abs(t.pnlPct)))

  // The equity curve draws itself in when the strategy, parameters or series change.
  const [reveal, setReveal] = useState(1)
  useEffect(() => {
    if (!props.animate) return
    let p = 0
    setReveal(0)
    const id = setInterval(() => {
      p = Math.min(1, p + 16 / 620)
      setReveal(1 - Math.pow(1 - p, 3))
      if (p >= 1) clearInterval(id)
    }, 16)
    return () => clearInterval(id)
  }, [props.revealKey])

  return (
    <div testId="sidebar" style={{ display: 'flex', flexDirection: 'column', width: w, flexShrink: 0, borderLeftWidth: 1, borderColor: T.border, backgroundColor: T.panel }}>
      <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 12, paddingBottom: 6, borderBottomWidth: 1, borderColor: T.border, flexShrink: 0 }}>
        <Title text="Watchlist" />
        {props.watchlist.map((s) => {
          const t = s === props.current.sym && Number.isFinite(props.current.last) ? { last: props.current.last, change: props.tickers[s]?.change ?? props.current.change } : props.tickers[s]
          const active = s === props.sym
          return (
            <Row key={s} testId={`wl-${s}`} active={active} onClick={() => props.onPick(s)} h={28}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 7, flexGrow: 1, minWidth: 0 }}>
                <text style={{ color: T.fg, fontSize: 13, fontWeight: 600 }}>{s.replace('-USD', '')}</text>
                <text style={{ color: T.faint, fontSize: 11.5 }}>{nameOf(s)}</text>
              </div>
              <text style={{ color: T.fg, fontSize: 13, fontFamily: MONO }}>{t ? fmtPrice(t.last) : '—'}</text>
              <ChangePill v={t ? t.change : NaN} />
            </Row>
          )
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 10, gap: 7, flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', paddingRight: 16 }}>
          <Title text="Backtest" />
          <div style={{ flexGrow: 1 }} />
          <text style={{ color: T.faint, fontSize: 11 }}>{`$${(CAPITAL / 1000).toFixed(0)}k · next-bar fills`}</text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 14, marginRight: 14 }}>
          <Segmented grow items={props.strategies.map((s) => ({ id: s.id, label: STRATEGY_SHORT[s.id] ?? s.label, testId: `strat-${s.id}` }))} value={props.strategyId} onChange={props.onStrategy} />
        </div>
        <text testId="bt-params" style={{ color: T.faint, fontSize: 11, fontFamily: MONO, marginLeft: 16 }}>
          {`${Object.entries(props.params)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')} · fee ${FEE_BPS}bp · slip ${SLIP_BPS}bp`}
        </text>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'end', marginLeft: 16, marginRight: 16, marginTop: 2 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <text style={{ color: T.faint, fontSize: 11 }}>Total return</text>
            <text testId="m-return" style={{ color: !m ? T.faint : m.totalReturn < 0 ? T.red : T.green, fontSize: 26, fontFamily: MONO, fontWeight: 600 }}>
              {m ? pct(m.totalReturn, 1) : '—'}
            </text>
          </div>
          <div style={{ flexGrow: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'end', paddingBottom: 5 }}>
            <text style={{ color: T.faint, fontSize: 11 }}>Buy & hold</text>
            <text testId="m-hold" style={{ color: T.dim, fontSize: 14, fontFamily: MONO }}>{Number.isFinite(hold) ? pct(hold, 1) : '—'}</text>
          </div>
        </div>
        <div style={{ position: 'relative', marginLeft: 16, width: eqW, height: 84 }}>
          {props.bt ? (
            <Raster w={eqW} h={84} testId="equity" draw={(cv) => drawEquity(cv, props.bars, props.bt!, CAPITAL, hl ? { a: hl.entryIndex, b: hl.exitIndex } : null, reveal)} drawKey={[props.bt, eqW, hl, reveal]} />
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 14, marginLeft: 16, marginTop: -2 }}>
          <Legend color={m && m.totalReturn < 0 ? T.red : T.green} text="Strategy" />
          <Legend color={T.faint} text="Buy & hold" />
          <Legend color={T.red} text="Drawdown" thick />
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', marginLeft: 16, marginRight: 16, rowGap: 8, paddingTop: 10, borderTopWidth: 1, borderColor: T.border }}>
          <Metric label="Sharpe" value={m ? m.sharpe.toFixed(2) : '—'} testId="m-sharpe" />
          <Metric label="Sortino" value={m ? m.sortino.toFixed(2) : '—'} />
          <Metric label="Max drawdown" value={m ? pct(m.maxDrawdown, 1) : '—'} testId="m-dd" />
          <Metric label="Win rate" value={m ? `${(m.winRate * 100).toFixed(0)}%` : '—'} />
          <Metric label="Profit factor" value={m ? (Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞') : '—'} />
          <Metric label="CAGR" value={m ? pct(m.cagr, 0) : '—'} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingLeft: 16, paddingRight: 16, height: 34, flexShrink: 0, borderTopWidth: 1, borderColor: T.border, paddingTop: 6 }}>
        <text style={{ color: T.fg, fontSize: 12.5, fontWeight: 600 }}>Trades</text>
        <text testId="m-trades" style={{ color: T.faint, fontSize: 12, fontFamily: MONO }}>{m ? String(m.trades) : '—'}</text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ color: T.faint, fontSize: 11 }}>{`exposure ${m ? (m.exposure * 100).toFixed(0) : '—'}%`}</text>
        <Kbd k="," />
        <Kbd k="." />
      </div>
      <div testId="trades" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'scroll', paddingTop: 6, paddingBottom: 6 }}>
        {trades
          .map((t, k) => ({ t, k }))
          .reverse()
          .slice(0, 200)
          .map(({ t, k }) => (
            <Row key={k} testId={`trade-${k}`} active={props.hlTrade === k} onClick={() => props.onTrade(k)} h={26}>
              <text style={{ color: T.faint, fontSize: 11, fontFamily: MONO, width: 30 }}>{`${k + 1}`}</text>
              <text style={{ color: T.dim, fontSize: 11.5, fontFamily: MONO }}>{fmtTime(t.entryTime, false)}</text>
              <text style={{ color: T.faint, fontSize: 11, fontFamily: MONO, width: 46 }}>{fmtDur(t.exitTime - t.entryTime)}</text>
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' }}>
                <div style={{ width: Math.max(3, Math.sqrt(Math.abs(t.pnlPct) / maxAbs) * 52), height: 4, borderRadius: 2, backgroundColor: t.pnl >= 0 ? '#26cd4daa' : '#ff6a69aa' }} />
              </div>
              <text style={{ color: t.pnl >= 0 ? T.green : T.red, fontSize: 11.5, fontFamily: MONO, width: 60, textAlign: 'right' }}>{pct(t.pnlPct)}</text>
            </Row>
          ))}
      </div>
    </div>
  )
}

function Legend({ color, text, thick }: { color: string; text: string; thick?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 10, height: thick ? 6 : 2, borderRadius: 1, backgroundColor: color }} />
      <text style={{ color: T.faint, fontSize: 10.5 }}>{text}</text>
    </div>
  )
}

function Title({ text }: { text: string }) {
  return <text style={{ color: T.fg, fontSize: 12.5, fontWeight: 600, marginLeft: 16, marginBottom: 4 }}>{text}</text>
}

function Row({ children, active, onClick, testId, h = 28 }: { children: ReactNode; active: boolean; onClick: () => void; testId?: string; h?: number }) {
  const [hot, hov] = useHover()
  return (
    <div testId={testId} onClick={onClick} {...hov} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: h, marginLeft: 6, marginRight: 6, paddingLeft: 10, paddingRight: 10, borderRadius: 8, flexShrink: 0, backgroundColor: active ? '#71b7ff1f' : hot ? T.raised : 'transparent', cursor: 'pointer' }}>
      {children}
    </div>
  )
}

function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: Math.floor((SIDEBAR_W - 36) / 3), gap: 2 }}>
      <text style={{ color: T.faint, fontSize: 10.5 }}>{label}</text>
      <text testId={testId} style={{ color: T.fg, fontSize: 14, fontFamily: MONO, fontWeight: 500 }}>{value}</text>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Sheets

function heat(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return T.raised
  const mix = (a: number[], b: number[], k: number) => a.map((x, i) => Math.round(x + (b[i]! - x) * Math.max(0, Math.min(1, k))))
  const base = [22, 27, 34]
  const c = v >= 0 ? mix(base, [30, 96, 166], v / (hi || 1)) : mix(base, [92, 34, 40], v / (lo || -1))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

export function SweepSheet({ data, onPick, onClose }: { data: { sw: Sweep; wf: ReturnType<typeof walkForward> } | null; onPick: (c: { fast: number; slow: number }) => void; onClose: () => void }) {
  const cell = 56
  return (
    <Overlay onClose={onClose} dim="#05070acc" center testId="sweep-view">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 24, borderRadius: 16, backgroundColor: T.panel, borderWidth: 1, borderColor: T.borderHi, boxShadow: [{ offsetX: 0, offsetY: 18, blurRadius: 48, spreadRadius: 0, color: '#000000cc' }] }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <text style={{ color: T.fg, fontSize: 17, fontWeight: 600 }}>Parameter sweep</text>
          <text style={{ color: T.faint, fontSize: 12 }}>{`SMA cross · Sharpe ratio by fast and slow length · ${FEE_BPS}bp fee, ${SLIP_BPS}bp slippage`}</text>
        </div>
        {!data ? (
          <text style={{ color: T.dim, fontSize: 12 }}>Needs at least 300 bars of history.</text>
        ) : (
          (() => {
            const vals = data.sw.cells.map((c) => c.sharpe).filter(Number.isFinite)
            const lo = Math.min(0, ...vals)
            const hi = Math.max(0, ...vals)
            const oos = data.wf.filter((f) => f.best)
            const oosAvg = oos.length ? oos.reduce((a, f) => a + f.oosSharpe, 0) / oos.length : 0
            return (
              <>
                <div style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 22 }}>
                    {data.sw.slows.map((s) => (
                      <div key={s} style={{ height: cell - 16, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', width: 50 }}>
                        <text style={{ color: T.faint, fontSize: 11, fontFamily: MONO }}>{`${s}`}</text>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', flexDirection: 'row', gap: 3, height: 19 }}>
                      {data.sw.fasts.map((f) => (
                        <text key={f} style={{ color: T.faint, fontSize: 11, fontFamily: MONO, width: cell, textAlign: 'center' }}>{`${f}`}</text>
                      ))}
                    </div>
                    {data.sw.slows.map((s) => (
                      <div key={s} style={{ display: 'flex', flexDirection: 'row', gap: 3 }}>
                        {data.sw.fasts.map((f) => {
                          const c = data.sw.cells.find((x) => x.fast === f && x.slow === s)!
                          return <SweepCell key={f} f={f} s={s} sharpe={c.sharpe} best={data.sw.best === c} bg={heat(c.sharpe, lo, hi)} w={cell} onPick={() => Number.isFinite(c.sharpe) && onPick(c)} />
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 60 }}>
                  <text style={{ color: T.faint, fontSize: 11 }}>rows: slow length · columns: fast length</text>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 10, backgroundColor: '#f0b72f14', borderWidth: 1, borderColor: '#f0b72f40' }}>
                  <text style={{ color: T.yellow, fontSize: 12, fontWeight: 600 }}>Overfitting warning</text>
                  <text testId="overfit" style={{ color: '#e3c27a', fontSize: 12, width: 420 }}>
                    {`The in-sample best (${data.sw.best ? `${data.sw.best.fast}/${data.sw.best.slow}, Sharpe ${data.sw.best.sharpe.toFixed(2)}` : '—'}) averages ${oosAvg.toFixed(2)} out of sample across ${oos.length} walk-forward folds. The brightest cell is usually the most overfit one.`}
                  </text>
                </div>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <text style={{ color: T.faint, fontSize: 11 }}>Click a cell to backtest it</text>
                  <div style={{ flexGrow: 1 }} />
                  <Kbd k="esc" />
                  <text style={{ color: T.faint, fontSize: 11 }}>close</text>
                </div>
              </>
            )
          })()
        )}
      </div>
    </Overlay>
  )
}

function SweepCell({ f, s, sharpe, best, bg, w, onPick }: { f: number; s: number; sharpe: number; best: boolean; bg: string; w: number; onPick: () => void }) {
  const [hot, hov] = useHover()
  const ok = Number.isFinite(sharpe)
  return (
    <div testId={`cell-${f}-${s}`} onClick={onPick} {...hov} style={{ width: w, height: w - 16, borderRadius: 6, backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', borderWidth: best || hot ? 2 : 0, borderColor: best ? T.fg : T.borderHi, cursor: ok ? 'pointer' : 'default' }}>
      <text style={{ color: ok ? T.fg : T.faint, fontSize: 12, fontFamily: MONO, fontWeight: best ? 600 : 'normal' }}>{ok ? sharpe.toFixed(2) : '·'}</text>
    </div>
  )
}

export function HelpSheet({ onClose }: { onClose: () => void }) {
  const groups: [string, [string, string][]][] = [
    ['Navigate', [['/', 'Command palette'], ['1 – 7', 'Timeframe'], ['[  ]', 'Previous / next symbol'], ['drag', 'Zoom to range'], ['scroll', 'Pan'], ['⌃ scroll', 'Zoom at cursor'], ['← → ↑ ↓', 'Pan · zoom'], ['0', 'Reset view']]],
    ['Chart', [['c', 'Chart style'], ['l', 'Log scale'], ['e s b v u d', 'Overlays'], ['r m k a o', 'Indicator panes'], ['t h g f', 'Trend · level · box · fib'], ['x', 'Delete last drawing']]],
    ['Backtest', [['n', 'Next strategy'], ['w', 'Parameter sweep'], [',  .', 'Step through trades'], ['p', 'Show inspector'], ['q  ⌃C', 'Quit']]],
  ]
  return (
    <Overlay onClose={onClose} dim="#05070acc" center>
      <div testId="help" style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 24, borderRadius: 16, backgroundColor: T.panel, borderWidth: 1, borderColor: T.borderHi }}>
        <text style={{ color: T.fg, fontSize: 17, fontWeight: 600 }}>Keyboard shortcuts</text>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 32 }}>
          {groups.map(([g, rows]) => (
            <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 9, width: 220 }}>
              <text style={{ color: T.faint, fontSize: 10.5, fontWeight: 600 }}>{g.toUpperCase()}</text>
              {rows.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <text style={{ color: T.dim, fontSize: 12.5, flexGrow: 1 }}>{v}</text>
                  <Kbd k={k} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  )
}
