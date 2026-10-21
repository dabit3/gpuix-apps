import { memo } from 'react'
import type { Controller } from './controller'
import { parseLine } from './parse'
import { LEVELS } from './store'
import { C, LEVEL_COLOR, MONO, serviceColor } from './theme'

const CODE_THEME = { appearance: 'dark' as const, accent: C.accent }

function pretty(payload: string | null): { json: string; stack: string | null } | null {
  if (!payload) return null
  try {
    const v = JSON.parse(payload)
    let stack: string | null = null
    if (v && typeof v === 'object' && v.error && typeof v.error.stack === 'string') {
      stack = v.error.stack
      v.error = { ...v.error, stack: '(shown below)' }
    }
    return { json: JSON.stringify(v, null, 2), stack }
  } catch {
    return { json: payload, stack: null }
  }
}

/** Side panel for the clicked line: fields, pretty JSON payload, stack trace. */
export const Inspector = memo(function Inspector({
  ctl,
  line,
  onClose,
  onCopy,
  onFilterRequest,
}: {
  ctl: Controller
  line: number
  onClose: () => void
  onCopy: (text: string) => void
  onFilterRequest: (req: string) => void
}) {
  const raw = ctl.store.line(line)
  const p = parseLine(raw)
  const lv = ctl.store.level[line]!
  const svc = ctl.store.svc[line]!
  const body = pretty(p.payload)
  const message = p.payload ? p.rest.slice(0, p.rest.length - p.payload.length).replace(/^req=[0-9a-f]+ /, '').trim() : p.rest
  const ts = ctl.store.ts[line]!
  return (
    <div testId="inspector" style={{ width: 420, flexShrink: 0, display: 'flex', flexDirection: 'column', backgroundColor: C.panel, borderLeftWidth: 1, borderColor: C.border }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 16, paddingRight: 10, borderBottomWidth: 1, borderColor: C.border, userSelect: 'none' }}>
        <text style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap' }}>{`Line ${(line + 1).toLocaleString('en-US')}`}</text>
        <div style={{ flexGrow: 1 }} />
        <SmallButton testId="copy-line" label="Copy line" onClick={() => onCopy(raw)} />
        <div testId="close-inspector" onClick={onClose} style={{ width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center', display: 'flex', cursor: 'pointer', hover: { backgroundColor: C.raisedHover } }}>
          <text style={{ fontSize: 14, color: C.textDim }}>✕</text>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: 'scroll', padding: 16, gap: 14, scrollbarColor: '#ffffff22' }}>
        <text style={{ fontSize: 14, color: C.text, lineHeight: 20 }}>{message}</text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Field label="Time" value={Number.isFinite(ts) ? new Date(ts).toISOString().replace('T', ' ').replace('Z', ' UTC') : '—'} mono />
          <Field label="Level" value={LEVELS[lv]!} color={LEVEL_COLOR[lv]} />
          <Field label="Service" value={ctl.store.services[svc] ?? '-'} color={serviceColor(svc)} />
          {p.requestId && <Field label="Request" value={p.requestId} mono />}
          <Field label="Length" value={`${raw.length} chars`} />
        </div>
        {p.requestId && (
          <SmallButton testId="filter-request" label={`Show all lines for req=${p.requestId}`} onClick={() => onFilterRequest(p.requestId!)} />
        )}
        {body && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <text style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>PAYLOAD</text>
            <code testId="payload" code={body.json} language="json" theme={CODE_THEME} style={{ padding: 12, borderRadius: 8, backgroundColor: '#0b0c0e', borderWidth: 1, borderColor: C.border, fontSize: 12, lineHeight: 18 }} />
          </div>
        )}
        {body?.stack && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <text style={{ fontSize: 11, fontWeight: 600, color: '#f0564f' }}>STACK TRACE</text>
            <div style={{ display: 'flex', flexDirection: 'column', padding: 12, borderRadius: 8, backgroundColor: '#f0564f0f', borderWidth: 1, borderColor: '#f0564f33', gap: 2 }}>
              {body.stack.split('\n').map((l, i) => (
                <text key={i} style={{ fontFamily: MONO, fontSize: 11, color: i === 0 ? '#ffb4ae' : C.textDim, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{l}</text>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <text style={{ fontSize: 11, fontWeight: 600, color: C.textMuted }}>RAW</text>
          <text style={{ fontFamily: MONO, fontSize: 11, color: C.textDim, lineHeight: 16 }}>{raw}</text>
        </div>
      </div>
    </div>
  )
})

function Field({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 70 }}>
        <text style={{ fontSize: 12, color: C.textMuted }}>{label}</text>
      </div>
      <text style={{ fontSize: 12, color: color ?? C.text, fontFamily: mono ? MONO : undefined, fontWeight: color ? 600 : 400 }}>{value}</text>
    </div>
  )
}

export function SmallButton({ label, onClick, testId, active }: { label: string; onClick: () => void; testId?: string; active?: boolean }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 26,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 6,
        cursor: 'pointer',
        backgroundColor: active ? C.accentSoft : C.raised,
        borderWidth: 1,
        borderColor: active ? '#3d8bfd66' : C.border,
        hover: { backgroundColor: active ? '#3d8bfd40' : C.raisedHover },
        userSelect: 'none',
      }}
    >
      <text style={{ fontSize: 12, color: active ? '#cfe1ff' : C.text, fontWeight: 500 }}>{label}</text>
    </div>
  )
}
