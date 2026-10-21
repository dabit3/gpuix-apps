// Undo/redo as a command stack. Pixel edits store only the 64×64 tiles that changed (before + after), not whole images.

export const TILE = 64

export interface TileDiff {
  buf: Uint8ClampedArray | Uint8Array
  /** Bytes per pixel: 4 for RGBA layers, 1 for masks and selections. */
  ch: number
  width: number
  tiles: { x: number; y: number; w: number; h: number; before: Uint8Array; after: Uint8Array }[]
}

export function diffTiles(before: ArrayLike<number> & { length: number }, buf: Uint8ClampedArray | Uint8Array, width: number, height: number, ch: number, rect?: { x0: number; y0: number; x1: number; y1: number }): TileDiff {
  const r = rect ?? { x0: 0, y0: 0, x1: width, y1: height }
  const tiles: TileDiff['tiles'] = []
  const tx0 = Math.floor(Math.max(0, r.x0) / TILE)
  const ty0 = Math.floor(Math.max(0, r.y0) / TILE)
  const tx1 = Math.ceil(Math.min(width, r.x1) / TILE)
  const ty1 = Math.ceil(Math.min(height, r.y1) / TILE)
  for (let ty = ty0; ty < ty1; ty++) {
    for (let tx = tx0; tx < tx1; tx++) {
      const x = tx * TILE
      const y = ty * TILE
      const w = Math.min(TILE, width - x)
      const h = Math.min(TILE, height - y)
      let changed = false
      for (let yy = 0; yy < h && !changed; yy++) {
        const o = ((y + yy) * width + x) * ch
        for (let i = 0; i < w * ch; i++) {
          if (before[o + i] !== buf[o + i]) {
            changed = true
            break
          }
        }
      }
      if (!changed) continue
      const b = new Uint8Array(w * h * ch)
      const a = new Uint8Array(w * h * ch)
      for (let yy = 0; yy < h; yy++) {
        const o = ((y + yy) * width + x) * ch
        for (let i = 0; i < w * ch; i++) {
          b[yy * w * ch + i] = before[o + i]!
          a[yy * w * ch + i] = buf[o + i]!
        }
      }
      tiles.push({ x, y, w, h, before: b, after: a })
    }
  }
  return { buf, ch, width, tiles }
}

export function applyTiles(d: TileDiff, which: 'before' | 'after') {
  for (const t of d.tiles) {
    const src = t[which]
    for (let yy = 0; yy < t.h; yy++) d.buf.set(src.subarray(yy * t.w * d.ch, (yy + 1) * t.w * d.ch), ((t.y + yy) * d.width + t.x) * d.ch)
  }
}

export const diffBytes = (d: TileDiff) => d.tiles.reduce((n, t) => n + t.before.length * 2, 0)

export const diffRect = (d: TileDiff) =>
  d.tiles.length
    ? d.tiles.reduce((r, t) => ({ x0: Math.min(r.x0, t.x), y0: Math.min(r.y0, t.y), x1: Math.max(r.x1, t.x + t.w), y1: Math.max(r.y1, t.y + t.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
    : null

export interface Command {
  label: string
  undo(): void
  redo(): void
  bytes?: number
  /** Commands with the same key pushed back to back merge (e.g. dragging an opacity slider). */
  mergeKey?: string
}

export class History {
  entries: Command[] = []
  index = 0
  constructor(public maxSteps = 200, public maxBytes = 1024 * 1024 * 1024) {}

  push(c: Command) {
    this.entries.length = this.index
    const last = this.entries[this.index - 1]
    if (c.mergeKey && last && last.mergeKey === c.mergeKey) {
      const firstUndo = last.undo
      this.entries[this.index - 1] = { ...c, undo: firstUndo }
      return
    }
    this.entries.push(c)
    this.index++
    let bytes = this.entries.reduce((n, e) => n + (e.bytes ?? 0), 0)
    while (this.entries.length > 1 && (this.entries.length > this.maxSteps || bytes > this.maxBytes)) {
      bytes -= this.entries.shift()!.bytes ?? 0
      this.index--
    }
  }

  get canUndo() {
    return this.index > 0
  }
  get canRedo() {
    return this.index < this.entries.length
  }

  undo() {
    if (!this.canUndo) return null
    const c = this.entries[--this.index]!
    c.undo()
    return c
  }

  redo() {
    if (!this.canRedo) return null
    const c = this.entries[this.index++]!
    c.redo()
    return c
  }

  /** Jump so that `n` commands are applied. */
  jumpTo(n: number) {
    while (this.index > n && this.canUndo) this.undo()
    while (this.index < n && this.canRedo) this.redo()
  }
}
