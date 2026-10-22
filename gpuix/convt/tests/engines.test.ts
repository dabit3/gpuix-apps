// Integration: run every engine on generated fixtures and validate outputs with ffprobe / magic bytes.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectEngines, run } from '../src/engines'
import { plan, targetsFor, DEFAULTS } from '../src/formats'
import { sniff, type Kind } from '../src/sniff'

const { engines } = detectEngines()
const dir = mkdtempSync(join(tmpdir(), 'convt-int-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const ff = (args: string) => run(['ffmpeg', '-v', 'error', '-y', ...args.split(' ')])
const probe = async (p: string) => JSON.parse((await run(['ffprobe', '-v', 'error', '-of', 'json', '-show_streams', '-show_format', p])).stdout)

async function convert(path: string, kind: Kind, format: string, target: string, extra: Record<string, unknown> = {}) {
  const ext = targetsFor({ kind, format, hasAudio: true }, engines).find((t) => t.id === target)!.ext
  const out = join(dir, `${path.split('/').pop()}.${target}.${ext}`)
  const meta = kind === 'image' ? { width: 640, height: 400 } : kind === 'video' ? { width: 640, height: 360, duration: 2, hasAudio: true } : { duration: 2 }
  const p = plan({ path, kind, format, ...meta }, { ...DEFAULTS[kind], target, ...extra }, engines, out, dir)
  for (const s of p.steps) {
    const r = await run(s.cmd)
    if (r.code !== 0) throw new Error(`${s.cmd.join(' ')}\n${r.stderr}`)
  }
  expect(existsSync(out)).toBe(true)
  expect(statSync(out).size).toBeGreaterThan(0)
  return out
}

describe.skipIf(!engines.ffmpeg || !engines.ffprobe)('engines on fixtures', () => {
  const img = join(dir, 'in.png'), vid = join(dir, 'in.mp4'), wav = join(dir, 'in.wav')
  test('make fixtures', async () => {
    expect((await ff(`-f lavfi -i testsrc2=s=640x400 -frames:v 1 ${img}`)).code).toBe(0)
    expect((await ff(`-f lavfi -i testsrc2=s=640x360:r=30 -f lavfi -i sine=f=440 -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac ${vid}`)).code).toBe(0)
    expect((await ff(`-f lavfi -i sine=f=330 -t 2 ${wav}`)).code).toBe(0)
  })

  const images = targetsFor({ kind: 'image', format: 'png' }, engines).filter((t) => t.available)
  test.each(images.map((t) => t.id))('image png → %s', async (id) => {
    const out = await convert(img, 'image', 'png', id, { maxDim: 320 })
    const s = sniff(new Uint8Array(readFileSync(out).subarray(0, 4096)), out)
    const want = { jpg: 'jpeg', ico: 'ico', pdf: 'pdf', heic: 'heic', avif: 'avif' }[id as string] ?? id
    expect(s?.format).toBe(want)
    if (!['pdf', 'ico', 'heic', 'avif'].includes(id)) {
      const v = (await probe(out)).streams[0]
      expect(Math.max(v.width, v.height)).toBe(320)
    }
  }, 30000)

  const videos = targetsFor({ kind: 'video', format: 'mp4', hasAudio: true }, engines).filter((t) => t.available)
  test.each(videos.map((t) => t.id))('video mp4 → %s', async (id) => {
    const out = await convert(vid, 'video', 'mp4', id, { maxDim: 320 })
    const streams = (await probe(out)).streams as { codec_type: string; codec_name: string; width?: number }[]
    const isAudio = ['m4a', 'mp3'].includes(id)
    expect(streams.some((s) => s.codec_type === (isAudio ? 'audio' : 'video'))).toBe(true)
    if (!isAudio) expect(streams.find((s) => s.codec_type === 'video')!.width).toBe(320)
  }, 60000)

  const audio = targetsFor({ kind: 'audio', format: 'wav' }, engines).filter((t) => t.available)
  test.each(audio.map((t) => t.id))('audio wav → %s', async (id) => {
    const out = await convert(wav, 'audio', 'wav', id)
    const f = (await probe(out)).format
    expect(Number(f.duration)).toBeCloseTo(2, 0)
  }, 30000)

  test.skipIf(!engines.pandoc || !engines.typst)('markdown → pdf / html / docx', async () => {
    const md = join(dir, 'n.md')
    await Bun.write(md, '# Hello\n\nSome **bold** text.\n')
    for (const id of ['pdf', 'html', 'docx']) {
      const out = await convert(md, 'doc', 'md', id)
      const s = sniff(new Uint8Array(readFileSync(out).subarray(0, 4096)), out)
      expect(s?.format).toBe(id)
    }
  }, 60000)
})
