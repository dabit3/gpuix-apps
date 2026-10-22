import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
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

const Spacer = () => <div style={{ flexGrow: 1 }} />

/** Format name + one-word descriptor for the format grid, e.g. MP4 / H.264. */
const FORMAT_PARTS: Record<string, Record<string, [string, string]>> = {
  image: { webp: ['WebP', 'Smallest'], jpg: ['JPEG', 'Universal'], avif: ['AVIF', 'Modern'], heic: ['HEIC', 'Apple'], png: ['PNG', 'Lossless'], tiff: ['TIFF', 'Print'], gif: ['GIF', 'Web'], ico: ['ICO', '256 px'], pdf: ['PDF', 'Document'] },
  video: { mp4: ['MP4', 'H.264'], hevc: ['MP4', 'HEVC'], webm: ['WebM', 'VP9'], av1: ['WebM', 'AV1'], mov: ['MOV', 'QuickTime'], gif: ['GIF', 'Animated'], m4a: ['M4A', 'Audio only'], mp3: ['MP3', 'Audio only'] },
  audio: { mp3: ['MP3', 'Universal'], m4a: ['AAC', 'M4A'], opus: ['Opus', 'Smallest'], ogg: ['OGG', 'Vorbis'], flac: ['FLAC', 'Lossless'], wav: ['WAV', 'Uncompressed'] },
  pdf: { png: ['PNG', 'Page 1'], jpg: ['JPEG', 'Page 1'], tiff: ['TIFF', 'Page 1'] },
  doc: { pdf: ['PDF', 'Typeset'], docx: ['Word', '.docx'], html: ['HTML', 'Web page'], md: ['Markdown', '.md'], rtf: ['RTF', 'Rich text'], txt: ['Text', 'Plain'] },
}
function formatParts(kind: string, x: { id: string; label: string; note?: string }): [string, string] {
  const known = FORMAT_PARTS[kind]?.[x.id]
  if (known) return known
  const [a, ...b] = x.label.split(' ')
  return [a ?? x.label, b.join(' ') || x.note || '']
}

function Header({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const st = store.stats()
  const total = store.files.reduce((n, f) => n + f.size, 0)
  const left = st.running + st.queued
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: L.header, paddingLeft: 24, paddingRight: 24, gap: 12, flexShrink: 0 }}>
      <T c={t.fg} s={14} w={600}>convt</T>
      {L.kind !== 'thin' && store.files.length ? (
        <T c={t.faint} s={13}>{`${store.files.length} ${store.files.length === 1 ? 'file' : 'files'}  ·  ${formatBytes(total)}`}</T>
      ) : null}
      <Spacer />
      {left ? <T c={t.dim} s={12.5}>{`Converting  ·  ${left} left`}</T> : null}
      <div testId="local-badge" style={{ display: 'flex', alignItems: 'center' }}>
        <T c={t.faint} s={12.5}>{L.kind === 'thin' ? 'On this Mac' : 'Processed on this Mac  ·  No network'}</T>
      </div>
    </div>
  )
}

function Card({ t, w, h, children, testId, padding = 16, gap = 0 }: { t: Theme; w: number; h: number; children: ReactNode; testId?: string; padding?: number; gap?: number }) {
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', width: w, height: h, padding, gap, borderRadius: 12, backgroundColor: t.panel, overflow: 'hidden', flexShrink: 0 }}>
      {children}
    </div>
  )
}

function ext(f: FileItem): string {
  const e = f.name.includes('.') ? f.name.split('.').pop()! : f.src.format
  return e.slice(0, 4).toUpperCase()
}

