// Headless GPU screenshot of the UI at a given size: bun tools/shot.tsx out.png [w] [h]
import { createTestRoot } from '@gpuix/react/testing'
import { Editor } from '../src/core/editor'
import { fitImage, readImageFile } from '../src/core/io'
import { App } from '../src/ui/app'

const [out = '/tmp/pc.png', w = '1440', h = '880'] = process.argv.slice(2)
const W = Number(w)
const H = Number(h)
const ed = Editor.fromImage(fitImage(readImageFile(new URL('../samples/lake.jpg', import.meta.url).pathname), 1600), 'lake.jpg')
ed.duplicateLayer()
ed.applyFilter('gaussian', 14)
ed.setBlend('soft-light')
ed.setOpacity(0.6)
ed.addAdjustment('curves')
ed.selectEllipse({ x0: 500, y0: 300, x1: 1100, y1: 700 })
const noop = () => {}
const { render, renderer } = createTestRoot({ width: W, height: H })
const draw = () => render(<App ed={ed} size={{ width: W, height: H }} actions={{ exportPng: noop, exportJpeg: noop, saveProject: noop }} fileLabel="lake.jpg · 1600×1071" />)
draw()
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 30))
  renderer.flush()
}
renderer.captureScreenshot(out)
console.log('wrote', out)
process.exit(0)
