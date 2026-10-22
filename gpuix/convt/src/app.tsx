import { useEffect, useReducer, useRef, type ReactNode } from 'react'
import { render, useWindowSize } from '@gpuix/react'
import { MAX_DIMS, PRESETS, type PresetId } from './formats'
import { computeLayout, delta, formatBytes, formatDuration, keyName, type Layout } from './layout'
import type { FileItem, Store } from './store'
import { alpha, type Theme } from './theme'

type KeyLike = { key?: string; keyChar?: string | null; modifiers?: { control?: boolean; shift?: boolean; platform?: boolean; alt?: boolean } }

function useStore(store: Store) {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => store.subscribe(force), [store])
}

/** Keyboard map. Plain keys only: Ghostty owns Cmd shortcuts. */
export function handleKey(store: Store, e: KeyLike): boolean {
  const k = keyName(e)
  const s = store.current()
  switch (k) {
    case 'up': case 'k': store.moveFocus(-1); return true
    case 'down': case 'j': store.moveFocus(1); return true
    case 'left': store.cycleTarget(-1); return true
    case 'right': case 'tab': store.cycleTarget(1); return true
    case '-': case '[': store.nudgeQuality(-5); return true
    case '=': case '+': case ']': store.nudgeQuality(5); return true
    case '1': store.applyPreset('small'); return true
    case '2': store.applyPreset('hq'); return true
    case '3': store.applyPreset('x'); return true
    case 'm': store.cycleMaxDim(); return true
    case 's': if (s) store.update({ strip: !s.strip }); return true
    case 'v': if (s && store.info.videotoolbox) store.update({ hw: !s.hw }); return true
    case 'space': store.toggleCheck(); return true
    case 'a': store.checkAll(); return true
    case 'enter': store.convert(); return true
    case 'x': store.cancel(); return true
    case 'escape': store.cancelAll(); return true
    case 'o': case 'r': store.reveal(); return true
  }
  return false
}

const T = (props: { c: string; s?: number; w?: number; mono?: boolean; children: ReactNode; style?: Record<string, unknown>; testId?: string }) => (
  <text testId={props.testId} style={{ color: props.c, fontSize: props.s ?? 13, fontWeight: props.w ?? 400, ...(props.mono ? { fontFamily: 'Menlo' } : {}), whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 0, ...props.style }}>
    {nb(props.children)}
  </text>
)

/** GPUI breaks lines at spaces even in nowrap rows, so short labels use no-break spaces. */
function nb(c: ReactNode): ReactNode {
  if (typeof c === 'string') return c.replace(/ /g, '\u00a0')
  // Multiple text children become separate runs that GPUI wraps between, so join primitives into one string.
  if (Array.isArray(c) && c.every((x) => typeof x === 'string' || typeof x === 'number')) return c.join('').replace(/ /g, '\u00a0')
  return c
}

function Header({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const st = store.stats()
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: L.header, paddingLeft: 20, paddingRight: 20, gap: 10, borderBottomWidth: 1, borderColor: t.line }}>
      <T c={t.fg} s={14} w={600}>convt</T>
      {L.kind !== 'thin' ? <T c={t.faint} s={13}>{store.files.length} {store.files.length === 1 ? 'file' : 'files'}</T> : null}
      <div style={{ flexGrow: 1 }} />
      {st.running ? <T c={t.dim} s={12}>Converting {st.running} of {st.running + st.queued}</T> : null}
      <div testId="local-badge" style={{ display: 'flex', alignItems: 'center' }}>
        <T c={t.faint} s={12}>{L.kind === 'thin' ? 'Local' : 'On-device · no network'}</T>
      </div>
    </div>
  )
}

function ext(f: FileItem): string {
  const e = f.name.includes('.') ? f.name.split('.').pop()! : f.src.format
  return e.slice(0, 4).toLowerCase()
}

