import type { ReactNode } from 'react'
import { avatarPath, LABELS, type Card, type Priority } from './data'
import { ICONS } from './icons'
import { CARD_SHADOW, T } from './theme'

export function Avatar({ person, size = 20 }: { person: string | null; size?: number }) {
  if (!person) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: '#FFFFFF33',
          flexShrink: 0,
        }}
      />
    )
  }
  return (
    <img
      src={avatarPath(person)}
      style={{ width: size, height: size, borderRadius: size / 2, flexShrink: 0 }}
    />
  )
}

const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: '#F2665F',
  high: '#D7DCE4',
  medium: '#D7DCE4',
  low: '#D7DCE4',
  none: '#6D7480',
}

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  if (priority === 'urgent' || priority === 'none') {
    return <svg source={ICONS[priority]} style={{ width: size, height: size, color: PRIORITY_COLOR[priority], flexShrink: 0 }} />
  }
  const filled = priority === 'high' ? ICONS.bars3 : priority === 'medium' ? ICONS.bars2 : ICONS.bars1
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <svg source={ICONS.barsAll} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, color: '#FFFFFF2E' }} />
      <svg source={filled} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, color: PRIORITY_COLOR[priority] }} />
    </div>
  )
}

export function Icon({ name, size = 14, color = T.text2 }: { name: keyof typeof ICONS; size?: number; color?: string }) {
  return <svg source={ICONS[name]} style={{ width: size, height: size, color, flexShrink: 0 }} />
}

export function LabelChip({ name, small }: { name: string; small?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: small ? 20 : 22,
        paddingLeft: 7,
        paddingRight: 8,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: '#FFFFFF14',
        flexShrink: 0,
      }}
    >
      <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: LABELS[name] ?? T.text3 }} />
      <text style={{ color: T.text2, fontSize: small ? 11 : 12 }}>{name}</text>
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        paddingLeft: 5,
        paddingRight: 5,
        borderRadius: 5,
        backgroundColor: '#FFFFFF12',
        borderWidth: 1,
        borderColor: '#FFFFFF14',
      }}
    >
      <text style={{ color: T.text2, fontSize: 11 }}>{children}</text>
    </div>
  )
}

export function CardFace({
  card,
  lifted,
  selected,
  handlers,
}: {
  card: Card
  lifted?: boolean
  selected?: boolean
  handlers?: Record<string, unknown>
}) {
  return (
    <div
      {...handlers}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 10,
        backgroundColor: lifted ? '#22262E' : T.card,
        borderWidth: 1,
        borderColor: selected ? '#4FA3F7AA' : lifted ? '#FFFFFF24' : T.cardBorder,
        boxShadow: CARD_SHADOW,
        hover: lifted ? undefined : { backgroundColor: T.cardHover, borderColor: '#FFFFFF1C' },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <PriorityIcon priority={card.priority} />
        <text style={{ color: T.text3, fontSize: 11.5, flexGrow: 1 }}>{card.id}</text>
        <Avatar person={card.assignee} size={18} />
      </div>
      <text style={{ color: T.text, fontSize: 13, lineHeight: 18, fontWeight: 500, lineClamp: 2 }}>{card.title}</text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {card.labels.slice(0, 2).map((l) => (
          <LabelChip key={l} name={l} small />
        ))}
        {card.labels.length > 2 ? <text style={{ color: T.text3, fontSize: 11 }}>{`+${card.labels.length - 2}`}</text> : null}
        <div style={{ flexGrow: 1 }} />
        {card.comments.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name="comment" size={12} color={T.text3} />
            <text style={{ color: T.text3, fontSize: 11 }}>{String(card.comments.length)}</text>
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 20,
            height: 18,
            paddingLeft: 5,
            paddingRight: 5,
            borderRadius: 5,
            backgroundColor: '#FFFFFF0D',
          }}
        >
          <text style={{ color: T.text2, fontSize: 11 }}>{String(card.estimate)}</text>
        </div>
      </div>
    </div>
  )
}
