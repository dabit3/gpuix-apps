// Startup and watch-mode latency, measured through the GPUIX automation protocol.
// bun scripts/perf.ts
import { launch } from '@gpuix/react/automation'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const dir = mkdtempSync(join(tmpdir(), 'testdeck-perf-'))
cpSync(join(ROOT, 'sample'), dir, { recursive: true })
const pricing = join(dir, 'src/pricing.ts')
const good = readFileSync(pricing, 'utf8')

const t0 = performance.now()
const app = await launch({ command: 'bun', args: [join(ROOT, 'cli.tsx'), dir], env: { GPUIX_BACKGROUND: '1', TESTDECK_HOME: join(dir, '.cache') } })
const until = async (id: string, want: string) => {
  for (;;) {
    const t = await app.getByTestId(id).textContent().catch(() => '')
    if (t?.includes(want)) return performance.now()
    await Bun.sleep(10)
  }
}
try {
  const shell = await until('badge', '')
  const green = await until('count-pass', '67')
  const results: Record<string, number> = { firstPaintMs: shell - t0, firstGreenMs: green - t0 }
  for (let i = 0; i < 3; i++) {
    let s = performance.now()
    writeFileSync(pricing, good.replace('percent) / 100)', 'percent) / 1000)'))
    results[`saveToRed${i}`] = (await until('count-fail', '4')) - s
    s = performance.now()
    writeFileSync(pricing, good)
    results[`saveToGreen${i}`] = (await until('count-fail', '0')) - s
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Math.round(v)])), null, 2))
} finally {
  await app.close()
  writeFileSync(pricing, good)
}
