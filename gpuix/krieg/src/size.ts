// Size budget: minify the app (GPUIX + React stay external: they are the platform, like WebGL in the
// browser original) and report bytes per module. The build fails above 64 KB.
import { gzipSync } from 'node:zlib'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export const BUDGET = 65536
const ROOT = join(import.meta.dir)
const EXTERNAL = ['@gpuix/react', '@gpuix/native', 'react', 'react/jsx-runtime', 'react-dom', 'node:*']

export interface SizeReport { bytes: number; gzip: number; modules: { file: string; bytes: number; src: number }[] }

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []
  })
}

async function minified(entry: string, isolate: boolean) {
  const res = await Bun.build({
    entrypoints: [entry], minify: true, target: 'bun', external: EXTERNAL,
    plugins: isolate ? [{ name: 'isolate', setup(b) { b.onResolve({ filter: /^\./ }, (a) => (a.importer === entry ? { path: a.path, external: true } : undefined)) } }] : [],
  })
  if (!res.success) throw new Error(res.logs.map(String).join('\n'))
  return Buffer.from(await res.outputs[0]!.arrayBuffer())
}

export async function measure(entry = join(ROOT, 'cli.ts')): Promise<SizeReport> {
  const all = await minified(entry, false)
  const files = walk(ROOT).filter((f) => !f.endsWith('.d.ts'))
  const modules = await Promise.all(files.map(async (f) => ({ file: relative(ROOT, f), bytes: (await minified(f, true)).length, src: statSync(f).size })))
  modules.sort((a, b) => b.bytes - a.bytes)
  return { bytes: all.length, gzip: gzipSync(all, { level: 9 }).length, modules }
}

export function formatReport(r: SizeReport) {
  const kb = (n: number) => `${(n / 1024).toFixed(1).padStart(6)} KB`
  const lines = ['krieg size budget (minified, GPUIX/React external)', '']
  for (const m of r.modules) lines.push(`  ${m.file.padEnd(22)} ${kb(m.bytes)}   src ${kb(m.src)}`)
  lines.push('', `  bundle (cli.ts)        ${kb(r.bytes)}   gzip ${kb(r.gzip)}`)
  lines.push(`  budget                 ${kb(BUDGET)}   ${r.bytes <= BUDGET ? 'OK' : 'OVER'} (${((r.bytes / BUDGET) * 100).toFixed(0)}% used)`)
  return lines.join('\n')
}
