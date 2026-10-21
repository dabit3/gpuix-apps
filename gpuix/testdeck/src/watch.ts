import { watch, type FSWatcher } from 'node:fs'

const IGNORE = /(^|\/)(node_modules|\.git|\.cache|dist|coverage)(\/|$)/
const EXT = /\.(m?[jt]sx?|json)$/

/** Debounced recursive watcher; reports the changed relative paths. */
export function watchProject(dir: string, onChange: (paths: string[]) => void, debounceMs = 180): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const pending = new Set<string>()
  let w: FSWatcher | null = null
  try {
    w = watch(dir, { recursive: true }, (_ev, name) => {
      if (!name) return
      const p = String(name)
      if (IGNORE.test(p) || !EXT.test(p)) return
      pending.add(p)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const paths = [...pending]
        pending.clear()
        onChange(paths)
      }, debounceMs)
    })
  } catch {}
  return () => {
    if (timer) clearTimeout(timer)
    w?.close()
  }
}
