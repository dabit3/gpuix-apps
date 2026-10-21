import type { Controller } from '../controller'
import { cleanInitials } from '../scores'
import { ScoreTable } from './Sidebar'
import { COLORS, FIELD_H, FIELD_W, fmt, glow, hgrad, ICONS, INK, shade, vgrad } from './theme'

function Backdrop({ children, alpha = 'c8' }: { children: React.ReactNode; alpha?: string }) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: FIELD_W, height: FIELD_H, backgroundColor: INK.bg + alpha, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </div>
  )
}

export function Button({ label, testId, onClick, primary = false, color = COLORS.teal, width = 220 }: { label: string; testId: string; onClick: () => void; primary?: boolean; color?: string; width?: number }) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        width, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        background: primary ? vgrad(shade(color, 0.2), shade(color, -0.2)) : vgrad('#ffffff12', '#ffffff08'),
        borderWidth: 1, borderColor: primary ? shade(color, 0.4) : '#ffffff1c',
        boxShadow: primary ? [glow(color, 22, '66')] : [],
        hover: primary ? { background: vgrad(shade(color, 0.35), shade(color, -0.05)) } : { backgroundColor: '#ffffff1e' },
      } as never}
    >
      <text style={{ fontSize: 15, fontWeight: 700, color: primary ? '#04131a' : INK.text }}>{label}</text>
    </div>
  )
}

function Key({ k, label }: { k: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <div style={{ paddingLeft: 7, paddingRight: 7, height: 20, borderRadius: 5, backgroundColor: '#ffffff12', borderWidth: 1, borderColor: '#ffffff1f', display: 'flex', alignItems: 'center' }}>
        <text style={{ fontSize: 11, fontWeight: 700, color: INK.text }}>{k}</text>
      </div>
      <text style={{ fontSize: 12, color: INK.dim }}>{label}</text>
    </div>
  )
}

export function Controls() {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 16, flexWrap: 'wrap', justifyContent: 'center', width: 560 }}>
      <Key k="Mouse  ←  →" label="move" />
      <Key k="Click  Space" label="launch / fire" />
      <Key k="Esc" label="pause" />
      <Key k="F" label="perf HUD" />
      <Key k="M" label="sound" />
    </div>
  )
}

function Title({ c }: { c: Controller }) {
  return (
    <Backdrop alpha="b4">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <text style={{ fontSize: 13, fontWeight: 700, color: COLORS.amber }}>A GPUIX ARCADE GAME</text>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 16, alignItems: 'baseline' }}>
          <text style={{ fontSize: 76, fontWeight: 900, color: COLORS.teal }}>NEON</text>
          <text style={{ fontSize: 76, fontWeight: 900, color: COLORS.pink }}>BREAKOUT</text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', marginTop: 2, boxShadow: [glow(COLORS.amber, 18, '66')] }}>
          <div style={{ width: 230, height: 3, borderTopLeftRadius: 2, borderBottomLeftRadius: 2, background: hgrad(COLORS.teal, COLORS.amber) }} />
          <div style={{ width: 230, height: 3, borderTopRightRadius: 2, borderBottomRightRadius: 2, background: hgrad(COLORS.amber, COLORS.pink) }} />
        </div>
        <text style={{ fontSize: 15, color: INK.dim, marginTop: 14 }}>React elements, painted by Metal. 120 Hz physics.</text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 34 }}>
        <Button label="Play" testId="play-button" primary onClick={() => c.start()} />
        <text style={{ fontSize: 12, color: INK.faint }}>or press Space</text>
      </div>
      <div style={{ marginTop: 40 }}>
        <Controls />
      </div>
    </Backdrop>
  )
}

function Paused({ c }: { c: Controller }) {
  return (
    <Backdrop>
      <div testId="pause-menu" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 32, borderRadius: 22, background: vgrad('#101a2c', '#0a101c'), borderWidth: 1, borderColor: '#ffffff1a', boxShadow: [{ offsetX: 0, offsetY: 24, blurRadius: 60, spreadRadius: 0, color: '#000000aa' }] }}>
        <svg source={ICONS.pause} style={{ width: 26, height: 26, color: COLORS.amber }} />
        <text style={{ fontSize: 30, fontWeight: 800, color: INK.text }}>Paused</text>
        <text style={{ fontSize: 13, color: INK.dim, marginBottom: 8 }}>{`Level ${c.game.levelNumber} · ${fmt(c.game.score)} points`}</text>
        <Button label="Resume" testId="resume-button" primary onClick={() => c.resume()} />
        <Button label="Restart" testId="restart-button" onClick={() => c.start()} />
        <Button label={c.audio.muted ? 'Sound: Off' : 'Sound: On'} testId="sound-button" onClick={() => c.toggleSound()} />
        <Button label="Quit to title" testId="quit-button" onClick={() => c.toTitle()} />
      </div>
    </Backdrop>
  )
}

function GameOver({ c }: { c: Controller }) {
  const g = c.game
  const save = (value: string) => c.submitInitials(value)
  return (
    <Backdrop alpha="d8">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <text style={{ fontSize: 13, fontWeight: 700, color: COLORS.pink }}>GAME OVER</text>
        <text testId="final-score" style={{ fontSize: 60, fontWeight: 900, color: INK.text }}>{fmt(g.score)}</text>
        <text style={{ fontSize: 13, color: INK.dim }}>{`Level ${g.levelNumber}  ·  ${g.bricksBroken} bricks  ·  best combo x${Math.min(8, g.bestCombo)}`}</text>
      </div>
      {c.canEnterScore ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 28 }}>
          <text style={{ fontSize: 16, fontWeight: 700, color: COLORS.amber }}>New high score! Enter your initials</text>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 120, height: 52, borderRadius: 12, backgroundColor: '#ffffff0d', borderWidth: 1, borderColor: COLORS.teal + '88', boxShadow: [glow(COLORS.teal, 16, '44')], display: 'flex', alignItems: 'center', paddingLeft: 18, paddingRight: 18 }}>
              <input
                testId="initials-input"
                autoFocus
                value={c.draft}
                placeholder="AAA"
                theme={{ caret: COLORS.teal }}
                onChange={(e) => { c.draft = cleanInitials(e.value ?? '') }}
                onSubmit={(e) => save(e.value ?? c.draft)}
                style={{ flexGrow: 1, minWidth: 0, height: 52, fontSize: 28, fontWeight: 800, color: INK.text }}
              />
            </div>
            <Button label="Save" testId="save-score" primary width={100} onClick={() => save(c.draft)} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 24, width: 320 }}>
          {c.savedRank ? <text testId="saved-rank" style={{ fontSize: 14, fontWeight: 700, color: COLORS.teal }}>{`Saved ${c.savedInitials} at #${c.savedRank}`}</text> : null}
          <ScoreTable scores={c.scores} highlight={c.savedRank} rows={8} testId="gameover-scores" />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 12, marginTop: 26 }}>
        <Button label="Play again" testId="play-again" primary={!c.canEnterScore} width={160} onClick={() => c.start()} />
        <Button label="Title" testId="to-title" width={120} onClick={() => c.toTitle()} />
      </div>
    </Backdrop>
  )
}

export function Overlay({ c }: { c: Controller }) {
  if (c.mode === 'title') return <Title c={c} />
  if (c.mode === 'paused') return <Paused c={c} />
  if (c.mode === 'gameover') return <GameOver c={c} />
  return null
}
