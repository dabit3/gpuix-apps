import { alphaCrit, fillTable, type Table } from './geodesic'
import { fillSky } from './sky'
import { fillDisk } from './disk'
import { postRows, traceRows, type Frame } from './render'

/** Shared buffers of a lens table, posted with every job (SharedArrayBuffers are not copied). */
export interface TableBufs { na: number; r0: number; u: SharedArrayBuffer; end: SharedArrayBuffer; cap: SharedArrayBuffer; ex: SharedArrayBuffer; ey: SharedArrayBuffer }

export type Job =
  | { id: number; kind: 'sky'; sky: SharedArrayBuffer; y0: number; y1: number }
  | { id: number; kind: 'disk'; disk: SharedArrayBuffer; i0: number; i1: number }
  | { id: number; kind: 'table'; tb: TableBufs; i0: number; i1: number }
  | { id: number; kind: 'trace'; frame: Frame; tb: TableBufs; sky: SharedArrayBuffer; disk: SharedArrayBuffer; hdr: SharedArrayBuffer; w: number; h: number; y0: number; y1: number }
  | { id: number; kind: 'post'; hdr: SharedArrayBuffer; bloom: SharedArrayBuffer; bw: number; bh: number; out: SharedArrayBuffer; w: number; h: number; y0: number; y1: number; exposure: number; bloomGain: number; flash: number }

export function tableOf(tb: TableBufs): Table {
  return { na: tb.na, r0: tb.r0, ac: alphaCrit(tb.r0), u: new Float32Array(tb.u), end: new Float32Array(tb.end), cap: new Uint8Array(tb.cap), ex: new Float32Array(tb.ex), ey: new Float32Array(tb.ey) }
}

declare const self: Worker
self.onmessage = (e: MessageEvent<Job>) => {
  const j = e.data
  switch (j.kind) {
    case 'sky': fillSky(new Float32Array(j.sky), j.y0, j.y1); break
    case 'disk': fillDisk(new Float32Array(j.disk), j.i0, j.i1); break
    case 'table': fillTable(tableOf(j.tb), j.tb.r0, j.i0, j.i1); break
    case 'trace': traceRows(j.frame, { table: tableOf(j.tb), sky: new Float32Array(j.sky), disk: new Float32Array(j.disk) }, new Float32Array(j.hdr), j.w, j.h, j.y0, j.y1); break
    case 'post': postRows(new Float32Array(j.hdr), new Float32Array(j.bloom), j.bw, j.bh, new Uint8Array(j.out), j.w, j.h, j.y0, j.y1, j.exposure, j.bloomGain, j.flash); break
  }
  self.postMessage({ id: j.id })
}
