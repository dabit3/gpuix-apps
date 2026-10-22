// Renders key states through the GPU test renderer to PNGs: bun tools/shots.tsx [outdir]
import { cpSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRoot } from '@gpuix/react/testing'
import { Yard } from '../src/Yard'

const out = process.argv[2] ?? '/tmp/yard-shots'
mkdirSync(out, { recursive: true })
const base = mkdtempSync(join(tmpdir(), 'yard-shots-'))
const root = join(base, 'sample')
cpSync(join(import.meta.dir, '..', 'sample'), root, { recursive: true })
process.env.YARD_STATE = join(base, 'state')
process.env.YARD_TRASH = join(base, 'Trash')
const t = createTestRoot({ width: 1440, height: 860 })
const r = t.renderer
const settle = async (ms = 400) => {
  for (let i = 0; i < 8; i++) {
    await Bun.sleep(ms / 8)
    r.flush()
  }
}
t.render(<Yard start={root} home={base} openFile={() => {}} />)
await settle(800)
const id = () => r.findByTestId('yard')!.id
r.focusElement(id())
const keys = async (k: string) => {
  r.nativeSimulateKeystrokes(id(), k)
  await settle()
}
const shot = async (name: string) => {
  await settle(1200)
  r.captureScreenshot(join(out, `${name}.png`))
}
await shot('01-root')
await keys('j j j l')
await shot('02-photos')
await keys('j')
await shot('03-photo2')
await keys('enter')
await shot('04-viewer')
await keys('escape h k k k l l j j')
await shot('05-code')
await keys('slash')
await shot('06-jump')
t.unmount?.()
process.exit(0)
