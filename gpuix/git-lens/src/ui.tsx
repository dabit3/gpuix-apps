import type { ReactNode } from 'react'
import { C, MONO, statusColor } from './theme'

export function Txt({ children, color = C.text, size = 13, weight, mono, grow, style, testId }: { children: ReactNode; color?: string; size?: number; weight?: number; mono?: boolean; grow?: boolean; style?: Record<string, unknown>; testId?: string }) {
  return (
    <text
      testId={testId}
      style={{
        color,
        fontSize: size,
        fontWeight: weight,
        fontFamily: mono ? MONO : undefined,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flexShrink: grow ? 1 : 0,
        minWidth: grow ? 0 : undefined,
        flexGrow: grow ? 1 : 0,
        ...style,
      }}
    >
      {children}
    </text>
  )
}

export function Segmented<T extends string>({ value, options, onChange, testPrefix }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testPrefix: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', backgroundColor: '#29292C', borderRadius: 7, padding: 2, gap: 2 }}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <div
            key={o.value}
            testId={`${testPrefix}-${o.value}`}
            onClick={() => onChange(o.value)}
            style={{
              display: 'flex', flexDirection: 'column',
              paddingLeft: 10,
              paddingRight: 10,
              height: 22,
              justifyContent: 'center',
              borderRadius: 5,
              backgroundColor: active ? '#4A4A4E' : undefined,
              cursor: 'pointer',
              hover: active ? undefined : { backgroundColor: '#333336' },
            }}
          >
            <Txt size={12} weight={active ? 600 : 500} color={active ? C.text : C.text2}>
              {o.label}
            </Txt>
          </div>
        )
      })}
    </div>
  )
}

export function Button({ label, onClick, primary, disabled, testId, small }: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean; testId?: string; small?: boolean }) {
  return (
    <div
      testId={testId}
      onClick={() => !disabled && onClick()}
      style={{
        display: 'flex', flexDirection: 'column',
        height: small ? 22 : 28,
        paddingLeft: small ? 8 : 14,
        paddingRight: small ? 8 : 14,
        borderRadius: 6,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: disabled ? '#2A2A2D' : primary ? C.accent : '#38383B',
        cursor: disabled ? 'default' : 'pointer',
        hover: disabled ? undefined : { backgroundColor: primary ? '#2B95FF' : '#444448' },
        flexShrink: 0,
      }}
    >
      <Txt size={small ? 11.5 : 12.5} weight={600} color={disabled ? C.text3 : '#FFFFFF'}>
        {label}
      </Txt>
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const color = statusColor[status] ?? C.text2
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 16, height: 16, borderRadius: 4, backgroundColor: color + '2E', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Txt size={10} weight={700} color={color} mono>
        {status === '?' ? 'A' : status}
      </Txt>
    </div>
  )
}

export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', flexShrink: 0 }}>
      {additions > 0 && <Txt size={11} mono color={C.green}>{`+${additions}`}</Txt>}
      {deletions > 0 && <Txt size={11} mono color={C.red}>{`−${deletions}`}</Txt>}
    </div>
  )
}

export function SectionLabel({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 12, paddingTop: 14, paddingBottom: 6 }}>
      <Txt size={11} weight={600} color={C.text3} grow>
        {children.toUpperCase()}
      </Txt>
      {right}
    </div>
  )
}
