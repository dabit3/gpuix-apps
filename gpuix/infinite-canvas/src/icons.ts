const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const ICONS = {
  select: svg('<path d="M5 3.5l13 7.2-5.6 1.4-2.6 5.4z" fill="#000"/>'),
  hand: svg('<path d="M8 12V6.5a1.5 1.5 0 013 0V11M11 10.5V5a1.5 1.5 0 013 0v5.5M14 10.5V6.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-.6a6 6 0 01-4.6-2.2L3.6 15a1.5 1.5 0 012.3-1.9L8 15"/>'),
  rect: svg('<rect x="4" y="5.5" width="16" height="13" rx="2.5"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'),
  arrow: svg('<path d="M5 19L19 5M10 5h9v9"/>'),
  pen: svg('<path d="M4 20c2-1 3-4 5-7s5-6 7-6 1 3-1 5-4 3-4 5 3 1 5 0"/>'),
  sticky: svg('<path d="M5 4h14v10l-5 6H5z"/><path d="M14 20v-6h5"/>'),
  text: svg('<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>'),
  image: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-4.5-4.5-9 8"/>'),
  stress: svg('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>'),
  open: svg('<path d="M3.5 7.5a2 2 0 012-2h4l2 2h7a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>'),
  save: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>'),
  export: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M12 15.5V9M9 11.5L12 8.5l3 3"/>'),
  undo: svg('<path d="M9 7L4.5 11.5 9 16M5 11.5h9a5 5 0 010 10h-2"/>'),
  redo: svg('<path d="M15 7l4.5 4.5L15 16M19 11.5h-9a5 5 0 000 10h2"/>'),
  minus: svg('<path d="M6 12h12"/>'),
  plus: svg('<path d="M12 6v12M6 12h12"/>'),
  fit: svg('<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15"/>'),
  front: svg('<rect x="8" y="8" width="12" height="12" rx="2" fill="#000"/><path d="M4 15V5.5A1.5 1.5 0 015.5 4H15"/>'),
  back: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 15V5.5A1.5 1.5 0 015.5 4H15" />'),
  duplicate: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H5.5A1.5 1.5 0 004 5.5V16"/>'),
  trash: svg('<path d="M4.5 7h15M10 4h4M6.5 7l1 12.5a1.5 1.5 0 001.5 1.4h6a1.5 1.5 0 001.5-1.4l1-12.5"/>'),
  clear: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
} as const

export type IconName = keyof typeof ICONS
