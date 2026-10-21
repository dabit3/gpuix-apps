import { useEffect, useReducer, useRef, type ReactNode } from 'react'
import { render, useWindowSize } from '@gpuix/react'
import { MAX_DIMS, PRESETS, type PresetId } from './formats'
import { computeLayout, delta, formatBytes, formatDuration, keyName, type Layout } from './layout'
import type { FileItem, Store } from './store'
import { alpha, mix, type Theme } from './theme'

type KeyLike = { key?: string; keyChar?: string | null; modifiers?: { control?: boolean; shift?: boolean; platform?: boolean; alt?: boolean } }

const KIND_GLYPH = { image: 'IMG', video: 'VID', audio: 'AUD', pdf: 'PDF', doc: 'DOC' } as const

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
  const e = store.engines
  const names = ['ffmpeg', 'sips', 'cwebp', 'pandoc', 'textutil', 'typst'] as const
  const st = store.stats()
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: L.header, paddingLeft: 18, paddingRight: 18, gap: 14, borderBottomWidth: 1, borderColor: t.line }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <T c={t.bg} s={15} w={800}>⇄</T>
        </div>
        <T c={t.fg} s={17} w={700}>convt</T>
        {L.kind !== 'thin' ? <T c={t.dim} s={13}>{store.files.length} files</T> : null}
      </div>
      <div style={{ flexGrow: 1 }} />
      {L.kind === 'wide'
        ? names.map((n) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: e[n] ? t.good : t.faint }} />
              <T c={e[n] ? t.dim : t.faint} s={12}>{n}</T>
            </div>
          ))
        : null}
      {st.running ? <T c={t.accent} s={12} w={600}>{st.running} running · {store.concurrency} workers</T> : null}
      <div testId="local-badge" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 10, height: 24, borderRadius: 12, borderWidth: 1, borderColor: alpha(t.good, 0.5), backgroundColor: alpha(t.good, 0.08) }}>
        <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.good }} />
        <T c={t.good} s={12} w={600}>{L.kind === 'thin' ? 'local' : '100% local · no network'}</T>
      </div>
    </div>
  )
}

