import type { GpuixTheme } from '@gpuix/react'

export const C = {
  window: '#161618',
  sidebar: '#1B1B1D',
  pane: '#1F1F21',
  paneAlt: '#232326',
  raised: '#2A2A2D',
  border: '#2E2E31',
  borderSoft: '#262629',
  text: '#ECECEE',
  text2: '#A8A8AD',
  text3: '#737378',
  accent: '#0A84FF',
  accentSoft: '#0A84FF26',
  selectInactive: '#343437',
  green: '#30D158',
  red: '#FF5A4F',
  orange: '#FF9F0A',
  yellow: '#FFD60A',
  teal: '#40C8E0',
  addBg: '#1B3324',
  delBg: '#3A1F1F',
  hunkBg: '#1C2636',
}

export const MONO = 'Menlo'

/** Lane colours for the commit graph. Deliberately no purple. */
export const LANE_COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#40C8E0', '#FF6482', '#FFD60A', '#64D2FF', '#AC8E68', '#FF453A', '#66D4CF']

export const AVATAR_COLORS = ['#0A84FF', '#30A46C', '#E5484D', '#F76B15', '#12A594', '#D6409F', '#3E63DD', '#AD7F58', '#0091FF', '#46A758']

export const nativeTheme: GpuixTheme = {
  appearance: 'dark',
  bg: C.pane,
  border: C.border,
  text: C.text,
  textMuted: C.text2,
  textFaint: C.text3,
  textDim: C.text3,
  accent: C.accent,
  caret: C.accent,
  codeText: '#D6D6DA',
  codeWash: '#252528',
  diffAdd: '#30D158',
  diffDel: '#FF5A4F',
  diffHunkBg: C.hunkBg,
  fontMono: MONO,
  metrics: {
    codeTextSize: 12,
    codeLineHeight: 19,
    diffTextSize: 12,
    diffLineHeight: 19,
    mdTextSize: 13.5,
    mdLineHeight: 21,
  },
}

export const statusColor: Record<string, string> = {
  A: C.green,
  '?': C.green,
  M: C.orange,
  T: C.orange,
  D: C.red,
  R: C.teal,
  C: C.teal,
  U: C.yellow,
}
