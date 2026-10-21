#!/usr/bin/env bun
// Builds the demo library from Creative Commons (Blender Foundation) and public-domain films.
// Everything is downloaded from the official Blender mirror or the Internet Archive; nothing is re-hosted here.
// usage: bun scripts/fetch-library.ts [dir]   (default ~/Movies/Couch)
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

interface Entry {
  path: string
  url: string
  info?: Record<string, unknown>
}

const BL = 'https://download.blender.org'
const IA = (id: string, file: string) => `https://archive.org/download/${id}/${encodeURIComponent(file)}`
const CCBY3 = 'CC BY 3.0 · Blender Foundation'
const CCBY4 = 'CC BY 4.0 · Blender Foundation'
const PD = 'Public domain'

export const CATALOG: Entry[] = [
  {
    path: 'Movies/Sintel (2010)/Sintel (2010) - Trailer.mp4',
    url: `${BL}/durian/trailer/sintel_trailer-720p.mp4`,
    info: { title: 'Sintel', year: 2010, genres: ['Fantasy', 'Animation'], studio: 'Blender Institute', director: 'Colin Levy', cast: ['Halina Reijn', 'Thom Hoffman'], summary: 'A lonely young woman searches the frozen highlands for the baby dragon she raised and lost. The trailer for the Blender Foundation\'s third open movie.', license: CCBY3, posterAt: 14, backdropAt: 34, crop: '1216:544:32:88', rating: 'PG' },
  },
  {
    path: 'Movies/Big Buck Bunny (2008)/Big Buck Bunny (2008) - Trailer.mov',
    url: `${BL}/peach/trailer/trailer_720p.mov`,
    info: { title: 'Big Buck Bunny', year: 2008, genres: ['Comedy', 'Animation'], studio: 'Blender Institute', director: 'Sacha Goedegebure', cast: [], summary: 'A giant, gentle rabbit takes his revenge on three bullying rodents. The trailer for the Blender Foundation\'s second open movie.', license: CCBY3, posterAt: 20, backdropAt: 12, rating: 'G' },
  },
  {
    path: 'Movies/Tears of Steel (2012)/Tears of Steel (2012).mov',
    url: `${BL}/demo/movies/ToS/tears_of_steel_720p.mov`,
    info: { title: 'Tears of Steel', year: 2012, genres: ['Sci-Fi', 'Action'], studio: 'Blender Institute', director: 'Ian Hubert', cast: ['Derek de Lint', 'Sergio Hasselbaink', 'Rogier Schippers', 'Vanja Rukavina', 'Denise Rebergen'], summary: 'A group of warriors and scientists gather on the Oude Kerk in a future Amsterdam to stage a crucial event from the past, in a desperate attempt to rescue the world from destructive robots.', license: CCBY3, posterAt: 200, backdropAt: 415, rating: 'PG-13' },
  },
  {
    path: 'Movies/Elephants Dream (2006)/Elephants Dream (2006).mov',
    url: `${BL}/ED/elephantsdream-720-h264-st-aac.mov`,
    info: { title: 'Elephants Dream', year: 2006, genres: ['Sci-Fi', 'Animation'], studio: 'Orange Open Movie Project', director: 'Bassam Kurdali', cast: ['Tygo Gernandt', 'Cas Jansen'], summary: 'Two men explore the strange, ever-changing machine of the Machine. Emo follows Proog, who insists the world is his to show. The first open movie made with Blender.', license: 'CC BY 2.5 · Blender Foundation', posterAt: 120, backdropAt: 300, rating: 'PG' },
  },
  {
    path: 'Movies/Cosmos Laundromat (2015)/Cosmos Laundromat (2015).mp4',
    url: IA('CosmosLaundromatFirstCycle', 'Cosmos Laundromat - First Cycle (1080p).mp4'),
    info: { title: 'Cosmos Laundromat', year: 2015, genres: ['Comedy', 'Drama', 'Animation'], studio: 'Blender Institute', director: 'Mathieu Auvray', cast: ['Pierre Bokma', 'Reinout Scholten van Aschat'], summary: 'On a desolate island, a suicidal sheep named Franck meets his fate in a quirky salesman, who offers him the gift of a lifetime. First Cycle.', license: CCBY4, posterAt: 300, backdropAt: 460, rating: 'PG-13' },
  },
  {
    path: 'Movies/Spring (2019)/Spring (2019).mp4',
    url: IA('springopenmovie', 'springopenmovie.mp4'),
    info: { title: 'Spring', year: 2019, genres: ['Fantasy', 'Animation'], studio: 'Blender Animation Studio', director: 'Andy Goralczyk', cast: [], summary: 'A shepherd girl and her dog face ancient spirits in order to continue the cycle of life.', license: CCBY4, posterAt: 95, backdropAt: 200, rating: 'G' },
  },
  {
    path: 'Movies/Sherlock Jr. (1924)/Sherlock Jr. (1924).mp4',
    url: IA('sherlock-jr-1924-restored-720p-hd', 'sherlock jr-1924-restored-720p-hd.mp4'),
    info: { title: 'Sherlock Jr.', year: 1924, genres: ['Comedy', 'Silent'], studio: 'Buster Keaton Productions', director: 'Buster Keaton', cast: ['Buster Keaton', 'Kathryn McGuire', 'Joe Keaton', 'Ward Crane'], summary: 'A film projectionist who longs to be a detective falls asleep at work and dreams himself into the movie on the screen.', license: PD, posterAt: 1450, backdropAt: 1900, rating: 'NR' },
  },
  {
    path: 'Movies/A Trip to the Moon (1902)/A Trip to the Moon (1902).ogv',
    url: IA('ATripToTheMoon1902', 'A Trip to the Moon (1902).ogv'),
    info: { title: 'A Trip to the Moon', year: 1902, genres: ['Sci-Fi', 'Silent'], studio: 'Star Film', director: 'Georges Méliès', cast: ['Georges Méliès', 'Bleuette Bernon'], summary: 'A group of astronomers fire themselves at the Moon from a giant cannon, land in its eye, and escape the Selenites.', license: PD, posterAt: 260, backdropAt: 330, rating: 'NR' },
  },
  // Shows: Plex naming, Show/Season NN/Show - SxxEyy - Title.ext
  { path: 'Shows/Caminandes/show.json', url: '', info: { title: 'Caminandes', year: 2013, genres: ['Comedy', 'Animation'], studio: 'Blender Institute', director: 'Pablo Vazquez', cast: [], summary: 'Koro the llama takes on fences, roads, ice and one very persistent penguin in Patagonia.', license: CCBY3, posterAt: 60, backdropAt: 40, rating: 'G' } },
  { path: 'Shows/Caminandes/Season 01/Caminandes - S01E01 - Llama Drama.mp4', url: IA('Caminandes1LlamaDrama', '01_llama_drama_1080p.mp4') },
  { path: 'Shows/Caminandes/Season 01/Caminandes - S01E02 - Gran Dillama.mp4', url: IA('Caminandes2GranDillama', '02_gran_dillama_1080p.mp4') },
  { path: 'Shows/Caminandes/Season 01/Caminandes - S01E03 - Llamigos.webm', url: IA('CaminandesLlamigos', 'Caminandes_ Llamigos-1080p.webm') },
  { path: "Shows/Max Fleischer's Superman/show.json", url: '', info: { title: "Max Fleischer's Superman", year: 1941, genres: ['Action', 'Animation'], studio: 'Fleischer Studios', director: 'Dave Fleischer', cast: ['Bud Collyer', 'Joan Alexander'], summary: 'The Man of Steel takes on mad scientists, runaway trains and giant robots in the Technicolor cartoons that defined him.', license: PD, posterAt: 120, backdropAt: 300, rating: 'NR' } },
  { path: "Shows/Max Fleischer's Superman/Season 01/Max Fleischer's Superman - S01E01 - Superman.mp4", url: IA('max-fleischers-superman_202601', "Max Fleischer's Superman - Superman.ia.mp4") },
  { path: "Shows/Max Fleischer's Superman/Season 01/Max Fleischer's Superman - S01E02 - Billion Dollar Limited.mp4", url: IA('max-fleischers-superman_202601', "Max Fleischer's Superman - Billion Dollar Limited.mp4") },
  { path: "Shows/Max Fleischer's Superman/Season 01/Max Fleischer's Superman - S01E03 - Electric Earthquake.mp4", url: IA('max-fleischers-superman_202601', "Max Fleischer's Superman - Electric Earthquake.mp4") },
  { path: "Shows/Max Fleischer's Superman/Season 01/Max Fleischer's Superman - S01E04 - Bulleteers.mp4", url: IA('max-fleischers-superman_202601', "Max Fleischer's Superman - Bulleteers.ia.mp4") },
  { path: "Shows/Max Fleischer's Superman/Season 02/Max Fleischer's Superman - S02E01 - Showdown.mp4", url: IA('max-fleischers-superman_202601', "Max Fleischer's Superman - Showdown.ia.mp4") },
  { path: "Shows/Max Fleischer's Superman/Season 02/Max Fleischer's Superman - S02E02 - Jungle Drums.mp4", url: IA('max-fleischers-superman_202601', "Max Fleischer's Superman - Jungle Drums.ia.mp4") },
]

export async function fetchLibrary(root: string) {
  for (const e of CATALOG) {
    const dest = join(root, e.path)
    mkdirSync(dirname(dest), { recursive: true })
    if (!e.url) {
      writeFileSync(dest, JSON.stringify(e.info, null, 2) + '\n')
      continue
    }
    if (e.info) writeFileSync(join(dirname(dest), 'info.json'), JSON.stringify(e.info, null, 2) + '\n')
    if (existsSync(dest) && statSync(dest).size > 0 && !existsSync(dest + '.part')) {
      console.log(`have  ${e.path}`)
      continue
    }
    console.log(`fetch ${e.path}`)
    writeFileSync(dest + '.part', '')
    const p = Bun.spawnSync(['curl', '-fL', '--retry', '3', '-C', '-', '-s', '-o', dest, e.url], { stdio: ['ignore', 'inherit', 'inherit'] })
    if (p.exitCode !== 0) { console.error(`failed ${e.url}`); continue }
    Bun.spawnSync(['rm', '-f', dest + '.part'])
  }
  console.log(`library ready: ${root}`)
}

if (import.meta.main) await fetchLibrary(process.argv[2] ?? join(homedir(), 'Movies/Couch'))
