# Orbit

Background jobs with **retries**, jittered backoff and per-job timeouts.

```ts
import { runAll } from './src/scheduler'

const results = await runAll(jobs, 4)
```

| Module | Language | Purpose |
| --- | --- | --- |
| `scheduler.ts` | TypeScript | job queue + retries |
| `geometry.rs` | Rust | layout math |
| `stats.py` | Python | latency percentiles |
| `main.go` | Go | health endpoint |
