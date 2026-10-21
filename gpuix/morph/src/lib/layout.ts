/** Geometry shared by the scene, the state components, and the cursor script (scene units, 1080-wide canvas). */
export interface Box { w: number; h: number; r: number }

export const BOX = {
  button: { w: 300, h: 96, r: 48 },
  loader: { w: 112, h: 112, r: 56 },
  check: { w: 112, h: 112, r: 56 },
  island: { w: 420, h: 84, r: 42 },
  player: { w: 580, h: 232, r: 40 },
  scrubber: { w: 600, h: 104, r: 52 },
  volume: { w: 520, h: 104, r: 52 },
  toggle: { w: 184, h: 104, r: 52 },
  tabs: { w: 560, h: 104, r: 52 },
  chart: { w: 640, h: 400, r: 36 },
  palette: { w: 640, h: 380, r: 28 },
} satisfies Record<string, Box>

export const SCRUB = { x0: 110, x1: 490 }
export const VOLUME = { x0: 88, x1: 432 }
export const TAB_W = 140

export const CHART = { x0: 40, x1: 600, y0: 160, y1: 360 }
export const CHART_DATA = [0.22, 0.34, 0.28, 0.5, 0.44, 0.62, 0.84, 0.7, 0.92]
export const CHART_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']
export const CHART_HOVER_INDEX = 7
export function chartPoint(i: number): [number, number] {
  const x = CHART.x0 + (i * (CHART.x1 - CHART.x0)) / (CHART_DATA.length - 1)
  const y = CHART.y1 - CHART_DATA[i]! * (CHART.y1 - CHART.y0)
  return [x, y]
}
const hp = chartPoint(CHART_HOVER_INDEX)
export const CHART_HOVER: readonly [number, number] = [hp[0] - BOX.chart.w / 2 + 4, hp[1] - BOX.chart.h / 2 + 6]

export const PALETTE_ITEMS = [
  { label: 'Export video', hint: '⌃E', icon: 'export' },
  { label: 'Expand all layers', hint: '', icon: 'layers' },
  { label: 'Open recent', hint: '⌃O', icon: 'clock' },
  { label: 'New composition', hint: '⌃N', icon: 'plus' },
  { label: 'Toggle theme', hint: '⌃T', icon: 'sun' },
] as const
export const PALETTE_INPUT_H = 76
export const PALETTE_ROW_H = 56
export const PALETTE_PAD = 12
