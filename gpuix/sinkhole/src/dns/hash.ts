// FNV-1a 64 over ASCII, kept to the low 40 bits (5 bytes per domain, as on the ESP32 flash layout).
// 16-bit limbs keep every intermediate below 2^53, so this runs on plain numbers instead of BigInt.

export const HASH_SPACE = 2 ** 40

export function hash40(s: string): number {
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2 // offset basis 0xcbf29ce484222325
  for (let i = 0; i < s.length; i++) {
    h0 ^= s.charCodeAt(i) & 0xff
    // prime 0x100000001b3 = 0x1b3 + 0x100 << 32
    const t0 = h0 * 0x1b3
    const t1 = h1 * 0x1b3 + Math.floor(t0 / 0x10000)
    const t2 = h2 * 0x1b3 + Math.floor(t1 / 0x10000) + h0 * 0x100
    const t3 = h3 * 0x1b3 + Math.floor(t2 / 0x10000) + h1 * 0x100
    h0 = t0 & 0xffff; h1 = t1 & 0xffff; h2 = t2 & 0xffff; h3 = t3 & 0xffff
  }
  return (h2 & 0xff) * 0x100000000 + ((h1 << 16) >>> 0) + h0
}

/** Reference implementation with BigInt, for tests. */
export function hash40Big(s: string): number {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i) & 0xff)
    h = BigInt.asUintN(64, h * 0x100000001b3n)
  }
  return Number(h & 0xffffffffffn)
}

/** Expected wrong blocks per lookup and the chance of any collision inside the list (birthday bound). */
export function collisionMath(n: number) {
  return {
    perLookup: n / HASH_SPACE,
    anyInList: 1 - Math.exp(-(n * (n - 1)) / (2 * HASH_SPACE)),
  }
}
