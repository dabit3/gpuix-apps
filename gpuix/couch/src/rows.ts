import type { Item, Library } from './library/model.ts'
import type { ProfileState } from './state.ts'

export interface Row { key: string; title: string; shape: 'poster' | 'landscape'; ids: string[] }

const KIDS = new Set(['G', 'PG', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG'])

export function visibleTo(item: Item, kids: boolean): boolean {
  return !kids || KIDS.has(item.rating ?? '')
}

/** Continue Watching first (most recent stop), then Recently Added, Movies, Shows and genre shelves with 2+ titles. */
export function buildRows(lib: Library, prof: ProfileState | undefined, kids = false): Row[] {
  const ok = (id: string) => {
    const it = lib.items[id]
    if (!it) return false
    const top = it.showId ? lib.items[it.showId] : it
    return !!top && visibleTo(top, kids)
  }
  const rows: Row[] = []
  const resume = Object.entries(prof?.resume ?? {})
    .filter(([id]) => ok(id))
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id]) => id)
  if (resume.length) rows.push({ key: 'continue', title: 'Continue Watching', shape: 'landscape', ids: resume })
  const titles = [...lib.movies, ...lib.shows].filter(ok)
  const recent = [...titles].sort((a, b) => lib.items[b]!.addedAt - lib.items[a]!.addedAt).slice(0, 12)
  if (recent.length) rows.push({ key: 'recent', title: 'Recently Added', shape: 'poster', ids: recent })
  const movies = lib.movies.filter(ok)
  if (movies.length) rows.push({ key: 'movies', title: 'Movies', shape: 'poster', ids: movies })
  const shows = lib.shows.filter(ok)
  if (shows.length) rows.push({ key: 'shows', title: 'TV Shows', shape: 'poster', ids: shows })
  const genres = new Map<string, string[]>()
  for (const id of titles) for (const g of lib.items[id]!.genres) genres.set(g, [...(genres.get(g) ?? []), id])
  for (const [g, ids] of [...genres].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    if (ids.length >= 2) rows.push({ key: 'genre-' + g, title: g, shape: 'poster', ids })
  }
  return rows
}

/** Next episode to play for a show: the in-progress one, else the first unwatched, else the first. */
export function nextEpisode(lib: Library, show: Item, prof: ProfileState | undefined): string | undefined {
  const eps = show.episodes ?? []
  const inProgress = eps.filter((e) => prof?.resume[e]).sort((a, b) => prof!.resume[b]!.at - prof!.resume[a]!.at)[0]
  return inProgress ?? eps.find((e) => !prof?.watched[e]) ?? eps[0]
}

export function seasonsOf(lib: Library, show: Item): number[] {
  return [...new Set((show.episodes ?? []).map((e) => lib.items[e]!.season!))].sort((a, b) => a - b)
}

/** Clamp-and-move helper for a 2D grid laid out row-major. */
export function gridMove(idx: number, count: number, cols: number, dir: 'up' | 'down' | 'left' | 'right'): number {
  if (count <= 0) return 0
  const c = Math.max(1, cols)
  switch (dir) {
    case 'left': return idx % c === 0 ? idx : idx - 1
    case 'right': return idx % c === c - 1 || idx + 1 >= count ? idx : idx + 1
    case 'up': return idx - c >= 0 ? idx - c : idx
    case 'down': return idx + c < count ? idx + c : Math.floor(idx / c) < Math.floor((count - 1) / c) ? count - 1 : idx
  }
}
