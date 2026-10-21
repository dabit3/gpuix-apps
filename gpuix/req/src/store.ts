import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Method } from './http'
import type { Vars } from './vars'

export interface KV {
  id: string
  key: string
  value: string
  enabled: boolean
}

export type BodyType = 'json' | 'text' | 'none'

export interface RequestDraft {
  id: string
  name: string
  method: Method
  url: string
  headers: KV[]
  body: string
  bodyType: BodyType
  /** Where this request was opened from, so ⌃S saves back in place. */
  origin?: { collectionId: string; requestId: string }
}

export interface Collection {
  id: string
  name: string
  requests: RequestDraft[]
}

export interface Environment {
  name: string
  vars: Vars
}

export interface HistoryEntry {
  id: string
  at: number
  request: RequestDraft
  status: number | null
  ms: number
  size: number
  error?: string
}

export interface Workspace {
  collections: Collection[]
  environments: Environment[]
  activeEnv: string
}

let counter = 0
export const uid = (prefix = 'r') => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`
export const kv = (key: string, value: string, enabled = true): KV => ({ id: uid('h'), key, value, enabled })

export function defaultDataDir() {
  return process.env.REQ_HOME ?? path.join(os.homedir(), '.config', 'req')
}

export interface Paths {
  workspace: string
  history: string
}

export function dataPaths(dir = defaultDataDir()): Paths {
  return { workspace: path.join(dir, 'collections.json'), history: path.join(dir, 'history.json') }
}

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function loadWorkspace(file: string): Workspace {
  const saved = readJson<Workspace>(file)
  if (saved?.collections && saved.environments) return saved
  const seed = seedWorkspace()
  writeJson(file, seed)
  return seed
}

export function loadHistory(file: string): HistoryEntry[] {
  return readJson<HistoryEntry[]>(file) ?? []
}

export function blankRequest(url = ''): RequestDraft {
  return { id: uid(), name: 'Untitled request', method: 'GET', url, headers: [], body: '', bodyType: 'none' }
}

function req(name: string, method: Method, url: string, headers: [string, string][] = [], body = ''): RequestDraft {
  return {
    id: uid(),
    name,
    method,
    url,
    headers: headers.map(([k, v]) => kv(k, v)),
    body,
    bodyType: body ? 'json' : 'none',
  }
}

const GH: [string, string][] = [
  ['Accept', 'application/vnd.github+json'],
  ['Authorization', 'Bearer {{gh_token}}'],
  ['X-GitHub-Api-Version', '2022-11-28'],
]

export function seedWorkspace(): Workspace {
  return {
    activeEnv: 'dev',
    environments: [
      {
        name: 'dev',
        vars: { base: 'http://localhost:4000', api_key: 'dev_7f3a9c21', gh: 'https://api.github.com', gh_token: '$GITHUB_PAT' },
      },
      {
        name: 'staging',
        vars: { base: 'http://localhost:4001', api_key: 'stg_51be0d77', gh: 'https://api.github.com', gh_token: '$GITHUB_PAT' },
      },
    ],
    collections: [
      {
        id: 'c-local',
        name: 'Orders API',
        requests: [
          req('List products', 'GET', '{{base}}/api/products?limit=4&sort=price', [['X-Api-Key', '{{api_key}}']]),
          req('Get product', 'GET', '{{base}}/api/products/p_1042', [['X-Api-Key', '{{api_key}}']]),
          req(
            'Create order',
            'POST',
            '{{base}}/api/orders',
            [['X-Api-Key', '{{api_key}}'], ['Content-Type', 'application/json']],
            JSON.stringify(
              { customer: 'cus_8812', items: [{ sku: 'p_1042', qty: 2 }, { sku: 'p_2001', qty: 1 }], shipping: 'express' },
              null,
              2,
            ),
          ),
          req('Slow report', 'GET', '{{base}}/api/reports/daily?delay=900', [['X-Api-Key', '{{api_key}}']]),
          req('Health', 'GET', '{{base}}/health'),
        ],
      },
      {
        id: 'c-github',
        name: 'GitHub',
        requests: [
          req('gpuix repo', 'GET', '{{gh}}/repos/remorses/gpuix', GH),
          req('Zed releases', 'GET', '{{gh}}/repos/zed-industries/zed/releases?per_page=3', GH),
          req('Search Rust UI repos', 'GET', '{{gh}}/search/repositories?q=gpui+language:rust&per_page=5', GH),
          req('Rate limit', 'GET', '{{gh}}/rate_limit', GH),
        ],
      },
      {
        id: 'c-httpbin',
        name: 'httpbin',
        requests: [
          req('Echo GET', 'GET', 'https://httpbin.org/get?from=req&term=ghostty'),
          req('Echo JSON', 'POST', 'https://httpbin.org/post', [['Content-Type', 'application/json']], '{\n  "hello": "terminal",\n  "pixels": true\n}'),
          req('Teapot', 'GET', 'https://httpbin.org/status/418'),
          req('Gzip', 'GET', 'https://httpbin.org/gzip'),
        ],
      },
    ],
  }
}
