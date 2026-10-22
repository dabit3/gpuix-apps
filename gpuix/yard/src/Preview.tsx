import { useEffect, useMemo, useState } from 'react'
import { motion } from '@gpuix/react'
import type { GpuixTheme, SyntaxTheme } from '@gpuix/native/host'
import {
  dirSize,
  extOf,
  formatDate,
  formatMode,
  formatSize,
  imageSize,
  isBinary,
  LANG,
  listDir,
  readHead,
  type DirSize,
  type Entry,
} from './fs'
import { ICON, KIND_COLOR } from './icons'
import { cachedThumbnail, palette, readExif, thumbnail, type Exif } from './media'
import { T } from './theme'

export const codeTheme: GpuixTheme = {
  appearance: 'dark',
  bg: T.bg,
  text: T.fg,
  textMuted: T.muted,
  textFaint: T.dim,
  accent: T.blue,
  caret: T.blue,
  border: T.line,
  codeText: T.fg,
  syntax: {
    comment: T.dim,
    keyword: '#ff9492',
    string: '#addcff',
    stringSpecial: '#addcff',
    number: '#91cbff',
    boolean: '#91cbff',
    constant: '#91cbff',
    property: '#91cbff',
    typeName: '#ffb757',
    typeBuiltin: '#ffb757',
    function: '#71b7ff',
    functionBuiltin: '#71b7ff',
    macroName: '#71b7ff',
    variable: T.fg,
    parameter: T.fg,
    operator: '#ff9492',
    punctuation: T.muted,
    tag: '#72f088',
    attribute: '#91cbff',
    constructor: '#ffb757',
  } as SyntaxTheme,
  metrics: { codeTextSize: 13, codeLineHeight: 20, mdTextSize: 14, mdLineHeight: 22, mdHeadingSizes: [24, 19, 16, 14] },
}

const KIND_LABEL: Record<Entry['kind'], string> = {
  dir: 'Folder',
  image: 'Image',
  code: 'Source code',
  markdown: 'Markdown',
  json: 'JSON',
  text: 'Plain text',
  archive: 'Archive',
  other: 'Document',
}

export function Icon({ entry, size = 16, color }: { entry: Pick<Entry, 'kind'>; size?: number; color?: string }) {
  return <svg source={ICON[entry.kind]} style={{ width: size, height: size, flexShrink: 0, color: color ?? KIND_COLOR[entry.kind] }} />
}

/** Finder-style: real photo thumbnails once sips has rendered them, the glyph until then. */
export function useThumb(path: string | undefined, enabled = true, size = 320) {
  const [src, setSrc] = useState(() => (path && enabled ? cachedThumbnail(path, size) : null))
  useEffect(() => {
    if (!path || !enabled) return setSrc(null)
    let alive = true
    const hit = cachedThumbnail(path, size)
    setSrc(hit)
    if (!hit) thumbnail(path, size).then((t) => alive && setSrc(t))
    return () => {
      alive = false
    }
  }, [path, enabled, size])
  return src
}

export function EntryIcon({ entry, size = 16, color }: { entry: Entry; size?: number; color?: string }) {
  const isPhoto = entry.kind === 'image' && extOf(entry.name) !== 'svg'
  const src = useThumb(isPhoto ? entry.path : undefined, isPhoto, 64)
  if (src) return <img src={src} objectFit="cover" style={{ width: size + 3, height: size + 3, borderRadius: 4, flexShrink: 0, marginLeft: -1.5, marginRight: -1.5 }} />
  return <Icon entry={entry} size={size} color={color} />
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 26, minWidth: 0 }}>
      <text style={{ color: T.faint, fontSize: 12, width: 96, flexShrink: 0 }}>{label}</text>
      <text style={{ color: T.muted, fontSize: 12, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{value}</text>
    </div>
  )
}

export interface PreviewProps {
  entry: Entry | undefined
  width: number
  height: number
  showHidden: boolean
  version: number
  siblings?: Entry[]
  onPick?: (name: string) => void
}

