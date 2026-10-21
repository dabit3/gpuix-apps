// jx behaviour tests: the query/schema/diff engines, then the real <App> driven through the
// GPUIX Metal test renderer with native keystrokes.
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createTestRoot } from '@gpuix/react/testing'
import { App, type Doc } from '../src/App'
import { type Json, flatten, jqPath, pathKey, searchPaths } from '../src/json'
import { runQuery } from '../src/query'
import { inferSchema, schemaRows } from '../src/schema'
import { diffJson } from '../src/diff'

const dir = mkdtempSync(join(tmpdir(), 'jx-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const events = (JSON.parse(gunzipSync(readFileSync(join(import.meta.dir, '../data/github-events.json.gz'))).toString('utf8')) as Json[]).slice(0, 400)
const pkgA = JSON.parse(readFileSync(join(import.meta.dir, '../data/gpuix-react-0.10.0.json'), 'utf8')) as Json
const pkgB = JSON.parse(readFileSync(join(import.meta.dir, '../data/gpuix-react-0.11.0.json'), 'utf8')) as Json

// A real login from the data: appears in keys/values the search and filter must find.
const term = (events[37] as { actor: { login: string } }).actor.login
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function mount(docs: Doc[], props: Partial<Parameters<typeof App>[0]> = {}) {
  const copied: string[] = []
  const t = createTestRoot({ width: 1280, height: 800 })
  t.render(<App docs={docs} onCopy={(s) => copied.push(s)} {...props} />)
  t.renderer.flush()
  const r = t.renderer
  const app = r.findByTestId('app')!
  const key = (k: string) => { r.nativeSimulateKeystrokes(app.id, k); r.flush() }
  const text = () => r.getAllText().join('')
  const textOf = (id: number): string => {
    const el = r.getElement(id)
    return el ? (el.text ?? '') + el.children.map(textOf).join('') : ''
  }
  const byId = (id: string) => {
    const el = r.findByTestId(id)
    return el ? textOf(el.id) : ''
  }
  return { r, key, text, byId, copied }
}

describe('query engine', () => {
  it('runs jq-style pipelines over real GitHub events', () => {
    const pushes = runQuery('.[] | select(.type == "PushEvent")', events)
    expect(pushes.length).toBeGreaterThan(50)
    expect(pushes.every((e) => (e as { type: string }).type === 'PushEvent')).toBe(true)
    expect(runQuery('length', events)).toEqual([400])
    expect(runQuery('.[0].actor.login', events)).toEqual([(events[0] as { actor: { login: string } }).actor.login])
    const shaped = runQuery('.[] | select(.type == "PushEvent") | {user: .actor.login, n: (.payload.commits | length)}', events)
    expect(Object.keys(shaped[0] as object)).toEqual(['user', 'n'])
    expect(typeof (shaped[0] as { n: number }).n).toBe('number')
    const types = runQuery('map(.type) | unique', events)[0] as string[]
    expect(types).toContain('PushEvent')
    expect([...types].sort()).toEqual(types)
    const groups = runQuery('group_by(.type) | map({type: .[0].type, count: length}) | sort_by(.count) | last', events)[0] as { type: string; count: number }
    expect(groups.count).toBe(pushes.length)
    expect(runQuery('.[2:4] | length', events)).toEqual([2])
    const mine = runQuery(`.[] | select(.actor.login | contains("${term}")) | .actor.login`, events)
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((n) => String(n).includes(term))).toBe(true)
  })

  it('reports errors instead of guessing', () => {
    expect(() => runQuery('.[] | .actor.login.nope', events)).toThrow(/cannot index string/)
    expect(() => runQuery('.[] | frobnicate', events)).toThrow(/unknown function/)
    expect(() => runQuery('.[0', events)).toThrow()
  })
})

describe('schema and diff', () => {
  it('infers field types and presence', () => {
    const rows = schemaRows(inferSchema(events))
    const type = rows.find((r) => r.path === '.[].type')!
    expect(type.type).toBe('string')
    expect(type.pct).toBe(100)
    const commits = rows.find((r) => r.path === '.[].payload.commits')!
    expect(commits.type).toBe('object[]')
    expect(commits.pct).toBeGreaterThan(0)
    expect(commits.pct).toBeLessThan(100)
    expect(rows.find((r) => r.path === '.[].payload.commits[].sha')?.type).toBe('string')
  })

  it('diffs two npm releases of @gpuix/react', () => {
    const { rows, stats } = diffJson(pkgA, pkgB)
    expect(rows.find((r) => r.status === 'changed' && r.key === 'version')?.right).toBe('"0.11.0"')
    expect(rows.filter((r) => r.status === 'added').map((r) => r.key)).toContain('./dialog')
    expect(stats.removed).toBe(0)
    expect(diffJson(pkgA, structuredClone(pkgA)).stats).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('finds search matches in document order and builds jq paths', () => {
    const hits = searchPaths(events, term)
    expect(hits.length).toBeGreaterThan(0)
    expect(jqPath(hits[0]!)).toMatch(/^\.\[\d+\]/)
    expect(jqPath(['a-b', 0, 'c'])).toBe('.["a-b"][0].c')
    expect(flatten(events, new Set([pathKey([])])).length).toBe(401)
  })
})

describe('jx app', () => {
  const doc: Doc = { name: 'events.json', bytes: 1, root: events }

  it('navigates and folds the tree with the keyboard and copies paths', () => {
    const ui = mount([doc])
    expect(ui.byId('doc-stats')).toContain('400 items')
    expect(ui.byId('position')).toBe('1/408')
    ui.key('down')
    ui.key('down')
    expect(ui.byId('path')).toBe('.[0].id')
    ui.key('y')
    expect(ui.copied).toEqual(['.[0].id'])
    expect(ui.byId('toast')).toBe('Copied .[0].id')
    ui.key('left')
    expect(ui.byId('path')).toBe('.[0]')
    ui.key('left')
    expect(ui.byId('position')).toBe('2/401')
    ui.key('down')
    ui.key('right')
    expect(ui.byId('position')).toBe('3/408')
    ui.key('shift-y')
    expect(JSON.parse(ui.copied.at(-1)!)).toEqual(events[1])
  })

  it('filters live with a jq expression', () => {
    const ui = mount([doc], { initialFilter: '.[] | select(.type == "PushEvent") | .repo.name' })
    const n = runQuery('.[] | select(.type == "PushEvent") | .repo.name', events).length
    expect(ui.byId('filter-status')).toContain(`${n} results`)
    expect(ui.text()).toContain((runQuery('.[] | select(.type == "PushEvent") | .repo.name', events)[0] as string))
    const bad = mount([doc], { initialFilter: '.[] | nope' })
    expect(bad.byId('filter-status')).toContain('unknown function')
  })

  it('jumps between search matches', () => {
    const ui = mount([doc], { initialSearch: term })
    const hits = searchPaths(events, term)
    ui.key('n')
    expect(ui.byId('search-status')).toBe(`1/${hits.length}`)
    expect(ui.byId('path')).toBe(jqPath(hits[0]!))
    ui.key('n')
    expect(ui.byId('path')).toBe(jqPath(hits[1]!))
    ui.key('escape')
    expect(ui.r.findByTestId('search')).toBeUndefined()
    ui.key('n')
    expect(ui.byId('path')).toBe(jqPath(hits[1]!))
  })

  it('shows a side-by-side diff', () => {
    const ui = mount([{ name: 'a.json', bytes: 1, root: pkgA }, { name: 'b.json', bytes: 1, root: pkgB }])
    const { stats } = diffJson(pkgA, pkgB)
    expect(ui.byId('diff-stats')).toBe(`+${stats.added}  −${stats.removed}  ~${stats.changed}`)
    expect(ui.text()).toContain('react-0.11.0.tgz')
    expect(ui.text()).toContain('react-0.10.0.tgz')
  })

  it('reloads a watched file when it changes', async () => {
    const path = join(dir, 'live.json')
    writeFileSync(path, JSON.stringify({ stars: 1, name: 'gpuix' }))
    const ui = mount([{ name: 'live.json', bytes: 1, root: { stars: 1, name: 'gpuix' }, path }], { watch: true })
    expect(ui.byId('watch')).toBe('watching')
    await sleep(300)
    writeFileSync(path, JSON.stringify({ stars: 2, name: 'gpuix', forks: 3 }))
    for (let i = 0; i < 20 && !ui.byId('toast'); i++) { await sleep(100); ui.r.flush() }
    expect(ui.byId('toast')).toBe('Reloaded live.json · 2 changes')
    expect(ui.byId('watch')).toContain('reloaded')
    expect(ui.text()).toContain('forks')
  })
})
