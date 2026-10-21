import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A tiny Plex-style library on disk (files only need bytes; nothing decodes them in these tests). */
export function makeLibraryDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'couch-lib-'))
  process.env.COUCH_CACHE = join(root, '.cache')
  const file = (p: string, body = 'x') => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), body) }
  file('Movies/Sintel (2010)/Sintel (2010) - Trailer.mp4')
  file('Movies/Sintel (2010)/info.json', JSON.stringify({ title: 'Sintel', year: 2010, genres: ['Fantasy', 'Animation'], rating: 'PG', summary: 'A dragon story.' }))
  file('Movies/Tears of Steel (2012)/Tears of Steel (2012).mov')
  file('Movies/Tears of Steel (2012)/info.json', JSON.stringify({ title: 'Tears of Steel', year: 2012, genres: ['Sci-Fi'], rating: 'PG-13' }))
  file('Movies/Spring.2019.1080p.mp4')
  file('Shows/Caminandes/show.json', JSON.stringify({ title: 'Caminandes', year: 2013, genres: ['Comedy', 'Animation'], rating: 'G' }))
  file('Shows/Caminandes/Season 01/Caminandes - S01E02 - Gran Dillama.mp4')
  file('Shows/Caminandes/Season 01/Caminandes - S01E01 - Llama Drama.mp4')
  file('Shows/Caminandes/Season 02/Caminandes - S02E01 - Llamigos.webm')
  file('Shows/Caminandes/Season 01/notes.txt')
  file('Movies/Sintel (2010)/Sintel (2010) - Trailer.mp4.part')
  file('TV Library.tvlibrary/hidden.mp4')
  return root
}

export function fakeDecoder() {
  const calls: number[] = []
  const d = { pos: 0, rate: 24, spawns: 0, running: false, calls,
    start(at: number) { d.pos = at; d.running = true; d.spawns++; calls.push(at) },
    stop() { d.running = false } }
  return d
}
