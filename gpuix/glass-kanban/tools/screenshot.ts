// Launches the real app in the background and writes media/screenshot.png.
import { launch } from '@gpuix/react/automation'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] ?? 'media/screenshot.png'
const data = process.env.GLASS_KANBAN_DATA ?? join(mkdtempSync(join(tmpdir(), 'glass-kanban-')), 'board.json')
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', GLASS_KANBAN_DATA: data } })
try {
  await app.getByTestId('card-FIN-118').waitFor({ timeoutMs: 60_000 })
  if (process.env.OPEN_CARD) {
    await app.getByTestId(`card-${process.env.OPEN_CARD}`).click()
    await new Promise((r) => setTimeout(r, 600))
  }
  await new Promise((r) => setTimeout(r, 500))
  await app.screenshot({ path: out })
  console.log('wrote', out)
} finally {
  await app.close()
}
