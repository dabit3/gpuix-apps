import { writeFileSync } from 'node:fs'
import { allocTable, fillTable } from '../src/geodesic'
import { fillSky, SKY_W, SKY_H } from '../src/sky'
import { fillDisk, DISK_NR, DISK_NA } from '../src/disk'
import { traceRows, postRows, downRows, blur, type Frame } from '../src/render'
import { encodePng } from '../src/png'

const [W, H] = [Number(process.argv[2] ?? 640), Number(process.argv[3] ?? 360)]
const r0 = Number(process.env.R0 ?? 26), pitch = Number(process.env.PITCH ?? 7) * Math.PI / 180
const lens = process.env.LENS !== '0', look = Number(process.env.LOOK ?? 0)
let t0 = performance.now()
const table = allocTable(1024); fillTable(table, r0)
const sky = new Float32Array(SKY_W * SKY_H * 3); fillSky(sky, 0, SKY_H)
const disk = new Float32Array(DISK_NR * DISK_NA); fillDisk(disk, 0, DISK_NR)
console.log('setup', (performance.now() - t0).toFixed(0))
const cam: [number, number, number] = [0, r0 * Math.sin(pitch), r0 * Math.cos(pitch)]
const fwd: [number, number, number] = [0, -Math.sin(pitch), -Math.cos(pitch)]
const up: [number, number, number] = [0, Math.cos(pitch), -Math.sin(pitch)]
const right: [number, number, number] = [1, 0, 0]
const tilt = Number(process.env.TILT ?? 0) * Math.PI / 180
const fr: Frame = { cam, fwd, right, up, tanY: Math.tan((Number(process.env.FOV ?? 40) / 2) * Math.PI / 180), aspect: W / H, r0, v: Number(process.env.V ?? 0), inside: Number(process.env.INSIDE ?? 0), lens, disk: true, look,
  n: [Math.sin(tilt), Math.cos(tilt), 0], d1: [Math.cos(tilt), -Math.sin(tilt), 0], d2: [0, 0, 1], t: 0, temp: Number(process.env.TEMP ?? 6500), gain: Number(process.env.GAIN ?? 3), opacity: 1.6, orders: 4, sky: 1, starGain: 1 }
const hdr = new Float32Array(W * H * 3)
t0 = performance.now(); traceRows(fr, { table, sky, disk }, hdr, W, H, 0, H); console.log('trace', (performance.now() - t0).toFixed(0))
const bw = Math.ceil(W / 4), bh = Math.ceil(H / 4)
const bl = new Float32Array(bw * bh * 3), tb = new Float32Array(bw * bh * 3)
downRows(hdr, W, H, bl, bw, bh, 0, bh, 0.8); blur(bl, tb, bw, bh, Math.max(4, Math.round(bw / 40)))
const out = new Uint8Array(W * H * 4)
postRows(hdr, bl, bw, bh, out, W, H, 0, H, Number(process.env.EXP ?? 1.4), 0.6, 0)
if (process.env.PROBE) for (const [x, y] of [[80, 200], [560, 200], [200, 190], [440, 190]]) console.log(x, y, Array.from(hdr.slice((y * W + x) * 3, (y * W + x) * 3 + 3)).map((v) => v.toFixed(3)).join(" "))
writeFileSync(process.env.OUT ?? '/tmp/still.png', encodePng(out, W, H))
