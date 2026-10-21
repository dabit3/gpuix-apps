import { afterAll, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from '@gpuix/react/automation'

const ROOT = join(import.meta.dir, '..')
let app: Awaited<ReturnType<typeof launch>> | null = null
afterAll(async () => {
  await app?.close()
})

async function waitForText(testId: string, expected: string | RegExp, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let last = ''
  while (Date.now() < deadline) {
    last = (await app!.getByTestId(testId).textContent().catch((e: Error) => `<${e.message}>`)) ?? ''
    if (typeof expected === 'string' ? last === expected : expected.test(last)) return last
    await Bun.sleep(100)
  }
  throw new Error(`Expected ${testId} to be ${expected}, got ${last}`)
}

test('watch mode goes red on a broken function, shows the diff, and goes green on the fix', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'testdeck-app-'))
  cpSync(join(ROOT, 'sample'), dir, { recursive: true })
  const pricing = join(dir, 'src/pricing.ts')
  const good = readFileSync(pricing, 'utf8')
  process.env.TESTDECK_HOME = join(dir, '.cache')

  app = await launch({ command: 'bun', args: [join(ROOT, 'cli.tsx'), dir], env: { GPUIX_BACKGROUND: '1', TESTDECK_HOME: join(dir, '.cache') } })
  await waitForText('count-pass', '67')
  await waitForText('count-fail', '0')
  await waitForText('badge', '✓')

  writeFileSync(pricing, good.replace('percent) / 100)', 'percent) / 1000)'))
  await waitForText('count-fail', '4')
  await waitForText('badge', '✕')

  await app.getByTestId('filter-fail').click()
  await app.getByTestId('test-takes 10% off').click()
  await waitForText('detail-name', 'takes 10% off')
  await waitForText('detail-status', '✕ FAILED')
  await waitForText('failure-headline', 'expect(received).toEqual(expected)')
  await app.getByTestId('failure-diff').waitFor()
  await app.getByTestId('source').waitFor()

  await app.getByTestId('search').fill('BREW25')
  await app.getByTestId('test-BREW25 takes 25% off big orders').waitFor()
  await waitForText('detail-name', 'takes 10% off')

  writeFileSync(pricing, good)
  await waitForText('count-fail', '0')
  await waitForText('count-pass', '67')
  await waitForText('badge', '✓')
  await waitForText('run-count', /^[3-9] runs$/)
}, 90_000)
