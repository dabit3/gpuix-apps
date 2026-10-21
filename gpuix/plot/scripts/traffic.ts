#!/usr/bin/env bun
// Appends a realistic web-traffic row (requests/s, p95 latency, error %) to a CSV every 250 ms.
// usage: bun scripts/traffic.ts traffic.csv
import { appendFileSync, writeFileSync } from 'node:fs'

const path = process.argv[2] ?? 'traffic.csv'
writeFileSync(path, 'time,requests,p95_ms,errors_pct\n')
let t = 0
let req = 420
const tick = (at = Date.now() / 1000) => {
  t += 0.25
  const wave = 160 * Math.sin(t / 6) + 60 * Math.sin(t / 1.7)
  req += (420 + wave - req) * 0.3 + (Math.random() - 0.5) * 40
  const spike = Math.random() < 0.03 ? 4 + Math.random() * 6 : 0
  const p95 = 38 + req * 0.06 + (Math.random() - 0.5) * 6 + spike * 12
  const err = Math.max(0, 0.4 + (Math.random() - 0.5) * 0.3 + spike)
  appendFileSync(path, `${at.toFixed(3)},${req.toFixed(0)},${p95.toFixed(1)},${err.toFixed(2)}\n`)
}
// Backfill 20 s so the chart opens with history.
const now = Date.now() / 1000
for (let i = 80; i > 0; i--) tick(now - i * 0.25)
setInterval(() => tick(), 250)