function KindBadge({ f, t, size }: { f: FileItem; t: Theme; size: number }) {
  const c = t.kinds[f.src.kind]
  if (f.thumb && (f.src.kind === 'image' || f.src.kind === 'video' || f.src.kind === 'pdf')) {
    return <img src={f.thumb} objectFit="cover" style={{ width: size, height: size, borderRadius: 7, borderWidth: 1, borderColor: alpha(c, 0.6) }} />
  }
  return (
    <div style={{ width: size, height: size, borderRadius: 7, backgroundColor: alpha(c, 0.14), borderWidth: 1, borderColor: alpha(c, 0.55), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <T c={c} s={10} w={800}>{KIND_GLYPH[f.src.kind]}</T>
    </div>
  )
}

function subline(f: FileItem): string {
  const parts = [f.src.label]
  if (f.src.width && f.src.height) parts.push(`${f.src.width}×${f.src.height}`)
  if (f.src.duration) parts.push(formatDuration(f.src.duration))
  parts.push(formatBytes(f.size))
  return parts.join(' · ')
}

function FileRow({ store, f, i, t, compact }: { store: Store; f: FileItem; i: number; t: Theme; compact: boolean }) {
  const focused = i === store.focus
  const tgt = store.targetOf(f)
  const h = compact ? 46 : 56
  const running = f.state === 'running'
  const right = () => {
    if (f.state === 'done') return <T c={t.good} s={12} w={600}>✓ {formatBytes(f.outputSize ?? 0)} {delta(f.size, f.outputSize ?? 0)}</T>
    if (f.state === 'failed') return <T c={t.bad} s={12} w={600}>failed</T>
    if (f.state === 'canceled') return <T c={t.faint} s={12}>canceled</T>
    if (f.state === 'queued') return <T c={t.dim} s={12}>queued</T>
    if (running) return <T c={t.accent} s={12} w={600} mono>{Math.round(f.progress * 100)}%{f.speed ? ` ${f.speed}` : ''}</T>
    return tgt ? <T c={t.dim} s={12} w={600}>→ {tgt.label}</T> : <T c={t.faint} s={12}>—</T>
  }
  return (
    <div
      testId={`file-${i}`}
      onClick={(e: { clickCount?: number }) => { store.setFocus(i); if ((e.clickCount ?? 1) >= 2) store.convert([f]) }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 11, height: h, paddingLeft: 10, paddingRight: 12, borderRadius: 9, flexShrink: 0,
        backgroundColor: focused ? mix(t.bg, t.accent, 0.13) : 'transparent', borderWidth: 1, borderColor: focused ? alpha(t.accent, 0.55) : 'transparent',
        cursor: 'pointer', hover: { backgroundColor: focused ? mix(t.bg, t.accent, 0.16) : mix(t.bg, t.fg, 0.05) },
      }}
    >
      <div
        testId={`check-${i}`}
        onClick={() => store.toggleCheck(i)}
        style={{ width: 16, height: 16, borderRadius: 5, borderWidth: 1.5, borderColor: f.checked ? t.accent : t.faint, backgroundColor: f.checked ? t.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
      >
        {f.checked ? <T c={t.bg} s={11} w={800}>✓</T> : null}
      </div>
      <KindBadge f={f} t={t} size={compact ? 30 : 38} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
        <T c={t.fg} s={13.5} w={focused ? 600 : 500} style={{ flexShrink: 1, lineClamp: 1 }}>{f.name}</T>
        {!compact ? <T c={t.dim} s={11.5} style={{ flexShrink: 1, lineClamp: 1 }}>{subline(f)}</T> : null}
      </div>
      <div style={{ flexShrink: 0 }}>{right()}</div>
      {running || f.state === 'done' ? (
        <div style={{ position: 'absolute', left: 10, right: 12, bottom: 4, height: 3, borderRadius: 2, backgroundColor: alpha(t.fg, 0.08), pointerEvents: 'none' }}>
          <div style={{ width: `${Math.round((f.state === 'done' ? 1 : f.progress) * 100)}%`, height: 3, borderRadius: 2, backgroundColor: f.state === 'done' ? t.good : t.accent }} />
        </div>
      ) : null}
    </div>
  )
}

function FileList({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const compact = L.kind !== 'wide'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: L.listW, height: L.listH, backgroundColor: t.panel, borderRadius: 12, borderWidth: 1, borderColor: t.line, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 36, paddingLeft: 14, paddingRight: 14, gap: 8 }}>
        <T c={t.dim} s={11.5} w={700}>FILES</T>
        <div style={{ flexGrow: 1 }} />
        <div testId="check-all" onClick={() => store.checkAll()} style={{ cursor: 'pointer', hover: { opacity: 0.8 } }}>
          <T c={t.accent} s={11.5} w={600}>{store.files.length && store.files.every((f) => f.checked) ? 'Clear' : 'Select all'}</T>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 6, paddingRight: 6, paddingBottom: 8, overflowY: 'scroll', flexGrow: 1 }}>
        {store.files.map((f, i) => <FileRow key={f.id} store={store} f={f} i={i} t={t} compact={compact} />)}
        {store.rejected.slice(0, 3).map((r) => (
          <div key={r.path} style={{ display: 'flex', height: 26, alignItems: 'center', paddingLeft: 14, flexShrink: 0 }}>
            <T c={t.faint} s={11.5}>skipped {r.path.split('/').pop()} · {r.reason}</T>
          </div>
        ))}
      </div>
    </div>
  )
}

function Panel({ t, w, h, children, testId }: { t: Theme; w: number; h: number; children: ReactNode; testId?: string }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', width: w, height: h, backgroundColor: t.panel, borderRadius: 12, borderWidth: 1, borderColor: t.line, overflow: 'hidden', padding: 14, gap: 12 }}>
      {children}
    </div>
  )
}

function Meta({ t, items }: { t: Theme; items: [string, string | undefined][] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 18, rowGap: 6 }}>
      {items.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 6 }}>
          <T c={t.faint} s={12}>{k}</T>
          <T c={t.fg} s={12} w={600}>{v}</T>
        </div>
      ))}
    </div>
  )
}

