/** Hue channels for the phosphor buffer. Every pixel is (lum, hue). */
export const HUE_GREEN = 0, HUE_AMBER = 1, HUE_RED = 2, HUE_CYAN = 3
export const BG = [0x0a, 0x0c, 0x10] as const
const TINTS: [number, number, number][] = [
  [0x4a, 0xff, 0x8c],
  [0xf7, 0xc8, 0x43],
  [0xff, 0x6a, 0x5f],
  [0x71, 0xd7, 0xff],
]
/** LUT[hue*256+lum] = packed little-endian RGBA (as Uint32). */
export const LUT = new Uint32Array(4 * 256)
for (let h = 0; h < 4; h++) {
  const t = TINTS[h]!
  for (let l = 0; l < 256; l++) {
    const v = l / 255
    const k = Math.pow(v, 1.15)
    const hot = Math.max(0, v - 0.82) / 0.18 // highlights bloom toward white
    const r = BG[0] + (t[0] - BG[0]) * k + (255 - t[0]) * hot * 0.55
    const g = BG[1] + (t[1] - BG[1]) * k + (255 - t[1]) * hot * 0.55
    const b = BG[2] + (t[2] - BG[2]) * k + (255 - t[2]) * hot * 0.55
    LUT[h * 256 + l] = (255 << 24) | (Math.min(255, b | 0) << 16) | (Math.min(255, g | 0) << 8) | Math.min(255, r | 0)
  }
}
export function hex(hue: number, lum: number) {
  const c = LUT[hue * 256 + lum]!
  return '#' + [c & 255, (c >> 8) & 255, (c >> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join('')
}
