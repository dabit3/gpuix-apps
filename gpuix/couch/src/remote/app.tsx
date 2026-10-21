import { useEffect, useState, type ReactNode } from 'react'
import { render, useWindowSize } from '@gpuix/react'
import type { Action } from '../controller.ts'
import type { Theme } from '../theme.ts'
import { alpha } from '../theme.ts'
import { keyToAction } from '../keys.ts'
import { fmtClock } from '../library/model.ts'
import { connectRemote, type RemoteConn } from './client.ts'
import type { Status } from './protocol.ts'
import { SANS } from '../ui/kit.tsx'

function RemoteApp({ theme }: { theme: Theme }) {
  const { width, height } = useWindowSize()
  const [status, setStatus] = useState<Status | null>(null)
  const [conn, setConn] = useState<RemoteConn | null>(null)
  const [flash, setFlash] = useState<{ a: Action; at: number } | null>(null)
  useEffect(() => {
    let c: RemoteConn | null = null, alive = true
    const tryConnect = async () => {
      c = await connectRemote((s) => { setStatus(s); if (!s) { setConn(null); if (alive) setTimeout(tryConnect, 800) } })
      if (c) setConn(c)
      else if (alive) setTimeout(tryConnect, 800)
    }
    tryConnect()
    return () => { alive = false; c?.close() }
  }, [])
  const send = (a: Action) => { conn?.send({ action: a }); setFlash({ a, at: Date.now() }); setTimeout(() => setFlash(null), 160) }
  const text = (s: string, color: string, size = 14, weight = 500) => <text style={{ color, fontSize: size, fontWeight: weight, fontFamily: SANS }}>{s}</text>
  const d = Math.max(150, Math.min(260, Math.min(width - 60, height - 250)))
  const btn = (a: Action, label: ReactNode, style: Record<string, unknown>) => {
    const lit = flash?.a === a
    return (
      <div onClick={() => send(a)} style={{ position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 12, backgroundColor: lit ? theme.focus : 'transparent', hover: { backgroundColor: lit ? theme.focus : alpha(theme.fg, 0.1) }, ...style }}>
        {typeof label === 'string' ? text(label, lit ? theme.bg : theme.fg, 20, 700) : label}
      </div>
    )
  }
  const pill = (a: Action, label: string) => {
    const lit = flash?.a === a
    return (
      <div key={a} onClick={() => send(a)} style={{ height: 34, paddingLeft: 14, paddingRight: 14, borderRadius: 17, display: 'flex', alignItems: 'center', cursor: 'pointer', backgroundColor: lit ? theme.focus : alpha(theme.fg, 0.1), hover: { backgroundColor: lit ? theme.focus : alpha(theme.fg, 0.18) } }}>
        {text(label, lit ? theme.bg : theme.fg, 13, 600)}
      </div>
    )
  }
  const s = d / 3
  const prog = status && status.dur ? status.pos / status.dur : 0
  return (
    <div tabIndex={-1} autoFocus onKeyDown={(e) => { const a = keyToAction(e); if (a) send(a) }}
      style={{ width, height, backgroundColor: theme.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: Math.min(360, width - 40) }}>
        {text(conn ? 'couch remote' : 'looking for couch…', conn ? theme.dim : theme.faint, 12, 600)}
        {text(status?.title ?? (status ? status.screen : '—'), theme.fg, 16, 700)}
        {status?.dur ? (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' }}>
            {text(fmtClock(status.pos), theme.dim, 12)}
            <div style={{ flexGrow: 1, height: 4, borderRadius: 2, backgroundColor: alpha(theme.fg, 0.2) }}>
              <div style={{ width: `${(prog * 100).toFixed(1)}%`, height: 4, borderRadius: 2, backgroundColor: theme.focus }} />
            </div>
            {text(fmtClock(status.dur), theme.dim, 12)}
          </div>
        ) : null}
      </div>
      <div style={{ position: 'relative', width: d, height: d, borderRadius: d / 2, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.line }}>
        {btn('up', '▲', { left: s, top: 6, width: s, height: s - 6 })}
        {btn('down', '▼', { left: s, top: 2 * s, width: s, height: s - 6 })}
        {btn('left', '◀', { left: 6, top: s, width: s - 6, height: s })}
        {btn('right', '▶', { left: 2 * s, top: s, width: s - 6, height: s })}
        {btn('ok', 'OK', { left: s + 6, top: s + 6, width: s - 12, height: s - 12, borderRadius: (s - 12) / 2, backgroundColor: flash?.a === 'ok' ? theme.focus : theme.raised })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', width: Math.min(420, width - 30) }}>
        {pill('back', '← Back')}{pill('home', '⌂ Home')}{pill('rew', '«')}{pill('play', status?.playing ? '❚❚' : '▶')}{pill('ffwd', '»')}{pill('hud', 'HUD')}
      </div>
    </div>
  )
}

export function startRemoteApp(theme: Theme, opts: { terminal: boolean }) {
  return render(<RemoteApp theme={theme} />, { terminal: opts.terminal, title: 'couch remote', width: 420, height: 640, backgroundColor: theme.bg } as any)
}
