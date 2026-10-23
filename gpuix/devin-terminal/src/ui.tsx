/** @jsxImportSource #zoom */
import React, { useRef, useState } from 'react'
import { Button, motion, Select, SelectContent, SelectItem, SelectTrigger, Tooltip, TooltipContent, TooltipTrigger, type StyleDesc } from '@gpuix/react'
import { Icon, type IconName } from './icons'
import { C } from './theme'
import { STATUS_LABEL, type Status } from './data'
import { getZoom } from './zoom/scale'

export const SANS = 'Inter'
export const MONO = 'Menlo'
export const CLEAR = '#00000000'
export const WEB = 'https://app.devin.ai'

export const row = (extra: StyleDesc = {}): StyleDesc => ({ display: 'flex', flexDirection: 'row', alignItems: 'center', ...extra })
export const col = (extra: StyleDesc = {}): StyleDesc => ({ display: 'flex', flexDirection: 'column', ...extra })

let urlOpener = (url: string) => {
  if (typeof Bun === 'undefined' || process.env.NODE_ENV === 'test') return
  try {
    Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' })
  } catch {}
}
/** Swaps how links open (tests record them instead of launching a browser). */
export function setUrlOpener(fn: (url: string) => void) {
  urlOpener = fn
}
export function openUrl(url: string) {
  if (url) urlOpener(url)
}

export function popoverShadow(): StyleDesc['boxShadow'] {
  return [
    { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: C.shadowSoft },
    { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: -6, color: C.shadow },
  ]
}

export function raisedShadow(): StyleDesc['boxShadow'] {
  return [
    { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: C.shadowSoft },
    { offsetX: 0, offsetY: 6, blurRadius: 20, spreadRadius: -8, color: C.shadow },
  ]
}

export function T({ children, size = 13.5, color, weight, mono, testId, style }: { children: React.ReactNode; size?: number; color?: string; weight?: number; mono?: boolean; testId?: string; style?: StyleDesc }) {
  return (
    <text testId={testId} style={{ fontFamily: mono ? MONO : SANS, fontSize: size, color: color ?? C.text, fontWeight: weight, lineHeight: Math.round(size * 1.45), ...style }}>
      {children}
    </text>
  )
}

export function Kbd({ keys, subtle }: { keys: string; subtle?: boolean }) {
  return (
    <div style={{ ...row({ justifyContent: 'center' }), height: 18, minWidth: 18, paddingLeft: 5, paddingRight: 5, borderRadius: 5, borderWidth: 1, borderColor: C.border, backgroundColor: subtle ? CLEAR : C.hover, flexShrink: 0, pointerEvents: 'none' }}>
      <text style={{ fontFamily: SANS, fontSize: 11, lineHeight: 14, color: C.ghost, fontWeight: 500, whiteSpace: 'nowrap' }}>{keys}</text>
    </div>
  )
}

export function Tip({ label, kbd, side = 'bottom', children }: { label?: string; kbd?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: React.ReactElement }) {
  const [open, setOpen] = useState(false)
  const pressed = useRef(false)
  if (!label) return children
  return (
    <Tooltip open={open} onOpenChange={(o) => setOpen(o && !pressed.current)} delayDuration={450} disableHoverableContent style={{ flexShrink: 0, alignItems: 'center' }}>
      <TooltipTrigger asChild onMouseDown={() => (pressed.current = true)} onMouseLeave={() => (pressed.current = false)}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} style={{ ...row({ gap: 8 }), height: 26, paddingLeft: 9, paddingRight: kbd ? 5 : 9, borderRadius: 7, backgroundColor: C.elevated, borderWidth: 1, borderColor: C.borderStrong, boxShadow: popoverShadow(), pointerEvents: 'none' }}>
        <text style={{ fontFamily: SANS, fontSize: 12, color: C.text, whiteSpace: 'nowrap' }}>{label}</text>
        {kbd && <Kbd keys={kbd} />}
      </TooltipContent>
    </Tooltip>
  )
}

