import { render } from '@gpuix/react'
import { App, keyBus } from './src/App'
import { defaultDataPath } from './src/store'

const background = process.env.GPUIX_BACKGROUND === '1'

render(<App dataPath={defaultDataPath()} />, {
  title: 'Glass Kanban',
  width: Number(process.env.GLASS_KANBAN_WIDTH ?? 1440),
  height: Number(process.env.GLASS_KANBAN_HEIGHT ?? 900),
  titlebarTransparent: true,
  windowBackground: 'blurred',
  trafficLightX: 18,
  trafficLightY: 18,
  focus: !background,
  debugFrameOverlay: process.env.GLASS_KANBAN_FPS === '1' ? 'full' : undefined,
  onKeyDown: (event) => {
    keyBus.handler?.(event)
  },
})
