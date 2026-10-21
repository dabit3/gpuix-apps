// Own monochrome tool icons (24×24, stroked), tinted by style.color.
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const ICONS = {
  move: svg('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  marquee: svg('<path d="M4 7V4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4"/>'),
  ellipse: svg('<path d="M12 4a8 8 0 0 1 3 .6M18.4 6.6A8 8 0 0 1 20 12M19.4 15.1a8 8 0 0 1-3.4 4.2M12.8 20a8 8 0 0 1-4.6-1M5.6 16.8A8 8 0 0 1 4 12M4.6 8.9A8 8 0 0 1 8.9 4.6"/>'),
  lasso: svg('<path d="M7 17c-2.5-1.3-4-3.2-4-5.5C3 7.4 7 4 12 4s9 3.4 9 7.5S17 19 12 19c-1 0-2-.1-2.9-.4"/><path d="M7 17a2 2 0 1 0 0 .1M7 19c0 1.5-1 2-2 2"/>'),
  wand: svg('<path d="M4 20l11-11M14 4v2M19 9h2M18 5l1.5-1.5M10 5l-1-1M19 13l1 1"/><path d="M13 8l3 3"/>'),
  brush: svg('<path d="M18.4 3.6a2 2 0 0 1 2.9 2.8L12 15.7 9.2 12.9z"/><path d="M9 13c-2.2 0-4 1.7-4 4 0 1.2-.8 2.4-2 3 3.6.6 8.2-.6 8.2-4.8z"/>'),
  eraser: svg('<path d="M8.5 20H20M4.7 15.3l9.6-9.6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H7.4z"/><path d="M9 11l5 5"/>'),
  fill: svg('<path d="M5 11l7-7 7.5 7.5-7 7a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8zM5 12h14"/><path d="M20.5 16s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z"/>'),
  gradient: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M8 4v16M13 4v16M17.5 4v16" stroke-dasharray="1 2.4"/>'),
  eyedropper: svg('<path d="M14.5 5.5l4 4M17 3l4 4-3 3-4-4zM14.5 7.5L5 17v2h2l9.5-9.5"/>'),
  hand: svg('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V12M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.6a6 6 0 0 1-4.6-2.2L4.3 14.6a1.6 1.6 0 0 1 2.4-2.1L8 14"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.2 6.7C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  mask: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="12" cy="12" r="4.2"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  export: svg('<path d="M12 15V3M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'),
  adjust: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17A8.5 8.5 0 0 0 12 3.5z" fill="#000"/>'),
  chevron: svg('<path d="M6 9l6 6 6-6"/>'),
}
