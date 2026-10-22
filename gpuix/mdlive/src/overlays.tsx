import { motion, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { useEffect, useState } from 'react'
import type { Heading } from './doc'
import { alpha, type UiTheme } from './theme'

export const ICON = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
export const SEARCH_SVG = ICON('<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3 3"/>')
export const BACK_SVG = ICON('<path d="M10 3.5 5.5 8l4.5 4.5"/>')
export const COPY_SVG = ICON('<rect x="5.25" y="5.25" width="8" height="8" rx="1.75"/><path d="M10.75 5.25V4a1.25 1.25 0 0 0-1.25-1.25H4A1.25 1.25 0 0 0 2.75 4v5.5A1.25 1.25 0 0 0 4 10.75h1.25"/>')
export const DONE_SVG = ICON('<path d="m3.5 8.5 3 3 6-6.5"/>')
export const DOWN_SVG = ICON('<path d="M8 3v10M4 9l4 4 4-4"/>')
export const UP_SVG = ICON('<path d="M8 13V3M4 7l4-4 4 4"/>')

/** Scroll progress lives outside React state so scrolling never re-renders the document. */
export const progressBus: { set: ((f: number) => void) | null } = { set: null }

export function Progress({ t, width }: { t: UiTheme; width: number }) {
  const [f, setF] = useState(0)
  useEffect(() => {
    progressBus.set = (v) => setF((p) => (Math.abs(p - v) > 0.002 ? v : p))
    return () => {
      progressBus.set = null
    }
  }, [])
  return (
    <div
      testId="read-progress"
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        height: 2,
        width: Math.round(Math.max(0, Math.min(1, f)) * width),
        backgroundColor: alpha(t.blue, 0.7),
      }}
    />
  )
}

function Backdrop({ t, onClose, children, dim = 0.55, align = 'top' }: { t: UiTheme; onClose: () => void; children: React.ReactNode; dim?: number; align?: 'top' | 'center' }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: align === 'top' ? 'flex-start' : 'center' }}
    >
      <div onClick={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: alpha(t.bg, dim) }} />
      {children}
    </motion.div>
  )
}

const CARD = (t: UiTheme) => ({
  borderRadius: 14,
  borderWidth: 1,
  borderColor: t.hairline,
  backgroundColor: t.raised,
  boxShadow: [{ offsetX: 0, offsetY: 24, blurRadius: 60, spreadRadius: 0, color: '#000000a0' }],
})

export type PaletteItem = Heading & { score: number }

export function Palette({
  t,
  items,
  sel,
  query,
  setQuery,
  inputRef,
  onPick,
  onHover,
  onClose,
  onSubmit,
  onKey,
  winW,
  winH,
}: {
  t: UiTheme
  onSubmit: () => void
  onKey: (e: KeyEvent) => void
  items: Heading[]
  sel: number
  query: string
  setQuery: (q: string) => void
  inputRef: React.RefObject<PublicInstance | null>
  onPick: (h: Heading) => void
  onHover: (i: number) => void
  onClose: () => void
  winW: number
  winH: number
}) {
  const w = Math.min(560, winW - 40)
  const rows = Math.max(3, Math.min(9, Math.floor((winH * 0.62 - 60) / 36)))
  const start = Math.max(0, Math.min(sel - rows + 2, items.length - rows))
  const shown = items.slice(start, start + rows)
  return (
    <Backdrop t={t} onClose={onClose}>
      <motion.div
        initial={{ opacity: 0, top: -10 }}
        animate={{ opacity: 1, top: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={{ position: 'relative', marginTop: Math.round(winH * 0.12), display: 'flex', flexDirection: 'column', width: w, overflow: 'hidden', ...CARD(t) }}
      >
        <div testId="palette" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingLeft: 18, paddingRight: 18, borderBottomWidth: 1, borderColor: t.hairline }}>
          <svg source={SEARCH_SVG} style={{ width: 16, height: 16, color: t.text3 }} />
          <input
            ref={inputRef}
            testId="palette-input"
            autoFocus
            value={query}
            placeholder="Jump to section"
            onChange={(e) => setQuery(e.value ?? '')}
            onSubmit={onSubmit}
            onKeyDown={(e) => onKey(e as KeyEvent)}
            style={{ flexGrow: 1, minWidth: 0, height: 30, color: t.text, fontSize: 16, backgroundColor: '#00000000' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 6, paddingBottom: 6, paddingLeft: 6, paddingRight: 6 }}>
          {items.length === 0 && (
            <div style={{ display: 'flex', height: 44, alignItems: 'center', paddingLeft: 14 }}>
              <text style={{ color: t.text3, fontSize: 13.5 }}>No matching sections</text>
            </div>
          )}
          {shown.map((h, j) => {
            const i = start + j
            const on = i === sel
            return (
              <div
                key={h.key}
                testId={`pal-${h.slug}`}
                onClick={() => onPick(h)}
                onMouseEnter={() => onHover(i)}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  height: 36,
                  paddingLeft: 12 + (h.level >= 3 ? 16 : 0),
                  paddingRight: 12,
                  borderRadius: 8,
                  gap: 10,
                  backgroundColor: on ? alpha(t.text, 0.08) : undefined,
                  cursor: 'pointer',
                }}
              >
                <text style={{ color: on ? t.text : t.text2, fontSize: 14, fontWeight: h.level <= 2 ? 500 : 400, flexGrow: 1, flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {h.title}
                </text>
                {on && <text style={{ color: t.text3, fontSize: 12.5 }}>↩</text>}
              </div>
            )
          })}
        </div>
      </motion.div>
    </Backdrop>
  )
}

