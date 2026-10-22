import { describe, expect, test } from 'bun:test'
import { sniff, extFormat } from '../src/sniff'
import { crfFor, fitDims, isConverted, outputPath, parseProgress, plan, targetsFor, DEFAULTS, type Engines } from '../src/formats'
import { computeLayout, delta, formatBytes, keyName } from '../src/layout'

const bytes = (...parts: (number[] | string)[]) => {
  const out: number[] = []
  for (const p of parts) typeof p === 'string' ? out.push(...[...p].map((c) => c.charCodeAt(0))) : out.push(...p)
  return new Uint8Array([...out, ...new Array(64).fill(0)])
}
const box = (brand: string) => bytes([0, 0, 0, 0x18], 'ftyp', brand, [0, 0, 0, 0], brand)
const ALL: Engines = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', sips: 'sips', cwebp: 'cwebp', textutil: 'textutil', pandoc: 'pandoc', typst: 'typst' }

describe('sniff by magic bytes', () => {
  test.each([
    [bytes([0x89], 'PNG\r\n', [0x1a, 0x0a]), 'png', 'image'],
    [bytes([0xff, 0xd8, 0xff, 0xe0]), 'jpeg', 'image'],
    [bytes('GIF89a'), 'gif', 'image'],
    [bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'webp', 'image'],
    [bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '), 'wav', 'audio'],
    [bytes('BM', [0, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0, 0x28]), 'bmp', 'image'],
    [bytes('%PDF-1.7'), 'pdf', 'pdf'],
    [box('heic'), 'heic', 'image'],
    [box('avif'), 'avif', 'image'],
    [box('qt  '), 'mov', 'video'],
    [box('isom'), 'mp4', 'video'],
    [box('M4A '), 'm4a', 'audio'],
    [bytes([0x1a, 0x45, 0xdf, 0xa3], 'webm'), 'webm', 'video'],
    [bytes('fLaC'), 'flac', 'audio'],
    [bytes('ID3', [4, 0, 0]), 'mp3', 'audio'],
  ])('%#: detects %s', (b, format, kind) => {
    expect(sniff(b)).toMatchObject({ format, kind })
  })

  test('the extension never overrides binary content', () => {
    expect(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]), 'photo.png')?.format).toBe('jpeg')
    expect(sniff(bytes([0x89], 'PNG\r\n', [0x1a, 0x0a]), 'no-extension')?.format).toBe('png')
  })

  test('text formats use the extension only as a hint; binary junk is rejected', () => {
    expect(sniff(new TextEncoder().encode('# Title\n\nSome *markdown*.'), 'notes.md')?.format).toBe('md')
    expect(sniff(new TextEncoder().encode('<!doctype html><html><body>hi</body></html>'), 'x')?.format).toBe('html')
    expect(sniff(new Uint8Array([0, 1, 2, 3, 0xfe, 0xff, 0, 0, 7, 9, 200, 13]), 'mystery.bin')).toBeNull()
    expect(extFormat('a/b/Photo.JPG')).toBe('jpeg')
  })
})

describe('conversion matrix', () => {
  const ids = (src: Parameters<typeof targetsFor>[0], e = ALL) => targetsFor(src, e).filter((t) => t.available).map((t) => t.id)
  test('only formats valid for the detected type, minus the source format', () => {
    expect(ids({ kind: 'image', format: 'jpeg' })).toEqual(['webp', 'avif', 'heic', 'png', 'tiff', 'gif', 'ico', 'pdf'])
    expect(ids({ kind: 'image', format: 'heic' })).toContain('jpg')
    expect(ids({ kind: 'audio', format: 'wav' })).toEqual(['mp3', 'm4a', 'opus', 'ogg', 'flac'])
    expect(ids({ kind: 'doc', format: 'md' })).toEqual(['pdf', 'docx', 'html', 'rtf', 'txt'])
    expect(ids({ kind: 'pdf', format: 'pdf' })).toEqual(['png', 'jpg', 'tiff'])
  })
  test('missing engines and silent videos dim targets with a reason', () => {
    const t = targetsFor({ kind: 'image', format: 'png' }, { ffmpeg: 'ffmpeg', sips: 'sips' }).find((x) => x.id === 'webp')!
    expect(t).toMatchObject({ available: false, reason: 'needs cwebp' })
    const v = targetsFor({ kind: 'video', format: 'mp4', hasAudio: false }, ALL).find((x) => x.id === 'mp3')!
    expect(v).toMatchObject({ available: false, reason: 'no audio track' })
  })
})

describe('output naming', () => {
  test('name.converted.ext beside the input, never an existing file', () => {
    const taken = new Set(['/p/a.converted.webp', '/p/a.converted-2.webp'])
    expect(outputPath('/p/a.jpg', 'webp', () => false)).toBe('/p/a.converted.webp')
    expect(outputPath('/p/a.jpg', 'webp', (p) => taken.has(p))).toBe('/p/a.converted-3.webp')
    expect(outputPath('/p/noext', 'png', () => false)).toBe('/p/noext.converted.png')
    expect(isConverted('/p/a.converted-2.webp')).toBe(true)
    expect(isConverted('/p/a.webp')).toBe(false)
  })
})

