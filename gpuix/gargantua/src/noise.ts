/** Small, fast deterministic noise (value noise with quintic fade) for the sky and disk textures. */
export function hash3(x: number, y: number, z: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
export function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz)
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf
  )
}
export function fbm(x: number, y: number, z: number, oct: number, gain = 0.5) {
  let s = 0, a = 0.5, n = 0
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; a *= gain; x *= 2.03; y *= 2.01; z *= 1.97 }
  return s / n
}
export function ridged(x: number, y: number, z: number, oct: number) {
  let s = 0, a = 0.5, n = 0
  for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(noise3(x, y, z) * 2 - 1); s += a * v * v; n += a; a *= 0.5; x *= 2.03; y *= 2.01; z *= 1.97 }
  return s / n
}
