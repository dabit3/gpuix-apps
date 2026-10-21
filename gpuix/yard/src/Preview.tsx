import { useEffect, useMemo, useState } from 'react'
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
      <text style={{ color: T.dim, fontSize: 11, fontWeight: 600 }}>{label.toUpperCase()}</text>
      <text style={{ color: T.fg, fontSize: 13, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{value}</text>
    </div>
  )
}

export function Preview({ entry, width, height, showHidden, version }: { entry: Entry | undefined; width: number; height: number; showHidden: boolean; version: number }) {
  if (!entry)
    return (
      <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <text style={{ color: T.dim, fontSize: 13 }}>Nothing selected</text>
      </div>
    )
  return (
    <div testId="preview" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, height: '100%', overflowY: 'scroll', padding: 20, gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', width: 40, height: 40, borderRadius: 10, backgroundColor: T.raised, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon entry={entry} size={20} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
          <text testId="preview-title" style={{ color: T.fg, fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{entry.name}</text>
          <text style={{ color: T.muted, fontSize: 12 }}>
            {entry.isDir ? `Folder · ${entry.children ?? 0} item${entry.children === 1 ? '' : 's'}` : `${KIND_LABEL[entry.kind]} · ${formatSize(entry.size)}`}
          </text>
        </div>
      </div>
      <Body key={`${entry.path}:${version}`} entry={entry} width={width - 40} height={height} showHidden={showHidden} version={version} />
      <div style={{ display: 'flex', gap: 28, paddingTop: 14, borderTopWidth: 1, borderColor: T.line, flexWrap: 'wrap', rowGap: 12 }}>
        <Meta label="Modified" value={formatDate(entry.mtime)} />
        <Meta label="Permissions" value={formatMode(entry.mode, entry.isDir)} />
        {!entry.isDir && <Meta label="Size" value={entry.size.toLocaleString('en-US') + ' bytes'} />}
      </div>
    </div>
  )
}

function Body({ entry, width, height, showHidden, version }: { entry: Entry; width: number; height: number; showHidden: boolean; version: number }) {
  if (entry.isDir) return <DirPreview entry={entry} showHidden={showHidden} version={version} />
  if (entry.kind === 'image' && extOf(entry.name) !== 'svg') return <ImagePreview entry={entry} width={width} height={height} />
  const head = readHead(entry.path)
  if (!head || isBinary(head)) return <Empty text={entry.size ? 'No preview for this file type' : 'Empty file'} />
  const lines = head.split('\n')
  const clipped = lines.slice(0, 400).join('\n')
  if (entry.kind === 'markdown') return <markdown testId="preview-markdown" source={clipped} theme={codeTheme} style={{ minWidth: 0 }} />
  if (entry.kind === 'json') return <JsonPreview text={head} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, borderRadius: 10, borderWidth: 1, borderColor: T.line, backgroundColor: T.panel }}>
      <code testId="preview-code" code={clipped} language={LANG[extOf(entry.name)]} showLineNumbers theme={codeTheme} style={{ padding: 12, minWidth: 0 }} />
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', padding: 24, borderRadius: 10, backgroundColor: T.panel, justifyContent: 'center' }}>
      <text style={{ color: T.dim, fontSize: 13 }}>{text}</text>
    </div>
  )
}

function ImagePreview({ entry, width, height }: { entry: Entry; width: number; height: number }) {
  const dims = useMemo(() => imageSize(entry.path), [entry.path])
  const maxW = Math.max(120, width)
  const maxH = Math.max(120, height - 230)
  const ratio = dims ? dims.width / dims.height : 1.5
  const w = Math.round(Math.min(maxW, maxH * ratio))
  const h = Math.round(w / ratio)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <img testId="preview-image" src={entry.path} objectFit="cover" style={{ width: w, height: h, borderRadius: 10 }} />
      {dims && <text testId="image-dims" style={{ color: T.muted, fontSize: 12 }}>{`${dims.width} × ${dims.height} px · ${extOf(entry.name).toUpperCase()}`}</text>}
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
      <text testId="json-summary" style={{ color: T.orange, fontSize: 12, fontWeight: 600 }}>{summary}</text>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, borderRadius: 10, borderWidth: 1, borderColor: T.line, backgroundColor: T.panel }}>
        <code testId="preview-code" code={pretty.split('\n').slice(0, 400).join('\n')} language="json" showLineNumbers theme={codeTheme} style={{ padding: 12, minWidth: 0 }} />
      </div>
    </div>
  )
}

function DirPreview({ entry, showHidden, version }: { entry: Entry; showHidden: boolean; version: number }) {
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        {[
          ['Total size', total ? formatSize(total.bytes) + (total.truncated ? '+' : '') : '…'],
          ['Files', total ? total.files.toLocaleString('en-US') : '…'],
          ['Folders', total ? total.dirs.toLocaleString('en-US') : '…'],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 10, backgroundColor: T.panel, borderWidth: 1, borderColor: T.line, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
            <text style={{ color: T.dim, fontSize: 11, fontWeight: 600 }}>{label!.toUpperCase()}</text>
            <text testId={label === 'Total size' ? 'dir-total' : undefined} style={{ color: T.fg, fontSize: 18, fontWeight: 600 }}>{value}</text>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sized.slice(0, 14).map(({ c, bytes }) => (
          <div key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 28, minWidth: 0 }}>
            <Icon entry={c} size={14} />
            <text style={{ color: T.fg, fontSize: 13, width: 170, flexShrink: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.name}</text>
            <div style={{ display: 'flex', flexGrow: 1, height: 6, borderRadius: 3, backgroundColor: T.raised, minWidth: 40 }}>
              <div style={{ width: `${Math.max(2, (bytes / max) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: c.isDir ? T.blue : KIND_COLOR[c.kind] }} />
            </div>
            <text style={{ color: T.muted, fontSize: 12, width: 64, flexShrink: 0 }}>{sizes[c.path] !== undefined || !c.isDir ? formatSize(bytes) : '…'}</text>
          </div>
        ))}
        {sized.length > 14 && <text style={{ color: T.dim, fontSize: 12, paddingTop: 4 }}>{`+ ${sized.length - 14} more`}</text>}
      </div>
    </div>
  )
}
