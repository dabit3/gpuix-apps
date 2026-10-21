import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { connectTest } from '@gpuix/react/automation'
import { createTestRoot, hasNativeTestRenderer } from '@gpuix/react/testing'
import { App } from './src/App'
import { toCurl, shellRefs } from './src/curl'
import { sendRequest, type Sender, type WireRequest, type WireResponse } from './src/http'
import { flattenJson } from './src/json'
import { dataPaths, type HistoryEntry, type Workspace } from './src/store'
import { interpolate } from './src/vars'

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const PRODUCTS = {
  data: [
    { id: 'p_2210', name: 'MX Master 3S', price: 99, tags: ['mouse'] },
    { id: 'p_3410', name: 'Desk Mat XL', price: 120, tags: ['desk'] },
  ],
  total: 2,
}

function mockSender(seen: WireRequest[], body: unknown = PRODUCTS, status = 200): Sender {
  return async (request) => {
    seen.push(request)
    await new Promise((r) => setTimeout(r, 5))
    const text = JSON.stringify(body)
    const res: WireResponse = {
      status,
      statusText: status === 200 ? 'OK' : 'Not Found',
      httpVersion: '1.1',
      headers: [['Content-Type', 'application/json'], ['X-Request-Id', 'req_42']],
      body: text,
      size: text.length,
      timings: { dns: 1.2, connect: 2.1, tls: 0, ttfb: 8.4, download: 0.6, total: 12.3 },
      remoteAddress: '127.0.0.1',
    }
    return res
  }
}

/** Never resolves until aborted, so the UI stays in its loading state. */
const hangingSender: Sender = (_req, signal) =>
  new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))

