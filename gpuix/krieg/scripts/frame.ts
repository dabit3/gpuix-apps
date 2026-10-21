// Renders one frame of the game headlessly to a PPM (debug aid: `bun scripts/frame.ts out.ppm [seed] [turn]`).
import { writeFileSync } from 'node:fs'
import { boot } from '../src/boot'
import { Renderer } from '../src/engine/raycast'
import { scene } from '../src/game/scene'

const [out = '/tmp/frame.ppm', seed = '1337', turn = '0', steps = '0'] = process.argv.slice(2)
const b = boot(Number(seed))
b.world.p.angle += Number(turn)
for (let i = 0; i < Number(steps); i++) b.world.step(1 / 60, { fwd: 1, strafe: 0, turn: 0, look: 0, fire: i % 20 === 0, jump: false, crouch: false })
const r = new Renderer()
r.resize(480, 280)
const s = scene(b.world, b.sprites, 1)
const t0 = performance.now()
for (let i = 0; i < 20; i++) r.render(b.world.level, b.mats, s.cam, s.sprites, s.dyn, s.vm, s.tint)
console.log(`frame ${((performance.now() - t0) / 20).toFixed(2)} ms at ${r.W}x${r.H}`)
const rgb = Buffer.alloc(r.W * r.H * 3)
for (let i = 0; i < r.W * r.H; i++) { rgb[i * 3] = r.buf[i * 4 + 2]!; rgb[i * 3 + 1] = r.buf[i * 4 + 1]!; rgb[i * 3 + 2] = r.buf[i * 4]! }
writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${r.W} ${r.H} 255\n`), rgb]))
