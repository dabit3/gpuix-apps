import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode, mergeRun, parseFailure, parseJunit, runTests } from '../src/runner'
import { parseThemeFile } from '../src/theme'

function fixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'testdeck-fixture-'))
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture","type":"module"}')
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return dir
}

describe('parseJunit', () => {
  test('reads suites, statuses, todo and timings', () => {
    const xml = `<testsuites><testsuite name="a.test.ts" file="a.test.ts"><testsuite name="math" file="a.test.ts">
      <testcase name="adds &amp; carries" classname="math" time="0.0205" file="a.test.ts" line="4"><failure type="AssertionError" message="expect(received).toBe(expected)&#10;&#10;Expected: 5&#10;Received: -1">at &lt;anonymous&gt; (a.test.ts:4:41)</failure></testcase>
      <testcase name="skipped" classname="math" time="0" file="a.test.ts" line="6"><skipped /></testcase>
      <testcase name="todo one" classname="math" time="0" file="a.test.ts" line="7"><skipped message="TODO" /></testcase>
      <testcase name="ok" classname="math" time="0.04" file="a.test.ts" line="8" />
    </testsuite></testsuite></testsuites>`
    const tests = parseJunit(xml)
    expect(tests.map((t) => [t.name, t.status])).toEqual([['adds & carries', 'fail'], ['skipped', 'skip'], ['todo one', 'todo'], ['ok', 'pass']])
    expect(tests[0].suites).toEqual(['math'])
    expect(tests[0].timeMs).toBe(20.5)
    expect(tests[0].failure?.expected).toBe('5')
    expect(tests[0].failure?.received).toBe('-1')
    expect(tests[0].failure?.frames[0]).toEqual({ file: 'a.test.ts', line: 4, col: 41 })
  })

  test('turns an object diff into a unified patch', () => {
    const f = parseFailure('expect(received).toEqual(expected)\n\n  {\n-   "c": "y",\n+   "c": "x",\n  }\n\n- Expected  - 1\n+ Received  + 1', '', 'AssertionError')
    expect(f.patch).toContain('@@ -1,3 +1,3 @@')
    expect(f.patch).toContain('\n-  "c": "y",\n+  "c": "x",\n')
    expect(f.patch).not.toContain('Expected  -')
  })

  test('decodes entities', () => {
    expect(decode('&lt;a&gt; &quot;b&quot; &#39;c&#x27;')).toBe(`<a> "b" 'c'`)
  })
})

describe('runTests (real bun test)', () => {
  test('runs a project, then reruns only the failures', async () => {
    const dir = fixture({
      'm.test.ts': `import { expect, test } from 'bun:test'\ntest('one', () => expect(1 + 1).toBe(2))\ntest('two', () => expect([1, 2]).toEqual([1, 3]))\ntest.skip('three', () => {})\n`,
    })
    const first = await runTests(dir)
    expect(first.counts).toEqual({ pass: 1, fail: 1, skip: 1, todo: 0 })
    const failed = first.tests.find((t) => t.status === 'fail')!
    expect(failed.name).toBe('two')
    expect(failed.failure?.patch).toContain('\n-  3,\n+  2,\n')
    expect(failed.failure?.frames[0]).toMatchObject({ file: 'm.test.ts', line: 3 })

    const again = mergeRun(first, await runTests(dir, { files: ['m.test.ts'], namePattern: '^two$' }))
    expect(again.tests).toHaveLength(3)
    expect(again.counts.fail).toBe(1)
    expect(again.partial).toBe(true)
  })

  test('reports load errors', async () => {
    const dir = fixture({ 'x.test.ts': `import { nope } from './missing'\nnope()\n` })
    const r = await runTests(dir)
    expect(r.error ?? '').toContain("Cannot find module './missing'")
  })
})

test('reads Ghostty theme files', () => {
  const t = parseThemeFile('palette = 1=#ff9492\npalette = 2=26cd4d\nbackground = #0a0c10\nforeground = f0f3f6\n', 'x')
  expect(t.background).toBe('#0a0c10')
  expect(t.foreground).toBe('#f0f3f6')
  expect(t.palette[1]).toBe('#ff9492')
  expect(t.palette[2]).toBe('#26cd4d')
})
