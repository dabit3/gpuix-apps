import type { ReactNode } from 'react'
import { MONO, P } from './theme'

export function Txt({ children, color = P.text, size = 13, weight, mono, grow, style, testId }: { children: ReactNode; color?: string; size?: number; weight?: number; mono?: boolean; grow?: boolean; style?: Record<string, unknown>; testId?: string }) {
  return (
    <text
      testId={testId}
      style={{ color, fontSize: size, fontWeight: weight, fontFamily: mono ? MONO : undefined, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: grow ? 1 : 0, minWidth: grow ? 0 : undefined, flexGrow: grow ? 1 : 0, ...style }}
    >
      {children}
    </text>
  )
}

export function Row({ children, gap = 8, style, testId, onClick }: { children: ReactNode; gap?: number; style?: Record<string, unknown>; testId?: string; onClick?: () => void }) {
  return (
    <div testId={testId} onClick={onClick} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap, ...style }}>
      {children}
    </div>
  )
}

export function Col({ children, gap = 0, style, testId }: { children: ReactNode; gap?: number; style?: Record<string, unknown>; testId?: string }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>
      {children}
    </div>
  )
}

export function Button({ label, hint, onClick, tone, testId, disabled }: { label: string; hint?: string; onClick: () => void; tone?: string; testId?: string; disabled?: boolean }) {
  return (
    <div
      testId={testId}
      onClick={() => !disabled && onClick()}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingLeft: 11, paddingRight: 9, borderRadius: 7, borderWidth: 1, borderColor: P.border, backgroundColor: P.raised, cursor: disabled ? 'default' : 'pointer', hover: disabled ? undefined : { backgroundColor: P.hover, borderColor: tone ?? P.text3 }, flexShrink: 0 }}
    >
      <Txt size={12.5} weight={600} color={disabled ? P.text3 : (tone ?? P.text)}>{label}</Txt>
      {hint ? <Kbd>{hint}</Kbd> : null}
    </div>
  )
}

export function Kbd({ children }: { children: string }) {
  return (
    <div style={{ display: 'flex', paddingLeft: 5, paddingRight: 5, height: 17, borderRadius: 4, backgroundColor: P.bg, borderWidth: 1, borderColor: P.border, alignItems: 'center', justifyContent: 'center' }}>
      <Txt size={10.5} mono color={P.text2}>{children}</Txt>
    </div>
  )
}

export const STATUS_ICON = { pass: '✓', fail: '✕', skip: '○', todo: '◌' } as const
export const statusColor = (s: string) => (s === 'pass' ? P.green : s === 'fail' ? P.red : s === 'todo' ? P.cyan : P.yellow)
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : ms >= 10 ? `${Math.round(ms)}ms` : `${ms.toFixed(1)}ms`)
