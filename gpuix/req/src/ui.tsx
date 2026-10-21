import type { ReactNode } from 'react'
import type { StyleDesc } from '@gpuix/react'
import { C, MONO, SANS } from './theme'

export function T({
  children,
  size = 13,
  color = C.text,
  weight,
  mono,
  testId,
  style,
}: {
  children: ReactNode
  size?: number
  color?: string
  weight?: number
  mono?: boolean
  testId?: string
  style?: StyleDesc
}) {
  return (
    <text
      testId={testId}
      style={{
        fontSize: size,
        lineHeight: Math.round(size * 1.45),
        color,
        fontWeight: weight,
        fontFamily: mono ? MONO : SANS,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </text>
  )
}

export function Button({
  children,
  onClick,
  testId,
  primary,
  disabled,
  style,
}: {
  children: ReactNode
  onClick?: () => void
  testId?: string
  primary?: boolean
  disabled?: boolean
  style?: StyleDesc
}) {
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : () => onClick?.()}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 32,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 7,
        flexShrink: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        userSelect: 'none',
        backgroundColor: primary ? C.blue : C.raised,
        borderWidth: primary ? 0 : 1,
        borderColor: C.border,
        hover: disabled ? undefined : { backgroundColor: primary ? '#91cbff' : C.hover },
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Tab({
  label,
  count,
  active,
  onClick,
  testId,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 36,
        paddingLeft: 2,
        paddingRight: 2,
        cursor: 'pointer',
        userSelect: 'none',
        borderBottomWidth: 2,
        borderColor: active ? C.blue : '#00000000',
      }}
    >
      <T size={12.5} weight={active ? 600 : 500} color={active ? C.text : C.faint}>
        {label}
      </T>
      {count != null && count > 0 && (
        <div style={{ display: 'flex', paddingLeft: 5, paddingRight: 5, borderRadius: 5, backgroundColor: active ? C.blueSoft : C.raised }}>
          <T size={10.5} mono color={active ? C.blue : C.faint}>
            {String(count)}
          </T>
        </div>
      )}
    </div>
  )
}

export function relativeTime(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
