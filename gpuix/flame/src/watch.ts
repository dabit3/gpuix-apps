import { readFileSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type { ProfileSource } from './app.tsx'
import { parseCpuProfile, type Profile } from './profile.ts'

export function loadProfile(path: string): Profile {
  return parseCpuProfile(JSON.parse(readFileSync(path, 'utf8')), path)
}

/** Loads a profile and reloads it whenever the file is rewritten. Watches the
 *  directory, since profilers replace the file rather than editing it. */
export function watchProfile(path: string, onError: (e: unknown) => void = () => {}): ProfileSource & { close(): void } {
  const abs = resolve(path)
  let current = loadProfile(abs)
  const subs = new Set<(p: Profile) => void>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = readFileSync(abs, 'utf8').length
  const reload = (attempt = 0) => {
    try {
      const text = readFileSync(abs, 'utf8')
      const next = parseCpuProfile(JSON.parse(text), abs)
      if (text.length === last && next.total === current.total) return
      last = text.length
      current = next
      for (const s of subs) s(next)
    } catch (e) {
      if (attempt < 8) timer = setTimeout(() => reload(attempt + 1), 150)
      else onError(e)
    }
  }
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dirname(abs), (_event, name) => {
      if (name && name.toString() !== basename(abs)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => reload(), 120)
    })
  } catch (e) {
    onError(e)
  }
  return {
    current: () => current,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    close() {
      watcher?.close()
      if (timer) clearTimeout(timer)
    },
  }
}
