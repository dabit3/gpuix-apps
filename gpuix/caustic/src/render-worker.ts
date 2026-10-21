import { renderRows, type Frame } from './render'

declare const self: Worker
self.onmessage = (e: MessageEvent<{ id: number; frame: Frame; out: SharedArrayBuffer; w: number; h: number; y0: number; y1: number }>) => {
  const { id, frame, out, w, h, y0, y1 } = e.data
  renderRows(frame, new Uint8Array(out, 0, w * h * 4), w, h, y0, y1)
  self.postMessage({ id })
}
