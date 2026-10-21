import { render } from '@gpuix/react'
import { SystemPulseApp } from './app.tsx'
import { createLiveSource } from './sampler.ts'

const source = createLiveSource({ intervalMs: 500 })

render(<SystemPulseApp source={source} />, {
  title: 'System Pulse',
  width: 1240,
  height: 860,
  titlebarTransparent: true,
  windowBackground: 'blurred',
  trafficLightX: 18,
  trafficLightY: 22,
  focus: process.env.GPUIX_BACKGROUND !== '1',
})
