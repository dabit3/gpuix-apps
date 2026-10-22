// Headless GPU screenshot of the UI: bun tools/shot.tsx out.png [w] [h] [state]
// state: main | palette | menu | crop | text | xform | levels | picker | dialog
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot } from '@gpuix/react/testing'
import { Editor } from '../src/core/editor'
import { fitImage, readImageFile } from '../src/core/io'
import { App, keyHandlers } from '../src/ui/app'

const [out = '/tmp/pc.png', w = '1440', h = '880', state = 'main'] = process.argv.slice(2)
const W = Number(w)
const H = Number(h)
const ed = Editor.fromImage(fitImage(readImageFile(new URL('../samples/lake.jpg', import.meta.url).pathname), 1600), 'lake.jpg')
ed.duplicateLayer()
ed.applyFilter('gaussian', 14)
ed.setBlend('soft-light')
ed.setOpacity(0.6)
if (state === 'levels') ed.addAdjustment('levels')
else ed.addAdjustment('curves')
if (state === 'main') ed.selectEllipse({ x0: 500, y0: 300, x1: 1100, y1: 700 })
if (state === 'text' || state === 'xform') {
  ed.tool = 'text'
  ed.textSize = 120
  ed.fg = [255, 255, 255]
  ed.beginText(160, 260)
  for (const c of 'Lake Tahoe') ed.typeText(c)
  if (state === 'xform') {
    ed.commitText()
    ed.tool = 'move'
    ed.beginTransform()
    ed.setTransform({ rot: -0.12, sx: 1.2, sy: 1.2 })
  }
}
const noop = () => {}
const { render, renderer } = createTestRoot({ width: W, height: H, ...keyHandlers })
const draw = () => render(<App ed={ed} size={{ width: W, height: H }} actions={{ exportPng: noop, exportJpeg: noop, saveProject: noop }} fileLabel="lake.jpg · 1600×1071" />)
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 30))
    draw()
    renderer.flush()
  }
}
draw()
await settle()
const app = await connectTest(renderer)
if (state === 'palette') {
  renderer.simulateKeystrokes('ctrl-k')
  await settle()
  renderer.simulateKeystrokes('b l')
  await settle()
} else if (state === 'menu') {
  await app.getByTestId('menu-Image').click()
  await settle()
} else if (state === 'crop') {
  await app.getByTestId('tool-crop').click()
  await settle()
  const c = await app.getByTestId('canvas').bounds()
  renderer.nativeSimulateMouseDown(c.x + c.width * 0.22, c.y + c.height * 0.18, 0)
  renderer.nativeSimulateMouseMove(c.x + c.width * 0.7, c.y + c.height * 0.8, 0)
  renderer.nativeSimulateMouseUp(c.x + c.width * 0.7, c.y + c.height * 0.8, 0)
  await settle()
} else if (state === 'picker') {
  await app.getByTestId('fg-swatch').click()
  await settle()
} else if (state === 'dialog') {
  ed.select(1)
  await settle()
  await app.getByTestId('filter-gaussian').click()
  await settle()
}
await settle()
renderer.captureScreenshot(out)
console.log('wrote', out)
process.exit(0)
