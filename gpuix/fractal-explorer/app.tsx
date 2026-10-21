import { render } from '@gpuix/react'
import { FractalApp } from './src/app'
import { Explorer } from './src/engine'

// Survive `bun --hot` reloads without spawning a new worker pool each save.
const g = globalThis as { __fractalExplorer?: Explorer }
const explorer = (g.__fractalExplorer ??= new Explorer())

render(<FractalApp explorer={explorer} saveDir={process.env.FRACTAL_SAVE_DIR} />, {
  title: 'Fractal Explorer',
  appName: 'Fractal Explorer',
  width: 1440,
  height: 900,
  minWidth: 900,
  minHeight: 600,
  titlebarTransparent: true,
  trafficLightX: 18,
  trafficLightY: 18,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  debugFrameOverlay: process.env.GPUIX_FRAME_OVERLAY === '1' ? 'full' : 'hidden',
})
