import { mixColor } from './color'

export type PaletteName = 'dark' | 'light'

export interface Palette {
  name: PaletteName
  canvas: string
  solid: string
  onSolid: string
  card: string
  cardBorder: string
  onCard: string
  muted: string
  faint: string
  track: string
  accent: string
  onAccent: string
  cursor: string
  cursorEdge: string
}

export const ACCENT = '#ff4d00'

/** dark: the piece inverted onto the Ghostty theme background. light: the original brief (#EDEBE8 canvas, black/white + #FF4D00). */
export function makePalette(name: PaletteName, terminalBg = '#0a0c10', terminalFg = '#f0f3f6'): Palette {
  if (name === 'light') {
    return {
      name,
      canvas: '#edebe8',
      solid: '#0b0b0c',
      onSolid: '#ffffff',
      card: '#ffffff',
      cardBorder: '#e2dfdb',
      onCard: '#0b0b0c',
      muted: '#86827d',
      faint: '#d9d5d0',
      track: '#e6e3df',
      accent: ACCENT,
      onAccent: '#ffffff',
      cursor: '#0b0b0c',
      cursorEdge: '#ffffff',
    }
  }
  return {
    name,
    canvas: terminalBg,
    solid: terminalFg,
    onSolid: terminalBg,
    card: mixColor(terminalBg, terminalFg, 0.055),
    cardBorder: mixColor(terminalBg, terminalFg, 0.16),
    onCard: terminalFg,
    muted: mixColor(terminalBg, terminalFg, 0.55),
    faint: mixColor(terminalBg, terminalFg, 0.2),
    track: mixColor(terminalBg, terminalFg, 0.14),
    accent: ACCENT,
    onAccent: '#ffffff',
    cursor: '#0b0b0c',
    cursorEdge: '#ffffff',
  }
}