function Thumb({ f, t, size }: { f: FileItem; t: Theme; size: number }) {
  if (f.thumb && (f.src.kind === 'image' || f.src.kind === 'video' || f.src.kind === 'pdf')) {
    return <img src={f.thumb} objectFit="cover" style={{ width: size, height: size, borderRadius: 5, flexShrink: 0 }} />
  }
  return (
    <div style={{ width: size, height: size, borderRadius: 5, backgroundColor: alpha(t.fg, 0.06), borderWidth: 1, borderColor: alpha(t.fg, 0.08), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <T c={t.dim} s={10} w={500} mono>{ext(f)}</T>
    </div>
  )
}

function subline(f: FileItem): string {
  const parts = [f.src.label]
  if (f.src.width && f.src.height) parts.push(`${f.src.width} × ${f.src.height}`)
  if (f.src.duration) parts.push(formatDuration(f.src.duration))
  parts.push(formatBytes(f.size))
  return parts.join('  ·  ')
}

function FileRow({ store, f, i, t, compact }: { store: Store; f: FileItem; i: number; t: Theme; compact: boolean }) {
  const focused = i === store.focus
  const tgt = store.targetOf(f)
  const h = compact ? 44 : 52
  const running = f.state === 'running'
  const right = () => {
    if (f.state === 'done') return <T c={t.dim} s={12}>{formatBytes(f.outputSize ?? 0)}</T>
    if (f.state === 'failed') return <T c={t.bad} s={12}>Failed</T>
    if (f.state === 'canceled') return <T c={t.faint} s={12}>Canceled</T>
    if (f.state === 'queued') return <T c={t.faint} s={12}>Waiting</T>
    if (running) return <T c={t.dim} s={12} mono>{Math.round(f.progress * 100)}%</T>
    return tgt ? <T c={t.faint} s={12}>{tgt.label}</T> : null
  }
  return (
    <div
      testId={`file-${i}`}
      onClick={(e: { clickCount?: number }) => { store.setFocus(i); if ((e.clickCount ?? 1) >= 2) store.convert([f]) }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 12, height: h, paddingLeft: 10, paddingRight: 12, borderRadius: 7, flexShrink: 0,
        backgroundColor: focused ? alpha(t.fg, 0.09) : 'transparent',
        cursor: 'pointer', hover: { backgroundColor: focused ? alpha(t.fg, 0.1) : alpha(t.fg, 0.04) },
      }}
    >
      <div
        testId={`check-${i}`}
        onClick={() => store.toggleCheck(i)}
        style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 1, borderColor: f.checked ? t.fg : alpha(t.fg, 0.28), backgroundColor: f.checked ? t.fg : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
      >
        {f.checked ? <T c={t.bg} s={10} w={700}>✓</T> : null}
      </div>
      <Thumb f={f} t={t} size={compact ? 28 : 34} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
        <T c={t.fg} s={13} w={500} style={{ flexShrink: 1, lineClamp: 1 }}>{f.name}</T>
        {!compact ? <T c={t.faint} s={11.5} style={{ flexShrink: 1, lineClamp: 1 }}>{f.src.label}  ·  {formatBytes(f.size)}</T> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {f.state === 'done' ? <T c={t.good} s={12} w={600}>✓</T> : null}
        {right()}
      </div>
      {running ? (
        <div style={{ position: 'absolute', left: 58, right: 12, bottom: 5, height: 2, borderRadius: 1, backgroundColor: alpha(t.fg, 0.08), pointerEvents: 'none' }}>
          <div style={{ width: `${Math.round(f.progress * 100)}%`, height: 2, borderRadius: 1, backgroundColor: t.accent }} />
        </div>
      ) : null}
    </div>
  )
}

function FileList({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const compact = L.kind !== 'wide'
  const all = store.files.length > 0 && store.files.every((f) => f.checked)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: L.listW, height: L.listH, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 30, paddingLeft: 10, paddingRight: 10, gap: 8, flexShrink: 0 }}>
        <T c={t.dim} s={12} w={500}>Files</T>
        <div style={{ flexGrow: 1 }} />
        <div testId="check-all" onClick={() => store.checkAll()} style={{ cursor: 'pointer', hover: { opacity: 0.7 } }}>
          <T c={t.faint} s={12}>{all ? 'Deselect all' : 'Select all'}</T>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8, overflowY: 'scroll', flexGrow: 1 }}>
        {store.files.map((f, i) => <FileRow key={f.id} store={store} f={f} i={i} t={t} compact={compact} />)}
        {store.rejected.slice(0, 3).map((r) => (
          <div key={r.path} style={{ display: 'flex', height: 26, alignItems: 'center', paddingLeft: 10, flexShrink: 0 }}>
            <T c={t.faint} s={11.5}>Skipped {r.path.split('/').pop()} — {r.reason}</T>
          </div>
        ))}
      </div>
    </div>
  )
}

