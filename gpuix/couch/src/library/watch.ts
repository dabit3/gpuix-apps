import { watch } from 'node:fs'
import type { Library } from './model.ts'
import { scanLibrary } from './scan.ts'

/** Rescans when files land in the library (debounced), so Recently Added updates live. */
export function watchLibrary(root: string, onChange: (lib: Library) => void, debounceMs = 700) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  const sig = (l: Library) => Object.values(l.items).map((i) => i.path ?? i.id).sort().join('\n')
  last = sig(scanLibrary(root))
  try {
    const w = watch(root, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const next = scanLibrary(root)
        const s = sig(next)
        if (s !== last) { last = s; onChange(next) }
      }, debounceMs)
    })
    process.on('exit', () => w.close())
    return w
  } catch { return undefined }
}
