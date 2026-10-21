/** 24-unit line icons, all 1.5 stroke, round caps (the brief's "consistent 1.5 px icon strokes"). */
const P: Record<string, string> = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  speaker: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6.5 9.5V19h11V9.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  library: '<path d="M5 4.5v15M9.5 4.5v15M14 5l4.5 14"/>',
  profile: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 19.5c1.4-3.6 4.2-5 7.5-5s6.1 1.4 7.5 5"/>',
  export: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/>',
  layers: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  prev: '<path d="M7 6v12M18 6.5L9.5 12l8.5 5.5z"/>',
  next: '<path d="M17 6v12M6 6.5l8.5 5.5L6 17.5z"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  restart: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.5V9h4.5"/>',
  sparkle: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4"/>',
}
const cache = new Map<string, string>()
export function icon(name: keyof typeof P | string, color: string, fill = false): string {
  const k = `${name}${color}${fill}`
  let s = cache.get(k)
  if (!s) {
    s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ? color : 'none'}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? ''}</svg>`
    cache.set(k, s)
  }
  return s
}
const ARROW = 'M6 3.5v19.2l5.1-4.6 3.3 7.4 3.4-1.5-3.3-7.3 6.9-.3z'
/** GPUIX tints an <svg> with its style color, so the cursor is two stacked layers: a fat outline and the fill. */
export const CURSOR_SVG = (layer: 'edge' | 'fill') =>
  layer === 'edge'
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><path d="${ARROW}" fill="#000" stroke="#000" stroke-width="3.2" stroke-linejoin="round"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><path d="${ARROW}" fill="#000"/></svg>`
