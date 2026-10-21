import { writeFileSync } from 'node:fs'
import { buildMaterials, MATERIALS } from '../src/gen/materials'
const t0 = performance.now()
const tex = buildMaterials()
console.log(`built ${tex.length} textures in ${(performance.now() - t0).toFixed(0)} ms`)
const S = 128, cols = tex.length
const out = Buffer.alloc(S * cols * S * 3)
tex.forEach((t, k) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const p = t.px[y * S + x]!
    const o = (y * S * cols + k * S + x) * 3
    out[o] = (p >> 16) & 255; out[o + 1] = (p >> 8) & 255; out[o + 2] = p & 255
  }
})
writeFileSync('/tmp/tex.ppm', Buffer.concat([Buffer.from(`P6 ${S * cols} ${S} 255\n`), out]))
console.log(MATERIALS.map((m) => m.name).join(', '))