function Thumb({ f, t, size }: { f: FileItem; t: Theme; size: number }) {
  if (f.thumb && (f.src.kind === 'image' || f.src.kind === 'video' || f.src.kind === 'pdf')) {
    return <img src={f.thumb} objectFit="cover" style={{ width: size, height: size, borderRadius: 6, flexShrink: 0 }} />
  }
  return (
    <div style={{ width: size, height: size, borderRadius: 6, backgroundColor: alpha(t.fg, 0.07), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <T c={t.dim} s={9} w={600}>{ext(f)}</T>
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

/** Round selection mark, like Photos: a quiet ring, or a filled disc with a check. */
function Mark({ t, on, onClick, testId }: { t: Theme; on: boolean; onClick: () => void; testId: string }) {
  return (
    <div testId={testId} onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 36, flexShrink: 0, cursor: 'pointer' }}>
      <div style={{ pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 8, borderWidth: on ? 0 : 1.5, borderColor: alpha(t.fg, 0.3), backgroundColor: on ? t.fg : 'transparent' }}>
        {on ? <T c={t.panel} s={9.5} w={800}>✓</T> : null}
      </div>
    </div>
  )
}

function FileRow({ store, f, i, t, compact }: { store: Store; f: FileItem; i: number; t: Theme; compact: boolean }) {
  const focused = i === store.focus
  const tgt = store.targetOf(f)
  const h = compact ? 44 : 54
  const running = f.state === 'running'
  const right = () => {
    if (f.state === 'done') return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <T c={t.good} s={11} w={700}>✓</T>
        <T c={t.dim} s={12}>{formatBytes(f.outputSize ?? 0)}</T>
      </div>
    )
    if (f.state === 'failed') return <T c={t.bad} s={12}>Failed</T>
    if (f.state === 'canceled') return <T c={t.faint} s={12}>Canceled</T>
    if (f.state === 'queued') return <T c={t.faint} s={12}>Waiting</T>
    if (running) return <T c={t.dim} s={12}>{`${Math.round(f.progress * 100)}%`}</T>
    return tgt ? <T c={t.faint} s={12}>{formatParts(f.src.kind, tgt)[0]}</T> : null
  }
  return (
    <div
      testId={`file-${i}`}
      onClick={(e: { clickCount?: number }) => { store.setFocus(i); if ((e.clickCount ?? 1) >= 2) store.convert([f]) }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 10, height: h, paddingLeft: 4, paddingRight: 12, borderRadius: 8, flexShrink: 0,
        backgroundColor: focused ? alpha(t.fg, 0.08) : 'transparent',
        cursor: 'pointer', hover: { backgroundColor: focused ? alpha(t.fg, 0.09) : alpha(t.fg, 0.035) },
      }}
    >
      <Mark t={t} on={f.checked} onClick={() => store.toggleCheck(i)} testId={`check-${i}`} />
      <Thumb f={f} t={t} size={compact ? 28 : 36} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
        <T c={t.fg} s={13} w={500} style={{ flexShrink: 1, lineClamp: 1 }}>{f.name}</T>
        {!compact ? <T c={t.faint} s={12} style={{ flexShrink: 1, lineClamp: 1 }}>{`${f.src.label}  ·  ${formatBytes(f.size)}`}</T> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{right()}</div>
      {running ? (
        <div style={{ position: 'absolute', left: 72, right: 12, bottom: 6, height: 2, borderRadius: 1, backgroundColor: alpha(t.fg, 0.1), pointerEvents: 'none' }}>
          <div style={{ width: `${Math.round(f.progress * 100)}%`, height: 2, borderRadius: 1, backgroundColor: t.fg }} />
        </div>
      ) : null}
    </div>
  )
}

function FileList({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const compact = L.kind !== 'wide'
  const any = store.files.some((f) => f.checked)
  return (
    <Card t={t} w={L.listW} h={L.listH} padding={8}>
      <div style={{ display: 'flex', alignItems: 'center', height: 32, paddingLeft: 10, paddingRight: 10, gap: 8, flexShrink: 0 }}>
        <T c={t.dim} s={12} w={600}>Files</T>
        <Spacer />
        <div testId="check-all" onClick={() => store.checkAll()} style={{ cursor: 'pointer', hover: { opacity: 0.7 } }}>
          <T c={t.faint} s={12}>{any && store.files.every((f) => f.checked) ? 'Deselect All' : 'Select All'}</T>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'scroll', flexGrow: 1 }}>
        {store.files.map((f, i) => <FileRow key={f.id} store={store} f={f} i={i} t={t} compact={compact} />)}
        {store.rejected.slice(0, 3).map((r) => (
          <div key={r.path} style={{ display: 'flex', height: 28, alignItems: 'center', paddingLeft: 12, flexShrink: 0 }}>
            <T c={t.faint} s={12}>{`Skipped ${r.path.split('/').pop()}  ·  ${r.reason}`}</T>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Largest box with the given aspect that fits in w × h. */
function fit(aw: number | undefined, ah: number | undefined, w: number, h: number): [number, number] | null {
  if (!aw || !ah) return null
  const k = Math.min(w / aw, h / ah)
  return [Math.max(1, Math.floor(aw * k)), Math.max(1, Math.floor(ah * k))]
}

function docLines(text: string): { s: string; head: boolean; bullet: boolean }[] {
  return text.split('\n').map((l) => l.trimEnd()).filter((l, i, a) => l || (a[i - 1] ?? '') !== '')
    .map((l) => ({ s: l.replace(/^\s*[•*-]\s+/, '•  ').replace(/^#+\s*/, '').replace(/\*\*|__|`/g, '').replace(/\t+/g, '  ').trim(), head: /^#/.test(l), bullet: /^\s*[•*-]\s+/.test(l) }))
}

function Preview({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const f = store.focused
  const [view, setView] = useState<{ id: number; v: 'before' | 'after' }>({ id: -1, v: 'after' })
  const w = L.previewW
  if (!f) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: w, height: L.previewH, gap: 8 }}>
        <T c={t.dim} s={15} w={500}>No files yet</T>
        <T c={t.faint} s={13}>Run convt with files or a folder</T>
      </div>
    )
  }
  const s = store.settings[f.src.kind]
  const tgt = store.targetOf(f)
  const p = store.preview
  const done = f.state === 'done' && !!f.output
  const after = done && !!f.outputThumb && !(view.id === f.id && view.v === 'before')
  const showCompare = f.src.kind === 'image' && !done
  const gap = 16
  const headH = 44
  const top = 10
  const compareH = showCompare ? Math.round(Math.min((w / 2 - 6) * 0.56, L.previewH * 0.26)) : 0
  const compareBlock = showCompare ? 24 + compareH + 30 : 0
  const resultH = done ? 60 : 0
  const stageH = Math.max(80, L.previewH - top - headH - gap - (showCompare ? compareBlock + gap : 0) - (done ? resultH + gap : 0))
  const shown = after ? f.outputThumb! : f.thumb
  const aspect: [number | undefined, number | undefined] = f.src.kind === 'audio' ? [1100, 300] : [f.src.width, f.src.height]
  const box = fit(aspect[0], aspect[1], f.src.kind === 'audio' ? w * 0.86 : w, stageH)
  const extra = [f.meta.codec, f.meta.fps ? `${f.meta.fps} fps` : '', f.src.kind === 'video' && !f.src.hasAudio ? 'No audio' : '', f.meta.sampleRate ? `${f.meta.sampleRate / 1000} kHz` : '']
    .filter(Boolean).join('  ·  ')
  const pageW = Math.min(w, 620)
  return (
    <div testId="preview" style={{ display: 'flex', flexDirection: 'column', width: w, height: L.previewH, paddingTop: top, gap, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: headH, gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
          <T c={t.fg} s={16} w={600} style={{ flexShrink: 1, lineClamp: 1 }}>{f.name}</T>
          <T c={t.faint} s={12.5} style={{ flexShrink: 1, lineClamp: 1 }}>{`${subline(f)}${extra ? `  ·  ${extra}` : ''}`}</T>
        </div>
        {done && f.outputThumb ? (
          <div style={{ display: 'flex', width: 190, flexShrink: 0 }}>
            <Segmented<'before' | 'after'> t={t} idPrefix="view" value={after ? 'after' : 'before'} onPick={(v) => setView({ id: f.id, v })}
              items={[{ id: 'before', label: 'Original' }, { id: 'after', label: 'Converted' }]} />
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: w, height: stageH, flexShrink: 0, overflow: 'hidden' }}>
        {f.src.kind === 'doc' ? (
          <div style={{ display: 'flex', flexDirection: 'column', width: pageW, height: stageH, paddingTop: 28, paddingLeft: 32, paddingRight: 32, gap: 6, borderRadius: 10, backgroundColor: t.panel, overflow: 'hidden' }}>
            {docLines(f.text ?? '').slice(0, Math.max(1, Math.floor((stageH - 40) / 22))).map((l, i) => (
              <T key={i} c={l.head || i === 0 ? t.fg : t.dim} s={l.head || i === 0 ? 15 : 13} w={l.head || i === 0 ? 600 : 400} style={{ width: pageW - 64 - (l.bullet ? 12 : 0), paddingLeft: l.bullet ? 12 : 0, lineClamp: 1, flexShrink: 0 }}>{l.s || ' '}</T>
            ))}
          </div>
        ) : shown ? (
          <img testId="preview-image" src={shown} objectFit={box ? 'cover' : 'contain'} style={box ? { width: box[0], height: box[1], borderRadius: f.src.kind === 'audio' ? 0 : 8 } : { width: w, height: stageH }} />
        ) : (
          <T c={t.faint} s={13}>Loading preview…</T>
        )}
      </div>
      {showCompare ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', height: 16 }}>
            <T c={t.dim} s={12} w={600}>Detail at 100%</T>
            <Spacer />
            {store.previewBusy ? <T c={t.faint} s={12}>Updating…</T> : null}
          </div>
          <div style={{ display: 'flex', gap: 12, height: compareH }}>
            {[p?.original ?? f.crop?.path, p?.encoded].map((src, i) => (
              src
                ? <img key={i} testId={i ? 'preview-encoded' : 'preview-original'} src={src} objectFit="cover" style={{ width: w / 2 - 6, height: compareH, borderRadius: 8 }} />
                : <div key={i} style={{ width: w / 2 - 6, height: compareH, borderRadius: 8, backgroundColor: t.panel }} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: w / 2 - 6 }}>
              <T c={t.dim} s={12.5}>Original</T>
              <T c={t.faint} s={12.5}>{formatBytes(f.size)}</T>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexGrow: 1 }}>
              <T c={t.dim} s={12.5}>{`${tgt ? formatParts(f.src.kind, tgt)[0] : ''}${tgt?.lossy ? `  ·  ${s.quality}` : ''}`}</T>
              {p && tgt ? <T testId="estimate" c={t.fg} s={12.5} w={600}>{`≈ ${formatBytes(p.estimate)}`}</T> : null}
              <Spacer />
              {p && tgt ? <T c={t.faint} s={12.5}>{delta(f.size, p.estimate)}</T> : null}
            </div>
          </div>
        </div>
      ) : null}
      {done ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: resultH, paddingLeft: 16, paddingRight: 10, borderRadius: 12, backgroundColor: t.panel, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 10, backgroundColor: t.good, flexShrink: 0 }}>
            <T c={t.bg} s={11} w={800}>✓</T>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
            <T testId="output-name" c={t.fg} s={13} w={500} style={{ flexShrink: 1, lineClamp: 1 }}>{f.output!.split('/').pop()}</T>
            <T c={t.faint} s={12} style={{ flexShrink: 1, lineClamp: 1 }}>{`${formatBytes(f.size)} → ${formatBytes(f.outputSize ?? 0)}  ·  ${delta(f.size, f.outputSize ?? 0)}  ·  ${((f.ms ?? 0) / 1000).toFixed(1)} s`}</T>
          </div>
          <div testId="reveal" onClick={() => store.reveal(f)} style={{ display: 'flex', alignItems: 'center', height: 30, paddingLeft: 14, paddingRight: 14, borderRadius: 8, backgroundColor: alpha(t.fg, 0.08), cursor: 'pointer', flexShrink: 0, hover: { backgroundColor: alpha(t.fg, 0.13) } }}>
            <T c={t.fg} s={12.5} w={500}>Show in Finder</T>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Section({ t, title, right, children }: { t: Theme; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 16 }}>
        <T c={t.dim} s={12} w={600}>{title}</T>
        <Spacer />
        {right}
      </div>
      {children}
    </div>
  )
}

/** Segmented control: one recessed track, the selected segment is a raised fill. */
function Segmented<K extends string | number>({ t, items, value, onPick, idPrefix }: { t: Theme; items: { id: K; label: string; disabled?: boolean }[]; value: K | undefined; onPick: (k: K) => void; idPrefix: string }) {
  return (
    <div style={{ display: 'flex', flexGrow: 1, padding: 2, gap: 2, borderRadius: 8, backgroundColor: alpha(t.fg, 0.06), flexShrink: 0 }}>
      {items.map((x) => {
        const on = x.id === value
        return (
          <div
            key={String(x.id)}
            testId={`${idPrefix}-${x.id}`}
            onClick={x.disabled ? undefined : () => onPick(x.id)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', height: 26, flexGrow: 1, flexBasis: 0, borderRadius: 6,
              backgroundColor: on ? alpha(t.fg, 0.15) : 'transparent', cursor: x.disabled ? 'default' : 'pointer',
              hover: on || x.disabled ? {} : { backgroundColor: alpha(t.fg, 0.05) },
            }}
          >
            <T c={on ? t.fg : x.disabled ? alpha(t.fg, 0.25) : t.dim} s={12} w={on ? 600 : 500}>{x.label}</T>
          </div>
        )
      })}
    </div>
  )
}

function FormatTile({ t, on, disabled, onClick, name, detail, w, testId }: { t: Theme; on: boolean; disabled?: boolean; onClick?: () => void; name: string; detail: string; w: number; testId?: string }) {
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, width: w, height: w < 96 ? 40 : 46, paddingLeft: w < 96 ? 9 : 11, paddingRight: 8, borderRadius: 8, flexShrink: 0,
        backgroundColor: on ? alpha(t.fg, 0.1) : 'transparent',
        borderWidth: on ? 1.5 : 1, borderColor: on ? t.fg : alpha(t.fg, disabled ? 0.05 : 0.11),
        cursor: disabled ? 'default' : 'pointer',
        hover: disabled || on ? {} : { backgroundColor: alpha(t.fg, 0.04), borderColor: alpha(t.fg, 0.2) },
      }}
    >
      <T c={disabled ? alpha(t.fg, 0.25) : t.fg} s={w < 96 ? 12 : 13} w={600}>{name}</T>
      <T c={disabled ? alpha(t.fg, 0.18) : on ? t.dim : t.faint} s={w < 96 ? 10.5 : 11}>{detail}</T>
    </div>
  )
}

function Slider({ store, t, value, w }: { store: Store; t: Theme; value: number; w: number }) {
  const box = useRef({ x: 0, w })
  const dragging = useRef(false)
  const set = (x: number) => store.update({ quality: Math.max(1, Math.min(100, Math.round(((x - box.current.x) / box.current.w) * 100))) })
  const k = 18
  const x = Math.round((w - k) * (value / 100))
  return (
    <div
      testId="quality-slider"
      onLayout={(e: { x?: number; width?: number }) => { box.current = { x: e.x ?? 0, w: e.width ?? w } }}
      onMouseDown={(e: { x?: number }) => { dragging.current = true; set(e.x ?? 0) }}
      onMouseMove={(e: { x?: number; pressedButton?: number | null }) => { if (dragging.current && e.pressedButton != null) set(e.x ?? 0) }}
      onMouseUp={() => { dragging.current = false }}
      onScroll={(e: { deltaY?: number }) => store.nudgeQuality((e.deltaY ?? 0) > 0 ? 2 : -2)}
      style={{ position: 'relative', width: w, height: 22, cursor: 'pointer', flexShrink: 0 }}
    >
      <div style={{ position: 'absolute', left: 0, top: 9, width: w, height: 4, borderRadius: 2, backgroundColor: alpha(t.fg, 0.12), pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, top: 9, width: x + k / 2, height: 4, borderRadius: 2, backgroundColor: alpha(t.fg, 0.85), pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: x - 3, top: -1, width: k + 6, height: k + 6, borderRadius: (k + 6) / 2, backgroundColor: t.panel, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: x, top: 2, width: k, height: k, borderRadius: k / 2, backgroundColor: '#ffffff', pointerEvents: 'none' }} />
    </div>
  )
}

function Switch({ t, on }: { t: Theme; on: boolean }) {
  return (
    <div style={{ position: 'relative', width: 32, height: 20, borderRadius: 10, backgroundColor: on ? t.accent : alpha(t.fg, 0.16), flexShrink: 0 }}>
      <div style={{ position: 'absolute', left: on ? 14 : 2, top: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#ffffff', pointerEvents: 'none' }} />
    </div>
  )
}

/** Inset grouped list row (System Settings style). */
function Row({ t, first, label, onClick, testId, children }: { t: Theme; first: boolean; label: string; onClick?: () => void; testId?: string; children: ReactNode }) {
  return (
    <div testId={testId} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 38, paddingLeft: 12, paddingRight: 10, cursor: onClick ? 'pointer' : 'default', flexShrink: 0, ...(first ? {} : { borderTopWidth: 1, borderColor: alpha(t.fg, 0.07) }) }}>
      <T c={t.fg} s={13}>{label}</T>
      <Spacer />
      {children}
    </div>
  )
}

function dimLabel(d: number): string {
  if (d === 0) return 'Original'
  return d >= 3800 ? '4K' : String(d)
}

function Settings({ store, t, w, h }: { store: Store; t: Theme; w: number; h: number }) {
  const f = store.focused
  const s = store.current()
  const ts = store.targets()
  const sel = store.selection()
  const busy = store.files.some((x) => x.state === 'running' || x.state === 'queued')
  const inner = w - 32
  const tgt = f ? store.targetOf(f) : null
  const showDim = f && (f.src.kind === 'image' || f.src.kind === 'video' || f.src.kind === 'pdf') && tgt?.id !== 'ico'
  const reason = ts.find((x) => !x.available)?.reason
  const cols = Math.max(2, Math.min(4, Math.floor((inner + 8) / 84)))
  const tileW = Math.floor((inner - (cols - 1) * 8) / cols)
  const rows: ReactNode[] = []
  if (s && f && f.src.kind !== 'doc') {
    rows.push(<Row key="strip" testId="toggle-strip" t={t} first={!rows.length} label="Strip metadata" onClick={() => store.update({ strip: !s.strip })}><Switch t={t} on={s.strip} /></Row>)
    if (f.src.kind === 'video' && store.info.videotoolbox) rows.push(<Row key="hw" testId="toggle-hw" t={t} first={!rows.length} label="Hardware encoder" onClick={() => store.update({ hw: !s.hw })}><Switch t={t} on={s.hw} /></Row>)
  }
  if (f && tgt) {
    rows.push(
      <Row key="name" t={t} first={!rows.length} label="Save as">
        <T testId="output-preview" c={t.dim} s={12.5} style={{ flexShrink: 1, lineClamp: 1, maxWidth: inner - 110 }}>{`${f.name.replace(/\.[^.]+$/, '')}.converted.${tgt.ext}`}</T>
      </Row>,
    )
  }
  return (
    <Card t={t} w={w} h={h} testId="settings" gap={16}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, flexGrow: 1, overflowY: 'scroll' }}>
        <Section t={t} title="Format">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: inner }}>
            {ts.map((x) => {
              const [name, detail] = formatParts(f?.src.kind ?? '', x)
              return <FormatTile key={x.id} testId={`target-${x.id}`} t={t} w={tileW} on={s?.target === x.id && x.available} disabled={!x.available} onClick={() => store.setTarget(x.id)} name={name} detail={detail} />
            })}
          </div>
          {reason ? <T c={t.faint} s={12} style={{ width: inner, whiteSpace: 'normal' }}>{`Unavailable: ${reason}`}</T> : null}
        </Section>
        {f && (f.src.kind === 'video' || f.src.kind === 'image') && s ? (
          <Section t={t} title="Preset">
            <Segmented<PresetId> t={t} idPrefix="preset" value={s.preset ?? undefined} onPick={(id) => store.applyPreset(id)}
              items={(Object.keys(PRESETS) as PresetId[]).map((id) => ({ id, label: id === 'small' ? 'Small' : id === 'hq' ? 'High Quality' : 'For X' }))} />
          </Section>
        ) : null}
        {s && tgt?.lossy ? (
          <Section t={t} title="Quality" right={<T testId="quality-value" c={t.fg} s={12.5} w={600}>{s.quality}</T>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Slider store={store} t={t} value={s.quality} w={inner} />
              <div style={{ display: 'flex', width: inner }}>
                <T c={t.faint} s={11}>Smaller file</T>
                <Spacer />
                <T c={t.faint} s={11}>Better quality</T>
              </div>
            </div>
          </Section>
        ) : null}
        {s && showDim ? (
          <Section t={t} title="Max size">
            <Segmented t={t} idPrefix="dim" value={s.maxDim} onPick={(d) => store.update({ maxDim: d })} items={MAX_DIMS.map((d) => ({ id: d, label: dimLabel(d) }))} />
          </Section>
        ) : null}
        {rows.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 10, backgroundColor: alpha(t.fg, 0.045), overflow: 'hidden' }}>{rows}</div>
            {f && tgt ? <T c={t.faint} s={11.5} style={{ paddingLeft: 12 }}>Saved next to the original. Never overwrites.</T> : null}
          </div>
        ) : null}
      </div>
      <div
        testId="convert"
        onClick={() => (busy ? store.cancelAll() : store.convert())}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 38, borderRadius: 10, flexShrink: 0,
          backgroundColor: busy ? alpha(t.fg, 0.08) : t.fg, cursor: 'pointer',
          hover: { opacity: 0.9 }, active: { opacity: 0.78 },
        }}
      >
        <T c={busy ? t.fg : t.bg} s={13} w={600}>{busy ? 'Cancel' : sel.length > 1 ? `Convert ${sel.length} Files` : 'Convert'}</T>
      </div>
    </Card>
  )
}

