/**
 * Orbit scheduler: runs background jobs with retries and jittered backoff.
 */
export interface Job<T = unknown> {
  id: string
  run: (signal: AbortSignal) => Promise<T>
  retries?: number
  timeoutMs?: number
}

export type JobResult<T> =
  | { id: string; ok: true; value: T; attempts: number; ms: number }
  | { id: string; ok: false; error: string; attempts: number; ms: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function backoff(attempt: number, base = 200, cap = 5_000): number {
  const exp = Math.min(cap, base * 2 ** attempt)
  return exp / 2 + Math.random() * (exp / 2)
}

export async function runJob<T>(job: Job<T>): Promise<JobResult<T>> {
  const started = performance.now()
  const max = job.retries ?? 3
  let lastError = 'unknown'
  for (let attempt = 0; attempt <= max; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), job.timeoutMs ?? 10_000)
    try {
      const value = await job.run(controller.signal)
      return { id: job.id, ok: true, value, attempts: attempt + 1, ms: performance.now() - started }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < max) await sleep(backoff(attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  return { id: job.id, ok: false, error: lastError, attempts: max + 1, ms: performance.now() - started }
}

export async function runAll<T>(jobs: Job<T>[], concurrency = 4): Promise<JobResult<T>[]> {
  const results: JobResult<T>[] = []
  const queue = [...jobs]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) results.push(await runJob(queue.shift()!))
  })
  await Promise.all(workers)
  return results
}
