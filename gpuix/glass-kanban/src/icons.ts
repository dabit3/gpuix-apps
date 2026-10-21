const bars = (n: number) =>
  `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">${[0, 1, 2]
    .filter((i) => i < n)
    .map((i) => `<rect x="${1.5 + i * 5}" y="${10 - i * 3.5}" width="3" height="${4.5 + i * 3.5}" rx="1" fill="#000"/>`)
    .join('')}</svg>`

export const ICONS = {
  barsAll: bars(3),
  bars3: bars(3),
  bars2: bars(2),
  bars1: bars(1),
  urgent:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill="#000" fill-rule="evenodd" d="M4 1.5h8A2.5 2.5 0 0 1 14.5 4v8a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 12V4A2.5 2.5 0 0 1 4 1.5Zm3.1 3h1.8l-.25 4.7h-1.3L7.1 4.5Zm.9 5.6a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>',
  none:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="7.25" width="3" height="1.5" rx=".75" fill="#000"/><rect x="6.5" y="7.25" width="3" height="1.5" rx=".75" fill="#000"/><rect x="11.5" y="7.25" width="3" height="1.5" rx=".75" fill="#000"/></svg>',
  search:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="4.75" fill="none" stroke="#000" stroke-width="1.5"/><path d="m10.5 10.5 3.5 3.5" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>',
  plus:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 3v10M3 8h10" stroke="#000" stroke-width="1.6" stroke-linecap="round"/></svg>',
  comment:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" fill="none" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  close:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="m4 4 8 8M12 4l-8 8" stroke="#000" stroke-width="1.6" stroke-linecap="round"/></svg>',
  chevron:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="m4.5 6 3.5 3.5L11.5 6" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  grip:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><g fill="#000"><circle cx="6" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/></g></svg>',
  undo:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.5 2.5 6.5l3 3M3 6.5h6.5a4 4 0 0 1 0 8H7" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  filter:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 4h11M4.5 8h7M6.5 12h3" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>',
  cmd:
    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M6 6V4.5A1.5 1.5 0 1 0 4.5 6H6Zm0 0h4M6 6v4m4-4V4.5A1.5 1.5 0 1 1 11.5 6H10Zm0 0v4m0 0h1.5A1.5 1.5 0 1 1 10 11.5V10Zm0 0H6m0 0v1.5A1.5 1.5 0 1 1 4.5 10H6Z" fill="none" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>',
}
