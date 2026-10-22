// Format detection by magic bytes. The extension is only a hint for plain-text formats.
export type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'doc'

export interface Sniffed {
  kind: Kind
  /** Canonical source format id, e.g. 'jpeg', 'heic', 'mov', 'wav', 'docx', 'md'. */
  format: string
  /** Display label, e.g. 'JPEG'. */
  label: string
}

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = ''
  for (let i = start; i < Math.min(b.length, start + len); i++) s += String.fromCharCode(b[i]!)
  return s
}
const starts = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((v, i) => b[at + i] === v)

const LABELS: Record<string, string> = {
  png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', heic: 'HEIC', avif: 'AVIF', tiff: 'TIFF', bmp: 'BMP', ico: 'ICO',
  mp4: 'MP4', mov: 'QuickTime', webm: 'WebM', mkv: 'Matroska', avi: 'AVI',
  mp3: 'MP3', m4a: 'AAC / M4A', wav: 'WAV', flac: 'FLAC', ogg: 'Ogg Vorbis', opus: 'Opus', aiff: 'AIFF',
  pdf: 'PDF', docx: 'Word', odt: 'OpenDocument', rtf: 'RTF', html: 'HTML', md: 'Markdown', txt: 'Plain text', epub: 'EPUB',
}

const KIND: Record<string, Kind> = {
  png: 'image', jpeg: 'image', gif: 'image', webp: 'image', heic: 'image', avif: 'image', tiff: 'image', bmp: 'image', ico: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  mp3: 'audio', m4a: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', opus: 'audio', aiff: 'audio',
  pdf: 'pdf', docx: 'doc', odt: 'doc', rtf: 'doc', html: 'doc', md: 'doc', txt: 'doc', epub: 'doc',
}

export const make = (format: string): Sniffed => ({ format, kind: KIND[format]!, label: LABELS[format] ?? format.toUpperCase() })

/** Identify a file from its first bytes (64 KB is plenty). Returns null for unsupported content. */
export function sniff(b: Uint8Array, name = ''): Sniffed | null {
  if (b.length < 4) return textual(b, name)
  if (starts(b, [0x89, 0x50, 0x4e, 0x47])) return make('png')
  if (starts(b, [0xff, 0xd8, 0xff])) return make('jpeg')
  if (ascii(b, 0, 4) === 'GIF8') return make('gif')
  if (ascii(b, 0, 4) === 'RIFF') {
    const t = ascii(b, 8, 4)
    if (t === 'WEBP') return make('webp')
    if (t === 'WAVE') return make('wav')
    if (t === 'AVI ') return make('avi')
  }
  if (ascii(b, 0, 4) === 'FORM' && ascii(b, 8, 3) === 'AIF') return make('aiff')
  if (ascii(b, 0, 2) === 'BM' && b.length > 14) return make('bmp')
  if (starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a])) return make('tiff')
  if (starts(b, [0x00, 0x00, 0x01, 0x00]) && b[4]! > 0) return make('ico')
  if (ascii(b, 0, 5) === '%PDF-') return make('pdf')
  if (ascii(b, 4, 4) === 'ftyp') {
    const brands = [ascii(b, 8, 4), ...Array.from({ length: 8 }, (_, i) => ascii(b, 16 + i * 4, 4))]
    const major = brands[0]!
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(major)) return make(brands.includes('avif') ? 'avif' : 'heic')
    if (major === 'avif' || major === 'avis') return make('avif')
    if (major === 'qt  ') return make('mov')
    if (major === 'M4A ' || major === 'M4B ') return make('m4a')
    return make('mp4')
  }
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return make(ascii(b, 0, 64).includes('webm') ? 'webm' : 'mkv')
  if (ascii(b, 0, 4) === 'fLaC') return make('flac')
  if (ascii(b, 0, 4) === 'OggS') return make(ascii(b, 0, 64).includes('OpusHead') ? 'opus' : 'ogg')
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0)) return make('mp3')
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) {
    const head = ascii(b, 0, b.length)
    if (head.includes('mimetypeapplication/epub+zip')) return make('epub')
    if (head.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return make('odt')
    if (head.includes('word/')) return make('docx')
    return null
  }
  if (ascii(b, 0, 5) === '{\\rtf') return make('rtf')
  return textual(b, name)
}

function textual(b: Uint8Array, name: string): Sniffed | null {
  if (b.length === 0) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.min(b.length, 8192)))
  } catch {
    // A multi-byte character can be cut at the 8 KB boundary; retry a few bytes shorter.
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.min(b.length, 8188))) } catch { return null }
  }
  if (/[\x00-\x08\x0e-\x1f]/.test(text)) return null
  const head = text.trimStart().slice(0, 256).toLowerCase()
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return make('html')
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'md' || ext === 'markdown' || /^#{1,6} \S/m.test(text)) return make('md')
  return make('txt')
}

/** The format the extension claims, for mismatch warnings ("sniffed JPEG, named .png"). */
export function extFormat(name: string): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (!ext) return null
  const map: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', tif: 'tiff', tiff: 'tiff', heif: 'heic', m4v: 'mp4', aac: 'm4a', htm: 'html', markdown: 'md', aif: 'aiff' }
  return map[ext] ?? (LABELS[ext] ? ext : null)
}
