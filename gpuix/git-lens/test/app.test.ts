import { afterAll, describe, expect, test } from 'bun:test'
import { launch } from '@gpuix/react/automation'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeScratchRepo, sh } from './scratch'

const repo = makeScratchRepo()
let app: Awaited<ReturnType<typeof launch>> | null = null

afterAll(async () => {
  await app?.close()
})

describe('git-lens native window', () => {
  test('search, select, inspect and commit through real input', async () => {
    app = await launch({
      command: process.execPath,
      args: [join(import.meta.dir, '..', 'app.tsx'), repo],
      env: { GPUIX_BACKGROUND: '1' },
    })
    await app.getByTestId('commit-0').waitFor()
    expect(await app.getByTestId('commit-count').textContent()).toBe('4 commits')
    await waitForText('detail-subject', 'Merge branch feature/search')

    await app.getByTestId('search').fill('search helper')
    await waitForText('commit-count', '1 of 4 commits')
    await app.getByTestId('commit-0').click()
    await waitForText('detail-subject', 'Add search helper')
    await app.getByTestId('file-src/search.ts').waitFor()
    await app.getByTestId('tab-blame').click()
    await app.getByTestId('search').fill('')
    await waitForText('commit-count', '4 commits')

    await app.getByTestId('nav-changes').click()
    await waitForText('changes-summary', '0 staged · 1 unstaged')
    await app.getByTestId('hunk-1').waitFor()
    await app.getByTestId('hunk-1').click()
    await waitForText('changes-summary', '1 staged · 1 unstaged')
    expect(sh(repo, 'diff', '--cached')).toContain('second hunk')
    expect(sh(repo, 'diff', '--cached')).not.toContain('first hunk')

    await app.getByTestId('stage-src/app.ts').click()
    await waitForText('changes-summary', '1 staged · 0 unstaged')
    await app.getByTestId('commit-message').fill('Tune both values from git-lens')
    await app.getByTestId('commit-button').click()
    await waitForText('changes-summary', '0 staged · 0 unstaged')
    expect(sh(repo, 'log', '-1', '--format=%s').trim()).toBe('Tune both values from git-lens')
    expect(await app.getByTestId('toast').textContent()).toContain('Committed')
    await app.screenshot({ path: join(tmpdir(), 'git-lens-after-commit.png') })
  }, 90_000)
})

async function waitForText(testId: string, expected: string) {
  const deadline = Date.now() + 10_000
  let last = ''
  while (Date.now() < deadline) {
    last = (await app!.getByTestId(testId).textContent().catch((e: Error) => `<${e.message}>`)) ?? ''
    if (last === expected) return
    await Bun.sleep(100)
  }
  console.log('repo log:', sh(repo, 'log', '--oneline', '-3'), 'status:', sh(repo, 'status', '--short'))
  throw new Error(`${testId}: expected "${expected}", got "${last}"`)
}
