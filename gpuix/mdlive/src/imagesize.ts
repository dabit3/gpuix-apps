import { openSync, readSync, closeSync } from 'node:fs'

/** Natural pixel size of a local PNG / JPEG / GIF / WebP, read from its header. */
export function imageSize(path: string): { width: number; height: number } | null {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(64 * 1024)
    const n = readSync(fd, buf, 0, buf.length, 0)
    const b = buf.subarray(0, n)
    if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    if (b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const kind = b.toString('ascii', 12, 16)
      if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
      if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
      if (kind === 'VP8L') {
        const bits = b.readUInt32LE(21)
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
      }
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let o = 2
      while (o + 9 < b.length) {
        if (b[o] !== 0xff) return null
        const marker = b[o + 1]!
        const len = b.readUInt16BE(o + 2)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { width: b.readUInt16BE(o + 7), height: b.readUInt16BE(o + 5) }
        o += 2 + len
      }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
