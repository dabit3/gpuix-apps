import { render } from '@gpuix/react'
import { App } from './src/App'

const board = process.env.BOARD ?? process.argv[2]

render(<App initialBoard={board} />, {
  title: 'Canvas',
  width: Number(process.env.WIN_W ?? 1440),
  height: Number(process.env.WIN_H ?? 900),
  minWidth: 900,
  minHeight: 600,
  titlebarTransparent: true,
  trafficLightX: 16,
  trafficLightY: 20,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  debugFrameOverlay: process.env.GPUIX_DEBUG === '1' ? 'full' : 'hidden',
})
