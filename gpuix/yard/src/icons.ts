import type { Kind } from './fs'
import { T } from './theme'

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`
const stroke = (d: string, w = 1.6) =>
  svg(`<path fill="none" stroke="#000" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`)

export const ICON = {
  dir: svg('<path fill="#000" d="M1.5 3.2A1.7 1.7 0 0 1 3.2 1.5h2.9c.45 0 .88.18 1.2.5L8.4 3.1h4.4a1.7 1.7 0 0 1 1.7 1.7v7.5a1.7 1.7 0 0 1-1.7 1.7H3.2a1.7 1.7 0 0 1-1.7-1.7z"/>'),
  image: svg('<path fill="#000" fill-rule="evenodd" d="M2.2 2.5h11.6c.66 0 1.2.54 1.2 1.2v8.6c0 .66-.54 1.2-1.2 1.2H2.2c-.66 0-1.2-.54-1.2-1.2V3.7c0-.66.54-1.2 1.2-1.2zM2.8 11.6h10.4L9.9 7.3 7.6 10.1 6.1 8.4zM5.4 7a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z"/>'),
  code: stroke('M5.2 4 1.6 8l3.6 4M10.8 4l3.6 4-3.6 4M9.1 2.6 6.9 13.4'),
  markdown: stroke('M6.2 2.5 4.9 13.5M11.1 2.5 9.8 13.5M2.6 6h11.2M2.2 10.2h11.2'),
  json: stroke('M5.5 2.5c-1.4 0-2 .7-2 2v1.5c0 .9-.5 1.5-1.5 2 1 .5 1.5 1.1 1.5 2v1.5c0 1.3.6 2 2 2M10.5 2.5c1.4 0 2 .7 2 2v1.5c0 .9.5 1.5 1.5 2-1 .5-1.5 1.1-1.5 2v1.5c0 1.3-.6 2-2 2'),
  text: stroke('M3 3.5h10M3 6.5h10M3 9.5h10M3 12.5h6'),
  archive: svg('<path fill="#000" fill-rule="evenodd" d="M2 2.5h12v3H2zM2.8 6.5h10.4v6.8c0 .66-.54 1.2-1.2 1.2H4c-.66 0-1.2-.54-1.2-1.2zM6 8.2h4v1.4H6z"/>'),
  other: svg('<path fill="#000" d="M4 1.2h5.2L13 5v9a1.3 1.3 0 0 1-1.3 1.3H4A1.3 1.3 0 0 1 2.7 14V2.5A1.3 1.3 0 0 1 4 1.2z"/>'),
  chevron: stroke('M6 3.5 10.5 8 6 12.5', 1.8),
  check: stroke('M3 8.5 6.5 12 13 4.5', 2),
  search: stroke('M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.8 10.8 14 14'),
  eye: stroke('M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 1.4),
  copy: stroke('M5.5 5.5V3a1 1 0 0 1 1-1H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-2.5M3 5.5h6.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z', 1.4),
  cut: stroke('M4.5 13.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11.5 13.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 10 12.5 2M10 10 3.5 2', 1.4),
  trash: stroke('M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4', 1.4),
  branch: stroke('M4.5 2.5v11M4.5 13.5a1.5 1.5 0 1 0 0-.01M11.5 6a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM11.5 6c0 3.5-7 2.5-7 6', 1.4),
  home: stroke('M2 7.5 8 2.5l6 5M3.8 6.2v7.3h8.4V6.2', 1.5),
} as const

export const KIND_COLOR: Record<Kind, string> = {
  dir: T.blue,
  image: T.muted,
  code: T.muted,
  markdown: T.muted,
  json: T.muted,
  text: T.muted,
  archive: T.muted,
  other: T.dim,
}
