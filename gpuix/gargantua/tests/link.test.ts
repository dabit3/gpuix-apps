import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'gargantua-link-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const root = join(import.meta.dir, '..')

test('gargantua drop -n 3 from one process reaches a pane in another process', async () => {
  const env = { ...process.env, GARGANTUA_LINK_DIR: dir }
  const pane = Bun.spawn([process.execPath, '-e', `
    const { Link } = await import(${JSON.stringify(join(root, 'src/link.ts'))})
    const l = new Link((m) => { console.log(JSON.stringify(m)); l.close(); process.exit(0) })
    console.log('ready')
    setTimeout(() => process.exit(3), 8000)
  `], { env, stdout: 'pipe' })
  const reader = pane.stdout.getReader()
  let out = ''
  while (!out.includes('ready')) { const { value, done } = await reader.read(); if (done) break; out += new TextDecoder().decode(value) }
  const drop = Bun.spawnSync([process.execPath, join(root, 'src/cli.ts'), 'drop', '-n', '3'], { env })
  expect(drop.exitCode).toBe(0)
  expect(drop.stdout.toString()).toContain('3 probes sent to 1 pane')
  while (!out.includes('probes')) { const { value, done } = await reader.read(); if (done) break; out += new TextDecoder().decode(value) }
  expect(await pane.exited).toBe(0)
  const msg = JSON.parse(out.split('\n').find((l) => l.includes('probes'))!)
  expect(msg.probes.length).toBe(3)
  expect(new Set(msg.probes.map((p: { id: string }) => p.id)).size).toBe(3)
  // Staggered release times so they fall one after another in every pane.
  expect(msg.probes[1].at - msg.probes[0].at).toBe(450)
})

test('drop with no running gargantua exits 1 and says so', () => {
  const r = Bun.spawnSync([process.execPath, join(root, 'src/cli.ts'), 'drop'], { env: { ...process.env, GARGANTUA_LINK_DIR: dir } })
  expect(r.exitCode).toBe(1)
  expect(r.stdout.toString()).toContain('no running gargantua')
})
