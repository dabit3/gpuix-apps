import { watch, watchFile, unwatchFile, readFileSync, statSync, existsSync, type FSWatcher } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

export type Snapshot = { text: string; mtime: number }

export function readSnapshot(path: string): Snapshot | null {
  try {
    return { text: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs }
  } catch {
    return null
  }
}

/**
 * Watch a file the way editors save it: in place (micro, VS Code) or by
 * writing a temp file and renaming it over the original (nvim, vim). The
 * directory watcher sees both; a 250 ms stat poll covers network/odd FS.
 * `onChange` fires only when the text actually changed.
 */
export function watchDocument(file: string, onChange: (s: Snapshot) => void, intervalMs = 250): () => void {
  const path = resolve(file)
  let last = readSnapshot(path)?.text
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!existsSync(path)) return
      const s = readSnapshot(path)
      if (!s || s.text === last) return
      last = s.text
      onChange(s)
    }, 30)
  }
  let dirWatcher: FSWatcher | undefined
  try {
    dirWatcher = watch(dirname(path), (_event, name) => {
      if (!name || name.toString() === basename(path)) check()
    })
  } catch {
    dirWatcher = undefined
  }
  watchFile(path, { interval: intervalMs }, check)
  return () => {
    clearTimeout(timer)
    dirWatcher?.close()
    unwatchFile(path, check)
  }
}