export function statusColor(s: Status): string {
  return s === 'running' ? C.blue : s === 'blocked' ? C.orange : s === 'finished' ? C.add : s === 'failed' ? C.del : C.ghost
}

export function StatusDot({ status, size = 8, color }: { status: Status; size?: number; color?: string }) {
  const [dim, setDim] = useState(false)
  const running = status === 'running'
  if (!running) return <div style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? statusColor(status), flexShrink: 0, pointerEvents: 'none' }} />
  return (
    <motion.div
      initial={false}
      animate={{ opacity: running && dim ? 0.3 : 1 }}
      transition={{ duration: 0.8, ease: 'easeInOut' }}
      onMotionComplete={() => running && setDim((d) => !d)}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? statusColor(status), flexShrink: 0, pointerEvents: 'none' }}
    />
  )
}

export function IconButton({
  icon,
  onClick,
  testId,
  active,
  size = 16,
  box = 30,
  color,
  dot,
  tip,
  kbd,
  tipSide,
}: {
  icon: IconName
  onClick?: () => void
  testId?: string
  active?: boolean
  size?: number
  box?: number
  color?: string
  dot?: boolean
  tip?: string
  kbd?: string
  tipSide?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <Tip label={tip} kbd={kbd} side={tipSide}>
      <Button
        testId={testId}
        onClick={onClick}
        style={{ ...row({ justifyContent: 'center' }), position: 'relative', width: box, height: box, borderRadius: box >= 30 ? 8 : 7, cursor: 'pointer', flexShrink: 0, backgroundColor: active ? C.selected : CLEAR, hover: { backgroundColor: active ? C.selected : C.hover }, active: { backgroundColor: C.selected } }}
      >
        <Icon name={icon} size={size} color={color ?? (active ? C.text : C.tertiary)} />
        {dot && <div style={{ position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.sidebar, backgroundColor: C.del, pointerEvents: 'none' }} />}
      </Button>
    </Tip>
  )
}

