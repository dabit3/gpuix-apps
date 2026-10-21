// Render a board JSON to PNG through the GPUIX Metal test renderer.
// usage: bun export.tsx board.json out.png [width] [height]
import { readFileSync } from 'node:fs'
import { createTestRoot } from '@gpuix/react/testing'
import { BoardView, TileCache, cull } from './src/board'
import { SpatialIndex, deserialize, unionRect } from './src/model'

const [input, output, wArg, hArg] = process.argv.slice(2)
if (!input || !output) {
  console.error('usage: bun export.tsx board.json out.png [width] [height]')
  process.exit(2)
}
const W = Number(wArg ?? 1600), H = Number(hArg ?? 1000)
const board = deserialize(readFileSync(input, 'utf8'))
const bounds = unionRect(board.shapes) ?? { x: 0, y: 0, w: W, h: H }
const pad = 60
const z = Math.min(2, (W - pad * 2) / Math.max(bounds.w, 1), (H - pad * 2) / Math.max(bounds.h, 1))
const cam = { x: bounds.x + bounds.w / 2 - W / 2 / z, y: bounds.y + bounds.h / 2 - H / 2 / z, z }
const index = new SpatialIndex(board.shapes)
const byId = new Map(board.shapes.map((s) => [s.id, s]))
const { render, renderer } = createTestRoot({ width: W, height: H })
render(<BoardView shapes={board.shapes} index={index} byId={byId} culled={cull(index, cam, W, H)} cam={cam} width={W} height={H} version={1} tiles={new TileCache()} />)
renderer.flush()
renderer.captureScreenshot(output)
console.log(`exported ${board.shapes.length} shapes -> ${output}`)
process.exit(0)
