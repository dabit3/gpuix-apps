import { describe, expect, test } from 'bun:test'
import { decodeBase64, imageSize, LatestFrame, RateMeter } from '../src/frame'

/** Minimal JPEG: SOI, an APP0 segment, then SOF0 with the given size. */
function jpegHeader(width: number, height: number) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9])
}

function pngHeader(width: number, height: number) {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const dv = new DataView(b.buffer)
  dv.setUint32(16, width)
  dv.setUint32(20, height)
  return b
}

describe('imageSize', () => {
  test('reads a JPEG SOF0 after other segments', () => {
    expect(imageSize(jpegHeader(1413, 738))).toEqual({ width: 1413, height: 738, format: 'jpeg' })
  })
  test('reads a PNG IHDR', () => {
    expect(imageSize(pngHeader(2826, 1476))).toEqual({ width: 2826, height: 1476, format: 'png' })
  })
  test('survives a round trip through base64 like a screencast frame', () => {
    const b64 = Buffer.from(jpegHeader(800, 600)).toString('base64')
    expect(imageSize(decodeBase64(b64))).toEqual({ width: 800, height: 600, format: 'jpeg' })
  })
  test('rejects garbage', () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull()
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull()
  })
})

describe('LatestFrame', () => {
  test('keeps only the newest frame and hands back the stale one', () => {
    const q = new LatestFrame<number>()
    expect(q.push(1)).toBeNull()
    expect(q.push(2)).toBe(1)
    expect(q.push(3)).toBe(2)
    expect(q.dropped).toBe(2)
    expect(q.take()).toBe(3)
    expect(q.take()).toBeNull()
    expect(q.painted).toBe(1)
    expect(q.hasPending).toBe(false)
  })
})

describe('RateMeter', () => {
  test('counts ticks in the last second', () => {
    const m = new RateMeter()
    for (let t = 0; t < 2000; t += 50) m.tick(t)
    expect(m.rate(1999)).toBe(20)
    expect(m.rate(5000)).toBe(0)
  })
})