export function Preview({ entry, width, height, showHidden, version, siblings = [], onPick }: PreviewProps) {
  if (!entry)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <svg source={ICON.dir} style={{ width: 28, height: 28, color: T.line }} />
        <text style={{ color: T.faint, fontSize: 13 }}>This folder is empty</text>
      </div>
    )
  const photo = entry.kind === 'image' && extOf(entry.name) !== 'svg'
  return (
    <div testId="preview" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, height: '100%', overflowY: 'scroll', paddingTop: 10, paddingLeft: 20, paddingRight: 24, paddingBottom: 20, gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flexGrow: 1 }}>
          <text testId="preview-title" style={{ color: T.fg, fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{entry.name}</text>
          <text style={{ color: T.dim, fontSize: 12 }}>
            {entry.isDir ? `Folder · ${entry.children ?? 0} item${entry.children === 1 ? '' : 's'}` : `${KIND_LABEL[entry.kind]} · ${formatSize(entry.size)}`}
          </text>
        </div>
      </div>
      <motion.div key={`${entry.path}:${version}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16, ease: 'easeOut' }} style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        {photo ? (
          <PhotoPreview entry={entry} width={width - 48} height={height} siblings={siblings} onPick={onPick} />
        ) : (
          <Body entry={entry} width={width - 48} height={height} showHidden={showHidden} version={version} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 2 }}>
          <Meta label="Modified" value={formatDate(entry.mtime)} />
          {!entry.isDir && <Meta label="Size" value={entry.size.toLocaleString('en-US') + ' bytes'} />}
          <Meta label="Permissions" value={formatMode(entry.mode, entry.isDir)} />
        </div>
      </motion.div>
    </div>
  )
}

function Body({ entry, width, height, showHidden, version }: { entry: Entry; width: number; height: number; showHidden: boolean; version: number }) {
  if (entry.isDir) return <DirPreview entry={entry} width={width} showHidden={showHidden} version={version} />
  const head = readHead(entry.path)
  if (!head || isBinary(head)) return <Empty text={entry.size ? 'No preview for this file type' : 'Empty file'} />
  const lines = head.split('\n')
  const clipped = lines.slice(0, 400).join('\n')
  if (entry.kind === 'markdown') return <markdown testId="preview-markdown" source={clipped} theme={codeTheme} style={{ minWidth: 0 }} />
  if (entry.kind === 'json') return <JsonPreview text={head} />
  return (
    <code testId="preview-code" code={clipped} language={LANG[extOf(entry.name)]} showLineNumbers theme={codeTheme} style={{ minWidth: 0 }} />
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', paddingTop: 24, paddingBottom: 24, justifyContent: 'center' }}>
      <text style={{ color: T.dim, fontSize: 13 }}>{text}</text>
    </div>
  )
}

export const exposureLine = (x: Exif | null) => (x ? [x.aperture, x.shutter, x.iso, x.focal].filter(Boolean).join('   ') : '')

function PhotoPreview({ entry, width, height, siblings, onPick }: { entry: Entry; width: number; height: number; siblings: Entry[]; onPick?: (name: string) => void }) {
  const dims = useMemo(() => imageSize(entry.path), [entry.path])
  const exif = useMemo(() => readExif(entry.path), [entry.path])
  const [colors, setColors] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    palette(entry.path).then((c) => alive && setColors(c))
    return () => {
      alive = false
    }
  }, [entry.path])
  const strip = siblings.filter((s) => s.kind === 'image' && extOf(s.name) !== 'svg')
  const maxW = Math.max(120, width)
  const maxH = Math.max(120, height - (strip.length > 1 ? 400 : 330))
  const ratio = dims ? dims.width / dims.height : 1.5
  const w = Math.round(Math.min(maxW, maxH * ratio))
  const h = Math.round(w / ratio)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <img testId="preview-image" src={entry.path} objectFit="cover" style={{ width: w, height: h, borderRadius: 10 }} />
      {strip.length > 1 && (
        <div testId="filmstrip" style={{ display: 'flex', gap: 6, minWidth: 0 }}>
          {strip.slice(0, Math.max(1, Math.floor((w + 6) / 62))).map((s) => (
            <Thumb key={s.path} entry={s} selected={s.path === entry.path} onClick={() => onPick?.(s.name)} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'start', gap: 16, minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          {exif?.camera ? (
            <>
              <text testId="exif-camera" style={{ color: T.fg, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{exif.camera}</text>
              {exif.lens && <text style={{ color: T.dim, fontSize: 12, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{exif.lens}</text>}
              <text testId="exif-exposure" style={{ color: T.muted, fontSize: 12, paddingTop: 2 }}>{exposureLine(exif)}</text>
            </>
          ) : (
            <text style={{ color: T.dim, fontSize: 12 }}>No camera data</text>
          )}
        </div>
        {colors.length > 0 && (
          <div testId="palette" style={{ display: 'flex', gap: 5, paddingTop: 2, flexShrink: 0 }}>
            {colors.map((c) => (
              <div key={c} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c }} />
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {exif?.taken && <Meta label="Taken" value={exif.taken} />}
        {dims && (
          <div testId="image-dims" style={{ display: 'flex' }}>
            <Meta label="Dimensions" value={`${dims.width} × ${dims.height}  ·  ${extOf(entry.name).toUpperCase()}`} />
          </div>
        )}
      </div>
    </div>
  )
}

function GalleryTile({ entry, w, h }: { entry: Entry; w: number; h: number }) {
  const src = useThumb(entry.path, true, 320)
  return src ? (
    <img src={src} objectFit="cover" style={{ width: w, height: h, borderRadius: 8, flexShrink: 0 }} />
  ) : (
    <div style={{ width: w, height: h, borderRadius: 8, backgroundColor: T.raised, flexShrink: 0 }} />
  )
}

function Thumb({ entry, selected, onClick }: { entry: Entry; selected: boolean; onClick: () => void }) {
  const src = useThumb(entry.path, true, 160)
  return (
    <div
      testId={`thumb-${entry.name}`}
      onClick={onClick}
      style={{ display: 'flex', width: 56, height: 40, borderRadius: 7, padding: 2, borderWidth: 1.5, borderColor: selected ? T.blue : T.bg, cursor: 'pointer', flexShrink: 0, opacity: selected ? 1 : 0.55, hover: { opacity: 1 } }}
    >
      {src ? <img src={src} objectFit="cover" style={{ width: 49, height: 33, borderRadius: 5 }} /> : <div style={{ width: 49, height: 33, borderRadius: 5, backgroundColor: T.raised }} />}
    </div>
  )
}

function JsonPreview({ text }: { text: string }) {
  let pretty = text
  let summary = 'Invalid JSON'
  try {
    const v = JSON.parse(text)
    pretty = JSON.stringify(v, null, 2)
    summary = Array.isArray(v) ? `Array · ${v.length} items` : v && typeof v === 'object' ? `Object · ${Object.keys(v).length} keys` : typeof v
  } catch {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <text testId="json-summary" style={{ color: T.dim, fontSize: 12 }}>{summary}</text>
      <code testId="preview-code" code={pretty.split('\n').slice(0, 400).join('\n')} language="json" showLineNumbers theme={codeTheme} style={{ minWidth: 0 }} />
    </div>
  )
}

function DirPreview({ entry, width, showHidden, version }: { entry: Entry; width: number; showHidden: boolean; version: number }) {
  const children = useMemo(() => listDir(entry.path, showHidden), [entry.path, showHidden, version])
  const [total, setTotal] = useState<DirSize | null>(null)
  const [sizes, setSizes] = useState<Record<string, number>>({})
  useEffect(() => {
    let alive = true
    dirSize(entry.path).then((s) => alive && setTotal(s))
    Promise.all(children.slice(0, 40).map(async (c) => [c.path, c.isDir ? (await dirSize(c.path, 5000)).bytes : c.size] as const)).then(
      (pairs) => alive && setSizes(Object.fromEntries(pairs)),
    )
    return () => {
      alive = false
    }
  }, [entry.path, children])
  const sized = children.map((c) => ({ c, bytes: sizes[c.path] ?? (c.isDir ? 0 : c.size) })).sort((a, b) => b.bytes - a.bytes)
  const max = Math.max(1, ...sized.map((s) => s.bytes))
  if (!children.length) return <Empty text="Empty folder" />
  const photos = children.filter((c) => c.kind === 'image' && extOf(c.name) !== 'svg')
  const cols = width >= 520 ? 3 : 2
  const tw = Math.floor((width - (cols - 1) * 8) / cols)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {photos.length >= Math.max(2, children.length * 0.6) && (
        <div testId="gallery" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBottom: 8 }}>
          {photos.slice(0, cols * 3).map((c) => (
            <GalleryTile key={c.path} entry={c} w={tw} h={Math.round(tw * 0.66)} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <text style={{ color: T.faint, fontSize: 11 }}>Total size</text>
        <text testId="dir-total" style={{ color: T.fg, fontSize: 26, fontWeight: 600 }}>{total ? formatSize(total.bytes) + (total.truncated ? '+' : '') : '…'}</text>
        <text style={{ color: T.dim, fontSize: 12 }}>{total ? `${total.files.toLocaleString('en-US')} files · ${total.dirs.toLocaleString('en-US')} folders` : ' '}</text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingTop: 4 }}>
        {sized.slice(0, 14).map(({ c, bytes }) => (
          <div key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 28, minWidth: 0 }}>
            <Icon entry={c} size={13} />
            <text style={{ color: T.muted, fontSize: 13, width: 160, flexShrink: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.name}</text>
            <div style={{ display: 'flex', flexGrow: 1, height: 3, borderRadius: 2, backgroundColor: T.line, minWidth: 40 }}>
              <div style={{ width: `${Math.max(2, (bytes / max) * 100)}%`, height: 3, borderRadius: 2, backgroundColor: c.isDir ? T.blue : T.dim }} />
            </div>
            <text style={{ color: T.faint, fontSize: 12, width: 64, flexShrink: 0 }}>{sizes[c.path] !== undefined || !c.isDir ? formatSize(bytes) : '…'}</text>
          </div>
        ))}
        {sized.length > 14 && <text style={{ color: T.dim, fontSize: 12, paddingTop: 4 }}>{`+ ${sized.length - 14} more`}</text>}
      </div>
    </div>
  )
}
