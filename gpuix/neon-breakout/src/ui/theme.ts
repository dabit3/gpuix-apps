import { COLORS, FIELD_H, FIELD_W } from '../sim/constants'

export const WIN_W = 1120
export const WIN_H = 760
export const FIELD_X = 24
export const FIELD_Y = 56
export const SIDE_X = FIELD_X + FIELD_W + 24
export const SIDE_W = WIN_W - SIDE_X - 24
export { COLORS, FIELD_H, FIELD_W }

export const INK = {
  bg: '#05070d',
  panel: '#0b111ccc',
  panelBorder: '#ffffff12',
  text: '#eaf6f5',
  dim: '#8b98a9',
  faint: '#56627a',
}

export type Shadow = { offsetX: number; offsetY: number; blurRadius: number; spreadRadius: number; color: string; inset?: boolean }

export function glow(color: string, blur = 14, alpha = '66', spread = 0): Shadow {
  return { offsetX: 0, offsetY: 0, blurRadius: blur, spreadRadius: spread, color: color + alpha }
}

// GPUI linear gradients take exactly two stops.
export function vgrad(top: string, bottom: string, angle = 180) {
  return { type: 'linear-gradient' as const, angle, stops: [{ color: top, position: 0 }, { color: bottom, position: 1 }] as [{ color: string; position: number }, { color: string; position: number }] }
}

export function hgrad(left: string, right: string) {
  return vgrad(left, right, 90)
}

/** Mix a #rrggbb colour toward white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number) {
  const n = parseInt(hex.slice(1, 7), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t)))
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('')
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export const ICONS = {
  heart: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M12 21.2 10.6 20C5.4 15.3 2 12.2 2 8.4 2 5.3 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.3 22 8.4c0 3.8-3.4 6.9-8.6 11.6z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M7 3h10v2h4v3a5 5 0 0 1-4.6 5A5 5 0 0 1 13 15.9V19h4v2H7v-2h4v-3.1A5 5 0 0 1 7.6 13 5 5 0 0 1 3 8V5h4zm0 4H5v1a3 3 0 0 0 2 2.8zm10 0v3.8A3 3 0 0 0 19 8V7z"/></svg>',
  sound: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M3 9h4l5-5v16l-5-5H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  mute: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M3 9h4l5-5v16l-5-5H3zm13.6-.6L18 7l2.6 2.6L23.2 7l1.4 1.4-2.6 2.6 2.6 2.6-1.4 1.4-2.6-2.6-2.6 2.6-1.4-1.4 2.6-2.6z"/></svg>',
}
