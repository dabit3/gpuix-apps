// Regenerates examples/before.cpuprofile (slow path) and examples/after.cpuprofile (--fast)
// by profiling the sample workload with Bun's built-in V8-format CPU profiler.
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
for (const [name, args] of [
  ['before.cpuprofile', []],
  ['after.cpuprofile', ['--fast']],
] as const) {
  const p = Bun.spawnSync(
    ['bun', '--cpu-prof', `--cpu-prof-name=${name}`, '--cpu-prof-dir=examples', '--cpu-prof-interval=400', 'workload/build.ts', ...args],
    { cwd: root, stdout: 'inherit', stderr: 'inherit' },
  )
  if (p.exitCode !== 0) process.exit(p.exitCode ?? 1)
  console.log(`wrote examples/${name}`)
}
