import { render } from '@gpuix/react'
import { HEIGHT, Launcher, WIDTH, type Deps } from './src/Launcher'
import { Store } from './src/store'
import * as sys from './src/system'

const t0 = performance.now()
const [apps, dark, ...icons] = await Promise.all([
  sys.scanApps(),
  sys.isDarkMode(),
  sys.genericIcon('GenericFolderIcon'),
  sys.genericIcon('GenericDocumentIcon'),
  sys.genericIcon('ClippingText'),
])
const [folder, doc, text] = icons
const deps: Deps = {
  apps,
  initialDark: dark,
  fileIcons: { folder, doc, text, code: text, pdf: doc, image: doc },
  store: new Store(),
  sys: { ...sys, commands: sys.systemCommands },
  onClose: () => process.exit(0),
}
console.log(`[spotlight] indexed ${apps.length} apps in ${Math.round(performance.now() - t0)} ms`)

render(<Launcher deps={deps} />, {
  title: 'Spotlight',
  width: WIDTH,
  height: HEIGHT,
  resizable: false,
  titlebarTransparent: true,
  windowBackground: 'blurred',
  trafficLightX: -100,
  trafficLightY: -100,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  debugFrameOverlay: process.env.SPOTLIGHT_FRAME_OVERLAY === '1' ? 'full' : 'hidden',
})
