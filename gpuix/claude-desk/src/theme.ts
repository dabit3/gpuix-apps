import type { GpuixTheme, StyleDesc } from '@gpuix/react'

export const C = {
  canvas: '#1A1A1A',
  sidebar: '#141414',
  raised: '#242424',
  overlay: '#2C2C2C',
  hover: '#262626',
  selected: '#2A2A2A',
  border: '#2A2A2A',
  borderStrong: '#363636',
  text: '#ECECEC',
  secondary: '#A6A6A6',
  tertiary: '#767676',
  ghost: '#5C5C5C',
  accent: '#D97757',
  accentSoft: '#D9775726',
  userBubble: '#262626',
  danger: '#E5484D',
  success: '#46A758',
  codeText: '#D4D4D4',
} as const

export const FONT_SANS = '.SystemUIFont'
export const FONT_MONO = 'Menlo'

export const CHAT_THEME: GpuixTheme = {
  appearance: 'dark',
  text: C.text,
  textMuted: C.secondary,
  textFaint: C.tertiary,
  textDim: C.secondary,
  border: C.border,
  bg: C.canvas,
  accent: C.accent,
  caret: C.accent,
  fontSans: FONT_SANS,
  fontMono: FONT_MONO,
  codeText: C.codeText,
  codeWash: '#FFFFFF0D',
  metrics: {
    mdTextSize: 14,
    mdLineHeight: 22,
    mdBlockGap: 12,
    mdHeadingSizes: [20, 16.5, 14.5, 14],
    mdHeadingLineHeights: [28, 24, 22, 22],
    mdTableCellPadding: 8,
    codeTextSize: 12.5,
    codeLineHeight: 19,
    diffTextSize: 12.5,
    diffLineHeight: 19,
    diffFileHeaderHeight: 32,
  },
}

export const MENU: StyleDesc = {
  minWidth: 240,
  paddingTop: 4,
  paddingBottom: 4,
  paddingLeft: 4,
  paddingRight: 4,
  backgroundColor: C.raised,
  borderWidth: 1,
  borderColor: C.borderStrong,
  borderRadius: 10,
}