export function Btn({ label, onClick, testId, primary, ghost, icon, disabled, small, danger, tip }: { label: string; onClick?: () => void; testId?: string; primary?: boolean; ghost?: boolean; icon?: IconName; disabled?: boolean; small?: boolean; danger?: boolean; tip?: string }) {
  const fg = primary ? C.sendFg : danger ? C.del : C.text
  const bg = primary ? C.sendBg : ghost ? CLEAR : C.raised
  const quiet = danger ? C.redSoft : C.hover
  return (
    <Tip label={tip}>
      <Button
        testId={testId}
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
        style={{
          ...row({ gap: 6, justifyContent: 'center' }),
          height: small ? 26 : 32,
          paddingLeft: small ? 9 : 12,
          paddingRight: small ? 9 : 12,
          borderRadius: small ? 7 : 8,
          borderWidth: primary || ghost ? 0 : 1,
          borderColor: danger ? C.del : C.borderStrong,
          backgroundColor: bg,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? 'default' : 'pointer',
          flexShrink: 0,
          hover: disabled ? {} : primary ? { opacity: 0.88 } : { backgroundColor: quiet },
          active: disabled ? {} : primary ? { opacity: 0.76 } : { backgroundColor: danger ? C.redSoft : C.selected },
        }}
      >
        {icon && <Icon name={icon} size={small ? 13 : 14} color={primary ? fg : danger ? fg : C.secondary} />}
        <text style={{ fontFamily: SANS, fontSize: small ? 12.5 : 13, color: fg, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{label}</text>
      </Button>
    </Tip>
  )
}

export type Tone = 'neutral' | 'blue' | 'orange' | 'green' | 'red' | 'purple'

export function toneColors(t: Tone): { fg: string; bg: string } {
  switch (t) {
    case 'blue':
      return { fg: C.blue, bg: C.blueSoft }
    case 'orange':
      return { fg: C.orange, bg: C.orangeSoft }
    case 'green':
      return { fg: C.add, bg: C.greenSoft }
    case 'red':
      return { fg: C.del, bg: C.redSoft }
    case 'purple':
      return { fg: C.purple, bg: C.purpleSoft }
    default:
      return { fg: C.chipText, bg: C.chip }
  }
}

export const statusTone = (s: Status): Tone => (s === 'running' ? 'blue' : s === 'blocked' ? 'orange' : s === 'finished' ? 'green' : s === 'failed' ? 'red' : 'neutral')

export function Badge({ label, tone = 'neutral', icon, status, testId, mono, big }: { label: string; tone?: Tone; icon?: IconName; status?: Status; testId?: string; mono?: boolean; big?: boolean }) {
  const { fg, bg } = toneColors(tone)
  return (
    <div style={{ ...row({ gap: 5 }), height: big ? 22 : 20, paddingLeft: icon || status ? 7 : 8, paddingRight: 8, borderRadius: big ? 11 : 10, backgroundColor: bg, flexShrink: 0, pointerEvents: 'none' }}>
      {status && <StatusDot status={status} size={6} color={fg} />}
      {icon && <Icon name={icon} size={big ? 12 : 11} color={fg} />}
      <text testId={testId} style={{ fontFamily: mono ? MONO : SANS, fontSize: big ? 12 : 11.5, lineHeight: 14, fontWeight: 500, color: fg, whiteSpace: 'nowrap' }}>{label}</text>
    </div>
  )
}

export function StatusPill({ status, testId, label }: { status: Status; testId?: string; label?: string }) {
  return <Badge big label={label ?? STATUS_LABEL[status]} tone={statusTone(status)} status={status} testId={testId} />
}

export function Card({ children, testId, onClick, style }: { children: React.ReactNode; testId?: string; onClick?: () => void; style?: StyleDesc }) {
  return (
    <div testId={testId} onClick={onClick} style={{ ...col({ gap: 6 }), padding: 14, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, cursor: onClick ? 'pointer' : 'default', hover: onClick ? { borderColor: C.borderStrong } : {}, ...style }}>
      {children}
    </div>
  )
}

export function Divider({ spacing = 0 }: { spacing?: number }) {
  return <div style={{ height: 1, backgroundColor: C.border, flexShrink: 0, marginTop: spacing, marginBottom: spacing }} />
}

export function Empty({ text }: { text: string }) {
  return (
    <div style={{ ...row({ justifyContent: 'center' }), paddingTop: 28, paddingBottom: 28 }}>
      <T size={13} color={C.ghost}>{text}</T>
    </div>
  )
}

export function EmptyState({ icon, title, body, action, testId, compact }: { icon: IconName; title: string; body?: string; action?: React.ReactNode; testId?: string; compact?: boolean }) {
  return (
    <div style={{ ...col({ alignItems: 'center', justifyContent: 'center', gap: 4 }), paddingTop: compact ? 24 : 44, paddingBottom: compact ? 24 : 44, paddingLeft: 24, paddingRight: 24 }}>
      <div style={{ ...row({ justifyContent: 'center' }), width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, marginBottom: 8 }}>
        <Icon name={icon} size={17} color={C.tertiary} />
      </div>
      <T testId={testId} size={13.5} weight={500}>{title}</T>
      {body && <T size={12.5} color={C.tertiary} style={{ textAlign: 'center', maxWidth: 340 }}>{body}</T>}
      {action && <div style={{ paddingTop: 10 }}>{action}</div>}
    </div>
  )
}

export function Notice({ text, tone }: { text: string; tone?: 'error' | 'ok' }) {
  const color = tone === 'error' ? C.del : tone === 'ok' ? C.add : C.tertiary
  return (
    <div style={row({ gap: 7, alignItems: 'flex-start' })}>
      <div style={{ paddingTop: 2 }}>
        <Icon name={tone === 'error' ? 'circleAlert' : tone === 'ok' ? 'circleCheck' : 'help'} size={14} color={color} />
      </div>
      <T testId="notice" size={12.5} color={tone ? color : C.tertiary} style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>{text}</T>
    </div>
  )
}

export function Toggle({ on, onChange, testId }: { on: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <Button testId={testId} onClick={() => onChange(!on)} style={{ position: 'relative', width: 30, height: 18, borderRadius: 9, cursor: 'pointer', backgroundColor: on ? C.accent : C.borderStrong, flexShrink: 0, hover: { opacity: 0.88 } }}>
      <motion.div
        initial={false}
        animate={{ left: (on ? 14 : 2) * getZoom() }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        style={{ position: 'absolute', top: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#ffffff', pointerEvents: 'none' }}
      />
    </Button>
  )
}

export function Segmented<V extends string>({ items, value, onChange, testId, small }: { items: readonly { value: V; label: string; icon?: IconName }[]; value: V; onChange: (v: V) => void; testId: string; small?: boolean }) {
  return (
    <div style={{ ...row({ gap: 2 }), padding: 2, borderRadius: 9, backgroundColor: C.hover, borderWidth: 1, borderColor: C.border, flexShrink: 0 }}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <div
            key={it.value}
            testId={`${testId}-${it.value}`}
            onClick={() => onChange(it.value)}
            style={{ ...row({ gap: 6, justifyContent: 'center' }), height: small ? 24 : 26, paddingLeft: small ? 9 : 12, paddingRight: small ? 9 : 12, borderRadius: 7, cursor: 'pointer', backgroundColor: active ? C.elevated : CLEAR, boxShadow: active ? raisedShadow() : undefined, hover: { backgroundColor: active ? C.elevated : C.selected } }}
          >
            {it.icon && <Icon name={it.icon} size={13} color={active ? C.text : C.tertiary} />}
            <text style={{ fontFamily: SANS, fontSize: small ? 12.5 : 13, fontWeight: 500, color: active ? C.text : C.tertiary, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{it.label}</text>
          </div>
        )
      })}
    </div>
  )
}

export function Pills<V extends string>({ items, value, onChange, testId }: { items: { value: V; label: string; count?: number }[]; value: V; onChange: (v: V) => void; testId: string }) {
  return (
    <div style={row({ gap: 4, flexWrap: 'wrap' })}>
      {items.map((it) => {
        const active = value === it.value
        return (
          <div
            key={it.value}
            testId={`${testId}-${it.value}`}
            onClick={() => onChange(it.value)}
            style={{ ...row({ gap: 6 }), height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: 'pointer', backgroundColor: active ? C.selected : CLEAR, hover: { backgroundColor: active ? C.selected : C.hover } }}
          >
            <text style={{ fontFamily: SANS, fontSize: 13, color: active ? C.text : C.tertiary, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{it.label}</text>
            {it.count !== undefined && <text style={{ fontFamily: SANS, fontSize: 12, color: active ? C.tertiary : C.ghost, fontWeight: 500, pointerEvents: 'none' }}>{String(it.count)}</text>}
          </div>
        )
      })}
    </div>
  )
}

export function Tabs<V extends string>({ items, value, onChange, testId }: { items: { value: V; label: string; count?: number }[]; value: V; onChange: (v: V) => void; testId: string }) {
  return (
    <div style={{ ...row({ gap: 22, alignItems: 'flex-end' }), height: 36, borderBottomWidth: 1, borderColor: C.border, flexShrink: 0 }}>
      {items.map((it) => {
        const active = value === it.value
        return (
          <div
            key={it.value}
            testId={`${testId}-${it.value}`}
            onClick={() => onChange(it.value)}
            style={{ ...row({ gap: 7 }), height: 36, marginBottom: -1, borderBottomWidth: 2, borderColor: active ? C.text : CLEAR, cursor: 'pointer', hover: { borderColor: active ? C.text : C.borderStrong } }}
          >
            <text style={{ fontFamily: SANS, fontSize: 13.5, color: active ? C.text : C.tertiary, fontWeight: 500, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{it.label}</text>
            {it.count !== undefined && (
              <div style={{ ...row({ justifyContent: 'center' }), height: 18, minWidth: 18, paddingLeft: 6, paddingRight: 6, borderRadius: 9, backgroundColor: active ? C.selected : C.hover, pointerEvents: 'none' }}>
                <text style={{ fontFamily: SANS, fontSize: 11.5, color: active ? C.secondary : C.ghost, fontWeight: 500 }}>{String(it.count)}</text>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function inputStyle(focused: boolean, mono?: boolean): StyleDesc {
  return { width: '100%', fontSize: 13.5, color: C.text, backgroundColor: C.input, fontFamily: mono ? MONO : SANS, borderWidth: 1, borderColor: focused ? C.focus : C.border, borderRadius: 8, paddingLeft: 10, paddingRight: 10, hover: { borderColor: focused ? C.focus : C.borderStrong } }
}

export function Field({ value, onChange, placeholder, testId, multiline, mono }: { value: string; onChange: (v: string) => void; placeholder: string; testId: string; multiline?: boolean; mono?: boolean }) {
  const [focused, setFocused] = useState(false)
  const style = inputStyle(focused, mono)
  const theme = { caret: C.text, textMuted: C.ghost }
  const focus = { onFocus: () => setFocused(true), onBlur: () => setFocused(false) }
  return multiline ? (
    <textarea testId={testId} value={value} placeholder={placeholder} minRows={3} maxRows={8} onChange={(e) => onChange(e.value ?? '')} style={{ ...style, paddingTop: 8, paddingBottom: 8, lineHeight: 20 }} theme={theme} {...focus} />
  ) : (
    <input testId={testId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.value ?? '')} style={{ ...style, height: 32 }} theme={theme} {...focus} />
  )
}

export function SecretField({ value, onChange, placeholder, testId, reveal }: { value: string; onChange: (v: string) => void; placeholder: string; testId: string; reveal: boolean }) {
  const [focused, setFocused] = useState(false)
  const masked = !reveal && value.length > 0
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        testId={testId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.value ?? '')}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ ...inputStyle(focused, true), height: 32, fontSize: 13, color: masked ? C.input : C.text }}
        theme={{ caret: C.text, textMuted: C.ghost }}
      />
      {masked && (
        <div style={{ position: 'absolute', left: 11, top: 0, bottom: 0, ...row(), pointerEvents: 'none' }}>
          <T testId={`${testId}-mask`} mono size={13} color={C.text}>{'•'.repeat(Math.min(value.length, 40))}</T>
        </div>
      )}
    </div>
  )
}

export function Avatar({ name, size = 22, round }: { name: string; size?: number; round?: boolean }) {
  return (
    <div
      style={{
        ...row({ justifyContent: 'center' }),
        width: size,
        height: size,
        borderRadius: round ? size / 2 : Math.round(size * 0.3),
        background: { type: 'linear-gradient', angle: 150, stops: [{ color: '#8b9cff', position: 0 }, { color: '#4b5fe0', position: 1 }], colorSpace: 'oklab' },
        flexShrink: 0,
        pointerEvents: 'none',
      }}
    >
      <text style={{ fontFamily: SANS, fontSize: Math.round(size * 0.5), fontWeight: 600, color: '#ffffff' }}>{(name.trim()[0] ?? '?').toUpperCase()}</text>
    </div>
  )
}

export function SectionTitle({ title, count, hint, actions, testId }: { title: string; count?: number; hint?: string; actions?: React.ReactNode; testId?: string }) {
  return (
    <div style={col({ gap: 2 })}>
      <div style={row({ gap: 8, minHeight: 26 })}>
        <T testId={testId} size={14} weight={600}>{title}</T>
        {count !== undefined && <T size={12.5} color={C.ghost} weight={500}>{String(count)}</T>}
        <div style={{ flexGrow: 1 }} />
        {actions}
      </div>
      {hint && <T size={12.5} color={C.tertiary}>{hint}</T>}
    </div>
  )
}

export function ListRow({ children, onClick, testId, selected, style }: { children: React.ReactNode; onClick?: () => void; testId?: string; selected?: boolean; style?: StyleDesc }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{ ...row({ gap: 10 }), minHeight: 40, paddingLeft: 10, paddingRight: 10, borderRadius: 8, cursor: onClick ? 'pointer' : 'default', backgroundColor: selected ? C.hover : CLEAR, hover: { backgroundColor: C.hover }, ...style }}
    >
      {children}
    </div>
  )
}

export function IconTile({ icon, color, bg, size = 28 }: { icon: IconName; color?: string; bg?: string; size?: number }) {
  return (
    <div style={{ ...row({ justifyContent: 'center' }), width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: bg ?? C.hover, borderWidth: bg ? 0 : 1, borderColor: C.border, flexShrink: 0, pointerEvents: 'none' }}>
      <Icon name={icon} size={Math.round(size * 0.5)} color={color ?? C.tertiary} />
    </div>
  )
}

/* ───────────── Action menu (headless Select used as a popup menu) ───────────── */

export function menuStyle(): StyleDesc {
  return {
    minWidth: 220,
    padding: 5,
    backgroundColor: C.menu,
    borderWidth: 1,
    borderColor: C.borderStrong,
    borderRadius: 11,
    boxShadow: popoverShadow(),
  }
}

export function menuItemStyle(state: { highlighted: boolean }, danger?: boolean): StyleDesc {
  const hi = danger ? C.redSoft : C.hover
  return { ...row({ gap: 10 }), width: '100%', minHeight: 30, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderRadius: 7, cursor: 'pointer', backgroundColor: state.highlighted ? hi : C.menu, hover: { backgroundColor: hi } }
}

export type MenuAction = { id: string; label: string; icon?: IconName; hint?: string; danger?: boolean; header?: boolean; run?: () => void }

const SHORTCUT = /^[⌘⇧⌃⌥]/

export function ActionMenu({ items, testId, side = 'bottom', children, triggerStyle }: { items: MenuAction[]; testId: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: React.ReactNode; triggerStyle?: StyleDesc }) {
  const actionable = items.filter((i) => !i.header)
  return (
    <Select items={actionable.map((i) => ({ value: i.id, label: i.label }))} value="" onValueChange={(v) => actionable.find((i) => i.id === v)?.run?.()} style={{ flexShrink: 0 }}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <SelectTrigger
          testId={testId}
          style={(s) => ({ ...row({ gap: 6, justifyContent: 'center' }), minWidth: 28, height: 28, paddingLeft: 6, paddingRight: 6, borderRadius: 7, cursor: 'pointer', backgroundColor: s.open ? C.selected : CLEAR, hover: { backgroundColor: s.open ? C.selected : C.hover }, ...triggerStyle })}
        >
          {children}
        </SelectTrigger>
        <SelectContent side={side} sideOffset={6} style={menuStyle()}>
          {items.map((it, i) =>
            it.header ? (
              <div key={it.id} style={col()}>
                {i > 0 && <div style={{ height: 1, marginTop: 4, marginBottom: 4, marginLeft: -5, marginRight: -5, backgroundColor: C.border }} />}
                <div style={{ paddingLeft: 8, paddingTop: 4, paddingBottom: 4 }}>
                  <text style={{ fontFamily: SANS, fontSize: 11.5, color: C.ghost, fontWeight: 500 }}>{it.label}</text>
                </div>
              </div>
            ) : (
              <SelectItem key={it.id} value={it.id} testId={`${testId}-${it.id}`} style={(s) => menuItemStyle(s, it.danger)}>
                {() => (
                  <>
                    {it.icon && <Icon name={it.icon} size={14} color={it.danger ? C.del : C.tertiary} />}
                    <text style={{ fontFamily: SANS, color: it.danger ? C.del : C.text, fontSize: 13.5, flexGrow: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>{it.label}</text>
                    {it.hint && (it.hint === '✓' ? <Icon name="check" size={14} color={C.accent} /> : SHORTCUT.test(it.hint) ? <Kbd keys={it.hint} subtle /> : <text style={{ fontFamily: SANS, color: C.ghost, fontSize: 12, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1, maxWidth: 160 }}>{it.hint}</text>)}
                  </>
                )}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </div>
    </Select>
  )
}
