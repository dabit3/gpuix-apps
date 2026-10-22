import type { FromEngine, ToEngine } from './protocol'
import type { Settings } from './scene'

/** Where frames come from. The CLI uses the engine worker; tests drive the UI with a fake. */
export interface Source {
  post(m: ToEngine): void
  subscribe(cb: (m: FromEngine) => void): () => void
}

export function workerSource(settings: Partial<Settings>, camera: { pitch?: number; dist?: number }, workers?: number): Source {
  const w = new Worker(new URL('./engine-worker.ts', import.meta.url).href)
  const subs = new Set<(m: FromEngine) => void>()
  w.onmessage = (e: MessageEvent<FromEngine>) => { for (const cb of subs) cb(e.data) }
  w.postMessage({ type: 'init', settings, camera, workers })
  return {
    post: (m) => w.postMessage(m),
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb) },
  }
}