function Panel({ t, w, h, children, testId, divider }: { t: Theme; w: number; h: number; children: ReactNode; testId?: string; divider?: boolean }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', width: w, height: h, overflow: 'hidden', paddingLeft: divider ? 16 : 0, gap: 14, ...(divider ? { borderLeftWidth: 1, borderColor: t.line } : {}) }}>
      {children}
    </div>
  )
}

function Preview({ store, t, L, divider = false }: { store: Store; t: Theme; L: Layout; divider?: boolean }) {
  const f = store.focused
  if (!f) {
    return (
      <Panel t={t} w={L.previewW} h={L.previewH}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGrow: 1, gap: 6 }}>
          <T c={t.dim} s={14} w={500}>No files</T>
          <T c={t.faint} s={12.5} mono>convt ~/Desktop/*.png</T>
        </div>
      </Panel>
    )
  }
  const s = store.settings[f.src.kind]
  const tgt = store.targetOf(f)
  const iw = L.previewW - (divider ? 16 : 0)
  const p = store.preview
  const showCompare = f.src.kind === 'image' && f.state !== 'done'
  const compareH = showCompare ? Math.round(Math.min((iw / 2 - 6) * 0.62, L.previewH * 0.34)) : 0
  const outBlock = f.state === 'done' && f.outputThumb
  const headH = 40
  const mainH = Math.max(80, L.previewH - headH - 14 - (showCompare ? compareH + 26 + 14 : 0) - (f.state === 'done' ? 44 + 14 : 0))
  const shown = outBlock ? f.outputThumb! : f.thumb
  const extra = [f.meta.codec, f.meta.fps ? `${f.meta.fps} fps` : '', f.src.kind === 'video' && !f.src.hasAudio ? 'no audio' : '', f.meta.sampleRate ? `${f.meta.sampleRate / 1000} kHz` : '']
    .filter(Boolean).join('  ·  ')
  return (
    <Panel t={t} w={L.previewW} h={L.previewH} testId="preview" divider={divider}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, height: headH, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <T c={t.fg} s={15} w={600} style={{ flexShrink: 1, lineClamp: 1 }}>{f.name}</T>
          <div style={{ flexGrow: 1 }} />
          {outBlock ? <T c={t.faint} s={12}>Showing output</T> : null}
        </div>
        <T c={t.faint} s={12} style={{ lineClamp: 1 }}>{subline(f)}{extra ? `  ·  ${extra}` : ''}</T>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: iw, height: mainH, borderRadius: 8, backgroundColor: t.well, overflow: 'hidden', flexShrink: 0 }}>
        {f.src.kind === 'doc' ? (
          <div style={{ display: 'flex', flexDirection: 'column', width: iw, height: mainH, padding: 20, gap: 3, overflow: 'hidden' }}>
            {(f.text ?? '').split('\n').slice(0, Math.floor((mainH - 40) / 19)).map((line, i) => (
              <T key={i} c={i === 0 ? t.fg : t.dim} s={12.5} mono w={i === 0 ? 600 : 400}>{line || ' '}</T>
            ))}
          </div>
        ) : shown ? (
          <img testId="preview-image" src={shown} objectFit="contain" style={{ width: iw - 16, height: mainH - 16 }} />
        ) : (
          <T c={t.faint} s={12.5}>Loading…</T>
        )}
      </div>
      {showCompare ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 12, height: compareH }}>
            {[p?.original ?? f.crop?.path, p?.encoded].map((src, i) => (
              src
                ? <img key={i} testId={i ? 'preview-encoded' : 'preview-original'} src={src} objectFit="cover" style={{ width: iw / 2 - 6, height: compareH, borderRadius: 6 }} />
                : <div key={i} style={{ width: iw / 2 - 6, height: compareH, borderRadius: 6, backgroundColor: t.well }} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 18 }}>
            <div style={{ display: 'flex', width: iw / 2 - 6 }}>
              <T c={t.dim} s={12}>Original  ·  {formatBytes(f.size)}</T>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexGrow: 1 }}>
              <T c={t.dim} s={12}>{tgt?.label ?? ''}{tgt?.lossy ? ` at ${s.quality}` : ''}</T>
              {p && tgt ? <T testId="estimate" c={t.fg} s={12} w={500}>{`·  ${formatBytes(p.estimate)}`}</T> : null}
              <div style={{ flexGrow: 1 }} />
              {store.previewBusy ? <T c={t.faint} s={12}>Updating…</T> : p && tgt ? <T c={t.dim} s={12}>{delta(f.size, p.estimate)}</T> : null}
            </div>
          </div>
        </div>
      ) : null}
      {f.state === 'done' && f.output ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 44, paddingLeft: 14, paddingRight: 6, borderRadius: 8, backgroundColor: alpha(t.fg, 0.04), borderWidth: 1, borderColor: t.line, flexShrink: 0 }}>
          <T c={t.good} s={13} w={600}>✓</T>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}>
            <T testId="output-name" c={t.fg} s={12.5} w={500} style={{ width: iw - 140, lineClamp: 1 }}>{f.output.split('/').pop()}</T>
            <T c={t.faint} s={11.5}>{formatBytes(f.size)} → {formatBytes(f.outputSize ?? 0)}  ·  {delta(f.size, f.outputSize ?? 0)}  ·  {((f.ms ?? 0) / 1000).toFixed(1)} s</T>
          </div>
          <div testId="reveal" onClick={() => store.reveal(f)} style={{ paddingLeft: 12, paddingRight: 12, height: 30, borderRadius: 6, display: 'flex', alignItems: 'center', cursor: 'pointer', hover: { backgroundColor: alpha(t.fg, 0.08) } }}>
            <T c={t.fg} s={12.5} w={500}>Reveal</T>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

function Section({ t, title, right, children }: { t: Theme; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 16 }}>
        <T c={t.dim} s={12} w={500}>{title}</T>
        <div style={{ flexGrow: 1 }} />
        {right}
      </div>
      {children}
    </div>
  )
}

/** Segmented control: one hairline track, the selected segment is a raised fill. */
function Segmented<K extends string | number>({ t, items, value, onPick, idPrefix }: { t: Theme; items: { id: K; label: string; disabled?: boolean }[]; value: K | undefined; onPick: (k: K) => void; idPrefix: string }) {
  return (
    <div style={{ display: 'flex', padding: 2, gap: 2, borderRadius: 8, backgroundColor: alpha(t.fg, 0.06), flexShrink: 0 }}>
      {items.map((x) => {
        const on = x.id === value
        return (
          <div
            key={String(x.id)}
            testId={`${idPrefix}-${x.id}`}
            onClick={x.disabled ? undefined : () => onPick(x.id)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', height: 26, flexGrow: 1, flexBasis: 0, borderRadius: 6,
              backgroundColor: on ? alpha(t.fg, 0.16) : 'transparent', cursor: x.disabled ? 'default' : 'pointer',
              hover: on || x.disabled ? {} : { backgroundColor: alpha(t.fg, 0.06) },
            }}
          >
            <T c={on ? t.fg : x.disabled ? alpha(t.fg, 0.25) : t.dim} s={12} w={on ? 600 : 500}>{x.label}</T>
          </div>
        )
      })}
    </div>
  )
}

