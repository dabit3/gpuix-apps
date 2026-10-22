// Paints a procedural landscape "photo" as a binary PPM on stdout (no third-party assets).
// usage: bun scripts/paint.ts <ridges|dunes> <width> <height> | ffmpeg -i - out.jpg
const [scene = 'ridges', W0 = '2400', H0 = '1600'] = process.argv.slice(2)
const W = Number(W0), H = Number(H0)
const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const smooth = (t: number) => t * t * (3 - 2 * t)
const noise = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
}
const fbm = (x: number, y: number, o = 6) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); a *= 0.5; f *= 2 } return s }
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * Math.max(0, Math.min(1, t)))
const out = new Uint8Array(W * H * 3)
const put = (i: number, c: number[]) => { out[i * 3] = c[0]!; out[i * 3 + 1] = c[1]!; out[i * 3 + 2] = c[2]! }

if (scene === 'ridges') {
  const sunX = 0.62 * W, sunY = 0.42 * H
  const layers = [
    { base: 0.50, amp: 0.10, freq: 2.2, col: [92, 104, 140] },
    { base: 0.58, amp: 0.11, freq: 3.1, col: [58, 66, 100] },
    { base: 0.67, amp: 0.10, freq: 4.3, col: [34, 40, 66] },
    { base: 0.77, amp: 0.08, freq: 6.0, col: [18, 22, 40] },
  ]
  const ridge = layers.map((L, li) => Float32Array.from({ length: W }, (_, x) => (L.base - L.amp * fbm(x / W * L.freq + li * 9.1, li * 3.7, 7)) * H))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H
    let c = t < 0.45 ? mix([28, 52, 112], [255, 150, 92], Math.pow(t / 0.45, 1.6)) : mix([255, 170, 110], [255, 205, 150], (t - 0.45) * 2)
    const d = Math.hypot(x - sunX, y - sunY)
    c = mix(c, [255, 236, 200], Math.exp(-d / (0.05 * W)) * 0.95 + Math.exp(-d / (0.2 * W)) * 0.25)
    c = mix(c, [255, 255, 240], d < 0.035 * W ? 1 : 0)
    c = mix(c, [255, 220, 200], (fbm(x / W * 5, y / H * 14, 5) - 0.45) * 0.5 * (t < 0.45 ? 1 : 0))
    for (let li = 0; li < layers.length; li++) {
      if (y > ridge[li]![x]!) {
        const L = layers[li]!, depth = (y - ridge[li]![x]!) / H
        c = mix(mix(L.col, [255, 170, 120], 0.35 - li * 0.08), L.col.map((v) => v * 0.6), depth * 6)
        c = c.map((v) => v * (0.9 + 0.2 * fbm(x / W * 40, y / H * 40, 4)))
      }
    }
    put(y * W + x, c)
  }
} else {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H
    const dune = Math.sin(u * 9 + fbm(u * 2, v * 3) * 6 + v * 4) * 0.5 + 0.5
    const sky = v < 0.3 + 0.05 * Math.sin(u * 5)
    let c = sky ? mix([60, 130, 210], [190, 220, 240], v / 0.35) : mix([238, 176, 112], [150, 84, 46], Math.pow(dune, 2.2))
    if (!sky) c = c.map((ch) => ch * (0.92 + 0.16 * fbm(u * 300, v * 300, 3)))
    put(y * W + x, c)
  }
}
process.stdout.write(Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), Buffer.from(out)]))