describe('command plans', () => {
  const cmds = (p: ReturnType<typeof plan>) => p.steps.map((s) => s.cmd.join(' '))
  test('JPEG to WebP with quality, resize and metadata strip', () => {
    const p = plan({ path: '/p/a.jpg', kind: 'image', format: 'jpeg', width: 4000, height: 2000 }, { ...DEFAULTS.image, quality: 55, maxDim: 2048 }, ALL, '/p/a.converted.webp', '/tmp')
    expect(cmds(p)).toEqual(['cwebp -quiet -q 55 -resize 2048 1024 -metadata none /p/a.jpg -o /p/a.converted.webp'])
  })
  test('HEIC goes through a sips PNG first when the encoder cannot read it', () => {
    const p = plan({ path: '/p/g.heic', kind: 'image', format: 'heic', width: 100, height: 100 }, { ...DEFAULTS.image, target: 'jpg' }, ALL, '/p/g.converted.jpg', '/tmp')
    expect(p.steps[0]!.cmd.slice(0, 4)).toEqual(['sips', '-s', 'format', 'png'])
    expect(p.temps).toHaveLength(1)
  })
  test('video uses -progress, CRF from quality, even-dimension scaling, and the hardware encoder when asked', () => {
    const src = { path: '/p/v.mov', kind: 'video' as const, format: 'mov', duration: 10, hasAudio: true }
    const sw = plan(src, { ...DEFAULTS.video, quality: 40 }, ALL, '/p/v.converted.mp4', '/tmp').steps[0]!
    expect(sw.progress).toBe(true)
    expect(sw.cmd).toContain('libx264')
    expect(sw.cmd).toContain(String(crfFor(40)))
    expect(sw.cmd.join(' ')).toContain('-progress pipe:1')
    expect(sw.cmd.join(' ')).toContain('trunc(iw/2)*2')
    const hw = plan(src, { ...DEFAULTS.video, hw: true }, ALL, '/p/v.converted.mp4', '/tmp').steps[0]!
    expect(hw.cmd).toContain('h264_videotoolbox')
    const gif = plan(src, { ...DEFAULTS.video, target: 'gif' }, ALL, '/p/v.converted.gif', '/tmp').steps[0]!.cmd.join(' ')
    expect(gif).toContain('palettegen')
  })
  test('documents: pandoc + typst for PDF, textutil for Word', () => {
    expect(cmds(plan({ path: '/p/n.md', kind: 'doc', format: 'md' }, DEFAULTS.doc, ALL, '/p/n.converted.pdf', '/tmp'))[0]).toStartWith('pandoc /p/n.md --pdf-engine=typst')
    expect(cmds(plan({ path: '/p/l.docx', kind: 'doc', format: 'docx' }, { ...DEFAULTS.doc, target: 'html' }, ALL, '/p/l.converted.html', '/tmp'))[0]).toBe('textutil -convert html /p/l.docx -output /p/l.converted.html')
  })
  test('no plan can reach the network: ffmpeg is pinned to file/pipe and no argument is a URL', () => {
    for (const [kind, format] of [['video', 'mp4'], ['audio', 'wav'], ['image', 'png']] as const) {
      for (const t of targetsFor({ kind, format }, ALL)) {
        const p = plan({ path: '/p/x', kind, format, width: 10, height: 10, duration: 1, hasAudio: true }, { ...DEFAULTS[kind], target: t.id }, ALL, '/p/out', '/tmp')
        for (const s of p.steps) {
          expect(s.cmd.some((a) => /^[a-z]+:\/\//i.test(a))).toBe(false)
          if (s.cmd[0] === 'ffmpeg') expect(s.cmd.join(' ')).toContain('-protocol_whitelist file,pipe')
        }
      }
    }
  })
  test('ffmpeg -progress parsing and helpers', () => {
    expect(parseProgress('frame=10\nout_time_us=2500000\nspeed=2.1x\nprogress=continue\n')).toEqual({ seconds: 2.5, end: false })
    expect(parseProgress('progress=end\n').end).toBe(true)
    expect(fitDims(4000, 3000, 1000)).toEqual([1000, 750])
    expect(fitDims(800, 600, 1000)).toEqual([800, 600])
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(delta(100, 38)).toBe('−62%')
  })
})

describe('layout and keys', () => {
  test('full window is three columns; a half split stacks; a thin pane drops the preview', () => {
    const full = computeLayout(1417, 840), half = computeLayout(705, 840), thin = computeLayout(480, 840)
    expect(full.kind).toBe('wide')
    expect(half.kind).toBe('split')
    expect(thin.kind).toBe('thin')
    expect(thin.showPreview).toBe(false)
    for (const L of [full, half]) {
      expect(L.previewW).toBeGreaterThan(200)
      if (L.kind === 'wide') expect(L.listW + L.previewW + L.settingsW + 64).toBeLessThanOrEqual(L.w)
      else expect(L.previewW + L.settingsW + 48).toBeLessThanOrEqual(L.w)
    }
  })
  test('terminal letters arrive as key "space" with the letter in keyChar', () => {
    expect(keyName({ key: 'space', keyChar: 'm' })).toBe('m')
    expect(keyName({ key: 'space', keyChar: ' ' })).toBe('space')
    expect(keyName({ key: 'enter', keyChar: '\r' })).toBe('enter')
    expect(keyName({ key: 'left' })).toBe('left')
  })
})
