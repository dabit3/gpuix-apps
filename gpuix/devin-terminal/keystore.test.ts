import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'bun:test'
import { readSaved, removeCredentials, saveCredentials, type Runner, type Store } from './src/keystore'
import { loadConfig } from './src/api'

function fakeKeychain(fail = false) {
  const items = new Map<string, string>()
  const calls: string[][] = []
  const run: Runner = (args) => {
    calls.push(args)
    if (fail) return { ok: false, out: '' }
    const key = `${args[args.indexOf('-s') + 1]}/${args[args.indexOf('-a') + 1]}`
    if (args[0] === 'add-generic-password') items.set(key, args[args.indexOf('-w') + 1]!)
    if (args[0] === 'delete-generic-password') return { ok: items.delete(key), out: '' }
    if (args[0] === 'find-generic-password') return { ok: items.has(key), out: items.get(key) ?? '' }
    return { ok: true, out: '' }
  }
  return { run, items, calls }
}

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devin-tui-')), 'cfg', 'config.json')

describe('keystore', () => {
  it('saves to the Keychain and keeps the token out of the config file', () => {
    const kc = fakeKeychain()
    const store: Store = { run: kc.run, file: tmpFile() }
    expect(saveCredentials({ apiKey: 'cog_secret_1234', orgId: 'org-abc' }, store)).toBe('keychain')
    const onDisk = JSON.parse(fs.readFileSync(store.file, 'utf8'))
    expect(onDisk).toEqual({ orgId: 'org-abc' })
    expect(fs.statSync(store.file).mode & 0o777).toBe(0o600)
    expect(kc.calls[0]).toContain('-U')
    expect(readSaved(store)).toMatchObject({ source: 'keychain', cfg: { apiKey: 'cog_secret_1234', orgId: 'org-abc' } })
    expect(loadConfig({}, undefined, store)).toMatchObject({ apiKey: 'cog_secret_1234', orgId: 'org-abc', source: 'keychain' })
    expect(loadConfig({ DEVIN_API_KEY: 'env-key' }, undefined, store)).toMatchObject({ apiKey: 'env-key', source: 'env' })
    removeCredentials(store)
    expect(kc.items.size).toBe(0)
    expect(loadConfig({}, undefined, store)).toBeNull()
  })

  it('falls back to a 0600 file when the Keychain is unavailable', () => {
    const store: Store = { run: fakeKeychain(true).run, file: tmpFile() }
    expect(saveCredentials({ apiKey: 'cog_file_5678', orgId: 'org-xyz' }, store)).toBe('file')
    expect(fs.statSync(store.file).mode & 0o777).toBe(0o600)
    expect(loadConfig({}, undefined, store)).toMatchObject({ apiKey: 'cog_file_5678', source: 'file' })
    removeCredentials(store)
    expect(JSON.parse(fs.readFileSync(store.file, 'utf8'))).toEqual({ orgId: 'org-xyz' })
    const noKc: Store = { run: null, file: store.file }
    expect(saveCredentials({ apiKey: 'cog_again_9', orgId: 'org-xyz' }, noKc)).toBe('file')
  })
})
