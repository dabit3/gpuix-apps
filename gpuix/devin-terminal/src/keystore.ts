// API key storage for devin-tui: the macOS Keychain when available, else a 0600 config file.
// Lookup order (see loadConfig): environment variables, then Keychain, then the file.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export type Saved = { apiKey: string; orgId: string; baseUrl?: string }
export type KeySource = 'env' | 'keychain' | 'file'
export type Runner = (args: string[]) => { ok: boolean; out: string }
export type Store = { run: Runner | null; file: string }

const SERVICE = 'devin-tui'
const ACCOUNT = 'default'

// Writes go through `security -i` on stdin so the secret never appears in a process's argv.
export const securityRunner: Runner = (args) => {
  try {
    const write = args[0] === 'add-generic-password'
    const p = Bun.spawnSync(write ? ['/usr/bin/security', '-i'] : ['/usr/bin/security', ...args], {
      stdin: write ? Buffer.from(`${args.map((a) => `"${a}"`).join(' ')}\n`) : 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const err = p.stderr.toString()
    return { ok: p.exitCode === 0 && !(write && err.trim()), out: p.stdout.toString().trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

export function defaultStore(env: Record<string, string | undefined> = process.env): Store {
  return {
    run: process.platform === 'darwin' && process.env.NODE_ENV !== 'test' ? securityRunner : null,
    file: env.DEVIN_TUI_CONFIG ?? `${env.HOME ?? ''}/.config/devin-tui/config.json`,
  }
}

function readFile(file: string): Partial<Saved> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>
  } catch {
    return {}
  }
}

function writeFile(file: string, data: Partial<Saved>) {
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
  chmodSync(file, 0o600)
}

export function readKeychain(store: Store): Saved | null {
  if (!store.run) return null
  const r = store.run(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'])
  if (!r.ok || !r.out) return null
  try {
    const raw = r.out.startsWith('{') ? r.out : Buffer.from(r.out, 'base64').toString('utf8')
    const v = JSON.parse(raw) as Partial<Saved>
    return v.apiKey && v.orgId ? (v as Saved) : null
  } catch {
    return null
  }
}

export function readSaved(store: Store): { cfg: Partial<Saved>; source: 'keychain' | 'file' | null } {
  const file = readFile(store.file)
  const kc = readKeychain(store)
  if (kc) return { cfg: { ...file, ...kc }, source: 'keychain' }
  return { cfg: file, source: file.apiKey ? 'file' : null }
}

/** Saves the key to the Keychain (the file then keeps only the org and endpoint), or to the 0600 file. */
export function saveCredentials(c: Saved, store: Store): 'keychain' | 'file' {
  const meta: Partial<Saved> = { orgId: c.orgId, ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}) }
  if (store.run) {
    const r = store.run(['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-l', 'Devin API key (devin-tui)', '-w', Buffer.from(JSON.stringify(c)).toString('base64')])
    if (r.ok) {
      writeFile(store.file, meta)
      return 'keychain'
    }
  }
  writeFile(store.file, { ...meta, apiKey: c.apiKey })
  return 'file'
}

export function removeCredentials(store: Store) {
  store.run?.(['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT])
  if (!existsSync(store.file)) return
  const f = readFile(store.file)
  delete f.apiKey
  writeFile(store.file, f)
}
