import { describe, expect, it } from 'bun:test'
import { LineParser, parseNumber } from '../src/parse'
import { Raster } from '../src/raster'
import { Store, formatValue, niceTicks, stats } from '../src/series'

const fields = (p: ReturnType<LineParser['push']>) => (p.kind === 'data' ? Object.fromEntries(p.fields.map((f) => [f.name, [f.value, f.unit]])) : p.kind)

describe('LineParser', () => {
  it('reads key=value pairs with units from ping, and skips the summary line', () => {
    const p = new LineParser()
    expect(fields(p.push('PING 1.1.1.1 (1.1.1.1): 56 data bytes'))).toBe('text')
    expect(fields(p.push('64 bytes from 1.1.1.1: icmp_seq=3 ttl=55 time=7.121 ms'))).toEqual({ icmp_seq: [3, undefined], ttl: [55, undefined], time: [7.121, 'ms'] })
    expect(fields(p.push('round-trip min/avg/max/stddev = 6.8/7.1/7.6/0.3 ms'))).not.toBeObject()
    expect(fields(p.push('Request timeout for icmp_seq 9'))).toBe('text')
  })

  it('names positional columns from the latest header row of the same width (iostat)', () => {
    const p = new LineParser()
    p.push('              disk0       cpu    load average')
    expect(p.push('    KB/t  tps  MB/s  us sy id   1m   5m   15m').kind).toBe('header')
    expect(fields(p.push('   21.40 1741 36.38  10 33 58  10.80 10.66 4.91'))).toMatchObject({ tps: [1741, undefined], us: [10, undefined], sy: [33, undefined], '15m': [4.91, undefined] })
  })

  it('handles vm_stat headers that start with digits and pty control noise', () => {
    const p = new LineParser()
    p.push('^D\b\bMach Virtual Memory Statistics: (page size of 16384 bytes)')
    p.push('    free   active   0fill')
    expect(fields(p.push('  211593   383250   1121200\r'))).toEqual({ free: [211593, undefined], active: [383250, undefined], '0fill': [1121200, undefined] })
  })

  it('reads CSV with a time column as the x axis and units from column names', () => {
    const p = new LineParser('csv')
    expect(p.push('time,requests,p95_ms,errors_pct').kind).toBe('header')
    const row = p.push('1792617000.250,431,64.2,0.41')
    expect(row).toEqual({ kind: 'data', x: 1792617000.25, fields: [{ name: 'requests', value: 431, unit: undefined }, { name: 'p95_ms', value: 64.2, unit: 'ms' }, { name: 'errors_pct', value: 0.41, unit: '%' }] })
  })

  it('scales K/M/G suffixes and keeps % and time units', () => {
    expect(parseNumber('1.5K')).toEqual({ value: 1500 })
    expect(parseNumber('40%')).toEqual({ value: 40, unit: '%' })
    expect(parseNumber('12ms')).toEqual({ value: 12, unit: 'ms' })
    expect(parseNumber('abc')).toBeNull()
  })
})

describe('Store', () => {
  it('auto-hides constant and counter columns once they settle', () => {
    const s = new Store()
    for (let i = 0; i < 5; i++) s.add([{ name: 'seq', value: i }, { name: 'ttl', value: 55 }, { name: 'time', value: 7 + (i % 3) * 0.4 }], i)
    expect(s.series.map((x) => [x.name, x.visible])).toEqual([['seq', false], ['ttl', false], ['time', true]])
    s.toggle(1)
    s.add([{ name: 'ttl', value: 55 }], 6)
    expect(s.get('ttl')!.visible).toBe(true)
  })

  it('computes min/max/avg/p95 over a visible x range', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i)
    const st = stats({ xs, ys: xs.map((x) => x + 1) }, 0, 99)!
    expect(st).toEqual({ n: 100, min: 1, max: 100, avg: 50.5, p95: 95, last: 100 })
    expect(stats({ xs, ys: xs }, 10, 19)!.n).toBe(10)
  })

  it('formats ticks and values', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
    expect(formatValue(7.1234, 'ms')).toBe('7.1 ms')
    expect(formatValue(2_500_000)).toBe('2.5M')
    expect(formatValue(1536, 'B')).toBe('1.5 KB')
  })
})

describe('Raster', () => {
  it('paints an anti-aliased line in the series colour over the theme background', () => {
    const r = new Raster()
    r.resize(200, 100)
    r.draw({ x0: 0, x1: 10, y0: 0, y1: 10, mode: 'line', series: [{ xs: [0, 10], ys: [5, 5], rgb: [113, 183, 255] }], yTicks: [], xTicks: [], bg: [10, 12, 16], grid: [0, 0, 0], gridHi: [0, 0, 0] })
    const px = (x: number, y: number) => Array.from(r.buf.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 4))
    expect(px(100, 50)).toEqual([255, 183, 113, 255]) // BGRA, on the line
    expect(px(100, 10)).toEqual([16, 12, 10, 255]) // background
  })
})

describe('PNG export', () => {
  it('composes the chart with a title, legend and axis labels drawn in the bitmap font', async () => {
    const { composeExport } = await import('../src/export')
    const r = new Raster()
    r.resize(300, 120)
    r.draw({ x0: 0, x1: 10, y0: 0, y1: 10, mode: 'line', series: [{ xs: [0, 10], ys: [2, 8], rgb: [38, 205, 77] }], yTicks: [5], xTicks: [5], bg: [10, 12, 16], grid: [22, 26, 33], gridHi: [38, 44, 54] })
    const out = composeExport(r, { title: 'ping 1.1.1.1', subtitle: '12:00:00 - 12:01:00', series: [{ name: 'time', color: '#26cd4d', summary: 'min 6.0 ms' }], yLabels: [{ py: 60, label: '5 ms' }], xLabels: [{ px: 150, label: '12:00:30' }] })
    expect(out.w).toBeGreaterThan(300)
    expect(out.h).toBeGreaterThan(120)
    const lit = (x0: number, y0: number, x1: number, y1: number) => {
      let n = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (out.buf[(y * out.w + x) * 4 + 2]! > 100) n++
      return n
    }
    expect(lit(28, 28, 100, 50)).toBeGreaterThan(40) // "PLOT" title
    expect(lit(0, out.h - 50, out.w, out.h)).toBeGreaterThan(20) // x-axis label
  })
})