const dirs: string[] = []
function tempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-test-'))
  dirs.push(dir)
  return dataPaths(dir)
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const readJson = <T,>(file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as T

async function until(check: () => boolean, label: string, timeoutMs = 5000) {
  const start = Date.now()
  const ok = () => {
    try {
      return check()
    } catch {
      return false
    }
  }
  while (!ok()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

describeNative('req app', () => {
  it('sends a saved request with env vars resolved, shows the response, and records history', async () => {
    const paths = tempPaths()
    const seen: WireRequest[] = []
    const { render, renderer } = createTestRoot()
    render(<App paths={paths} sender={mockSender(seen)} />)
    const app = await connectTest(renderer)
    try {
      await app.getByTestId('req-c-local-0').click()
      expect(await app.getByTestId('resolved-url').textContent()).toContain('http://localhost:4000/api/products?limit=4&sort=price')
      await app.getByTestId('send').click()
      await app.getByTestId('status').waitFor()

      expect(seen).toHaveLength(1)
      expect(seen[0]!.url).toBe('http://localhost:4000/api/products?limit=4&sort=price')
      expect(seen[0]!.headers).toContainEqual(['X-Api-Key', 'dev_7f3a9c21'])
      expect(await app.getByTestId('status').textContent()).toBe('200 OK')
      const painted = renderer.getPaintedText().join('\n')
      expect(painted).toContain('MX Master 3S')
      expect(painted).toContain('Desk Mat XL')

      await until(() => readJson<HistoryEntry[]>(paths.history).length === 1, 'history saved')
      const [entry] = readJson<HistoryEntry[]>(paths.history)
      expect(entry).toMatchObject({ status: 200 })
      expect(entry!.request.url).toBe('{{base}}/api/products?limit=4&sort=price')

      await app.getByTestId('side-history').click()
      const historyRow = await app.getByTestId('history-0').textContent()
      expect(historyRow).toContain('/api/products?limit=4&sort=price')
      expect(historyRow).toContain('200')
    } finally {
      await app.close()
    }
  })

  it('collapses, expands and searches the JSON tree', async () => {
    const paths = tempPaths()
    const { render, renderer } = createTestRoot()
    render(<App paths={paths} sender={mockSender([])} initial={{ request: { url: 'https://example.test/products' }, autoSend: true }} />)
    const app = await connectTest(renderer)
    try {
      await app.getByTestId('status').waitFor()
      await app.getByTestId('collapse-all').click()
      await until(() => !renderer.getPaintedText().join('\n').includes('MX Master 3S'), 'tree collapsed')

      await app.getByTestId('expand-all').click()
      await until(() => renderer.getPaintedText().join('\n').includes('MX Master 3S'), 'tree expanded')

      await app.getByTestId('node-$/data').click()
      await until(() => !renderer.getPaintedText().join('\n').includes('Desk Mat XL'), 'data array collapsed')
      await app.getByTestId('node-$/data').click()
      await until(() => renderer.getPaintedText().join('\n').includes('Desk Mat XL'), 'data array reopened')

      await app.getByTestId('json-search').fill('desk')
      await until(() => /2 match/.test(renderer.getPaintedText().join('\n')), 'two matches for "desk"')
      expect(await app.getByTestId('match-count').textContent()).toMatch(/^2 match/)
    } finally {
      await app.close()
    }
  })

  it('copies as curl with shell references instead of secret values', async () => {
    const paths = tempPaths()
    const copied: string[] = []
    const { render, renderer } = createTestRoot()
    render(
      <App
        paths={paths}
        sender={mockSender([])}
        copy={(text) => {
          copied.push(text)
          return 'osc52'
        }}
      />,
    )
    const app = await connectTest(renderer)
    try {
      await app.getByTestId('req-c-github-0').click()
      await app.getByTestId('copy-curl').click()
      await app.getByTestId('toast').waitFor()
      expect(await app.getByTestId('toast').textContent()).toContain('OSC 52')
      expect(copied).toHaveLength(1)
      expect(copied[0]).toContain("curl 'https://api.github.com/repos/remorses/gpuix'")
      expect(copied[0]).toContain('"Authorization: Bearer $GITHUB_PAT"')
      if (process.env.GITHUB_PAT) expect(copied[0]).not.toContain(process.env.GITHUB_PAT)
    } finally {
      await app.close()
    }
  })

  it('saves an ad-hoc request into a collection file', async () => {
    const paths = tempPaths()
    const { render, renderer } = createTestRoot()
    render(<App paths={paths} sender={mockSender([])} initial={{ request: { url: 'https://httpbin.org/uuid' } }} />)
    const app = await connectTest(renderer)
    try {
      await app.getByTestId('save').click()
      await app.getByTestId('save-dialog').waitFor()
      await app.getByTestId('save-name').fill('UUID')
      await app.getByTestId('save-col-c-httpbin').click()
      await app.getByTestId('save-confirm').click()
      await until(() => readJson<Workspace>(paths.workspace).collections.some((c) => c.requests.some((r) => r.name === 'UUID')), 'saved request')
      const httpbin = readJson<Workspace>(paths.workspace).collections.find((c) => c.id === 'c-httpbin')!
      expect(httpbin.requests.at(-1)).toMatchObject({ name: 'UUID', url: 'https://httpbin.org/uuid', method: 'GET' })
    } finally {
      await app.close()
    }
  })

  it('cancels an in-flight request with the cancel button', async () => {
    const paths = tempPaths()
    const { render, renderer } = createTestRoot()
    render(<App paths={paths} sender={hangingSender} initial={{ request: { url: 'http://localhost:4000/api/reports/daily?delay=9000' }, autoSend: true }} />)
    const app = await connectTest(renderer)
    try {
      await app.getByTestId('cancel').waitFor()
      await app.getByTestId('cancel').click()
      await app.getByTestId('send').waitFor()
      await until(() => readJson<HistoryEntry[]>(paths.history).length === 1, 'cancelled request in history')
      expect(readJson<HistoryEntry[]>(paths.history)[0]).toMatchObject({ status: null, error: 'Cancelled' })
    } finally {
      await app.close()
    }
  })
})

describe('transport + helpers', () => {
  it('times a real HTTP request and decodes gzip + chunked bodies', async () => {
    const server = http.createServer((req, res) => {
      setTimeout(() => {
        res.writeHead(201, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
        res.end(zlib.gzipSync(JSON.stringify({ method: req.method, url: req.url, auth: req.headers['x-api-key'] })))
      }, 30)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    try {
      const res = await sendRequest({ method: 'POST', url: `http://localhost:${port}/api/orders?x=1`, headers: [['X-Api-Key', 'k1']], body: '{}' })
      expect(res.status).toBe(201)
      expect(JSON.parse(res.body)).toEqual({ method: 'POST', url: '/api/orders?x=1', auth: 'k1' })
      expect(res.timings.ttfb).toBeGreaterThanOrEqual(25)
      expect(res.timings.total).toBeGreaterThanOrEqual(res.timings.ttfb)
      expect(res.timings.tls).toBe(0)
    } finally {
      server.close()
    }
  })

  it('interpolates {{vars}} and $ENV, and keeps secrets as shell refs in curl', () => {
    const vars = { base: 'http://localhost:4000', token: '$REQ_TEST_TOKEN' }
    expect(interpolate('{{base}}/x?t={{token}}', vars, { REQ_TEST_TOKEN: 'abc' })).toBe('http://localhost:4000/x?t=abc')
    const curl = toCurl({ method: 'POST', url: interpolate('{{base}}/o', vars, shellRefs), headers: [['Authorization', interpolate('Bearer {{token}}', vars, shellRefs)]], body: '{"a":1}' })
    expect(curl).toContain('-X POST')
    expect(curl).toContain('"Authorization: Bearer $REQ_TEST_TOKEN"')
    expect(curl).not.toContain('abc')
  })

  it('flattens JSON with collapse and search', () => {
    const all = flattenJson(PRODUCTS, new Set())
    expect(all.rows.some((r) => r.key === 'name')).toBe(true)
    expect(flattenJson(PRODUCTS, new Set(['$/data'])).rows.some((r) => r.key === 'name')).toBe(false)
    expect(flattenJson(PRODUCTS, new Set(), 'mouse').matches).toBe(1)
  })
})
