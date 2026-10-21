import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createTestRoot } from '@gpuix/react/testing'
import { LAST_FRAME, TOTAL_FRAMES } from './lib/beats'
import { makePalette, type PaletteName } from './lib/palette'
import { registerGeist } from './fonts'
import { sceneAt } from './scene'
import { Stage } from './stage'
import type { Aspect } from './controller'
import type { TerminalTheme } from './theme'

/** The native test window loses this many rows to its (hidden) titlebar, so frames are rendered taller and cropped. */
const CHROME = 27

export interface FrameRenderer { size: { w: number; h: number }; tiles: number; tileH: number; capture(frame: number, path: (tile: number) => string): void; dispose(): void }

/**
 * The native test window can't be taller than the display (it clamps at 1080 incl. titlebar on this VM), so a frame is
 * rendered as horizontal bands: the same stage, shifted up by k*tileH, each captured at full resolution, then stacked.
 */
export function frameRenderer(opts: { palette: PaletteName; aspect: Aspect; width?: number; theme?: TerminalTheme }): FrameRenderer {
  const w = opts.width ?? 1080
  const h = opts.aspect === 'vertical' ? Math.round((w * 1350) / 1080) : w
  const tiles = Math.max(1, Math.ceil(h / 600))
  const tileH = Math.ceil(h / tiles)
  const pal = makePalette(opts.palette, opts.theme?.bg, opts.theme?.fg)
  const { render, renderer, unmount } = createTestRoot({ width: w, height: tileH + CHROME }) as ReturnType<typeof createTestRoot> & { unmount?: () => void }
  registerGeist(renderer)
  return {
    size: { w, h }, tiles, tileH,
    capture(frame, path) {
      const scene = sceneAt(frame, pal)
      for (let t = 0; t < tiles; t++) {
        render(
          <div style={{ position: 'relative', width: w, height: tileH + CHROME, overflow: 'hidden', backgroundColor: pal.canvas }}>
            <div style={{ position: 'absolute', left: 0, top: -t * tileH, width: w, height: h }}><Stage scene={scene} pal={pal} width={w} height={h} /></div>
          </div>,
        )
        renderer.flush()
        renderer.captureScreenshot(path(t))
      }
    },
    dispose() { unmount?.() },
  }
}

/** ffmpeg filter that crops each band's top tileH rows, stacks them and trims to h. */
export function stackFilter(tiles: number, w: number, tileH: number, h: number): string {
  const crops = Array.from({ length: tiles }, (_, i) => `[${i}:v]crop=${w}:${tileH}:0:0[t${i}]`).join(';')
  const stack = tiles > 1 ? `;${Array.from({ length: tiles }, (_, i) => `[t${i}]`).join('')}vstack=inputs=${tiles}[s]` : ';[t0]null[s]'
  return `${crops}${stack};[s]crop=${w}:${h}:0:0,format=yuv420p[v]`
}

export interface ExportOptions { out: string; palette: PaletteName; aspect: Aspect; width?: number; crf?: number; theme?: TerminalTheme; onFrame?: (done: number, total: number) => void }

/** Frame-exact export: every one of the 840 frames is rendered offscreen by the GPUIX test renderer, then ffmpeg encodes them. */
export async function exportVideo(o: ExportOptions): Promise<{ out: string; frames: number; bytes: number; ms: number }> {
  const t0 = performance.now()
  const out = resolve(o.out)
  mkdirSync(dirname(out), { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), 'morph-frames-'))
  try {
    const fr = frameRenderer(o)
    for (let f = 0; f <= LAST_FRAME; f++) {
      fr.capture(f, (t) => join(dir, `t${t}_${String(f).padStart(4, '0')}.png`))
      o.onFrame?.(f + 1, TOTAL_FRAMES)
    }
    fr.dispose()
    const { w, h } = fr.size
    const inputs = Array.from({ length: fr.tiles }, (_, t) => ['-framerate', '60', '-i', join(dir, `t${t}_%04d.png`)]).flat()
    const ff = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', ...inputs, '-filter_complex', stackFilter(fr.tiles, w, fr.tileH, h), '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', String(o.crf ?? 18), '-r', '60', '-movflags', '+faststart', out], { stdout: 'inherit', stderr: 'pipe' })
    const code = await ff.exited
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${await new Response(ff.stderr).text()}`)
    return { out, frames: TOTAL_FRAMES, bytes: statSync(out).size, ms: performance.now() - t0 }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
