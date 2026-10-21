import { render } from '@gpuix/react'
import { Controller } from './src/controller'
import { FirehoseApp, windowHandlers } from './src/app'

declare global {
  var __firehose: Controller | undefined
}

// Under `bun --hot` this file re-runs; keep the data across reloads.
const ctl = (globalThis.__firehose ??= new Controller())
const started = !ctl.running && ctl.store.count === 0
if (started) {
  const rate = Number(process.env.FIREHOSE_RATE ?? 10_000)
  if (Number.isFinite(rate) && rate > 0) ctl.rate = rate
  if (process.env.FIREHOSE_FILE) void ctl.loadFile(process.env.FIREHOSE_FILE)
  else if (process.env.FIREHOSE_PAUSED !== '1') ctl.running = true
}
ctl.start()

render(<FirehoseApp ctl={ctl} />, {
  title: 'Firehose',
  width: Number(process.env.FIREHOSE_WIDTH ?? 1480),
  height: Number(process.env.FIREHOSE_HEIGHT ?? 920),
  minWidth: 1000,
  minHeight: 640,
  titlebarTransparent: true,
  trafficLightX: 18,
  trafficLightY: 18,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  debugFrameOverlay: process.env.FIREHOSE_OVERLAY === '1' ? 'minimal' : 'hidden',
  onKeyDown: (e) => windowHandlers.onKeyDown?.(e),
  onSelectionChange: (e) => windowHandlers.onSelectionChange?.(e),
})
