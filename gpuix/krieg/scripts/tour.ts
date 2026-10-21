// Debug aid: renders one frame per room, standing at the room centre and facing the nearest enemy
// (`bun scripts/tour.ts /tmp/tour [seed]` writes room-<i>.ppm files).
import { writeFileSync } from 'node:fs'
import { boot } from '../src/boot'
import { Renderer } from '../src/engine/raycast'
import { scene } from '../src/game/scene'

const [dir = '/tmp/tour', seed = '1337'] = process.argv.slice(2)
const b = boot(Number(seed)), w = b.world, r = new Renderer()
r.resize(480, 280)
w.level.rooms.forEach((rm, i) => {
  w.p.x = (rm.x0 + rm.x1 + 1) / 2; w.p.y = (rm.y0 + rm.y1 + 1) / 2
  const e = w.enemies.filter((e) => e.room === i)[0]
  w.p.angle = e ? Math.atan2(e.y - w.p.y, e.x - w.p.x) : i
  const s = scene(w, b.sprites, i)
  r.render(w.level, b.mats, s.cam, s.sprites, s.dyn, s.vm, null)
  const rgb = Buffer.alloc(r.W * r.H * 3)
  for (let k = 0; k < r.W * r.H; k++) { rgb[k * 3] = r.buf[k * 4 + 2]!; rgb[k * 3 + 1] = r.buf[k * 4 + 1]!; rgb[k * 3 + 2] = r.buf[k * 4]! }
  writeFileSync(`${dir}/room-${String(i).padStart(2, '0')}.ppm`, Buffer.concat([Buffer.from(`P6 ${r.W} ${r.H} 255\n`), rgb]))
  console.log(i, rm.kind, w.enemies.filter((e) => e.room === i).map((e) => e.kind).join(','))
})
