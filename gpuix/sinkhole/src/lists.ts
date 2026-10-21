import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { AD_DOMAINS } from './corpus'
import { HashedBlocklist, normalizeDomain, parseHosts } from './dns/blocklist'

export const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts'

const dataDir = () => process.env.SINKHOLE_HOME ?? join(homedir(), '.sinkhole')
export const paths = () => ({ bin: join(dataDir(), 'blocklist.bin'), meta: join(dataDir(), 'blocklist.json'), config: join(dataDir(), 'config.json') })

export interface ListMeta { source: string; domains: number; updated: string; bytes: number }

export function loadBlocklist(file?: string): { list: HashedBlocklist; meta: ListMeta } {
  if (file) {
    const text = readFileSync(file, 'utf8')
    const domains = [...parseHosts(text), ...AD_DOMAINS]
    const list = HashedBlocklist.fromDomains(domains)
    return { list, meta: { source: file, domains: list.size, updated: new Date().toISOString(), bytes: list.size * 5 } }
  }
  const p = paths()
  if (existsSync(p.bin)) {
    try {
      const list = HashedBlocklist.deserialize(new Uint8Array(readFileSync(p.bin)))
      const meta: ListMeta = existsSync(p.meta) ? JSON.parse(readFileSync(p.meta, 'utf8')) : { source: p.bin, domains: list.size, updated: '', bytes: list.size * 5 }
      return { list, meta }
    } catch {}
  }
  const list = HashedBlocklist.fromDomains(AD_DOMAINS)
  return { list, meta: { source: 'built-in seed list', domains: list.size, updated: '', bytes: list.size * 5 } }
}

/** Downloads a hosts list, hashes it to 40 bits, and writes the sorted 5-byte table (the "flash partition"). */
export async function updateBlocklist(source = DEFAULT_SOURCE): Promise<{ list: HashedBlocklist; meta: ListMeta }> {
  const text = /^https?:/.test(source) ? await (await fetch(source)).text() : readFileSync(source, 'utf8')
  const domains = parseHosts(text)
  if (domains.length < 10) throw new Error(`only ${domains.length} domains in ${source}`)
  const list = HashedBlocklist.fromDomains([...domains, ...AD_DOMAINS])
  const bin = list.serialize()
  const meta: ListMeta = { source, domains: list.size, updated: new Date().toISOString(), bytes: bin.length }
  const p = paths()
  mkdirSync(dirname(p.bin), { recursive: true })
  writeFileSync(p.bin, bin)
  writeFileSync(p.meta, JSON.stringify(meta, null, 2))
  return { list, meta }
}

export interface Config { allow: string[]; deny: string[]; upstreams?: string[]; blockMode?: 'null' | 'nxdomain' }

export function loadConfig(): Config {
  try {
    const c = JSON.parse(readFileSync(paths().config, 'utf8'))
    const clean = (a: unknown) => (Array.isArray(a) ? a.map((x) => normalizeDomain(String(x))).filter((x): x is string => !!x) : [])
    return { allow: clean(c.allow), deny: clean(c.deny), upstreams: Array.isArray(c.upstreams) ? c.upstreams.map(String) : undefined, blockMode: c.blockMode === 'nxdomain' ? 'nxdomain' : c.blockMode === 'null' ? 'null' : undefined }
  } catch {
    return { allow: [], deny: [] }
  }
}

export function saveConfig(c: Config) {
  const p = paths().config
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(c, null, 2))
}
