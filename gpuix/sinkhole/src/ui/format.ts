export const QTYPE: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 64: 'SVCB', 65: 'HTTPS', 255: 'ANY' }
export const qtypeName = (n: number) => QTYPE[n] ?? `T${n}`
export const n0 = (n: number) => Math.round(n).toLocaleString('en-US')
export const pct = (n: number) => `${n < 10 && n > 0 ? n.toFixed(1) : Math.round(n)}%`
export const clock = (ts: number) => { const d = new Date(ts); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':') }
export const mmss = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
export const ms = (v: number) => (v < 1 ? '<1 ms' : v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`)
export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s)
export function uptime(msv: number) {
  const s = Math.floor(msv / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export type LayoutKind = 'wide' | 'narrow' | 'tiny'
export interface Layout { kind: LayoutKind; w: number; h: number; pad: number; cards: number; spark: number; showSide: boolean; logName: number }
/** Wide: log plus a side column. Narrow (a split pane): one column with tabs. Tiny: cards and the log only. */
export function layout(w: number, h: number): Layout {
  const kind: LayoutKind = w >= 1000 ? 'wide' : w >= 520 ? 'narrow' : 'tiny'
  const pad = kind === 'wide' ? 22 : kind === 'narrow' ? 16 : 10
  const cards = kind === 'wide' ? 5 : kind === 'narrow' ? 3 : 2
  const spark = Math.max(40, Math.min(110, Math.round(h * 0.12)))
  const logW = kind === 'wide' ? w * 0.6 : w
  return { kind, w, h, pad, cards, spark, showSide: kind === 'wide', logName: Math.max(14, Math.floor((logW - 330) / 8.6)) }
}
