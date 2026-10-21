import { applyMacCpuThrottleFromEnv, render } from '@gpuix/react'
import { DevinApp, handleWindowKey } from './src/App'

// `bun app.tsx` runs inside the terminal (kitty graphics protocol, Ghostty/kitty).
// `bun app.tsx --window` opens the same React tree as a native macOS window.
const windowMode = process.argv.includes('--window') || process.env.GPUIX_WINDOW === '1'

applyMacCpuThrottleFromEnv()
render(<DevinApp />, {
  title: 'Devin',
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 600,
  titlebarTransparent: true,
  trafficLightX: 18,
  trafficLightY: 18,
  windowBackground: '#0b0c0e',
  terminal: !windowMode,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  onKeyDown: handleWindowKey,
  debugFrameOverlay: process.env.GPUIX_DEBUG_OVERLAY === '1' ? 'full' : undefined,
})
