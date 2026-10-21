import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beatMap, FRAMES_PER_BEAT, LAST_FRAME, segments, BEATS } from './lib/beats'
import { makePalette, type PaletteName } from './lib/palette'
import { frameRenderer } from './export'
import { sceneAt } from './scene'
import type { TerminalTheme } from './theme'

export interface TimingIssue { frame: number; message: string }

/** Every state change must land on its beat (±1 frame) and every beat must carry an event. */
export function timingIssues(palette: PaletteName = 'dark'): TimingIssue[] {
  const pal = makePalette(palette)
  const out: TimingIssue[] = []
  for (const s of segments()) {
    const beatF = s.beat * FRAMES_PER_BEAT
    let change = -1
    for (let f = Math.max(0, beatF - 2); f <= beatF + 2; f++) if (sceneAt(f, pal).state === s.state && (f === 0 || sceneAt(f - 1, pal).state !== s.state)) change = f
    if (change < 0 || Math.abs(change - beatF) > 1) out.push({ frame: beatF, message: `${s.state} starts at ${change}, beat ${s.beat} is frame ${beatF}` })
  }
  for (let b = 0; b < LAST_FRAME / FRAMES_PER_BEAT; b++) if (!BEATS.find((e) => e.beat === b && (e.state || e.cursor.length))) out.push({ frame: b * FRAMES_PER_BEAT, message: `beat ${b} has no event` })
  return out
}

/** Byte-compare two PNG renders by decoding them with ffmpeg to raw RGBA. */
async function rgba(path: string): Promise<Uint8Array> {
  const p = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { stdout: 'pipe' })
  return new Uint8Array(await new Response(p.stdout).arrayBuffer())
}

export async function loopDiff(palette: PaletteName, theme?: TerminalTheme): Promise<{ differing: number; total: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'morph-check-'))
  try {
    const fr = frameRenderer({ palette, aspect: 'square', theme })
    fr.capture(0, (t) => join(dir, `first${t}.png`))
    fr.capture(LAST_FRAME, (t) => join(dir, `last${t}.png`))
    fr.dispose()
    const cat = async (name: string) => Buffer.concat(await Promise.all(Array.from({ length: fr.tiles }, (_, t) => rgba(join(dir, `${name}${t}.png`)))))
    const a = await cat('first'), b = await cat('last')
    let differing = 0
    for (let i = 0; i < Math.max(a.length, b.length); i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differing++
    void readFileSync
    return { differing, total: a.length / 4 }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

export async function runCheck(o: { palette: PaletteName; theme?: TerminalTheme; log: (...a: unknown[]) => void }): Promise<number> {
  o.log(beatMap())
  const issues = timingIssues(o.palette)
  o.log('')
  o.log(issues.length ? issues.map((i) => `  ✗ ${i.message}`).join('\n') : `  ✓ all ${segments().length} state changes land exactly on their beat (±0 frames), every beat has an event`)
  const d = await loopDiff(o.palette, o.theme)
  o.log(d.differing === 0 ? `  ✓ frame 0 and frame ${LAST_FRAME} are pixel-identical (${d.total} px)` : `  ✗ frame 0 and frame ${LAST_FRAME} differ in ${d.differing} of ${d.total} px`)
  return issues.length || d.differing ? 1 : 0
}
