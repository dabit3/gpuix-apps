import type { Raster } from './raster'
import { T, rgb, type RGB } from './theme'

// 5×7 bitmap font (rows top→bottom, 5 bits each, MSB left) for labels in exported PNGs.
// GPUIX's live renderer can't screenshot in terminal mode, so the export draws its own text.
const GLYPHS: Record<string, string> = {
  '0': '0E11131519110E', '1': '040C040404040E', '2': '0E11010204081F', '3': '1F02040201110E', '4': '02060A121F0202',
  '5': '1F101E0101110E', '6': '0608101E11110E', '7': '1F010204080808', '8': '0E11110E11110E', '9': '0E11110F01020C',
  A: '0E1111111F1111', B: '1E11111E11111E', C: '0E11101010110E', D: '1C12111111121C', E: '1F10101E10101F',
  F: '1F10101E101010', G: '0E11101711110F', H: '1111111F111111', I: '0E04040404040E', J: '0702020202120C',
  K: '11121418141211', L: '1010101010101F', M: '111B1515111111', N: '11111915131111', O: '0E11111111110E',
  P: '1E11111E101010', Q: '0E11111115120D', R: '1E11111E141211', S: '0F10100E01011E', T: '1F040404040404',
  U: '1111111111110E', V: '11111111110A04', W: '1111111515150A', X: '11110A040A1111', Y: '1111110A040404',
  Z: '1F01020408101F', ' ': '00000000000000', '.': '00000000000C0C', ',': '00000000000C0408', ':': '000C0C000C0C00',
  '-': '0000001F000000', '+': '0004041F040400', '%': '18190204081303', '/': '00010204081000', '_': '0000000000001F',
  '(': '02040808080402', ')': '08040202020408', '=': '00001F001F0000', '·': '0000000C0C0000', '?': '0E110102040004',
  '>': '08040201020408', '<': '02040810080402', '#': '0A0A1F0A1F0A0A', '*': '00150E1F0E1500', "'": '04040800000000',
}
const ALIAS: Record<string, string> = { '–': '-', '—': '-', '…': '.', 'µ': 'U', '"': "'" }

export class Canvas {
  buf: Uint8Array
  constructor(readonly w: number, readonly h: number, bg: RGB) {
    this.buf = new Uint8Array(w * h * 4)
    const u = new Uint32Array(this.buf.buffer)
    u.fill((0xff << 24) | (bg[0] << 16) | (bg[1] << 8) | bg[2])
  }

  rect(x: number, y: number, w: number, h: number, c: RGB) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        const o = (yy * this.w + xx) * 4
        this.buf[o] = c[2]
        this.buf[o + 1] = c[1]
        this.buf[o + 2] = c[0]
      }
  }

  blit(src: Uint8Array, sw: number, sh: number, x: number, y: number) {
    for (let yy = 0; yy < sh; yy++) {
      const dy = y + yy
      if (dy < 0 || dy >= this.h) continue
      const from = yy * sw * 4
      this.buf.set(src.subarray(from, from + Math.min(sw, this.w - x) * 4), (dy * this.w + x) * 4)
    }
  }

  static textWidth(s: string, scale = 2) {
    return s.length * 6 * scale - scale
  }

  /** Draws `s` with its top-left at (x, y); returns the x after the last glyph. */
  text(s: string, x: number, y: number, c: RGB, scale = 2) {
    for (const raw of s.toUpperCase()) {
      const g = GLYPHS[raw] ?? GLYPHS[ALIAS[raw] ?? '?']!
      for (let row = 0; row < 7; row++) {
        const bits = parseInt(g.slice(row * 2, row * 2 + 2), 16)
        for (let col = 0; col < 5; col++) if (bits & (0x10 >> col)) this.rect(x + col * scale, y + row * scale, scale, scale, c)
      }
      x += 6 * scale
    }
    return x
  }
}

export type ExportSpec = {
  title: string
  subtitle: string
  series: { name: string; color: string; summary: string }[]
  yLabels: { py: number; label: string }[]
  xLabels: { px: number; label: string }[]
}

/** The chart bitmap plus title, legend with stats, and axis labels, as BGRA. */
export function composeExport(raster: Raster, spec: ExportSpec) {
  const pad = 28
  const gutter = Math.max(64, ...spec.yLabels.map((l) => Canvas.textWidth(l.label) + 18))
  const legendH = spec.series.length * 24
  const top = pad + 26 + 12 + legendH + 14
  const cx = pad + gutter
  const w = cx + raster.w + pad
  const h = top + raster.h + 22 + pad
  const c = new Canvas(w, h, rgb(T.bg))
  let x = c.text('plot', pad, pad, rgb(T.fg), 3)
  c.text(spec.title, x + 18, pad + 3, rgb(T.dim))
  c.text(spec.subtitle, w - pad - Canvas.textWidth(spec.subtitle), pad + 3, rgb(T.faint))
  spec.series.forEach((s, i) => {
    const y = pad + 38 + i * 24
    c.rect(pad, y + 5, 18, 4, rgb(s.color))
    x = c.text(s.name, pad + 28, y, rgb(s.color))
    c.text(s.summary, Math.max(x + 24, pad + 220), y, rgb(T.dim))
  })
  c.blit(raster.buf, raster.w, raster.h, cx, top)
  for (const l of spec.yLabels) c.text(l.label, cx - 12 - Canvas.textWidth(l.label), Math.round(top + l.py - 7), rgb(T.faint))
  for (const l of spec.xLabels) c.text(l.label, Math.round(cx + l.px - Canvas.textWidth(l.label) / 2), top + raster.h + 10, rgb(T.faint))
  return { buf: c.buf, w, h }
}
