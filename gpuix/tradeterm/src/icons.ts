/** Monochrome 16×16 icons for GPUIX <svg source>; tinted with style.color. */
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const ICONS = {
  trend: svg('<path d="M3 12.5 13 3.5"/><circle cx="3" cy="12.5" r="1.4" fill="#000"/><circle cx="13" cy="3.5" r="1.4" fill="#000"/>'),
  hline: svg('<path d="M1.5 8h13"/><path d="M4 5.2h0M8 5.2h0M12 5.2h0" stroke-width="1"/>'),
  rect: svg('<rect x="2.5" y="4" width="11" height="8" rx="1.2"/>'),
  fib: svg('<path d="M2 3h12M2 6.2h12M2 8.6h12M2 11h12M2 13.5h12" stroke-width="1.1"/>'),
  search: svg('<circle cx="7" cy="7" r="4.4"/><path d="m10.4 10.4 3.4 3.4"/>'),
  sidebar: svg('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.8"/><path d="M10 3v10"/>'),
  chevron: svg('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>'),
  check: svg('<path d="m3.5 8.4 2.8 2.8 6.2-6.4"/>'),
  candles: svg('<path d="M5 2.5v11M11 2.5v11"/><rect x="3.4" y="5" width="3.2" height="5" rx=".6" fill="#000"/><rect x="9.4" y="4" width="3.2" height="6" rx=".6"/>'),
  grid: svg('<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>'),
  wave: svg('<path d="M1.5 9.5c1.5 0 2-5 3.5-5s2 7 3.5 7 2-4.5 3.5-4.5 1.5 2 2.5 2"/>'),
  enter: svg('<path d="M13 3.5v4.5a1.5 1.5 0 0 1-1.5 1.5H3.5"/><path d="m6 6.5-3 3 3 3"/>'),
  play: svg('<path d="M5 3.5v9l7-4.5z"/>'),
  key: svg('<rect x="1.8" y="4" width="12.4" height="8" rx="1.6"/><path d="M4.5 6.8h0M7 6.8h0M9.5 6.8h0M12 6.8h0M5 9.4h6" stroke-width="1.2"/>'),
}
export type IconName = keyof typeof ICONS