function FormatOption({ t, on, disabled, onClick, label, note, testId }: { t: Theme; on: boolean; disabled?: boolean; onClick?: () => void; label: string; note?: string; testId?: string }) {
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', height: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 7, gap: 6,
        backgroundColor: on ? t.fg : 'transparent',
        borderWidth: 1, borderColor: on ? t.fg : alpha(t.fg, disabled ? 0.06 : 0.14),
        cursor: disabled ? 'default' : 'pointer',
        hover: disabled || on ? {} : { backgroundColor: alpha(t.fg, 0.06) },
      }}
    >
      <T c={on ? t.bg : disabled ? alpha(t.fg, 0.25) : t.fg} s={12.5} w={on ? 600 : 500}>{label}</T>
      {note ? <T c={on ? alpha(t.bg, 0.6) : t.faint} s={11}>{note}</T> : null}
    </div>
  )
}

function Slider({ store, t, value, w }: { store: Store; t: Theme; value: number; w: number }) {
  const box = useRef({ x: 0, w })
  const dragging = useRef(false)
  const set = (x: number) => store.update({ quality: Math.max(1, Math.min(100, Math.round(((x - box.current.x) / box.current.w) * 100))) })
  const k = 16
  const x = Math.round((w - k) * (value / 100))
  return (
    <div
      testId="quality-slider"
      onLayout={(e: { x?: number; width?: number }) => { box.current = { x: e.x ?? 0, w: e.width ?? w } }}
      onMouseDown={(e: { x?: number }) => { dragging.current = true; set(e.x ?? 0) }}
      onMouseMove={(e: { x?: number; pressedButton?: number | null }) => { if (dragging.current && e.pressedButton != null) set(e.x ?? 0) }}
      onMouseUp={() => { dragging.current = false }}
      onScroll={(e: { deltaY?: number }) => store.nudgeQuality((e.deltaY ?? 0) > 0 ? 2 : -2)}
      style={{ position: 'relative', width: w, height: 20, cursor: 'pointer', flexShrink: 0 }}
    >
      <div style={{ position: 'absolute', left: 0, top: 9, width: w, height: 3, borderRadius: 2, backgroundColor: alpha(t.fg, 0.14), pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, top: 9, width: x + k / 2, height: 3, borderRadius: 2, backgroundColor: t.fg, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: x, top: 2, width: k, height: k, borderRadius: k / 2, backgroundColor: t.fg, pointerEvents: 'none' }} />
    </div>
  )
}