const SHORTCUTS: [string[], string][] = [
  [['o'], 'Jump to section'],
  [['/'], 'Find in document'],
  [['[', ']'], 'Previous / next section'],
  [['j', 'k'], 'Scroll'],
  [['space'], 'Page down'],
  [['g', 'G'], 'Top / bottom'],
  [['w'], 'Reading width'],
  [['t'], 'Contents'],
  [['f'], 'Follow edits'],
  [['⌫'], 'Back'],
  [['?'], 'Shortcuts'],
  [['⌃C'], 'Quit'],
]

function Kbd({ t, k }: { t: UiTheme; k: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 22, height: 22, paddingLeft: 6, paddingRight: 6, borderRadius: 6, backgroundColor: alpha(t.text, 0.07), borderWidth: 1, borderColor: t.hairline }}>
      <text style={{ color: t.text2, fontSize: 12, fontFamily: 'Menlo' }}>{k}</text>
    </div>
  )
}

export function ShortcutsSheet({ t, onClose, winW }: { t: UiTheme; onClose: () => void; winW: number }) {
  const w = Math.min(420, winW - 40)
  return (
    <Backdrop t={t} onClose={onClose} align="center">
      <motion.div
        initial={{ opacity: 0, width: w - 16 }}
        animate={{ opacity: 1, width: w }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={{ display: 'flex', flexDirection: 'column', paddingTop: 22, paddingBottom: 16, paddingLeft: 24, paddingRight: 24, ...CARD(t) }}
      >
        <text testId="shortcuts" style={{ color: t.text, fontSize: 15, fontWeight: 600, paddingBottom: 14 }}>Keyboard shortcuts</text>
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 32 }}>
            <text style={{ color: t.text2, fontSize: 13.5, flexGrow: 1 }}>{label}</text>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
              {keys.map((k) => (
                <Kbd key={k} t={t} k={k} />
              ))}
            </div>
          </div>
        ))}
      </motion.div>
    </Backdrop>
  )
}

export function Lightbox({ t, src, alt, w, h, winW, winH, onClose }: { t: UiTheme; src: string; alt?: string; w: number; h: number; winW: number; winH: number; onClose: () => void }) {
  const s = Math.min((winW - 96) / w, (winH - 140) / h, 2)
  const iw = Math.round(w * s)
  const ih = Math.round(h * s)
  return (
    <Backdrop t={t} onClose={onClose} dim={0.94} align="center">
      <motion.div
        onClick={onClose}
        initial={{ opacity: 0, width: Math.round(iw * 0.96), height: Math.round(ih * 0.96) }}
        animate={{ opacity: 1, width: iw, height: ih }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        style={{ display: 'flex', cursor: 'pointer' }}
      >
        <div testId="lightbox" style={{ display: 'flex', width: '100%', height: '100%' }}>
          <img src={src} style={{ width: '100%', height: '100%', borderRadius: 12 }} />
        </div>
      </motion.div>
      {alt && <text style={{ color: t.text3, fontSize: 13, paddingTop: 14 }}>{alt}</text>}
    </Backdrop>
  )
}

export function EditPill({ t, dir, onClick }: { t: UiTheme; dir: 'up' | 'down'; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 22, display: 'flex', flexDirection: 'row', justifyContent: 'center' }}>
      <motion.div
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        initial={{ opacity: 0, top: 8 }}
        animate={{ opacity: 1, top: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, height: 32, paddingLeft: 14, paddingRight: 16, borderRadius: 16, backgroundColor: hover ? alpha(t.blue, 0.28) : alpha(t.blue, 0.18), borderWidth: 1, borderColor: alpha(t.blue, 0.4), cursor: 'pointer', position: 'relative' }}
      >
        <svg source={dir === 'down' ? DOWN_SVG : UP_SVG} style={{ width: 13, height: 13, color: t.text }} />
        <text testId="edit-pill" style={{ color: t.text, fontSize: 12.5, fontWeight: 500 }}>{dir === 'down' ? 'Edited below' : 'Edited above'}</text>
      </motion.div>
    </div>
  )
}

export type { KeyEvent }
