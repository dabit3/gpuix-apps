// Boot: generate every asset in code and time each stage (shown on the title card).
import { buildMaterials, M } from './gen/materials'
import { buildSprites, type SpriteSet } from './gen/sprites'
import type { Texture } from './gen/texops'
import { World } from './game/world'

export interface Boot { mats: Texture[]; sprites: SpriteSet; world: World; timings: { textures: number; level: number; sprites: number } }

export function boot(seed: number, texSize = 128): Boot {
  let t = performance.now()
  const mats = buildMaterials(texSize)
  const textures = performance.now() - t
  t = performance.now()
  const world = new World(seed)
  const level = performance.now() - t
  t = performance.now()
  const sprites = buildSprites(mats[M.skin]!, mats[M.wall]!)
  return { mats, sprites, world, timings: { textures, level, sprites: performance.now() - t } }
}
