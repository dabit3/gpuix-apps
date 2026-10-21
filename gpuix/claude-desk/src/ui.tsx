import type { ReactNode } from 'react'
import type { StyleDesc } from '@gpuix/react'
import { ICONS, type IconName } from './icons'
import { C } from './theme'

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color: string }) {
  return (
    <svg
      source={ICONS[name]}
      style={{ width: size, height: size, flexShrink: 0, color, pointerEvents: 'none' }}
    />
  )
}

export function IconButton({
  icon,
  onClick,
  testId,
  size = 28,
  iconSize = 15,
  color = C.tertiary,
  active,
  disabled,
  style,
}: {
  icon: IconName
  onClick?: () => void
  testId?: string
  size?: number
  iconSize?: number
  color?: string
  active?: boolean
  disabled?: boolean
  style?: StyleDesc
}) {
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : () => onClick?.()}
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        backgroundColor: active ? C.overlay : '#00000000',
        hover: disabled ? undefined : { backgroundColor: C.overlay },
        ...style,
      }}
    >
      <Icon name={icon} size={iconSize} color={active ? C.text : color} />
    </div>
  )
}

export function Label({
  children,
  size = 13,
  color = C.text,
  weight,
  style,
}: {
  children: ReactNode
  size?: number
  color?: string
  weight?: number
  style?: StyleDesc
}) {
  return (
    <text style={{ fontSize: size, lineHeight: Math.round(size * 1.4), color, fontWeight: weight, ...style }}>
      {children}
    </text>
  )
}

export function formatMs(ms: number | null): string {
  if (ms == null) return '–'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
