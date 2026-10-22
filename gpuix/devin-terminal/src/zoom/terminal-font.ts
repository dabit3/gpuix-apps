// Ghostty keeps ⌘+ / ⌘− / ⌘0 for its own font size, so those keys never reach a terminal app.
// GPUIX paints into the terminal's cell grid, so a font change shows up as a new cell size
// (grid pixels ÷ columns/rows) while a window resize keeps the cell size. Following the cell
// size turns Ghostty's font shortcuts into app zoom steps.
import { closeSync, openSync } from 'fs'
import { stepZoom } from './scale'

export interface Cell {
  w: number
  h: number
}
export type FontChange = { kind: 'step'; steps: number } | { kind: 'reset' } | null

export function cellSize(px: { width: number; height: number }, grid: { cols: number; rows: number }): Cell | null {
  if (!(grid.cols > 0 && grid.rows > 0 && px.width > 0 && px.height > 0)) return null
  return { w: Math.round((px.width / grid.cols) * 100) / 100, h: Math.round((px.height / grid.rows) * 100) / 100 }
}

/** Maps each terminal cell size seen to a font level relative to launch (0). */
export class TerminalFontTracker {
  private levels = new Map<string, number>()
  private level = 0
  private cell: Cell

  constructor(initial: Cell) {
    this.cell = initial
    this.levels.set(key(initial), 0)
  }

  update(next: Cell): FontChange {
    if (key(next) === key(this.cell)) return null
    const known = this.levels.get(key(next))
    const prev = this.level
    if (known === undefined) {
      const dir = next.h !== this.cell.h ? Math.sign(next.h - this.cell.h) : Math.sign(next.w - this.cell.w)
      this.level += dir
      this.levels.set(key(next), this.level)
    } else this.level = known
    this.cell = next
    const steps = this.level - prev
    // A multi-step jump back to the launch size is Ghostty's ⌘0.
    if (this.level === 0 && Math.abs(steps) > 1) return { kind: 'reset' }
    return steps === 0 ? null : { kind: 'step', steps }
  }
}

export function applyFontChange(zoom: number, change: FontChange): number {
  if (!change) return zoom
  if (change.kind === 'reset') return 1
  let z = zoom
  for (let i = 0; i < Math.abs(change.steps); i++) z = stepZoom(z, change.steps > 0 ? 1 : -1)
  return z
}

/** Columns and rows of the controlling terminal, or null when there is none. */
export function readTerminalGrid(): { cols: number; rows: number } | null {
  let fd: number | null = null
  try {
    fd = openSync('/dev/tty', 'r')
    const out = Bun.spawnSync(['stty', 'size'], { stdin: fd, stderr: 'ignore' })
    const [rows, cols] = out.stdout.toString().trim().split(/\s+/).map(Number)
    return out.exitCode === 0 && rows! > 0 && cols! > 0 ? { cols: cols!, rows: rows! } : null
  } catch {
    return null
  } finally {
    if (fd != null) closeSync(fd)
  }
}

const key = (c: Cell) => `${c.w}x${c.h}`