function Key({ t, k }: { t: Theme; k: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 18, minWidth: 18, paddingLeft: 5, paddingRight: 5, borderRadius: 4, backgroundColor: alpha(t.fg, 0.07), flexShrink: 0 }}>
      <T c={t.dim} s={10.5} w={500}>{k}</T>
    </div>
  )
}

function Footer({ store, t, L }: { store: Store; t: Theme; L: Layout }) {
  const st = store.stats()
  const keys: [string, string][] = L.kind === 'wide'
    ? [['↑↓', 'Select'], ['←→', 'Format'], ['space', 'Mark'], ['return', 'Convert'], ['x', 'Cancel'], ['o', 'Show'], ['⌃C', 'Quit']]
    : [['←→', 'Format'], ['return', 'Convert'], ['⌃C', 'Quit']]
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: L.footer, paddingLeft: 24, paddingRight: 24, gap: 18, flexShrink: 0 }}>
      {keys.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Key t={t} k={k} />
          <T c={t.faint} s={12}>{v}</T>
        </div>
      ))}
      <Spacer />
      {st.failed ? <T c={t.bad} s={12}>{`${st.failed} failed`}</T> : null}
      {st.done ? <T testId="totals" c={t.dim} s={12}>{`${st.done} converted  ·  ${formatBytes(st.before)} → ${formatBytes(st.after)}  ·  ${delta(st.before, st.after)}`}</T> : null}
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
  const lowerH = bodyH - L.listH - pad * 3
  return (
    <div testId="app-root" tabIndex={-1} autoFocus onKeyDown={(e: KeyLike) => { rootSawKey = true; handleKey(store, e) }} style={{ display: 'flex', flexDirection: 'column', width: size.width, height: size.height, backgroundColor: t.bg }}>
      <Header store={store} t={t} L={L} />
      {L.kind === 'wide' ? (
        <div style={{ display: 'flex', gap: pad * 2, paddingLeft: pad, paddingRight: pad, paddingTop: 0, paddingBottom: pad, height: bodyH }}>
          <FileList store={store} t={t} L={L} />
          {L.showPreview ? <Preview store={store} t={t} L={L} /> : null}
          <Settings store={store} t={t} w={L.settingsW} h={L.listH} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: pad, paddingLeft: pad, paddingRight: pad, paddingBottom: pad, height: bodyH }}>
          <FileList store={store} t={t} L={L} />
          <div style={{ display: 'flex', gap: pad * 1.5, height: lowerH + pad }}>
            {L.showPreview ? <Preview store={store} t={t} L={{ ...L, previewW: L.previewW - pad / 2, previewH: lowerH + pad }} /> : null}
            <Settings store={store} t={t} w={L.settingsW} h={lowerH + pad} />
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
