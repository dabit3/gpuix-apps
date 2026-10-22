// Pane layout. A full Ghostty window gets three columns; a vertical split stacks the file list above preview + settings.
export type LayoutKind = 'wide' | 'split' | 'thin'

export interface Layout {
  kind: LayoutKind
  w: number
  h: number
  header: number
  footer: number
  listW: number
  listH: number
  settingsW: number
  previewW: number
  previewH: number
  showPreview: boolean
}

export function computeLayout(w: number, h: number): Layout {
  const header = 52
  const footer = 34
  const pad = 16
  const body = Math.max(0, h - header - footer)
  if (w >= 1080) {
    const listW = Math.round(Math.min(420, Math.max(300, w * 0.27)))
    const settingsW = Math.round(Math.min(360, Math.max(300, w * 0.24)))
    const previewW = w - listW - settingsW - pad * 6
    return { kind: 'wide', w, h, header, footer, listW, listH: body - pad, settingsW, previewW, previewH: body - pad, showPreview: previewW > 200 }
  }
  const listH = Math.round(Math.min(body * 0.38, 330))
  if (w >= 620) {
    const settingsW = Math.round(Math.min(320, Math.max(270, w * 0.42)))
    const previewW = w - settingsW - pad * 3
    return { kind: 'split', w, h, header, footer, listW: w - pad * 2, listH, settingsW, previewW, previewH: body - listH - pad * 3, showPreview: true }
  }
  return { kind: 'thin', w, h, header, footer, listW: w - pad * 2, listH, settingsW: w - pad * 2, previewW: 0, previewH: 0, showPreview: false }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** "−62%" / "+12%" change from a to b. */
export function delta(a: number, b: number): string {
  if (!a) return ''
  const d = Math.round(((b - a) / a) * 100)
  return d <= 0 ? `−${Math.abs(d)}%` : `+${d}%`
}

/** Normalizes GPUIX terminal key events: printable keys can arrive as key "space" with the real character in keyChar. */
export function keyName(e: { key?: string; keyChar?: string | null }): string {
  const key = e.key ?? ''
  const ch = e.keyChar ?? ''
  if (ch.length === 1 && ch !== ' ' && (key === 'space' || key.length <= 1)) return ch
  return key
}
