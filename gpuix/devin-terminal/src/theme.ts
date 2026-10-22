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
  userBubble: string
  sendBg: string
  sendFg: string
  chip: string
  chipText: string
  codeText: string
  codeWash: string
}

// Neutral grays from app.devin.ai; the canvas matches Ghostty's GitHub High Contrast themes so the app blends in.
export const DARK: Palette = {
  name: 'dark',
  canvas: '#0a0c10',
  sidebar: '#0a0c10',
  raised: '#14161a',
  card: '#111317',
  cardHead: '#171a1f',
  menu: '#1a1d22',
  hover: '#1b1e23',
  selected: '#22252b',
  border: '#24272d',
  borderStrong: '#33373e',
  text: '#ececec',
  secondary: '#c9cbcf',
  tertiary: '#9a9da3',
  ghost: '#73767c',
  accent: '#4c9dff',
  accentSoft: '#4c9dff22',
  blue: '#4c9dff',
  orange: '#f0883e',
  add: '#3fb950',
  del: '#f85149',
  userBubble: '#1b1e23',
  sendBg: '#ececec',
  sendFg: '#0a0c10',
  chip: '#22252b',
  chipText: '#c9cbcf',
  codeText: '#e6e6e6',
  codeWash: '#ffffff12',
}

export const LIGHT: Palette = {
  name: 'light',
  canvas: '#ffffff',
  sidebar: '#ffffff',
  raised: '#ffffff',
  card: '#ffffff',
  cardHead: '#f7f7f8',
  menu: '#ffffff',
  hover: '#f5f5f7',
  selected: '#ededf0',
  border: '#e8e8eb',
  borderStrong: '#d9d9de',
  text: '#1a1a1a',
  secondary: '#3a3a3c',
  tertiary: '#5c5c61',
  ghost: '#6c6c71',
  accent: '#2f6fde',
  accentSoft: '#2f6fde18',
  blue: '#2f6fde',
  orange: '#e8833a',
  add: '#1a7f37',
  del: '#cf222e',
  userBubble: '#f5f5f7',
  sendBg: '#1a1a1a',
  sendFg: '#ffffff',
  chip: '#efeff0',
  chipText: '#3a3a3c',
  codeText: '#1a1a1a',
  codeWash: '#0000000a',
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
