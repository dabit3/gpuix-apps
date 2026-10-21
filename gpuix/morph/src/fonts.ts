import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dir, '..', 'assets', 'fonts')
export function registerGeist(renderer: unknown) {
  const r = renderer as { registerFont?: (b: Uint8Array) => void }
  for (const w of ['Regular', 'Medium', 'SemiBold']) {
    try { r.registerFont?.(readFileSync(join(DIR, `Geist-${w}.ttf`))) } catch { /* duplicate registration on remount */ }
  }
}
