import { getZoom } from './zoom/scale'
export type ThemeName = 'dark' | 'light'

export type Palette = {
  name: ThemeName
  canvas: string
  sidebar: string
  raised: string
  card: string
  cardHead: string
  menu: string
  hover: string
  selected: string
  border: string
  borderStrong: string
  text: string
  secondary: string
  tertiary: string
  ghost: string
  accent: string
  accentSoft: string
  blue: string
  orange: string
  add: string
  del: string
  purple: string
  blueSoft: string
  orangeSoft: string
  greenSoft: string
  redSoft: string
  purpleSoft: string
  userBubble: string
  sendBg: string
  sendFg: string
  chip: string
  chipText: string
  codeText: string
  codeWash: string
  input: string
  focus: string
  elevated: string
  shadow: string
  shadowSoft: string
}

// Neutral grays from app.devin.ai; the canvas matches Ghostty's GitHub High Contrast themes so the app blends in.
export const DARK: Palette = {
  name: 'dark',
  canvas: '#0a0c10',
  sidebar: '#0a0c10',
  raised: '#121419',
  card: '#0f1115',
  cardHead: '#14161b',
  menu: '#16181d',
  hover: '#17191e',
  selected: '#1f2227',
  border: '#1f2227',
  borderStrong: '#2d3037',
  text: '#ededef',
  secondary: '#c3c6cc',
  tertiary: '#9599a0',
  ghost: '#6f737a',
  accent: '#4c9dff',
  accentSoft: '#4c9dff22',
  blue: '#4c9dff',
  orange: '#f0883e',
  add: '#3fb950',
  del: '#f85149',
  purple: '#a371f7',
  blueSoft: '#4c9dff1c',
  orangeSoft: '#f0883e1c',
  greenSoft: '#3fb9501c',
  redSoft: '#f851491c',
  purpleSoft: '#a371f71c',
  userBubble: '#16181d',
  sendBg: '#ededef',
  sendFg: '#0a0c10',
  chip: '#1c1f24',
  chipText: '#c3c6cc',
  codeText: '#e6e6e6',
  codeWash: '#ffffff10',
  input: '#0e1014',
  focus: '#4a4f58',
  elevated: '#25282e',
  shadow: '#000000a6',
  shadowSoft: '#00000059',
}

export const LIGHT: Palette = {
  name: 'light',
  canvas: '#ffffff',
  sidebar: '#fafafa',
  raised: '#ffffff',
  card: '#ffffff',
  cardHead: '#f8f8f9',
  menu: '#ffffff',
  hover: '#f1f1f3',
  selected: '#e9e9ec',
  border: '#e6e6e9',
  borderStrong: '#d4d4d9',
  text: '#18181b',
  secondary: '#3c3c43',
  tertiary: '#5f5f67',
  ghost: '#7c7c85',
  accent: '#2f6fde',
  accentSoft: '#2f6fde16',
  blue: '#2f6fde',
  orange: '#c96512',
  add: '#1a7f37',
  del: '#cf222e',
  purple: '#8250df',
  blueSoft: '#2f6fde14',
  orangeSoft: '#c9651214',
  greenSoft: '#1a7f3714',
  redSoft: '#cf222e12',
  purpleSoft: '#8250df14',
  userBubble: '#f3f3f5',
  sendBg: '#18181b',
  sendFg: '#ffffff',
  chip: '#efeff1',
  chipText: '#3c3c43',
  codeText: '#1a1a1a',
  codeWash: '#0000000a',
  input: '#ffffff',
  focus: '#b4b4bc',
  elevated: '#ffffff',
  shadow: '#0000001f',
  shadowSoft: '#0000000f',
}

/** Live palette. Components read it during render; `setTheme` swaps it and the app re-renders from the root. */
export const C: Palette = { ...DARK }

export function setTheme(name: ThemeName) {
  Object.assign(C, name === 'light' ? LIGHT : DARK)
}

/** `auto` follows Ghostty's configured theme (anything with "Light" in its name), else dark. */
export function resolveTheme(flag: string | undefined, ghosttyConfig?: string): ThemeName {
  if (flag === 'light' || flag === 'dark') return flag
  const m = ghosttyConfig?.match(/^\s*theme\s*=\s*(.+)$/m)
  const theme = m?.[1]?.trim() ?? ''
  // "light:X,dark:Y" pairs follow the OS appearance; assume dark there.
  if (/light:/i.test(theme)) return 'dark'
  return /light/i.test(theme) ? 'light' : 'dark'
}

/** Colors for GPUIX markdown/code/diff elements. */
export function nativeTheme() {
  return {
    appearance: C.name,
    accent: C.secondary,
    text: C.text,
    textMuted: C.tertiary,
    bg: C.card,
    border: C.border,
    diffAdd: C.add,
    diffDel: C.del,
    codeText: C.codeText,
    codeWash: C.codeWash,
    metrics: nativeMetrics(getZoom()),
  }
}

/** Native text (markdown, code, diff) ignores `style` sizes, so zoom scales its metrics directly. */
export function nativeMetrics(z: number) {
  const s = (n: number) => Math.round(n * z * 100) / 100
  return {
    mdTextSize: s(14.5),
    mdLineHeight: s(23),
    mdBlockGap: s(12),
    mdHeadingSizes: [20, 17, 15.5, 14.5].map(s),
    mdHeadingLineHeights: [28, 25, 23, 23].map(s),
    mdTableCellPadding: s(8),
    mdInlineCodeRadius: s(4),
    mdCodePaddingX: s(14),
    mdCodePaddingY: s(12),
    mdCodeRadius: s(10),
    mdCodeHeaderPaddingY: s(8),
    mdCodeHeaderTextSize: s(12),
    codeTextSize: s(13),
    codeLineHeight: s(20),
    diffTextSize: s(12.5),
    diffLineHeight: s(20),
  }
}
