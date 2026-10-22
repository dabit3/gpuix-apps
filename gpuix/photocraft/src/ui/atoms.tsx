import { useRef, type ReactNode } from 'react'
import { ICONS } from './icons'
import { T } from './theme'

export type IconName = keyof typeof ICONS

export const Icon = ({ name, color = T.dim, size = 16 }: { name: IconName; color?: string; size?: number }) => <svg source={ICONS[name]} style={{ width: size, height: size, color }} />

export const Label = ({ children, color = T.dim, size = 12, weight = 500, clip }: { children: ReactNode; color?: string; size?: number; weight?: number; clip?: boolean }) => (
  <text style={{ color, fontSize: size, fontWeight: weight, ...(clip ? { whiteSpace: 'nowrap', textOverflow: 'ellipsis' } : null) }}>{children}</text>
)

export function IconButton({ name, onClick, active, testId, disabled }: { name: IconName; onClick: () => void; active?: boolean; testId?: string; disabled?: boolean }) {
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: active ? T.hover : undefined, cursor: disabled ? 'default' : 'pointer', hover: disabled ? undefined : { backgroundColor: T.hover } }}
    >
      <Icon name={name} color={disabled ? T.lineHi : active ? T.fg : T.dim} size={15} />
    </div>
  )
}

export function Chip({ label, onClick, testId, active, width, disabled }: { label: string; onClick: () => void; testId?: string; active?: boolean; width?: number; disabled?: boolean }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{ width, paddingLeft: width ? 0 : 10, paddingRight: width ? 0 : 10, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: active ? T.hover : T.raised, cursor: 'pointer', hover: { backgroundColor: T.hover } }}
    >
      <Label color={disabled ? T.faint : T.fg} size={11.5} clip>{label}</Label>
    </div>
  )
}

/** Horizontal slider. Listening for both mouseDown and mouseMove captures the pointer, so drags keep tracking. */
export function Slider({ label, value, min, max, step = 1, format, onChange, testId, width }: { label: string; value: number; min: number; max: number; step?: number; format?: (v: number) => string; onChange: (v: number) => void; testId?: string; width?: number }) {
  const box = useRef({ x: 0, w: 1 })
  const drag = useRef(false)
  const set = (x?: number) => {
    if (x == null) return
    const t = Math.min(1, Math.max(0, (x - box.current.x) / box.current.w))
    const v = Math.round((min + t * (max - min)) / step) * step
    onChange(Math.min(max, Math.max(min, v)))
  }
  const t = (value - min) / (max - min || 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width, flexGrow: width ? 0 : 1 }}>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Label size={11} color={T.dim}>{label}</Label>
        <Label size={11} color={T.fg}>{format ? format(value) : String(value)}</Label>
      </div>
      <div style={{ position: 'relative', height: 14, display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', width: '100%', height: 12 }}>
          <div style={{ flexGrow: Math.max(0.0001, t), flexBasis: 0, height: 3, borderTopLeftRadius: 2, borderBottomLeftRadius: 2, backgroundColor: T.dim }} />
          <div style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: T.fg, flexShrink: 0 }} />
          <div style={{ flexGrow: Math.max(0.0001, 1 - t), flexBasis: 0, height: 3, borderTopRightRadius: 2, borderBottomRightRadius: 2, backgroundColor: T.line }} />
        </div>
        {/* Childless hit layer on top: in GPUIX 0.11 a div whose children paint over it stops getting mouse events. */}
        <div
          testId={testId}
          onLayout={(e) => (box.current = { x: e.x ?? 0, w: Math.max(1, e.width ?? 1) })}
          onMouseDown={(e) => {
            drag.current = true
            set(e.x)
          }}
          onMouseMove={(e) => {
            if (drag.current && e.pressedButton != null) set(e.x)
          }}
          onMouseUp={() => (drag.current = false)}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, cursor: 'pointer' }}
        />
      </div>
    </div>
  )
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 10, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderColor: T.line }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 22 }}>
        <Label size={12} color={T.fg} weight={600}>{title}</Label>
        {right ?? null}
      </div>
      {children}
    </div>
  )
}


/** Mac-style segmented control: one neutral pill behind the selected item. */
export function Segmented<V extends string>({ items, value, onChange, testId }: { items: { value: V; label: string }[]; value: V; onChange: (v: V) => void; testId?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', height: 26, padding: 2, gap: 2, borderRadius: 7, backgroundColor: T.bg, borderWidth: 1, borderColor: T.line }}>
      {items.map((it) => (
        <div
          key={it.value}
          testId={testId ? `${testId}-${it.value}` : undefined}
          onClick={() => onChange(it.value)}
          style={{ paddingLeft: 10, paddingRight: 10, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: value === it.value ? T.hover : undefined, cursor: 'pointer', hover: value === it.value ? undefined : { backgroundColor: T.raised } }}
        >
          <Label size={11.5} color={value === it.value ? T.fg : T.dim} weight={value === it.value ? 600 : 500}>{it.label}</Label>
        </div>
      ))}
    </div>
  )
}

/** Text button. `primary` gets a brighter outline, never an accent fill. */
export function Button({ label, onClick, primary, testId, width }: { label: string; onClick: () => void; primary?: boolean; testId?: string; width?: number }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{ width, height: 26, paddingLeft: width ? 0 : 12, paddingRight: width ? 0 : 12, borderRadius: 6, backgroundColor: primary ? T.hover : T.raised, borderWidth: 1, borderColor: primary ? T.lineHi : T.line, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', hover: { backgroundColor: T.hover, borderColor: primary ? T.dim : T.lineHi } }}
    >
      <Label color={T.fg} size={12} weight={primary ? 600 : 500}>{label}</Label>
    </div>
  )
}

/** Keyboard shortcut glyph, e.g. ⌃K, drawn as quiet text. */
export const Kbd = ({ k }: { k: string }) => <Label size={11} color={T.faint}>{k}</Label>

export const Divider = ({ h = 16 }: { h?: number }) => <div style={{ width: 1, height: h, backgroundColor: T.line, flexShrink: 0 }} />