function Toggle({ t, on, label, onClick, testId }: { t: Theme; on: boolean; label: string; onClick: () => void; testId: string }) {
  return (
    <div testId={testId} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 28, cursor: 'pointer', flexShrink: 0 }}>
      <T c={t.fg} s={12.5}>{label}</T>
      <div style={{ flexGrow: 1 }} />
      <div style={{ position: 'relative', width: 30, height: 18, borderRadius: 9, backgroundColor: on ? t.accent : alpha(t.fg, 0.16) }}>
        <div style={{ position: 'absolute', left: on ? 14 : 2, top: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: on ? '#ffffff' : t.fg, pointerEvents: 'none' }} />
      </div>
    </div>
  )
}

function dimLabel(d: number): string {
  if (d === 0) return 'Original'
  return d >= 3800 ? '4K' : String(d)
}

function Settings({ store, t, w, h, divider }: { store: Store; t: Theme; w: number; h: number; divider: boolean }) {
  const f = store.focused
  const s = store.current()
  const ts = store.targets()
  const sel = store.selection()
  const busy = store.files.some((x) => x.state === 'running' || x.state === 'queued')
  const inner = w - (divider ? 16 : 0)
  const tgt = f ? store.targetOf(f) : null
  const showDim = f && (f.src.kind === 'image' || f.src.kind === 'video' || f.src.kind === 'pdf') && tgt?.id !== 'ico'
  const reason = ts.find((x) => !x.available)?.reason
  return (
    <Panel t={t} w={w} h={h} testId="settings" divider={divider}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, flexGrow: 1, overflowY: 'scroll', paddingTop: 4 }}>
        <Section t={t} title="Convert to">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ts.map((x) => (
              <FormatOption key={x.id} testId={`target-${x.id}`} t={t} on={s?.target === x.id && x.available} disabled={!x.available} onClick={() => store.setTarget(x.id)} label={x.label} note={x.note} />
            ))}
          </div>
          {reason ? <T c={t.faint} s={11.5} style={{ width: inner, whiteSpace: 'normal' }}>{`Unavailable: ${reason}`}</T> : null}
        </Section>
        {f && (f.src.kind === 'video' || f.src.kind === 'image') && s ? (
          <Section t={t} title="Preset">
            <Segmented<PresetId> t={t} idPrefix="preset" value={s.preset ?? undefined} onPick={(id) => store.applyPreset(id)}
              items={(Object.keys(PRESETS) as PresetId[]).map((id) => ({ id, label: id === 'small' ? 'Small' : id === 'hq' ? 'High quality' : 'For X' }))} />
          </Section>
        ) : null}
        {s && tgt?.lossy ? (
          <Section t={t} title="Quality" right={<T testId="quality-value" c={t.fg} s={12.5} w={500} mono>{s.quality}</T>}>
            <Slider store={store} t={t} value={s.quality} w={inner} />
          </Section>
        ) : null}
        {s && showDim ? (
          <Section t={t} title="Max size">
            <Segmented t={t} idPrefix="dim" value={s.maxDim} onPick={(d) => store.update({ maxDim: d })} items={MAX_DIMS.map((d) => ({ id: d, label: dimLabel(d) }))} />
          </Section>
        ) : null}
        {s && f && f.src.kind !== 'doc' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
            <Toggle testId="toggle-strip" t={t} on={s.strip} label="Strip metadata" onClick={() => store.update({ strip: !s.strip })} />
            {f.src.kind === 'video' && store.info.videotoolbox ? <Toggle testId="toggle-hw" t={t} on={s.hw} label="Hardware encoder" onClick={() => store.update({ hw: !s.hw })} /> : null}
          </div>
        ) : null}
        {f && tgt ? (
          <Section t={t} title="Saves as">
            <T testId="output-preview" c={t.fg} s={12} mono style={{ width: inner, lineClamp: 1 }}>{f.name.replace(/\.[^.]+$/, '')}.converted.{tgt.ext}</T>
            <T c={t.faint} s={11.5} style={{ width: inner }}>Next to the original. Never overwrites.</T>
          </Section>
        ) : null}
      </div>
      <div
        testId="convert"
        onClick={() => (busy ? store.cancelAll() : store.convert())}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 36, borderRadius: 8, flexShrink: 0,
          backgroundColor: busy ? 'transparent' : t.fg, borderWidth: 1, borderColor: busy ? alpha(t.fg, 0.2) : t.fg, cursor: 'pointer',
          hover: { opacity: 0.88 }, active: { opacity: 0.75 },
        }}
      >
        <T c={busy ? t.fg : t.bg} s={13} w={600}>{busy ? 'Cancel' : sel.length > 1 ? `Convert ${sel.length} files` : 'Convert'}</T>
      </div>
    </Panel>
  )
}

