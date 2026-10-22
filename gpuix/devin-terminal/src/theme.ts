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
  chip: '#16263d',
  chipText: '#6cb0ff',
  codeText: '#e6e6e6',
  codeWash: '#ffffff12',
}

export const LIGHT: Palette = {
  name: 'light',
  canvas: '#ffffff',
  sidebar: '#ffffff',
  raised: '#ffffff',
  card: '#fbfbfb',
  cardHead: '#f6f6f7',
  menu: '#ffffff',
  hover: '#f4f4f5',
  selected: '#efeff0',
  border: '#ececee',
  borderStrong: '#dcdcdf',
  text: '#1a1a1a',
  secondary: '#3a3a3c',
  tertiary: '#6e6e73',
  ghost: '#8e8e93',
  accent: '#2f6fde',
  accentSoft: '#2f6fde18',
  blue: '#2f6fde',
  orange: '#e8833a',
  add: '#1a7f37',
  del: '#cf222e',
  userBubble: '#f4f4f5',
  sendBg: '#1a1a1a',
  sendFg: '#ffffff',
  chip: '#e8f0fe',
  chipText: '#2f6fde',
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
    accent: C.accent,
    text: C.text,
    textMuted: C.tertiary,
    bg: C.card,
    border: C.border,
    diffAdd: C.add,
    diffDel: C.del,
    codeText: C.codeText,
    codeWash: C.codeWash,
  }
}
