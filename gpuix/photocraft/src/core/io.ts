import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

export interface RGBAImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8

export function decodeImage(bytes: Uint8Array): RGBAImage {
  if (isPng(bytes)) {
    const png = PNG.sync.read(Buffer.from(bytes))
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) }
  }
  if (isJpeg(bytes)) {
    const j = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
    return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer, j.data.byteOffset, j.data.length) }
  }
  throw new Error('not a PNG or JPEG')
}

/** PNG and JPEG decode in-process; anything else macOS can read (HEIC, WebP, TIFF, GIF…) goes through `sips` first. */
export function readImageFile(path: string): RGBAImage {
  const bytes = readFileSync(path)
  if (isPng(bytes) || isJpeg(bytes)) return decodeImage(bytes)
  if (process.platform !== 'darwin') throw new Error(`${extname(path) || 'this format'} needs macOS sips; use PNG or JPEG`)
  const dir = mkdtempSync(join(tmpdir(), 'photocraft-'))
  try {
    const out = join(dir, 'in.png')
    execFileSync('sips', ['-s', 'format', 'png', path, '--out', out], { stdio: 'ignore' })
    return decodeImage(readFileSync(out))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function encodePng(img: RGBAImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height })
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length)
  return PNG.sync.write(png, { colorType: 6 })
}

export function encodeJpeg(img: RGBAImage, quality = 92): Buffer {
  // JPEG has no alpha: flatten over white.
  const d = new Uint8Array(img.data.length)
  for (let i = 0; i < d.length; i += 4) {
    const a = img.data[i + 3]! / 255
    d[i] = img.data[i]! * a + 255 * (1 - a)
    d[i + 1] = img.data[i + 1]! * a + 255 * (1 - a)
    d[i + 2] = img.data[i + 2]! * a + 255 * (1 - a)
    d[i + 3] = 255
  }
  return jpeg.encode({ data: d, width: img.width, height: img.height }, quality).data as Buffer
}

export function writeImageFile(path: string, img: RGBAImage) {
  const ext = extname(path).toLowerCase()
  writeFileSync(path, ext === '.jpg' || ext === '.jpeg' ? encodeJpeg(img) : encodePng(img))
}

/** Box-downscale so the long edge is at most `max` px. */
export function fitImage(img: RGBAImage, max: number): RGBAImage {
  const s = max / Math.max(img.width, img.height)
  if (s >= 1) return img
  const w = Math.max(1, Math.round(img.width * s))
  const h = Math.max(1, Math.round(img.height * s))
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y / s)
    const sy1 = Math.max(sy0 + 1, Math.min(img.height, Math.floor((y + 1) / s)))
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / s)
      const sx1 = Math.max(sx0 + 1, Math.min(img.width, Math.floor((x + 1) / s)))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let yy = sy0; yy < sy1; yy++) {
        for (let xx = sx0; xx < sx1; xx++) {
          const q = (yy * img.width + xx) * 4
          r += img.data[q]!
          g += img.data[q + 1]!
          b += img.data[q + 2]!
          a += img.data[q + 3]!
          n++
        }
      }
      const o = (y * w + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = a / n
    }
  }
  return { width: w, height: h, data: out }
}