function Footer({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const st = store.stats()
  const keys: [string, string][] = L.kind === 'wide'
    ? [['↑↓', 'Select'], ['←→', 'Format'], ['space', 'Mark'], ['⏎', 'Convert'], ['x', 'Cancel'], ['o', 'Reveal'], ['⌃C', 'Quit']]
    : [['←→', 'Format'], ['⏎', 'Convert'], ['⌃C', 'Quit']]
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: L.footer, paddingLeft: 20, paddingRight: 20, gap: 16, borderTopWidth: 1, borderColor: t.line }}>
      {keys.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <T c={t.dim} s={11.5} mono>{k}</T>
          <T c={t.faint} s={11.5}>{v}</T>
        </div>
      ))}
      <div style={{ flexGrow: 1 }} />
      {st.failed ? <T c={t.bad} s={12}>{st.failed} failed</T> : null}
      {st.done ? <T testId="totals" c={t.faint} s={12}>{`${st.done} converted  ·  ${formatBytes(st.before)} → ${formatBytes(st.after)}  ·  ${delta(st.before, st.after)}`}</T> : null}
    </div>
  )
}


// After a slider drag GPUI's focus leaves the root, so a window-level listener catches keys the root missed.
let rootSawKey = false

export function App({ store, theme: t, size: fixed }: { store: Store; theme: Theme; size?: { width: number; height: number } }) {
  useStore(store)
  const live = useWindowSize()
  const size = fixed ?? live
  const L = computeLayout(size.width, size.height)
  const pad = 16
  const bodyH = L.h - L.header - L.footer
  return (
    <div testId="app-root" tabIndex={-1} autoFocus onKeyDown={(e: KeyLike) => { rootSawKey = true; handleKey(store, e) }} style={{ display: 'flex', flexDirection: 'column', width: size.width, height: size.height, backgroundColor: t.bg }}>
      <Header store={store} t={t} L={L} />
      {L.kind === 'wide' ? (
        <div style={{ display: 'flex', gap: pad, padding: pad, height: bodyH }}>
          <FileList store={store} t={t} L={L} />
          {L.showPreview ? <Preview store={store} t={t} L={L} divider /> : null}
          <Settings store={store} t={t} w={L.settingsW} h={L.listH} divider />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: pad, padding: pad, height: bodyH }}>
          <FileList store={store} t={t} L={L} />
          <div style={{ display: 'flex', gap: pad, height: bodyH - L.listH - pad * 3, borderTopWidth: 1, borderColor: t.line, paddingTop: pad }}>
            {L.showPreview ? <Preview store={store} t={t} L={L} /> : null}
            <Settings store={store} t={t} w={L.settingsW} h={bodyH - L.listH - pad * 3} divider={L.showPreview} />
          </div>
        </div>
      )}
      <Footer store={store} t={t} L={L} />
    </div>
  )
}

export function start(store: Store, theme: Theme, opts: { terminal: boolean }) {
  const onKeyDown = (e: KeyLike) => {
    if (rootSawKey) rootSawKey = false
    else handleKey(store, e)
  }
  render(<App store={store} theme={theme} />, { terminal: opts.terminal, title: 'convt', width: 1440, height: 880, onKeyDown } as never)
}
