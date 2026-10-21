import { useApp, T } from './kit.tsx'
import type { View } from '../controller.ts'
import { alpha, mix } from '../theme.ts'

export function Profiles({ view, width, height }: { view: View; width: number; height: number }) {
  const { ctl, theme } = useApp()
  const n = view.profiles.length
  const size = Math.max(72, Math.min(150, Math.floor((width - 80) / n) - 36))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width, height, gap: Math.round(size * 0.32) }}>
      <T color={theme.fg} size={Math.max(22, Math.min(38, width / 34))} weight={600}>Who's watching?</T>
      <div style={{ display: 'flex', flexDirection: 'row', gap: Math.round(size * 0.3) }}>
        {view.profiles.map((p, i) => {
          const focused = i === view.profileIdx
          const color = theme.palette[p.color] ?? theme.accent
          return (
            <div
              key={p.name}
              onMouseEnter={() => { if (ctl.view.pointer) ctl.view.profileIdx !== i && ctl.dispatch(i > ctl.view.profileIdx ? 'right' : 'left', 'mouse') }}
              onClick={() => ctl.selectProfile(i)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, cursor: 'pointer' }}
            >
              <div style={{
                width: size, height: size, borderRadius: Math.round(size * 0.22), display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                background: { type: 'linear-gradient', angle: 160, stops: [{ color: mix(color, theme.fg, 0.15), position: 0 }, { color: mix(color, theme.bg, 0.45), position: 1 }] },
                borderWidth: 4, borderColor: focused ? theme.fg : 'transparent',
                opacity: focused ? 1 : 0.72,
                boxShadow: focused ? { offsetX: 0, offsetY: 10, blurRadius: 30, spreadRadius: 0, color: alpha(color, 0.45) } : undefined,
              }}>
                <T color={theme.bg} size={Math.round(size * 0.44)} weight={700}>{p.name.slice(0, 1).toUpperCase()}</T>
              </div>
              <T color={focused ? theme.fg : theme.dim} size={16} weight={focused ? 600 : 400}>{p.name}</T>
              <div style={{ height: 16 }}>
                {p.kids ? <T color={theme.faint} size={12}>Kids · G and PG</T> : null}
              </div>
            </div>
          )
        })}
      </div>
      <T color={theme.faint} size={13}>←  →  choose     ⏎  enter</T>
    </div>
  )
}
