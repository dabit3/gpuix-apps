import { Engine } from './engine'
import type { FromEngine, ToEngine } from './protocol'
import type { Settings } from './scene'

declare const self: Worker
let engine: Engine | null = null
self.onmessage = (e: MessageEvent<ToEngine | { type: 'init'; settings: Partial<Settings>; bg: [number, number, number]; workers?: number }>) => {
  const m = e.data
  if (m.type === 'init') {
    engine = new Engine(m.settings, m.bg, (msg: FromEngine) => self.postMessage(msg), m.workers)
    engine.run().catch((err) => self.postMessage({ type: 'error', message: String(err?.stack ?? err) }))
    return
  }
  engine?.handle(m)
}
