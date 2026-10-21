import { createContext, useContext, type ReactNode } from 'react'
import type { Theme } from '../theme.ts'
import { alpha } from '../theme.ts'
import type { Controller } from '../controller.ts'
import type { ArtQueue, ArtKind } from '../library/art.ts'
import type { Item } from '../library/model.ts'

export interface Ctx { ctl: Controller; theme: Theme; art: ArtQueue; artVersion: number }
export const AppCtx = createContext<Ctx>(null as unknown as Ctx)
export const useApp = () => useContext(AppCtx)

export const SANS = 'Helvetica Neue'
export const MONO = 'Menlo'

export function T(props: { children: ReactNode; color: string; size?: number; weight?: number; mono?: boolean; lines?: number; style?: Record<string, unknown> }) {
  const { children, color, size = 15, weight, mono, lines, style } = props
  return (
    <text
      style={{
        color, fontSize: size, fontWeight: weight ?? 400, fontFamily: mono ? MONO : SANS,
        lineHeight: Math.round(size * 1.3),
        ...(lines ? { maxHeight: Math.round(size * 1.3) * lines, overflow: 'hidden' } : {}),
        ...style,
      }}
    >
      {children}
    </text>
  )
}

/** Generated art path for an item, queueing ffmpeg extraction if needed. Re-reads whenever artVersion bumps. */
export function useArt(item: Item | undefined, kind: ArtKind, front = false): string | undefined {
  const { art } = useApp()
  if (!item) return undefined
  return art.request(item, kind, front)
}

export function Pill({ children, color, bg, border }: { children: ReactNode; color: string; bg?: string; border?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 8, paddingRight: 8, height: 22, borderRadius: 5, backgroundColor: bg ?? 'transparent', borderWidth: border ? 1 : 0, borderColor: border ?? 'transparent' }}>
      <T color={color} size={12} weight={600}>{children}</T>
    </div>
  )
}

export function ProgressBar({ value, theme, height = 4, track }: { value: number; theme: Theme; height?: number; track?: string }) {
  return (
    <div style={{ height, borderRadius: height / 2, backgroundColor: track ?? alpha(theme.fg, 0.22), overflow: 'hidden', width: '100%' }}>
      <div style={{ height, width: `${Math.max(0, Math.min(100, value * 100)).toFixed(2)}%`, backgroundColor: theme.focus, borderRadius: height / 2 }} />
    </div>
  )
}

/** Left-to-right and bottom-up fades that melt a backdrop into the terminal background. */
export function Scrims({ theme, left = 0.98, bottom = 1, side = 0.62 }: { theme: Theme; left?: number; bottom?: number; side?: number }) {
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(side * 100)}%`, pointerEvents: 'none', background: { type: 'linear-gradient', angle: 90, stops: [{ color: alpha(theme.bg, left), position: 0 }, { color: alpha(theme.bg, 0), position: 1 }] } }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', pointerEvents: 'none', background: { type: 'linear-gradient', angle: 0, stops: [{ color: alpha(theme.bg, bottom), position: 0 }, { color: alpha(theme.bg, 0), position: 1 }] } }} />
    </>
  )
}

export function metaLine(ctl: Controller, it: Item): string {
  const parts: string[] = []
  if (it.year) parts.push(String(it.year))
  if (it.kind === 'show') {
    const n = it.episodes?.length ?? 0
    const seasons = new Set((it.episodes ?? []).map((e) => ctl.lib.items[e]?.season)).size
    parts.push(`${seasons} season${seasons === 1 ? '' : 's'}`, `${n} episode${n === 1 ? '' : 's'}`)
  } else if (it.probe?.duration) {
    const m = Math.round(it.probe.duration / 60)
    parts.push(m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${Math.max(1, m)} min`)
  }
  if (it.rating) parts.push(it.rating)
  if (it.genres.length) parts.push(it.genres.slice(0, 2).join(', '))
  return parts.join('  ·  ')
}
