import { runOps, type Op, type Texture } from './texops'

// Every surface in the game, as op lists. Index = material id used by the level grid.
export const MATERIALS: { name: string; ops: Op[] }[] = [
  { name: 'metal floor', ops: [
    ['panel', 2, 0.04], ['noise', 8, 3, 3], ['level', 0.45, 0.85], ['blend', 0], ['dup'], ['emboss', 5],
    ['swap'], ['ramp', 0x1a2029, 0x3a4452, 0x5e6a7c], ['blend', 0], ['noise', 4, 3, 9], ['level', 0.3, 0.8], ['blend', 0],
  ] },
  { name: 'rusty wall', ops: [
    ['bricks', 4, 8, 0.06, 2], ['noise', 32, 2, 4], ['level', 0.2, 1], ['blend', 0], ['dup'], ['emboss', 4],
    ['swap'], ['cells', 20, 7, 0], ['noise', 6, 4, 5], ['warp', 0.3], ['ramp', 0xb4602a, 0x7a5040, 0x8c8c96],
    ['blend', 0], ['blend', 0],
  ] },
  { name: 'tech panel', ops: [
    ['panel', 4, 0.05], ['dup'], ['emboss', 6], ['swap'], ['ramp', 0x0d141c, 0x2b3a4a], ['blend', 0],
    ['cells', 6, 11, 0], ['level', 0.16, 0.08], ['ramp', 0x000000, 0x71b7ff], ['glow', 0.25], ['blend', 1],
  ] },
  { name: 'concrete', ops: [
    ['noise', 8, 5, 21], ['cells', 30, 22, 1], ['level', 0, 0.12], ['blend', 0], ['dup'], ['emboss', 3],
    ['swap'], ['ramp', 0x2a2c30, 0x4c5058, 0x6a6e76], ['blend', 0],
  ] },
  { name: 'door', ops: [
    ['grad', 1], ['noise', 4, 1, 40], ['warp', 0.02], ['level', 0, 1], ['panel', 1, 0.07], ['blend', 0], ['dup'], ['emboss', 5],
    ['swap'], ['ramp', 0x1e2632, 0x3a4658, 0x5a6678], ['blend', 0], ['band', 0, 0.5, 0.03], ['ramp', 0x000000, 0x39c5cf], ['glow', 0.3], ['blend', 1],
  ] },
  { name: 'key door', ops: [
    ['bricks', 1, 6, 0.08, 1], ['dup'], ['emboss', 5], ['swap'], ['ramp', 0x2a1c08, 0x6a4a10, 0xf0b72f],
    ['blend', 0], ['grad', 2], ['level', 0.82, 0.86], ['ramp', 0x000000, 0xf7c843], ['glow', 0.3], ['blend', 1],
  ] },
  { name: 'exit panel', ops: [
    ['panel', 8, 0.12], ['dup'], ['emboss', 4], ['swap'], ['ramp', 0x061a0c, 0x0e3a1c], ['blend', 0],
    ['noise', 24, 1, 50], ['level', 0.62, 0.7], ['ramp', 0x000000, 0x4ae168], ['glow', 0.25], ['blend', 1],
  ] },
  { name: 'ceiling', ops: [
    ['panel', 2, 0.03], ['noise', 12, 3, 61], ['level', 0.1, 1], ['blend', 0], ['dup'], ['emboss', 3], ['swap'],
    ['ramp', 0x08090c, 0x1a1e26], ['blend', 0], ['band', 1, 0.5, 0.04], ['ramp', 0x000000, 0xd9dee3], ['glow', 0.4], ['blend', 1],
  ] },
  { name: 'crate', ops: [
    ['panel', 1, 0.1], ['noise', 3, 4, 70], ['level', 0.2, 0.9], ['blend', 0], ['dup'], ['emboss', 4],
    ['swap'], ['ramp', 0x1a1408, 0x5a4626, 0x8a6a3a], ['blend', 0],
  ] },
  { name: 'enemy skin', ops: [
    ['cells', 40, 81, 1], ['noise', 16, 3, 82], ['blend', 0], ['dup'], ['emboss', 6], ['swap'],
    ['ramp', 0x1a0808, 0x5a1a1a, 0xc04848], ['blend', 0],
  ] },
  { name: 'pillar', ops: [
    ['grad', 1], ['noise', 2, 1, 90], ['warp', 0.03], ['level', 0, 1], ['bricks', 1, 4, 0.05, 3], ['blend', 0], ['dup'], ['emboss', 6],
    ['swap'], ['ramp', 0x1a2028, 0x56606e], ['blend', 0],
  ] },
]

export const M = { floor: 0, wall: 1, tech: 2, concrete: 3, door: 4, keyDoor: 5, exit: 6, ceil: 7, crate: 8, skin: 9, pillar: 10 } as const

export function buildMaterials(size = 128): Texture[] {
  return MATERIALS.map((m) => runOps(m.ops, size))
}