function Preview({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const f = store.focused
  if (!f) {
    return (
      <Panel t={t} w={L.previewW} h={L.previewH}>
        <T c={t.dim} s={14}>No files. Try: convt ~/Desktop/*.png</T>
      </Panel>
    )
  }
  const s = store.settings[f.src.kind]
  const tgt = store.targetOf(f)
  const iw = L.previewW - 28
  const p = store.preview
  const showCompare = f.src.kind === 'image' && f.state !== 'done'
  const compareH = showCompare ? Math.round(Math.min((iw / 2 - 5) * 0.7, L.previewH * 0.36)) : 0
  const outBlock = f.state === 'done' && f.outputThumb
  const metaH = 52
  const mainH = Math.max(80, L.previewH - 28 - 12 - metaH - (showCompare ? compareH + 44 : 0) - (f.state === 'done' ? 52 : 0) - (outBlock ? 12 : 0))
  const color = t.kinds[f.src.kind]
  const shown = outBlock ? f.outputThumb! : f.thumb
  return (
    <Panel t={t} w={L.previewW} h={L.previewH} testId="preview">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 18 }}>
        <T c={color} s={11.5} w={700}>{f.src.label.toUpperCase()}</T>
        <T c={t.fg} s={13} w={600} style={{ flexShrink: 1, lineClamp: 1 }}>{f.name}</T>
        <div style={{ flexGrow: 1 }} />
        {outBlock ? <T c={t.good} s={11.5} w={700}>OUTPUT · {tgt?.label}</T> : <T c={t.faint} s={11.5} w={600}>SOURCE</T>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: iw, height: mainH, borderRadius: 9, backgroundColor: t.well, overflow: 'hidden' }}>
        {f.src.kind === 'doc' ? (
          <div style={{ display: 'flex', flexDirection: 'column', width: iw, height: mainH, padding: 16, gap: 2, overflow: 'hidden' }}>
            {(f.text ?? '').split('\n').slice(0, Math.floor((mainH - 30) / 18)).map((line, i) => (
              <T key={i} c={i === 0 ? t.fg : t.dim} s={12.5} mono w={i === 0 ? 700 : 400}>{line || ' '}</T>
            ))}
          </div>
        ) : shown ? (
          <img testId="preview-image" src={shown} objectFit="contain" style={{ width: iw - 12, height: mainH - 12, borderRadius: 6 }} />
        ) : (
          <T c={t.faint} s={13}>reading…</T>
        )}
      </div>
      {showCompare ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 16 }}>
            <T c={t.dim} s={11.5} w={700}>LIVE PREVIEW · 1:1 CROP</T>
            <div style={{ flexGrow: 1 }} />
            {p && tgt ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <T testId="estimate" c={t.fg} s={12} w={600}>{`≈ ${formatBytes(p.estimate)}`}</T>
                <T c={p.estimate < f.size ? t.good : t.warn} s={12} w={700}>{delta(f.size, p.estimate)}</T>
              </div>
            ) : null}
            {store.previewBusy ? <T c={t.accent} s={11.5}>encoding…</T> : null}
          </div>
          <div style={{ display: 'flex', gap: 10, height: compareH }}>
            {[['Original', p?.original ?? f.crop?.path], [`${tgt?.label ?? ''}${tgt?.lossy ? ` · q${s.quality}` : ''}`, p?.encoded]].map(([label, src], i) => (
              <div key={i} style={{ position: 'relative', width: iw / 2 - 5, height: compareH }}>
                {src ? <img testId={i ? 'preview-encoded' : 'preview-original'} src={src} objectFit="cover" style={{ width: iw / 2 - 5, height: compareH, borderRadius: 8 }} /> : <div style={{ width: iw / 2 - 5, height: compareH, borderRadius: 8, backgroundColor: t.well }} />}
                <div style={{ position: 'absolute', left: 8, top: 8, paddingLeft: 8, paddingRight: 8, height: 22, borderRadius: 6, backgroundColor: alpha(t.bg, 0.78), display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                  <T c={i ? t.accent : t.fg} s={11.5} w={700}>{label}</T>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {f.state === 'done' && f.output ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 40, paddingLeft: 12, paddingRight: 8, borderRadius: 9, backgroundColor: alpha(t.good, 0.09), borderWidth: 1, borderColor: alpha(t.good, 0.4) }}>
          <T c={t.good} s={13} w={800}>✓</T>
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1, overflow: 'hidden' }}>
            <T testId="output-name" c={t.fg} s={12.5} w={600} style={{ width: iw - 140, lineClamp: 1 }}>{f.output.split('/').pop()}</T>
            <T c={t.dim} s={11.5}>{formatBytes(f.size)} → {formatBytes(f.outputSize ?? 0)} ({delta(f.size, f.outputSize ?? 0)}) · {((f.ms ?? 0) / 1000).toFixed(2)} s</T>
          </div>
          <div testId="reveal" onClick={() => store.reveal(f)} style={{ paddingLeft: 10, paddingRight: 10, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', backgroundColor: alpha(t.fg, 0.08), cursor: 'pointer', hover: { backgroundColor: alpha(t.fg, 0.14) } }}>
            <T c={t.fg} s={12} w={600}>Reveal</T>
          </div>
        </div>
      ) : null}
      <div style={{ height: metaH, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, borderTopWidth: 1, borderColor: t.line, paddingTop: 8 }}>
        <Meta t={t} items={[
          ['size', formatBytes(f.size)],
          ['pixels', f.src.width && f.src.height ? `${f.src.width}×${f.src.height}` : undefined],
          ['codec', f.meta.codec || undefined],
          ['fps', f.meta.fps ? String(f.meta.fps) : undefined],
          ['length', f.src.duration ? formatDuration(f.src.duration) : undefined],
          ['audio', f.src.kind === 'video' ? (f.src.hasAudio ? 'yes' : 'none') : f.meta.sampleRate ? `${f.meta.sampleRate / 1000} kHz · ${f.meta.channels} ch` : undefined],
          ['sniffed', f.src.format],
          ['ext', f.name.includes('.') ? f.name.split('.').pop() : '(none)'],
        ]} />
      </div>
    </Panel>
  )
}

function Section({ t, title, right, children }: { t: Theme; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 16 }}>
        <T c={t.dim} s={11.5} w={700}>{title}</T>
        <div style={{ flexGrow: 1 }} />
        {right}
      </div>
      {children}
    </div>
  )
}

function Chip({ t, on, disabled, onClick, children, testId, grow }: { t: Theme; on: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode; testId?: string; grow?: boolean }) {
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', height: 30, paddingLeft: 11, paddingRight: 11, borderRadius: 8, gap: 5,
        ...(grow ? { flexGrow: 1, flexBasis: 0 } : {}),
        backgroundColor: on ? t.accent : disabled ? 'transparent' : alpha(t.fg, 0.06),
        borderWidth: 1, borderColor: on ? t.accent : disabled ? alpha(t.fg, 0.08) : alpha(t.fg, 0.1),
        cursor: disabled ? 'default' : 'pointer',
        hover: disabled || on ? {} : { backgroundColor: alpha(t.fg, 0.11) },
      }}
    >
      {children}
    </div>
  )
}

function Slider({ store, t, value, w }: { store: Store; t: Theme; value: number; w: number }) {
  const box = useRef({ x: 0, w })
  const dragging = useRef(false)
  const set = (x: number) => store.update({ quality: Math.max(1, Math.min(100, Math.round(((x - box.current.x) / box.current.w) * 100))) })
  const pct = value / 100
  return (
    <div
      testId="quality-slider"
      onLayout={(e: { x?: number; width?: number }) => { box.current = { x: e.x ?? 0, w: e.width ?? w } }}
      onMouseDown={(e: { x?: number }) => { dragging.current = true; set(e.x ?? 0) }}
      onMouseMove={(e: { x?: number; pressedButton?: number | null }) => { if (dragging.current && e.pressedButton != null) set(e.x ?? 0) }}
      onMouseUp={() => { dragging.current = false }}
      onScroll={(e: { deltaY?: number }) => store.nudgeQuality((e.deltaY ?? 0) > 0 ? 2 : -2)}
      style={{ position: 'relative', width: w, height: 22, cursor: 'pointer' }}
    >
      <div style={{ position: 'absolute', left: 0, top: 9, width: w, height: 4, borderRadius: 2, backgroundColor: alpha(t.fg, 0.12), pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, top: 9, width: Math.round(w * pct), height: 4, borderRadius: 2, backgroundColor: t.accent, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: Math.round(w * pct) - 9, top: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: t.fg, borderWidth: 3, borderColor: t.accent, pointerEvents: 'none' }} />
    </div>
  )
}

function Toggle({ t, on, label, hint, onClick, testId }: { t: Theme; on: boolean; label: string; hint: string; onClick: () => void; testId: string }) {
  return (
    <div testId={testId} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 26, cursor: 'pointer' }}>
      <div style={{ position: 'relative', width: 34, height: 20, borderRadius: 10, backgroundColor: on ? t.good : alpha(t.fg, 0.16) }}>
        <div style={{ position: 'absolute', left: on ? 16 : 2, top: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: t.fg, pointerEvents: 'none' }} />
      </div>
      <T c={t.fg} s={12.5} w={500}>{label}</T>
      <div style={{ flexGrow: 1 }} />
      <T c={t.faint} s={11} mono>{hint}</T>
    </div>
  )
}

function Settings({ store, t, w, h }: { store: Store; t: Theme; w: number; h: number }) {
  const f = store.focused
  const s = store.current()
  const ts = store.targets()
  const sel = store.selection()
  const busy = store.files.some((x) => x.state === 'running' || x.state === 'queued')
  const inner = w - 28
  const tgt = f ? store.targetOf(f) : null
  const showDim = f && (f.src.kind === 'image' || f.src.kind === 'video' || f.src.kind === 'pdf') && tgt?.id !== 'ico'
  const reason = ts.find((x) => !x.available)?.reason
  return (
    <Panel t={t} w={w} h={h} testId="settings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flexGrow: 1, overflowY: 'scroll' }}>
        <Section t={t} title="CONVERT TO" right={<T c={t.faint} s={11} mono>← →</T>}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ts.map((x) => (
              <Chip key={x.id} testId={`target-${x.id}`} t={t} on={s?.target === x.id && x.available} disabled={!x.available} onClick={() => store.setTarget(x.id)}>
                <T c={s?.target === x.id && x.available ? t.bg : x.available ? t.fg : t.faint} s={12.5} w={600}>{x.label}</T>
                {x.note ? <T c={s?.target === x.id && x.available ? alpha(t.bg, 0.75) : t.faint} s={10.5}>{x.note}</T> : null}
              </Chip>
            ))}
          </div>
          {reason ? <T c={t.faint} s={11}>dimmed: {reason}</T> : null}
        </Section>
        {f && (f.src.kind === 'video' || f.src.kind === 'image') && s ? (
          <Section t={t} title="PRESET" right={<T c={t.faint} s={11} mono>1 2 3</T>}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(Object.keys(PRESETS) as PresetId[]).map((id) => (
                <Chip key={id} testId={`preset-${id}`} t={t} on={s.preset === id} onClick={() => store.applyPreset(id)} grow>
                  <T c={s.preset === id ? t.bg : t.fg} s={12} w={600}>{id === 'small' ? 'Small' : id === 'hq' ? 'High quality' : 'X ready'}</T>
                </Chip>
              ))}
            </div>
          </Section>
        ) : null}
        {s && tgt?.lossy ? (
          <Section t={t} title="QUALITY" right={<T testId="quality-value" c={t.fg} s={13} w={700} mono>{s.quality}</T>}>
            <Slider store={store} t={t} value={s.quality} w={inner} />
          </Section>
        ) : null}
        {s && showDim ? (
          <Section t={t} title="MAX SIZE" right={<T c={t.faint} s={11} mono>m</T>}>
            <div style={{ display: 'flex', gap: 4 }}>
              {MAX_DIMS.map((d) => (
                <Chip key={d} testId={`dim-${d}`} t={t} on={s.maxDim === d} onClick={() => store.update({ maxDim: d })} grow>
                  <T c={s.maxDim === d ? t.bg : t.fg} s={11.5} w={600}>{d === 0 ? 'Orig' : d >= 1000 ? `${(d / 1000).toFixed(d % 1000 ? 1 : 0)}k`.replace('3.8k', '4K') : String(d)}</T>
                </Chip>
              ))}
            </div>
          </Section>
        ) : null}
        {s && f && f.src.kind !== 'doc' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <Toggle testId="toggle-strip" t={t} on={s.strip} label="Strip metadata" hint="s" onClick={() => store.update({ strip: !s.strip })} />
            {f.src.kind === 'video' && store.info.videotoolbox ? <Toggle testId="toggle-hw" t={t} on={s.hw} label="VideoToolbox encoder" hint="v" onClick={() => store.update({ hw: !s.hw })} /> : null}
          </div>
        ) : null}
        {f && tgt ? (
          <Section t={t} title="OUTPUT">
            <T testId="output-preview" c={t.dim} s={12} mono style={{ width: inner, lineClamp: 1 }}>{f.name.replace(/\.[^.]+$/, '')}.converted.{tgt.ext}</T>
            <T c={t.faint} s={11.5} style={{ width: inner }}>beside the original · never overwrites</T>
          </Section>
        ) : null}
      </div>
      <div
        testId="convert"
        onClick={() => (busy ? store.cancelAll() : store.convert())}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, borderRadius: 10, flexShrink: 0,
          backgroundColor: busy ? alpha(t.bad, 0.16) : t.accent, borderWidth: 1, borderColor: busy ? alpha(t.bad, 0.6) : t.accent, cursor: 'pointer',
          hover: { opacity: 0.9 }, active: { opacity: 0.8 },
        }}
      >
        <T c={busy ? t.bad : t.bg} s={14} w={700}>{busy ? 'Cancel all' : `Convert ${sel.length} ${sel.length === 1 ? 'file' : 'files'}`}</T>
        <T c={busy ? alpha(t.bad, 0.7) : alpha(t.bg, 0.65)} s={12} w={600} mono>{busy ? 'esc' : '⏎'}</T>
      </div>
    </Panel>
  )
}

function Footer({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const st = store.stats()
  const hint = L.kind === 'wide' ? '↑↓ file  ·  space select  ·  a all  ·  ←→ format  ·  - = quality  ·  ⏎ convert  ·  x cancel  ·  o reveal  ·  ⌃C quit' : '↑↓ ←→ - = ⏎ x o · ⌃C quit'
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: L.footer, paddingLeft: 18, paddingRight: 18, gap: 12, borderTopWidth: 1, borderColor: t.line }}>
      <T c={t.faint} s={11.5}>{hint}</T>
      <div style={{ flexGrow: 1 }} />
      {st.done ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <T testId="totals" c={t.dim} s={12} w={600}>{`${st.done} converted · ${formatBytes(st.before)} → ${formatBytes(st.after)}`}</T>
          <T c={st.after <= st.before ? t.good : t.warn} s={12} w={700}>{delta(st.before, st.after)}</T>
        </div>
      ) : null}
      {st.failed ? <T c={t.bad} s={12} w={600}>{st.failed} failed</T> : null}
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
          {L.showPreview ? <Preview store={store} t={t} L={L} /> : null}
          <Settings store={store} t={t} w={L.settingsW} h={L.listH} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: pad, padding: pad, height: bodyH }}>
          <FileList store={store} t={t} L={L} />
          <div style={{ display: 'flex', gap: pad, height: bodyH - L.listH - pad * 3 }}>
            {L.showPreview ? <Preview store={store} t={t} L={L} /> : null}
            <Settings store={store} t={t} w={L.settingsW} h={bodyH - L.listH - pad * 3} />
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
